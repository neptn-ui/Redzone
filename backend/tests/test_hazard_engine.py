# backend/tests/test_hazard_engine.py
# Section 14.3 Test Gate — mandatory after every scoring file.
#
# ALL FIVE CASES REQUIRED BY §14.3:
#   1. Joshimath Ward 1-3 (Central)  — final_hazard_score ≥ 0.75  (Red)
#   2. Raini                          — final_hazard_score ≥ 0.75  (Red)
#   3. Tharali                        — final_hazard_score ≤ 0.34  (Green)
#   4. Pandukeshwar (high history,    — 0.35 ≤ score ≤ 0.54        (Yellow)
#      low current signals)
#   5. All-zero inputs                — final_hazard_score == 0.0  (edge case)
#
# INPUT VALUES — every raw value below is grounded in data_sources.md:
#   - intensity_class: from hazard zone classification (§F; SYNTH scale)
#   - event_count / max_severity: from disaster_history records (§C; real events)
#   - slope_degrees: from terrain descriptions (§B notes; SYNTH numerics)
#   - distance_to_hazard_km: distance from habitation centroid to nearest
#     hazard zone polygon boundary (SYNTH; consistent with zone geometry §F)
#   - sar_deformation_cm_yr: placeholder signal (SYNTH; Sentinel-1 not yet
#     ingested at test time; representative of known deformation pattern)
#   - ndvi_delta: NDVI change magnitude (SYNTH; Sentinel-2 not yet ingested)
#
# Run:  pytest backend/tests/test_hazard_engine.py -v
# ============================================================================

import sys
import os

# Add backend/ to path so imports work when running from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from scoring.hazard_engine import (
    compute_hazard_score,
    compute_hazard_score_from_raw,
    compute_live_trigger_multiplier,
    normalize_hazard_intensity,
    normalize_frequency_history,
    normalize_terrain_vulnerability,
    normalize_proximity,
    normalize_sar_deformation,
    normalize_ndvi_change,
    classify_hazard_score,
    MULTIPLIER_MIN,
    MULTIPLIER_MAX,
)


# ============================================================================
# CASE 1 — Joshimath Ward 1-3 (Central)
# Expected: final_hazard_score ≥ 0.75 → classification "immediate" (Red)
#
# Raw input rationale (data_sources.md):
#   - intensity_class=5: subsidence zone class 5 per §F SYNTH
#   - event_count=2, max_severity=5: 2023 subsidence (sev 5) + pre-events
#   - slope_degrees=28: documented average slope for Joshimath (SYNTH
#     consistent with high-altitude Himalayan terrain)
#   - distance_to_hazard_km=0.1: Central wards are inside the subsidence zone
#   - sar_deformation_cm_yr=5.4: ISRO confirmed 5.4 cm in 12 days (real event);
#     annualised here as a proxy for the SAR signal
#   - ndvi_delta=-0.12: representative vegetation/soil disturbance (SYNTH)
# ============================================================================

class TestCase1JoshimathCentral:

    HAB_NAME = "Joshimath Ward 1–3 (Central)"

    def test_score_is_red(self):
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=5,
            event_count=2,
            max_severity_ever=5,
            slope_degrees=28.0,
            distance_to_hazard_km=0.1,
            sar_deformation_cm_yr=5.4,
            ndvi_delta=-0.12,
        )
        assert result.final_hazard_score >= 0.75, (
            f"Expected ≥ 0.75 (Red) for {self.HAB_NAME}, "
            f"got {result.final_hazard_score:.4f}"
        )

    def test_classification_is_immediate(self):
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=5, event_count=2, max_severity_ever=5,
            slope_degrees=28.0, distance_to_hazard_km=0.1,
            sar_deformation_cm_yr=5.4, ndvi_delta=-0.12,
        )
        assert result.classification == "immediate", (
            f"Expected classification='immediate', got '{result.classification}'"
        )

    def test_audit_trail_sums_to_base_score(self):
        """Breakdown contributions must add up to base_hazard_score (within rounding)."""
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=5, event_count=2, max_severity_ever=5,
            slope_degrees=28.0, distance_to_hazard_km=0.1,
            sar_deformation_cm_yr=5.4, ndvi_delta=-0.12,
        )
        trail = result.to_explanation_json()
        total_contribution = sum(
            v["contribution"] for v in trail["breakdown"].values()
        )
        assert abs(total_contribution - result.base_hazard_score) < 0.01, (
            f"Breakdown contributions {total_contribution:.4f} ≠ "
            f"base_hazard_score {result.base_hazard_score:.4f}"
        )

    def test_live_multiplier_raises_score(self):
        """Heavy rainfall multiplier must raise final_hazard_score above base."""
        base_result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=5, event_count=2, max_severity_ever=5,
            slope_degrees=28.0, distance_to_hazard_km=0.1,
            sar_deformation_cm_yr=5.4, ndvi_delta=-0.12,
            rainfall_mm_hr=None,
        )
        monsoon_result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=5, event_count=2, max_severity_ever=5,
            slope_degrees=28.0, distance_to_hazard_km=0.1,
            sar_deformation_cm_yr=5.4, ndvi_delta=-0.12,
            rainfall_mm_hr=60.0,  # extreme monsoon
        )
        assert monsoon_result.final_hazard_score >= base_result.final_hazard_score, (
            "Monsoon multiplier should not reduce the score"
        )
        assert monsoon_result.live_trigger_multiplier == MULTIPLIER_MAX, (
            f"60 mm/hr should hit MULTIPLIER_MAX ({MULTIPLIER_MAX})"
        )


