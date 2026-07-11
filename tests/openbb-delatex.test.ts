import { describe, expect, it } from "vitest";
import { deLatex } from "@/app/openbb/_lib/delatex";

describe("deLatex", () => {
  it("converts display blocks to plain inline code", () => {
    expect(deLatex("$$\\text{Cost of Equity} = R_f + \\beta \\times \\text{ERP}$$")).toBe(
      "`Cost of Equity = R_f + β × ERP`",
    );
  });

  it("converts LaTeX-shaped inline math", () => {
    expect(deLatex("where $R_{f}$ is the rate and $\\beta$ is sensitivity")).toBe(
      "where R_f is the rate and β is sensitivity",
    );
  });

  it("leaves dollar amounts alone — including two in one sentence", () => {
    const s = "buybacks of $12.29B versus dividends of $3.82B";
    expect(deLatex(s)).toBe(s);
    const t = "EP of $146.3 billion and equity of $60B";
    expect(deLatex(t)).toBe(t);
  });

  it("converts \\frac and unknown commands degrade to bare words", () => {
    expect(deLatex("$$\\frac{E}{D+E} \\cdot R_e$$")).toBe("`(E / D+E) · R_e`");
    expect(deLatex("$\\gamma_{t}$")).toBe("gamma_t");
  });

  it("handles \\[..\\] and \\(..\\) variants", () => {
    expect(deLatex("\\[R_d \\times (1-T)\\]")).toBe("`R_d × (1-T)`");
    expect(deLatex("\\(R_e\\)")).toBe("R_e");
  });
});
