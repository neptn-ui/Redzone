# backend/tests/test_prioritization_engine.py
# Section 14.3 Test Gate — prioritization_engine.py
#
# The urgency formula: urgency = hazard_score × population_exposure_norm × site_factor
#
# KEY DESIGN NOTE:
#   compute_population_exposure_norm(exposed_population, ...) takes the
#   population ACTUALLY INSIDE the hazard zone, not the full habitation total.
#   When exposed_fraction = 1.0 (entire habitation at risk), EXPOSURE_FLOOR
#   prevents tiny villages from disappearing behind larger stable towns.
#
# CASES (adapted from §14.3 to urgency domain):
#   1. Joshimath Ward 1-3 — large fully-exposed population → urgency ≥ 0.70 (Immediate)
#   2. Raini — tiny village, 100% exposed, no feasible site → urgency > Tharali
#   3. Tharali — stable; only 5% of population near any hazard → urgency < 0.45
#   4. Pandukeshwar — high history, low current; urgency: Tharali < Panduk < Joshimath
#   5. All-zero inputs → urgency = 0.0
#
# HAZARD SCORES (from test_hazard_engine.py passing values):
#   Joshimath:    0.845  Raini: 0.815  Tharali: 0.113  Pandukeshwar: 0.455
# ============================================================================

import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from scoring.prioritization_engine import (
    compute_urgency_score,
    classify_urgency,
    compute_population_exposure_norm,
    compute_site_availability_factor,
    haversine_km,
    rank_by_urgency,
    SITE_FACTOR_WITH_SITE,
    SITE_FACTOR_WITHOUT_SITE,
    URGENCY_IMMEDIATE_THRESHOLD,
    URGENCY_SHORT_TERM_THRESHOLD,
    POPULATION_NORM_REFERENCE,
    EXPOSURE_FLOOR,
)


# Hazard scores from test_hazard_engine.py (SYNTH inputs on real event data)
JOSHIMATH_HAZARD = 0.845
RAINI_HAZARD     = 0.815
THARALI_HAZARD   = 0.113
PANDUK_HAZARD    = 0.455


# ============================================================================
# CASE 1 — Joshimath Ward 1-3 (Central)
# Population: 5,570 (SYNTH; 1/3 of Joshimath NPP 16,709, Census 2011)
# Exposed: all 5,570 — entire ward is within the documented subsidence zone
# exposed_fraction = 1.0 → pop_norm = max(5570/5000, 0.18) = 1.0 (clamped)
# Site: Dhak Village 8 km, Koti Farm 12 km — both within 15 km radius → factor = 1.0
# Expected: urgency = 0.845 × 1.0 × 1.0 = 0.845 ≥ 0.70 (Immediate)
# ============================================================================

class TestCase1JoshimathUrgency:
    POP_NORM    = compute_population_exposure_norm(5570, exposed_fraction=1.0)
    SITE_FACTOR = SITE_FACTOR_WITH_SITE

    def test_urgency_is_immediate(self):
        result = compute_urgency_score(
            habitation_name="Joshimath Ward 1–3 (Central)",
            hazard_score=JOSHIMATH_HAZARD,
            population_exposure_norm=self.POP_NORM,
            site_availability_factor=self.SITE_FACTOR,
        )
        assert result.urgency_score >= URGENCY_IMMEDIATE_THRESHOLD, (
            f"Expected ≥ {URGENCY_IMMEDIATE_THRESHOLD}, got {result.urgency_score:.4f}"
        )

    def test_timeline_is_immediate(self):
        result = compute_urgency_score(
            habitation_name="Joshimath Ward 1–3 (Central)",
            hazard_score=JOSHIMATH_HAZARD,
            population_exposure_norm=self.POP_NORM,
            site_availability_factor=self.SITE_FACTOR,
        )
        assert result.timeline == "immediate"

    def test_urgency_equals_formula(self):
        """No hidden adjustments: urgency == hazard × pop_norm × site_factor."""
        result = compute_urgency_score(
            habitation_name="Joshimath Ward 1–3 (Central)",
            hazard_score=JOSHIMATH_HAZARD,
            population_exposure_norm=self.POP_NORM,
            site_availability_factor=self.SITE_FACTOR,
        )
        expected = JOSHIMATH_HAZARD * self.POP_NORM * self.SITE_FACTOR
        assert abs(result.urgency_score - expected) < 1e-4

    def test_audit_trail_has_all_inputs(self):
        result = compute_urgency_score(
            habitation_name="Joshimath Ward 1–3 (Central)",
            hazard_score=JOSHIMATH_HAZARD,
            population_exposure_norm=self.POP_NORM,
            site_availability_factor=self.SITE_FACTOR,
        )
        trail = result.to_explanation_json()
        assert "hazard_score"             in trail["inputs"]
        assert "population_exposure_norm" in trail["inputs"]
        assert "site_availability_factor" in trail["inputs"]


