// Picks the first free AI that is up and can do the job, streams its answer,
// and quietly moves to the next one if it is out of quota or failing.
import { PROVIDERS, Provider, ProviderId, Tier, hasKey, GEMINI_FREE_BLOCKED, LIMITS, FLUXY_SYSTEM, PAID_CAP_USD, micros, costMicros } from "./config";
import { getStore, Store } from "./store";
import { LIVE_ADS_TOOL, LIVE_ADS_NOTE, liveAdsOn, liveAdsToolDef, isResearchPage, searchLiveAds } from "./liveads";
import { VIDEO_TOOL, DESIGN_TOOL, MEDIA_NOTE, videoToolDef, designToolDef, heygenOn, modaOn, startVideo, startDesign } from "./media";

export type Msg =
  | { role: "system" | "user" | "assistant"; content: string | Part[]; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };
export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolDef = { name: string; description?: string; inputSchema?: unknown };

export type SampleReq = {
  requestId: string; tier: Tier; messages: Msg[]; tools?: ToolDef[]; json?: boolean; stick?: ProviderId;
  page?: string;            // Fluxus screen the question came from, e.g. "research"
};

// Fluxy's own hidden abilities, run on the server (only AIs that can use tools):
// live ads on research screens; presenter videos and designed graphics anywhere, when asked.
const wantsLiveAds = (p: Provider, req: SampleReq) => p.can.tools && p.api !== "pplx-agent" && liveAdsOn() && isResearchPage(req.page);
function internalTools(p: Provider, req: SampleReq): { defs: ToolDef[]; note: string } {
  if (!p.can.tools || p.api === "pplx-agent") return { defs: [], note: "" };
  const defs: ToolDef[] = [];
  let note = "";
  if (wantsLiveAds(p, req)) { defs.push(liveAdsToolDef); note += LIVE_ADS_NOTE; }
  const media = [heygenOn() && videoToolDef, modaOn() && designToolDef].filter(Boolean) as ToolDef[];
  if (media.length) { defs.push(...media); note += MEDIA_NOTE; }
  return { defs, note };
}
const INTERNAL = new Set([LIVE_ADS_TOOL, VIDEO_TOOL, DESIGN_TOOL]);
const MAX_LIVE_AD_STEPS = 2;

export type Ev =
  | { t: "text"; v: string }
  | { t: "tool_calls"; calls: { id: string; name: string; args: string }[] }
  | { t: "done"; route: ProviderId; usage?: { in?: number; out?: number } }
  | { t: "media"; job: string; kind: "video" | "design"; title: string }
  | { t: "error"; code: "rate_limited" | "bad_request" | "unavailable" };

const hasImages = (m: Msg[]) => m.some((x) => Array.isArray(x.content) && x.content.some((p) => p.type === "image_url"));
const countImages = (m: Msg[]) => m.reduce((n, x) => n + (Array.isArray(x.content) ? x.content.filter((p) => p.type === "image_url").length : 0), 0);

export function candidates(req: SampleReq, cooling: Map<ProviderId, number>, country: string | null, allowPaid = false): Provider[] {
  const needTools = !!(req.tools && req.tools.length);
  const needImages = hasImages(req.messages);
  let list = PROVIDERS.filter((p) =>
    hasKey(p) &&
    (!p.paid || allowPaid) &&
    !cooling.has(p.id) &&
    (!needTools || p.can.tools) &&
    (!needImages || (p.can.images && countImages(req.messages) <= p.maxImages)) &&
    !(p.id === "gemini" && country && GEMINI_FREE_BLOCKED.has(country.toUpperCase())));
  // A tool conversation stays on the AI it started with, if that AI is still usable.
  if (req.stick) list = [...list.filter((p) => p.id === req.stick), ...list.filter((p) => p.id !== req.stick)];
  // Free AIs always before paid ones (a sticky paid AI still comes after any free one that's back).
  list = [...list.filter((p) => !p.paid), ...list.filter((p) => p.paid)];
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

// Perplexity Agent API: plain text messages in, live web search on.
function pplxBody(p: Provider, req: SampleReq) {
  const text = (c: Msg["content"]) => (typeof c === "string" ? c : c.map((x) => (x.type === "text" ? x.text : "")).join("\n"));
  const input = req.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ type: "message", role: m.role, content: text(m.content) }))
    .filter((m) => m.content);
  return {
    model: p.models[req.tier],
    instructions: FLUXY_SYSTEM + (req.json ? " Reply with valid JSON only, no code fences." : ""),
    input,
    tools: [{ type: "web_search" }],
    max_output_tokens: LIMITS.maxOutputTokens[req.tier],
    stream: true,
  };
}

// Providers that rejected reasoning_effort once: don't send it again (until the server restarts).
const noReasoning = new Set<ProviderId>();

