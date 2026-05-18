"""``RiskModelsClient.from_env`` — Supabase init-check tests (MASTER_BACKLOG P.5).

``get_ticker_metadata`` and other Supabase-backed SDK methods used to raise
``ValueError`` at call time when credentials weren't wired — pre-production
CI tests with mocked HTTP often missed it because they never reached the
real Supabase call path. The fix WARNs at ``from_env`` time so developers
see a startup signal that those methods will fail.
"""

from __future__ import annotations

import logging

import pytest

from riskmodels.client import RiskModelsClient, _warn_if_supabase_creds_missing


# ---------------------------------------------------------------------------
# Fixtures — strip / set Supabase env vars + a baseline API key
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_supabase_env(monkeypatch):
    for var in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture(autouse=True)
def _set_api_key(monkeypatch):
    """Provide a Bearer key so from_env() returns a client instead of raising."""
    monkeypatch.setenv("RISKMODELS_API_KEY", "rm_test_key_xxx")


# ---------------------------------------------------------------------------
# _warn_if_supabase_creds_missing — direct helper tests
# ---------------------------------------------------------------------------


def test_warns_when_neither_url_nor_key_set(caplog):
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        _warn_if_supabase_creds_missing()
    sb_warnings = [r for r in caplog.records if "Supabase credentials" in r.message]
    assert len(sb_warnings) == 1
    assert sb_warnings[0].levelno == logging.WARNING


def test_warns_when_url_set_but_key_missing(monkeypatch, caplog):
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        _warn_if_supabase_creds_missing()
    assert any("Supabase credentials" in r.message for r in caplog.records)


def test_warns_when_key_set_but_url_missing(monkeypatch, caplog):
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "secret")
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        _warn_if_supabase_creds_missing()
    assert any("Supabase credentials" in r.message for r in caplog.records)


def test_no_warning_when_server_style_creds_present(monkeypatch, caplog):
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "secret")
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        _warn_if_supabase_creds_missing()
    assert not any("Supabase credentials" in r.message for r in caplog.records)


def test_no_warning_when_next_public_style_creds_present(monkeypatch, caplog):
    """Either credential convention satisfies the check — matches the
    SDK's _supabase_creds() resolution which accepts either form."""
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        _warn_if_supabase_creds_missing()
    assert not any("Supabase credentials" in r.message for r in caplog.records)


def test_no_warning_when_mixed_url_and_key_present(monkeypatch, caplog):
    """Mixed conventions (server-style URL + Next.js anon key) satisfy
    the check — both are accepted, the check sees ANY url + ANY key."""
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        _warn_if_supabase_creds_missing()
    assert not any("Supabase credentials" in r.message for r in caplog.records)


def test_warning_message_mentions_both_conventions(caplog):
    """The WARN must name both env var conventions so the operator
    knows either pair is acceptable."""
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        _warn_if_supabase_creds_missing()
    msg = next(r.message for r in caplog.records if "Supabase credentials" in r.message)
    assert "SUPABASE_URL" in msg
    assert "SUPABASE_SERVICE_ROLE_KEY" in msg
    assert "NEXT_PUBLIC_" in msg


def test_warning_explains_consequences(caplog):
    """Operator needs to know WHAT will fail without creds, otherwise
    the warning is just noise."""
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        _warn_if_supabase_creds_missing()
    msg = next(r.message for r in caplog.records if "Supabase credentials" in r.message)
    assert "get_ticker_metadata" in msg or "Supabase-backed" in msg
    assert "ValueError" in msg or "raise" in msg.lower()


# ---------------------------------------------------------------------------
# Integration — the check actually fires from RiskModelsClient.from_env()
# ---------------------------------------------------------------------------


def test_from_env_emits_warning_when_supabase_unwired(caplog):
    """End-to-end: from_env() returns a working client AND emits the
    Supabase warning when creds missing. The client itself still
    builds successfully — Supabase access is optional."""
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        c = RiskModelsClient.from_env()
    assert c is not None  # client built OK despite missing Supabase
    assert any("Supabase credentials" in r.message for r in caplog.records)


def test_from_env_silent_when_supabase_wired(monkeypatch, caplog):
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "secret")
    with caplog.at_level(logging.WARNING, logger="riskmodels.client"):
        RiskModelsClient.from_env()
    sb_warnings = [r for r in caplog.records if "Supabase credentials" in r.message]
    assert sb_warnings == []
