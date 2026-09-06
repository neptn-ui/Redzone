# backend/tests/test_relocation_horizon_engine.py
# §14.3 Test Gate — relocation_horizon_engine.py (§2.2)
#
# Tests:
#   1. IMMEDIATE is assigned at hazard_score ≥ 0.75
#   2. IMMEDIATE is NEVER silently downgraded when no site is matched —
#      the rationale must flag "escalate emergency shelter search"
#   3. SHORT_TERM assigned for hazard_score in [0.55, 0.75)
#   4. MEDIUM_TERM assigned for hazard_score in [0.35, 0.55)
#   5. MONITOR assigned for hazard_score < 0.35
#   6. Trend-worsening elevates MEDIUM_TERM → SHORT_TERM
#   7. High vulnerability elevates MEDIUM_TERM → SHORT_TERM
#   8. Boundary conditions (exactly at thresholds)
#
# Run: pytest backend/tests/test_relocation_horizon_engine.py -v
# ============================================================================

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from scoring.relocation_horizon_engine import (
    classify_relocation_horizon,
    IMMEDIATE_THRESHOLD,
    SHORT_TERM_THRESHOLD,
    MEDIUM_TERM_THRESHOLD,
)


class TestImmediateHorizon:
    """hazard_score ≥ 0.75 → IMMEDIATE, regardless of site match."""

    def test_immediate_with_matched_site(self):
        horizon, rationale = classify_relocation_horizon(
            hazard_score=0.80,
            urgency_score=0.70,
            site_availability_factor=1.0,
        )
        assert horizon == "IMMEDIATE"
        assert "0.80" in rationale or "hazard_score" in rationale

    def test_immediate_without_matched_site_not_downgraded(self):
        """
        CRITICAL: IMMEDIATE must NOT be silently downgraded when no site is matched.
        The rationale must tell the operator to escalate emergency shelter search.
        """
        horizon, rationale = classify_relocation_horizon(
            hazard_score=0.85,
            urgency_score=0.60,
            site_availability_factor=0.6,   # no viable site
        )
        assert horizon == "IMMEDIATE", (
            "IMMEDIATE must never be downgraded for lack of a matched site"
        )
        # Must flag the site gap in the rationale
        assert "ESCALATE" in rationale.upper() or "shelter" in rationale.lower(), (
            f"Expected escalation flag in rationale, got: {rationale!r}"
        )

    def test_immediate_at_exact_threshold(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=IMMEDIATE_THRESHOLD,
            urgency_score=0.70,
            site_availability_factor=1.0,
        )
        assert horizon == "IMMEDIATE"

    def test_just_below_immediate_is_not_immediate(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=IMMEDIATE_THRESHOLD - 0.001,
            urgency_score=0.65,
            site_availability_factor=1.0,
        )
        assert horizon == "SHORT_TERM"


class TestShortTermHorizon:
    """hazard_score in [0.55, 0.75) → SHORT_TERM (no trend/vulnerability modifiers)."""

    def test_short_term_mid_range(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=0.65,
            urgency_score=0.55,
            site_availability_factor=1.0,
        )
        assert horizon == "SHORT_TERM"

    def test_short_term_at_lower_threshold(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=SHORT_TERM_THRESHOLD,
            urgency_score=0.45,
            site_availability_factor=1.0,
        )
        assert horizon == "SHORT_TERM"

    def test_short_term_just_below_immediate(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=IMMEDIATE_THRESHOLD - 0.001,
            urgency_score=0.68,
            site_availability_factor=1.0,
        )
        assert horizon == "SHORT_TERM"


class TestMediumTermHorizon:
    """hazard_score in [0.35, 0.55) → MEDIUM_TERM."""

    def test_medium_term_mid_range(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=0.45,
            urgency_score=0.35,
            site_availability_factor=1.0,
        )
        assert horizon == "MEDIUM_TERM"

    def test_medium_term_at_lower_threshold(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=MEDIUM_TERM_THRESHOLD,
            urgency_score=0.25,
            site_availability_factor=1.0,
        )
        assert horizon == "MEDIUM_TERM"


class TestMonitorHorizon:
    """hazard_score < 0.35 → MONITOR."""

    def test_monitor_low_hazard(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=0.20,
            urgency_score=0.15,
            site_availability_factor=1.0,
        )
        assert horizon == "MONITOR"

    def test_monitor_zero_hazard(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=0.0,
            urgency_score=0.0,
            site_availability_factor=1.0,
        )
        assert horizon == "MONITOR"

    def test_monitor_just_below_threshold(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=MEDIUM_TERM_THRESHOLD - 0.001,
            urgency_score=0.20,
            site_availability_factor=1.0,
        )
        assert horizon == "MONITOR"


class TestTrendElevation:
    """trend_worsening=True elevates MEDIUM_TERM → SHORT_TERM."""

    def test_trend_elevates_medium_to_short(self):
        horizon, rationale = classify_relocation_horizon(
            hazard_score=0.45,      # MEDIUM_TERM snapshot
            urgency_score=0.35,
            site_availability_factor=1.0,
            trend_worsening=True,
        )
        assert horizon == "SHORT_TERM", (
            "Worsening trend must elevate MEDIUM_TERM → SHORT_TERM"
        )
        assert "trend" in rationale.lower() or "acceleration" in rationale.lower()

    def test_trend_does_not_affect_immediate(self):
        """Trend flag on an already-IMMEDIATE hab should not change the bucket."""
        horizon, _ = classify_relocation_horizon(
            hazard_score=0.85,
            urgency_score=0.75,
            site_availability_factor=1.0,
            trend_worsening=True,
        )
        assert horizon == "IMMEDIATE"

    def test_trend_does_not_elevate_monitor(self):
        """Monitor (hazard < 0.35) should not jump straight to IMMEDIATE."""
        horizon, _ = classify_relocation_horizon(
            hazard_score=0.20,
            urgency_score=0.10,
            site_availability_factor=1.0,
            trend_worsening=True,
        )
        # MONITOR score is below MEDIUM_TERM threshold so trend can't elevate
        assert horizon == "MONITOR"


class TestVulnerabilityElevation:
    """High vulnerability_index can elevate MEDIUM_TERM → SHORT_TERM."""

    def test_high_vulnerability_elevates_medium_to_short(self):
        horizon, rationale = classify_relocation_horizon(
            hazard_score=0.45,
            urgency_score=0.35,
            site_availability_factor=1.0,
            vulnerability_index=0.80,   # ≥ 0.75 threshold
        )
        assert horizon == "SHORT_TERM", (
            "High vulnerability must elevate MEDIUM_TERM → SHORT_TERM"
        )
        assert "vulnerability" in rationale.lower()

    def test_moderate_vulnerability_does_not_elevate(self):
        horizon, _ = classify_relocation_horizon(
            hazard_score=0.45,
            urgency_score=0.35,
            site_availability_factor=1.0,
            vulnerability_index=0.50,   # < 0.75 threshold
        )
        assert horizon == "MEDIUM_TERM"
