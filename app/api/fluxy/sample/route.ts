// POST one AI turn. Checks session, per-minute and daily limits, validates the
// request, then streams newline-delimited JSON events from the router.
import { z } from "zod";
import { readSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import { route, SampleReq } from "@/lib/router";
import { LIMITS } from "@/lib/config";
import { clientKey, country } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Part = z.union([
  z.object({ type: z.literal("text"), text: z.string().max(200_000) }),
  z.object({ type: z.literal("image_url"), image_url: z.object({ url: z.string().regex(/^data:image\/(png|jpe?g|webp|gif);base64,/).max(2_500_000) }) }),
]);
const ToolCall = z.object({ id: z.string().max(200), type: z.literal("function"), function: z.object({ name: z.string().max(100), arguments: z.string().max(100_000) }) });
const Msg = z.union([
  z.object({ role: z.enum(["user", "assistant"]), content: z.union([z.string().max(200_000), z.array(Part).max(12)]), tool_calls: z.array(ToolCall).max(10).optional() }),
  z.object({ role: z.literal("tool"), content: z.string().max(50_000), tool_call_id: z.string().max(200) }),
]);
const Body = z.object({
  requestId: z.string().min(8).max(80),
  tier: z.enum(["quick", "default"]).default("default"),
  messages: z.array(Msg).min(1).max(60),
  tools: z.array(z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), description: z.string().max(2000).optional(), inputSchema: z.any().optional() })).max(20).optional(),
  json: z.boolean().optional(),
  stick: z.enum(["gemini", "groq", "openrouter"]).optional(),
});

const err = (code: string, status: number) => Response.json({ error: code }, { status });

export async function POST(req: Request) {
  const s = readSession(req);
  if (!s) return err("not_granted", 401);
  if (Number(req.headers.get("content-length") || 0) > LIMITS.maxBodyBytes) return err("too_large", 413);

  const store = getStore();
  const perMin = await store.hit(`sample:${s.label}:${clientKey(req)}`).catch(() => 0);
  if (perMin > LIMITS.perMinute) return err("rate_limited", 429);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("bad_request", 400);
  const body = parsed.data as SampleReq;

  // Tool follow-up steps don't count as new answers toward the daily cap.
  const isFollowUp = body.messages.some((m) => m.role === "tool");
  if (!isFollowUp && (await store.answersToday(s.label).catch(() => 0)) >= s.cap) return err("daily_limit", 429);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const ev of route(body, { label: s.label, country: country(req), signal: req.signal })) {
          ctrl.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
        }
      } catch {
        ctrl.enqueue(enc.encode(JSON.stringify({ t: "error", code: "unavailable" }) + "\n"));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
