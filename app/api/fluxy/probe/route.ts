// POST -> owner-only: sends a tiny test question to each AI and reports exactly
// what came back (status and the provider's error text), so problems are visible.
import { PROVIDERS, hasKey, FLUXY_SYSTEM } from "@/lib/config";
import { readSession } from "@/lib/session";
import { body as chatBody } from "@/lib/router";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const s = readSession(req);
  if (!s || s.role !== "owner") return Response.json({ error: "not_granted" }, { status: 403 });
  const results = await Promise.all(PROVIDERS.map(async (p) => {
    if (!hasKey(p)) return { id: p.id, ok: false, status: 0, detail: "No key added in Vercel settings" };
    const t0 = Date.now();
    try {
      const r = await fetch(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env[p.keyEnv]}`, ...(p.extraHeaders || {}) },
        body: JSON.stringify({ model: p.models.quick, max_tokens: 20, messages: [{ role: "system", content: FLUXY_SYSTEM }, { role: "user", content: "Say hi in 3 words." }] }),
        signal: AbortSignal.timeout(25_000),
      });
      const text = await r.text();
      let detail = text.slice(0, 400);
      try { const j = JSON.parse(text); detail = r.ok ? (j.choices?.[0]?.message?.content || "(empty answer)") : JSON.stringify(j.error || j).slice(0, 400); } catch {}
      // Second test: the same kind of request Fluxus's chat sends (streaming, with a tool).
      const chatReq = { requestId: "probe", tier: "default" as const, messages: [{ role: "user" as const, content: "Add one post titled Hello to the calendar." }],
        tools: p.can.tools ? [{ name: "add_posts", description: "Add posts to the calendar", inputSchema: { type: "object", properties: { posts: { type: "array", items: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } } }, required: ["posts"] } }] : undefined };
      let chat = "";
      try {
        const c = await fetch(`${p.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${process.env[p.keyEnv]}`, ...(p.extraHeaders || {}) },
          body: JSON.stringify(chatBody(p, chatReq)),
          signal: AbortSignal.timeout(30_000),
        });
        const ct = await c.text();
        chat = c.ok ? `chat test OK (${p.models.default}): ` + (ct.includes("tool_calls") ? "used the tool" : ct.includes("content") ? "answered" : "empty") : `chat test FAILED ${c.status} (${p.models.default}): ` + ct.slice(0, 300);
      } catch (e) { chat = "chat test could not connect: " + String((e as Error).message); }
      return { id: p.id, model: p.models.quick, ok: r.ok && chat.startsWith("chat test OK"), status: r.status, ms: Date.now() - t0, detail: detail + "  |  " + chat };
    } catch (e) {
      return { id: p.id, model: p.models.quick, ok: false, status: 0, ms: Date.now() - t0, detail: "Could not connect: " + String((e as Error).message) };
    }
  }));
  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
