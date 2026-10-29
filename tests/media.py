"""Presenter videos (HeyGen), designed graphics (Moda), product shots and motion clips (Higgsfield): started by Fluxy, shown in the tray, downloadable."""
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright
SHOTS = os.environ.get("SHOTS", "/tmp")
def fake(m): urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:4010/__mode", data=json.dumps(m).encode(), method="POST")).read()
def seen(): return json.loads(urllib.request.urlopen("http://127.0.0.1:4010/__seen").read())
res = []
def check(i, n, ok, d=""): ok = bool(ok); res.append(ok); print(("PASS " if ok else "FAIL ") + i + "  " + n + ("" if ok else "  -> " + str(d)[:300]))
ASK = """async (q) => { const s = await window.claude.use("sample"); try { return (await s(q)).text; } catch (e) { return "ERR:" + e.code; } }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1280, "height": 860})
        await pg.goto("http://localhost:3100/"); await pg.get_by_label("Demo code").fill("TEAM-2222"); await pg.keyboard.press("Enter")
        await pg.locator(".fxb-gate").wait_for(state="detached")
        await pg.evaluate("location.hash = '#/creative-lab'")
        fake({"gemini": "makevideo"}); seen()
        t = await pg.evaluate(ASK, "Make a presenter video announcing our summer sale")
        s = seen(); ai = [x for x in s if x["prov"] == "gemini"]; hg = [x for x in s if x["prov"] == "heygen"]
        check("M01", "Fluxy is offered video, design, shot and clip abilities (no names shown)", ai and {"make_presenter_video", "make_designed_graphic", "make_product_shot", "make_motion_clip"} <= set(ai[0]["toolNames"]), ai[:1])
        check("M02", "HeyGen job started with the avatar, script and 9:16, key sent server-side",
              hg and hg[0]["method"] == "POST" and hg[0]["body"]["avatar_id"] == "av_test" and hg[0]["body"]["aspect_ratio"] == "9:16" and hg[0]["key"] == "hg-test-key", hg[:1])
        check("M03", "Fluxy's reply says it's being made", "tray" in t, t)
        tray = pg.get_by_role("region", name="Fluxy is making")
        await tray.wait_for(timeout=5000)
        check("M04", "Tray appears with the job in progress", "Summer sale promo" in await tray.inner_text() and await pg.get_by_role("progressbar").count() == 1)
        await pg.screenshot(path=f"{SHOTS}/tray-working.png")
        await pg.get_by_role("link", name="Download").wait_for(timeout=30000)
        check("M05", "When ready: video preview + Download link", await pg.locator(".fxb-tray video").count() == 1)
        fake({"gemini": "makedesign"}); seen()
        await pg.evaluate(ASK, "Design an Instagram post for our summer sale")
        await pg.locator(".fxb-tray img").wait_for(timeout=30000)
        s = seen(); md = [x for x in s if x["prov"] == "moda"]
        posts = [x for x in md if x["url"] == "/moda/tasks" and x["method"] == "POST"]
        check("M06", "Moda: first format refused -> retried as a one-page canvas, 1080x1350", len(posts) == 2 and posts[1]["body"]["format"] == {"category": "slides", "width": 1080, "height": 1350} and posts[1]["body"]["number_of_slides"] == 1, posts)
        check("M07", "Moda headers: key + pinned API version", md and md[0]["auth"] == "Bearer moda-test-key" and md[0]["ver"] == "2026-05-01", md[:1])
        check("M08", "Design ready as PNG in the tray with Download", await pg.locator(".fxb-tray img[alt='Summer sale post']").count() == 1 and await pg.get_by_role("link", name="Download").count() == 2)
        await pg.screenshot(path=f"{SHOTS}/tray-done.png")
        await pg.reload(); await pg.locator(".fxb-tray").wait_for(timeout=8000)
        check("M09", "Tray survives a page reload", await pg.locator(".fxb-job").count() == 2)
        await pg.get_by_role("button", name="Remove Summer sale post").click()
        check("M10", "Items can be removed", await pg.locator(".fxb-job").count() == 1)
        fake({"gemini": "makeshot"}); seen()
        await pg.evaluate(ASK, "Make a product shot of our iced latte")
        await pg.locator(".fxb-tray img[alt='Iced latte shot']").wait_for(timeout=30000)
        hf = [x for x in seen() if x["prov"] == "higgsfield"]; post = [x for x in hf if x["method"] == "POST"]
        check("M14", "Product shot: Higgsfield image job with prompt + 3:4, key sent as 'Key id:secret' server-side",
              post and post[0]["url"] == "/hf/marketing-studio/image" and post[0]["body"]["aspect_ratio"] == "3:4" and post[0]["auth"] == "Key hf-id:hf-secret" and post[0]["idem"], post[:1])
        check("M15", "Shot ready in the tray labelled 'Product shot'", "product shot" in (await pg.locator(".fxb-tray").inner_text()).lower())
        fake({"gemini": "makeclip"}); seen()
        await pg.evaluate(ASK, "Make a 5 second motion clip of our latte for Reels")
        await pg.locator(".fxb-tray video").nth(1).wait_for(timeout=60000)
        hf = [x for x in seen() if x["prov"] == "higgsfield"]; posts = [x for x in hf if x["method"] == "POST"]
        vid = [x for x in posts if "image-to-video" in x["url"]]
        check("M16", "Motion clip: still made first (9:16), then animated once from that still with the motion prompt",
              len(posts) == 2 and posts[0]["body"]["aspect_ratio"] == "9:16" and len(vid) == 1 and vid[0]["body"]["image_url"].endswith("/files/img_2.png") and vid[0]["body"]["prompt"] == "slow push-in, ice settling", posts)
        check("M17", "Clip shows as a video in the tray labelled 'Motion clip'", "motion clip" in (await pg.locator(".fxb-tray").inner_text()).lower())
        await pg.screenshot(path=f"{SHOTS}/tray-higgsfield.png")
        js = await pg.evaluate("async () => (await fetch('/fluxy/bridge.js')).text()")
        check("M11", "No keys and no provider names in the browser code", not any(w in js for w in ["hg-test-key", "moda-test-key", "hf-secret", "HeyGen", "Moda", "Higgsfield"]))
        anon = await (await b.new_context()).new_page()
        r = await anon.request.get("http://localhost:3100/api/fluxy/media?job=hg_vid1")
        check("M12", "Job status needs a demo code", r.status == 401, r.status)
        fake({"gemini": "ok"}); seen()
        await pg.evaluate("location.hash = '#/calendar'")
        await pg.evaluate(ASK, "hi")
        s = [x for x in seen() if x["prov"] in ("heygen", "moda", "higgsfield")]
        check("M13", "Ordinary questions never start a video or design", not s, s)
        await b.close()
asyncio.run(main())
print(f"{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
