#!/usr/bin/env python3
"""
Capture full-page screenshots of localhost:3000 and all linked internal pages.
Screenshots overwrite previous versions (no timestamps in filenames).

Usage: python capture_site.py
"""

import asyncio
import os
import urllib.parse

from playwright.async_api import async_playwright

BASE_URL = "http://localhost:3000"


# Map URLs to descriptive filenames (edit these as needed)
URL_TO_NAME = {
    "/": "01_landing_page",
    "/docs": "02_documentation",
    "/api": "03_api_reference",
    "/about": "04_about",
    "/pricing": "05_pricing",
    "/contact": "06_contact",
    "/login": "07_login",
    "/signup": "08_signup",
    "/dashboard": "09_dashboard",
    "/profile": "10_profile",
    "/settings": "11_settings",
}


def url_to_filename(url: str) -> str:
    """Convert URL to safe, descriptive filename."""
    parsed = urllib.parse.urlparse(url)
    path = parsed.path or "/"

    # Use mapped name if available
    if path in URL_TO_NAME:
        return URL_TO_NAME[path]

    # Derive name from path for unmapped URLs
    path_clean = path.strip("/")
    if not path_clean:
        return "01_landing_page"

    # Convert path to snake_case
    safe = path_clean.replace("/", "_").replace("-", "_").replace(" ", "_")
    safe = "".join(c.lower() if c.isalnum() or c == "_" else "" for c in safe)
    safe = safe.strip("_")

    # Add numeric prefix for sorting (00 is reserved for unmapped pages)
    return f"00_{safe}" if not safe[0].isdigit() else safe


async def get_all_internal_links(page) -> set[str]:
    """Extract all unique internal links from the current page."""
    links = await page.eval_on_selector_all(
        "a[href]",
        """elements => elements
            .map(el => el.href)
            .filter(href => href && href.startsWith('http://localhost:3000'))
            .filter(href => !href.includes('#'))
        """,
    )
    normalized = set()
    for link in links:
        parsed = urllib.parse.urlparse(link)
        norm = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        if (
            norm.startswith(BASE_URL)
            and not norm.endswith(
                (".pdf", ".zip", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".ico")
            )
            and not "/api/" in norm
        ):
            normalized.add(norm)
    return normalized


async def capture_page(page, url: str, output_path: str) -> str:
    """Capture screenshot of a single page."""
    print(f"  Navigating to {url}...")
    await page.goto(url, wait_until="networkidle")
    await asyncio.sleep(0.5)

    await page.screenshot(path=output_path, full_page=True)
    print(f"  ✓ Saved: {output_path}")
    return output_path


async def capture_all_screenshots() -> list[str]:
    """Capture screenshots of landing page and all linked internal pages."""
    output_dir = "site_images"
    os.makedirs(output_dir, exist_ok=True)

    captured = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_viewport_size({"width": 1280, "height": 720})

        # Step 1: Navigate to landing page and get all links
        print(f"\n📍 Landing page: {BASE_URL}")
        await page.goto(BASE_URL, wait_until="networkidle")
        await asyncio.sleep(0.5)

        internal_links = await get_all_internal_links(page)
        print(f"Found {len(internal_links)} unique internal page(s)")

        # Show unmapped URLs so user can add them to URL_TO_NAME
        unmapped = [
            link
            for link in internal_links
            if urllib.parse.urlparse(link).path not in URL_TO_NAME and link != BASE_URL
        ]
        if unmapped:
            print(f"\n⚠️  Unmapped URLs (consider adding to URL_TO_NAME):")
            for link in sorted(unmapped):
                print(f"   - {urllib.parse.urlparse(link).path}")

        # Step 2: Capture landing page
        landing_filename = f"{url_to_filename(BASE_URL)}.png"
        landing_path = os.path.join(output_dir, landing_filename)
        await page.screenshot(path=landing_path, full_page=True)
        print(f"  ✓ Saved: {landing_path}")
        captured.append(landing_path)

        # Step 3: Capture each linked page
        if internal_links:
            print(f"\n🔄 Capturing linked pages...")
            sorted_links = sorted(internal_links, key=lambda u: url_to_filename(u))

            for link in sorted_links:
                if link == BASE_URL or link.rstrip("/") == BASE_URL:
                    continue

                filename = f"{url_to_filename(link)}.png"
                output_path = os.path.join(output_dir, filename)

                print(f"\n{link}")
                try:
                    await capture_page(page, link, output_path)
                    captured.append(output_path)
                except Exception as e:
                    print(f"  ✗ Error: {e}")

        await browser.close()

    print(f"\n✅ Captured {len(captured)} screenshot(s) to ./{output_dir}/")
    return captured


def main():
    asyncio.run(capture_all_screenshots())


if __name__ == "__main__":
    main()