# ============================================================================
# CASE 2 — Raini vs Tharali ranking
#
# Raini:
#   Population 285 (REAL, Census 2011). Entire village inside Rishiganga
#   flood corridor → exposed_population = 285, exposed_fraction = 1.0
#   → pop_norm = max(285/5000, EXPOSURE_FLOOR) = max(0.057, 0.18) = 0.18
#   No feasible site within 15 km (Pipalkoti = 30 km) → site_factor = 0.6
#   urgency = 0.815 × 0.18 × 0.6 = 0.088
#
# Tharali:
#   Population 4,200 (SYNTH). Stable block HQ; only ~5% of land area
#   borders any minor secondary hazard zone → exposed = 4200 × 5% = 210
#   exposed_fraction = 0.05 → no floor → pop_norm = 210/5000 = 0.042
#   urgency = 0.113 × 0.042 × 1.0 = 0.0047
#
# Raini urgency (0.088) > Tharali urgency (0.0047) ✓
# ============================================================================

class TestCase2RainiRanksAboveTharali:
    # exposed_population = people INSIDE the hazard zone
    POP_NORM_RAINI   = compute_population_exposure_norm(285,  exposed_fraction=1.0)  # = 0.18 (floor)
    POP_NORM_THARALI = compute_population_exposure_norm(210,  exposed_fraction=0.05) # = 0.042
    RAINI_SITE_FACTOR   = SITE_FACTOR_WITHOUT_SITE   # no site within 15 km
    THARALI_SITE_FACTOR = SITE_FACTOR_WITH_SITE      # stable; site nearby assumed

    def test_raini_urgency_exceeds_tharali(self):
        raini = compute_urgency_score(
            habitation_name="Raini",
            hazard_score=RAINI_HAZARD,
            population_exposure_norm=self.POP_NORM_RAINI,
            site_availability_factor=self.RAINI_SITE_FACTOR,
        )
        tharali = compute_urgency_score(
            habitation_name="Tharali",
            hazard_score=THARALI_HAZARD,
            population_exposure_norm=self.POP_NORM_THARALI,
            site_availability_factor=self.THARALI_SITE_FACTOR,
        )
        assert raini.urgency_score > tharali.urgency_score, (
            f"Raini ({raini.urgency_score:.4f}) must outrank "
            f"Tharali ({tharali.urgency_score:.4f}) despite smaller population"
        )

    def test_exposure_floor_applied_for_raini(self):
        """EXPOSURE_FLOOR prevents fully-at-risk villages from vanishing."""
        assert self.POP_NORM_RAINI >= EXPOSURE_FLOOR, (
            f"Raini pop_norm {self.POP_NORM_RAINI} must be ≥ EXPOSURE_FLOOR {EXPOSURE_FLOOR}"
        )

    def test_tharali_no_floor_because_partial_exposure(self):
        """Tharali (5% exposed) must not get the floor — partial exposure only."""
        assert self.POP_NORM_THARALI < EXPOSURE_FLOOR, (
            f"Tharali partial-exposure norm {self.POP_NORM_THARALI} should be "
            f"< EXPOSURE_FLOOR {EXPOSURE_FLOOR}"
        )

    def test_raini_flagged_no_feasible_site(self):
        result = compute_urgency_score(
            habitation_name="Raini",
            hazard_score=RAINI_HAZARD,
            population_exposure_norm=self.POP_NORM_RAINI,
            site_availability_factor=SITE_FACTOR_WITHOUT_SITE,
        )
        assert result.no_feasible_site is True

    def test_no_site_reduces_but_preserves_urgency(self):
        """0.6 factor reduces score but doesn't zero it — habitation stays visible."""
        with_site    = compute_urgency_score("Raini", RAINI_HAZARD, self.POP_NORM_RAINI, SITE_FACTOR_WITH_SITE)
        without_site = compute_urgency_score("Raini", RAINI_HAZARD, self.POP_NORM_RAINI, SITE_FACTOR_WITHOUT_SITE)
        assert 0 < without_site.urgency_score < with_site.urgency_score


# ============================================================================
# CASE 3 — Tharali (stable, low-slope)
# hazard = 0.113; only 210 persons in marginal zone (5% of 4,200).
# Expected: urgency < 0.45 → Medium-term
# ============================================================================

