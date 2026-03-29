-- Migration to remove legacy ERM3 tables after V2 schema migration
-- Date: 2026-03-05

BEGIN;

-- Drop views first
DROP VIEW IF EXISTS ticker_factor_metrics_free;

-- Drop legacy tables
DROP TABLE IF EXISTS ticker_metadata;
DROP TABLE IF EXISTS ticker_factor_metrics;
DROP TABLE IF EXISTS erm3_l3_decomposition;
DROP TABLE IF EXISTS erm3_ticker_returns;
DROP TABLE IF EXISTS erm3_etf_returns;
DROP TABLE IF EXISTS erm3_time_index;
DROP TABLE IF EXISTS market_heatmap_snapshot;
DROP TABLE IF EXISTS etf_metadata;
DROP TABLE IF EXISTS classification_mappings;
DROP TABLE IF EXISTS erm3_landing_chart_cache;

COMMIT;
