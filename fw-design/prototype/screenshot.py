#!/usr/bin/env python3
"""截图 6 个原型页面"""
import asyncio
from playwright.async_api import async_playwright
from pathlib import Path

PAGES = ['dashboard', 'assets', 'add', 'trends', 'family', 'profile']
OUTPUT_DIR = Path(r"C:\Users\xuzhiweiand\WorkBuddy\2026-09-05-14-35-28\prototype\screenshots")
OUTPUT_DIR.mkdir(exist_ok=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=r"C:\Users\xuzhiweiand\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe",
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = await browser.new_context(
            viewport={"width": 480, "height": 920},
            device_scale_factor=2,
        )
        page = await context.new_page()

        for page_name in PAGES:
            url = f"http://localhost:8765/index.html#{page_name}"
            await page.goto(url, wait_until="networkidle")
            await page.wait_for_timeout(2500)  # 等 Alpine.js + Chart.js 完整渲染

            # 调试：检查 trends 页 canvas
            if page_name == 'trends':
                info = await page.evaluate("""() => {
                  const c = document.getElementById('trendChart');
                  return {
                    exists: !!c,
                    hasChart: !!(c && c._chart),
                    width: c?.width,
                    height: c?.height,
                    parentDisplay: c?.parentElement?.style.display,
                    pageActive: document.getElementById('page-trends').classList.contains('active'),
                    hash: location.hash,
                  };
                }""")
                print(f"DEBUG trends: {info}")

            await page.screenshot(
                path=str(OUTPUT_DIR / f"{page_name}.png"),
                full_page=False,
            )
            print(f"✓ {page_name}.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())