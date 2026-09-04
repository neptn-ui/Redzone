# backend/tests/test_capacity_engine.py
# Section 14.3 Test Gate — capacity_engine.py
#
# CASES:
#   1. Pipalkoti     — best pilot site → capacity_score ≥ 0.60
#   2. Bamoth/Gauchar — largest land, flattest → capacity_score ≥ 0.65
#   3. Koti Farm     — small land, steeper slope → 0.30 ≤ score ≤ 0.65
#   4. Full-capacity site (load_ratio = 1.0) → score reduced vs. same site empty
#   5. Edge case — zero land → capacity_score ≈ 0.0 (only proximity/water contribute)
#
# Input values sourced from data_sources.md §D and §E.1.
# All site numeric attributes are SYNTH (documented in data_sources.md).
# ============================================================================

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from scoring.capacity_engine import (
    compute_capacity_score,
    compute_capacity_score_from_raw,
    estimate_max_capacity,
    compute_load_ratio,
    normalize_land_availability,
    normalize_slope_safety,
    normalize_infra_proximity,
    normalize_water_access,
    NBC_MIN_AREA_PER_PERSON_SQM,
    W_LAND_AVAILABILITY, W_SLOPE_SAFETY, W_INFRA_PROXIMITY,
    W_WATER_ACCESS, W_LOAD_HEADROOM,
)


# ============================================================================
# CASE 1 — Pipalkoti
# Best-attested pilot site: distance=36 km (REAL), ~120-125 families (REAL).
# Numeric attributes: SYNTH (data_sources.md §D.1).
# Expected: capacity_score ≥ 0.60
# ============================================================================

class TestCase1Pipalkoti:
    # All values from data_sources.md §D.1
    SITE = dict(
        site_name="Pipalkoti",
        available_land_sqm=45_000.0,   # SYNTH
        slope_degrees=8.0,             # SYNTH (NH-7 roadside, ~1,350 m elevation)
        distance_to_road_km=0.3,       # SYNTH (on NH-7)
        distance_to_water_km=0.8,      # SYNTH (Alaknanda proximity)
        existing_occupancy=420,        # SYNTH
        max_capacity_estimate=2000,    # SYNTH
    )

    def test_score_is_acceptable(self):
        result = compute_capacity_score_from_raw(**self.SITE)
        assert result.capacity_score >= 0.60, (
            f"Pipalkoti should score ≥ 0.60, got {result.capacity_score:.4f}"
        )

    def test_has_available_capacity(self):
        result = compute_capacity_score_from_raw(**self.SITE)
        assert result.available_capacity > 0, "Pipalkoti should have headroom"

    def test_audit_trail_sums_to_score(self):
        result = compute_capacity_score_from_raw(**self.SITE)
        trail = result.to_explanation_json()
        total = sum(v["contribution"] for v in trail["breakdown"].values())
        assert abs(total - result.capacity_score) < 0.01, (
            f"Breakdown {total:.4f} ≠ capacity_score {result.capacity_score:.4f}"
        )

    def test_nbc_constant_is_real(self):
        """The NBC constant used must be the REAL 9.5 m²/person value."""
        assert NBC_MIN_AREA_PER_PERSON_SQM == 9.5, (
            "NBC 2016 minimum is 9.5 m²/person (data_sources.md §E.1); "
            f"got {NBC_MIN_AREA_PER_PERSON_SQM}"
        )


# ============================================================================
# CASE 2 — Bamoth (near Gauchar)
# Largest land area (80,000 sqm), flattest terrain (4°), most remote (90 km).
# Capacity score should be high due to land and slope advantages.
# Expected: capacity_score ≥ 0.65
# data_sources.md §D.4: name REAL; all numerics SYNTH.
# ============================================================================

