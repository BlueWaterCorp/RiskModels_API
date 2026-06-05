import { describe, expect, it } from "vitest";
import {
  aggregateReliability,
  type ReliabilityEvent,
} from "@/lib/agent/telemetry";

const ISO = "2026-06-05T00:00:00.000Z";

function ev(
  capability_id: string,
  latency_ms: number,
  success: boolean,
  status_code?: number,
): ReliabilityEvent {
  return { capability_id, latency_ms, success, metadata: { status_code } };
}

describe("aggregateReliability", () => {
  it("returns nulls and a note when there is no traffic", () => {
    const r = aggregateReliability([], 24, ISO);
    expect(r.sample_size).toBe(0);
    expect(r.latency_ms).toBeNull();
    expect(r.success_rate).toBeNull();
    expect(r.by_capability).toEqual({});
    expect(r.note).toContain("No measured traffic");
  });

  it("computes nearest-rank percentiles over all latencies", () => {
    // latencies 10..100 (10 values), sorted
    const events = Array.from({ length: 10 }, (_, i) =>
      ev("decompose", (i + 1) * 10, true, 200),
    );
    const r = aggregateReliability(events, 24, ISO);
    expect(r.latency_ms).not.toBeNull();
    // floor(0.5*10)=5 -> index 5 -> 60; p95 floor(0.95*10)=9 -> 100; p99 clamps to 100
    expect(r.latency_ms!.p50).toBe(60);
    expect(r.latency_ms!.p95).toBe(100);
    expect(r.latency_ms!.p99).toBe(100);
    expect(r.latency_ms!.avg).toBe(55);
  });

  it("excludes 4xx from success_rate but counts 5xx as failures", () => {
    const events = [
      ev("metrics", 20, true, 200),
      ev("metrics", 20, true, 200),
      ev("metrics", 5, false, 401), // client error -> excluded entirely
      ev("metrics", 5, false, 402), // client error -> excluded entirely
      ev("metrics", 30, false, 500), // server failure -> counts against
    ];
    const r = aggregateReliability(events, 24, ISO);
    // service-relevant = 3 (two 200s + one 500). failures = 1. rate = 2/3.
    expect(r.sample_size).toBe(3);
    expect(r.success_rate).toBeCloseTo(0.6667, 4);
    // latency percentiles exclude the fast 4xx rows (same filter as success_rate)
    expect(r.latency_ms!.avg).toBe(Math.round((20 + 20 + 30) / 3));
  });

  it("breaks down per capability without leaking revenue or user fields", () => {
    const events = [
      ev("decompose", 100, true, 200),
      ev("decompose", 200, false, 500),
      ev("lstar", 50, true, 200),
    ];
    const r = aggregateReliability(events, 24, ISO);
    expect(Object.keys(r.by_capability).sort()).toEqual(["decompose", "lstar"]);
    expect(r.by_capability.decompose.sample_size).toBe(2);
    expect(r.by_capability.decompose.success_rate).toBe(0.5);
    expect(r.by_capability.lstar.success_rate).toBe(1);
    // shape is exactly {sample_size, p95_ms, success_rate} — nothing else
    expect(Object.keys(r.by_capability.lstar).sort()).toEqual([
      "p95_ms",
      "sample_size",
      "success_rate",
    ]);
  });

  it("treats a capability of only client errors as 100% (no service failures)", () => {
    const events = [ev("chat", 5, false, 429), ev("chat", 5, false, 401)];
    const r = aggregateReliability(events, 24, ISO);
    expect(r.by_capability.chat.sample_size).toBe(0);
    expect(r.by_capability.chat.success_rate).toBe(1);
    expect(r.by_capability.chat.p95_ms).toBe(0); // no service events → no published latency
    expect(r.latency_ms).toBeNull(); // all 4xx → no service latency to report
    expect(r.success_rate).toBeNull(); // no service-relevant events at all
  });
});
