/**
 * OpenBB multi_file_viewer widgets must accept POST (Workspace sends the
 * fileSelector list in the JSON body). GET-only handlers 405 and the viewer
 * shows "File Not Found".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/openbb/_lib/upstream", () => ({
  bearerFromRequest: vi.fn(() => "rm_agent_live_test"),
  upstreamGetBytes: vi.fn(),
  upstreamGet: vi.fn(),
}));

import { bearerFromRequest, upstreamGet, upstreamGetBytes } from "@/app/openbb/_lib/upstream";
import { GET as widgetsGET } from "@/app/openbb/widgets.json/route";
import { GET as tearsheetOptionsGET } from "@/app/openbb/widgets/tearsheet-options/route";
import { GET as tearsheetGET, POST as tearsheetPOST } from "@/app/openbb/widgets/tearsheet/route";
import {
  GET as scaffoldGET,
  POST as scaffoldPOST,
} from "@/app/openbb/widgets/model-scaffold/route";

const mockBytes = vi.mocked(upstreamGetBytes);
const mockGet = vi.mocked(upstreamGet);
const mockBearer = vi.mocked(bearerFromRequest);

beforeEach(() => {
  mockBytes.mockReset();
  mockGet.mockReset();
  mockBearer.mockReturnValue("rm_agent_live_test");
});

function xlsxBytes(): ArrayBuffer {
  return new TextEncoder().encode("PK\u0003\u0004 test").buffer;
}

describe("widgets.json fileSelector", () => {
  it("serves the tearsheet as html so grouped ticker refetches like tables", async () => {
    const defs = (await (
      await widgetsGET(new NextRequest("http://localhost/openbb/widgets.json"))
    ).json()) as Record<
      string,
      { type: string; params: Array<{ paramName: string; roles?: string[] }> }
    >;
    expect(defs.rm_tearsheet.type).toBe("html");
    expect((defs.rm_tearsheet as { raw?: boolean }).raw).toBe(true);
    expect(
      defs.rm_tearsheet.params.find((p) => p.roles?.includes("fileSelector")),
    ).toBeUndefined();
    expect(defs.rm_tearsheet.params.map((p) => p.paramName)).toEqual(["ticker"]);

    expect(defs.rm_model_scaffold.type).toBe("multi_file_viewer");
    const selector = defs.rm_model_scaffold.params.find((p) =>
      p.roles?.includes("fileSelector"),
    );
    expect(selector).toBeDefined();
    expect(selector!.paramName).toBe("file");
  });

  it("marks ticker-dependent widgets immediately stale so a ticker change refetches", async () => {
    const defs = (await (
      await widgetsGET(new NextRequest("http://localhost/openbb/widgets.json"))
    ).json()) as Record<string, { staleTime?: number }>;
    expect(defs.rm_tearsheet.staleTime).toBe(0);
    expect(defs.rm_model_scaffold.staleTime).toBe(0);
  });
});

describe("tearsheet-options", () => {
  it("scopes the file id to the ticker so Workspace cannot cache AAPL under IBM", async () => {
    const res = await tearsheetOptionsGET(
      new NextRequest(
        "http://localhost/openbb/widgets/tearsheet-options?ticker=IBM",
      ),
    );
    const body = (await res.json()) as Array<{ label: string; value: string }>;
    expect(body).toEqual([
      { label: "Risk Snapshot Tearsheet", value: "IBM_risk_snapshot" },
    ]);
  });
});

describe("tearsheet html widget", () => {
  const ibmMetrics = {
    ticker: "IBM",
    teo: "2026-08-18",
    metrics: {
      price_close: 185.32,
      l3_mkt_er: 0.12,
      l3_sec_er: 0.08,
      l3_sub_er: 0.05,
      l3_res_er: 0.75,
      vol_252d_ann: 0.22,
      recommended_hedge_level: "L3",
      lstar_level: "L3",
      l3_mkt_hr: -0.41,
      l3_sec_hr: 0.22,
      l3_sub_hr: 0.11,
    },
    _data_health: { data_as_of: "2026-08-18" },
  };

  it("GET ticker=IBM returns HTML with that ticker's metrics, not a PDF embed", async () => {
    mockGet.mockResolvedValueOnce({ status: 200, body: ibmMetrics });
    const res = await tearsheetGET(
      new NextRequest("http://localhost/openbb/widgets/tearsheet?ticker=IBM"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("IBM Risk Snapshot");
    expect(html).toContain("<h1>IBM</h1>");
    expect(html).toContain("75.0%");
    expect(html).not.toContain("application/pdf");
    expect(mockGet.mock.calls.at(-1)?.[0]).toBe("/metrics/IBM");
  });

  it("raw=true returns JSON rows for Copilot", async () => {
    mockGet.mockResolvedValueOnce({ status: 200, body: ibmMetrics });
    const res = await tearsheetGET(
      new NextRequest(
        "http://localhost/openbb/widgets/tearsheet?ticker=IBM&raw=true",
      ),
    );
    const rows = (await res.json()) as Array<{ metric: string; value: string }>;
    expect(rows[0]).toEqual({ metric: "Ticker", value: "IBM" });
  });

  it("POST with ticker still works if Workspace sends JSON", async () => {
    mockGet.mockResolvedValueOnce({
      status: 200,
      body: { ...ibmMetrics, ticker: "NVDA" },
    });
    const res = await tearsheetPOST(
      new NextRequest("http://localhost/openbb/widgets/tearsheet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker: "NVDA" }),
      }),
    );
    const html = await res.text();
    expect(html).toContain("NVDA Risk Snapshot");
    expect(mockGet.mock.calls.at(-1)?.[0]).toBe("/metrics/NVDA");
  });
});

describe("model-scaffold POST", () => {
  it("returns xlsx when Workspace POSTs file + ticker", async () => {
    mockBytes.mockResolvedValueOnce({
      status: 200,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: xlsxBytes(),
      error: null,
    });
    const res = await scaffoldPOST(
      new NextRequest("http://localhost/openbb/widgets/model-scaffold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticker: "AAPL",
          erp: "0.05",
          periods: "8",
          file: ["Valuation Model Scaffold"],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      data_format?: { data_type: string };
    }>;
    expect(body[0].data_format?.data_type).toBe("xlsx");
    expect(mockBytes.mock.calls.at(-1)?.[0]).toContain(
      "/fundamentals/AAPL/model-scaffold",
    );
  });

  it("GET still works without a file param", async () => {
    mockBytes.mockResolvedValueOnce({
      status: 200,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: xlsxBytes(),
      error: null,
    });
    const res = await scaffoldGET(
      new NextRequest(
        "http://localhost/openbb/widgets/model-scaffold?ticker=MSFT",
      ),
    );
    const body = (await res.json()) as Array<{
      data_format?: { filename: string };
    }>;
    expect(body[0].data_format?.filename).toBe("MSFT_model_scaffold.xlsx");
  });
});

describe("no key", () => {
  it("returns HTML asking for an API key, not 401", async () => {
    mockBearer.mockReturnValueOnce(null);
    const res = await tearsheetGET(
      new NextRequest("http://localhost/openbb/widgets/tearsheet?ticker=AAPL"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("X-API-KEY");
  });
});
