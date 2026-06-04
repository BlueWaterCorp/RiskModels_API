# API design — expose the Fama–French style cascade

**Status:** design (not implemented). **Author:** drafted 2026-06-03.
**Depends on:** ERM3 Phase 1 (style cascade) + Phase 3 (industry betas via core) — the
style data is now produced and (after the Phase-3 full deployment + GCS sync) live in
the zarr stores. The API currently has **zero** style support.

> Every code reference is `file:line` in `RiskModels_API`. This is additive and
> backward-compatible: existing L1/L2/L3 (industry) responses are unchanged; style is a
> **parallel cascade** surfaced behind an opt-in flag / new block.

---

## 1. What this exposes (and what it is)

The industry cascade answers *"which part of the market does this stock move with?"*
(market → sector → subsector). The **style cascade** answers *"is it tilted
small-vs-large and value-vs-growth?"* — a **different axis**, computed by the same
generic cascade core on **tradeable, public** Fama–French style ETFs:

| style leg | construction | ETF proxy |
|-----------|--------------|-----------|
| market (L1) | broad market | SPY |
| SMB (size) | small − large | IWM − IWB |
| HML (value) | value − growth | IWD − IWF |

It is a 3-level cascade that **shares the market leg (L1) with industry**, then adds
SMB at L2 and HML at L3:

- **L1** = market → *reuse* the industry `L1_market_ER` / `L1_market_HR` (not re-stored).
- **L2** = + SMB → `L2_ff_smb_ER`, `L2_ff_residual_ER`; `L2_ff_market_HR`, `L2_ff_smb_HR`.
- **L3** = + HML → `L3_ff_smb_ER`, `L3_ff_hml_ER`, `L3_ff_residual_ER`; `L3_ff_market_HR`,
  `L3_ff_smb_HR`, `L3_ff_hml_HR`.
- ER is additive at each depth: `L1_market_ER + L2_ff_smb_ER + L2_ff_residual_ER = 1`;
  `L1_market_ER + L3_ff_smb_ER + L3_ff_hml_ER + L3_ff_residual_ER = 1`.

**Guardrails:** the style legs are public Russell/SPDR ETFs — no proprietary subsector
curation is exposed (cf. the ETF-classification IP policy). Betas / ER / HR are realized
decomposition quantities, not forward opinions — consistent with the no-investment-advice
policy. The methodology page (`RM_ORG`) already documents this cascade as *forthcoming on
the API*; shipping this design fulfils that.

---

## 2. Data supply (already in the zarr stores)

| store | what's there | dims |
|-------|--------------|------|
| `ds_erm3_betas` / `_adjusted` | SMB/HML betas at **`fact_level == 4`**, fact names `SMB`,`HML` (adjusted = Vasicek-shrunk, `apply_to_style=true`) | (teo, symbol, fact) |
| `ds_erm3_hedge_weights` | the ff ER/HR vars listed in §1 | (teo, symbol) |
| `ds_erm3_returns` | ff residual-return **levels** `L2_ff_smb`, `L3_ff_smb_hml` (alongside the industry `market/sector/subsector/lstar` levels) | (teo, symbol, level) |

No new stores or pipeline work are required — only API plumbing.

---

## 3. Design principles

1. **Parallel, not nested.** Style is a *second cascade*, returned in its own block
   beside the industry one — never folded into the L1/L2/L3 industry levels. A stock can
   be large-cap value in Technology: industry carries the sector/subsector legs, style
   carries the size/value legs, and the market leg is shared.
2. **Additive + backward compatible.** No existing field changes meaning. Style appears as
   a new optional block (`style`) / new metric keys / a new endpoint. Absent data ⇒ the
   block is `null`, never an error (mirrors how `lstar` is optional today).
3. **Opt-in + feature-flagged.** Gate behind `include_style` (request) and a server flag
   (`STYLE_CASCADE_ENABLED`) so it can ship dark and flip per environment.