class TestCase2Bamoth:
    SITE = dict(
        site_name="Bamoth (near Gauchar)",
        available_land_sqm=80_000.0,   # SYNTH
        slope_degrees=4.0,             # SYNTH (Gauchar flat valley section)
        distance_to_road_km=2.0,       # SYNTH
        distance_to_water_km=1.0,      # SYNTH (Alaknanda proximity)
        existing_occupancy=600,        # SYNTH
        max_capacity_estimate=2100,    # SYNTH
    )

    def test_score_is_high(self):
        result = compute_capacity_score_from_raw(**self.SITE)
        assert result.capacity_score >= 0.65, (
            f"Bamoth (large flat site) should score ≥ 0.65, "
            f"got {result.capacity_score:.4f}"
        )

    def test_bamoth_beats_koti_farm(self):
        """Larger land + flatter terrain: Bamoth should outscore Koti Farm."""
        bamoth = compute_capacity_score_from_raw(**self.SITE)
        koti = compute_capacity_score_from_raw(
            site_name="Koti Farm (near Auli)",
            available_land_sqm=18_000.0, slope_degrees=15.0,
            distance_to_road_km=0.5,    distance_to_water_km=2.0,
            existing_occupancy=60,      max_capacity_estimate=475,
        )
        assert bamoth.capacity_score > koti.capacity_score, (
            f"Bamoth ({bamoth.capacity_score:.4f}) should beat "
            f"Koti ({koti.capacity_score:.4f})"
        )


# ============================================================================
# CASE 3 — Koti Farm (near Auli)
# Small land (18,000 sqm), steeper slope (15°), good road access.
# Expected: 0.30 ≤ capacity_score ≤ 0.65
# data_sources.md §D.3: name REAL (mongabay.com); all numerics SYNTH.
# ============================================================================

class TestCase3KotiFarm:
    SITE = dict(
        site_name="Koti Farm (near Auli)",
        available_land_sqm=18_000.0,   # SYNTH
        slope_degrees=15.0,            # SYNTH (Auli elevated ski terrain)
        distance_to_road_km=0.5,       # SYNTH
        distance_to_water_km=2.0,      # SYNTH
        existing_occupancy=60,         # SYNTH (farm staff)
        max_capacity_estimate=475,     # SYNTH
    )

    def test_score_is_moderate(self):
        result = compute_capacity_score_from_raw(**self.SITE)
        assert 0.30 <= result.capacity_score <= 0.65, (
            f"Koti Farm should score 0.30–0.65, got {result.capacity_score:.4f}"
        )

    def test_slope_penalises_score(self):
        """Increasing slope should lower the capacity score."""
        flat = compute_capacity_score_from_raw(
            site_name="Koti Farm flat variant",
            available_land_sqm=18_000.0, slope_degrees=0.0,
            distance_to_road_km=0.5,    distance_to_water_km=2.0,
            existing_occupancy=60,      max_capacity_estimate=475,
        )
        steep = compute_capacity_score_from_raw(**self.SITE)  # 15° slope
        assert flat.capacity_score > steep.capacity_score, (
            "Flatter terrain should give higher capacity score"
        )


# ============================================================================
# CASE 4 — Full-capacity site (load_ratio = 1.0)
# A site at full occupancy must score lower than the same site when empty.
# This tests that (1 − current_load_ratio) = 0 correctly penalises the score.
# ============================================================================

class TestCase4FullCapacity:
    BASE = dict(
        site_name="FullCapTest",
        available_land_sqm=50_000.0,
        slope_degrees=10.0,
        distance_to_road_km=1.0,
        distance_to_water_km=1.0,
    )

    def test_full_site_scores_lower_than_empty(self):
        cap = estimate_max_capacity(self.BASE["available_land_sqm"])
        full = compute_capacity_score_from_raw(
            **self.BASE, existing_occupancy=cap, max_capacity_estimate=cap
        )
        empty = compute_capacity_score_from_raw(
            **self.BASE, existing_occupancy=0, max_capacity_estimate=cap
        )
        assert full.capacity_score < empty.capacity_score, (
            "Full site must score lower than empty site"
        )

    def test_full_site_load_headroom_is_zero(self):
        cap = estimate_max_capacity(self.BASE["available_land_sqm"])
        result = compute_capacity_score_from_raw(
            **self.BASE, existing_occupancy=cap, max_capacity_estimate=cap
        )
        assert result.load_headroom_norm == 0.0
        assert result.available_capacity == 0

    def test_full_site_still_has_positive_score(self):
        """A full site can still have infrastructure value — score > 0."""
        cap = estimate_max_capacity(self.BASE["available_land_sqm"])
        result = compute_capacity_score_from_raw(
            **self.BASE, existing_occupancy=cap, max_capacity_estimate=cap
        )
        # Other components (slope, infra, water) still contribute
        assert result.capacity_score > 0.0


