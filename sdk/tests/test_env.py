"""Tests for ``riskmodels.env.load_repo_dotenv``."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from riskmodels.env import load_repo_dotenv


def test_load_repo_dotenv_merges_files_without_overwriting_process_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / ".env").write_text("RISKMODELS_BASE_URL=https://from-env.test/api\nSHARED=from-dot-env\n")
    (tmp_path / ".env.local").write_text("SHARED=from-local\nOTHER=extra\n")

    monkeypatch.setenv("SHARED", "from-process")
    monkeypatch.delenv("OTHER", raising=False)
    monkeypatch.delenv("RISKMODELS_BASE_URL", raising=False)

    assert load_repo_dotenv(tmp_path) is True

    assert os.environ["SHARED"] == "from-process"
    assert os.environ["RISKMODELS_BASE_URL"] == "https://from-env.test/api"
    assert os.environ["OTHER"] == "extra"


def test_load_repo_dotenv_no_files(tmp_path: Path) -> None:
    assert load_repo_dotenv(tmp_path) is False