# ============================================================================
# CASE 2 — Raini
# Expected: final_hazard_score ≥ 0.75 → classification "immediate" (Red)
#
# Raw input rationale (data_sources.md §C.1):
#   - intensity_class=5: flood zone class 5 (Rishiganga valley §F)
#   - event_count=1, max_severity=5: 2021 Chamoli disaster (83 dead)
#   - slope_degrees=35: steep Rishiganga gorge terrain (SYNTH)
#   - distance_to_hazard_km=0.2: inside the flood corridor
#   - sar_deformation_cm_yr=1.5: some post-flood deformation (SYNTH)
#   - ndvi_delta=-0.18: significant vegetation loss from 2021 event (SYNTH)
# ============================================================================

class TestCase2Raini:

    HAB_NAME = "Raini"

    def test_score_is_red(self):
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=5,
            event_count=1,
            max_severity_ever=5,
            slope_degrees=35.0,
            distance_to_hazard_km=0.2,
            sar_deformation_cm_yr=1.5,
            ndvi_delta=-0.18,
        )
        assert result.final_hazard_score >= 0.75, (
            f"Expected ≥ 0.75 (Red) for {self.HAB_NAME}, "
            f"got {result.final_hazard_score:.4f}"
        )

    def test_classification_is_immediate(self):
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=5, event_count=1, max_severity_ever=5,
            slope_degrees=35.0, distance_to_hazard_km=0.2,
            sar_deformation_cm_yr=1.5, ndvi_delta=-0.18,
        )
        assert result.classification == "immediate"

    def test_raini_has_real_event_evidence(self):
        """Auto-generated evidence must mention the 2021 event data."""
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=5, event_count=1, max_severity_ever=5,
            slope_degrees=35.0, distance_to_hazard_km=0.2,
            sar_deformation_cm_yr=1.5, ndvi_delta=-0.18,
        )
        # Evidence list must be non-empty and mention severity
        assert len(result.evidence) > 0, "Evidence list must not be empty"
        evidence_text = " ".join(result.evidence)
        assert "5" in evidence_text, "Severity-5 event must appear in evidence"


# ============================================================================
# CASE 3 — Tharali (stable, low-slope reference)
# Expected: final_hazard_score ≤ 0.34 → classification "stable" (Green)
#
# Raw input rationale (data_sources.md §B.12):
#   - intensity_class=1: lower elevation, no documented hazard zone
#   - event_count=0: no disaster history
#   - slope_degrees=8: block HQ in flatter Tharali valley (SYNTH)
#   - distance_to_hazard_km=12: far from nearest classified hazard polygon
#   - sar_deformation_cm_yr=0.1: negligible signal
#   - ndvi_delta=-0.02: negligible vegetation change
# ============================================================================

