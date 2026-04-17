"""Named SDK contributors — included in :meth:`RiskModelsClient.discover` output.

Maintainers: when you merge a substantive code or documentation contribution, add an
entry here so everyone who runs ``client.discover()`` (Markdown or JSON) sees public
credit. Keep entries short (one line of ``contribution`` is enough).

Optional keys per entry:

- ``name`` (required): display name or GitHub handle.
- ``contribution``: what they shipped (e.g. "MCP tool parity", "rankings DataFrame attrs").
- ``url``: homepage or ``https://github.com/...`` — shown as a link in Markdown discover output.
"""

from __future__ import annotations

from typing import TypedDict


class SDKContributorDict(TypedDict, total=False):
    """One contributor row. ``name`` should always be set."""

    name: str
    contribution: str
    url: str


# Public list (also embedded in DISCOVER_SPEC["contributors"] for JSON discover).
# Order: roughly chronological or alphabetical — your choice; keep stable across releases.
SDK_CONTRIBUTORS: list[SDKContributorDict] = [
    # Example:
    # {"name": "Jane Doe", "contribution": "Batch analyze typing + tests", "url": "https://github.com/janedoe"},
]
