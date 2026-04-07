/**
 * Playwright-based PNG renderer.
 *
 * Shares the Chromium singleton from playwright-pdf-worker, navigates to
 * /render-snapshot, injects report JSON, waits for React to render, then
 * takes a full-page screenshot.
 *
 * Only loaded when PLAYWRIGHT_PDF_ENABLED=true (same flag as PDF path —
 * if you can render PDFs, you can render PNGs).
 */

import type { Browser } from "playwright-core";
import type { SnapshotReportData } from "./snapshot-report-types";

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  if (launching) return launching;

  launching = (async () => {
    const { chromium } = await import("playwright-core");
    const instance = await chromium.launch({
      headless: true,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
    browser = instance;
    launching = null;
    return instance;
  })();

  return launching;
}

/**
 * Render a SnapshotReportData object to a PNG screenshot via headless Chromium.
 *
 * @param data     The report model (strict JSON contract).
 * @param baseUrl  The base URL of the running Next.js server.
 * @returns PNG bytes as Uint8Array.
 */
export async function renderSnapshotPng(
  data: SnapshotReportData,
  baseUrl: string,
): Promise<Uint8Array> {
  const b = await getBrowser();
  const page = await b.newPage({
    viewport: { width: 1200, height: 1600 },
    deviceScaleFactor: 2,
  });

  try {
    await page.goto(`${baseUrl}/render-snapshot`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    await page.evaluate((reportData: SnapshotReportData) => {
      (window as any).__REPORT_DATA__ = reportData;
      window.dispatchEvent(new Event("report-data-ready"));
    }, data);

    await page.waitForSelector('[data-report-ready="true"]', {
      timeout: 10_000,
    });

    // Allow fonts to load and layout to stabilize
    await page.waitForTimeout(500);

    const element = await page.$('[data-report-ready="true"]');
    if (!element) {
      throw new Error("Snapshot element not found after render");
    }

    const pngBuffer = await element.screenshot({
      type: "png",
      omitBackground: false,
    });

    return new Uint8Array(pngBuffer);
  } finally {
    await page.close();
  }
}
