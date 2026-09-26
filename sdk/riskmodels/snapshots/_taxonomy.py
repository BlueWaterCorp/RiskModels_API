"""Sector and industry taxonomy used by the stock stores (ids, codes, names, hedge ETFs).

Store variables: ``bw_sector_id`` (71-81) and ``bw_industry_id`` (101-159). Generated from
the model taxonomy, definitions version ``bw_taxonomy_v1_20260925``. Values outside the
ranges are unclassified (-1 / 0 sentinels) and map to None.
"""
from __future__ import annotations

TAXONOMY_DEFINITIONS_VERSION = "bw_taxonomy_v1_20260925"

SECTOR_VAR = "bw_sector_id"
INDUSTRY_VAR = "bw_industry_id"

# sector id -> (code, name, sector ETF)
SECTORS: dict[int, tuple[str, str, str]] = {
    71: ('FUEL', 'Fuels', 'XLE'),
    72: ('MATL', 'Metals, chemicals and other producer inputs', 'XLB'),
    73: ('INDU', 'Industrial production and transport', 'XLI'),
    74: ('CONS', 'Household discretionary spending', 'XLY'),
    75: ('STPL', 'Household necessities', 'XLP'),
    76: ('HLTH', 'Health', 'XLV'),
    77: ('FINL', 'Banking, insurance and markets', 'XLF'),
    78: ('TECH', 'Chips, hardware and software', 'XLK'),
    79: ('MNET', 'Media, networks and online platforms', 'XLC'),
    80: ('UTIL', 'Utilities and power', 'XLU'),
    81: ('PROP', 'Property', 'XLRE'),
}

# industry id -> (code, name, sector id, primary subsector ETF)
INDUSTRIES: dict[int, tuple[str, str, int, str]] = {
    101: ('FUEL.UPS', 'Upstream producers', 71, 'XOP'),
    102: ('FUEL.INT', 'Integrated majors', 71, 'IYE'),
    103: ('FUEL.OFS', 'Oilfield service and drilling contractors', 71, 'XES'),
    104: ('FUEL.MID', 'Midstream transport and storage', 71, 'AMLP'),
    105: ('FUEL.REF', 'Refiners and fuel marketers', 71, 'IYE'),
    106: ('FUEL.CUF', 'Coal and uranium miners', 71, 'XME'),
    107: ('MATL.MET', 'Metal and ore miners and producers', 72, 'XME'),
    108: ('MATL.CHM', 'Chemical producers', 72, 'IYM'),
    109: ('MATL.FOR', 'Timber, wood and paper producers', 72, 'WOOD'),
    110: ('MATL.PKG', 'Packaging makers', 72, 'IYM'),
    111: ('MATL.CON', 'Cement, aggregates and glass', 72, 'ITB'),
    112: ('INDU.EQP', 'Machine, engine and electrical-gear builders', 73, 'IYJ'),
    113: ('INDU.DEF', 'Aircraft, space and defence contractors', 73, 'PPA'),
    114: ('INDU.BLD', 'Infrastructure and building contractors', 73, 'IYJ'),
    115: ('INDU.FIX', 'Building components makers', 73, 'XHB'),
    116: ('INDU.SVC', 'Outsourced services sold to companies', 73, 'IYJ'),
    117: ('INDU.WST', 'Waste and remediation operators', 73, 'EVX'),
    118: ('INDU.TRN', 'Freight, passenger and logistics carriers', 73, 'IYT'),
    119: ('CONS.VEH', 'Vehicle and vehicle-parts makers', 74, 'CARZ'),
    120: ('CONS.HOM', 'New-house builders', 74, 'ITB'),
    121: ('CONS.DUR', 'Furniture, appliance and leisure-goods makers', 74, 'XHB'),
    122: ('CONS.STO', 'Store and online retailers of discretionary goods', 74, 'XRT'),
    123: ('CONS.APP', 'Clothing, footwear and textile makers', 74, 'XRT'),
    124: ('CONS.LEI', 'Restaurants, lodging, travel and gaming', 74, 'PEJ'),
    125: ('CONS.WHL', 'Bulk resellers of durable goods', 74, 'XRT'),
    126: ('STPL.FOD', 'Food and agricultural products makers', 75, 'PBJ'),
    127: ('STPL.DRK', 'Drinks makers', 75, 'PBJ'),
    128: ('STPL.HPP', 'Cleaning, toiletry and cosmetics makers', 75, 'IYK'),
    129: ('STPL.TOB', 'Tobacco and nicotine products makers', 75, 'IYK'),
    130: ('STPL.GRC', 'Grocery and pharmacy retailers and food wholesalers', 75, 'IYK'),
    131: ('HLTH.DEV', 'Clinical-stage drug developers', 76, 'XBI'),
    132: ('HLTH.DRG', 'Commercial drug makers', 76, 'XPH'),
    133: ('HLTH.MED', 'Medical device and supply makers', 76, 'IHI'),
    134: ('HLTH.LAB', 'Life-science tools and contract research', 76, 'IHI'),
    135: ('HLTH.CAR', 'Care providers and health insurers', 76, 'IHF'),
    136: ('HLTH.HSV', 'Health distribution and services', 76, 'XHS'),
    137: ('FINL.MCB', 'Money-centre banks', 77, 'KBE'),
    138: ('FINL.CRB', 'Local and mid-sized deposit lenders', 77, 'KRE'),
    139: ('FINL.INS', 'Risk underwriters and their brokers', 77, 'KIE'),
    140: ('FINL.MKT', 'Brokers, exchanges and asset managers', 77, 'IAI'),
    141: ('FINL.LND', 'Specialty lenders, lessors and payment firms', 77, 'IYG'),
    142: ('TECH.CHP', 'Chip designers and makers', 78, 'SMH'),
    143: ('TECH.FAB', 'Chip-making equipment and materials', 78, 'SOXX'),
    144: ('TECH.CMP', 'Computer, server and storage-device makers', 78, 'RSPT'),
    145: ('TECH.ELC', 'Parts, sensors and test-instrument makers and distributors', 78, 'IYW'),
    146: ('TECH.NET', 'Routing, switching and radio gear makers', 78, 'IDGT'),
    147: ('TECH.SFT', 'Software vendors', 78, 'IGV'),
    148: ('TECH.ITS', 'Contract computing and systems integration', 78, 'IGV'),
    149: ('MNET.CAR', 'Network carriers', 79, 'VOX'),
    150: ('MNET.CNT', 'Content, publishing, games and advertising', 79, 'GGME'),
    151: ('MNET.PLT', 'Online platforms', 79, 'FDN'),
    152: ('UTIL.REG', 'Rate-regulated power and gas suppliers', 80, 'VPU'),
    153: ('UTIL.WAT', 'Water supply and wastewater companies', 80, 'FIW'),
    154: ('UTIL.GEN', 'Renewable and merchant power sellers', 80, 'PBW'),
    155: ('PROP.DIV', 'Equity REITs, diversified and commercial', 81, 'VNQ'),
    156: ('PROP.RES', 'Residential and specialty-housing REITs', 81, 'REZ'),
    157: ('PROP.MTG', 'Mortgage trusts and property lenders', 81, 'REM'),
    158: ('PROP.NNL', 'Single-tenant long-lease trusts', 81, 'NETL'),
    159: ('PROP.DEV', 'Property developers and managers', 81, 'VNQ'),
}

