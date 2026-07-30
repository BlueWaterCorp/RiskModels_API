"""Bake Inter's tabular-figure feature into a static face.

Inter reaches tabular numerals through the OpenType ``tnum`` feature, which
CSS can request (``font-feature-settings: 'tnum'``) and matplotlib cannot:
FreeType exposes no feature-tag selection, so every number matplotlib draws
uses proportional figures. Columns of percentages then fail to align, which
is precisely what the house spec reserves tabular figures for.

The fix is to resolve the substitution ahead of time — rewrite the cmap so
the digit codepoints point at the tabular glyphs — and ship the result as
its own family. Renaming is not optional politeness: two faces both called
"Inter" that set numbers differently is a trap for whoever debugs it next.

Usage:  freeze_tnum.py <src.otf> ... <dest-dir>
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

NEW_FAMILY = "Inter Tabular"


def tnum_map(font: TTFont) -> dict[str, str]:
    """glyph -> tabular glyph, from the font's own ``tnum`` lookups."""
    gsub = font["GSUB"].table
    wanted = {
        i
        for rec in gsub.FeatureList.FeatureRecord
        if rec.FeatureTag == "tnum"
        for i in rec.Feature.LookupListIndex
    }
    out: dict[str, str] = {}
    for idx in sorted(wanted):
        lookup = gsub.LookupList.Lookup[idx]
        for sub in lookup.SubTable:
            mapping = getattr(sub, "mapping", None)
            if mapping:
                out.update(mapping)
    return out


def freeze(src: Path, dest_dir: Path) -> Path:
    font = TTFont(src)
    mapping = tnum_map(font)
    if not mapping:
        raise SystemExit(f"{src.name}: no tnum lookups found")

    remapped = 0
    for table in font["cmap"].tables:
        for code, glyph in list(table.cmap.items()):
            if glyph in mapping:
                table.cmap[code] = mapping[glyph]
                remapped += 1

    # Rename: family (1, 16) and full/postscript names (4, 6), leaving the
    # subfamily alone so weights still resolve.
    for rec in font["name"].names:
        try:
            value = str(rec)
        except Exception:
            continue
        if rec.nameID in (1, 16):
            rec.string = value.replace("Inter", NEW_FAMILY, 1)
        elif rec.nameID in (4, 3):
            rec.string = value.replace("Inter", NEW_FAMILY, 1)
        elif rec.nameID == 6:
            rec.string = value.replace("Inter", NEW_FAMILY.replace(" ", ""), 1)

    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / src.name.replace("Inter-", "InterTabular-")
    font.save(out)
    return out


def main(argv: list[str]) -> int:
    *srcs, dest = argv
    dest_dir = Path(dest)
    for s in srcs:
        out = freeze(Path(s), dest_dir)
        # Verify the point of the exercise: digits now share one advance.
        f = TTFont(out, lazy=True)
        hmtx = f["hmtx"]
        cmap = f.getBestCmap()
        widths = {hmtx[cmap[ord(d)]][0] for d in "0123456789"}
        status = "tabular" if len(widths) == 1 else f"NOT tabular ({sorted(widths)})"
        print(f"{out.name}: digit advances {widths} -> {status}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
