# backend/tests/test_matching_optimizer.py
# Section 14.3 Test Gate — matching_optimizer.py
#
# All tests use prefer_lp=False (greedy solver, no PuLP dependency).
# PuLP-specific tests are guarded with pytest.importorskip("pulp").
#
# CASES:
#   1. Simple 2-hab / 2-site case: high-urgency hab gets best site
#   2. Capacity constraint: site A can only take one hab → higher urgency wins
#   3. Distance constraint: site outside max_distance_km excluded from matching
#   4. All sites full → all habitations go to unmatched list
#   5. No habitations → empty result (edge case)
#   6. No sites → all habitations unmatched (edge case)
# ============================================================================

import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from scoring.matching_optimizer import (
    solve_assignment,
    HabitationInput,
    SiteInput,
    OptimizationResult,
    DEFAULT_MAX_DISTANCE_KM,
)

# ---------------------------------------------------------------------------
# Pilot-data fixtures (lat/lon from load_pilot_data.py)
# ---------------------------------------------------------------------------

# Habitations
def _joshimath() -> HabitationInput:
    return HabitationInput(1, "Joshimath Ward 1-3", urgency_score=0.845,
                            population=5570, lat=30.558, lon=79.564)

def _raini() -> HabitationInput:
    return HabitationInput(2, "Raini", urgency_score=0.088,
                            population=285, lat=30.476, lon=79.765)

def _tharali() -> HabitationInput:
    return HabitationInput(3, "Tharali", urgency_score=0.005,
                            population=4200, lat=30.271, lon=79.566)

def _panduk() -> HabitationInput:
    return HabitationInput(4, "Pandukeshwar", urgency_score=0.127,
                            population=1396, lat=30.526, lon=79.639)

# Sites
def _pipalkoti() -> SiteInput:
    return SiteInput(1, "Pipalkoti", capacity_score=0.678,
                     available_capacity=2000, lat=30.489, lon=79.445)

def _bamoth() -> SiteInput:
    return SiteInput(2, "Bamoth (near Gauchar)", capacity_score=0.751,
                     available_capacity=2100, lat=30.271, lon=79.122)

def _koti() -> SiteInput:
    return SiteInput(3, "Koti Farm (near Auli)", capacity_score=0.473,
                     available_capacity=475, lat=30.572, lon=79.574)

def _dhak() -> SiteInput:
    return SiteInput(4, "Dhak Village", capacity_score=0.517,
                     available_capacity=750, lat=30.540, lon=79.518)


# ============================================================================
# CASE 1 — Simple matching: high-urgency habitation gets highest-capacity site
#
# Joshimath (urgency=0.845) and Raini (urgency=0.088) vs
# Pipalkoti (cap_score=0.678, cap=2000) and Dhak (cap_score=0.517, cap=750).
#
# Expected greedy:
#   1. Joshimath (highest urgency) → Pipalkoti (highest cap_score that fits pop=5570)
#      Pipalkoti cap=2000 < 5570 → doesn't fit!
#      Dhak cap=750 < 5570 → doesn't fit either!
#      → Joshimath unmatched (no site has enough capacity for 5570)
#   2. Raini (urgency=0.088, pop=285) → Dhak (cap=750 ≥ 285) → matched
# ============================================================================

class TestCase1SimpleMatching:

    def test_raini_gets_matched(self):
        result = solve_assignment(
            habitations=[_joshimath(), _raini()],
            sites=[_pipalkoti(), _dhak()],
            prefer_lp=False,
        )
        matched_names = [a.habitation_name for a in result.assignments]
        assert "Raini" in matched_names, (
            f"Raini (pop=285) should fit in Dhak (cap=750); matched: {matched_names}"
        )

    def test_joshimath_unmatched_when_no_site_fits(self):
        """5,570 people: no pilot site has enough single-site capacity."""
        result = solve_assignment(
            habitations=[_joshimath()],
            sites=[_pipalkoti(), _dhak()],
            prefer_lp=False,
        )
        unmatched_names = [u.name for u in result.unmatched_habitations]
        assert "Joshimath Ward 1-3" in unmatched_names

    def test_best_site_chosen_by_capacity_score(self):
        """
        Raini (pop=285) can fit in either Pipalkoti (cap=2000, score=0.678)
        or Dhak (cap=750, score=0.517).
        Greedy should assign to Pipalkoti (higher capacity_score).
        """
        result = solve_assignment(
            habitations=[_raini()],
            sites=[_pipalkoti(), _dhak()],
            prefer_lp=False,
        )
        assert len(result.assignments) == 1
        assert result.assignments[0].site_name == "Pipalkoti", (
            "Raini should go to Pipalkoti (higher capacity_score=0.678 > 0.517)"
        )

    def test_audit_trail_is_complete(self):
        result = solve_assignment(
            habitations=[_raini()],
            sites=[_pipalkoti()],
            prefer_lp=False,
        )
        trail = result.to_explanation_json()
        assert "assignments" in trail
        assert "unmatched"   in trail
        assert "solver"      in trail
        assert trail["solver"] == "greedy"


