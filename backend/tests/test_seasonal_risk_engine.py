# backend/tests/test_seasonal_risk_engine.py
# §14.3 Test Gate — seasonal_risk_engine.py (§2.5)
#
# Tests:
#   1. No events → MISSING status, multiplier = 1.0
#   2. At-peak month → multiplier near MAX_SEASONAL_MULTIPLIER
#   3. Out-of-season → multiplier ≈ 1.0
#   4. Circular wraparound (Dec event, Jan current) → low distance
#   5. Max severity 1 (min events) → low multiplier even at peak
#   6. Max severity 5 + at peak → near MAX
#   7. Multiplier always in [1.0, MAX_SEASONAL_MULTIPLIER]
#
# Run: pytest backend/tests/test_seasonal_risk_engine.py -v
# ============================================================================

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
import pytest
from scoring.seasonal_risk_engine import (
    compute_seasonal_multiplier,
    MAX_SEASONAL_MULTIPLIER,
)


def _events(months_severities: list[tuple[int, int]]) -> list[dict]:
    """Helper: build event list from (month, severity) tuples."""
    return [
        {"event_date": date(2024, m, 15), "severity": sev}
        for m, sev in months_severities
    ]


class TestNoEvents:
    def test_no_events_missing_status(self):
        r = compute_seasonal_multiplier("Empty", [], current_month=7)
        assert r.data_source == "MISSING"

    def test_no_events_multiplier_one(self):
        r = compute_seasonal_multiplier("Empty", [], current_month=7)
        assert r.seasonal_multiplier == 1.0


class TestAtPeakMonth:
    def test_at_peak_high_severity_near_max(self):
        """July peak events, severity 5, current month July → near MAX."""
        events = _events([(7, 5), (7, 5), (7, 4)])
        r = compute_seasonal_multiplier("Flood Peak", events, current_month=7)
        assert r.seasonal_multiplier >= 1.5, (
            f"Expected ≥ 1.5 at peak with severity 5, got {r.seasonal_multiplier}"
        )
        assert r.peak_month_name == "Jul"

    def test_proximity_weight_one_at_peak(self):
        events = _events([(6, 5)])
        r = compute_seasonal_multiplier("Test", events, current_month=6)
        assert abs(r.proximity_weight - 1.0) < 1e-6


class TestOutOfSeason:
    def test_out_of_season_near_one(self):
        """July peak, current December → very low proximity, multiplier ≈ 1.0."""
        events = _events([(7, 5), (7, 4)])
        r = compute_seasonal_multiplier("Off Season", events, current_month=12)
        assert r.seasonal_multiplier < 1.15, (
            f"Expected near 1.0 in Dec for Jul-peak events, got {r.seasonal_multiplier}"
        )


class TestCircularWraparound:
    def test_dec_peak_jan_current_close(self):
        """December peak, January current → distance = 1 month (wraparound)."""
        events = _events([(12, 4), (12, 5)])
        r = compute_seasonal_multiplier("Winter Risk", events, current_month=1)
        assert r.proximity_weight >= 0.6, (
            f"Expected high proximity for Jan vs Dec peak, got {r.proximity_weight}"
        )

    def test_jan_peak_dec_current_close(self):
        events = _events([(1, 4)])
        r = compute_seasonal_multiplier("Winter", events, current_month=12)
        assert r.proximity_weight >= 0.6


class TestSeverityScaling:
    def test_severity_1_low_multiplier_even_at_peak(self):
        """Severity 1 events → severity_factor = 0, multiplier stays 1.0."""
        events = _events([(7, 1), (7, 1)])
        r = compute_seasonal_multiplier("Low Sev", events, current_month=7)
        assert r.seasonal_multiplier == 1.0

    def test_severity_5_at_peak_near_max(self):
        events = _events([(8, 5)])
        r = compute_seasonal_multiplier("High Sev", events, current_month=8)
        assert r.seasonal_multiplier >= MAX_SEASONAL_MULTIPLIER * 0.9


class TestMultiplierBounds:
    def test_multiplier_always_ge_1(self):
        for month in range(1, 13):
            for peak_month in [1, 4, 7, 10]:
                events = _events([(peak_month, 5)])
                r = compute_seasonal_multiplier("Bounds", events, current_month=month)
                assert r.seasonal_multiplier >= 1.0, (
                    f"Multiplier below 1.0 at month={month}, peak={peak_month}"
                )

    def test_multiplier_always_le_max(self):
        for month in range(1, 13):
            events = _events([(month, 5), (month, 5)])
            r = compute_seasonal_multiplier("Bounds", events, current_month=month)
            assert r.seasonal_multiplier <= MAX_SEASONAL_MULTIPLIER + 1e-9
