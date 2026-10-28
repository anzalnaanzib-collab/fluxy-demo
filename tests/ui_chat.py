"""UI test: a user asks Fluxy through Fluxus's own chat and gets a real (fake-server) answer.
Run with the fake AI in 'ok' mode on a fresh server."""
import asyncio, os, sys
from playwright.async_api import async_playwright
SHOTS = os.environ.get("SHOTS", "/tmp")

async def enter(pg, code="TEAM-2222"):
    await pg.goto("http://localhost:3100/")
    await pg.get_by_label("Demo code").fill(code); await pg.keyboard.press("Enter")
    await pg.locator(".fxb-gate").wait_for(state="detached"); await pg.wait_for_timeout(1200)
    await pg.get_by_role("button", name="DEMO 1").click(); await pg.wait_for_timeout(2500)
    await pg.get_by_text("Suhaib").first.click(); await pg.wait_for_timeout(800)
    await pg.get_by_label("Password", exact=True).fill("Demo-pass-2468")
    await pg.get_by_label("Confirm password").fill("Demo-pass-2468")
    await pg.keyboard.press("Enter"); await pg.wait_for_timeout(2500)

async def main():
    ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1280, "height": 860})
        await enter(pg)
        gate_left = await pg.locator(".fx-usergate").count()
        print("Fluxus demo sign-in passed:", gate_left == 0)
        await pg.get_by_role("button", name="Ask Fluxy", exact=True).click(); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f"{SHOTS}/ui-panel.png")
        boxes = await pg.evaluate("""()=>[...document.querySelectorAll('textarea,input')].filter(e=>e.offsetParent).map(e=>(e.getAttribute('aria-label')||'')+'|'+(e.placeholder||''))""")
        print("visible text boxes:", boxes)
        box = pg.get_by_placeholder("Ask Fluxy anything", exact=False).first
        if not await box.count():
            box = pg.locator("textarea:visible").last
        await box.fill("Write a caption for our new lip balm")
        await pg.keyboard.press("Enter")
        try:
            await pg.get_by_text("Hello from gemini").first.wait_for(timeout=20000)
            print("PASS F10-H1  Fluxy answers in Fluxus's own chat")
        except Exception as e:
            ok = False; print("FAIL F10-H1  no answer in chat:", str(e)[:200])
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=f"{SHOTS}/ui-answer.png")
        txt = (await pg.inner_text("body")).lower()
        leak = [w for w in ["gemini", "groq", "openrouter"] if w in txt.replace("hello from gemini", "")]
        print(("PASS" if not leak else "FAIL") + " F10-H2  no AI names in the chat UI", leak or "")
        ok = ok and not leak
        await b.close()
    sys.exit(0 if ok else 1)
asyncio.run(main())