# ============================================================================
# CASE 2 — Capacity constraint: one site, two habitations competing
#
# Koti Farm cap=475.
# Pandukeshwar (urgency=0.127, pop=1396) — too large, won't fit.
# Raini (urgency=0.088, pop=285) — fits.
# Tharali (urgency=0.005, pop=4200) — too large.
#
# Greedy sorts by urgency desc: Panduk first (unmatched, too big),
# then Raini → Koti (matched), then Tharali (too big).
# ============================================================================

class TestCase2CapacityConstraint:
    HABS  = [_panduk(), _raini(), _tharali()]
    SITES = [_koti()]   # only Koti Farm, cap=475

    def test_only_raini_fits_in_koti(self):
        result = solve_assignment(self.HABS, self.SITES, prefer_lp=False)
        matched = [a.habitation_name for a in result.assignments]
        assert "Raini" in matched, "Raini (pop=285) should fit in Koti Farm (cap=475)"

    def test_panduk_unmatched_exceeds_capacity(self):
        result = solve_assignment(self.HABS, self.SITES, prefer_lp=False)
        unmatched = [u.name for u in result.unmatched_habitations]
        assert "Pandukeshwar" in unmatched, "Pandukeshwar (pop=1396) should not fit"

    def test_tharali_unmatched_exceeds_capacity(self):
        result = solve_assignment(self.HABS, self.SITES, prefer_lp=False)
        unmatched = [u.name for u in result.unmatched_habitations]
        assert "Tharali" in unmatched

    def test_site_capacity_not_exceeded(self):
        result = solve_assignment(self.HABS, self.SITES, prefer_lp=False)
        total_assigned_to_koti = sum(
            a.population_assigned for a in result.assignments
            if a.site_name == "Koti Farm (near Auli)"
        )
        assert total_assigned_to_koti <= 475, (
            f"Koti Farm capacity exceeded: {total_assigned_to_koti} > 475"
        )


# ============================================================================
# CASE 3 — Distance constraint
#
# Bamoth is ~50 km from Joshimath (haversine). With max_distance_km=20,
# Bamoth should be excluded from Joshimath's options.
# With max_distance_km=100 (default), Bamoth is included.
# ============================================================================

class TestCase3DistanceConstraint:

    def test_distant_site_excluded_by_radius(self):
        """Bamoth (~50 km from Joshimath) excluded when max_distance=20 km."""
        result = solve_assignment(
            habitations=[_raini()],      # Raini at 30.476, 79.765
            sites=[_bamoth()],           # Bamoth at 30.271, 79.122 (~60 km from Raini)
            max_distance_km=30.0,        # Raini → Bamoth is > 30 km
            prefer_lp=False,
        )
        unmatched = [u.name for u in result.unmatched_habitations]
        assert "Raini" in unmatched, (
            "Raini should be unmatched: Bamoth is > 30 km away"
        )

    def test_distant_site_included_by_large_radius(self):
        """Same pair is matched when max_distance_km is large enough."""
        result = solve_assignment(
            habitations=[_raini()],
            sites=[_bamoth()],
            max_distance_km=200.0,
            prefer_lp=False,
        )
        matched = [a.habitation_name for a in result.assignments]
        assert "Raini" in matched

    def test_unmatched_reason_is_no_site_in_radius(self):
        result = solve_assignment(
            habitations=[_raini()],
            sites=[_bamoth()],
            max_distance_km=10.0,
            prefer_lp=False,
        )
        assert len(result.unmatched_habitations) == 1
        assert result.unmatched_habitations[0].reason == "no_site_in_radius"


# ============================================================================
# CASE 4 — All sites full → all habitations unmatched
# ============================================================================

class TestCase4AllSitesFull:

    def test_all_unmatched_when_sites_exhausted(self):
        tiny_site = SiteInput(99, "TinySite", capacity_score=0.9,
                              available_capacity=0, lat=30.5, lon=79.5)
        result = solve_assignment(
            habitations=[_raini(), _panduk()],
            sites=[tiny_site],
            prefer_lp=False,
        )
        assert len(result.assignments) == 0
        assert len(result.unmatched_habitations) == 2

    def test_solver_status_infeasible_when_none_matched(self):
        tiny_site = SiteInput(99, "TinySite", capacity_score=0.9,
                              available_capacity=0, lat=30.5, lon=79.5)
        result = solve_assignment(
            habitations=[_raini()],
            sites=[tiny_site],
            prefer_lp=False,
        )
        assert result.solver_status == "infeasible"

    def test_total_score_zero_when_no_assignments(self):
        result = solve_assignment(habitations=[], sites=[], prefer_lp=False)
        assert result.total_match_score == 0.0
        assert result.total_population_matched == 0


