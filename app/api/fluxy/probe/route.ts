// POST -> owner-only: sends a tiny test question to each AI through the exact same
// connection code Fluxy uses for real answers, and reports what came back.
// Test 1: a 3-word answer. Test 2: a chat-style request (streaming, with a tool when the AI supports tools).
import { PROVIDERS, hasKey } from "@/lib/config";
import { readSession } from "@/lib/session";
import { callOne, SampleReq } from "@/lib/router";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(p: (typeof PROVIDERS)[number], req: SampleReq, ms: number) {
  const ctl = AbortSignal.timeout(ms);
  let text = "", tool = false;
  const gen = callOne(p, req, ctl);
  for (let r = await gen.next(); !r.done; r = await gen.next()) {
    if (r.value.t === "text") text += r.value.v;
    if (r.value.t === "tool_calls") tool = true;
  }
  return { text: text.trim(), tool };
}

export async function POST(req: Request) {
  const s = readSession(req);
  if (!s || s.role !== "owner") return Response.json({ error: "not_granted" }, { status: 403 });
  const results = await Promise.all(PROVIDERS.map(async (p) => {
    if (!hasKey(p)) return { id: p.id, ok: false, status: 0, detail: p.paid ? "Not added (optional paid backup)" : "No key added in Vercel settings" };
    const t0 = Date.now();
    let detail = "", ok = false;
    try {
      const a = await run(p, { requestId: "probe-1", tier: "quick", messages: [{ role: "user", content: "Say hi in 3 words." }] }, 25_000);
      detail = a.text || "(empty answer)";
      ok = true;
    } catch (e) {
      detail = String((e as Error).message || e).slice(0, 400);
    }
    if (ok) {
      try {
        const tools = p.can.tools ? [{ name: "add_posts", description: "Add posts to the calendar", inputSchema: { type: "object", properties: { posts: { type: "array", items: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } } }, required: ["posts"] } }] : undefined;
        const b = await run(p, { requestId: "probe-2", tier: "default", messages: [{ role: "user", content: "Add one post titled Hello to the calendar." }], tools }, 30_000);
        detail += `  |  chat test OK (${p.models.default}): ` + (b.tool ? "used the tool" : b.text ? "answered" : "empty");
      } catch (e) {
        ok = false;
        detail += `  |  chat test FAILED (${p.models.default}): ` + String((e as Error).message || e).slice(0, 300);
      }
    }
    return { id: p.id, model: p.models.quick, ok, status: ok ? 200 : 0, ms: Date.now() - t0, detail };
  }));
  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
