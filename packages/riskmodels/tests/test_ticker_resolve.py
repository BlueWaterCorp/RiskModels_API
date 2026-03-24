import pytest

from riskmodels.exceptions import ValidationWarning
from riskmodels.ticker_resolve import resolve_ticker


def test_googl_to_goog():
    with pytest.warns(ValidationWarning, match="GOOGL"):
        t, note = resolve_ticker("googl")
    assert t == "GOOG"
    assert note is not None
    assert note.canonical == "GOOG"