SECTOR_ID_TO_ETF: dict[int, str] = {k: v[2] for k, v in SECTORS.items()}
SECTOR_ID_TO_NAME: dict[int, str] = {k: v[1] for k, v in SECTORS.items()}
INDUSTRY_ID_TO_ETF: dict[int, str] = {k: v[3] for k, v in INDUSTRIES.items()}


def _as_int(v) -> int | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f == f else None


def sector_etf(sector_id) -> str | None:
    k = _as_int(sector_id)
    return SECTOR_ID_TO_ETF.get(k) if k is not None else None


def sector_name(sector_id) -> str | None:
    k = _as_int(sector_id)
    return SECTOR_ID_TO_NAME.get(k) if k is not None else None


def subsector_etf(industry_id) -> str | None:
    k = _as_int(industry_id)
    return INDUSTRY_ID_TO_ETF.get(k) if k is not None else None


def industry_code(industry_id) -> str | None:
    k = _as_int(industry_id)
    return INDUSTRIES[k][0] if k in INDUSTRIES else None


def industry_name(industry_id) -> str | None:
    k = _as_int(industry_id)
    return INDUSTRIES[k][1] if k in INDUSTRIES else None

def clean_ids(values, *, kind: str):
    """Float array of ids with sentinels and out-of-range values set to NaN.

    ``kind`` is ``"sector"`` (71-81) or ``"industry"`` (101-159). A value from an older store
    numbering falls outside both ranges and reads as unclassified.
    """
    import numpy as np

    a = np.asarray(values, dtype=float).copy()
    lo, hi = (71, 81) if kind == "sector" else (101, 159)
    a[~(np.isfinite(a) & (a >= lo) & (a <= hi))] = np.nan
    return a
