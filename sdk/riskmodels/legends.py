"""Shared narrative text for attrs and LLM prompts."""

SHORT_ERM3_LEGEND = """ERM3 hedge ratios (HR) are dollars of ETF to trade per $1 of stock (dollar_ratio).
- l1_market_hr: SPY-only L1 hedge.
- l2_market_hr / l2_sector_hr: L2 hedge (SPY + sector ETF).
- l3_market_hr / l3_sector_hr / l3_subsector_hr: L3 hedge (SPY + sector + subsector ETF).
Explained risk (ER) entries are variance fractions (0–1). At L3, l3_market_er + l3_sector_er
+ l3_subsector_er + l3_residual_er ≈ 1. Only l3_subsector_hr may be negative (long subsector ETF).
l3_residual_er is idiosyncratic risk not removable with these ETFs."""
