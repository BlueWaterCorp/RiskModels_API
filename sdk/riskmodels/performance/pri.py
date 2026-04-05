"""PRI / benchmark-relative namespace (scaffold)."""

from __future__ import annotations

from typing import Any


class PRICurrent:
    def __init__(self, client: Any) -> None:
        self._client = client

    def data(self, **kwargs: Any) -> Any:
        raise NotImplementedError("PRI benchmark-relative data() is not implemented yet")

    def plot(self, **kwargs: Any) -> Any:
        raise NotImplementedError("PRI benchmark-relative plot() is not implemented yet")


class PRIHistorical:
    def __init__(self, client: Any) -> None:
        self._client = client

    def data(self, **kwargs: Any) -> Any:
        raise NotImplementedError("PRI historical data() is not implemented yet")


class PRINamespace:
    def __init__(self, client: Any) -> None:
        self._client = client
        self.current = PRICurrent(client)
        self.historical = PRIHistorical(client)
