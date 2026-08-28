#!/usr/bin/env python3
"""Apply the 2026-08 price book to capabilities.ts and OPENAPI_SPEC.yaml.

Run from RiskModels_API root. Does not regenerate capabilities.json / openapi.json.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAPS = ROOT / "lib/agent/capabilities.ts"
OPENAPI = ROOT / "OPENAPI_SPEC.yaml"

# New schedule. Keys omitted here are left unchanged (free discovery endpoints).
# extra_year is billed as cost_usd + extra_year * max(0, years-1), years clamped 1–15.
BOOK: dict[str, dict] = {
    # R3 + R4 — specified
    "ticker-returns": {
        "cost_usd": 0.02,
        "extra_year": 0.01,
        "billing_code": "ticker_returns_v3",
        "legacy_cost_usd": 0.005,
        "tier": "baseline",
        "model": "per_request",
    },
    "batch-lstar": {
        "cost_usd": 0.015,
        "extra_year": 0.0075,
        "min_charge": 0.03,
        "billing_code": "batch_lstar_v2",
        "legacy_cost_usd": 0.005,
        "legacy_min_charge": 0.01,
        "tier": "premium",
        "model": "per_position",
    },
    # R1 hold (decision products) + R3 years on lstar
    "lstar": {
        "cost_usd": 0.02,
        "extra_year": 0.01,
        "billing_code": "lstar_v2",
        "legacy_cost_usd": 0.02,
        "tier": "premium",
        "model": "per_request",
    },
    "residual-signal": {
        "cost_usd": 0.02,
        "billing_code": "residual_signal_v2",
        "legacy_cost_usd": 0.02,
        "tier": "premium",
        "model": "per_request",
    },
    "residual-signal-basket": {
        "cost_usd": 0.02,
        "billing_code": "residual_signal_basket_v2",
        "legacy_cost_usd": 0.02,
        "tier": "premium",
        "model": "per_request",
    },
    # Lookups 5×
    "metrics": {"cost_usd": 0.005, "billing_code": "metrics_v4", "legacy_cost_usd": 0.001, "tier": "baseline", "model": "per_request"},
    "rankings": {"cost_usd": 0.005, "billing_code": "rankings_v4", "legacy_cost_usd": 0.001, "tier": "baseline", "model": "per_request"},
    "peers": {"cost_usd": 0.005, "billing_code": "peers_v2", "legacy_cost_usd": 0.001, "tier": "baseline", "model": "per_request"},
    "decompose-position": {"cost_usd": 0.005, "billing_code": "metrics_v4", "legacy_cost_usd": 0.001, "tier": "baseline", "model": "per_request"},
    "metrics-snapshot": {"cost_usd": 0.005, "billing_code": "metrics_snapshot_v2", "legacy_cost_usd": 0.001, "tier": "baseline", "model": "per_request"},
    "macro-factor-series": {"cost_usd": 0.005, "billing_code": "macro_factor_series_v2", "legacy_cost_usd": 0.001, "tier": "baseline", "model": "per_request"},
    # R1 — recommended basket sits with decision products
    "hedge-basket": {"cost_usd": 0.02, "billing_code": "hedge_basket_v2", "legacy_cost_usd": 0.001, "tier": "premium", "model": "per_request"},
    # Light series 5×
    "telemetry-metrics": {"cost_usd": 0.01, "billing_code": "telemetry_v3", "legacy_cost_usd": 0.002, "tier": "baseline", "model": "per_request"},
    "factor-correlation": {"cost_usd": 0.01, "billing_code": "factor_correlation_v2", "legacy_cost_usd": 0.002, "tier": "baseline", "model": "per_request"},
    "cli-query": {"cost_usd": 0.015, "billing_code": "cli_query_v2", "legacy_cost_usd": 0.003, "tier": "baseline", "model": "per_request"},
    # Daily / fund / filer reads → $0.02 (align with 1-year ticker-returns)
    "fundamentals": {"cost_usd": 0.02, "billing_code": "fundamentals_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "universe-members": {"cost_usd": 0.02, "billing_code": "universe_members_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "etf-factor-returns": {"cost_usd": 0.02, "billing_code": "etf_factor_returns_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "fund-metrics": {"cost_usd": 0.02, "billing_code": "fund_metrics_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "fund-portfolio-history": {"cost_usd": 0.02, "billing_code": "fund_portfolio_history_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "fund-nav-history": {"cost_usd": 0.02, "billing_code": "fund_nav_history_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "fund-holdings": {"cost_usd": 0.02, "billing_code": "fund_holdings_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "fund-hedge": {"cost_usd": 0.02, "billing_code": "fund_hedge_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "style-cohort-metrics": {"cost_usd": 0.02, "billing_code": "style_cohort_metrics_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "style-cohort-rankings": {"cost_usd": 0.02, "billing_code": "style_cohort_rankings_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "style-cohort-portfolio-history": {"cost_usd": 0.02, "billing_code": "style_cohort_portfolio_history_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "style-cohort-holdings": {"cost_usd": 0.02, "billing_code": "style_cohort_holdings_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "style-cohort-snapshot-json": {"cost_usd": 0.02, "billing_code": "style_cohort_snapshot_json_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "bench-active-custom": {"cost_usd": 0.02, "billing_code": "bench_active_custom_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "filer-metrics": {"cost_usd": 0.02, "billing_code": "filer_metrics_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "filer-holdings": {"cost_usd": 0.02, "billing_code": "filer_holdings_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "filer-portfolio-history": {"cost_usd": 0.02, "billing_code": "filer_portfolio_history_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    "filer-concentration": {"cost_usd": 0.02, "billing_code": "filer_concentration_v2", "legacy_cost_usd": 0.005, "tier": "baseline", "model": "per_request"},
    # Batch raw panel — 25% off 1-year ticker-returns (R2/R4); Lstar batch stays $0.015
    "batch-analysis": {
        "cost_usd": 0.015,
        "min_charge": 0.03,
        "billing_code": "batch_analysis_v4",
        "legacy_cost_usd": 0.005,
        "legacy_min_charge": 0.01,
        "tier": "premium",
        "model": "per_position",
    },
    "portfolio-returns": {
        "cost_usd": 0.01,
        "extra_year": 0.005,
        "min_charge": 0.02,
        "billing_code": "portfolio_returns_v3",
        "legacy_cost_usd": 0.004,
        "legacy_min_charge": 0.01,
        "tier": "premium",
        "model": "per_position",
    },
    # Analytics 2× (keep lstar cheaper as the decision entry)
    "risk-decomposition": {"cost_usd": 0.04, "billing_code": "l3_decomp_v4", "legacy_cost_usd": 0.02, "tier": "premium", "model": "per_request"},
    "l3-decomposition": {"cost_usd": 0.04, "billing_code": "l3_decomposition_v3", "legacy_cost_usd": 0.02, "tier": "premium", "model": "per_request"},
    "returns-decomposition": {
        "cost_usd": 0.04,
        "extra_year": 0.01,
        "billing_code": "returns_decomposition_v2",
        "legacy_cost_usd": 0.02,
        "tier": "premium",
        "model": "per_request",
    },
    "industry-panel": {"cost_usd": 0.04, "billing_code": "industry_panel_v2", "legacy_cost_usd": 0.02, "tier": "premium", "model": "per_request"},
    "cohorts": {"cost_usd": 0.04, "billing_code": "cohorts_v2", "legacy_cost_usd": 0.02, "tier": "premium", "model": "per_request"},
    "plaid-holdings": {"cost_usd": 0.10, "billing_code": "plaid_holdings_v3", "legacy_cost_usd": 0.02, "tier": "premium", "model": "per_request"},
    # Screens / attribution / indexes 5× (R1)
    "cohorts-series": {"cost_usd": 0.15, "billing_code": "cohorts_series_v2", "legacy_cost_usd": 0.03, "tier": "premium", "model": "per_request"},
    "cohorts-pnl-decomposition": {"cost_usd": 0.25, "billing_code": "cohorts_pnl_decomposition_v2", "legacy_cost_usd": 0.05, "tier": "premium", "model": "per_request"},
    "rankings-screen": {"cost_usd": 0.25, "billing_code": "rankings_screen_v2", "legacy_cost_usd": 0.05, "tier": "premium", "model": "per_request"},
    "portfolio-risk-index": {"cost_usd": 0.15, "billing_code": "portfolio_risk_index_v3", "legacy_cost_usd": 0.03, "tier": "premium", "model": "per_request"},
    "artifact-render": {"cost_usd": 0.25, "billing_code": "artifact_render_v2", "legacy_cost_usd": 0.05, "tier": "premium", "model": "per_request"},
    # JSON snapshots 5×
    "fund-snapshot-json": {"cost_usd": 0.05, "billing_code": "fund_snapshot_json_v2", "legacy_cost_usd": 0.01, "tier": "baseline", "model": "per_request"},
    "filer-snapshot-json": {"cost_usd": 0.05, "billing_code": "filer_snapshot_json_v2", "legacy_cost_usd": 0.01, "tier": "premium", "model": "per_request"},
    # PDF deliverables 5×
    "portfolio-risk-snapshot": {"cost_usd": 1.25, "billing_code": "risk_snapshot_pdf_v2", "legacy_cost_usd": 0.25, "tier": "premium", "model": "per_request"},
    "fund-snapshot-pdf": {"cost_usd": 1.25, "billing_code": "fund_snapshot_pdf_v2", "legacy_cost_usd": 0.25, "tier": "premium", "model": "per_request"},
    "style-cohort-snapshot-pdf": {"cost_usd": 0.50, "billing_code": "style_cohort_snapshot_pdf_v2", "legacy_cost_usd": 0.10, "tier": "premium", "model": "per_request"},
    "filer-snapshot-pdf": {"cost_usd": 0.25, "billing_code": "filer_snapshot_pdf_v2", "legacy_cost_usd": 0.05, "tier": "premium", "model": "per_request"},
    # Chat 5×
    "chat-risk-analyst": {
        "input_cost_per_1k": 0.005,
        "output_cost_per_1k": 0.01,
        "billing_code": "chat_risk_analyst_v3",
        "legacy_input_cost_per_1k": 0.001,
        "legacy_output_cost_per_1k": 0.002,
        "tier": "premium",
        "model": "per_token",
    },
}


def fmt_num(n: float) -> str:
    if n == 0:
        return "0"
    s = f"{n:.4f}".rstrip("0").rstrip(".")
    return s


def render_ts_pricing(spec: dict) -> str:
    lines = ["    pricing: {", f'      model: "{spec["model"]}",', f'      tier: "{spec["tier"]}",']
    if "cost_usd" in spec:
        lines.append(f"      cost_usd: {fmt_num(spec['cost_usd'])},")
    if spec.get("extra_year") is not None:
        lines.append(f"      cost_per_extra_year_usd: {fmt_num(spec['extra_year'])},")
    if "input_cost_per_1k" in spec:
        lines.append(f"      input_cost_per_1k: {fmt_num(spec['input_cost_per_1k'])},")
        lines.append(f"      output_cost_per_1k: {fmt_num(spec['output_cost_per_1k'])},")
    lines.append('      currency: "USD",')
    if "min_charge" in spec:
        lines.append(f"      min_charge: {fmt_num(spec['min_charge'])},")
    lines.append(f'      billing_code: "{spec["billing_code"]}",')
    if "legacy_cost_usd" in spec:
        lines.append(f"      legacy_cost_usd: {fmt_num(spec['legacy_cost_usd'])},")
    if "legacy_min_charge" in spec:
        lines.append(f"      legacy_min_charge: {fmt_num(spec['legacy_min_charge'])},")
    if "legacy_input_cost_per_1k" in spec:
        lines.append(f"      legacy_input_cost_per_1k: {fmt_num(spec['legacy_input_cost_per_1k'])},")
        lines.append(f"      legacy_output_cost_per_1k: {fmt_num(spec['legacy_output_cost_per_1k'])},")
    lines.append("    },")
    return "\n".join(lines)


def replace_pricing_block(text: str, cap_id: str, new_block: str) -> str:
    id_pat = re.compile(rf'id: "{re.escape(cap_id)}",')
    m = id_pat.search(text)
    if not m:
        raise SystemExit(f"capability id not found: {cap_id}")
    start = text.find("pricing: {", m.end())
    if start < 0 or start - m.end() > 4000:
        raise SystemExit(f"pricing block not found soon after {cap_id}")
    i = start + len("pricing: {")
    depth = 1
    while i < len(text) and depth:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    # include trailing comma if present
    if i < len(text) and text[i] == ",":
        i += 1
    return text[:start] + new_block + text[i:]


def patch_capabilities() -> None:
    text = CAPS.read_text()
    for cap_id, spec in BOOK.items():
        text = replace_pricing_block(text, cap_id, render_ts_pricing(spec))
    CAPS.write_text(text)
    print(f"patched {len(BOOK)} pricing blocks in {CAPS.relative_to(ROOT)}")


def patch_openapi() -> None:
    lines = OPENAPI.read_text().splitlines(keepends=True)
    n = 0
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("x-pricing:"):
            # Collect the indented block after x-pricing
            j = i + 1
            while j < len(lines) and (lines[j].startswith("        ") or lines[j].startswith("\t")):
                j += 1
            block = "".join(lines[i:j])
            cap_m = re.search(r"capability_id: ([\w-]+)", block)
            if cap_m and cap_m.group(1) in BOOK:
                spec = BOOK[cap_m.group(1)]
                if "cost_usd" in spec:
                    if "cost_usd:" in block:
                        block = re.sub(r"cost_usd: [0-9.]+", f"cost_usd: {fmt_num(spec['cost_usd'])}", block, count=1)
                    else:
                        block = block.rstrip("\n") + f"\n        cost_usd: {fmt_num(spec['cost_usd'])}\n"
                if "min_charge" in spec:
                    if "min_charge:" in block:
                        block = re.sub(r"min_charge: [0-9.]+", f"min_charge: {fmt_num(spec['min_charge'])}", block, count=1)
                    else:
                        block = re.sub(
                            r"(cost_usd: [0-9.]+\n)",
                            rf"\1        min_charge: {fmt_num(spec['min_charge'])}\n",
                            block,
                            count=1,
                        )
                if spec.get("extra_year") is not None:
                    if "cost_per_extra_year_usd:" in block:
                        block = re.sub(
                            r"cost_per_extra_year_usd: [0-9.]+",
                            f"cost_per_extra_year_usd: {fmt_num(spec['extra_year'])}",
                            block,
                            count=1,
                        )
                    else:
                        block = re.sub(
                            r"(cost_usd: [0-9.]+\n)",
                            rf"\1        cost_per_extra_year_usd: {fmt_num(spec['extra_year'])}\n",
                            block,
                            count=1,
                        )
                if "input_cost_per_1k" in spec and "input_cost_per_1k:" in block:
                    block = re.sub(
                        r"input_cost_per_1k: [0-9.]+",
                        f"input_cost_per_1k: {fmt_num(spec['input_cost_per_1k'])}",
                        block,
                        count=1,
                    )
                    block = re.sub(
                        r"output_cost_per_1k: [0-9.]+",
                        f"output_cost_per_1k: {fmt_num(spec['output_cost_per_1k'])}",
                        block,
                        count=1,
                    )
                if "billing_code:" in block:
                    block = re.sub(r"billing_code: [\w-]+", f"billing_code: {spec['billing_code']}", block, count=1)
                if "tier:" in block:
                    block = re.sub(r"tier: \w+", f"tier: {spec['tier']}", block, count=1)
                new_lines = block.splitlines(keepends=True)
                if not new_lines[-1].endswith("\n"):
                    new_lines[-1] += "\n"
                lines[i:j] = new_lines
                n += 1
                i += len(new_lines)
                continue
        i += 1
    OPENAPI.write_text("".join(lines))
    print(f"patched {n} OpenAPI x-pricing blocks")


def main() -> None:
    # capabilities.ts already patched in the first run; OpenAPI is the remaining step.
    if "--caps" in __import__("sys").argv:
        patch_capabilities()
    patch_openapi()



if __name__ == "__main__":
    main()