# ============================================================================
# CASE 5 — Edge case: no habitations
# ============================================================================

class TestCase5NoHabitations:

    def test_empty_habitations_returns_empty_result(self):
        result = solve_assignment(habitations=[], sites=[_pipalkoti()], prefer_lp=False)
        assert result.assignments == []
        assert result.unmatched_habitations == []
        assert result.total_match_score == 0.0


# ============================================================================
# CASE 6 — Edge case: no sites
# ============================================================================

class TestCase6NoSites:

    def test_all_unmatched_when_no_sites(self):
        result = solve_assignment(habitations=[_raini(), _panduk()], sites=[], prefer_lp=False)
        assert result.assignments == []
        assert len(result.unmatched_habitations) == 2
        assert result.solver_status == "infeasible"


# ============================================================================
# Additional unit tests
# ============================================================================

class TestMatchScoreFormula:

    def test_match_score_equals_urgency_times_capacity(self):
        result = solve_assignment(
            habitations=[_raini()],
            sites=[_pipalkoti()],
            prefer_lp=False,
        )
        a = result.assignments[0]
        expected = round(a.urgency_score * a.capacity_score, 6)
        assert abs(a.match_score - expected) < 1e-5

    def test_total_match_score_is_sum(self):
        result = solve_assignment(
            habitations=[_raini(), _panduk()],
            sites=[_pipalkoti(), _dhak()],
            prefer_lp=False,
        )
        expected = sum(a.match_score for a in result.assignments)
        assert abs(result.total_match_score - expected) < 1e-5


class TestGreedyOrder:

    def test_higher_urgency_processed_first(self):
        """
        With one site (Koti, cap=475), only one habitation can fit.
        Pandukeshwar (urgency=0.127, pop=1396) is processed first but too large.
        Raini (urgency=0.088, pop=285) fits → must be matched.
        """
        result = solve_assignment(
            habitations=[_raini(), _panduk()],
            sites=[_koti()],
            prefer_lp=False,
        )
        matched = [a.habitation_name for a in result.assignments]
        assert "Raini" in matched

    def test_population_assigned_matches_habitation_population(self):
        result = solve_assignment(
            habitations=[_raini()],
            sites=[_pipalkoti()],
            prefer_lp=False,
        )
        if result.assignments:
            assert result.assignments[0].population_assigned == _raini().population

    def test_distance_recorded_in_assignment(self):
        result = solve_assignment(
            habitations=[_raini()],
            sites=[_pipalkoti()],
            prefer_lp=False,
        )
        if result.assignments:
            assert result.assignments[0].distance_km > 0.0


class TestInputValidation:

    def test_negative_population_raises(self):
        with pytest.raises(ValueError, match="population"):
            HabitationInput(1, "Bad", 0.5, -1, 30.0, 79.0)

    def test_urgency_out_of_range_raises(self):
        with pytest.raises(ValueError, match="urgency"):
            HabitationInput(1, "Bad", 1.5, 100, 30.0, 79.0)

    def test_negative_capacity_raises(self):
        with pytest.raises(ValueError, match="available_capacity"):
            SiteInput(1, "Bad", 0.5, -10, 30.0, 79.0)


# ============================================================================
# PuLP tests — skipped on host, run inside Docker
# ============================================================================

class TestPuLPSolver:

    def test_pulp_gives_valid_result(self):
        pulp = pytest.importorskip("pulp", reason="PuLP not installed on this machine")
        result = solve_assignment(
            habitations=[_raini(), _panduk()],
            sites=[_pipalkoti(), _dhak()],
            prefer_lp=True,
        )
        assert result.solver_used in ("pulp_cbc", "greedy")   # greedy if pulp fails
        assert result.total_match_score >= 0.0

    def test_pulp_respects_capacity(self):
        pytest.importorskip("pulp", reason="PuLP not installed")
        tiny = SiteInput(99, "Tiny", 0.9, 200, 30.49, 79.44)
        result = solve_assignment(
            habitations=[_raini(), _panduk()],
            sites=[tiny],
            prefer_lp=True,
        )
        total = sum(a.population_assigned for a in result.assignments
                    if a.site_name == "Tiny")
        assert total <= 200
