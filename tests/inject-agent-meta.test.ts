import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { injectAgentMeta } from "@/lib/agent/billing-middleware";
import { buildAgentBody } from "@/lib/dal/response-headers";
import { METHODOLOGY_URL } from "@/lib/constants";

describe("injectAgentMeta", () => {
  it("adds latency_ms, provenance and request_id to a JSON success body", async () => {
    const res = NextResponse.json({ ticker: "AAPL", _agent: { cost_usd: 0.02 } });
    const out = await injectAgentMeta(res, { latencyMs: 87, requestId: "req_123" });
    const body = await out.json();
    expect(body._agent.latency_ms).toBe(87);
    expect(body._agent.provenance).toBe(METHODOLOGY_URL);
    expect(body._agent.request_id).toBe("req_123");
    expect(body._agent.cost_usd).toBe(0.02); // preserved
    expect(body.ticker).toBe("AAPL"); // payload untouched
  });

  it("creates an _agent block when the body has none", async () => {
    const res = NextResponse.json({ data: [1, 2, 3] });
    const out = await injectAgentMeta(res, { latencyMs: 12, requestId: "req_x" });
    const body = await out.json();
    expect(body._agent.latency_ms).toBe(12);
    expect(body._agent.provenance).toBe(METHODOLOGY_URL);
  });

  it("does not clobber a route-provided request_id or provenance", async () => {
    const res = NextResponse.json({
      _agent: { request_id: "route_req", provenance: "https://custom/method" },
    });
    const out = await injectAgentMeta(res, { latencyMs: 5, requestId: "mw_req" });
    const body = await out.json();
    expect(body._agent.request_id).toBe("route_req");
    expect(body._agent.provenance).toBe("https://custom/method");
    expect(body._agent.latency_ms).toBe(5); // latency is always the measured value
  });

  it("leaves error (>=400) responses untouched", async () => {
    const res = NextResponse.json({ error: "Payment Required" }, { status: 402 });
    const out = await injectAgentMeta(res, { latencyMs: 99 });
    const body = await out.json();
    expect(body._agent).toBeUndefined();
  });

  it("leaves non-JSON responses untouched", async () => {
    const res = new NextResponse("PDFBYTES", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
    const out = await injectAgentMeta(res, { latencyMs: 99 });
    expect(await out.text()).toBe("PDFBYTES");
  });

  it("leaves JSON array bodies untouched (no object to attach _agent to)", async () => {
    const res = NextResponse.json([1, 2, 3]);
    const out = await injectAgentMeta(res, { latencyMs: 99 });
    expect(await out.json()).toEqual([1, 2, 3]);
  });
});

describe("buildAgentBody", () => {
  it("omits latency_ms / provenance unless provided", () => {
    expect(buildAgentBody({ request_id: "r", cost_usd: 0.01 })).toEqual({
      request_id: "r",
      cost_usd: 0.01,
    });
  });

  it("includes latency_ms / provenance when provided", () => {
    expect(
      buildAgentBody({ request_id: "r", latency_ms: 42, provenance: "u" }),
    ).toEqual({ request_id: "r", latency_ms: 42, provenance: "u" });
  });
});
