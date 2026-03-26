import warnings

import pytest

from riskmodels.exceptions import RiskModelsValidationError, ValidationWarning
from riskmodels.validation import run_validation, validate_hr_signs, validate_l3_er_sum


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


def test_er_sum_at_tolerance_boundary_pass():
    # 0.2+0.25+0.25+0.25 = 0.95 with stable float sum vs 1.0 (|Δ|=0.05 on tolerance boundary).
    m = {
        "l3_market_er": 0.2,
        "l3_sector_er": 0.25,
        "l3_subsector_er": 0.25,
        "l3_residual_er": 0.25,
    }
    ok, total, issue = validate_l3_er_sum(m, tolerance=0.05)
    assert ok and abs(total - 0.95) < 1e-9 and issue is None


def test_er_sum_just_outside_tolerance_fails():
    m = {
        "l3_market_er": 0.235,
        "l3_sector_er": 0.235,
        "l3_subsector_er": 0.235,
        "l3_residual_er": 0.235,
    }
    ok, total, issue = validate_l3_er_sum(m, tolerance=0.05)
    assert not ok and total == 0.94 and issue is not None


def test_er_sum_1_05_within_tolerance():
    # 0.26*3+0.27 = 1.05; float distance to 1.0 stays within tol=0.05 (avoids 0.25*4+0.05 float drift).
    m = {
        "l3_market_er": 0.26,
        "l3_sector_er": 0.26,
        "l3_subsector_er": 0.26,
        "l3_residual_er": 0.27,
    }
    ok, total, issue = validate_l3_er_sum(m, tolerance=0.05)
    assert ok and abs(total - 1.05) < 1e-9 and issue is None


def test_nullable_er_fields_incomplete():
    m = {
        "l3_market_er": None,
        "l3_sector_er": None,
        "l3_subsector_er": None,
        "l3_residual_er": None,
    }
    ok, total, issue = validate_l3_er_sum(m, tolerance=0.05)
    assert not ok and total is None and issue is not None


def test_negative_l3_subsector_hr_not_in_hr_sign_issues():
    m = {"l3_subsector_hr": -0.5}
    assert validate_hr_signs(m) == []


def test_negative_l2_sector_hr_raises_in_error_mode():
    m = {
        "l2_sector_hr": -0.1,
        "l3_market_er": 0.25,
        "l3_sector_er": 0.25,
        "l3_subsector_er": 0.25,
        "l3_residual_er": 0.25,
    }
    with pytest.raises(RiskModelsValidationError):
        run_validation(m, mode="error")


def test_validate_warn_negative_market_hr_emits_warning_not_raise():
    m = {
        "l3_market_hr": -0.1,
        "l3_market_er": 0.25,
        "l3_sector_er": 0.25,
        "l3_subsector_er": 0.25,
        "l3_residual_er": 0.25,
    }
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        run_validation(m, mode="warn")
    assert any(isinstance(x.message, ValidationWarning) for x in w)
