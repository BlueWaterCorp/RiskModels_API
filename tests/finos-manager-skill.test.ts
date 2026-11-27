import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as appsGET } from "@/app/finos/apps.json/route";
import { GET as widgetGET } from "@/app/finos/widgets/manager-skill-review/route";
import { GET as widgetsGET } from "@/app/finos/widgets.json/route";

const SNAPSHOT = {
  bw_filer_id: "BW-FILER-CIK0001067983",
  cik: "0001067983",
  name: "Berkshire Hathaway Inc.",
  filer_type: "investment_company",
  report_date: "2026-09-30",
  filing_date: "2026-11-13",
  metrics: {
    total_aum_usd: 300_000_000_000,
    n_holdings_active: 42,
    effective_n: 8.4,
    top10_weight_sum: 0.91,
    model_version: "erm3-test",
  },
  coverage: { coverage_in_erm3: 0.94, aum_in_erm3: 282_000_000_000 },
  holdings: {
    n_total_holdings: 42,
    top: [
      {
        security_id: "BW-SYM-AAPL",
        ticker: "AAPL",
        name: "Apple Inc.",
        weight: 0.22,
        adj_mv: 66_000_000_000,
      },
    ],
  },
  erm3_decomposition: {
    monthly_returns: [{ teo: "2026-09-30" }],
    variance_shares_full: {
      market: 0.55,
      sector: 0.14,
      subsector: 0.08,
      style: 0.03,
      residual: 0.2,
    },
    variance_shares_recent: {
      market: 0.5,
      sector: 0.15,
      subsector: 0.1,
      style: 0.04,
      residual: 0.21,
    },
    waterfall_latest_month: {
      portfolio_market_return: 0.02,
      portfolio_sector_return: 0.003,
      portfolio_subsector_return: 0.001,
      portfolio_style_return: -0.001,
      portfolio_idiosyncratic_return: 0.004,
    },
  },
  _metadata: {
    model_version: "erm3-test",
    factor_set_id: "l3-v4",
    data_as_of: "2026-09-30",
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(SNAPSHOT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

describe("FINOS Workspace manifests", () => {
  it("publishes one pinned, descriptive Manager Skill Review app", async () => {
    const widgets = await (
      await widgetsGET(new NextRequest("http://localhost/finos/widgets.json"))
    ).json();
    const apps = await (
      await appsGET(new NextRequest("http://localhost/finos/apps.json"))
    ).json();

    expect(Object.keys(widgets)).toEqual(["rm_manager_skill_review"]);
    expect(widgets.rm_manager_skill_review).toMatchObject({
      type: "html",
      endpoint: "widgets/manager-skill-review",
      raw: false,
      disableRetrievalForCopilot: true,
    });
    expect(widgets.rm_manager_skill_review.description.toLowerCase()).toContain(
      "does not rank managers",
    );
    expect(apps).toHaveLength(1);
    expect(apps[0].templateId).toBe("riskmodels-manager-skill-review");
    expect(apps[0].tabs.review.layout[0].i).toBe("rm_manager_skill_review");
    expect(apps[0]).not.toHaveProperty("mcpServers");
  });
});

describe("Manager Skill Review widget", () => {
  it("requires the FINOS backend connection token", async () => {
    const response = await widgetGET(
      new NextRequest("http://localhost/finos/widgets/manager-skill-review"),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      detail: "Connect FINOS Workspace with a RiskModels API token.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders the Berkshire review without ranks or predictive claims", async () => {
    const response = await widgetGET(
      new NextRequest(
        "http://localhost/finos/widgets/manager-skill-review?theme=light",
        { headers: { Authorization: "Bearer rm_agent_live_test" } },
      ),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://riskmodels.app/api/13f/filers/BW-FILER-CIK0001067983/snapshot",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer rm_agent_live_test",
        }),
      }),
    );
    expect(html).toContain("Berkshire Hathaway Inc.");
    expect(html).toContain("Largest reported holdings");
    expect(html).toContain("Return · 2026-09-30");
    expect(html).toContain("Risk shares describe exposure");
    expect(html).toContain("No manager rank or forecast is shown.");
    expect(html).not.toMatch(/percentile|ranked managers|manager score/i);
    expect(html).not.toMatch(/predictive skill/i);
    expect(html).not.toMatch(/alpha/i);
  });

  it("escapes upstream labels before rendering HTML", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...SNAPSHOT,
          name: '<img src=x onerror="alert(1)">',
          holdings: {
            n_total_holdings: 1,
            top: [{ ticker: "X", name: "<script>bad()</script>", weight: 1 }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const response = await widgetGET(
      new NextRequest("http://localhost/finos/widgets/manager-skill-review", {
        headers: { Authorization: "rm_agent_live_test" },
      }),
    );
    const html = await response.text();
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>bad()</script>");
  });

  it("allows only configured FINOS origins", async () => {
    const allowed = await widgetsGET(
      new NextRequest("http://localhost/finos/widgets.json", {
        headers: { Origin: "http://localhost:3000" },
      }),
    );
    const denied = await widgetsGET(
      new NextRequest("http://localhost/finos/widgets.json", {
        headers: { Origin: "https://untrusted.example" },
      }),
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
