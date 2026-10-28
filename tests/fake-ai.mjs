// A fake OpenAI-compatible server standing in for Gemini, Groq and OpenRouter in tests.
// POST /__mode {gemini:"ok"|"429"|"500"|"tools"|"slowfail", ...} sets behaviour.
import http from "node:http";
const mode = { gemini: "ok", groq: "ok", openrouter: "ok" };
const seen = [];
const sse = (res, chunks) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end("data: [DONE]\n\n");
};
http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    if (req.url === "/__mode") { Object.assign(mode, JSON.parse(b || "{}")); return res.end("ok"); }
    if (req.url === "/__seen") { res.end(JSON.stringify(seen)); seen.length = 0; return; }
    const prov = req.url.split("/")[1];
    const body = JSON.parse(b || "{}");
    seen.push({ prov, auth: req.headers.authorization, model: body.model, tools: (body.tools || []).length, hasTool: body.messages.some((m) => m.role === "tool"), json: !!body.response_format, sys: body.messages[0].content.slice(0, 20), img: JSON.stringify(body.messages).includes("image_url") });
    const m = mode[prov];
    if (m === "429") { res.writeHead(429, { "retry-after": "3600" }); return res.end("{}"); }
    if (m === "500") { res.writeHead(500); return res.end("boom"); }
    if (m === "tools" && !body.messages.some((x) => x.role === "tool"))
      return sse(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "add_posts", arguments: '{"posts":[{"ti' } }] } }] },
                       { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tle":"Hi"}]}' } }] } }] }]);
    if (m === "slowfail") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Half" } }] })}\n\n`); return setTimeout(() => res.destroy(), 50); }
    const wantJson = body.response_format || /Return JSON/.test(JSON.stringify(body.messages.slice(1)));
    const text = wantJson ? '```json\n{"ok":true,"from":"' + prov + '"}\n```' : `Hello from ${prov}. Here are ideas.`;
    sse(res, [{ choices: [{ delta: { content: text.slice(0, 8) } }] }, { choices: [{ delta: { content: text.slice(8) } }] }, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } }]);
  });
}).listen(4010, () => console.log("fake ai on 4010"));
