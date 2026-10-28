"""Daily cap and mid-answer failure. Needs a fresh server (cap counts in memory)."""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright
def fake(m): urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:4010/__mode", data=json.dumps(m).encode(), method="POST")).read()
ASK = """async (p) => { const s = await window.claude.use("sample"); try { return (await s(p)).text; } catch (e) { return "ERR:" + e.code; } }"""
res = []
def check(i, n, ok, d=""): res.append(ok); print(("PASS " if ok else "FAIL ") + i + "  " + n + ("" if ok else "  -> " + str(d)))
async def main():
    fake({"gemini": "ok", "groq": "ok", "openrouter": "ok"})
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        await pg.goto("http://localhost:3100/"); await pg.get_by_label("Demo code").fill("DEMO-1111"); await pg.keyboard.press("Enter")
        await pg.locator(".fxb-gate").wait_for(state="detached")
        out = [await pg.evaluate(ASK, f"q{i}") for i in range(3)]
        check("F11-H1", "answers up to the code's daily cap (3)", all(o.startswith("Hello") for o in out), out)
        o = await pg.evaluate(ASK, "q4")
        check("F11-N1", "one more is refused as 'busy'", o == "ERR:rate_limited", o)
        toast = pg.get_by_role("status").filter(has_text="today's demo limit")
        check("F11-N2", "user sees the daily-limit message", await toast.count() == 1)
        ctx2 = await b.new_context(); p2 = await ctx2.new_page()
        await p2.goto("http://localhost:3100/"); await p2.get_by_label("Demo code").fill("TEAM-2222"); await p2.keyboard.press("Enter")
        await p2.locator(".fxb-gate").wait_for(state="detached")
        o = await p2.evaluate(ASK, "hi")
        check("F11-H2", "another code is not affected", o.startswith("Hello"), o)
        fake({"gemini": "slowfail"})
        o = await p2.evaluate(ASK, "hi")
        check("F12-E1", "AI drops mid-answer -> clean 'unavailable' (Fluxus shows its fallback)", o == "ERR:unavailable", o)
        fake({"gemini": "ok"})
        o = await p2.evaluate(ASK, "hi")
        check("F12-E2", "next question goes to the next AI while the first rests", o.startswith("Hello from groq"), o)
        await b.close()
asyncio.run(main())
print(f"{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
