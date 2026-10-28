"""End-to-end tests for the Fluxy copy of Fluxus, against the local server and
the fake AI server (tests/fake-ai.mjs). Run: python3 tests/e2e.py
Each case prints PASS/FAIL with its ID from replica/test-plan.md."""
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright

BASE = "http://localhost:3100"
SHOTS = os.environ.get("SHOTS", "/tmp")
results = []

def fake(mode):
    req = urllib.request.Request("http://127.0.0.1:4010/__mode", data=json.dumps(mode).encode(), method="POST")
    urllib.request.urlopen(req).read()

def seen():
    return json.loads(urllib.request.urlopen("http://127.0.0.1:4010/__seen").read())

def check(cid, name, ok, detail=""):
    results.append((cid, ok))
    print(("PASS " if ok else "FAIL ") + cid + "  " + name + ("" if ok else "  -> " + str(detail)[:300]))

SAMPLE = """async ([prompt, opts]) => {
  const s = await window.claude.use("sample");
  const texts = [];
  try {
    const o = Object.assign({}, opts || {}, { onText: ({ text }) => texts.push(text) });
    if (o.toolsDemo) { o.tools = [{ name: "add_posts", description: "add", inputSchema: { type: "object" },
        execute: (a) => { window.__toolArgs = a; return { created: 1 }; } }]; delete o.toolsDemo; }
    if (o.asJson) { delete o.asJson; return { json: await s.json(prompt, o) }; }
    const r = await s(prompt, o);
    return { text: r.text, streamed: texts.length, last: texts[texts.length - 1], toolArgs: window.__toolArgs || null };
  } catch (e) { return { error: e && (e.code || e.name || String(e)) }; }
}"""

