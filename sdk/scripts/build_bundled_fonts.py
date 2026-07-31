"""Build the fonts the SDK ships: subset, freeze tabular figures, verify.

Run after upgrading Inter or Charter. Three steps, and the third is the one
that matters:

1. **Subset** each face to the ranges the renderers actually set. Inter ships
   full Latin/Greek/Cyrillic at ~600 KB a weight; the bundle would be 3.7 MB
   unsubset, which is a lot to put in a wheel for glyphs no chart draws.
2. **Freeze** Inter's OpenType ``tnum`` into a separate ``Inter Tabular``
   family. matplotlib cannot select OpenType features — FreeType exposes no
   API for it — so tabular figures have to exist as their own face or columns
   of percentages do not align.
3. **Verify** every non-ASCII character the render code actually contains is
   present in every bundled face.

Step 3 exists because step 1 was first done by hand against a guessed range,
and it silently dropped Greek: the canonical fund snapshot draws ρ, the DNA
panels draw σ, and CI surfaced it as ``Glyph 961 missing from font(s) Inter``
only after the faces had been committed. A subset is a guess about usage;
this checks the guess against the source.

Usage:  build_bundled_fonts.py [--src ~/Library/Fonts] [--check-only]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).resolve().parent.parent / "riskmodels" / "snapshots" / "fonts"

# Trees whose string literals reach a renderer.
SCAN_ROOTS = [
    Path(__file__).resolve().parent.parent / "riskmodels",
]

INTER_WEIGHTS = ("Regular", "Medium", "SemiBold", "Bold")
TABULAR_WEIGHTS = ("Regular", "Medium")
CHARTER_FACES = ("Charter Regular", "Charter Bold", "Charter Italic",
                 "Charter Bold Italic")

# Deliberately generous. The cost of one more range is a few KB; the cost of
# one missing range is a tofu box in a printed exhibit that nobody sees until
# a client does.
UNICODES = ",".join([
    "U+0020-007E",   # ASCII
    "U+00A0-00FF",   # Latin-1: · × ± ² ½ ÷ §
    "U+0100-017F",   # Latin Extended-A
    "U+0370-03FF",   # Greek: σ β α ρ Σ Π
    "U+2000-206F",   # General punctuation: — – … • ‰ “ ”
    "U+2070-209F",   # Super/subscripts
    "U+20A0-20BF",   # Currency
    "U+2100-214F",   # Letterlike
    "U+2190-21FF",   # Arrows: → ← ↔ ↳
    "U+2200-22FF",   # Math: √ ∝ ∏ ≡ ∈ ≠ ≤ ≥ −
    "U+2300-23FF",   # Misc technical
    "U+25A0-25FF",   # Geometric shapes: ■ ▪
    "U+2713-2717",   # ✓ ✗
    "U+FB00-FB04",   # ligatures
])
LAYOUT_FEATURES = "kern,liga,calt,tnum,case,ccmp,locl,frac,sups,subs"


def used_codepoints() -> set[int]:
    """Every non-ASCII character appearing in the scanned source."""
    found: set[int] = set()
    for root in SCAN_ROOTS:
        for path in root.rglob("*.py"):
            try:
                text = path.read_text()
            except (OSError, UnicodeDecodeError):
                continue
            found.update(ord(c) for c in text if ord(c) > 127)
    # Box-drawing and blocks are ASCII-art in comments and console banners,
    # never chart text. Excluding them keeps the faces small.
    return {c for c in found if not (0x2500 <= c <= 0x259F)}


def verify(src_dir: Path) -> int:
    """Check the subset kept what the source had.

    The comparison is against the *upstream* face, not against the used set
    directly, because those are two different questions. A glyph the render
    code sets, upstream has, and the bundled face lacks is a subsetting bug
    and fails. A glyph upstream never had cannot be subset in — Inter has no
    ∈, ∝ or ≡ — so that is reported and moves on.

    Only Inter is held to the full set. Charter sets headlines and has no
    Greek or math coverage at all; demanding σ of a text serif would fail
    every build for a glyph no title contains.
    """
    wanted = used_codepoints()
    bugs = upstream_gaps = 0

    for style in INTER_WEIGHTS:
        face = FONT_DIR / f"Inter-{style}.otf"
        src = src_dir / f"Inter-{style}.otf"
        if not face.is_file():
            print(f"  MISSING FACE {face.name}", file=sys.stderr)
            bugs += 1
            continue
        have = TTFont(face, lazy=True).getBestCmap()
        upstream = TTFont(src, lazy=True).getBestCmap() if src.is_file() else have
        dropped = sorted(c for c in wanted if c not in have and c in upstream)
        absent = sorted(c for c in wanted if c not in upstream)
        if dropped:
            bugs += 1
            shown = " ".join(f"U+{c:04X}({chr(c)})" for c in dropped[:12])
            print(f"  DROPPED  {face.name}: {len(dropped)} — {shown}")
        else:
            note = f"  ({len(absent)} absent upstream)" if absent else ""
            print(f"  ok       {face.name}{note}")
            upstream_gaps = max(upstream_gaps, len(absent))

    for style in TABULAR_WEIGHTS:
        face = FONT_DIR / f"InterTabular-{style}.otf"
        have = TTFont(face, lazy=True).getBestCmap()
        src = TTFont(src_dir / f"Inter-{style}.otf", lazy=True).getBestCmap()
        dropped = sorted(c for c in wanted if c not in have and c in src)
        if dropped:
            bugs += 1
            print(f"  DROPPED  {face.name}: {len(dropped)}")
        else:
            print(f"  ok       {face.name}")

    for face in CHARTER_FACES:
        path = FONT_DIR / f"{face}.otf"
        if not path.is_file():
            print(f"  MISSING FACE {face}.otf", file=sys.stderr)
            bugs += 1
            continue
        cmap = TTFont(path, lazy=True).getBestCmap()
        # Headline face: ASCII plus the punctuation a title actually uses.
        need = set(range(0x20, 0x7F)) | {0x00B7, 0x00D7, 0x2013, 0x2014, 0x2212}
        missing = sorted(c for c in need if c not in cmap)
        print(f"  {'DROPPED ' if missing else 'ok      '} {face}.otf"
              f"{f': {len(missing)}' if missing else ' (headline set)'}")
        bugs += bool(missing)

    if bugs:
        print(f"\n{bugs} face(s) lost glyphs in subsetting. Widen UNICODES and "
              "rebuild — a dropped glyph prints as a tofu box.", file=sys.stderr)
    elif upstream_gaps:
        print(f"\nClean. {upstream_gaps} glyph(s) the code contains are absent "
              "from upstream Inter (∈ ∝ ≡); matplotlib falls back for those. "
              "Only ∝ reaches rendered text — attribution_cascade's title.")
    return 1 if bugs else 0


def subset(src: Path, dest: Path) -> None:
    subprocess.run(
        [sys.executable, "-m", "fontTools.subset", str(src),
         f"--unicodes={UNICODES}", f"--layout-features={LAYOUT_FEATURES}",
         f"--output-file={dest}", "--drop-tables+=DSIG"],
        check=True, capture_output=True,
    )


def freeze_tabular(src: Path, dest: Path) -> None:
    """Inter with ``tnum`` resolved into the cmap, renamed to its own family."""
    font = TTFont(src)
    gsub = font["GSUB"].table
    lookups = {
        i for rec in gsub.FeatureList.FeatureRecord if rec.FeatureTag == "tnum"
        for i in rec.Feature.LookupListIndex
    }
    mapping: dict[str, str] = {}
    for idx in sorted(lookups):
        for sub in gsub.LookupList.Lookup[idx].SubTable:
            mapping.update(getattr(sub, "mapping", None) or {})
    if not mapping:
        raise SystemExit(f"{src.name}: no tnum lookups")
    for table in font["cmap"].tables:
        for code, glyph in list(table.cmap.items()):
            if glyph in mapping:
                table.cmap[code] = mapping[glyph]
    font.save(dest)


def normalize_names(path: Path, family: str, style: str) -> None:
    """One nameID-1 family per face, weight in the subfamily.

    Inter's statics call themselves family "Inter Medium", which makes
    matplotlib treat each weight as a separate family and
    ``family="Inter", weight=500`` resolve to nothing.
    """
    font = TTFont(path)
    for rec in font["name"].names:
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID in (2, 17):
            rec.string = style
        elif rec.nameID == 4:
            rec.string = f"{family} {style}"
        elif rec.nameID == 6:
            rec.string = f"{family.replace(' ', '')}-{style}"
    font.save(path)


def build(src_dir: Path) -> int:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    for style in INTER_WEIGHTS:
        src = src_dir / f"Inter-{style}.otf"
        if not src.is_file():
            print(f"missing source {src}", file=sys.stderr)
            return 1
        out = FONT_DIR / f"Inter-{style}.otf"
        subset(src, out)
        normalize_names(out, "Inter", style)
        print(f"  built {out.name}")

    for style in TABULAR_WEIGHTS:
        tmp = FONT_DIR / f".tmp-InterTabular-{style}.otf"
        freeze_tabular(src_dir / f"Inter-{style}.otf", tmp)
        out = FONT_DIR / f"InterTabular-{style}.otf"
        subset(tmp, out)
        tmp.unlink()
        normalize_names(out, "Inter Tabular", style)
        font = TTFont(out, lazy=True)
        cmap = font.getBestCmap()
        widths = {font["hmtx"][cmap[ord(d)]][0] for d in "0123456789"}
        if len(widths) != 1:
            print(f"  {out.name}: digits NOT tabular {widths}", file=sys.stderr)
            return 1
        print(f"  built {out.name} (digit advance {widths.pop()})")

    for face in CHARTER_FACES:
        src = src_dir / f"{face}.otf"
        if src.is_file():
            shutil.copy2(src, FONT_DIR / f"{face}.otf")
            print(f"  copied {face}.otf")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", type=Path, default=Path.home() / "Library" / "Fonts",
                    help="directory holding the upstream Inter / Charter faces")
    ap.add_argument("--check-only", action="store_true",
                    help="verify the committed faces without rebuilding")
    args = ap.parse_args(argv)

    if not args.check_only:
        print("building:")
        rc = build(args.src)
        if rc:
            return rc
    print("verifying against glyphs the render code sets:")
    return verify(args.src)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
