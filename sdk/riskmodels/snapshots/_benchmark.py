"""Benchmark → proxy-ETF resolution shim (G.45, ADR 2026-08-01).

Small, explicit mirror of the committed benchmark catalog
(``mcp/data/benchmark_master.json``, generated from
``Funds_DAG/configs/benchmark_universe.yaml`` — the cross-repo SSOT). Only
contexts that declare a ``proxy`` ETF appear here, because the one thing
this shim answers is: *which ETF's realized return series may stand in for
this benchmark's performance?*

Two deliberate exclusions, both from the 2026-08-01 ADR:

- The BW-BENCH ``ds_portfolio`` series is **never** used as a performance
  overlay. Its ``weight_basis`` is ``latest_holdings_constant`` — the
  current composition's factor profile backfilled over history. That is a
  risk-profile series; serving it as realized performance is the wrong
  claim.
- ``BW-BENCH-EQ70-30`` (a blend, ``proxy: null`` in the catalog) has no
  single proxy ETF and therefore resolves to ``None`` here — the overlay
  is omitted honestly rather than approximated.

``benchmark_index`` is NULL for every fund in the entity master
(prospectus parse deferred), so SPY is a hardcoded *default*, not a
declared benchmark. Every label produced here says so — renders must not
imply a prospectus-declared benchmark.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BenchmarkProxy:
    """Resolution of a benchmark id/alias to its realized-return source."""

    bw_bench_id: str
    #: Human/index display name from the catalog ("S&P 500").
    index_name: str
    #: Common short name used in labels ("SPY").
    display: str
    #: The proxy ETF whose *own* realized returns stand in for the
    #: benchmark's performance (catalog ``proxy.ref`` — IVV for
    #: BW-BENCH-SPY).
    proxy_ticker: str

    @property
    def default_label(self) -> str:
        """Series label disclosing the hardcoded-default status.

        ``benchmark_index`` is NULL everywhere today, so v1 labels always
        carry the ``(default)`` qualifier — the render must say the
        benchmark is a house default, not a prospectus declaration.
        """
        return f"{self.display} (default)"


# Mirror of the catalog contexts that carry a proxy ETF. Update alongside
# mcp/data/benchmark_master.json (which is itself generated from
# Funds_DAG/configs/benchmark_universe.yaml).
_PROXY_CATALOG: dict[str, BenchmarkProxy] = {
    "BW-BENCH-SPY": BenchmarkProxy(
        bw_bench_id="BW-BENCH-SPY",
        index_name="S&P 500",
        display="SPY",
        proxy_ticker="IVV",
    ),
}

# Case-insensitive aliases, mirroring the catalog's alias table for the
# proxied contexts only.
_ALIASES: dict[str, str] = {
    "spy": "BW-BENCH-SPY",
    "s&p 500": "BW-BENCH-SPY",
    "sp500": "BW-BENCH-SPY",
    "spx": "BW-BENCH-SPY",
    "ivv": "BW-BENCH-SPY",
}


def resolve_benchmark_proxy(benchmark: str | None) -> BenchmarkProxy | None:
    """Resolve a benchmark id/alias to its proxy-ETF record, or ``None``.

    Accepts a ``bw_bench_id`` (``BW-BENCH-SPY``) or a catalog alias
    (``SPY``, ``SP500``, ``IVV``, …), case-insensitively. ``None`` means
    "no honest realized-return source exists for this benchmark" — the
    caller must omit the overlay, never approximate it.
    """
    if not benchmark:
        return None
    key = str(benchmark).strip()
    if not key:
        return None
    bench_id = _ALIASES.get(key.lower(), key.upper())
    return _PROXY_CATALOG.get(bench_id)


__all__ = ["BenchmarkProxy", "resolve_benchmark_proxy"]
