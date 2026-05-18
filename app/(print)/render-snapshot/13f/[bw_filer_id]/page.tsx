"use client";

/**
 * /render-snapshot/13f/[bw_filer_id] — F1 13F filer tearsheet print template.
 *
 * Mirrors /render-snapshot/funds/[bw_fund_id]/page.tsx. Mounted by Playwright
 * in the D.8 Phase 1 PDF route. The browser navigates here, the route injects
 * `window.__FILER_SNAPSHOT__` with the composed FilerSnapshot JSON, dispatches
 * `filer-snapshot-ready`, and waits for `[data-report-ready="true"]` before
 * calling page.pdf().
 */

import { useEffect, useState } from "react";

import type { FilerSnapshot } from "@/lib/13f/filer-snapshot-composer";
import { F1FilerTearsheet } from "@/lib/13f/snapshot-templates/F1FilerTearsheet";

declare global {
  interface Window {
    __FILER_SNAPSHOT__?: FilerSnapshot;
  }
}

export default function RenderFilerSnapshotPage() {
  const [snap, setSnap] = useState<FilerSnapshot | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.__FILER_SNAPSHOT__) {
      setSnap(window.__FILER_SNAPSHOT__);
      return;
    }
    const handler = () => {
      if (window.__FILER_SNAPSHOT__) {
        setSnap(window.__FILER_SNAPSHOT__);
      }
    };
    window.addEventListener("filer-snapshot-ready", handler);
    return () => window.removeEventListener("filer-snapshot-ready", handler);
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
        Waiting for 13F filer snapshot data…
      </div>
    );
  }

  return <F1FilerTearsheet snap={snap} />;
}
