"""HTTP / JSON lineage for ERM3 responses."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class RiskLineage:
    model_version: str | None = None
    data_as_of: str | None = None
    factor_set_id: str | None = None
    universe_size: int | None = None
    request_id: str | None = None
    cost_usd: str | None = None

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str)

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}

    @classmethod
    def from_response_headers(cls, headers: Mapping[str, str]) -> RiskLineage:
        def get(name: str) -> str | None:
            v = headers.get(name) or headers.get(name.lower())
            return v if v else None

        u = get("X-Universe-Size")
        return cls(
            model_version=get("X-Risk-Model-Version"),
            data_as_of=get("X-Data-As-Of"),
            factor_set_id=get("X-Factor-Set-Id"),
            universe_size=int(u) if u and u.isdigit() else None,
            request_id=get("X-Request-ID"),
            cost_usd=get("X-API-Cost-USD"),
        )

    @classmethod
    def from_metadata(cls, meta: Mapping[str, Any] | None) -> RiskLineage | None:
        if not meta:
            return None
        u = meta.get("universe_size")
        return cls(
            model_version=meta.get("model_version"),
            data_as_of=meta.get("data_as_of"),
            factor_set_id=meta.get("factor_set_id"),
            universe_size=int(u) if u is not None else None,
            request_id=None,
            cost_usd=None,
        )

    @classmethod
    def merge(cls, a: RiskLineage | None, b: RiskLineage | None) -> RiskLineage:
        if not a:
            return b or cls()
        if not b:
            return a
        return cls(
            model_version=b.model_version or a.model_version,
            data_as_of=b.data_as_of or a.data_as_of,
            factor_set_id=b.factor_set_id or a.factor_set_id,
            universe_size=b.universe_size if b.universe_size is not None else a.universe_size,
            request_id=b.request_id or a.request_id,
            cost_usd=b.cost_usd or a.cost_usd,
        )
