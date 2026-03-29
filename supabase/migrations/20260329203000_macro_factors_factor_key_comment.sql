-- Document canonical factor_key strings for ingest pipelines (must match API + lib/risk/macro-factor-keys.ts).
comment on column public.macro_factors.factor_key is
  'Lowercase canonical keys: bitcoin, gold, oil, dxy, vix, ust10y2y. The API normalizes aliases (e.g. btc → bitcoin) before querying this column.';
