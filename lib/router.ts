// Picks the first free AI that is up and can do the job, streams its answer,
// and quietly moves to the next one if it is out of quota or failing.
import { PROVIDERS, Provider, ProviderId, Tier, hasKey, GEMINI_FREE_BLOCKED, LIMITS, FLUXY_SYSTEM } from "./config";
import { getStore, Store } from "./store";

export type Msg =
  | { role: "system" | "user" | "assistant"; content: string | Part[]; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };
export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolDef = { name: string; description?: string; inputSchema?: unknown };

export type SampleReq = {
  requestId: string; tier: Tier; messages: Msg[]; tools?: ToolDef[]; json?: boolean; stick?: ProviderId;
};

export type Ev =
  | { t: "text"; v: string }
  | { t: "tool_calls"; calls: { id: string; name: string; args: string }[] }
  | { t: "done"; route: ProviderId; usage?: { in?: number; out?: number } }
  | { t: "error"; code: "rate_limited" | "bad_request" | "unavailable" };

const hasImages = (m: Msg[]) => m.some((x) => Array.isArray(x.content) && x.content.some((p) => p.type === "image_url"));
const countImages = (m: Msg[]) => m.reduce((n, x) => n + (Array.isArray(x.content) ? x.content.filter((p) => p.type === "image_url").length : 0), 0);

export function candidates(req: SampleReq, cooling: Map<ProviderId, number>, country: string | null): Provider[] {
  const needTools = !!(req.tools && req.tools.length);
  const needImages = hasImages(req.messages);
  let list = PROVIDERS.filter((p) =>
    hasKey(p) &&
    !cooling.has(p.id) &&
    (!needTools || p.can.tools) &&
    (!needImages || (p.can.images && countImages(req.messages) <= p.maxImages)) &&
    !(p.id === "gemini" && country && GEMINI_FREE_BLOCKED.has(country.toUpperCase())));
  // A tool conversation stays on the AI it started with, if that AI is still usable.
  if (req.stick) list = [...list.filter((p) => p.id === req.stick), ...list.filter((p) => p.id !== req.stick)];
  return list;
}

// When a provider says "limit reached", how long to skip it.
export function cooldownUntil(p: ProviderId, res: Response | null, now = Date.now()): number {
  const ra = res?.headers.get("retry-after");
  if (ra && /^\d+$/.test(ra)) return now + Math.min(Number(ra), 24 * 3600) * 1000;
  if (p === "gemini") {
    // Gemini free quotas reset at midnight Pacific time.
    const pt = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const toMidnight = (24 * 3600 - (pt.getHours() * 3600 + pt.getMinutes() * 60 + pt.getSeconds())) * 1000;
    return now + Math.max(toMidnight, 60_000);
  }
  return now + 60 * 60 * 1000;
}

function body(p: Provider, req: SampleReq) {
  const sys: Msg = { role: "system", content: FLUXY_SYSTEM + (req.json ? " Reply with valid JSON only, no code fences." : "") };
  const b: Record<string, unknown> = {
    model: p.models[req.tier],
    messages: [sys, ...req.messages],
    stream: true,
    max_tokens: LIMITS.maxOutputTokens[req.tier],
  };
  if (p.id !== "openrouter") b.stream_options = { include_usage: true };
  if (req.json && p.can.json && !(req.tools && req.tools.length)) b.response_format = { type: "json_object" };
  if (req.tools && req.tools.length)
    b.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description || "", parameters: t.inputSchema || { type: "object", properties: {} } },
    }));
  return b;
}

class Fail extends Error { constructor(public kind: "quota" | "down" | "bad", public res: Response | null, msg: string) { super(msg); } }

async function* callOne(p: Provider, req: SampleReq, signal: AbortSignal): AsyncGenerator<Ev, { in?: number; out?: number }> {
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env[p.keyEnv]}`, ...(p.extraHeaders || {}) },
      body: JSON.stringify(body(p, req)),
      signal,
    });
  } catch (e) {
    throw new Fail("down", null, `network: ${(e as Error).message}`);
  }
  if (res.status === 429) throw new Fail("quota", res, "rate limited");
  if (!res.ok || !res.body) {
    const why = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 400 || res.status === 413 || res.status === 422) throw new Fail("bad", res, `rejected ${res.status}: ${why}`);
    throw new Fail("down", res, `status ${res.status}: ${why}`);
  }

  const calls = new Map<number, { id: string; name: string; args: string }>();
  let usage: { in?: number; out?: number } = {};
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let j: any;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Fail(j.error.code === 429 ? "quota" : "down", null, String(j.error.message || "stream error"));
      if (j.usage) usage = { in: j.usage.prompt_tokens, out: j.usage.completion_tokens };
      const d = j.choices?.[0]?.delta;
      if (!d) continue;
      if (typeof d.content === "string" && d.content) yield { t: "text", v: d.content };
      for (const tc of d.tool_calls || []) {
        const k = typeof tc.index === "number" ? tc.index : calls.size;
        const cur = calls.get(k) || { id: tc.id || `call_${k}`, name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(k, cur);
      }
    }
  }
  if (calls.size) yield { t: "tool_calls", calls: [...calls.values()] };
  return usage;
}

export async function* route(req: SampleReq, opts: { label: string; country: string | null; signal: AbortSignal; store?: Store }): AsyncGenerator<Ev> {
  const store = opts.store || getStore();
  let cooling: Map<ProviderId, number>;
  try { cooling = await store.coolingDown(); } catch { cooling = new Map(); }
  const list = candidates(req, cooling, opts.country);
  if (!list.length) { yield { t: "error", code: "rate_limited" }; return; }

  let sawBadRequest = false;
  for (const p of list) {
    let sent = false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LIMITS.requestTimeoutMs);
    const onAbort = () => ctl.abort();
    opts.signal.addEventListener("abort", onAbort);
    try {
      const gen = callOne(p, req, ctl.signal);
      let r = await gen.next();
      while (!r.done) { sent = true; yield r.value; r = await gen.next(); }
      await store.record({ requestId: req.requestId, label: opts.label, provider: p.id, model: p.models[req.tier], tier: req.tier, status: "ok", inputTokens: r.value.in, outputTokens: r.value.out }).catch(() => {});
      yield { t: "done", route: p.id, usage: r.value };
      return;
    } catch (e) {
      const f = e instanceof Fail ? e : new Fail("down", null, String(e));
      console.warn(`[fluxy] ${p.id} ${f.kind}: ${f.message.slice(0, 200)}`);
      if (f.kind === "quota") await store.coolDown(p.id, cooldownUntil(p.id, f.res), "rate_limited").catch(() => {});
      else if (f.kind === "down") await store.coolDown(p.id, Date.now() + 30_000, "failing").catch(() => {});
      else sawBadRequest = true;
      await store.record({ requestId: req.requestId, label: opts.label, provider: p.id, model: p.models[req.tier], tier: req.tier, status: sent ? "failed" : "fell_through", errorCode: f.message.slice(0, 120) }).catch(() => {});
      if (opts.signal.aborted) return;
      if (sent) { yield { t: "error", code: "unavailable" }; return; } // can't silently switch mid-answer
    } finally {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onAbort);
    }
  }
  yield { t: "error", code: sawBadRequest ? "bad_request" : "rate_limited" };
}
