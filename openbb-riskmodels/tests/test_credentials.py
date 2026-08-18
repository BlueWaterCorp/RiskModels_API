from __future__ import annotations

from types import SimpleNamespace

from openbb_riskmodels.credentials import resolve_api_key


def test_store_key_wins_over_env(monkeypatch):
    monkeypatch.setenv("RISKMODELS_API_KEY", "env-key")
    creds = SimpleNamespace(riskmodels_api_key="store-key")
    cc = SimpleNamespace(user_settings=SimpleNamespace(credentials=creds))
    assert resolve_api_key(cc) == "store-key"


def test_env_used_when_store_empty(monkeypatch):
    monkeypatch.setenv("RISKMODELS_API_KEY", "env-key")
    creds = SimpleNamespace(riskmodels_api_key="")
    cc = SimpleNamespace(user_settings=SimpleNamespace(credentials=creds))
    assert resolve_api_key(cc) == "env-key"


def test_model_dump_credentials(monkeypatch):
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)

    class Creds:
        def model_dump(self):
            return {"riskmodels_api_key": "dumped-key"}

    cc = SimpleNamespace(user_settings=SimpleNamespace(credentials=Creds()))
    assert resolve_api_key(cc) == "dumped-key"


def test_none_without_store_or_env(monkeypatch):
    monkeypatch.delenv("RISKMODELS_API_KEY", raising=False)
    assert resolve_api_key(None) is None
