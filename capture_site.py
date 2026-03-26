#!/usr/bin/env python3
"""
Capture full-page screenshots of localhost:3000 and all linked internal pages.
Screenshots overwrite previous versions (no timestamps in filenames).

PREREQUISITE: Start the Next.js dev server first:
    npm run dev

Usage: python capture_site.py
"""

import asyncio
import os
import sys
import urllib.parse

from playwright.async_api import async_playwright

BASE_URL = "http://localhost:3000"


# Map URLs to descriptive filenames matching audit naming convention
# Format: 00_{description}.png for docs pages
URL_TO_NAME = {
    "/": "01_landing_page",
    "/docs": "00_docs_index",
    "/docs/api": "00_docs_api",
    "/docs/methodology": "00_docs_methodology",
    "/docs/agent-integration": "00_docs_agent_integration",
    "/docs/authentication": "00_docs_authentication",
    "/api-reference": "00_api_reference",
    "/get-key": "00_get_key",
    "/account/usage": "00_account_usage",
    "/quickstart": "00_quickstart",
    "/pricing": "05_pricing",
    "/legal": "00_legal",
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


async def check_server_health(page) -> tuple[bool, str]:
    """Check if the dev server is running and returning valid pages."""
    try:
        response = await page.goto(BASE_URL, wait_until="networkidle", timeout=5000)
        if response is None:
            return False, "No response from server"
        if response.status >= 500:
            return False, f"Server error (HTTP {response.status})"
        if response.status >= 400:
            return False, f"Client error (HTTP {response.status})"
        
        # Check for error page indicators
        title = await page.title()
        content = await page.content()
        
        if "Internal Server Error" in content or "Internal Server Error" in title:
            return False, "Page shows 'Internal Server Error'"
        if "Error" in title and response.status >= 400:
            return False, f"Error page detected (title: {title})"
            
        return True, f"OK (HTTP {response.status})"
    except Exception as e:
        return False, f"Connection failed: {e}"


async def capture_page(page, url: str, output_path: str) -> str | None:
    """Capture screenshot of a single page. Returns None if page has errors."""
    print(f"  Navigating to {url}...")
    
    try:
        response = await page.goto(url, wait_until="networkidle")
        await asyncio.sleep(0.5)
        
        # Check for server errors
        if response and response.status >= 500:
            print(f"  ✗ SKIPPED: Server error (HTTP {response.status})")
            return None
            
        # Check for error text in page
        content = await page.content()
        if "Internal Server Error" in content:
            print(f"  ✗ SKIPPED: Page shows 'Internal Server Error'")
            return None
        
        await page.screenshot(path=output_path, full_page=True)
        print(f"  ✓ Saved: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"  ✗ SKIPPED: Navigation failed ({e})")
        return None


async def capture_all_screenshots() -> list[str]:
    """Capture screenshots of landing page and all linked internal pages."""
    output_dir = "site_images"
    os.makedirs(output_dir, exist_ok=True)

    captured = []
    skipped = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_viewport_size({"width": 1280, "height": 720})

        # Step 0: Health check
        print(f"\n🔍 Checking server health at {BASE_URL}...")
        healthy, message = await check_server_health(page)
        if not healthy:
            print(f"\n❌ SERVER NOT READY: {message}")
            print(f"\nMake sure the Next.js dev server is running:")
            print(f"   npm run dev")
            print(f"\nThen re-run this script.")
            await browser.close()
            sys.exit(1)
        print(f"  ✓ Server healthy: {message}")

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
        result = await capture_page(page, BASE_URL, landing_path)
        if result:
            captured.append(landing_path)
        else:
            skipped.append("/")

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
                result = await capture_page(page, link, output_path)
                if result:
                    captured.append(output_path)
                else:
                    skipped.append(urllib.parse.urlparse(link).path)

        await browser.close()

    # Summary
    print(f"\n{'='*50}")
    print(f"✅ Captured {len(captured)} screenshot(s) to ./{output_dir}/")
    if skipped:
        print(f"⚠️  Skipped {len(skipped)} page(s) with errors:")
        for path in skipped:
            print(f"   - {path}")
    print(f"{'='*50}")
    
    return captured


def main():
    print("="*60)
    print("RiskModels Site Screenshot Capture")
    print("="*60)
    print(f"\nTarget: {BASE_URL}")
    print(f"Output:  site_images/")
    print(f"\nPrerequisite: npm run dev (must be running)")
    print("-"*60)
    
    asyncio.run(capture_all_screenshots())


if __name__ == "__main__":
    main()
