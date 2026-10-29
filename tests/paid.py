"""Paid backups: free first, paid only after free AIs are out, monthly cap enforced.
Usage: python3 tests/paid.py <scenario>   (server started with matching env, see run_paid.sh)"""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright
def fake(m): urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:4010/__mode", data=json.dumps(m).encode(), method="POST")).read()
def seen(): return json.loads(urllib.request.urlopen("http://127.0.0.1:4010/__seen").read())
ASK = """async (p) => { const s = await window.claude.use("sample"); try { return (await s(p)).text; } catch (e) { return "ERR:" + e.code; } }"""
res = []
def check(i, n, ok, d=""): ok = bool(ok); res.append(ok); print(("PASS " if ok else "FAIL ") + i + "  " + n + ("" if ok else "  -> " + str(d)[:300]))
ALL_FREE_OUT = {"gemini": "429", "groq": "429", "openrouter": "429"}
async def session(b, code):
    pg = await (await b.new_context()).new_page()
    await pg.goto("http://localhost:3100/"); await pg.get_by_label("Demo code").fill(code); await pg.keyboard.press("Enter")
    await pg.locator(".fxb-gate").wait_for(state="detached"); return pg
async def health(pg):
    return await pg.evaluate("async () => (await fetch('/api/fluxy/health')).json()")
async def main(sc):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        own = await session(b, "OWNER-CODE-9999")
        fake({"gemini": "ok", "groq": "ok", "openrouter": "ok", "xai": "ok", "anthropic": "ok", "openai": "ok", "perplexity": "ok", "gemini_paid": "ok"})
        if sc == "on":
            seen(); t = await own.evaluate(ASK, "hi")
            check("P01", "free AI still answers first; no paid call", t.startswith("Hello from gemini") and all(x["prov"] in ("gemini",) for x in seen()), t)
            h = await health(own)
            check("P02", "nothing spent while free AIs work", h["paid"]["spentUsd"] == 0 and h["paid"]["on"], h["paid"])
            fake(ALL_FREE_OUT); seen()
            t = await own.evaluate(ASK, "hi")
            s = seen()
            check("P03", "all free AIs out -> first paid AI (Grok) answers", t.startswith("Hello from xai"), (t, [x["prov"] for x in s]))
            h = await health(own)
            exp = round((12 * 1.25 + 7 * 2.5) / 1e6, 7)
            check("P04", "credits counted from real token use (12 in / 7 out)", abs(h["paid"]["spentUsd"] - exp) < 2e-6, (h["paid"], exp))
            fake({"xai": "429"}); seen()
            t = await own.evaluate(ASK, "hi")
            check("P05", "paid AI out -> next paid AI (Claude) answers", t.startswith("Hello from anthropic"), t)
            fake({"anthropic": "500", "perplexity": "500", "gemini_paid": "500"}); seen()
            t = await own.evaluate(ASK, "hi"); s = seen()
            o = [x for x in s if x["prov"] == "openai"]
            check("P06", "ChatGPT reached last, using max_completion_tokens", t.startswith("Hello from openai") and o and o[0]["mtc"], (t, s[-1:]))
            fake({"openai": "slowfail"})
            t = await own.evaluate(ASK, "hi")
            h = await health(own)
            byp = {x["provider"]: x["spentUsd"] for x in h["paid"]["byProvider"]}
            check("P07", "answer cut off mid-way -> full hold counted (never under-counts)", byp.get("openai", 0) > 0.009, byp)
            check("P08", "visitors never see AI names", "xai" not in (await own.inner_text("body")).lower())
        elif sc == "cap":
            fake(ALL_FREE_OUT); seen()
            t = await own.evaluate(ASK, "hi"); s = [x["prov"] for x in seen()]
            check("P10", "Grok's worst-case cost is over the tiny cap -> skipped without calling it", "xai" not in s, s)
            check("P11", "cheaper Claude fits under the cap and answers", t.startswith("Hello from anthropic"), t)
            for _ in range(3): await own.evaluate(ASK, "hi")
            h = await health(own)
            check("P12", "spending never passes the cap", h["paid"]["spentUsd"] <= h["paid"]["capUsd"], h["paid"])
            async def one(): return await own.evaluate(ASK, "hi")
            outs = await asyncio.gather(*[one() for _ in range(8)])
            h = await health(own)
            check("P13", "8 answers at the same moment still stay under the cap", h["paid"]["spentUsd"] <= h["paid"]["capUsd"], (h["paid"], outs))
        elif sc == "off":
            fake(ALL_FREE_OUT); seen()
            t = await own.evaluate(ASK, "hi"); s = [x["prov"] for x in seen()]
            check("P20", "cap not set -> paid AIs never called, Fluxus demo answer", t == "ERR:rate_limited" and not any(x in s for x in ["xai","anthropic","openai","perplexity","gemini_paid"]), (t, s))
            h = await health(own)
            check("P21", "owner page says why paid is off", not h["paid"]["on"] and h["paid"]["why"], h["paid"])
        await b.close()
asyncio.run(main(sys.argv[1]))
print(f"{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