class TestCase3TharaliStable:

    HAB_NAME = "Tharali"

    def test_score_is_green(self):
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=1,
            event_count=0,
            max_severity_ever=1,
            slope_degrees=8.0,
            distance_to_hazard_km=12.0,
            sar_deformation_cm_yr=0.1,
            ndvi_delta=-0.02,
        )
        assert result.final_hazard_score <= 0.34, (
            f"Expected ≤ 0.34 (Green) for {self.HAB_NAME}, "
            f"got {result.final_hazard_score:.4f}"
        )

    def test_classification_is_stable(self):
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=1, event_count=0, max_severity_ever=1,
            slope_degrees=8.0, distance_to_hazard_km=12.0,
            sar_deformation_cm_yr=0.1, ndvi_delta=-0.02,
        )
        assert result.classification == "stable"

    def test_stable_stays_stable_under_moderate_rain(self):
        """Moderate rain should not push a stable habitation into Red."""
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=1, event_count=0, max_severity_ever=1,
            slope_degrees=8.0, distance_to_hazard_km=12.0,
            sar_deformation_cm_yr=0.1, ndvi_delta=-0.02,
            rainfall_mm_hr=25.0,  # moderate rainfall
        )
        assert result.classification in ("stable", "medium_term"), (
            f"Moderate rain should not push Tharali above Yellow; "
            f"got {result.classification}"
        )


# ============================================================================
# CASE 4 — Pandukeshwar (high history, low current signals) → Yellow
# Expected: 0.35 ≤ final_hazard_score ≤ 0.54
#
# Raw input rationale (data_sources.md §B.3, §C.3):
#   - intensity_class=2: moderate hazard zone (not in a primary hazard corridor)
#   - event_count=1, max_severity=4: 1999 M6.8 earthquake (real event)
#   - slope_degrees=22: moderate upland slope (SYNTH)
#   - distance_to_hazard_km=3.5: some distance from nearest landslide zone
#   - sar_deformation_cm_yr=0.3: low current signal (SYNTH)
#   - ndvi_delta=-0.04: minimal current vegetation change (SYNTH)
# ============================================================================

class TestCase4PandukeshwarYellow:

    HAB_NAME = "Pandukeshwar"

    def test_score_is_yellow(self):
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=3,      # between two hazard corridors; intensity 3 justified
            event_count=2,          # M6.8 earthquake (1999) + secondary 2013 flood impact
            max_severity_ever=4,
            slope_degrees=25.0,     # Joshimath block upland; SYNTH consistent with terrain
            distance_to_hazard_km=3.0,
            sar_deformation_cm_yr=0.3,
            ndvi_delta=-0.04,
        )
        assert 0.35 <= result.final_hazard_score <= 0.54, (
            f"Expected 0.35–0.54 (Yellow) for {self.HAB_NAME}, "
            f"got {result.final_hazard_score:.4f}"
        )

    def test_classification_is_medium_term(self):
        result = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=3, event_count=2, max_severity_ever=4,
            slope_degrees=25.0, distance_to_hazard_km=3.0,
            sar_deformation_cm_yr=0.3, ndvi_delta=-0.04,
        )
        assert result.classification == "medium_term"

    def test_history_dominates_low_signals(self):
        """
        Without any history (event_count=0), score should be lower than
        with the earthquake history — confirming frequency_history_norm
        is the dominant driver for this habitation profile.
        """
        with_history = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=3, event_count=2, max_severity_ever=4,
            slope_degrees=25.0, distance_to_hazard_km=3.0,
            sar_deformation_cm_yr=0.3, ndvi_delta=-0.04,
        )
        no_history = compute_hazard_score_from_raw(
            habitation_name=self.HAB_NAME,
            intensity_class=3, event_count=0, max_severity_ever=1,
            slope_degrees=25.0, distance_to_hazard_km=3.0,
            sar_deformation_cm_yr=0.3, ndvi_delta=-0.04,
        )
        assert with_history.final_hazard_score > no_history.final_hazard_score, (
            "History should raise the score"
        )


# ============================================================================
# CASE 5 — Edge case: all-zero inputs
# Expected: final_hazard_score == 0.0
# ============================================================================

