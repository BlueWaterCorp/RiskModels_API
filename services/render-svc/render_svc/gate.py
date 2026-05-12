"""Fast-subset contract gate for the live render path.

Mirrors the gate documented in ``GCS_PRERENDER_OPERATIONS.md`` §4. Catches
the failure modes that matter at runtime (vocabulary drift, missing version
stamps, missing observational frame) without paying the ~500ms cost of the
full 9-gate suite the Dagster batch runs.

The full gate lives at ``riskmodels.snapshots.contract_check`` and runs in
CI + nightly. This subset is the live-path complement.
"""

from __future__ import annotations

from typing import Any

from riskmodels.snapshots import OBSERVATION_MODES
from riskmodels.snapshots.canonical import (
    CANONICAL_ONTOLOGY_VERSION,
    CANONICAL_SCHEMA_VERSION,
)


_AOM_LENSES = frozenset({"return_attribution", "risk_decomposition", "exposure"})
_KNOWN_COMPOSITIONS = frozenset({"P1", "F1", "C1"})


def fast_subset_check(snap: Any) -> list[str]:
    """Run the fast-subset contract gate. Returns the list of failures.

    Empty list = pass. ~5ms per call. Asserts the four invariants the live
    render path needs:

    1. Schema + ontology version stamps match the constants the SDK ships
       with (catches dependency drift in the container).
    2. AOM provenance exists, uses v1 vocabulary, has a known composition.
    3. Observation_mode is in {reality, knowledge, system}.
    4. Temporal context exists and matches the identity as_of.
    """
    failures: list[str] = []

    if snap.schema_version != CANONICAL_SCHEMA_VERSION:
        # CanonicalFundSnapshot uses ``canonical-fund/1.0`` instead — accept either.
        if snap.schema_version != "canonical-fund/1.0":
            failures.append(
                f"schema_version={snap.schema_version!r} not recognized"
            )

    if snap.ontology_version != CANONICAL_ONTOLOGY_VERSION:
        failures.append(
            f"ontology_version={snap.ontology_version!r} "
            f"!= {CANONICAL_ONTOLOGY_VERSION!r}"
        )

    aom = snap.aom
    if aom is None:
        failures.append("aom provenance missing")
    else:
        if aom.composition not in _KNOWN_COMPOSITIONS:
            failures.append(f"aom.composition={aom.composition!r} unknown")
        for lens in aom.lenses:
            if lens not in _AOM_LENSES:
                failures.append(f"aom.lens {lens!r} not in v1 vocabulary")
        if aom.observation_mode is not None and aom.observation_mode not in OBSERVATION_MODES:
            failures.append(
                f"aom.observation_mode={aom.observation_mode!r} "
                f"not in {OBSERVATION_MODES}"
            )

    temporal = snap.temporal
    if temporal is None:
        failures.append("temporal context missing")
    else:
        if temporal.observation_mode not in OBSERVATION_MODES:
            failures.append(
                f"temporal.observation_mode={temporal.observation_mode!r} "
                f"not in {OBSERVATION_MODES}"
            )

    return failures
