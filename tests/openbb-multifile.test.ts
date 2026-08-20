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
}));

import { bearerFromRequest, upstreamGetBytes } from "@/app/openbb/_lib/upstream";
import { GET as widgetsGET } from "@/app/openbb/widgets.json/route";
import { GET as tearsheetGET, POST as tearsheetPOST } from "@/app/openbb/widgets/tearsheet/route";
import {
  GET as scaffoldGET,
  POST as scaffoldPOST,
} from "@/app/openbb/widgets/model-scaffold/route";

const mockBytes = vi.mocked(upstreamGetBytes);
const mockBearer = vi.mocked(bearerFromRequest);

beforeEach(() => {
  mockBytes.mockReset();
  mockBearer.mockReturnValue("rm_agent_live_test");
});

function pdfBytes(): ArrayBuffer {
  return new TextEncoder().encode("%PDF-1.4 test").buffer;
}

function xlsxBytes(): ArrayBuffer {
  return new TextEncoder().encode("PK\u0003\u0004 test").buffer;
}

describe("widgets.json fileSelector", () => {
  it("requires a fileSelector param on both multi_file_viewer widgets", async () => {
    const defs = (await (
      await widgetsGET(new NextRequest("http://localhost/openbb/widgets.json"))
    ).json()) as Record<
      string,
      { type: string; params: Array<{ paramName: string; roles?: string[] }> }
    >;
    for (const id of ["rm_tearsheet", "rm_model_scaffold"]) {
      expect(defs[id].type).toBe("multi_file_viewer");
      const selector = defs[id].params.find((p) =>
        p.roles?.includes("fileSelector"),
      );
      expect(selector, id).toBeDefined();
      expect(selector!.paramName).toBe("file");
    }
  });
});

describe("tearsheet POST", () => {
  it("returns a pdf payload when Workspace POSTs the fileSelector body", async () => {
    mockBytes.mockResolvedValueOnce({
      status: 200,
      contentType: "application/pdf",
      bytes: pdfBytes(),
      error: null,
    });
    const res = await tearsheetPOST(
      new NextRequest("http://localhost/openbb/widgets/tearsheet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker: "AAPL", file: ["risk_snapshot"] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      data_format?: { data_type: string; filename: string };
      error_type?: string;
    }>;
    expect(body[0].error_type).toBeUndefined();
    expect(body[0].data_format?.data_type).toBe("pdf");
    expect(body[0].data_format?.filename).toBe("AAPL_risk_snapshot.pdf");
  });

  it("GET still works", async () => {
    mockBytes.mockResolvedValueOnce({
      status: 200,
      contentType: "application/pdf",
      bytes: pdfBytes(),
      error: null,
    });
    const res = await tearsheetGET(
      new NextRequest(
        "http://localhost/openbb/widgets/tearsheet?ticker=NVDA&file=risk_snapshot",
      ),
    );
    const body = (await res.json()) as Array<{
      data_format?: { filename: string };
    }>;
    expect(body[0].data_format?.filename).toBe("NVDA_risk_snapshot.pdf");
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
  it("returns unauthorized payload, not 401", async () => {
    mockBearer.mockReturnValueOnce(null);
    const res = await tearsheetPOST(
      new NextRequest("http://localhost/openbb/widgets/tearsheet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker: "AAPL", file: ["risk_snapshot"] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ error_type: string }>;
    expect(body[0].error_type).toBe("unauthorized");
  });
});
