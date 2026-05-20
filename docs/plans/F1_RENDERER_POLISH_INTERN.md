# F1 Reference Renderer — Visual Polish

**Status:** Open work, not blocking
**Owner:** UCLA intern (or anyone picking up async polish work)
**Reviewer:** Conrad Gann
**Estimated:** ~1–2 weeks part-time
**Prerequisite knowledge:** Python, matplotlib, basic typography sense. Familiarity with institutional financial reports helpful but not required.

This is a learning project. The goal is to bring the public F1 reference renderer to "publishable institutional quality" — trustworthy, clean, stable — without rewriting the architecture. You're improving an existing implementation, not starting from scratch.

---

## What you're working on

`RiskModels_API/sdk/riskmodels/snapshots/reference_renderer_fund.py` — the deterministic baseline renderer for fund-shape canonical snapshots. It produces a single-page PDF/PNG from a `CanonicalFundSnapshot` data object: header band with chips, identity rail on the left, performance chart, risk-decomposition bars, top-holdings table.

The renderer ships in the public SDK (`pip install riskmodels-py`). Anyone with the canonical contract runs it. It's the trust anchor for the GCS pre-render pipeline.

A first version landed and produces correct output but is visually cramped and rough. The current preview is at `~/Downloads/f1_renderer_pass2.{pdf,png}` if you want to see the starting point.

---

## What "publishable institutional quality" means here

The reference renderer is **deliberately less opinionated** than the BWMACRO institutional renderer. It's the public baseline — like Stripe's API docs, not Stripe's marketing site. So:

- **Yes:** clean typography, balanced spacing, restrained color, panels that breathe, edge cases handled gracefully.
- **No:** marketing flourish, narrative inserts, custom artwork, peer-comparison overlays, hedge-construction visuals. Those live in the institutional renderer (BWMACRO, private).

Reference for the bar: the existing P1 reference renderer at `sdk/riskmodels/snapshots/reference_renderer.py`. F1 should feel like a sibling to it — same design language, same breathing room, same restraint. If F1 looks worse than P1 anywhere, that's a fix candidate.

---

## Read these first

In order:

1. **`sdk/riskmodels/snapshots/reference_renderer.py`** — the P1 renderer. Read it end-to-end. This is the design template you're matching for F1.
2. **`sdk/riskmodels/snapshots/reference_renderer_fund.py`** — the F1 renderer you're polishing. Note where it diverges from P1 and ask whether the divergence is justified.
3. **`sdk/riskmodels/snapshots/_page.py`** — the layout engine (`SnapshotPage`). Header bar, chips row, footer, panel grid.
4. **`sdk/riskmodels/snapshots/_charts.py`** — chart primitives (`chart_hbar`, `chart_table`, etc.). All visual styling routes through these.
5. **`sdk/riskmodels/snapshots/_theme.py`** — `THEME` palette, typography, layout constants. Read every styling decision through `THEME`. Never hard-code colors, font sizes, line widths.
6. **`sdk/riskmodels/snapshots/canonical_fund.py`** — the data shape you're rendering. Understand what fields exist before deciding what to display.
7. **`docs/plans/F1_REFERENCE_RENDERER_SPEC.md`** — the original spec. Constraints documented there still apply.

After reading, render the synthetic fixture once before changing anything:

```bash
cd RiskModels_API
python -c "
from pathlib import Path
import sys
sys.path.insert(0, 'sdk/tests')
from test_canonical_fund_snapshot import _build_test_snapshot
from riskmodels.snapshots import render_canonical_fund_to_pdf
render_canonical_fund_to_pdf(_build_test_snapshot(), Path.home() / 'Downloads' / 'f1_baseline.pdf')
"
```

Then for each refinement, re-render and visually compare before/after. PDFs accumulate in `~/Downloads/`; keep them around so you can do side-by-side comparisons across iterations.

---

## Polish areas, ranked by impact

Take them roughly in order, but feel free to bundle small fixes from later areas if they're adjacent. Each area is independently completable.

### A. Header and title (high impact)

- Install Inter font system-wide so the renderer doesn't fall back to DejaVu Sans every run. Inter `.ttf` files: download from rsms.me/inter, drop into `~/.local/share/fonts/` on Linux or system Fonts folder on macOS.
- The header underline at `_page.py:166` (`y=0.955`) currently sits *within* the title text vertical extent (the title at `y=0.97` with `va="top"` and 14pt font reaches down to ~`y=0.947`). The line gets overdrawn by descenders. Move the line below the text baseline (try `y=0.945` or lower) so it reads as a clean separator. Same fix benefits P1.
- Subtitle right-alignment at `x=0.95` cuts off if the as-of date string is long. Test with longer subtitle strings (multi-line view? smaller font?).
- The synthetic fixture uses `__TEST_FUND__` which produces literal underscores rendering as fake underline artifacts. The current renderer strips them in `_build_page`. Real production symbol_ids won't have leading/trailing underscores, but verify with longer realistic names like `American Funds Growth Fund of America (AGTHX)` — does the title fit? Truncate gracefully if not.