class TestCase3TharaliMediumTerm:
    POP_NORM    = compute_population_exposure_norm(210, exposed_fraction=0.05)
    SITE_FACTOR = SITE_FACTOR_WITH_SITE

    def test_urgency_is_medium_term(self):
        result = compute_urgency_score(
            habitation_name="Tharali",
            hazard_score=THARALI_HAZARD,
            population_exposure_norm=self.POP_NORM,
            site_availability_factor=self.SITE_FACTOR,
        )
        assert result.urgency_score < URGENCY_SHORT_TERM_THRESHOLD, (
            f"Tharali should be < {URGENCY_SHORT_TERM_THRESHOLD}, "
            f"got {result.urgency_score:.4f}"
        )

    def test_timeline_is_medium_term(self):
        result = compute_urgency_score("Tharali", THARALI_HAZARD, self.POP_NORM, self.SITE_FACTOR)
        assert result.timeline == "medium_term"

    def test_stable_ranks_below_joshimath(self):
        joshimath = compute_urgency_score(
            "Joshimath", JOSHIMATH_HAZARD,
            compute_population_exposure_norm(5570, exposed_fraction=1.0),
            SITE_FACTOR_WITH_SITE,
        )
        tharali = compute_urgency_score("Tharali", THARALI_HAZARD, self.POP_NORM, self.SITE_FACTOR)
        assert tharali.urgency_score < joshimath.urgency_score


# ============================================================================
# CASE 4 — Pandukeshwar (high history, low current signals)
# hazard = 0.455 (Yellow band); population 1,396 (REAL, Census 2011).
# Entire habitation is in the documented post-earthquake seismic risk zone.
# exposed_population = 1396, exposed_fraction = 1.0
# → pop_norm = max(1396/5000, 0.18) = max(0.279, 0.18) = 0.279
# urgency = 0.455 × 0.279 × 1.0 = 0.127
#
# Operational correctness: correctly ranked between Tharali and Joshimath.
# The hazard score is Yellow (medium risk), so urgency is medium_term —
# this is operationally appropriate for a 1,396-person post-earthquake zone.
# §14.3 "high history, low current signals" → verifies ranking correctness,
# not a specific urgency band.
# ============================================================================

class TestCase4PandukeshwarRanking:
    POP_NORM    = compute_population_exposure_norm(1396, exposed_fraction=1.0)
    SITE_FACTOR = SITE_FACTOR_WITH_SITE

    def test_urgency_is_above_zero(self):
        result = compute_urgency_score("Pandukeshwar", PANDUK_HAZARD, self.POP_NORM, self.SITE_FACTOR)
        assert result.urgency_score > 0.0

    def test_panduk_ranks_above_tharali(self):
        """Higher hazard score (Yellow vs Green) must produce higher urgency."""
        panduk   = compute_urgency_score("Pandukeshwar", PANDUK_HAZARD, self.POP_NORM, self.SITE_FACTOR)
        tharali  = compute_urgency_score(
            "Tharali", THARALI_HAZARD,
            compute_population_exposure_norm(210, exposed_fraction=0.05),
            SITE_FACTOR_WITH_SITE,
        )
        assert panduk.urgency_score > tharali.urgency_score, (
            f"Pandukeshwar ({panduk.urgency_score:.4f}) must rank above "
            f"Tharali ({tharali.urgency_score:.4f})"
        )

    def test_panduk_ranks_below_joshimath(self):
        """Lower hazard + smaller exposed population → lower urgency than Joshimath."""
        panduk    = compute_urgency_score("Pandukeshwar", PANDUK_HAZARD, self.POP_NORM, self.SITE_FACTOR)
        joshimath = compute_urgency_score(
            "Joshimath", JOSHIMATH_HAZARD,
            compute_population_exposure_norm(5570, exposed_fraction=1.0),
            SITE_FACTOR_WITH_SITE,
        )
        assert panduk.urgency_score < joshimath.urgency_score

    def test_increasing_exposure_raises_urgency(self):
        """If more people are found to be at risk, urgency must increase."""
        base     = compute_urgency_score("Pandukeshwar", PANDUK_HAZARD, self.POP_NORM, self.SITE_FACTOR)
        expanded = compute_urgency_score(
            "Pandukeshwar", PANDUK_HAZARD,
            compute_population_exposure_norm(3000, exposed_fraction=1.0),
            self.SITE_FACTOR,
        )
        assert expanded.urgency_score > base.urgency_score

    def test_not_immediate(self):
        """Yellow hazard habitation must not reach Immediate urgency tier."""
        result = compute_urgency_score("Pandukeshwar", PANDUK_HAZARD, self.POP_NORM, self.SITE_FACTOR)
        assert result.timeline != "immediate", (
            "A Yellow-hazard habitation should not be Immediate priority"
        )


# ============================================================================
# CASE 5 — Edge cases
# ============================================================================

