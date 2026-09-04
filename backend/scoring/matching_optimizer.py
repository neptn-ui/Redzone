# backend/scoring/matching_optimizer.py
# Matching Optimizer — Section 5 / Section 6 assignment step.
#
# RESPONSIBILITY:
#   Given a list of at-risk habitations and candidate relocation sites,
#   compute an optimal (or near-optimal) many-to-one assignment that:
#     • Maximises sum of (urgency_score × capacity_score) for matched pairs
#     • Respects site capacity constraints (total assigned pop ≤ available_capacity)
#     • Respects a maximum relocation distance (configurable; default 100 km)
#     • Prioritises higher-urgency habitations when capacity is scarce
#
# SOLVERS (attempted in order):
#   1. PuLP CBC (Binary Integer Program) — optimal, exact.
#      Available inside Docker (requirements.txt: pulp==2.8.*).
#   2. Greedy (pure-Python, no deps) — near-optimal, always available.
#      Used during development/tests on the host machine.
#
# DESIGN (§5, §7):
#   - Pure functions only. No DB calls, no network I/O.
#   - Audit trail produced here, not in the API layer.
#   - "No feasible assignment" is a valid, handled result — habitations with
#     no reachable site appear in unmatched_habitations with explanation.
# ============================================================================

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

from scoring.prioritization_engine import haversine_km

log = logging.getLogger(__name__)


# ============================================================================
# Constants
# ============================================================================

DEFAULT_MAX_DISTANCE_KM: float = 100.0   # practical relocation ceiling
MIN_MATCH_URGENCY:       float = 0.0     # habitations with urgency above this are processed
                                          # (set > 0 to skip stable habitations)


# ============================================================================
# Input dataclasses
# ============================================================================

@dataclass
class HabitationInput:
    """One at-risk habitation to be matched to a relocation site."""
    habitation_id:  int
    name:           str
    urgency_score:  float     # from prioritization_engine
    population:     int       # people to be relocated
    lat:            float
    lon:            float

    def __post_init__(self):
        if self.population < 0:
            raise ValueError(f"population must be ≥ 0, got {self.population}")
        if not (0.0 <= self.urgency_score <= 1.0):
            raise ValueError(f"urgency_score must be [0,1], got {self.urgency_score}")


@dataclass
class SiteInput:
    """One candidate relocation site."""
    site_id:            int
    name:               str
    capacity_score:     float    # from capacity_engine
    available_capacity: int      # remaining persons this site can absorb
    lat:                float
    lon:                float

    def __post_init__(self):
        if self.available_capacity < 0:
            raise ValueError(f"available_capacity must be ≥ 0, got {self.available_capacity}")


# ============================================================================
# Output dataclasses
# ============================================================================

@dataclass
class Assignment:
    """
    A confirmed habitation → site match.
    match_score = urgency_score × capacity_score (the LP objective term).
    """
    habitation_id:      int
    habitation_name:    str
    site_id:            int
    site_name:          str
    urgency_score:      float
    capacity_score:     float
    match_score:        float    # urgency × capacity_score
    distance_km:        float
    population_assigned: int

    def to_dict(self) -> dict:
        return {
            "habitation_id":      self.habitation_id,
            "habitation_name":    self.habitation_name,
            "site_id":            self.site_id,
            "site_name":          self.site_name,
            "urgency_score":      round(self.urgency_score, 4),
            "capacity_score":     round(self.capacity_score, 4),
            "match_score":        round(self.match_score, 4),
            "distance_km":        round(self.distance_km, 2),
            "population_assigned": self.population_assigned,
        }


@dataclass
class UnmatchedHabitation:
    habitation_id: int
    name:          str
    urgency_score: float
    population:    int
    reason:        str   # "no_site_in_radius" | "all_sites_full" | "zero_capacity"


@dataclass
class OptimizationResult:
    """
    Full output of solve_assignment().
    The API layer writes this to zone_scores.explanation_json and the
    priority queue reads assignments from it.
    """
    assignments:             list[Assignment]
    unmatched_habitations:   list[UnmatchedHabitation]
    solver_used:             str    # "pulp_cbc" | "greedy"
    solver_status:           str    # "optimal" | "feasible" | "infeasible" | "error"
    total_match_score:       float  # sum of match_scores
    total_population_matched: int
    notes:                   list[str] = field(default_factory=list)

    def to_explanation_json(self) -> dict:
        return {
            "solver":              self.solver_used,
            "status":              self.solver_status,
            "total_match_score":   round(self.total_match_score, 4),
            "population_matched":  self.total_population_matched,
            "assignments":         [a.to_dict() for a in self.assignments],
            "unmatched":           [
                {"id": u.habitation_id, "name": u.name,
                 "urgency": round(u.urgency_score, 4), "reason": u.reason}
                for u in self.unmatched_habitations
            ],
            "notes": self.notes,
        }


# ============================================================================
# Primary entry point
# ============================================================================

