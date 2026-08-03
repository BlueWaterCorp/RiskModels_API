/**
 * The render tools must tell a model that stock subjects exist (G.72).
 *
 * A CEO session loaded a 13F filer and asked the analyst to compare BAC to
 * IBM. `watchlist_er_stacked` + `BW-STOCK-WATCHLIST` + a `tickers` payload
 * would have served the chart — verified against prod render-svc on
 * 2026-08-02 — but `render_artifact`'s description named only
 * `BW-FUND-` / `BW-FILER-` / `BW-PORTFOLIO-`, and the MCP twin repeated the
 * omission. The capability registry (`lib/agent/capabilities.ts`, and the
 * generated `mcp/data/capabilities.json`) had `BW-STOCK-…` and
 * `BW-STOCK-WATCHLIST` right the whole time, so this was drift between
 * agent-facing surfaces rather than a missing capability.
 *
 * The tests below pin the property that was violated, not a sentence: every
 * subject prefix the tools accept is named on both surfaces, and every slug
 * the *offer* strings advertise is one the capability table marks `verified`.
 * The second half is what stops the descriptions rotting the other way — they
 * previously offered `narrative_profile`, which `ARTIFACT_RENDER_CAPABILITY`
 * records as never having rendered.
 *
 * G.71 then moved the date claim. render-svc now resolves a watchlist to ONE
 * real shared date instead of labelling a disagreeing set with today's, so the
 * G.72 hedge ("NOT a date-aligned comparison") became false in the other
 * direction and the assertion below was inverted with it. Descriptions and
 * resolver have to move together or the drift G.72 closed reopens.
 *
 * "Offer" strings are deliberately a subset: the `params` description carries
 * `describeSlugParams()`, a param-applicability table that names slugs whose
 * *params* are declared regardless of whether the slug serves. Scanning it for
 * offers would flag `historical_risk_waterfall` and friends, which the table
 * mentions precisely so a model does not send a param they never honor.
 */

import { describe, expect, it } from "vitest";

import { registerRiskModelsRenderTool } from "@/lib/mcp/render-tool";
import { CHAT_TOOLS_REGISTRY } from "@/lib/chat/tools";
import { ARTIFACT_RENDER_CAPABILITY } from "@/lib/artifacts/render-client";

/** Slugs the capability table marks `verified` for the `stock` kind. */
const VERIFIED_STOCK_SLUGS = Object.entries(ARTIFACT_RENDER_CAPABILITY)
  .filter(([, byKind]) => byKind.stock?.status === "verified")
  .map(([slug]) => slug);

/** The fields that advertise what a model may ask for, as opposed to how. */
const OFFER_FIELDS = ["slug", "subject_id", "subject_payload", "subject_payload_json"];

type Surface = { all: string; offers: string };

/** Every description string the chat `render_artifact` tool shows a model. */
function chatRenderArtifact(): Surface {
  const def = CHAT_TOOLS_REGISTRY.find((t) => t.name === "render_artifact");
  if (!def) throw new Error("render_artifact is not registered on the chat tool registry");
  const fn = (
    def.openaiTool as unknown as {
      function: {
        description?: string;
        parameters: { properties: Record<string, { description?: string }> };
      };
    }
  ).function;
  const props = fn.parameters.properties;
  return {
    all: [fn.description ?? "", ...Object.values(props).map((p) => p.description ?? "")].join("\n"),
    offers: [
      fn.description ?? "",
      ...OFFER_FIELDS.map((k) => props[k]?.description ?? ""),
    ].join("\n"),
  };
}

/** Every description string the hosted MCP render tool shows a model. */
function mcpRenderArtifact(): Surface {
  let captured: { description?: string; fields: Record<string, string> } | null = null;
  registerRiskModelsRenderTool({
    registerTool: (
      _name: string,
      config: {
        description?: string;
        inputSchema: Record<string, unknown>;
      },
    ) => {
      const fields: Record<string, string> = {};
      for (const [key, field] of Object.entries(config.inputSchema)) {
        // Zod carries `.describe()` text on `.description` in v4 and on
        // `_def.description` in v3; read whichever is populated.
        const zodLike = field as { description?: string; _def?: { description?: string } };
        fields[key] = zodLike.description ?? zodLike._def?.description ?? "";
      }
      captured = { description: config.description, fields };
    },
  } as never);
  if (!captured) throw new Error("render tool did not register");
  const { description, fields } = captured as {
    description?: string;
    fields: Record<string, string>;
  };
  return {
    all: [description ?? "", ...Object.values(fields)].join("\n"),
    offers: [description ?? "", ...OFFER_FIELDS.map((k) => fields[k] ?? "")].join("\n"),
  };
}

const SURFACES: Array<[string, () => Surface]> = [
  ["chat render_artifact", chatRenderArtifact],
  ["MCP riskmodels_render_artifact", mcpRenderArtifact],
];

describe.each(SURFACES)("%s — subject-kind visibility", (_label, surface) => {
  it("names the stock subject prefix", () => {
    expect(surface().all).toContain("BW-STOCK-");
  });

  it("names the multi-ticker watchlist subject and its tickers payload", () => {
    const { all } = surface();
    expect(all).toContain("BW-STOCK-WATCHLIST");
    expect(all).toMatch(/tickers/);
  });

  it("still names every other accepted subject prefix", () => {
    const { all } = surface();
    for (const prefix of ["BW-FUND-", "BW-FILER-", "BW-PORTFOLIO-"]) {
      expect(all).toContain(prefix);
    }
  });

  it("offers at least one slug that renders for a stock subject", () => {
    const { offers } = surface();
    const offered = VERIFIED_STOCK_SLUGS.filter((slug) => offers.includes(slug));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).toContain("watchlist_er_stacked");
  });

  it("advertises no slug the capability table says never renders", () => {
    const { offers } = surface();
    const dead = Object.entries(ARTIFACT_RENDER_CAPABILITY)
      .filter(([slug]) => offers.includes(slug))
      .filter(([, byKind]) => Object.values(byKind).every((cap) => cap?.status !== "verified"))
      .map(([slug]) => slug);
    expect(dead).toEqual([]);
  });

  it("states the watchlist axis is date-aligned and where the date comes from", () => {
    // Flipped by G.71 (this asserted the opposite for one commit). The
    // render-svc resolver now puts the whole set on ONE real date — the
    // minimum of the members' own latest, or an explicit `as_of` as a
    // ceiling — and re-fetches the newer members there, so the hedge the
    // G.72 descriptions carried ("NOT a date-aligned comparison") became
    // false in the other direction.
    const { all } = surface();
    expect(all).toMatch(/shared risk-composition axis|shared composition axis/i);
    expect(all).toMatch(/ONE shared date/i);
    // Naming the date's SOURCE is the load-bearing half. A model told only
    // "date-aligned" will still date the chart from its own context; it has
    // to be pointed at the resolved value.
    expect(all).toMatch(/resolved_as_of/);
    expect(all).not.toMatch(/its own latest close/i);
    expect(all).not.toMatch(/NOT a date-aligned comparison|dates are not aligned/i);
  });

  it("tells the model that excluded members are not on the chart", () => {
    // G.71's honest-unavailable half: a member with no row at the resolved
    // date is disclosed in `as_of_alignment.excluded` rather than drawn
    // stale or dropped in silence. A description that claims alignment
    // without naming the exclusion channel would make the model assert
    // completeness the render does not have.
    const { all } = surface();
    expect(all).toMatch(/as_of_alignment/);
    expect(all).toMatch(/excluded/i);
  });
});