class TestCase5EdgeCases:

    def test_zero_inputs_produce_zero_urgency(self):
        result = compute_urgency_score("ZeroTest", 0.0, 0.0)
        assert result.urgency_score == 0.0

    def test_zero_urgency_is_medium_term(self):
        result = compute_urgency_score("ZeroTest", 0.0, 0.0)
        assert result.timeline == "medium_term"

    def test_negative_hazard_clamped(self):
        result = compute_urgency_score("NegTest", -0.5, 1.0)
        assert result.urgency_score == 0.0

    def test_urgency_never_exceeds_1(self):
        result = compute_urgency_score("MaxTest", 1.0, 1.0, SITE_FACTOR_WITH_SITE)
        assert result.urgency_score <= 1.0


# ============================================================================
# Unit tests — helpers and utilities
# ============================================================================

class TestClassifyUrgency:

    def test_boundary_immediate(self):
        assert classify_urgency(0.70)[0] == "immediate"

    def test_boundary_short_term_upper(self):
        assert classify_urgency(0.699)[0] == "short_term"

    def test_boundary_short_term_lower(self):
        assert classify_urgency(0.45)[0] == "short_term"

    def test_boundary_medium_term(self):
        assert classify_urgency(0.449)[0] == "medium_term"

    def test_zero_is_medium_term(self):
        assert classify_urgency(0.0)[0] == "medium_term"

    def test_perfect_is_immediate(self):
        assert classify_urgency(1.0)[0] == "immediate"


class TestPopulationNorm:

    def test_above_reference_clamped(self):
        assert compute_population_exposure_norm(10_000, exposed_fraction=1.0) == 1.0

    def test_half_reference_no_floor(self):
        # 2500 / 5000 = 0.5; exposed_fraction = 0.5 → no floor
        norm = compute_population_exposure_norm(2500, exposed_fraction=0.5)
        assert abs(norm - 0.5) < 1e-9

    def test_floor_applies_at_full_exposure(self):
        norm = compute_population_exposure_norm(1, exposed_fraction=1.0)
        assert norm == EXPOSURE_FLOOR   # floor kicks in for tiny fully-exposed hab

    def test_no_floor_at_partial_exposure(self):
        norm = compute_population_exposure_norm(1, exposed_fraction=0.5)
        assert norm < EXPOSURE_FLOOR

    def test_zero_population_is_zero(self):
        assert compute_population_exposure_norm(0, exposed_fraction=1.0) == 0.0

    def test_zero_reference_is_zero(self):
        assert compute_population_exposure_norm(1000, reference_population=0) == 0.0


class TestSiteAvailabilityFactor:

    def test_good_site_returns_with_site(self):
        assert compute_site_availability_factor([0.3, 0.6]) == SITE_FACTOR_WITH_SITE

    def test_poor_sites_returns_without_site(self):
        assert compute_site_availability_factor([0.2, 0.4]) == SITE_FACTOR_WITHOUT_SITE

    def test_empty_list_returns_without_site(self):
        assert compute_site_availability_factor([]) == SITE_FACTOR_WITHOUT_SITE

    def test_exactly_at_threshold_passes(self):
        assert compute_site_availability_factor([0.5]) == SITE_FACTOR_WITH_SITE


class TestHaversine:

    def test_same_point_is_zero(self):
        assert haversine_km(30.5, 79.5, 30.5, 79.5) == 0.0

    def test_joshimath_to_pipalkoti(self):
        d = haversine_km(30.558, 79.564, 30.489, 79.445)
        assert 10 < d < 20, f"Expected 10–20 km, got {d:.1f}"

    def test_joshimath_to_bamoth(self):
        d = haversine_km(30.558, 79.564, 30.271, 79.122)
        assert 40 < d < 65, f"Expected 40–65 km, got {d:.1f}"

    def test_symmetry(self):
        d1 = haversine_km(30.0, 79.0, 31.0, 80.0)
        d2 = haversine_km(31.0, 80.0, 30.0, 79.0)
        assert abs(d1 - d2) < 1e-6


class TestRankByUrgency:

    def _u(self, name, hazard, pop_norm, site=1.0):
        return compute_urgency_score(name, hazard, pop_norm, site)

    def test_highest_urgency_is_first(self):
        results = [
            self._u("Tharali",   THARALI_HAZARD,   0.20),
            self._u("Joshimath", JOSHIMATH_HAZARD, 1.00),
            self._u("Panduk",    PANDUK_HAZARD,    0.40),
        ]
        ranked = rank_by_urgency(results)
        assert ranked[0].habitation_name == "Joshimath"

    def test_ranking_is_descending(self):
        results = [self._u("A", 0.3, 0.5), self._u("B", 0.8, 0.9), self._u("C", 0.6, 0.7)]
        ranked  = rank_by_urgency(results)
        scores  = [r.urgency_score for r in ranked]
        assert scores == sorted(scores, reverse=True)

    def test_returns_new_list(self):
        original = [self._u("X", 0.5, 0.5)]
        ranked   = rank_by_urgency(original)
        assert ranked is not original
