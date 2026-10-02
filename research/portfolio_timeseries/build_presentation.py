"""Build the market-neutral overlay analysis PDF (Berkshire / Pershing / Appaloosa / Greenlight).

Multi-page, screen-share-friendly PDF (matplotlib PdfPages — no external deps). Pages are
rendered at 300 DPI so embedded charts stay crisp. Matter-of-fact analytical report:
findings and method, not process narration.

Run:  python sdk/portfolio_timeseries/build_presentation.py
Output: sdk/portfolio_timeseries/overlay_analysis.pdf
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
# Render literal "$" in text instead of treating $...$ as LaTeX math (mathtext).
# Without this, a bullet with two dollar amounts collapses into italic math.
try:
    matplotlib.rcParams["text.parse_math"] = False
except KeyError:  # older matplotlib without the flag — escaping handles it
    pass
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

_HERE = Path(__file__).parent
_CHARTS = _HERE / "charts"
OUT = _HERE / "overlay_analysis.pdf"

NAVY = "#002a5e"
ORANGE = "#E07000"
GREY = "#666666"
LIGHT = "#8a8a8a"
INK = "#1a1a1a"

PAGE = (11.0, 8.5)  # Letter landscape
DPI = 300
FOOT = "Market-Neutral Overlay Analysis  ·  figures from the RiskModels API v0.3.11"


def _footer(fig, pageno):
    fig.text(0.5, 0.03, FOOT, ha="center", fontsize=6.5, color=LIGHT)
    fig.text(0.965, 0.03, f"{pageno}", ha="right", fontsize=7, color=LIGHT)


def _wrap(txt, width):
    return "\n".join(textwrap.wrap(txt, width))


def title_page(pdf):
    fig = plt.figure(figsize=PAGE)
    fig.patch.set_facecolor("white")
    fig.text(0.5, 0.70, "Market-Neutral Overlay", ha="center",
             fontsize=33, fontweight="bold", color=NAVY)
    fig.text(0.5, 0.615, "Cross-manager and full-history validation", ha="center",
             fontsize=16, color=GREY)
    fig.text(0.5, 0.50, "New this update: overlay extended from Berkshire to Pershing, Appaloosa and "
             "Greenlight,\nplus a point-in-time backtest over each manager's full history.",
             ha="center", fontsize=11.5, color=INK, linespacing=1.5)
    thesis = ("Market beta falls from 0.9–1.7 to approximately zero for every manager — and, applied to "
              "each quarter's actual holdings, stays near zero across up to 20 years of history.")
    fig.text(0.5, 0.36, _wrap(thesis, 92), ha="center", fontsize=12, color=NAVY, linespacing=1.5)
    fig.text(0.5, 0.20, "Berkshire Hathaway  ·  Pershing Square  ·  Appaloosa  ·  Greenlight Capital",
             ha="center", fontsize=11, color=ORANGE, fontweight="bold")
    fig.text(0.5, 0.15, "Book dates 2025-12-31 (Greenlight 2023-12-31)  ·  RiskModels API v0.3.11",
             ha="center", fontsize=8.5, color=LIGHT)
    _footer(fig, 1)
    pdf.savefig(fig, dpi=DPI); plt.close(fig)


def content_page(pdf, pageno, title, subtitle, blocks, title_color=NAVY):
    """A text page. `blocks` = list of (heading, [bullet lines])."""
    fig = plt.figure(figsize=PAGE)
    fig.patch.set_facecolor("white")
    fig.text(0.06, 0.92, title, fontsize=20, fontweight="bold", color=title_color)
    if subtitle:
        fig.text(0.06, 0.875, subtitle, fontsize=10.5, color=GREY)
    y = 0.82
    for heading, bullets in blocks:
        if heading:
            fig.text(0.06, y, heading, fontsize=12.5, fontweight="bold", color=ORANGE)
            y -= 0.045
        for b in bullets:
            marker, txt = ("", b[1:].strip()) if b.startswith("~") else ("•  ", b)
            wrapped = textwrap.wrap(txt, 104)
            for i, line in enumerate(wrapped):
                prefix = marker if i == 0 else ("   " if marker else "")
                fig.text(0.08, y, prefix + line, fontsize=9.8, color=INK)
                y -= 0.032
            y -= 0.006
        y -= 0.02
    _footer(fig, pageno)
    pdf.savefig(fig, dpi=DPI); plt.close(fig)


def chart_page(pdf, pageno, title, image, findings, subtitle=None):
    """Full-width chart with a findings strip beneath."""
    fig = plt.figure(figsize=PAGE)
    fig.patch.set_facecolor("white")
    fig.text(0.06, 0.945, title, fontsize=16, fontweight="bold", color=NAVY)
    if subtitle:
        fig.text(0.06, 0.912, subtitle, fontsize=9.5, color=GREY)
    img = plt.imread(str(image))
    ih, iw = img.shape[0], img.shape[1]
    aspect = iw / ih
    box_l, box_b, box_w, box_h = 0.05, 0.30, 0.90, 0.575
    box_ar = (box_w * PAGE[0]) / (box_h * PAGE[1])
    if aspect > box_ar:
        w = box_w; h = box_w * PAGE[0] / aspect / PAGE[1]
    else:
        h = box_h; w = box_h * PAGE[1] * aspect / PAGE[0]
    l = box_l + (box_w - w) / 2
    b = box_b + (box_h - h) / 2
    ax = fig.add_axes([l, b, w, h])
    ax.imshow(img, interpolation="lanczos"); ax.axis("off")
    y = 0.255
    fig.text(0.06, y, "Findings", fontsize=11, fontweight="bold", color=ORANGE)
    y -= 0.038
    for f in findings:
        for i, line in enumerate(textwrap.wrap(f, 118)):
            fig.text(0.07, y, ("•  " if i == 0 else "   ") + line, fontsize=9.2, color=INK)
            y -= 0.028
        y -= 0.004
    _footer(fig, pageno)
    pdf.savefig(fig, dpi=DPI); plt.close(fig)


def table_page(pdf, pageno, title, subtitle, headers, rows, notes):
    fig = plt.figure(figsize=PAGE)
    fig.patch.set_facecolor("white")
    fig.text(0.06, 0.93, title, fontsize=18, fontweight="bold", color=NAVY)
    fig.text(0.06, 0.885, subtitle, fontsize=9.5, color=GREY)
    ax = fig.add_axes([0.06, 0.42, 0.88, 0.42]); ax.axis("off")
    tbl = ax.table(cellText=rows, colLabels=headers, loc="center", cellLoc="center")
    tbl.auto_set_font_size(False); tbl.set_fontsize(9.5); tbl.scale(1, 1.9)
    for (r, c), cell in tbl.get_celld().items():
        cell.set_edgecolor("#d0d0d0")
        if r == 0:
            cell.set_facecolor(NAVY); cell.set_text_props(color="white", fontweight="bold")
        elif rows[r - 1][0]:
            cell.set_facecolor("#eef2f7")
    y = 0.33
    fig.text(0.06, y, "Notes", fontsize=11, fontweight="bold", color=ORANGE)
    y -= 0.04
    for n in notes:
        for i, line in enumerate(textwrap.wrap(n, 118)):
            fig.text(0.07, y, ("•  " if i == 0 else "   ") + line, fontsize=9.2, color=INK)
            y -= 0.028
        y -= 0.004
    _footer(fig, pageno)
    pdf.savefig(fig, dpi=DPI); plt.close(fig)


def build():
    with PdfPages(OUT) as pdf:
        p = 1
        title_page(pdf); p += 1

        # ---- Executive summary -------------------------------------------------
        content_page(pdf, p, "Executive Summary",
            "What we found, and what it means",
            [
                ("The question", [
                    "Can a transparent basket of ETF trades take a manager's stock portfolio, cancel its "
                    "exposure to the overall market, and leave only the manager's own stock selection — and "
                    "does that work reliably, on more than just Berkshire?",
                ]),
                ("What we found", [
                    "Yes. On all four managers the overlay cuts the portfolio's market sensitivity (its "
                    "beta) from roughly 1 down to roughly 0. Beta near 1 means the portfolio moves with the "
                    "market; near 0 means it barely responds to the market at all. The overlay converts a "
                    "market-driven book into a market-neutral one.",
                    "This holds not only on today's portfolio but on each manager's actual portfolio in "
                    "every quarter, back as far as 20 years — so it is a robust, repeatable effect, not a "
                    "one-off fit to current holdings.",
                ]),
                ("What it means", [
                    "As a hedging tool this is exactly the result we want: any of these managers' books can "
                    "be stripped of market risk with a clear, tradable set of ETF positions, leaving the "
                    "part that reflects stock picking, isolated from the market's direction.",
                    "One honest implication: once market and sector exposure is removed, what remains is "
                    "small — most of these managers' historical return came from market and sector exposure, "
                    "not stock selection. For a hedging tool that is fine (the goal is removing risk, not "
                    "adding return), but it is worth being clear-eyed about.",
                ]),
            ]); p += 1

        # ======================================================================
        # FINDING 1 — the headline: does it work, and does it hold up over time?
        # ======================================================================
        content_page(pdf, p, "Finding 1 — The result: the hedge works over full history",
            "The core result, and why it is credible",
            [
                ("What we did", [
                    "For each manager we reconstructed their actual portfolio in every quarter of their "
                    "history, applied the market-neutral overlay to that quarter's real holdings, and "
                    "chained the quarters together. This is the honest 'point-in-time' test — at each date "
                    "it uses only the portfolio that was actually held then, never information from later.",
                ]),
                ("What it shows", [
                    "The raw portfolios compounded enormously, and almost all of it is market and sector "
                    "exposure: Berkshire's raw book returned +487% over its ~12-year window (about 15% a "
                    "year), while its hedged version is nearly flat. Across all four, hedged cumulative "
                    "returns land between −1% and +37%.",
                    "Note the cumulative totals are NOT compared head-to-head: each manager's history is a "
                    "different length (10 to 20 years), so a bigger total often just means a longer window. "
                    "The per-manager windows are labelled on the chart.",
                    "The hedged beta stays near zero the whole way through: Berkshire +0.05 (46 quarters), "
                    "Pershing +0.19 (72 quarters), Appaloosa −0.03 (40 quarters), Greenlight −0.07 (70 quarters). "
                    "Raw betas were +0.9 to +1.5.",
                ]),
                ("Why this is the credible test", [
                    "Earlier work applied today's holdings to past returns. Over long windows that drifts — "
                    "Berkshire's hedged beta crept to 0.22 at two years — because today's portfolio is not "
                    "what was held years ago. Doing it properly, on each quarter's real book, removes that "
                    "drift. So the near-zero beta is a genuine, through-time property of the hedge, not an "
                    "artifact of the measurement.",
                ]),
                ("Bottom line", [
                    "The overlay reliably removes market risk from these books, demonstrated across four "
                    "managers and up to two decades — not a curve-fit to current positions. In the chart "
                    "that follows, look for the navy (raw) line climbing and the orange (hedged) line staying flat.",
                ]),
            ]); p += 1

        chart_page(pdf, p, "Finding 1 — The chart: full history, point-in-time",
            _CHARTS / "full_history_backtest.png",
            ["Each panel is one manager. Navy = the raw portfolio; orange = the same portfolio with the "
             "overlay applied.",
             "Navy climbs steeply (rode the market up); orange stays close to flat (market ride removed). "
             "Panel headers show raw β ~1–1.5 collapsing to hedged β ~0.",
             "Pershing and Greenlight run back to 2005 (20 years). Even Greenlight's stale, partially "
             "restricted book hedges to roughly zero."],
            subtitle="charts/full_history_backtest.png"); p += 1

        # ======================================================================
        # FINDING 2 — how much of each manager's risk the overlay is removing
        # ======================================================================
        content_page(pdf, p, "Finding 2 — Each manager's risk is built differently",
            "What the overlay is removing, manager by manager",
            [
                ("What it shows", [
                    "Every portfolio's risk splits into four parts: the overall market, its sector tilts, "
                    "its finer sub-industry tilts, and stock-specific risk (the manager's individual picks). "
                    "The mix is very different across managers.",
                    "Stock-specific share: Greenlight 87% (an almost pure stock-picking book), Pershing 70%, "
                    "Appaloosa 64%, Berkshire 61%. Berkshire carries the most sector risk (22%), reflecting "
                    "its heavy concentration in financials and consumer staples.",
                ]),
                ("Why it matters for the hedge", [
                    "The overlay removes the first three parts (market, sector, sub-sector) and leaves the "
                    "stock-specific part. So this chart tells you how much work the overlay is doing on each "
                    "book: a manager who is 87% stock-specific (Greenlight) has little for the overlay to "
                    "remove, while a manager with a big sector component (Berkshire) needs a substantial "
                    "sector hedge.",
                    "It also confirms these are genuinely different portfolios — which makes the fact that "
                    "the same method neutralizes all of them meaningful, not a coincidence of similar books.",
                ]),
                ("Bottom line", [
                    "One method, but it adapts to each book — the amount and type of hedging is set by that "
                    "manager's actual risk composition.",
                ]),
            ]); p += 1

        chart_page(pdf, p, "Finding 2 — Risk decomposition by manager",
            _CHARTS / "risk_decomposition_stacked.png",
            ["Each bar is one manager, split into market / sector / sub-sector / stock-specific risk.",
             "Green (stock-specific) share: Berkshire 61% · Pershing 70% · Appaloosa 64% · Greenlight 87%.",
             "The taller the non-green portion, the more the overlay is removing for that manager."],
            subtitle="charts/risk_decomposition_stacked.png"); p += 1

        # ======================================================================
        # FINDING 3 — why a hedge holds some long ETF positions
        # ======================================================================
        content_page(pdf, p, "Finding 3 — Why a hedge holds a few long ETF positions",
            "Explaining the counter-intuitive long legs",
            [
                ("The puzzle", [
                    "A hedge is supposed to be short. Yet the overlay holds a handful of ETFs long, which "
                    "looks wrong at first glance. This chart makes the reason concrete.",
                ]),
                ("The mechanism", [
                    "To cancel market risk the overlay shorts the S&P 500 (via the SPY ETF). But the S&P 500 "
                    "is itself about one-third technology. Berkshire's book looks ~36% technology on paper — "
                    "but that is almost entirely a single stock, Apple. Outside Apple, Berkshire holds almost "
                    "no tech (~1%), versus the S&P's ~32%.",
                    "So when the overlay shorts the S&P to remove market risk, it accidentally over-shorts "
                    "technology — far more tech than Berkshire actually owns. To correct that, the overlay "
                    "buys a technology ETF back. The long tech position is not a bet; it is fixing the "
                    "over-hedge that shorting the index created.",
                ]),
                ("The implication — a design choice for us", [
                    "The overlay is built bottom-up, from the specific stocks Berkshire holds. A side effect: "
                    "it only adjusts sectors the book has some exposure to. A sector Berkshire owns nothing "
                    "in — e.g. Health Care, ~11% of the S&P — gets shorted by the index hedge but never "
                    "corrected, because no held stock points to it. Whether we keep that, or move to a "
                    "top-down hedge that also corrects fully-absent sectors, is an open decision.",
                ]),
            ]); p += 1

        chart_page(pdf, p, "Finding 3 — The long-ETF mechanism (Berkshire)",
            _CHARTS / "long_etf_explainer.png",
            ["Left: Berkshire's sector weights vs the S&P 500's — note the tech bar is almost all Apple.",
             "Right: the overlay's net position per sector — red = short, green = long. Financials −$91M and "
             "Consumer Staples −$26M are the big shorts; technology comes out a small long (+$7M).",
             "Health Care shows $0: the book holds none, so the bottom-up overlay never corrects it.",
             "Scale note: dollar figures use the API's compressed adj_mv units — read −$91M as roughly "
             "−$91B (a known data bug; weights and the mechanism are unaffected)."],
            subtitle="charts/long_etf_explainer.png  (S&P sector weights are a public reference; the book "
                     "and overlay are from the API)"); p += 1

        # ======================================================================
        # Implications
        # ======================================================================
        content_page(pdf, p, "What This Means — the overlay as a hedging tool",
            "Putting the findings together",
            [
                ("What we can now do with it", [
                    "Take any of these managers' disclosed 13F books and produce a market-neutral version — "
                    "the portfolio with its market, sector and sub-sector exposure cancelled by a "
                    "transparent, tradable basket of ETFs — isolating the manager's stock selection from the "
                    "market's direction.",
                    "Because it is demonstrated across four different managers and up to 20 years, it can be "
                    "applied to a new manager's book with reasonable confidence, not just the ones tested.",
                ]),
                ("Why that is valuable", [
                    "It converts a market-directional 13F book into a market-neutral exposure — useful for "
                    "anyone who wants a manager's stock-picking without the market risk, or who wants to "
                    "hedge the market exposure of a book they already hold.",
                    "The overlay is fully transparent and built from liquid ETFs (SPY plus sector and "
                    "sub-sector funds), so it is implementable — not a black box.",
                ]),
                ("What to keep in mind", [
                    "This is measured as attribution, not a live traded strategy: it does not yet include "
                    "the cost of financing the shorts, ETF tracking error, or the cost of rebalancing each "
                    "quarter. Those must be added before hedged returns are treated as achievable P&L.",
                    "The residual (post-hedge) return on these books is small, so the value here is clean "
                    "risk removal and attribution, not extra return.",
                ]),
            ]); p += 1

        # ======================================================================
        # Residual vs. Buffett's Alpha (2 pages)
        # ======================================================================
        content_page(pdf, p, "The Small Residual vs. “Buffett's Alpha”  (1 of 2)",
            "The uncomfortable finding, and why it does not contradict the project's framing",
            [
                ("What our data shows", [
                    "Stripped of market, sector and sub-sector exposure, these 13F equity books show little "
                    "residual (stock-specific) return. Berkshire's raw book returned +487% over 2013–2025; the "
                    "hedged, selection-only version is nearly flat. On the disclosed equity book, over this "
                    "period, against a sector-aware model, idiosyncratic return is small.",
                    "This is worth confronting head-on, because the project has been framed around "
                    "“Buffett's Alpha” (Frazzini, Kabiller & Pedersen, 2018), whose whole claim is that "
                    "Berkshire's residual IS meaningful.",
                ]),
                ("Why it does not actually contradict Buffett's Alpha", [
                    "The two results measure different things — theirs is not wrong and ours is not wrong:",
                    "Different object: they measured Berkshire's TOTAL returns — the operating businesses "
                    "(GEICO, BNSF) plus ~1.6× leverage from insurance float — not the unlevered 13F equity "
                    "book. That leverage, which they found was roughly half the story, is invisible in 13F data.",
                    "Different era: their window was 1976–2011; ours starts 2013. Berkshire's edge is widely "
                    "thought to have compressed as the book grew past $170B.",
                    "Stricter model: their factors were market, size, value, BAB and QMJ; ours are market + "
                    "sector + sub-sector. Sector tilts their model would partly score as alpha, ours correctly "
                    "labels as factor exposure. A stricter test yields a smaller residual — the model working, "
                    "not failing.",
                ]),
            ]); p += 1

        content_page(pdf, p, "The Small Residual vs. “Buffett's Alpha”  (2 of 2)",
            "What it means for the narrative — and the decision for Conrad",
            [
                ("The honest framing", [
                    "It is NOT “Buffett has no alpha.” It is: the publicly disclosed equity book, measured "
                    "2013–2025 against a sector-aware factor model, shows little idiosyncratic return — which "
                    "is consistent with Buffett's Alpha once you account for the leverage and operating "
                    "businesses 13F cannot see, and for a later, larger, harder period.",
                ]),
                ("Why this makes the finding stronger, not weaker", [
                    "Saying exactly why the residual is small — different object, era, and model — is the "
                    "correct scientific framing. It shows the method is doing its job (cleanly separating "
                    "factor exposure from selection), not that the analysis failed.",
                ]),
                ("The decision for Conrad", [
                    "This reshapes the whitepaper. It can no longer be “we replicated Buffett's Alpha.” The "
                    "data supports a different, arguably stronger thesis: “what 13F disclosure can and cannot "
                    "tell you about manager skill” — a paper nobody has written.",
                    "That is a scope change worth agreeing with Conrad explicitly at this meeting, because it "
                    "changes the deliverable he is expecting.",
                ]),
            ]); p += 1

        # ---- MCP / reproducing ------------------------------------------------
        content_page(pdf, p, "API Access (MCP)",
            "Connecting an agent to the RiskModels API to reproduce this analysis",
            [
                ("The MCP server", [
                    "Exposes the RiskModels API schema and capabilities to an agent, so the agent knows "
                    "which endpoints exist and what parameters they take. Two tool classes: discovery "
                    "(list endpoints, read capabilities, fetch schemas — no key) and data (decompose, "
                    "metrics, portfolio risk — key required).",
                ]),
                ("Setup", [
                    "One API key at ~/.config/riskmodels/config.json is read by both the MCP server and the "
                    "Python SDK. Configs provided for Claude Code, Claude Desktop, and Cursor.",
                ]),
                ("Known parameter pitfalls", [
                    "as_of refers to report dates; TEO accounts for the SEC reporting lag — passing as_of "
                    "where TEO is meant introduces look-ahead.",
                    "search_filers does not match zero-padded CIKs; resolve via BW-FILER-CIK{cik.zfill(10)}.",
                    "adj_mv has a scale inconsistency across managers, so absolute-$ labels are unreliable "
                    "cross-manager (weights and betas are unaffected).",
                    "filing_date is null on the full holdings fetch (populated with limit=5).",
                    "The portfolio endpoint's per-quarter returns are forward (quarter T = book at T over T→T+1Q).",
                ]),
                ("Reference", ["Full guide, replication prompt, and worked example: MCP_SETUP.md"]),
            ]); p += 1

        # ---- Open questions & limitations -------------------------------------
        content_page(pdf, p, "Open Questions & Limitations",
            "Decisions and caveats to resolve before any production use",
            [
                ("Open questions", [
                    "Bottom-up vs. top-down overlay: the current per-stock overlay does not hedge sectors "
                    "the book omits entirely (e.g. Berkshire Health Care $0 despite SPY ~11%). A top-down "
                    "index-relative hedge would. Which is intended?",
                    "Leverage cap: none is currently applied. A concentrated book's netted overlay can "
                    "exceed 100% of gross long because sub-sector betas compound.",
                ]),
                ("Data limitations", [
                    "adj_mv scale inconsistency across managers within the same quarter blocks absolute-$ "
                    "reporting; weights and betas (scale-invariant) are unaffected.",
                    "Greenlight's latest 13F is 2023-12-31 (stale) and 27.5% of the book is a "
                    "confidential-treatment line with no return series — its results are the weakest evidence.",
                    "Static overlay backtests (the window-based charts) drift at long horizons; the "
                    "point-in-time backtest is the reliable full-history measure.",
                ]),
                ("Scope", [
                    "All figures are portfolio-level attribution and hedge-ratio construction, not modeled "
                    "trade execution: overlay financing, ETF tracking error, and rebalancing costs are "
                    "excluded.",
                ]),
            ]); p += 1

        # ---- Supporting files -------------------------------------------------
        content_page(pdf, p, "Supporting Files",
            "Under sdk/portfolio_timeseries/",
            [
                ("Charts in this pack (each: high-res .png, web .png, .md caption — in charts/)", [
                    "risk_decomposition_stacked.png                — risk decomposition by manager",
                    "long_etf_explainer.png                        — the long-ETF mechanism",
                    "full_history_backtest.png                     — full-history point-in-time backtest",
                ]),
                ("Documents", [
                    "overlay_analysis.pdf     — this document",
                    "MCP_SETUP.md             — API access, replication prompt, gotchas",
                    "DATA_ISSUES.md           — running list of API data issues",
                    "MEETING_PACK_WEEK2.md    — one-page summary",
                ]),
                ("Also on disk (not in this pack)", [
                    "pershing / appaloosa / greenlight _raw_vs_hedged_multi_window.png — the per-manager "
                    "multi-window charts and hedge_effectiveness_summary.md (superseded by the "
                    "full-history point-in-time backtest).",
                    "Cached inputs: overlay_data.json, risk_detail.json, full_history_backtest.json (in charts/).",
                ]),
            ]); p += 1

    print("[written]", OUT, f"({OUT.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    build()
