# Handoff: bulk_dd_render headless-Chrome behavior — incident, findings, options (2026-07-29)

*From: MLEA-side Claude session. Owners: RiskModels_API (`sdk/scripts/bulk_dd_render.py`,
`sdk/riskmodels/visuals/save.py`, `snapshots/_compose.py`) + ERM3
(`misc/dagster_assets/assets/dd_bulk_snapshots.py`). A copy of the incident FYI is in
`Funds_DAG/HANDOFF_NPORT_20260729.md`.*

## Incident (this morning)

1. `DD_Snapshots_bulk_render` (daily 03:00 schedule) ran normally; its ProcessPool
   workers spawn **headless Chrome repeatedly** during figure export (plotly 6.7 →
   kaleido 1.3 → choreographer 1.3 launches `/Applications/Google Chrome.app` per
   export batch, fresh `--user-data-dir` each time). On macOS each launch briefly
   registers with the Dock → the "popping Chrome icon" Conrad reported.
2. Conrad cancelled the Dagster run at ~05:40 PT. The Dagster run worker died, but
   **`bulk_dd_render.py` survived the cancel** — it reparented to launchd (PPID 1)
   with 9 multiprocessing workers that kept spawning Chrome indefinitely.
3. We killed the orphan tree manually at ~05:45–05:55 PT: root PID 62852, spawn
   workers 62990–62997, plus choreographer/headless-Chrome children. Today's DD
   outputs are whatever completed before the cancel; treat as partial.

## Root causes

- **Per-export Chrome spawning**: nothing in the render path reuses a browser.
  kaleido 1.3 launches Chrome per `fig.to_image()`/`write_image()` unless a
  persistent instance is used. With 8 workers × hundreds of figures, that is
  hundreds of Chrome launches per night (Dock noise, memory churn, tmpdir litter).
- **Cancel does not propagate**: the Dagster asset launches the script via
  `run_subprocess_asset` (see `misc/dagster_assets/assets/helpers.py`); on run
  termination the child was not in a killed process group, so the script — and its
  worker pool, and their browsers — outlived the run. (The script already has
  SIGALRM/timeout plumbing but no SIGTERM → children teardown.)

## Options (discussed with Conrad; decision pending)

1. **Destination: move DD onto `services/render-svc`** — the persistent rendering
   service the Canonical_P1 pipeline already uses. One long-lived renderer, no
   per-figure spawns, no orphans. The Dagster defs comments indicate this
   migration is already the architectural direction; DD is the transitional path.
2. **Minimal in-place fix now** (an afternoon in this repo) — keeps the
   PR-3 "canonical single render path" guarantee:
   a. **One persistent browser per worker**: call `kaleido.start_sync_server()` in
      each ProcessPool worker's initializer (kaleido 1.3 API) so plotly's shim
      reuses a single Chrome for the worker's whole lifetime (≈8 launches per
      night instead of hundreds), `stop_sync_server()` + atexit on teardown.
   b. **No Dock presence at all**: point kaleido/choreographer at
      `chrome-headless-shell` (the UI-less headless build) instead of the
      installed Chrome app bundle — headless-shell never registers with the Dock.
      choreographer's `Browser(path=...)` accepts an explicit binary.
   c. **Cancel propagation**: launch the script in its own process group from the
      Dagster asset and kill the group on termination; in the script, install a
      SIGTERM handler that shuts down the executor and sync servers. This also
      fixes the orphan class generally, not just for Chrome.
3. **Matplotlib re-implementation of the bulk path** — rejected in discussion:
   forks the chart code and reverses the PR-3 unification.

**Recommendation from our side**: option 2 now, option 1 as the destination.
Conrad has been briefed on this trade-off; check with him before implementing
(he questioned whether the SDK belongs in the bulk path at all — the canonical-
render rationale is the counterargument, but the decision is his to make).

## Verification notes for whoever implements

- Reproduce popping: run any bulk render and watch Dock; each new
  `--user-data-dir=/var/folders/.../tmpXXXX` in `ps` = one spawn.
- After fix: `ps -eo pid,command | grep -c choreographer` should stay ≈ worker
  count for the entire run; zero after exit; zero `PPID 1` `spawn_main` python
  processes after a Dagster cancel.
- The machine is 24 GB and shared with Funds_DAG ingests and MLEA research sims
  (now strictly serial); browser-count reduction is also a real memory win.