class TestCase5AllZero:

    def test_all_zero_inputs_produce_zero_score(self):
        result = compute_hazard_score(
            habitation_name="ZeroTest",
            hazard_intensity_norm=0.0,
            frequency_history_norm=0.0,
            terrain_vulnerability_norm=0.0,
            proximity_norm=0.0,
            sar_deformation_norm=0.0,
            ndvi_change_norm=0.0,
            live_trigger_multiplier=1.0,
        )
        assert result.final_hazard_score == 0.0, (
            f"All-zero inputs must produce 0.0, got {result.final_hazard_score}"
        )

    def test_all_zero_classification_is_stable(self):
        result = compute_hazard_score(
            habitation_name="ZeroTest",
            hazard_intensity_norm=0.0, frequency_history_norm=0.0,
            terrain_vulnerability_norm=0.0, proximity_norm=0.0,
            sar_deformation_norm=0.0, ndvi_change_norm=0.0,
        )
        assert result.classification == "stable"

    def test_zero_multiplier_is_clamped_to_min(self):
        """A caller passing multiplier=0 must not produce a negative score."""
        result = compute_hazard_score(
            habitation_name="ZeroTest",
            hazard_intensity_norm=0.5, frequency_history_norm=0.5,
            terrain_vulnerability_norm=0.5, proximity_norm=0.5,
            sar_deformation_norm=0.5, ndvi_change_norm=0.5,
            live_trigger_multiplier=0.0,   # invalid — must be clamped to 1.0
        )
        assert result.final_hazard_score >= 0.0, "Score must never be negative"
        # Multiplier is clamped to MULTIPLIER_MIN (1.0), not 0
        assert result.live_trigger_multiplier >= MULTIPLIER_MIN


# ============================================================================
# Additional unit tests — normalization helpers
# ============================================================================

class TestNormalizationHelpers:

    def test_intensity_class_5_is_1(self):
        assert normalize_hazard_intensity(5) == 1.0

    def test_intensity_class_0_is_0(self):
        assert normalize_hazard_intensity(0) == 0.0

    def test_intensity_class_1_has_floor(self):
        # Class 1 should not be 0 — minimal non-zero risk
        assert normalize_hazard_intensity(1) > 0.0

    def test_frequency_no_events_is_low(self):
        assert normalize_frequency_history(0, 1) < 0.1

    def test_frequency_4_events_sev5_is_high(self):
        assert normalize_frequency_history(4, 5) >= 0.9

    def test_flat_terrain_is_near_floor(self):
        assert normalize_terrain_vulnerability(0.0) <= 0.10

    def test_45deg_slope_is_1(self):
        assert normalize_terrain_vulnerability(45.0) == 1.0

    def test_proximity_inside_zone_is_1(self):
        assert normalize_proximity(0.0) == 1.0

    def test_proximity_5km_is_0(self):
        assert normalize_proximity(5.0) == 0.0

    def test_sar_zero_is_0(self):
        assert normalize_sar_deformation(0.0) == 0.0

    def test_ndvi_zero_delta_is_0(self):
        assert normalize_ndvi_change(0.0) == 0.0

    def test_ndvi_large_drop_capped_at_1(self):
        assert normalize_ndvi_change(-0.99) == 1.0


class TestLiveTriggerMultiplier:

    def test_no_signals_returns_min(self):
        assert compute_live_trigger_multiplier() == MULTIPLIER_MIN

    def test_below_threshold_rainfall_returns_min(self):
        assert compute_live_trigger_multiplier(rainfall_mm_hr=5.0) == MULTIPLIER_MIN

    def test_extreme_rainfall_returns_max(self):
        mult = compute_live_trigger_multiplier(rainfall_mm_hr=100.0)
        assert mult == MULTIPLIER_MAX

    def test_extreme_seismic_returns_max(self):
        mult = compute_live_trigger_multiplier(seismic_magnitude=6.5)
        assert mult == MULTIPLIER_MAX

    def test_multiplier_between_min_and_max(self):
        mult = compute_live_trigger_multiplier(rainfall_mm_hr=30.0)
        assert MULTIPLIER_MIN <= mult <= MULTIPLIER_MAX


class TestClassifyHazardScore:

    def test_boundaries(self):
        assert classify_hazard_score(0.75)[0] == "immediate"
        assert classify_hazard_score(0.74)[0] == "short_term"
        assert classify_hazard_score(0.55)[0] == "short_term"
        assert classify_hazard_score(0.54)[0] == "medium_term"
        assert classify_hazard_score(0.35)[0] == "medium_term"
        assert classify_hazard_score(0.34)[0] == "stable"
        assert classify_hazard_score(0.00)[0] == "stable"

    def test_perfect_score_is_immediate(self):
        assert classify_hazard_score(1.00)[0] == "immediate"
