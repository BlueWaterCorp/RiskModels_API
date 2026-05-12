"""Thin GCS object-store wrapper.

Three operations: head, read, write. Atomic-staged writes use the
write-then-rename pattern via GCS ``rewrite``, but for the bytes scale we
operate at (1-2 MB per artifact) a direct upload is fine and matches the
pattern in ``GCS_PRERENDER_OPERATIONS.md``.

Tests use a fake implementation; production uses google-cloud-storage.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class ObjectStore(Protocol):
    """Minimal object-store interface for testability."""

    def head(self, path: str) -> bool: ...
    def read(self, path: str) -> bytes | None: ...
    def write(self, path: str, data: bytes, *, content_type: str) -> None: ...


@dataclass(frozen=True)
class GcsObjectStore:
    """Production GCS implementation. Lazy-initializes the storage client."""

    bucket: str

    def _client(self):
        from google.cloud import storage  # imported lazily so tests don't need creds
        return storage.Client()

    def _blob(self, path: str):
        return self._client().bucket(self.bucket).blob(path)

    def head(self, path: str) -> bool:
        try:
            return self._blob(path).exists()
        except Exception:
            return False

    def read(self, path: str) -> bytes | None:
        from google.cloud.exceptions import NotFound  # imported lazily

        try:
            return self._blob(path).download_as_bytes()
        except NotFound:
            return None

    def write(self, path: str, data: bytes, *, content_type: str) -> None:
        blob = self._blob(path)
        blob.upload_from_string(data, content_type=content_type)


# Path resolution — the canonical layout for snapshot artifacts.

def canonical_path(
    prefix: str,
    composition: str,
    identifier: str,
    as_of: str,
    extension: str,
) -> str:
    """Resolve the GCS object path for a canonical artifact.

    ``{prefix}/{composition}/{YYYY-MM}/{identifier}.{extension}``

    Per ``GCS_PRERENDER_OPERATIONS.md``, monthly directories anchor each
    artifact's lifetime and re-renders within the month overwrite the
    previous month's file.
    """
    composition = composition.lower()
    if composition not in {"p1", "f1", "c1"}:
        raise ValueError(f"unknown composition {composition!r}")
    yyyy_mm = as_of[:7]  # ISO date "YYYY-MM-DD" → "YYYY-MM"
    return f"{prefix}/{composition}/{yyyy_mm}/{identifier}.{extension}"