def solve_assignment(
    habitations:     list[HabitationInput],
    sites:           list[SiteInput],
    max_distance_km: float = DEFAULT_MAX_DISTANCE_KM,
    prefer_lp:       bool  = True,
) -> OptimizationResult:
    """
    Assigns each at-risk habitation to a candidate site.

    Attempts PuLP Binary Integer Program first (prefer_lp=True).
    Falls back to greedy if PuLP is unavailable or times out.

    Parameters:
        habitations:     list of HabitationInput objects (sorted by urgency desc inside)
        sites:           list of SiteInput objects
        max_distance_km: relocation radius ceiling
        prefer_lp:       try PuLP first (set False to force greedy, e.g. in tests)

    Returns OptimizationResult with all assignments and unmatched habitations.
    """
    if not habitations:
        return OptimizationResult(
            assignments=[], unmatched_habitations=[],
            solver_used="none", solver_status="feasible",
            total_match_score=0.0, total_population_matched=0,
            notes=["No habitations provided."],
        )
    if not sites:
        unmatched = [
            UnmatchedHabitation(h.habitation_id, h.name, h.urgency_score,
                                h.population, "all_sites_full")
            for h in habitations
        ]
        return OptimizationResult(
            assignments=[], unmatched_habitations=unmatched,
            solver_used="none", solver_status="infeasible",
            total_match_score=0.0, total_population_matched=0,
            notes=["No candidate sites provided."],
        )

    if prefer_lp:
        try:
            return _solve_with_pulp(habitations, sites, max_distance_km)
        except ImportError:
            log.info("PuLP not available — falling back to greedy solver")
        except Exception as exc:
            log.warning("PuLP solver failed (%s) — falling back to greedy", exc)

    return _solve_greedy(habitations, sites, max_distance_km)


# ============================================================================
# Greedy solver (pure Python, no external deps)
# ============================================================================

def _solve_greedy(
    habitations:     list[HabitationInput],
    sites:           list[SiteInput],
    max_distance_km: float,
) -> OptimizationResult:
    """
    Near-optimal greedy matching:
      1. Sort habitations descending by urgency_score (highest urgency first).
      2. For each habitation, find the site that maximises capacity_score
         subject to:
           a. distance ≤ max_distance_km
           b. remaining_capacity ≥ habitation.population
      3. Assign; subtract population from site remaining_capacity.

    Time complexity: O(n × m) where n = habitations, m = sites.
    """
    # Work on copies so inputs are not mutated
    remaining_cap = {s.site_id: s.available_capacity for s in sites}
    site_by_id    = {s.site_id: s for s in sites}

    sorted_habs = sorted(habitations, key=lambda h: h.urgency_score, reverse=True)

    assignments: list[Assignment] = []
    unmatched:   list[UnmatchedHabitation] = []

    for hab in sorted_habs:
        # Find all feasible sites
        feasible = []
        any_in_radius = False
        for site in sites:
            d = haversine_km(hab.lat, hab.lon, site.lat, site.lon)
            if d > max_distance_km:
                continue
            any_in_radius = True
            cap = remaining_cap[site.site_id]
            if cap >= hab.population:
                feasible.append((site.capacity_score, -d, site))  # sort: score desc, distance asc

        if not feasible:
            reason = "no_site_in_radius" if not any_in_radius else "all_sites_full"
            unmatched.append(
                UnmatchedHabitation(hab.habitation_id, hab.name,
                                    hab.urgency_score, hab.population, reason)
            )
            continue

        # Best site: highest capacity_score, tie-break by distance (nearest)
        feasible.sort(key=lambda t: (t[0], t[1]), reverse=True)
        best_site = feasible[0][2]
        dist      = haversine_km(hab.lat, hab.lon, best_site.lat, best_site.lon)

        remaining_cap[best_site.site_id] -= hab.population

        assignments.append(Assignment(
            habitation_id=hab.habitation_id,
            habitation_name=hab.name,
            site_id=best_site.site_id,
            site_name=best_site.name,
            urgency_score=hab.urgency_score,
            capacity_score=best_site.capacity_score,
            match_score=round(hab.urgency_score * best_site.capacity_score, 6),
            distance_km=round(dist, 3),
            population_assigned=hab.population,
        ))

    total_score = sum(a.match_score for a in assignments)
    total_pop   = sum(a.population_assigned for a in assignments)

    return OptimizationResult(
        assignments=assignments,
        unmatched_habitations=unmatched,
        solver_used="greedy",
        solver_status="feasible" if assignments else "infeasible",
        total_match_score=round(total_score, 6),
        total_population_matched=total_pop,
        notes=[
            f"Greedy solver: sorted {len(habitations)} habitations by urgency, "
            f"matched {len(assignments)}, unmatched {len(unmatched)}.",
            f"Max distance constraint: {max_distance_km} km.",
        ],
    )


# ============================================================================
# LP solver (PuLP CBC)
# ============================================================================