export function body(p: Provider, req: SampleReq) {
  if (p.api === "pplx-agent") return pplxBody(p, req);
  const extra = internalTools(p, req);
  const sys: Msg = { role: "system", content: FLUXY_SYSTEM + extra.note + (req.json ? " Reply with valid JSON only, no code fences." : "") };
  const b: Record<string, unknown> = {
    model: p.models[req.tier],
    messages: [sys, ...req.messages],
    stream: true,
  };
  b[p.maxTokensField || "max_tokens"] = LIMITS.maxOutputTokens[req.tier];
  if (p.id !== "openrouter" && p.id !== "perplexity") b.stream_options = { include_usage: true };
  if (p.reasoningEffort && p.reasoningEffort !== "off" && !noReasoning.has(p.id)) b.reasoning_effort = p.reasoningEffort;
  const allTools = [...(req.tools || []), ...extra.defs];
  if (req.json && p.can.json && !allTools.length) b.response_format = { type: "json_object" };
  if (allTools.length)
    b.tools = allTools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description || "", parameters: t.inputSchema || { type: "object", properties: {} } },
    }));
  return b;
}

// Worst-case input size for the cap: ~3 characters per token, ~1,600 tokens per image.
export function estimateInputTokens(req: SampleReq): number {
  const text = JSON.stringify(req.messages).replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "") + JSON.stringify(req.tools || []) + FLUXY_SYSTEM;
  return Math.ceil(text.length / 3) + countImages(req.messages) * 1600 + 50;
}

class Fail extends Error { constructor(public kind: "quota" | "down" | "bad", public res: Response | null, msg: string) { super(msg); } }

