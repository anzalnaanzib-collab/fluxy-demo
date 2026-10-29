"""Live ads in research screens: quiet, server-side, never a visible skill or source name."""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright
def fake(m): urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:4010/__mode", data=json.dumps(m).encode(), method="POST")).read()
def seen(): return json.loads(urllib.request.urlopen("http://127.0.0.1:4010/__seen").read())
res = []
def check(i, n, ok, d=""): ok = bool(ok); res.append(ok); print(("PASS " if ok else "FAIL ") + i + "  " + n + ("" if ok else "  -> " + str(d)[:300]))
ASK = """async (withTools) => { const s = await window.claude.use("sample"); const seen = [];
  const o = withTools ? { tools: [{ name: "add_posts", description: "add", inputSchema: { type: "object" }, execute: (a) => { seen.push("add_posts"); return "ok"; } }] } : {};
  try { const t = (await s("Analyse my competitor Bean Co", o)).text; return { t, seen }; } catch (e) { return { err: e.code }; } }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        await pg.goto("http://localhost:3100/"); await pg.get_by_label("Demo code").fill("TEAM-2222"); await pg.keyboard.press("Enter")
        await pg.locator(".fxb-gate").wait_for(state="detached")
        fake({"gemini": "liveads"})
        await pg.evaluate("location.hash = '#/research'"); seen()
        r = await pg.evaluate(ASK, False); s = seen()
        ai = [x for x in s if x["prov"] == "gemini"]; meta = [x for x in s if x["prov"] == "meta"]
        check("L01", "Research screen: Fluxy quietly gets live ads, even for panels that pass no tools", ai and "find_live_ads" in ai[0]["toolNames"] and ai[0]["sysHasAds"], ai)
        check("L02", "Server fetched the ads (with the token) and the answer uses them", meta and meta[0]["auth"] == "Bearer meta-test-token" and 'Bean Co says "Fresh roast' in r.get("t", ""), (r, meta))
        check("L03", "Browser never saw a tool call for it", r.get("seen") == [], r)
        await pg.evaluate("location.hash = '#/competitors'"); seen()
        r = await pg.evaluate(ASK, True); s = seen()
        ai = [x for x in s if x["prov"] == "gemini"]
        check("L04", "Competitors screen + Fluxus's own tools: both offered, live ads handled on the server", ai and set(ai[0]["toolNames"]) == {"add_posts", "find_live_ads"} and "Bean Co" in r.get("t", ""), (r, ai))
        await pg.evaluate("location.hash = '#/calendar'"); seen()
        await pg.evaluate(ASK, False); s = seen()
        ai = [x for x in s if x["prov"] == "gemini"]
        check("L05", "Non-research screen (calendar): no live-ads lookup offered", ai and "find_live_ads" not in ai[0]["toolNames"] and not ai[0]["sysHasAds"], ai)
        fake({"meta": "expired"}); await pg.evaluate("location.hash = '#/research'"); seen()
        r = await pg.evaluate(ASK, False)
        check("L06", "Token expired: answer still arrives and says no live ads", "No live ads" in r.get("t", ""), r)
        js = await pg.evaluate("async () => (await fetch('/fluxy/bridge.js')).text()")
        check("L07", "Browser code has no token and no 'Ad Library' wording or extra skill", "meta-test-token" not in js and "Ad Library" not in js and "search_meta" not in js)
        body = (await pg.inner_text("body"))
        check("L08", "Screen text never mentions the data source name", "Ad Library" not in body.replace("Meta Ad Library and", ""), "")
        r = await pg.evaluate("async () => (await fetch('/api/fluxy/ads?q=bean')).status")
        check("L09", "The direct lookup is owner-only", r == 403, r)
        await b.close()
asyncio.run(main())
print(f"{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
