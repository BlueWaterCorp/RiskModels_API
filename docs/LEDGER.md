# RiskModels_API Ledger — closed work, append-only

One line per closed item: `date · id · outcome · ref`. Newest first. The narrative lives
in the PR / commit / ADR the ref points to — this is the index, not a copy. An item is
added here at the moment it is cut from `BACKLOG.md`; a partial ship gets a line for the
shipped half while the remainder stays open there.

`BWMACRO/scripts/backlog_dispatch.py` instructs workers to close a master row by
appending a line here and cutting the row, rather than marking it ✅ in place.

Process: `BWMACRO/docs/architecture/BACKLOG_LEDGER_CHECKLIST_PROCESS.md`.

## 2026-10
- 2026-10-20 · RMAPI-28 · CLOSED: the filer 9-box style lookup read `filers_latest`, which no migration creates (PostgREST 404, error swallowed, so filers never got a 9-box); it now reads `filer_portfolios_latest.dominant_9box` (written by the Funds_DAG sync; 14,223 of 15,705 rows set) and logs a failed lookup. · this PR
- 2026-10-15 · RMAPI-15 · CLOSED: `/portfolio/exposure` adds `beta.risk_basis` (xᵀΣe_SPY/σ²_SPY beside the labelled L1 beta), `scenario_inputs` (ETF beta_to_spy and vol; per-name rows with `include_positions`), a `top_contributors` length parameter (1-1000 or "all"), the `hedge_added_variance` warning threshold 1.02 (owner decision 2026-10-15), and docs for the 2011-12-07 as_of floor and `X-Balance-Remaining` units (50,000 per USD). · #475
- 2026-10-15 · RMAPI-14 · PARTIAL: `/portfolio/exposure` reason codes `etf_outside_priced_universe` / `etf_no_return_history_in_window` with `see` (dropped and `etfs_excluded_from_covariance`), ERM3 register mirrored to `mcp/data/etf_register.json`, and `beta_to_spy` per ETF held; the rest stays open. · #475
- 2026-10-13 · Backlog migration · CLOSED: repo ids RMAPI-n introduced; 13 item(s) moved in from the archived master (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`), each naming its master row. · migration PR

## 2026-09