async def main():
    fake({"gemini": "ok", "groq": "ok", "openrouter": "ok"})
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1280, "height": 860})
        page = await ctx.new_page()
        errors = []
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        bad_status = []
        page.on("response", lambda r: r.status >= 500 and bad_status.append(f"{r.status} {r.url}"))

        # ---- F00 demo code screen
        await page.goto(BASE + "/", wait_until="domcontentloaded")
        dlg = page.get_by_role("dialog", name="Meet Fluxy")
        await dlg.wait_for(timeout=15000)
        check("F00-H1", "code screen shows before use", await dlg.is_visible())
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f"{SHOTS}/e2e-gate.png")
        await page.get_by_label("Demo code").fill("WRONG-0000")
        await page.get_by_role("button", name="Continue").click()
        alert = page.get_by_role("alert")
        await page.wait_for_function("document.querySelector('.fxb-error') && document.querySelector('.fxb-error').textContent.length > 0")
        check("F00-N1", "wrong code is refused", "didn't work" in (await alert.text_content()), await alert.text_content())
        await page.get_by_label("Demo code").fill("  team-2222 ")
        await page.get_by_role("button", name="Continue").click()
        await dlg.wait_for(state="detached", timeout=10000)
        check("F00-H2", "right code (any case, spaces) opens Fluxus", True)
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        check("F00-H3", "after reload, no code screen (session kept)", await page.locator(".fxb-gate").count() == 0)

        # ---- Fluxus itself loaded, with Fluxy wording and no AI names
        await page.wait_for_timeout(1500)
        body = (await page.inner_text("body"))
        check("F01-H0", "Fluxus app renders", len(body) > 200, len(body))
        low = body.lower()
        check("F01-H5", "no free-AI names visible on screen", not any(w in low for w in ["gemini", "groq", "openrouter"]),
              [w for w in ["gemini", "groq", "openrouter"] if w in low])
        check("F01-H6", "privacy note visible", await page.get_by_role("note").filter(has_text="private information").count() == 1)
        await page.screenshot(path=f"{SHOTS}/e2e-fluxus.png")

        # ---- F01 ask, stream, answer (Gemini first)
        seen()
        r = await page.evaluate(SAMPLE, ["Write a caption", {"modelTier": "quick"}])
        s = seen()
        check("F01-H1", "answer comes back", r.get("text") == "Hello from gemini. Here are ideas.", r)
        check("F01-H2", "text streams in pieces (cumulative)", r.get("streamed", 0) >= 2 and r.get("last") == r.get("text"), r)
        check("F01-H3", "tries the first free AI, with its own key and quick model", s and s[0]["prov"] == "gemini" and s[0]["auth"] == "Bearer k-gem" and "lite" in s[0]["model"], s)
        check("F01-H4", "Fluxy system line is sent", s and s[0]["sys"].startswith("You are Fluxy"), s)

        # ---- JSON
        r = await page.evaluate(SAMPLE, ["Return JSON with ok", {"asJson": True}])
        check("F02-H1", "json() returns parsed object (code fences stripped)", r.get("json", {}).get("ok") is True, r)

        # ---- tools loop (Fluxus tools run in the browser)
        fake({"gemini": "tools"})
        seen()
        r = await page.evaluate(SAMPLE, ["Add a post", {"toolsDemo": True}])
        s = seen()
        check("F03-H1", "tool runs in the browser with the AI's arguments", r.get("toolArgs") == {"posts": [{"title": "Hi"}]}, r)
        check("F03-H2", "result goes back and a final answer arrives", bool(r.get("text")) and len(s) == 2 and s[1]["hasTool"], (r, s))
        fake({"gemini": "ok"})

        # ---- images go only to an AI that can see them
        img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        seen()
        r = await page.evaluate(SAMPLE, ["What is this?", {"images": [img]}])
        s = seen()
        check("F04-H1", "image request answered, image sent", r.get("text", "").startswith("Hello from gemini") and s[0]["img"], (r, s))
        lim = await page.evaluate("async () => (await window.claude.use('sample')).limits()")
        check("F04-H2", "limits() reports tools and images", lim.get("tools") is True and lim.get("images", {}).get("maxCount") == 4, lim)

        # ---- other capabilities fall back like outside Claude
        r = await page.evaluate("async () => { try { await window.claude.use('mcp'); return 'no-error'; } catch (e) { return e.code; } }")
        check("F05-H1", "connectors report 'not connected' (Fluxus shows its own message)", r == "server_not_connected", r)
        r = await page.evaluate("async () => await window.claude.use('downloads')")
        check("F05-H2", "downloads fall back to a normal download", r is None, r)

        # ---- automatic switching
        fake({"gemini": "429"})
        seen()
        r = await page.evaluate(SAMPLE, ["Write a caption", {}])
        s = seen()
        check("F06-H1", "first AI out of quota -> next AI answers, same request", r.get("text", "").startswith("Hello from groq") and [x["prov"] for x in s] == ["gemini", "groq"], (r, s))
        seen()
        r = await page.evaluate(SAMPLE, ["Again", {}])
        s = seen()
        check("F06-H2", "the AI that ran out is skipped next time (no wasted call)", [x["prov"] for x in s] == ["groq"], s)
        fake({"groq": "500"})
        seen()
        r = await page.evaluate(SAMPLE, ["Again", {}])
        s = seen()
        check("F06-H3", "second AI crashing -> third AI answers", r.get("text", "").startswith("Hello from openrouter"), (r, s))
        r = await page.evaluate(SAMPLE, ["Add a post", {"toolsDemo": True}])
        check("F06-E1", "tool request with no tool-capable AI left -> 'busy' (Fluxus demo answer)", r.get("error") == "rate_limited", r)
        fake({"openrouter": "429"})
        r = await page.evaluate(SAMPLE, ["Again", {}])
        check("F06-E2", "all free AIs out -> 'busy' code Fluxus already handles", r.get("error") == "rate_limited", r)

        # ---- owner page
        own = await ctx.new_page()
        await own.goto(BASE + "/owner")
        await own.wait_for_timeout(1500)
        check("F07-N1", "viewer code can't open the owner page", "owner code" in (await own.inner_text("body")), await own.inner_text("body"))
        octx = await b.new_context()
        op = await octx.new_page()
        await op.goto(BASE + "/")
        await op.get_by_label("Demo code").fill("OWNER-CODE-9999")
        await op.get_by_role("button", name="Continue").click()
        await op.locator(".fxb-gate").wait_for(state="detached")
        await op.goto(BASE + "/owner")
        await op.get_by_role("heading", name="Fluxy status").wait_for(timeout=10000)
        t = await op.inner_text("body")
        check("F07-H1", "owner sees which AI is resting and answers per code", "resting until" in t and "Team" in t, t[:400])
        await op.screenshot(path=f"{SHOTS}/e2e-owner.png", full_page=True)

        # ---- not signed in
        anon = await b.new_context()
        ap = await anon.new_page()
        resp = await ap.request.post(BASE + "/api/fluxy/sample", data={"requestId": "abcdefgh", "messages": [{"role": "user", "content": "hi"}]})
        check("F08-N1", "API refuses calls without a demo code", resp.status == 401, resp.status)
        resp = await ap.request.get(BASE + "/api/fluxy/health")
        check("F08-N2", "status API refuses non-owners", resp.status == 403, resp.status)
        forged = await anon.new_page()
        await anon.add_cookies([{"name": "fluxy_session", "value": "eyJsYWJlbCI6Ik93bmVyIiwicm9sZSI6Im93bmVyIiwiY2FwIjo5OTksImV4cCI6OTk5OTk5OTk5OTk5OX0.forged", "url": BASE}])
        resp = await forged.request.get(BASE + "/api/fluxy/health")
        check("F08-N3", "a forged session cookie is rejected", resp.status == 403, resp.status)
        resp = await page.request.post(BASE + "/api/fluxy/sample", data={"requestId": "x", "messages": []})
        check("F08-N4", "malformed request is rejected (400)", resp.status == 400, resp.status)

        # ---- mobile width
        m = await b.new_context(viewport={"width": 390, "height": 800})
        mp = await m.new_page()
        await mp.goto(BASE + "/")
        await mp.get_by_role("dialog", name="Meet Fluxy").wait_for()
        await mp.wait_for_timeout(1500)
        await mp.screenshot(path=f"{SHOTS}/e2e-gate-phone.png")
        box = await mp.locator(".fxb-card").bounding_box()
        check("F09-H1", "code screen fits a phone (16px margins)", box and box["x"] >= 15 and box["x"] + box["width"] <= 375, box)
        await mp.keyboard.type("TEAM-2222")
        await mp.keyboard.press("Enter")
        await mp.locator(".fxb-gate").wait_for(state="detached")
        check("F09-H2", "keyboard only: focus starts in the field, Enter submits", True)

        bridge_errs = [e for e in errors if "fluxy" in e.lower() or "bridge" in e.lower()]
        check("F99-H1", "no console errors from the bridge", not bridge_errs, bridge_errs)
        check("F99-H2", "no 5xx responses", not bad_status, bad_status)
        print("console errors from Fluxus itself (not failing):", len(errors) - len(bridge_errs))
        for e in errors[:8]: print("   ", e[:160])
        await b.close()

asyncio.run(main())
passed = sum(1 for _, ok in results if ok)
print(f"\n{passed}/{len(results)} passed")
sys.exit(0 if passed == len(results) else 1)