4. **Reuse the V3 plumbing.** Add style as new `V3MetricKey`s + registry specs so the
   existing zarr reader / fallback / batching paths carry it for free.

---

## 4. Wire model — new metric keys + registry specs

**`lib/dal/risk-engine-v3.ts`** — extend the `V3MetricKey` union (`:37-71`):

```ts
// style cascade (fact_level 4; ff residual levels in ds_erm3_returns)
| "l4_smb_beta" | "l4_hml_beta"          // raw/adjusted style betas
| "l2_ff_smb_er" | "l2_ff_res_er"
| "l3_ff_smb_er" | "l3_ff_hml_er" | "l3_ff_res_er"
| "l2_ff_mkt_hr" | "l2_ff_smb_hr"
| "l3_ff_mkt_hr" | "l3_ff_smb_hr" | "l3_ff_hml_hr"
| "l2_ff_smb_rr" | "l3_ff_smb_hml_rr"    // ff residual returns (levels in returns zarr)
```

**`lib/dal/zarr-metric-registry.ts`** — map each to its store var (roles already exist:
`hedge`, `returns` with a `level`, betas via the daily/hedge path). Examples:

```ts
l2_ff_smb_er:  { role: "hedge", zarrVar: "L2_ff_smb_ER" },
l3_ff_hml_hr:  { role: "hedge", zarrVar: "L3_ff_hml_HR" },
l2_ff_smb_rr:  { role: "returns", zarrVar: "residual_return", level: "ff_smb" },     // new level key
l3_ff_smb_hml_rr: { role: "returns", zarrVar: "residual_return", level: "ff_smb_hml" },
```

This requires extending the `returns` level union (`:17-19`, currently
`"market"|"sector"|"subsector"|"lstar"`) with `"ff_smb"|"ff_smb_hml"`, and the
`levelMaps` resolution in `lib/dal/zarr-reader.ts:682` to map those to the returns
zarr's ff level indices. (Betas: add `l4_smb_beta`/`l4_hml_beta` the same way the
existing `l3_sub_beta` is sourced.)

---

## 5. Response models

**New `StyleCascadeSnapshot`** (mirror `LevelHedgeSnapshot`, `lib/risk/hedge-levels.ts:17-26`):

```ts
export interface StyleCascadeSnapshot {
  // L1 shared with industry (echoed for self-containedness)
  market_er: number | null; market_hr: number | null;
  // L2 = + SMB
  smb_er: number | null; ff_l2_residual_er: number | null;
  ff_l2_market_hr: number | null; ff_l2_smb_hr: number | null;
  // L3 = + HML
  smb_er_l3: number | null; hml_er: number | null; ff_l3_residual_er: number | null;
  ff_l3_market_hr: number | null; ff_l3_smb_hr: number | null; ff_l3_hml_hr: number | null;
  // betas + legs
  smb_beta: number | null; hml_beta: number | null;
  legs: { smb: "IWM−IWB"; hml: "IWD−IWF"; market: "SPY" };
}
```

Add an optional `style?: StyleCascadeSnapshot | null` to:
- `HedgeLevelsBlock` (`lib/risk/hedge-levels.ts:28-36`) — so `/api/decompose` carries it.
- `ReturnsDecompositionPublicBody` (`lib/risk/returns-decomposition-service.ts:68-87`) —
  add `ff_l2_smb_return`, `ff_l3_smb_hml_return` series under an `include_style` flag.

---

## 6. Endpoints

**Extend (additive):**
- `POST /api/decompose` (`app/api/decompose/route.ts:50`) — add `style` to the snapshot
  block (null when disabled/unavailable). No request change.
- `GET /api/returns-decomposition` (`app/api/returns-decomposition/route.ts:30`) — add
  `include_style` (default false, like `include_lstar`) → emit the ff residual-return
  series. Schema: extend `ReturnsDecompositionRequestSchema` (`lib/api/schemas.ts:98-111`).
- `POST /api/batch/analyze` — add `"style_decomposition"` to the analysis menu.

