/*
  # Drop ticker_returns_cache table

  Legacy JSONB cache for ticker return data. The app now uses normalized tables:
  - erm3_ticker_returns (ticker returns)
  - erm3_etf_returns (ETF returns)
  - erm3_time_index (date grid / teo)

  All code paths have been migrated; this table is no longer read or written.
*/

DROP TABLE IF EXISTS ticker_returns_cache;
