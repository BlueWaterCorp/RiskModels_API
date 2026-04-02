"""Shared narrative text for attrs and LLM prompts."""

SHORT_ERM3_LEGEND = """ERM3 hedge ratios (HR) are dollars of ETF to trade per $1 of stock (dollar_ratio).
- l1_market_hr: SPY-only L1 hedge.
- l2_market_hr / l2_sector_hr: L2 hedge (SPY + sector ETF).
- l3_market_hr / l3_sector_hr / l3_subsector_hr: L3 hedge (SPY + sector + subsector ETF).
Explained risk (ER) entries are variance fractions (0–1). At L3, l3_market_er + l3_sector_er
+ l3_subsector_er + l3_residual_er ≈ 1. Any HR may be negative (orthogonalization);
negative market HR at L2/L3 is common; other components can be negative too.
l3_residual_er is idiosyncratic risk not removable with these ETFs."""

SHORT_MACRO_CORR_LEGEND = """Macro factor correlation: Pearson or Spearman correlation of aligned daily returns between
your chosen stock return series (gross or ERM3 residual) and daily macro factor returns (e.g. bitcoin, vix).
macro_corr_* columns are correlation coefficients (roughly -1 to 1), not hedge notionals (HR) or variance shares (ER).
A negative value is normal and is not a data error. null/absent values mean insufficient overlap or missing macro data.
Use return_type gross vs l3_residual depending on whether you want total equity co-movement or the idiosyncratic sleeve vs macro."""

COMBINED_ERM3_MACRO_LEGEND = SHORT_ERM3_LEGEND + "\n\n" + SHORT_MACRO_CORR_LEGEND

SHORT_MACRO_SERIES_LEGEND = """Daily macro factor total returns from macro_factors (long table: factor_key, teo, return_gross).
These are the same underlying series used for stock–macro correlation; this endpoint does not require a ticker.
return_gross is a simple daily return for that macro factor; it is not an equity hedge ratio (HR) or explained risk (ER)."""

SHORT_RANKINGS_LEGEND = """Cross-sectional rankings from security_history: rank_ordinal (1 = best within cohort),
cohort_size (N names in cohort), rank_percentile (0–100, 100 = best). Low cohort_size (<10) is statistically weak;
see attrs riskmodels_warnings. Wire storage uses keys rank_ord_{window}_{cohort}_{metric}; the SDK uses structured columns."""

RANKINGS_SMALL_COHORT_THRESHOLD = 10
