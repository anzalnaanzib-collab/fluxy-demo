/* Fluxy bridge. Loaded only by the duplicate copy of Fluxus, before Fluxus's
 * own code. It provides the same `window.claude.use("sample")` interface
 * Fluxus already calls, backed by the Fluxy server, which picks a free AI.
 * It never shows which AI answered. If a real window.claude exists (inside
 * Claude), it does nothing. */
(function () {
  "use strict";
  if (window.claude && typeof window.claude.use === "function") return;

  var API = "/api/fluxy";
  var MAX_TOOL_STEPS = 6;
  var limitsCache = null, limitsAt = 0;

  function fail(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function abortError() { try { return new DOMException("Aborted", "AbortError"); } catch (_) { var e = new Error("Aborted"); e.name = "AbortError"; return e; } }
  function rid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); }

  /* ---------- messages ---------- */
  function toImageUrl(img) {
    if (!img) return null;
    if (typeof img === "string") return /^data:image\//.test(img) ? img : null;
    if (img.url && /^data:image\//.test(img.url)) return img.url;
    var data = img.data || img.base64 || img.source && img.source.data;
    var type = img.mediaType || img.media_type || img.type || (img.source && img.source.media_type) || "image/png";
    return data ? "data:" + type + ";base64," + String(data).replace(/^data:[^,]+,/, "") : null;
  }
  function textOf(c) {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map(function (p) { return typeof p === "string" ? p : p && p.text || ""; }).join("\n");
    return String(c == null ? "" : c);
  }
  function buildMessages(input, images) {
    var msgs = typeof input === "string"
      ? [{ role: "user", content: input }]
      : (Array.isArray(input) ? input : [input]).map(function (m) {
          var role = m && m.role === "assistant" ? "assistant" : "user";
          return { role: role, content: textOf(m && m.content) };
        });
    var urls = (images || []).map(toImageUrl).filter(Boolean);
    if (urls.length) {
      for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") {
        msgs[i] = { role: "user", content: [{ type: "text", text: textOf(msgs[i].content) }].concat(urls.map(function (u) { return { type: "image_url", image_url: { url: u } }; })) };
        break;
      }
    }
    return msgs;
  }

  /* ---------- one streamed step ---------- */
  async function step(payload, signal, onDelta) {
    var res;
    try {
      res = await fetch(API + "/sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: signal, credentials: "same-origin" });
    } catch (e) {
      if (signal && signal.aborted) throw abortError();
      throw fail("unavailable", "network");
    }
    if (res.status === 401) { showGate(); throw fail("not_granted"); }
    if (res.status === 429) {
      var j = await res.json().catch(function () { return {}; });
      if (j.error === "daily_limit") toast("That's today's demo limit. Fluxy will be back tomorrow.", "warn");
      throw fail("rate_limited");
    }
    if (!res.ok || !res.body) throw fail(res.status === 400 || res.status === 413 ? "bad_request" : "unavailable");

    var reader = res.body.getReader(), dec = new TextDecoder(), buf = "", text = "", calls = [], route = null;
    for (;;) {
      var r;
      try { r = await reader.read(); } catch (e) { if (signal && signal.aborted) throw abortError(); throw fail("unavailable"); }
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      var i;
      while ((i = buf.indexOf("\n")) >= 0) {
        var line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        var ev; try { ev = JSON.parse(line); } catch (_) { continue; }
        if (ev.t === "text") { text += ev.v; onDelta(ev.v); }
        else if (ev.t === "tool_calls") calls = ev.calls || [];
        else if (ev.t === "done") route = ev.route;
        else if (ev.t === "error") throw fail(ev.code || "unavailable");
      }
    }
    if (!route) throw fail("unavailable");
    return { text: text, calls: calls, route: route };
  }

  /* ---------- the sampler Fluxus expects ---------- */
  async function run(input, opts, json) {
    opts = opts || {};
    var signal = opts.signal;
    if (signal && signal.aborted) throw abortError();
    var tools = Array.isArray(opts.tools) ? opts.tools.filter(function (t) { return t && t.name && typeof t.execute === "function"; }) : [];
    var messages = buildMessages(input, opts.images);
    var tier = opts.modelTier === "quick" ? "quick" : "default";
    var all = "", stick, requestId = rid();

    for (var n = 0; n <= MAX_TOOL_STEPS; n++) {
      var payload = { requestId: requestId + (n ? ":" + n : ""), tier: tier, messages: messages, json: !!json && !tools.length, page: currentPage() };
      if (tools.length) payload.tools = tools.map(function (t) { return { name: t.name, description: t.description, inputSchema: t.inputSchema }; });
      if (stick) payload.stick = stick;
      var out = await step(payload, signal, function (d) {
        all += d;
        if (typeof opts.onText === "function") { try { opts.onText({ text: all, delta: d }); } catch (_) {} }
      });
      stick = out.route;
      if (!out.calls.length || n === MAX_TOOL_STEPS) return all;

      messages = messages.concat([{ role: "assistant", content: out.text || "", tool_calls: out.calls.map(function (c) {
        return { id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } };
      }) }]);
      for (var k = 0; k < out.calls.length; k++) {
        var c = out.calls[k], tool = tools.find(function (t) { return t.name === c.name; }), result;
        try {
          var args = {}; try { args = JSON.parse(c.args || "{}"); } catch (_) {}
          if (!tool) throw new Error("Unknown tool " + c.name);
          result = await tool.execute(args);
          result = typeof result === "string" ? result : JSON.stringify(result == null ? "ok" : result);
        } catch (e) {
          result = "Error: " + (e && e.message ? e.message : String(e));
        }
        messages.push({ role: "tool", tool_call_id: c.id, content: String(result).slice(0, 40000) });
      }
      if (all && !/\n$/.test(all)) all += "\n";
    }
    return all;
  }

  // Which Fluxus screen we're on (Fluxus uses #/route addresses), so research screens get live ads.
  function currentPage() { try { return (location.hash || "").replace(/^#\/?/, "").split(/[?/]/)[0].slice(0, 40); } catch (_) { return ""; } }

  function parseJson(text) {
    var t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try { return JSON.parse(t); } catch (_) {}
    var a = t.indexOf("{"), b = t.lastIndexOf("}"), c = t.indexOf("["), d = t.lastIndexOf("]");
    var cand = [];
    if (a >= 0 && b > a) cand.push(t.slice(a, b + 1));
    if (c >= 0 && d > c) cand.push(t.slice(c, d + 1));
    for (var i = 0; i < cand.length; i++) { try { return JSON.parse(cand[i]); } catch (_) {} }
    throw fail("bad_json");
  }

  function sampler(input, opts) { return run(input, opts, false).then(function (text) { return { text: text }; }); }
  sampler.json = async function (input, opts) {
    try { return parseJson(await run(input, opts, true)); }
    catch (e) {
      if (e && e.code !== "bad_json") throw e;
      var again = typeof input === "string" ? input + "\n\nReturn valid JSON only. No prose, no code fences." : input;
      return parseJson(await run(again, opts, true));
    }
  };
  sampler.limits = async function () {
    if (limitsCache && Date.now() - limitsAt < 60000) return limitsCache;
    var r = await fetch(API + "/limits", { credentials: "same-origin" });
    if (!r.ok) throw fail(r.status === 401 ? "not_granted" : "unavailable");
    var j = await r.json();
    limitsCache = { tools: !!j.tools, images: j.images || undefined };
    limitsAt = Date.now();
    return limitsCache;
  };

  window.claude = Object.freeze({
    use: async function (cap) {
      if (cap === "sample") return sampler;
      if (cap === "mcp") throw fail("server_not_connected"); // connectors only exist inside Claude
      return null;                                           // e.g. downloads: Fluxus falls back to a normal download
    },
  });

  /* ---------- UI: code screen, toast, privacy note ---------- */
  var ICON_X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_SHIELD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>';
  var gateEl = null;

  function setInert(on) {
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el === gateEl) return;
      if (on) { el.setAttribute("inert", ""); el.setAttribute("aria-hidden", "true"); }
      else { el.removeAttribute("inert"); el.removeAttribute("aria-hidden"); }
    });
  }

  function showGate() {
    if (gateEl || !document.body) return;
    gateEl = document.createElement("div");
    gateEl.className = "fxb-gate";
    gateEl.setAttribute("role", "dialog");
    gateEl.setAttribute("aria-modal", "true");
    gateEl.setAttribute("aria-labelledby", "fxb-title");
    gateEl.innerHTML =
      '<form class="fxb-card" novalidate>' +
      '<img class="fxb-logo" src="/fluxy/fluxy-logo.png" alt="Fluxy">' +
      '<h1 class="fxb-title" id="fxb-title">Meet Fluxy</h1>' +
      '<p class="fxb-body">Enter your demo code to meet Fluxy.</p>' +
      '<div class="fxb-field"><label class="fxb-label" for="fxb-code">Demo code</label>' +
      '<input class="fxb-input" id="fxb-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="64" required></div>' +
      '<button class="fxb-btn" type="submit">Continue</button>' +
      '<p class="fxb-error" role="alert" aria-live="assertive"></p></form>';
    document.body.appendChild(gateEl);
    setInert(true);
    var form = gateEl.querySelector("form"), input = gateEl.querySelector("input"), btn = gateEl.querySelector("button"), msg = gateEl.querySelector(".fxb-error");
    setTimeout(function () { input.focus(); }, 30);
    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var code = input.value.trim();
      if (!code) { msg.textContent = "Enter your demo code."; input.focus(); return; }
      btn.disabled = true; btn.textContent = "Checking…"; msg.textContent = "";
      try {
        var r = await fetch(API + "/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code }), credentials: "same-origin" });
        if (r.ok) { hideGate(); return; }
        var j = await r.json().catch(function () { return {}; });
        msg.textContent = j.error === "too_many_tries" ? "Too many tries. Wait a minute." : "That code didn't work. Check it and try again.";
      } catch (_) {
        msg.textContent = "Couldn't reach Fluxy. Check your connection and try again.";
      }
      btn.disabled = false; btn.textContent = "Continue"; input.select();
    });
  }
  function hideGate() { if (!gateEl) return; setInert(false); gateEl.remove(); gateEl = null; limitsCache = null; }

  var toastEl = null, toastTimer = null;
  function toast(text, kind) {
    if (!document.body) return;
    if (toastEl) toastEl.remove();
    toastEl = document.createElement("div");
    toastEl.className = "fxb-toast" + (kind === "warn" ? " warn" : "");
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    toastEl.innerHTML = '<span></span><button class="fxb-x" type="button" aria-label="Close">' + ICON_X + "</button>";
    toastEl.firstChild.textContent = text;
    var el = toastEl, close = function () { el.remove(); if (toastEl === el) toastEl = null; };
    el.querySelector("button").addEventListener("click", close);
    var arm = function () { clearTimeout(toastTimer); toastTimer = setTimeout(close, 4000); };
    el.addEventListener("mouseenter", function () { clearTimeout(toastTimer); });
    el.addEventListener("mouseleave", arm);
    el.addEventListener("focusin", function () { clearTimeout(toastTimer); });
    el.addEventListener("focusout", arm);
    document.body.appendChild(el);
    arm();
  }

  function showNote() {
    try { if (sessionStorage.getItem("fxb-note-off") === "1") return; } catch (_) {}
    var n = document.createElement("div");
    n.className = "fxb-note";
    n.setAttribute("role", "note");
    n.innerHTML = ICON_SHIELD + "<span>Demo version: please don't share private information.</span>" +
      '<button class="fxb-x" type="button" aria-label="Dismiss note">' + ICON_X + "</button>";
    n.querySelector("button").addEventListener("click", function () {
      n.remove();
      try { sessionStorage.setItem("fxb-note-off", "1"); } catch (_) {}
    });
    document.body.appendChild(n);
  }

  async function start() {
    showNote();
    try {
      var r = await fetch(API + "/session", { credentials: "same-origin", cache: "no-store" });
      var j = await r.json();
      if (!j.ok) showGate();
    } catch (_) { showGate(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