# ============================================================================
# CASE 5 — Edge case: zero available land
# max_capacity_estimate = 0; load_ratio = 1.0 (treated as full).
# land_availability_norm = 0; load_headroom = 0.
# Only slope/infra/water components contribute.
# ============================================================================

class TestCase5ZeroLand:

    def test_zero_land_score_is_low(self):
        result = compute_capacity_score_from_raw(
            site_name="ZeroLand",
            available_land_sqm=0.0,
            slope_degrees=0.0,
            distance_to_road_km=0.0,
            distance_to_water_km=0.0,
            existing_occupancy=0,
            max_capacity_estimate=0,
        )
        # land (0.30 weight) = 0; load headroom (0.10 weight) = 0
        # Only slope (0.25), infra (0.20), water (0.15) with best-case = 0.60
        assert result.capacity_score <= 0.60, (
            f"Zero-land site should score ≤ 0.60, got {result.capacity_score:.4f}"
        )

    def test_zero_land_capacity_estimate_is_zero(self):
        est = estimate_max_capacity(0.0)
        assert est == 0

    def test_negative_land_clamped_to_zero(self):
        """Negative land_sqm must not crash or produce negative score."""
        result = compute_capacity_score_from_raw(
            site_name="NegLand",
            available_land_sqm=-100.0,
            slope_degrees=10.0, distance_to_road_km=1.0,
            distance_to_water_km=1.0, existing_occupancy=0,
        )
        assert result.capacity_score >= 0.0
        assert result.land_availability_norm == 0.0


# ============================================================================
# Unit tests — normalization helpers
# ============================================================================

class TestNormalizationHelpers:

    def test_land_max_sqm_is_1(self):
        assert normalize_land_availability(100_000.0) == 1.0

    def test_land_zero_is_0(self):
        assert normalize_land_availability(0.0) == 0.0

    def test_land_capped_above_max(self):
        assert normalize_land_availability(200_000.0) == 1.0

    def test_slope_zero_is_1(self):
        assert normalize_slope_safety(0.0) == 1.0

    def test_slope_20deg_is_0(self):
        assert normalize_slope_safety(20.0) == 0.0

    def test_slope_above_max_clamped(self):
        assert normalize_slope_safety(45.0) == 0.0

    def test_infra_on_road_is_1(self):
        assert normalize_infra_proximity(0.0) == 1.0

    def test_infra_5km_is_0(self):
        assert normalize_infra_proximity(5.0) == 0.0

    def test_water_on_source_is_1(self):
        assert normalize_water_access(0.0) == 1.0

    def test_water_5km_is_0(self):
        assert normalize_water_access(5.0) == 0.0


class TestNBCConstant:

    def test_nbc_is_9_5(self):
        """NBC 2016 minimum single-room area must be 9.5 m² (REAL constant)."""
        assert NBC_MIN_AREA_PER_PERSON_SQM == 9.5

    def test_capacity_estimate_correct(self):
        """9,500 sqm ÷ 9.5 = 1,000 persons."""
        assert estimate_max_capacity(9_500.0) == 1000

    def test_capacity_estimate_rounds_down(self):
        """Integer division floors the result."""
        assert estimate_max_capacity(19.0) == 2   # 19/9.5 = 2.0

    def test_load_ratio_full(self):
        assert compute_load_ratio(1000, 1000) == 1.0

    def test_load_ratio_empty(self):
        assert compute_load_ratio(0, 1000) == 0.0

    def test_load_ratio_over_capacity_clamped(self):
        """Overcrowded site: ratio > 1 must clamp to 1.0."""
        assert compute_load_ratio(1500, 1000) == 1.0

    def test_load_ratio_zero_capacity_is_full(self):
        """A site with zero capacity is treated as 100% loaded."""
        assert compute_load_ratio(0, 0) == 1.0


class TestWeightsSumToOne:

    def test_weights_sum(self):
        total = (W_LAND_AVAILABILITY + W_SLOPE_SAFETY + W_INFRA_PROXIMITY
                 + W_WATER_ACCESS + W_LOAD_HEADROOM)
        assert abs(total - 1.0) < 1e-9, f"Weights sum to {total}, expected 1.0"