**New (optional, parallels `l3-decomposition`):**
- `GET /api/style-decomposition?ticker=&years=` → daily SMB/HML ER + ff residual series,
  the style analogue of `/api/l3-decomposition` (`app/api/l3-decomposition/route.ts:34`).
  Backed by a new `lib/risk/style-decomposition-service.ts` modeled on
  `l3-decomposition-service.ts`.

**Metadata:** add `style_cascade` (legs, enabled flag, levels) to `GET /api/data/metadata`.

---

## 7. SDK (`sdk/riskmodels/client.py`)

- `get_style_decomposition(ticker, years=...) -> DataFrame` (SMB/HML ER + ff residual).
- `get_decompose(...)` already returns JSON → expose the new `style` block (no signature
  change; document the added key).
- New parser `style_decomposition_json_to_dataframe` (mirror
  `l3_decomposition_json_to_dataframe`). Existing L1/L2/L3 parsers untouched.
- Add a `factor_set`/`include_style` kwarg where relevant; bump SDK minor version.

---

## 8. Backward compatibility, flagging, rollout

- **Additive only** — no existing key/枚 changes; `style` is null when the flag is off or
  the data var is missing (graceful, like `lstar`).
- **Feature flag** `STYLE_CASCADE_ENABLED` (env) + per-request `include_style`. Ship dark,
  validate against a few known tickers (e.g. a small-cap value name shows +SMB/+HML, a
  mega-cap growth name shows −SMB/−HML), then flip on.
- **Cache:** the new metric keys flow through the existing zarr cache; bump any response
  schema/cache version so stale-empty payloads aren't served (cf.
  `docs/CACHE_EMPTY_PAYLOAD_FIXES.md`).
- **Parity doc:** update `docs/ERM3_ZARR_API_PARITY.md` with the ff vars.
- **Methodology:** flip the RM_ORG methodology section from "forthcoming" to live once
  shipped.

---

## 9. Implementation checklist

1. `risk-engine-v3.ts` — add the style `V3MetricKey`s (§4).
2. `zarr-metric-registry.ts` — add specs + extend the `returns` level union; update
   `zarr-reader.ts:682` `levelMaps` for `ff_smb`/`ff_smb_hml`.
3. `hedge-levels.ts` — `StyleCascadeSnapshot` + `buildStyleSnapshot()` + wire into
   `HedgeLevelsBlock`/`buildHedgeLevels`.
4. `returns-decomposition-service.ts` + route — `include_style` + ff series; schema in
   `lib/api/schemas.ts`.
5. New `style-decomposition-service.ts` + `app/api/style-decomposition/route.ts` (+ Zod
   schema) — optional, parallels l3-decomposition.
6. `/api/data/metadata`, `/api/batch/analyze`, `/api/decompose` — surface `style`.
7. SDK methods + parsers + version bump.
8. Tests: unit (registry mapping, snapshot builder), contract (additive — old responses
   byte-stable), integration (known small-cap-value vs mega-growth tickers), SDK parse.
9. Flag default off → validate → flip; update parity + methodology docs.

---

## 10. Open questions

- **`l4_smb_beta`/`l4_hml_beta` source** — confirm the betas read path handles
  `fact_level==4` (the existing `l3_sub_beta` path assumes the L3 fact); the style facts
  are named `SMB`/`HML` on the `fact` axis, not ETF tickers — the reader's fact→metric
  mapping needs that case.
- **Returns ff level indexing** — verify the `level` order in `ds_erm3_returns`
  (`market,sector,subsector,lstar,ff_smb,ff_smb_hml`?) so `levelMaps` resolves correctly;
  align with `sdk/riskmodels/snapshots/zarr_context.py`.
- **Naming** — `smb_er` vs `ff_smb_er` etc. in the public wire; pick one convention and
  reflect it in `SEMANTIC_ALIASES.md`.
- **Recommended-level interplay** — does the Lstar/recommended-level logic stay
  industry-only (likely yes; style is descriptive, not a hedge-level pick)?
