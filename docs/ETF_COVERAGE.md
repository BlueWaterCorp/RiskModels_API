# ETF coverage

The API has one ETF universe. Each fund has three capabilities, in any
combination, and one factor role. Read them before calling a priced route for
an ETF.

| Capability | Meaning | Routes that need it |
|:--|:--|:--|
| `cascade` | The fund is a hedge leg in the ERM3 cascade: SPY, the 11 sector ETFs, and the subsector ETFs. | Hedge ratios and hedge trades in `/metrics`, `/hedge-basket`, `/portfolio/exposure` |
| `priced` | The fund has daily returns in the ETF return store, from `priced_from`. | `/ticker-returns`, ETF covariance and beta to SPY in `/portfolio/exposure` |
| `holdings` | The fund has look-through holdings, as of `holdings_as_of`. | `/data/etf/{ticker}/holdings`, `/data/etf/{ticker}/portfolio`, benchmark fit |

`factor_role` is one of `market`, `sector`, `subsector`, `style`,
`macro:<factor>` or `none`.

## Where to read them

- `GET /api/data/etf/universe`: every known fund with its capabilities and
  identifiers. Filter with `?cascade=`, `?priced=`, `?holdings=` (true or
  false) and `?factor_role=` (`macro` matches every `macro:<factor>`). Free;
  per-IP rate limit of the data gateway.
- `GET /api/data/etf/{ticker}`: the same block for one fund, plus
  `holdings_as_of` and, for funds with holdings, the holdings-surface metrics.
  It returns 200 for every known fund and 404 (`code: symbol_not_found`) only
  when the ticker is on no list.
- `GET /api/data/etf/search?q=`: each hit carries `capabilities`.

Identifiers are `bw_sym_id`, `bw_etf_id`, `figi`, `cik` and `ticker`, null
where unknown. Only FIGI, CIK and BW ids are served. A `bw_sym_id` that embeds
a licensed identifier is withheld.

## Counts

From the 2026-10-14 builds of the ETF return store, the weekly hedge snapshot
and the committed holdings catalog (`mcp/data/etf_master.json`):

| Set | Funds |
|:--|--:|
| Universe (union) | 211 |
| `cascade` | 56 (SPY, 11 sector, 44 subsector) |
| `priced` | 128 |
| `holdings` | 148 |
| `priced` and `holdings` | 65 |
| `holdings` only | 83 |

Every cascade fund is priced. The counts move when ERM3 adds funds to the
register (ERM3-68). `GET /api/data/etf/universe` returns the current `counts`.

## Sources

| Capability | Source | Read |
|:--|:--|:--|
| `cascade`, `factor_role` market / sector / subsector | `market_etf` attribute and the distinct `sector_etf` / `subsector_etf` values of the weekly hedge snapshot | At request time, cached one hour. If the snapshot is unreachable, SPY and the 11 sector ETFs are used. |
| `priced`, `priced_from`, `bw_sym_id`, `figi` | Symbol axis and first non-null `return` of the ETF return store | At request time, cached one hour. |
| `holdings`, `bw_etf_id` | `mcp/data/etf_master.json` (mirror of the Funds_DAG ETF universe) | Committed file. `holdings_as_of` comes from the holdings surface in `/data/etf/{ticker}`. |
| `style` / `macro:<factor>` roles, `cik` | `mcp/data/etf_register.json` (ERM3 register mirror), when committed | Committed file; optional. |

The universe response's `sources` block says which inputs were readable. When
one was not, the capabilities it supplies may be under-reported, and the build
is retried after five minutes.

## Reason codes

| Code | When | Where |
|:--|:--|:--|
| `etf_outside_priced_universe` | A known fund without the `priced` capability | `/ticker-returns` `_metadata.data_warning_code`; `/portfolio/exposure` coverage |
| `etf_no_return_history_in_window` | A priced fund with no daily returns in the requested window | Same |
| `symbol_not_found` | A ticker on no list | `/data/etf/{ticker}` 404; `/portfolio/exposure` coverage |

ETF reason codes come with `see: /api/data/etf/{ticker}`.

## Billing

`/ticker-returns` does not bill a response with no rows. A stock with no rows
in the window gets `data_warning_code: no_return_history_in_window`.
`/data/etf/universe`, `/data/etf/{ticker}` and `/data/etf/search` are free.
