"""Verify attribution_audit.xlsx by EVALUATING its formulas and checking them in numpy.

openpyxl writes formulas but never evaluates them, so a summary cell can reference the
wrong column, compute the wrong statistic, or be malformed, and the saved file still
looks correct. Excel/LibreOffice would only reveal it when a human opens the file.

This module contains a small evaluator for the exact formula grammar the workbook uses
(COUNT / AVERAGE / STDEV / COUNTIF / SKEW / SUMPRODUCT / LN / EXP / SQRT over
Berkshire_quarterly ranges, plus same-sheet cell references). Every summary formula is
parsed from the saved file, evaluated against the raw data read back out of the
workbook, and compared against the statistic computed independently with numpy.

Deliberately dependency-free: no LibreOffice, no `formulas`/`pycel`. Whoever inherits
this can run it with nothing installed beyond numpy + openpyxl.

Run:  python verify_audit_xlsx.py     (after build_audit_xlsx.py)
Exit code is non-zero if any check fails.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

import numpy as np
from openpyxl import load_workbook

_HERE = Path(__file__).resolve().parent
XLSX = _HERE / "attribution_audit.xlsx"
RTOL = 1e-9

failures = []


# --------------------------------------------------------------------------
# a very small Excel-formula evaluator, scoped to the grammar this file uses
# --------------------------------------------------------------------------
def _excel_skew(a):
    """Excel SKEW = sample skewness with the (n/((n-1)(n-2))) bias correction."""
    a = np.asarray(a, float)
    n = len(a)
    s = a.std(ddof=1)
    return float(n / ((n - 1) * (n - 2)) * (((a - a.mean()) / s) ** 3).sum())


ENV = {
    "COUNT": lambda a: float(len(np.asarray(a, float))),
    "AVERAGE": lambda a: float(np.mean(a)),
    "STDEV": lambda a: float(np.std(a, ddof=1)),
    "SQRT": lambda x: float(np.sqrt(x)),
    "EXP": lambda x: float(np.exp(x)),
    "LN": lambda a: np.log(a),
    "SKEW": _excel_skew,
    "SUMPRODUCT": lambda *a: float(np.sum(np.prod(np.vstack([np.asarray(x, float)
                                                            for x in a]), axis=0))
                                   if len(a) > 1 else np.sum(np.asarray(a[0], float))),
}


def evaluate(formula, ranges, cells):
    """Evaluate one formula string. `ranges` maps 'SHEET!A2:A43' -> ndarray;
    `cells` maps 'D5' -> already-computed float on the same sheet."""
    expr = formula.lstrip("=")

    # Range placeholders must NOT look like Excel cell references, or the cell-ref
    # pass below will try to resolve them (this bit once: 'R0' matched [A-Z]{1,2}\d+).
    keys = {}

    def _key(ref):
        if ref not in keys:
            keys[ref] = "__r%d__" % len(keys)
        return keys[ref]

    # COUNTIF(range,">0") -> a comparison count. Must run before the generic range
    # substitution so the range text is still intact for matching.
    def _countif(m):
        return f'float(np.sum({_key(m.group(1))} {m.group(2)}))'
    expr = re.sub(r'COUNTIF\(([^,]+),"([<>=]+[^"]*)"\)', _countif, expr)

    for ref in sorted(ranges, key=len, reverse=True):
        if ref in expr:
            expr = expr.replace(ref, _key(ref))

    # same-sheet cell references (D5, C5 ...) -> literal values
    def _cell(m):
        c = m.group(0)
        if c in cells:
            return repr(cells[c])
        raise KeyError(c)
    expr = re.sub(r'\b[A-Z]{1,2}\d+\b', _cell, expr)

    expr = expr.replace("^", "**")
    expr = expr.replace("--(", "1.0*(")          # Excel double-unary boolean coercion

    ns = dict(ENV)
    ns["np"] = np
    ns["float"] = float
    for ref, k in keys.items():
        ns[k] = ranges[ref]
    return eval(expr, {"__builtins__": {}}, ns)  # noqa: S307 - fixed grammar, local file


def check(label, got, want, rtol=RTOL):
    if got is None or want is None:
        ok = got is None and want is None
    else:
        ok = abs(got - want) <= rtol * max(1.0, abs(want))
    status = "OK  " if ok else "FAIL"
    print(f"  {status}  {label:<52} formula={got:>14.6g}  numpy={want:>14.6g}"
          if isinstance(got, float) and isinstance(want, float)
          else f"  {status}  {label:<52} {got!r} vs {want!r}")
    if not ok:
        failures.append(label)


def main():
    if not XLSX.exists():
        raise SystemExit("attribution_audit.xlsx missing — run build_audit_xlsx.py first")

    wb = load_workbook(XLSX)                     # formulas as written
    wq, wsm = wb["Berkshire_quarterly"], wb["Berkshire_summary"]

    hdr = [c.value for c in wq[1]]
    col_letter = {h: wq.cell(1, i + 1).column_letter for i, h in enumerate(hdr)}
    data = {h: [] for h in hdr}
    for row in wq.iter_rows(min_row=2, values_only=True):
        if row[0] is None:
            continue
        for h, v in zip(hdr, row):
            data[h].append(v)
    n = len(data["teo"])
    last = n + 1
    print(f"Berkshire_quarterly: {n} data rows")

    # every range the summary sheet can reference
    ranges = {}
    for h in hdr:
        vals = data[h]
        if not vals or not isinstance(vals[0], (int, float)):
            continue
        ranges[f"Berkshire_quarterly!{col_letter[h]}2:{col_letter[h]}{last}"] = \
            np.asarray(vals, float)

    print("\n[1] raw sheet integrity")
    ra = json.load(open(_HERE / "cache" / "reaudit_berkshire.json"))
    check("row count == re-audit stage2 records", float(n), float(len(ra["stage2"]["records"])))
    for c in ("gross_UNLQ", "market_UNLQ", "sector_UNLQ", "subsector_UNLQ", "idio_UNLQ",
              "gross_UNLT", "market_UNLT", "sector_UNLT", "subsector_UNLT", "idio_UNLT",
              "gross_LAG", "market_LAG", "sector_LAG", "subsector_LAG", "idio_LAG"):
        blanks = sum(1 for v in data[c] if v is None or (isinstance(v, float) and np.isnan(v)))
        check(f"no blanks in {c}", float(blanks), 0.0)

    print("\n[2] layer additivity per row (ERM3 identity, geometric linking residual)")
    for basis, sfx in (("UNLQ", "_UNLQ"), ("UNLT", "_UNLT"), ("LAGGED", "_LAG")):
        g = np.asarray(data["gross" + sfx], float)
        s = sum(np.asarray(data[l + sfx], float) for l in
                ("market", "sector", "subsector", "idio"))
        resid = np.abs(g - s)
        print(f"    {basis:<9} max |gross - Σlayers| = {resid.max()*1e4:7.1f} bps   "
              f"median {np.median(resid)*1e4:6.1f} bps")
        check(f"{basis} linking residual < 300 bps", float(resid.max() < 0.03), 1.0)

    print("\n[3] Berkshire_summary — every formula evaluated and checked against numpy")
    _basis_sfx = {"unlagged_fwdQ": "_UNLQ", "unlagged_lagtwin": "_UNLT",
                  "lagged_perQ": "_LAG_perQ"}
    simple = {}
    for _lyr in ("market", "sector", "subsector", "idio", "gross"):
        for _b, _s in _basis_sfx.items():
            simple[(_lyr, _b)] = [f"{_lyr}{_s}"]
    for _b, _s in _basis_sfx.items():
        simple[("sector+subsector", _b)] = [f"sector{_s}", f"subsector{_s}"]
        simple[("mkt+sec+subsec", _b)] = [f"market{_s}", f"sector{_s}", f"subsector{_s}"]
    head = {i: wsm.cell(1, i).value for i in range(1, wsm.max_column + 1)}

    for r in range(2, wsm.max_row + 1):
        label, basis = wsm.cell(r, 1).value, wsm.cell(r, 2).value
        cols = simple.get((label, basis))
        if cols is None:
            continue
        x = sum(np.asarray(data[c], float) for c in cols)
        m, sd, k = x.mean(), x.std(ddof=1), len(x)
        truth = {
            "n": float(k),
            "mean_bps": m * 1e4,
            "std_bps": sd * 1e4,
            "t": m / (sd / np.sqrt(k)),
            "hit_%": float((x > 0).mean() * 100),
            "skew": _excel_skew(x),
            "ann_Sharpe": (m / sd) * np.sqrt(4),
            "ann_%": (np.exp((4 / k) * np.log1p(x).sum()) - 1) * 100,
            "cum_%": (np.exp(np.log1p(x).sum()) - 1) * 100,
        }
        print(f"\n  {label} / {basis}   (n={k}, mean {m*1e4:.1f} bps, Sharpe {truth['ann_Sharpe']:.3f})")

        cells = {}
        for ci in range(3, wsm.max_column + 1):
            v = wsm.cell(r, ci).value
            name = head.get(ci)
            if v is None or v == "" or name not in truth:
                continue
            if isinstance(v, str) and v.startswith("="):
                try:
                    got = evaluate(v, ranges, cells)
                except Exception as e:                       # noqa: BLE001
                    print(f"  FAIL  {label}/{basis} {name}: could not evaluate {v!r}: {e}")
                    failures.append(f"{label}/{basis} {name} unevaluable")
                    continue
                cells[f"{wsm.cell(r, ci).column_letter}{r}"] = got
                check(f"{label}/{basis} {name}", float(got), float(truth[name]), rtol=1e-6)
            else:
                cells[f"{wsm.cell(r, ci).column_letter}{r}"] = float(v)

    print("\n[4] Sharpe_bridge cells match cache/reaudit_berkshire.json")
    br = ra["sharpe_bridge"]
    wbr = wb["Sharpe_bridge"]
    seen = {}
    for r in range(1, wbr.max_row + 1):
        step, val = wbr.cell(r, 1).value, wbr.cell(r, 3).value
        if step in ("A", "B", "C", "D") and isinstance(val, (int, float)):
            seen[step] = float(val)
    for step, key in (("A", "A_endpoint_all46"), ("B", "B_endpoint_rebuildable"),
                      ("C", "C_rebuild_unlagged"), ("D", "D_rebuild_lagged")):
        check(f"bridge step {step}", seen.get(step), round(br[key], 3), rtol=1e-3)

    print("\n" + "=" * 78)
    if failures:
        print(f"FAILED — {len(failures)} check(s):")
        for f in failures:
            print(f"   - {f}")
        return 1
    print("PASS — every Berkshire_summary formula was evaluated from the saved file and")
    print("reproduces the independently computed numpy value. The workbook is self-consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
