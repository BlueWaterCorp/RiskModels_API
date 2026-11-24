import type { Page } from "playwright-core";

/**
 * Print templates are rendered by a headless browser for PDF and PNG output.
 * Those renders are machine traffic: measurement and tag hosts are refused so a
 * render sends no page view and waits on no third-party script.
 */
const TAG_HOST =
  /(^|\.)(googletagmanager\.com|google-analytics\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com|posthog\.com)$/;

export function isTagHost(url: string): boolean {
  try {
    return TAG_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function refuseTagRequests(page: Page): Promise<void> {
  await page.route(
    (url) => TAG_HOST.test(url.hostname),
    (route) => route.abort(),
  );
}