export async function* callOne(p: Provider, req: SampleReq, signal: AbortSignal): AsyncGenerator<Ev, { in?: number; out?: number; costUsd?: number }> {
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}${p.path || "/chat/completions"}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env[p.keyEnv]}`, ...(p.extraHeaders || {}) },
      body: JSON.stringify(body(p, req)),
      signal,
    });
  } catch (e) {
    throw new Fail("down", null, `network: ${(e as Error).message}`);
  }
  if (res.status === 429) throw new Fail("quota", res, "limit reached (429): " + (await res.text().catch(() => "")).slice(0, 300));
  if (!res.ok || !res.body) {
    const why = (await res.text().catch(() => "")).slice(0, 300);
    if ((res.status === 400 || res.status === 422) && /reasoning|thinking/i.test(why) && !noReasoning.has(p.id) && p.reasoningEffort) {
      // This model doesn't accept the "think less" setting: remember that and retry once without it.
      noReasoning.add(p.id);
      return yield* callOne(p, req, signal);
    }
    if (res.status === 400 || res.status === 413 || res.status === 422) throw new Fail("bad", res, `rejected ${res.status}: ${why}`);
    throw new Fail("down", res, `status ${res.status}: ${why}`);
  }

  const calls = new Map<number, { id: string; name: string; args: string }>();
  let usage: { in?: number; out?: number; costUsd?: number } = {};
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
      if (p.api === "pplx-agent") {
        if (j.type === "response.output_text.delta" && typeof j.delta === "string" && j.delta) yield { t: "text", v: j.delta };
        else if (j.type === "response.completed") {
          const u = j.response?.usage;
          if (u) usage = { in: u.input_tokens, out: u.output_tokens, costUsd: typeof u.cost?.total_cost === "number" ? u.cost.total_cost : undefined };
        } else if (j.type === "response.failed" || j.type === "error") {
          const msg = String(j.error?.message || j.response?.error?.message || "agent error");
          throw new Fail(/rate|quota|429/i.test(msg) ? "quota" : "down", null, msg);
        }
        continue;
      }
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
  const capMicros = micros(PAID_CAP_USD);
  const allowPaid = capMicros > 0 && store.reliable;
  let list = candidates(req, cooling, opts.country, allowPaid);
  // No tool-capable AI left? Answer as plain text instead of falling back to the demo.
  if (req.tools && req.tools.length) {
    const plain = candidates({ ...req, tools: undefined }, cooling, opts.country, allowPaid).filter((p) => !list.includes(p));
    list = [...list.filter((p) => !p.paid), ...plain.filter((p) => !p.paid), ...list.filter((p) => p.paid), ...plain.filter((p) => p.paid)];
  }
  if (!list.length) { yield { t: "error", code: "rate_limited" }; return; }

  let sawBadRequest = false, capHit = false;
  for (const p of list) {
    let sent = false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LIMITS.requestTimeoutMs);
    const onAbort = () => ctl.abort();
    opts.signal.addEventListener("abort", onAbort);
    const thisReq = req.tools && req.tools.length && !p.can.tools ? { ...req, tools: undefined } : req;
    let est = 0;
    try {
      if (p.paid) {
        // Hold the worst-case cost first; skip this AI if it would pass the monthly cap.
        // A research answer may take extra steps (live-ads lookups): hold enough for all of them.
        const steps = internalTools(p, thisReq).defs.length ? 1 + MAX_LIVE_AD_STEPS : 1;
        est = costMicros(p, estimateInputTokens(thisReq) + 3000 * (steps - 1), LIMITS.maxOutputTokens[req.tier]) * steps;
        let ok = false;
        try { ok = await store.paidReserve({ requestId: req.requestId, provider: p.id, model: p.models[req.tier], label: opts.label, tier: req.tier, est, cap: capMicros }); } catch (e) { console.warn(`[fluxy] ledger error: ${String((e as Error)?.message || e).slice(0, 200)}`); }
        if (!ok) { capHit = true; continue; }
      }
      // Run the answer. If the AI asks for live ads, fetch them here on the server and let it continue;
      // Fluxus only ever sees the finished text (and its own tool calls).
      let stepReq = thisReq;
      const total: { in?: number; out?: number; costUsd?: number } = {};
      const add = (u: { in?: number; out?: number; costUsd?: number }) => {
        if (u.in != null) total.in = (total.in || 0) + u.in;
        if (u.out != null) total.out = (total.out || 0) + u.out;
        if (u.costUsd != null) total.costUsd = (total.costUsd || 0) + u.costUsd;
      };
      for (let step = 0; ; step++) {
        const gen = callOne(p, stepReq, ctl.signal);
        let calls: { id: string; name: string; args: string }[] = [];
        let r = await gen.next();
        while (!r.done) {
          if (r.value.t === "tool_calls") calls = r.value.calls;
          else { sent = true; yield r.value; }
          r = await gen.next();
        }
        add(r.value);
        const internal = calls.filter((c) => INTERNAL.has(c.name));
        const client = calls.filter((c) => !INTERNAL.has(c.name));
        if (!internal.length || step >= MAX_LIVE_AD_STEPS) {
          if (client.length) { sent = true; yield { t: "tool_calls", calls: client }; }
          break;
        }
        const results: unknown[] = [];
        for (const c of internal) {
          let a: Record<string, unknown> = {};
          try { a = JSON.parse(c.args || "{}"); } catch {}
          if (c.name === LIVE_ADS_TOOL) { results.push(await searchLiveAds({ query: a.query as string, countries: a.countries as string[] })); continue; }
          const idem = `${req.requestId}:${c.id}`;
          const started = c.name === VIDEO_TOOL ? await startVideo(a as { script?: string }, idem) : await startDesign(a as { prompt?: string }, idem);
          if (started.ok) {
            sent = true; // a job has started: never silently retry this answer on another AI
            yield { t: "media", job: started.job, kind: started.kind, title: started.title };
            results.push({ ok: true, status: "started", note: "It will appear in the Fluxy tray at the bottom right in a few minutes." });
          } else results.push(started);
        }
        stepReq = { ...stepReq, messages: [
          ...stepReq.messages,
          { role: "assistant", content: "", tool_calls: internal.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args || "{}" } })) },
          ...internal.map((c, i) => ({ role: "tool" as const, tool_call_id: c.id, content: JSON.stringify(results[i]).slice(0, 12000) })),
        ] };
      }
      const r = { value: total };
      if (p.paid) {
        const u = r.value;
        // Use the provider's own reported cost when it gives one (Perplexity does); else tokens x price; else the full hold.
        const real = typeof u.costUsd === "number" ? micros(u.costUsd) : u.in != null && u.out != null ? costMicros(p, u.in, u.out) : est;
        await store.paidSettle(req.requestId, p.id, real, u.in ?? 0, u.out ?? 0).catch((e) => console.warn(`[fluxy] settle error: ${String(e?.message || e).slice(0, 200)}`));
      }
      await store.record({ requestId: req.requestId, label: opts.label, provider: p.id, model: p.models[req.tier], tier: req.tier, status: "ok", inputTokens: r.value.in, outputTokens: r.value.out }).catch(() => {});
      yield { t: "done", route: p.id, usage: r.value };
      return;
    } catch (e) {
      const f = e instanceof Fail ? e : new Fail("down", null, String(e));
      if (p.paid && est) {
        // Partly streamed answers may still be billed: count the full hold. Otherwise free the hold.
        await (sent ? store.paidSettle(req.requestId, p.id, est, 0, 0) : store.paidRelease(req.requestId, p.id)).catch(() => {});
      }
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
  if (capHit) console.warn("[fluxy] monthly paid cap reached; paid AIs skipped");
  yield { t: "error", code: sawBadRequest ? "bad_request" : "rate_limited" };
}
