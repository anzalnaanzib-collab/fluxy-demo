// Fake OpenAI-compatible AI servers for testing Fluxy without real keys.
//   node tests/mock-ai.mjs 4010
// Each engine lives under its own path: /gemini, /groq, /openrouter.
// POST /__mode {"gemini":"ok|rate|down|empty|break"} changes how an engine behaves.
// GET  /__log returns the calls received; POST /__reset clears it.
import http from "node:http";

const port = Number(process.argv[2] || 4010);
const mode = { gemini: "ok", groq: "ok", openrouter: "ok" };
let log = [];

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  let i = 0;
  const tick = () => {
    if (i < chunks.length) { res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`); setTimeout(tick, 15); }
    else { res.write("data: [DONE]\n\n"); res.end(); }
  };
  tick();
}
const textChunks = (text) =>
  text.match(/.{1,12}/gs).map((piece) => ({ choices: [{ index: 0, delta: { content: piece } }] }))
    .concat([{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 42, completion_tokens: 7 } }]);

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/__mode" && req.method === "POST") { Object.assign(mode, JSON.parse(body || "{}")); return send(res, 200, mode); }
    if (req.url === "/__log") return send(res, 200, log);
    if (req.url === "/__reset") { log = []; Object.assign(mode, { gemini: "ok", groq: "ok", openrouter: "ok" }); return send(res, 200, { ok: true }); }
    const m = req.url.match(/^\/(gemini|groq|openrouter)\/chat\/completions$/);
    if (!m) return send(res, 404, { error: "not found" });
    const engine = m[1];
    let j = {};
    try { j = JSON.parse(body); } catch { /* bad body */ }
    const auth = req.headers.authorization || "";
    const msgs = j.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const lastText = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
    log.push({ engine, model: j.model, tools: (j.tools || []).length, json: !!j.response_format, hasImage: /image_url/.test(JSON.stringify(msgs)), system: msgs[0]?.role === "system", lastRole: last.role });
    if (!auth.startsWith("Bearer test-")) return send(res, 401, { error: { message: "bad key" } });
    const md = mode[engine];
    if (md === "rate") return send(res, 429, { error: { message: "Quota exceeded for requests per day" } }, { "retry-after": "120" });
    if (md === "down") return send(res, 503, { error: { message: "overloaded" } });
    if (md === "empty") return sse(res, [{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]);
    if (md === "break") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Half an ans" } }] })}\n\n`);
      return setTimeout(() => res.destroy(), 30);
    }
    // Tool flow: ask for the first tool once, then answer after seeing its result.
    if ((j.tools || []).length && last.role !== "tool" && /\badd\b/i.test(lastText.split("USER:").pop())) {
      const name = j.tools[0].function.name;
      return sse(res, [
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: '{"title":' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Summer sale"}' } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]);
    }
    if (last.role === "tool") return sse(res, textChunks(`Done (${engine}): the tool said ${last.content}`));
    if (/JSON only/.test(lastText)) return sse(res, textChunks('```json\n{"ok":true,"engine":"' + engine + '"}\n```'));
    return sse(res, textChunks(`Hello from ${engine}! Here are three caption ideas for your brand.`));
  });
}).listen(port, () => console.log("mock ai on", port));
