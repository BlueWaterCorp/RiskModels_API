# RiskModels_API Ledger — closed work, append-only

One line per closed item: `date · id · outcome · ref`. Newest first. The narrative lives
in the PR / commit / ADR the ref points to — this is the index, not a copy. An item is
added here at the moment it is cut from `BACKLOG.md`; a partial ship gets a line for the
shipped half while the remainder stays open there.

`BWMACRO/scripts/backlog_dispatch.py` instructs workers to close a master row by
appending a line here and cutting the row, rather than marking it ✅ in place.

Process: `BWMACRO/docs/architecture/BACKLOG_LEDGER_CHECKLIST_PROCESS.md`.

## 2026-10
- 2026-10-13 · Backlog migration · CLOSED: repo ids RMAPI-n introduced; 13 item(s) moved in from the archived master (`BWMACRO/docs/ceo/archive/MASTER_BACKLOG_2026-10.md`), each naming its master row. · migration PR

## 2026-09
