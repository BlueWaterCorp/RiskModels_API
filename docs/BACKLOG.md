# RiskModels_API Backlog — OPEN items only

**If it is in this file, it is open.** Closed work moves to `LEDGER.md` (one line, dated,
with the PR/commit) and is cut from here — never marked DONE in place. Two annotations are
allowed in a heading because they are still-open states that need a reason:
`BLOCKED (on X)` and `DEFERRED (until Y)`.

Oldest first; append new items at the bottom. Target: readable in two minutes. If it is
not, items are being hoarded — move them or close them.

Every item carries an **Impact** line — the answer to "what is wrong, or could silently go
wrong, if this is never done?" — and a **Needs** line: `engineering` (just do it),
`DECISION` (a human must choose first), or the owning repo. Classes, in reading order:

- `MATERIAL` — a published number is wrong or unattributable today, or a silent failure is live
- `IMPROVEMENT` — better data with a measured or expected gain; nothing wrong today
- `HYGIENE` — tests, speed, layout, resilience
- `NOT-OURS` / `BLOCKED` — booked here by reference, or waiting on something outside this repo

Process: `BWMACRO/docs/architecture/BACKLOG_LEDGER_CHECKLIST_PROCESS.md`.

## Status of this file (2026-09-16)

**Seeded and intentionally empty.** RiskModels_API's open work still lives in the lettered
sections of `BWMACRO/docs/ceo/MASTER_BACKLOG.md` and has not been distributed yet. The
ADR's target state is that each repo's `BACKLOG.md` is the source of truth and the master
is a generated rollup of them; `BWMACRO/scripts/backlog_rollup.py --audit` reports what
blocks that today.

Distribution is deliberately incremental: a master row moves here one at a time, leaving
the hand-maintained part of the master and reappearing inside its generated region. Until
a row lands here, the master section remains authoritative for it — so **do not** read
this file's emptiness as "RiskModels_API has no open work".
