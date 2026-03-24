import pytest

from riskmodels.exceptions import RiskModelsValidationError
from riskmodels.validation import run_validation, validate_l3_er_sum


def test_l3_er_sum_ok():
    m = {
        "l3_market_er": 0.25,
        "l3_sector_er": 0.25,
        "l3_subsector_er": 0.25,
        "l3_residual_er": 0.25,
    }
    ok, total, issue = validate_l3_er_sum(m, tolerance=0.05)
    assert ok and total == 1.0 and issue is None


def test_strict_negative_market_hr():
    m = {
        "l3_market_hr": -0.1,
        "l3_market_er": 0.25,
        "l3_sector_er": 0.25,
        "l3_subsector_er": 0.25,
        "l3_residual_er": 0.25,
    }
    with pytest.raises(RiskModelsValidationError) as ei:
        run_validation(m, mode="error")
    assert "Fix:" in str(ei.value)
