"""Pytest hooks — keep ``RiskModelsClient.from_env()`` tests isolated from repo ``.env.local``."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from unittest.mock import patch

import pytest

import riskmodels

# Floor matches sdk/pyproject.toml. Fail loud on path shadowing (stale wheel /
# lagged dist-info) instead of letting filer tests silently skip or AttributeError.
_MIN_SDK_VERSION = (0, 3, 11)


def _parse_version(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in v.split(".")[:3])


def pytest_configure(config: pytest.Config) -> None:
    """Assert the imported ``riskmodels`` tree matches the package under test."""
    init_ver = riskmodels.__version__
    try:
        dist_ver = version("riskmodels-py")
    except PackageNotFoundError as exc:
        raise pytest.UsageError(
            "riskmodels-py is not installed in this environment; "
            "install the editable SDK (`pip install -e .` / `uv sync`) before pytest."
        ) from exc

    package_root = Path(riskmodels.__file__).resolve().parent.parent
    expected_root = Path(__file__).resolve().parents[1]
    if package_root != expected_root:
        raise pytest.UsageError(
            f"riskmodels imported from {package_root}, expected {expected_root}. "
            "A second install is shadowing the SDK under test — reinstall editable "
            "from sdk/ or clear PYTHONPATH entries that prepend another tree."
        )

    if _parse_version(init_ver) < _MIN_SDK_VERSION:
        raise pytest.UsageError(
            f"riskmodels.__version__={init_ver!r} is below required "
            f"{'.'.join(map(str, _MIN_SDK_VERSION))}. Sync sdk/riskmodels version stamps."
        )

    if init_ver != dist_ver:
        raise pytest.UsageError(
            f"Version mismatch: riskmodels.__version__={init_ver!r} but "
            f"importlib.metadata reports riskmodels-py={dist_ver!r}. "
            "Reinstall the editable package so dist-info matches source "
            "(`cd sdk && uv sync` or `pip install -e .`)."
        )


@pytest.fixture(autouse=True)
def _disable_dotenv_during_tests(request: pytest.FixtureRequest) -> None:
    """Workspace ``.env.local`` must not override monkeypatched credentials in unit tests."""
    if request.path.name == "test_env.py":
        yield
        return
    with patch("riskmodels.env.load_repo_dotenv", return_value=False):
        yield
