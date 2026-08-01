"""Filer subject-id spelling resolution.

Two spellings of one identity are in production use, and both are correct
somewhere today:

    BW-FILER-0001067983       entity_header, top_holdings_erm_stacked, …
    BW-FILER-CIK0001067983    nav_composition_dual; the whole /api/13f
                              surface and the SDK's filer client

Verified 2026-08-01 against ``gs://rm_api_data/snapshots/artifacts``: the same
filer (CIK 1067983) is stored under the bare form for ``entity_header@v1`` and
under the CIK-infix form for ``nav_composition_dual@v1``. Neither spelling can
simply be deleted — the objects exist under both.

The declared canonical is the BARE form: ``contracts.ts::SUBJECT_ID_PREFIX``
maps ``filer_13f -> "BW-FILER-"`` and ``artifacts.py::_SUBJECT_PREFIX_KIND``
mirrors it. The CIK infix is the deviation, so it normalizes toward the bare
form rather than the other way round.

This module deliberately borrows the shape of ``lib/ticker-aliases.ts``, which
keeps two relations apart:

    NOTATION_ALIASES   — the same security written a different way. Rewriting
                         one to another changes nothing a caller could observe,
                         so it needs no disclosure.

    CLASS_PROJECTIONS  — a *different* security, answered with a sibling's
                         numbers. That MUST be reported to the caller.

A filer id spelling is squarely the first kind: ``BW-FILER-CIK0001067983`` and
``BW-FILER-0001067983`` are the same legal entity, the same 13F filings, the
same bytes. Normalizing between them substitutes nothing, so there is no
disclosure field here and there should not be one — adding a "we changed your
id" flag would imply a substitution that did not happen. If a future change
ever answers one filer with a *different* filer's data, that is the second kind
and needs its own field, exactly as ``CLASS_PROJECTIONS`` does.

Zero-padding is NOT normalized here. ``BW-FILER-CIK1`` and
``BW-FILER-CIK0000000001`` are left distinct: that is a second normalization
axis with its own failure modes, no production artifact depends on it, and
guessing at it would silently merge ids this module cannot prove are equal.
"""

from __future__ import annotations

from dataclasses import dataclass

FILER_PREFIX = "BW-FILER-"

# The infix that distinguishes the two spellings. Applied immediately after
# FILER_PREFIX and nowhere else, so a filer whose id legitimately begins with
# the letters "CIK" after the prefix is not silently rewritten mid-identifier.
_CIK_INFIX = "CIK"


@dataclass(frozen=True)
class FilerSubjectResolution:
    """How a filer subject id was resolved.

    ``candidates`` is the probe order for a store lookup: the canonical
    spelling first, then any known alternate spelling that is not identical to
    it. Callers try each in order and serve the first that exists, because the
    corpus genuinely holds artifacts under both.
    """

    requested: str
    canonical: str
    candidates: tuple[str, ...]


def is_filer_subject_id(subject_id: str) -> bool:
    return subject_id.startswith(FILER_PREFIX)


def resolve_filer_subject_id(subject_id: str) -> FilerSubjectResolution:
    """Resolve a filer subject id to its canonical spelling + probe order.

    Non-filer ids pass through untouched with a single candidate, so callers
    can apply this unconditionally without special-casing subject kind.
    """
    requested = (subject_id or "").strip()
    if not is_filer_subject_id(requested):
        return FilerSubjectResolution(
            requested=requested, canonical=requested, candidates=(requested,)
        )

    body = requested[len(FILER_PREFIX) :]
    bare = body[len(_CIK_INFIX) :] if body.startswith(_CIK_INFIX) else body

    canonical = f"{FILER_PREFIX}{bare}"
    cik_form = f"{FILER_PREFIX}{_CIK_INFIX}{bare}"

    candidates = (canonical,) if cik_form == canonical else (canonical, cik_form)
    return FilerSubjectResolution(
        requested=requested, canonical=canonical, candidates=candidates
    )


def canonical_filer_subject_id(subject_id: str) -> str:
    """Resolve to the canonical spelling, discarding the probe order.

    Prefer :func:`resolve_filer_subject_id` anywhere the result drives a store
    lookup — this drops the alternate spelling, and the corpus holds artifacts
    under both, so a lookup on the canonical form alone can miss bytes that
    exist.
    """
    return resolve_filer_subject_id(subject_id).canonical