def _solve_with_pulp(
    habitations:     list[HabitationInput],
    sites:           list[SiteInput],
    max_distance_km: float,
) -> OptimizationResult:
    """
    Exact Binary Integer Program via PuLP + CBC.

    Maximises: sum_{i,j} x_{ij} × urgency_i × capacity_score_j
    Subject to:
      sum_j x_{ij} ≤ 1                    ∀ habitation i
      sum_i x_{ij} × pop_i ≤ avail_cap_j  ∀ site j
      x_{ij} = 0  if dist(i, j) > max_distance_km
      x_{ij} ∈ {0, 1}
    """
    import pulp  # noqa: PLC0415 — intentional late import for fallback

    n = len(habitations)
    m = len(sites)

    # Pre-compute distances and feasible pairs
    dist_matrix: dict[tuple[int,int], float] = {}
    feasible_pairs: list[tuple[int,int]] = []
    for i, hab in enumerate(habitations):
        for j, site in enumerate(sites):
            d = haversine_km(hab.lat, hab.lon, site.lat, site.lon)
            dist_matrix[(i, j)] = d
            if d <= max_distance_km:
                feasible_pairs.append((i, j))

    if not feasible_pairs:
        unmatched = [
            UnmatchedHabitation(h.habitation_id, h.name, h.urgency_score,
                                h.population, "no_site_in_radius")
            for h in habitations
        ]
        return OptimizationResult(
            assignments=[], unmatched_habitations=unmatched,
            solver_used="pulp_cbc", solver_status="infeasible",
            total_match_score=0.0, total_population_matched=0,
            notes=["No (habitation, site) pairs within max_distance_km."],
        )

    prob = pulp.LpProblem("relocation_assignment", pulp.LpMaximize)

    x = {(i, j): pulp.LpVariable(f"x_{i}_{j}", cat="Binary")
         for (i, j) in feasible_pairs}

    # Objective
    prob += pulp.lpSum(
        x[(i, j)] * habitations[i].urgency_score * sites[j].capacity_score
        for (i, j) in feasible_pairs
    )

    # Constraint 1: each habitation assigned to at most one site
    for i in range(n):
        pairs_for_i = [(i, j) for (_, j) in [(ip, jp) for (ip, jp) in feasible_pairs if ip == i]]
        if pairs_for_i:
            prob += pulp.lpSum(x[(i, j)] for (i, j) in [(i, j) for (ii, j) in feasible_pairs if ii == i]) <= 1

    # Constraint 2: site capacity
    for j in range(m):
        pairs_for_j = [(i, j) for (i, jj) in feasible_pairs if jj == j]
        if pairs_for_j:
            prob += pulp.lpSum(x[(i, j)] * habitations[i].population for (i, j) in pairs_for_j) \
                   <= sites[j].available_capacity

    solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=30)
    status = prob.solve(solver)
    status_str = pulp.LpStatus[prob.status]

    assignments:  list[Assignment] = []
    unmatched_ids = set(range(n))

    for (i, j) in feasible_pairs:
        if pulp.value(x[(i, j)]) and pulp.value(x[(i, j)]) > 0.5:
            hab  = habitations[i]
            site = sites[j]
            d    = dist_matrix[(i, j)]
            assignments.append(Assignment(
                habitation_id=hab.habitation_id,
                habitation_name=hab.name,
                site_id=site.site_id,
                site_name=site.name,
                urgency_score=hab.urgency_score,
                capacity_score=site.capacity_score,
                match_score=round(hab.urgency_score * site.capacity_score, 6),
                distance_km=round(d, 3),
                population_assigned=hab.population,
            ))
            unmatched_ids.discard(i)

    unmatched = [
        UnmatchedHabitation(habitations[i].habitation_id, habitations[i].name,
                            habitations[i].urgency_score, habitations[i].population,
                            "all_sites_full")
        for i in unmatched_ids
    ]

    total_score = sum(a.match_score for a in assignments)
    total_pop   = sum(a.population_assigned for a in assignments)

    return OptimizationResult(
        assignments=assignments,
        unmatched_habitations=unmatched,
        solver_used="pulp_cbc",
        solver_status=status_str.lower(),
        total_match_score=round(total_score, 6),
        total_population_matched=total_pop,
        notes=[f"PuLP CBC solver: status={status_str}, "
               f"matched={len(assignments)}, unmatched={len(unmatched)}."],
    )


# ============================================================================
# Convenience: build inputs from DB rows (called by the API layer)
# ============================================================================

def habitation_input_from_db(row) -> HabitationInput:
    """
    Build a HabitationInput from a joined (Habitation + ZoneScore) ORM row.
    `row` must have: .id, .name, .population, .lat, .lon, .urgency_score
    (the last from zone_scores.explanation_json or a computed attribute).
    """
    return HabitationInput(
        habitation_id=row.id,
        name=row.name,
        urgency_score=float(row.urgency_score),
        population=row.population,
        lat=row.lat,
        lon=row.lon,
    )


def site_input_from_db(row) -> SiteInput:
    """
    Build a SiteInput from a CandidateSite ORM row with a pre-computed capacity_score.
    `row` must have: .id, .name, .available_capacity (= max - existing_occupancy),
    .lat, .lon, .capacity_score
    """
    return SiteInput(
        site_id=row.id,
        name=row.name,
        capacity_score=float(row.capacity_score),
        available_capacity=row.available_capacity,
        lat=row.lat,
        lon=row.lon,
    )
