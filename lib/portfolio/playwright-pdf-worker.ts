/**
 * Playwright-based PDF renderer.
 *
 * Launches a Chromium singleton, navigates to /render-snapshot,
 * injects the report JSON, waits for React to render, then calls page.pdf().
 *
 * Only loaded when PLAYWRIGHT_PDF_ENABLED=true (dynamic import in dispatcher).
 */

import type { Browser } from "playwright-core";
import type { SnapshotReportData } from "./snapshot-report-types";
import type { CohortSnapshot, FundSnapshot } from "@/lib/funds/snapshot-composer";
import type { FilerSnapshot } from "@/lib/13f/filer-snapshot-composer";

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  // Prevent concurrent launches
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
 * Render a SnapshotReportData object to an A4 PDF via headless Chromium.
 *
 * @param data  The report model (strict JSON contract).
 * @param baseUrl  The base URL of the running Next.js server (e.g. http://localhost:3000).
 * @returns PDF bytes as Uint8Array.
 */
export async function renderSnapshotPdf(
  data: SnapshotReportData,
  baseUrl: string,
): Promise<Uint8Array> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // Navigate to the render route
    await page.goto(`${baseUrl}/render-snapshot`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    // Inject report data and signal the React component
    await page.evaluate((reportData: SnapshotReportData) => {
      (window as any).__REPORT_DATA__ = reportData;
      window.dispatchEvent(new Event("report-data-ready"));
    }, data);

    // Wait for React to render and set the sentinel attribute
    await page.waitForSelector('[data-report-ready="true"]', {
      timeout: 10_000,
    });

    // Allow fonts to load and layout to stabilize (500ms covers Google Fonts
    // fetch + any CSS transitions; Plotly animations finish well within this).
    await page.waitForTimeout(500);

    // Generate the PDF
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    return new Uint8Array(pdfBuffer);
  } finally {
    await page.close();
  }
}

/**
 * Render a `FundSnapshot` to a Letter-landscape PDF via the F1 fund tearsheet
 * print template (Stage D.2.b).
 *
 * Mirrors `renderSnapshotPdf` but targets `/render-snapshot/funds/{bw_fund_id}`
 * and uses the fund-specific window key + ready event. The print template
 * sets `data-report-ready="true"` once the React tree has mounted.
 *
 * @param snap     The composed `FundSnapshot` from `loadFundSnapshot`.
 * @param baseUrl  Running Next.js base URL (e.g. http://localhost:3000).
 * @returns PDF bytes as Uint8Array.
 */
export async function renderFundSnapshotPdf(
  snap: FundSnapshot,
  baseUrl: string,
): Promise<Uint8Array> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.goto(
      `${baseUrl}/render-snapshot/funds/${encodeURIComponent(snap.bw_fund_id)}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      },
    );

    await page.evaluate((s: FundSnapshot) => {
      (window as unknown as { __FUND_SNAPSHOT__?: FundSnapshot }).__FUND_SNAPSHOT__ = s;
      window.dispatchEvent(new Event("fund-snapshot-ready"));
    }, snap);

    await page.waitForSelector('[data-report-ready="true"]', {
      timeout: 10_000,
    });

    // Allow fonts + Plotly to settle; mirrors the stock template.
    await page.waitForTimeout(500);

    const pdfBuffer = await page.pdf({
      format: "Letter",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
    });

    return new Uint8Array(pdfBuffer);
  } finally {
    await page.close();
  }
}

/**
 * Render a `CohortSnapshot` to a Letter-landscape PDF via the C1 cohort
 * tearsheet print template (Stage D.2.d).
 *
 * Mirrors `renderFundSnapshotPdf` but targets
 * `/render-snapshot/funds/style/{slug}` and uses the cohort window key +
 * ready event.
 */
export async function renderCohortSnapshotPdf(
  snap: CohortSnapshot,
  baseUrl: string,
): Promise<Uint8Array> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.goto(
      `${baseUrl}/render-snapshot/funds/style/${encodeURIComponent(snap.slug)}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      },
    );

    await page.evaluate((s: CohortSnapshot) => {
      (window as unknown as { __COHORT_SNAPSHOT__?: CohortSnapshot }).__COHORT_SNAPSHOT__ = s;
      window.dispatchEvent(new Event("cohort-snapshot-ready"));
    }, snap);

    await page.waitForSelector('[data-report-ready="true"]', {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);

    const pdfBuffer = await page.pdf({
      format: "Letter",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
    });

    return new Uint8Array(pdfBuffer);
  } finally {
    await page.close();
  }
}

/**
 * Render a `FilerSnapshot` to a Letter-landscape PDF via the F1 13F filer
 * tearsheet print template (D.8.8).
 *
 * Mirrors `renderFundSnapshotPdf` but targets
 * `/render-snapshot/13f/{bw_filer_id}` and uses the filer-specific window
 * key + ready event.
 */
export async function renderFilerSnapshotPdf(
  snap: FilerSnapshot,
  baseUrl: string,
): Promise<Uint8Array> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.goto(
      `${baseUrl}/render-snapshot/13f/${encodeURIComponent(snap.bw_filer_id)}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      },
    );

    await page.evaluate((s: FilerSnapshot) => {
      (window as unknown as { __FILER_SNAPSHOT__?: FilerSnapshot }).__FILER_SNAPSHOT__ = s;
      window.dispatchEvent(new Event("filer-snapshot-ready"));
    }, snap);

    await page.waitForSelector('[data-report-ready="true"]', {
      timeout: 10_000,
    });

    await page.waitForTimeout(500);

    const pdfBuffer = await page.pdf({
      format: "Letter",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
    });

    return new Uint8Array(pdfBuffer);
  } finally {
    await page.close();
  }
}

/**
 * Gracefully close the browser singleton.
 */
export async function closeBrowser(): Promise<void> {
  if (browser?.isConnected()) {
    await browser.close();
    browser = null;
  }
}

// Clean up on process exit
if (typeof process !== "undefined") {
  process.on("beforeExit", () => {
    closeBrowser().catch(() => {});
  });
}
