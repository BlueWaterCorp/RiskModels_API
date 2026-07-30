"""House typography — Charter for headlines, Inter for everything analytical.

The system, as specified:

    Paper / report title      Charter                   Bold
    Exhibit / chart title     Charter                   Bold
    Subheading                Charter                   Bold
    Body and annotations      Inter                     Regular
    Axis and legend labels    Inter                     Regular / Medium
    Data labels and tables    Inter, tabular numerals   Medium
    Eyebrows and metadata     Inter                     Semibold

Why this module exists rather than a family name in ``rcParams``
---------------------------------------------------------------
Resolving a font by *name* means whatever the host happens to have wins. That
had already gone wrong twice here: the theme declared Inter and no Inter file
existed anywhere, so matplotlib drew every panel in DejaVu Sans while Plotly
asked Chrome for the same stack and got Helvetica — the raster and web halves
of one page set in two different faces, neither of them the declared one. And
once Charter *is* installed, ``family="Charter"`` resolves to Apple's system
``Charter.ttc`` in preference to the bundled file.

So every role below resolves to an explicit **file path** under ``fonts/``,
and renderers ask for a role rather than a family. A missing file is a loud
failure at import, not a silent substitution that only shows up in a printed
PDF three weeks later.

Tabular numerals
----------------
Inter reaches tabular figures through the OpenType ``tnum`` feature. CSS can
request it; matplotlib cannot — FreeType exposes no feature selection — so
numbers in raster and PDF output would use proportional figures and columns
of percentages would not align. ``InterTabular-*`` is Inter with that
substitution resolved into the cmap ahead of time, which is why axis ticks,
percentages and table cells point at a different file from body text.

Licensing: Inter is SIL OFL 1.1, Charter is Bitstream's permissive grant.
Both permit redistribution; the notices ship beside the files.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

FONT_DIR = Path(__file__).resolve().parent / "fonts"

# role -> (filename, css/plotly family, css weight)
_ROLE_FILES: dict[str, tuple[str, str, int]] = {
    "title":      ("Charter Bold.otf",           "Charter", 700),
    "exhibit":    ("Charter Bold.otf",           "Charter", 700),
    "subheading": ("Charter Bold.otf",           "Charter", 700),
    "body":       ("Inter-Regular.otf",          "Inter",   400),
    "axis":       ("InterTabular-Regular.otf",   "Inter",   400),
    "axis_strong":("InterTabular-Medium.otf",    "Inter",   500),
    "data":       ("InterTabular-Medium.otf",    "Inter",   500),
    "eyebrow":    ("Inter-SemiBold.otf",         "Inter",   600),
    "emphasis":   ("Inter-Bold.otf",             "Inter",   700),
    "italic":     ("Charter Italic.otf",         "Charter", 400),
}

ROLES = tuple(_ROLE_FILES)

# Registered once; matplotlib's font manager is process-global.
_REGISTERED = False


def font_path(role: str) -> Path:
    try:
        filename = _ROLE_FILES[role][0]
    except KeyError:
        raise KeyError(f"unknown typography role {role!r}; expected one of {ROLES}") from None
    path = FONT_DIR / filename
    if not path.is_file():
        raise FileNotFoundError(
            f"bundled font missing for role {role!r}: {path}. The SDK ships its "
            "own faces precisely so rendering never depends on what the host "
            "has installed — reinstall the package rather than letting this "
            "fall back."
        )
    return path


def register(strict: bool = True) -> None:
    """Register every bundled face with matplotlib's font manager.

    Idempotent. ``strict=False`` downgrades a missing file to a warning, for
    callers that would rather draw in a fallback than not draw at all.
    """
    global _REGISTERED
    if _REGISTERED:
        return
    from matplotlib import font_manager

    for role in ROLES:
        try:
            font_manager.fontManager.addfont(str(font_path(role)))
        except FileNotFoundError:
            if strict:
                raise
            import warnings

            warnings.warn(
                f"typography role {role!r} unavailable; falling back to a "
                "system font — output will not match the house spec",
                UserWarning,
                stacklevel=2,
            )
    _REGISTERED = True


def prop(role: str, size: float, **kwargs: Any):
    """``FontProperties`` bound to the bundled file for ``role``.

    Pass this as ``fontproperties=`` on any matplotlib text call. Binding by
    path rather than family is the whole point — see the module docstring.
    """
    from matplotlib.font_manager import FontProperties

    return FontProperties(fname=str(font_path(role)), size=size, **kwargs)


def css_stack(role: str) -> str:
    """Plotly / CSS family string for ``role``.

    The web tier resolves fonts by name, so the same faces must be served to
    the browser (``.net`` ships Inter and can serve Charter the same way) or
    the two tiers diverge again.
    """
    family = _ROLE_FILES[role][1]
    tail = "Georgia, serif" if family == "Charter" else "system-ui, sans-serif"
    return f"{family}, {tail}"


def css_weight(role: str) -> int:
    return _ROLE_FILES[role][2]


@dataclass(frozen=True)
class VectorOutput:
    """Settings that keep exported text real text.

    matplotlib's PDF/PS default is Type 3, which embeds glyph *drawings*:
    the result is unsearchable, uncopyable, and rejected by several
    journal and print workflows. 42 selects TrueType/CFF embedding
    instead. ``svg.fonttype="none"`` keeps SVG text as text referencing
    the family by name — smaller and editable, on the condition the
    consumer has the font, which is why the faces are bundled and served
    rather than assumed.
    """

    pdf_fonttype: int = 42
    ps_fonttype: int = 42
    svg_fonttype: str = "none"
    # Print: 300 is the floor for a raster in a printed document, 600 for
    # anything with hairlines. Web: 2x a CSS pixel budget.
    dpi_print: int = 300
    dpi_print_fine: int = 600
    scale_web: int = 2


VECTOR = VectorOutput()


def apply_rcparams(rc: Any) -> None:
    """Font + vector-output rcParams. Call from the theme's global apply."""
    register(strict=False)
    rc["font.family"] = "sans-serif"
    rc["font.sans-serif"] = ["Inter", "Helvetica Neue", "Arial", "sans-serif"]
    rc["font.serif"] = ["Charter", "Georgia", "serif"]
    rc["pdf.fonttype"] = VECTOR.pdf_fonttype
    rc["ps.fonttype"] = VECTOR.ps_fonttype
    rc["svg.fonttype"] = VECTOR.svg_fonttype
    # Keep exported vector text selectable rather than converted to paths.
    rc["pdf.compression"] = 6
