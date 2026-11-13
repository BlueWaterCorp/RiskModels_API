# Event Ledger source register (internal)

What each event type in `public.event_ledger` is built from, under which terms, and
which fields may reach a client edition (the daily email, its attached
`events_<date>.jsonl`, and the riskmodels.org/events list). Checked against the live
table and the ERM3 adapters on 2026-11-13. Update it whenever an adapter, a payload
key or a licence classification changes.

Code that enforces it: `lib/event-ledger-digest.ts` (`withheldReason`,
`marketCapPaths`, `rawVendorPaths`, `derivedFieldPaths`, `marketCapHits`,
`restrictedWordHits`, `licenseLabel`), `lib/event-ledger-public.ts`, and the output
checks in `scripts/event-ledger-digest.ts`. Tests: `tests/event-ledger-digest.test.ts`.

## The licensed-data rule

Conrad, 2026-11-13: our market-data licence allows redistributing data DERIVED from
the licensed data, with one exception, market capitalisation.

| Kind of value | Client edition | Enforcement |
|---|---|---|
| From the public filing itself (SEC EDGAR) | Yes | licence `public_record`, redistributable |
| Derived by RiskModels, including from licensed data | Yes, traced and labelled | `derivedFieldPaths()`; named in the line's `license_label` |
| Raw licensed value as received (price, volume, other bar fields, last-trade date from a bar, vendor codes) | No: the event is withheld | `rawVendorPaths()` -> `raw_vendor_value_in_client_edition` |
| Market cap, or anything that rebuilds one (market cap, size or cap bands, cap ranks, cap-weighted figures, shares together with a price) | No: the event is withheld | `marketCapPaths()` -> `market_cap_in_client_edition`; `marketCapHits()` refuses the send if the words appear in any rendered copy or the data file |
| `internal_only` / not redistributable | No | `withheldReason()` |

The published envelope is never edited: an event that fails is withheld whole. The
same rule is stated to readers in `/legal/feed-terms` section 4.

## Event types

Live table on 2026-11-13: 5,050 rows. 4,604 `delisting` (verified, primary,
`public_record`, redistributable, basis `sec_public_record`) and 446
`identifier_rekey` (candidate, `internal_derived`, `internal_only`, not
redistributable). No GDELT rows.

### `delisting` (ERM3 `erm3/events/adapters/edgar_delisting.py`, source system `edgar_corporate_actions`)

Source: SEC EDGAR Form 25 / 25-NSE filings. Terms: US government public record, no
licence restriction on the content; access follows the SEC's fair-access rules for
EDGAR (declared User-Agent with contact address, at most 10 requests per second,
no abusive crawling). Those rules bind our collection (ERM3 SEC jobs), not readers.

| Field | Comes from | Vendor data? | Client edition |
|---|---|---|---|
| `entity.cik` | the filing | no | yes |
| `source.accession_number`, `source_id`, `evidence_ref`, `url` | the filing / EDGAR URL | no | yes |
| `payload.issuer_name`, `file_number`, `security_description`, `rule_provision`, `source_form` | parsed from the filing | no | yes |
| `effective_at` (`form25_signature_date`, else `filed_date_fallback`) | the filing | no | yes |
| `knowledge_at` (`sec_acceptance_datetime`, else filing date) | EDGAR acceptance time | no | yes |
| `payload.rule_12d2_2_effective_estimate` | computed: filing date + 10 days (Rule 12d2-2) | no | yes |
| `payload.confidence`, `confidence` | parser score (RiskModels) | no | yes |
| `payload.entity_mapping` (`unmapped_cik`) | RiskModels note | no | yes |
| `first_observed_at` / basis, `ingested_at`, `provenance.*`, `dedupe_key`, `event_id` | RiskModels system fields | no | yes |
| `entity.bw_sym_id`, `payload.affected_bw_sym_ids` | CIK mapped to the RiskModels security master, restricted to the model universe | derived: the master's inputs include licensed data, and universe membership is ranked on market value | allowed as derived and labelled; **empty on all 4,604 rows today** (see open question 1) |
| `entity.ticker`, `entity.figi`, `entity.entity_name` | RiskModels security master | derived (tickers and names partly from licensed price data; FIGI is an open identifier) | allowed as derived and labelled; **empty on all rows today** |
| any price, volume, bar, market value or shares-with-price field | none today | would be raw vendor or market cap | withheld |

Every populated field on the 4,604 verified rows comes from, or is computed from,
the filing itself. Nothing traced to licensed data reaches a client edition today.

### `identifier_rekey` (ERM3 `scripts/symbology/rekey_by_map.py`, source system `erm3_identity_review`)

RiskModels id re-key decisions (old id -> new id, rule). Derived internally from the
security master. `internal_only`, not redistributable: appears only in the internal
edition (to `INTERNAL_RECIPIENTS`), never in a client edition, the data file sent to
clients, or the public list.

### GDELT discovery candidates (ERM3 `erm3/events/gdelt/discovery.py`)

News-article metadata from the GDELT Project (title, domain, crawl time, links).
Terms: GDELT data is free to use with credit to the GDELT Project. The adapter marks
these `internal_only`, not redistributable (basis `gdelt_metadata_discovery_only`),
so they stay internal; none are in the table today. If one ever reaches any edition,
the edition carries the GDELT credit line automatically (`isGdeltDerived()`,
`GDELT_CREDIT`), in the HTML, the text and the descriptor's `credits`.

## Open questions for Conrad

1. Model-universe membership. When a future publish maps CIKs to RiskModels ids
   (`sym_map`), the presence of `entity.bw_sym_id` says the security is in the model
   universe, which is ranked on market value. It is not a cap value, but it is a
   coarse "above the cut-off" signal. The code allows it today as a derived field;
   say if it should be treated as a cap band and withheld.
2. FIGI provenance in the master: if some FIGIs were taken from licensed records
   rather than the open standard's own mapping, label them as derived (they already
   are, by `derivedFieldPaths()`).
