"use client";

/**
 * /render-snapshot/funds/style/[slug] — C1 cohort tearsheet print template.
 *
 * Mounted by Playwright in the D.2.d PDF route. The browser navigates here,
 * the route injects `window.__COHORT_SNAPSHOT__` with the composed
 * CohortSnapshot JSON, dispatches `cohort-snapshot-ready`, and waits for the
 * `[data-report-ready="true"]` sentinel before calling `page.pdf()`.
 *
 * The route is also useful for designers — appending the JSON via a
 * fetch in a small dev helper renders the live cohort tearsheet in a tab.
 */

import { useEffect, useState } from "react";

import { C1CohortTearsheet } from "@/lib/funds/snapshot-templates/C1CohortTearsheet";
import type { CohortSnapshot } from "@/lib/funds/snapshot-composer";

declare global {
  interface Window {
    __COHORT_SNAPSHOT__?: CohortSnapshot;
  }
}

export default function RenderCohortSnapshotPage() {
  const [snap, setSnap] = useState<CohortSnapshot | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.__COHORT_SNAPSHOT__) {
      setSnap(window.__COHORT_SNAPSHOT__);
      return;
    }
    const handler = () => {
      if (window.__COHORT_SNAPSHOT__) {
        setSnap(window.__COHORT_SNAPSHOT__);
      }
    };
    window.addEventListener("cohort-snapshot-ready", handler);
    return () =>
      window.removeEventListener("cohort-snapshot-ready", handler);
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
        Waiting for cohort snapshot data…
      </div>
    );
  }

  return <C1CohortTearsheet snap={snap} />;
}