### B. Performance chart (Section I)

- Legend currently lands `loc="upper left"` and overlaps the data lines. Move it outside the chart area (above or below) or use a smaller/transparent legend frame. P1 uses `loc="best"` — eyeball whether that works for F1 (it depends on data shape).
- Y-axis tick labels (`+25%`, `+20%`, ...) sit close to the IDENTITY rail. The current panel is at `cols=slice(4, 12)` to give a buffer; verify the buffer is enough on the synthetic fixture and on real fund data with more extreme returns.
- X-axis dates: synthetic fixture has only 2 data points so labels are sparse. Real funds have 252+ points. Ensure tick density is reasonable (~6 labels max), date format is readable, no rotation needed.
- Curve emphasis: target curve (the fund itself) should be visually dominant; SPY and other benchmarks should be visible but secondary. Currently both use the full series-line-width. Consider thinning benchmarks.
- When `cumulative_curves` is empty, the placeholder text "Performance series unavailable" should look intentional, not like a broken render. Consider centering it more carefully or styling it.

### C. Risk decomposition (Section II)

- Bar height and spacing: `chart_hbar` sets `bar_h = 0.55`. For 4 bars in a 5-row panel, this works. Confirm visually.
- Value annotations are at `(v + offset, y_pos[i])` with `offset = 0.4`. On small bars (e.g. 5% residual share), the annotation may collide with the next bar's category label. Test with skewed distributions (e.g. one fund where market share is 90% and others are tiny).
- Title pad: currently `pad=8` in `chart_hbar`. Adjust if needed for visual breathing room.
- Color: bars use `THEME.palette.factor_colors` — Navy/Teal/Subsector-violet/Green. Confirm the violet reads as "subsector" against the green "residual" — the current palette is institutional but worth one check at print resolution.

### D. Top holdings (Section III)

- `chart_table` defaults aren't ideal for a fund-holdings table. The Ticker column renders narrow, Wt and Resid render wide. Set explicit column proportions: roughly 35% / 30% / 35% feels right for `Ticker / Wt / Resid`.
- Empty state: "Holdings reconstruction pending" currently centers in the panel. Add a small subtitle hint like "(per-fund zarr reader in progress)" to make it feel intentional, not broken.
- When holdings are populated, render up to 8 rows. If `total_holdings_count > 8`, the caption says "120 holdings · 85% coverage" which is correct. Confirm the caption sits properly relative to the table.
- Cell padding inside `chart_table` may need adjustment — read the primitive's source and tweak there if the table feels cramped. **If you change `chart_table`, verify that P1 still renders correctly** (P1 uses it for peer cohort tables).

### E. Left rail (identity + decomposition)

- Section grouping is already in place after Pass 1. Confirm vertical breathing reads well on the synthetic fixture and on real-data fixtures (more macro factors, longer fund names).
- Section header styling (`IDENTITY`, `DECOMPOSITION`, `MACRO ρ`) uses `chip_label` font size with bold weight. Verify the visual hierarchy reads correctly — section headers should feel distinct from row labels but not shouty.
- Row label (left) and value (right) currently align with `va="top"`. Switch to `va="center"` if vertical alignment looks off.
- Long values (e.g. `$1,234.5B` for AUM, or full filer CIK numbers) should not overflow into the label column. Test with long strings.

### F. Edge cases (medium impact, helps real-data robustness)

Render the renderer against each of these and verify nothing crashes or looks broken:

- **13F filer identity** — `FilerMetadata` populated, `fund_family / share_class_count / expense_ratio / inception_date` all `None`. Subtitle should say "13F Filer Snapshot · As of …" and the rail should show filer fields, not fund fields. Build a synthetic filer snapshot to test (mirror `_build_test_snapshot` but populate `filer_metadata`).
- **Empty holdings** — `FundPortfolio(holdings=[])` with `total_holdings_count=0`. Section III should show the placeholder; the rest of the page should still render.
- **No macro correlations** — `snap.macro = None`. Left rail should not have the `MACRO ρ` section. Verify spacing recomputes properly.
- **All `None` core metrics** — `CoreMetrics()` (every field defaulted to `None`). Chips row should still render with em-dashes; left rail decomposition rows should show em-dashes.
- **Very long fund name** — `name="American Funds The Investment Company of America Class A"`. Header title should truncate or wrap gracefully, not overflow the page.
- **Single peer / no peers** — Section III placeholder when `holdings=[]`.

