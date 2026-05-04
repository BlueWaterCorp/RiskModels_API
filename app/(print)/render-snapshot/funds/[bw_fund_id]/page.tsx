"use client";

/**
 * /render-snapshot/funds/[bw_fund_id] — F1 fund tearsheet print template.
 *
 * Mounted by Playwright in the D.2.b PDF route. The browser navigates here,
 * the route injects `window.__FUND_SNAPSHOT__` with the composed
 * FundSnapshot JSON, dispatches `fund-snapshot-ready`, and waits for the
 * `[data-report-ready="true"]` sentinel before calling `page.pdf()`.
 *
 * The route is also useful for designers — appending the JSON via a
 * fetch in a small dev helper renders the live tearsheet in a tab.
 */

import { useEffect, useState } from "react";

import type { FundSnapshot } from "@/lib/funds/snapshot-composer";
import { F1FundTearsheet } from "@/lib/funds/snapshot-templates/F1FundTearsheet";

declare global {
  interface Window {
    __FUND_SNAPSHOT__?: FundSnapshot;
  }
}

export default function RenderFundSnapshotPage() {
  const [snap, setSnap] = useState<FundSnapshot | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.__FUND_SNAPSHOT__) {
      setSnap(window.__FUND_SNAPSHOT__);
      return;
    }
    const handler = () => {
      if (window.__FUND_SNAPSHOT__) {
        setSnap(window.__FUND_SNAPSHOT__);
      }
    };
    window.addEventListener("fund-snapshot-ready", handler);
    return () => window.removeEventListener("fund-snapshot-ready", handler);
  }, []);

  if (!snap) {
    return (
      <div
        style={{
          padding: 48,
          color: "#9ca3af",
          fontSize: 14,
          fontFamily: "'Inter', sans-serif",
        }}
      >
        Waiting for fund snapshot data…
      </div>
    );
  }

  return <F1FundTearsheet snap={snap} />;
}
