// A fake OpenAI-compatible server standing in for Gemini, Groq and OpenRouter in tests.
// POST /__mode {gemini:"ok"|"429"|"500"|"tools"|"slowfail", ...} sets behaviour.
import http from "node:http";
const mode = { gemini: "ok", groq: "ok", openrouter: "ok" };
// (hgPolls / mdPolls count status checks for the fake media jobs)
const seen = [];
const sse = (res, chunks) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end("data: [DONE]\n\n");
};
http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    if (req.url === "/__mode") { Object.assign(mode, JSON.parse(b || "{}")); return res.end("ok"); }
    if (req.url.startsWith("/v23.0/ads_archive")) {      // fake Meta Ad Library
      const u = new URL(req.url, "http://x");
      seen.push({ prov: "meta", q: u.searchParams.get("search_terms"), countries: u.searchParams.get("ad_reached_countries"), auth: req.headers.authorization });
      if (mode.meta === "expired") { res.writeHead(400); return res.end(JSON.stringify({ error: { message: "Session has expired", code: 190 } })); }
      return res.end(JSON.stringify({ data: [{ id: "1", page_name: "Bean Co", ad_creative_bodies: ["Fresh roast, 20% off"], ad_creative_link_titles: ["Shop now"], ad_delivery_start_time: "2026-10-01", publisher_platforms: ["facebook", "instagram"], ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=1" }] }));
    }
    // ---- fake HeyGen ----
    if (req.url.startsWith("/hg/")) {
      seen.push({ prov: "heygen", method: req.method, url: req.url, key: req.headers["x-api-key"], body: b ? JSON.parse(b) : null });
      if (req.method === "POST") return res.end(JSON.stringify({ data: { video_id: "vid1", status: "waiting" } }));
      mode.hgPolls = (mode.hgPolls || 0) + 1;
      return res.end(JSON.stringify({ data: mode.hgPolls < 2 ? { status: "processing" } : { status: "completed", video_url: "http://localhost:4010/files/v.mp4", thumbnail_url: "http://localhost:4010/files/d.png", duration: 12 } }));
    }
    // ---- fake Higgsfield ----
    if (req.url.startsWith("/hf/")) {
      const body = b ? JSON.parse(b) : null;
      seen.push({ prov: "higgsfield", method: req.method, url: req.url, auth: req.headers.authorization, idem: req.headers["idempotency-key"] || null, body });
      if (req.method === "POST") {
        const id = req.url.includes("image-to-video") ? "vid_hf" : `img_${(mode.hfImgs = (mode.hfImgs || 0) + 1)}`;
        return res.end(JSON.stringify({ status: "queued", request_id: id, status_url: `http://localhost:4010/hf/requests/${id}/status` }));
      }
      const id = req.url.split("/")[3]; mode.hfPolls = mode.hfPolls || {}; mode.hfPolls[id] = (mode.hfPolls[id] || 0) + 1;
      if (id.startsWith("0000")) { res.writeHead(404); return res.end("{}"); }
      if (mode.hfPolls[id] < 2) return res.end(JSON.stringify({ status: "in_progress", request_id: id }));
      return res.end(JSON.stringify(id === "vid_hf" ? { status: "completed", request_id: id, video: { url: "http://localhost:4010/files/c.mp4" } } : { status: "completed", request_id: id, images: [{ url: `http://localhost:4010/files/${id}.png` }] }));
    }
    // ---- fake Moda ----
    if (req.url.startsWith("/moda/")) {
      const body = b ? JSON.parse(b) : null;
      seen.push({ prov: "moda", method: req.method, url: req.url, auth: req.headers.authorization, ver: req.headers["moda-version"], body });
      if (req.url === "/moda/tasks" && req.method === "POST") {
        if (body.format.category === "social") { res.writeHead(400); return res.end(JSON.stringify({ error: { message: "Unknown format category 'social'" } })); }
        return res.end(JSON.stringify({ id: "task_1", status: "queued" }));
      }
      if (req.url.startsWith("/moda/tasks/")) { mode.mdPolls = (mode.mdPolls || 0) + 1; return res.end(JSON.stringify(mode.mdPolls < 2 ? { id: "task_1", status: "running" } : { id: "task_1", status: "succeeded", result: { canvas_id: "cv_9" } })); }
      if (req.url.startsWith("/moda/canvases/cv_9/export")) return res.end(JSON.stringify({ status: "completed", url: "http://localhost:4010/files/d.png" }));
    }
    if (req.url.startsWith("/files/")) {
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      res.writeHead(200, { "content-type": req.url.endsWith(".png") ? "image/png" : "video/mp4", "access-control-allow-origin": "*" }); return res.end(png);
    }
    if (req.url === "/__seen") { res.end(JSON.stringify(seen)); seen.length = 0; return; }
    const prov = req.url.split("/")[1];
    const body = JSON.parse(b || "{}");
    if (req.url.endsWith("/v1/agent")) {             // Perplexity Agent API format
      seen.push({ prov, agent: true, model: body.model, search: JSON.stringify(body.tools || []).includes("web_search"), instr: (body.instructions || "").slice(0, 20), input: body.input });
      const m = mode[prov];
      if (m === "429") { res.writeHead(429); return res.end('{"error":{"message":"rate limit"}}'); }
      if (m === "fail") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`data: ${JSON.stringify({ type: "response.failed", error: { message: "boom" } })}\n\n`); return res.end(); }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
      ev({ type: "response.created", response: {} });
      ev({ type: "response.reasoning.search_queries", queries: ["x"] });
      ev({ type: "response.output_text.delta", delta: "Hello from " });
      ev({ type: "response.output_text.delta", delta: "perplexity." });
      ev({ type: "response.completed", response: { usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25, cost: { currency: "USD", input_cost: 0.000005, output_cost: 0.0000125, total_cost: 0.0057 } } } });
      return res.end();
    }
    seen.push({ prov, auth: req.headers.authorization, model: body.model, tools: (body.tools || []).length, hasTool: body.messages.some((m) => m.role === "tool"), json: !!body.response_format, sys: body.messages[0].content.slice(0, 20), img: JSON.stringify(body.messages).includes("image_url"), toolNames: (body.tools || []).map((t) => t.function.name), sysHasAds: body.messages[0].content.includes("find_live_ads"), re: body.reasoning_effort || null, mtc: "max_completion_tokens" in body, url: req.url });
    const m = mode[prov];
    if (m === "noreason" && body.reasoning_effort) { res.writeHead(400); return res.end('{"error":{"message":"reasoning_effort is not supported for this model"}}'); }
    if (m === "429") { res.writeHead(429, { "retry-after": "3600" }); return res.end("{}"); }
    if (m === "500") { res.writeHead(500); return res.end("boom"); }
    const toolNames = (body.tools || []).map((t) => t.function.name);
    for (const [md, tn, args] of [["makevideo", "make_presenter_video", '{"script":"Hi! Our summer sale starts today.","title":"Summer sale promo","aspect":"9:16"}'], ["makedesign", "make_designed_graphic", '{"prompt":"Instagram post for Bean Co summer sale, 20% off","title":"Summer sale post","size":"post"}'], ["makeshot", "make_product_shot", '{"prompt":"Bean Co iced latte on a marble counter, morning light","title":"Iced latte shot","aspect":"3:4"}'], ["makeclip", "make_motion_clip", '{"scene":"Bean Co iced latte on a marble counter","motion":"slow push-in, ice settling","title":"Latte clip"}']]) {
      if (m === md && toolNames.includes(tn)) {
        const tm = body.messages.find((x) => x.role === "tool");
        if (!tm) return sse(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "mk1", function: { name: tn, arguments: args } }] } }] }, { choices: [], usage: { prompt_tokens: 30, completion_tokens: 5 } }]);
        const r = JSON.parse(tm.content);
        return sse(res, [{ choices: [{ delta: { content: r.ok ? "On it! It'll appear in the tray shortly." : `Couldn't start: ${r.error}` } }] }, { choices: [], usage: { prompt_tokens: 50, completion_tokens: 9 } }]);
      }
    }
    if (m === "liveads" && toolNames.includes("find_live_ads")) {
      const toolMsg = body.messages.find((x) => x.role === "tool");
      if (!toolMsg) return sse(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "la1", function: { name: "find_live_ads", arguments: '{"query":"Bean Co","countries":["DE"]}' } }] } }] }, { choices: [], usage: { prompt_tokens: 30, completion_tokens: 5 } }]);
      const r = JSON.parse(toolMsg.content);
      return sse(res, [{ choices: [{ delta: { content: r.ok ? `Live ads: ${r.ads[0].page} says "${r.ads[0].text}"` : `No live ads (${r.error})` } }] }, { choices: [], usage: { prompt_tokens: 60, completion_tokens: 9 } }]);
    }
    if (m === "tools" && !body.messages.some((x) => x.role === "tool"))
      return sse(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "add_posts", arguments: '{"posts":[{"ti' } }] } }] },
                       { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tle":"Hi"}]}' } }] } }] }]);
    if (m === "slowfail") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Half" } }] })}\n\n`); return setTimeout(() => res.destroy(), 50); }
    const wantJson = body.response_format || /Return JSON/.test(JSON.stringify(body.messages.slice(1)));
    const text = wantJson ? '```json\n{"ok":true,"from":"' + prov + '"}\n```' : `Hello from ${prov}. Here are ideas.`;
    sse(res, [{ choices: [{ delta: { content: text.slice(0, 8) } }] }, { choices: [{ delta: { content: text.slice(8) } }] }, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } }]);
  });
}).listen(4010, () => console.log("fake ai on 4010"));