### G. Render determinism

This is the **inviolable constraint**. The contract test asserts that two renders of the same canonical produce byte-identical PNG bytes. If you break this, the GCS pre-render pipeline can't trust the output and the whole publication architecture breaks.

After every change, run:

```bash
cd RiskModels_API
python -m pytest sdk/tests/test_canonical_fund_snapshot.py::test_render_png_bytes_deterministic \
                  -p no:ethereum -v
```

Common causes of nondeterminism: dictionary iteration order on older Python, float-formatting locale, randomized colors, calling `now()` at render time, fonts that aren't deterministically resolved. If determinism breaks, revert and ask before proceeding.

---

## Hard constraints (do not violate)

- **Do not modify the P1 reference renderer (`reference_renderer.py`) or any P1-related code.** P1 is contract-frozen. If you find a bug there, raise it; don't fix in passing.
- **Do not import from `bwmacro.*`.** The reference renderer is part of the public boundary. It must run with only the public SDK installed.
- **Do not invoke LLM/inference at render time.** Narrative is `Judgment` data, populated upstream. The renderer reads it as data, never generates it. (Currently F1 doesn't render narrative; if you decide to expose the `Judgment` field in some way, do it as static text rendering, never an inference call.)
- **Do not extract a shared base renderer file.** It's tempting to deduplicate between P1 and F1. Resist it. The two renderers are deliberately allowed to diverge over time, and a base class makes that future divergence painful. Copy what you need; comment if helpful.
- **Do not add new fields to `canonical_fund.py`.** The data contract is locked at v2.0 ontology. Render what's there; if a field would help, raise it as a separate spec change before adding.
- **Do not change `_theme.py` palette colors, sizes, or spacing constants** without a quick check-in. The theme is shared with P1 and the BWMACRO institutional renderer; cosmetic changes ripple.
- **All visual styling reads from `THEME`.** Don't hard-code `"#002a5e"` or `fontsize=14` anywhere — pull from `THEME.palette.navy` or `THEME.type.page_title`. If a value isn't in `THEME` and you need it, propose adding a constant.

---

## Workflow recommendation

1. Make a working branch off `main`. Commit incrementally.
2. Fix one thing at a time. Render, eyeball, refine, commit.
3. Keep `~/Downloads/` around with intermediate previews so you can show before/after.
4. Run `pytest sdk/tests/test_canonical_fund_snapshot*.py -p no:ethereum -q` after every change. If anything breaks, fix or revert before continuing.
5. When you finish an area (A, B, C, ...), commit with a descriptive message — `f1-renderer: tighten holdings table column proportions`, etc.
6. When you have ~3-5 areas done, open a PR for review. Don't try to land everything in one PR; small bundles are easier to review.

---

## Acceptance criteria

When you think you're done:

- All four canonical-snapshot test files pass (P1 + F1, synthetic + contract). No regressions.
- Render determinism holds for both P1 and F1.
- Synthetic-fixture preview at `~/Downloads/f1_renderer_final.{pdf,png}` looks comparable in polish to the P1 reference renderer's output.
- Each of the F.1–F.6 edge cases renders without crashing.
- No imports from `bwmacro.*`.
- No changes to P1 code.
- No new fields on canonical dataclasses.

Submit: a PR against `main` with a description that lists which polish areas you covered, and attaches before/after preview images.

---

## Stop-and-ask boundaries

If you find yourself wanting to do any of these, **stop and ask first** rather than committing the change:

- Adding a new field to `CanonicalFundSnapshot` or any of its blocks
- Adding a new chart primitive to `_charts.py`
- Modifying `_theme.py` constants
- Changing the public API of `render_canonical_fund_to_pdf` / `_to_png` / `_to_png_bytes`
- Adding a new dependency to `pyproject.toml`
- Anything that touches BWMACRO or feels cross-repo
- Anything where you're not sure whether it's a "polish" change or an "architecture" change

Aesthetic taste calls (color tweaks, padding, font sizes within the existing `THEME`) are yours to make. Architectural calls aren't.

---

## What done looks like

The synthetic-fixture preview should pass the test of "would I be embarrassed to put this on the public docs page?" without saying "well, the institutional version is much nicer." The reference renderer doesn't need to be marketing material — but it shouldn't undercut institutional credibility either. Aim for "obviously thoughtful, deliberately restrained."

Compare your final output against the P1 reference renderer's output side-by-side. They should feel like products of the same design system at the same level of polish.

Have fun. This is genuinely good practice for production-quality matplotlib work.
