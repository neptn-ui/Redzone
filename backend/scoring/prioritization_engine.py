# backend/scoring/prioritization_engine.py
# Prioritization Engine (Urgency Score) — Section 5 formula.
#
# DESIGN PRINCIPLES (§5, §7):
#   - Pure functions only. No DB calls.
#   - Urgency score answers "WHO should move FIRST?" by combining hazard
#     severity, population exposure, and whether a viable destination exists.
#   - site_availability_factor penalises habitations with no feasible site
#     rather than hiding them — they stay visible in the priority queue.
#
# Formula (§5):
#   urgency_score = hazard_score × population_exposure_norm × site_availability_factor
#
#   site_availability_factor:
#     1.0  if at least one candidate site with capacity_score ≥ 0.5 is within
#          the practical relocation radius (default 15 km)
#     0.6  otherwise (high risk, no viable destination yet → still visible
#          but flagged for site-search escalation)
#
# Timeline buckets (§5):
#   urgency_score ≥ 0.70   →  Immediate        (move within 3 months)
#   urgency_score 0.45–0.69 →  Short-term       (within 1 year)
#   urgency_score < 0.45   →  Medium-term/monitor
#
# population_exposure_norm:
#   Represents fraction of the "reference population" that is genuinely
#   at risk. Caller should pass the *exposed* population (inside hazard zone),
#   not the full habitation population.
#   Reference population: POPULATION_NORM_REFERENCE = 5,000 persons.
#   Any habitation with ≥ 5,000 persons fully exposed gets norm = 1.0.
# ============================================================================

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional


# ============================================================================
# Constants
# ============================================================================

# Population reference for normalization (SYNTH — calibrated to Chamoli pilot)
# Any habitation with ≥ 5,000 persons fully exposed → population_exposure_norm = 1.0
POPULATION_NORM_REFERENCE: int = 5_000

# Site availability factor values (§5)
SITE_FACTOR_WITH_SITE:    float = 1.0   # feasible site exists within radius
SITE_FACTOR_WITHOUT_SITE: float = 0.6   # no feasible site → flagged, not hidden

# Urgency timeline thresholds (§5)
URGENCY_IMMEDIATE_THRESHOLD:   float = 0.70
URGENCY_SHORT_TERM_THRESHOLD:  float = 0.45

# Minimum population exposure norm for a habitation that is 100% within
# a hazard zone — prevents tiny high-risk villages from being buried by
# large stable towns in the urgency ranking.
# When exposed_fraction = 1.0, pop_norm cannot fall below this floor.
EXPOSURE_FLOOR: float = 0.18

# Default site search radius (§5 specifies "e.g. 15 km")
DEFAULT_RADIUS_KM:        float = 15.0
MIN_SITE_CAPACITY_SCORE:  float = 0.50   # threshold for a "viable" site (§5)


# ============================================================================
# Result dataclass
# ============================================================================

@dataclass
class UrgencyResult:
    """
    Output of compute_urgency_score().
    Stores every input and output so the API layer can write explanation_json
    and the priority queue can sort without re-computing.
    """
    habitation_name: str

    # Inputs
    hazard_score:              float
    population_exposure_norm:  float
    site_availability_factor:  float

    # Output
    urgency_score:             float
    timeline:                  str    # "immediate" | "short_term" | "medium_term"
    timeline_label:            str

    # Optional context
    matched_site_name:         Optional[str]  = None
    matched_site_distance_km:  Optional[float] = None
    matched_site_capacity_score: Optional[float] = None
    no_feasible_site:          bool = False
    notes:                     list[str] = field(default_factory=list)

    def to_explanation_json(self) -> dict:
        return {
            "habitation": self.habitation_name,
            "urgency_score": round(self.urgency_score, 4),
            "timeline": self.timeline_label,
            "formula": "hazard_score × population_exposure_norm × site_availability_factor",
            "inputs": {
                "hazard_score":             round(self.hazard_score, 4),
                "population_exposure_norm": round(self.population_exposure_norm, 4),
                "site_availability_factor": self.site_availability_factor,
            },
            "matched_site": {
                "name":           self.matched_site_name,
                "distance_km":    self.matched_site_distance_km,
                "capacity_score": self.matched_site_capacity_score,
            } if self.matched_site_name else None,
            "no_feasible_site_within_radius": self.no_feasible_site,
            "notes": self.notes,
        }


# ============================================================================
# Primary scoring function
# ============================================================================

def compute_urgency_score(
    habitation_name: str,
    hazard_score: float,
    population_exposure_norm: float,
    site_availability_factor: float = SITE_FACTOR_WITH_SITE,
    matched_site_name: Optional[str] = None,
    matched_site_distance_km: Optional[float] = None,
    matched_site_capacity_score: Optional[float] = None,
    notes: Optional[list[str]] = None,
) -> UrgencyResult:
    """
    Computes the urgency / relocation priority score for one habitation.

    All normalised inputs are clamped to [0, 1]. site_availability_factor
    is clamped to {SITE_FACTOR_WITHOUT_SITE, SITE_FACTOR_WITH_SITE}.

    Returns UrgencyResult with the full audit trail.
    """
    hs   = _clamp(hazard_score)
    pen  = _clamp(population_exposure_norm)
    saf  = max(SITE_FACTOR_WITHOUT_SITE, min(SITE_FACTOR_WITH_SITE, site_availability_factor))

    urgency = _clamp(hs * pen * saf)
    timeline, label = classify_urgency(urgency)

    no_feasible = (saf == SITE_FACTOR_WITHOUT_SITE)

    return UrgencyResult(
        habitation_name=habitation_name,
        hazard_score=hs,
        population_exposure_norm=pen,
        site_availability_factor=saf,
        urgency_score=round(urgency, 6),
        timeline=timeline,
        timeline_label=label,
        matched_site_name=matched_site_name,
        matched_site_distance_km=matched_site_distance_km,
        matched_site_capacity_score=matched_site_capacity_score,
        no_feasible_site=no_feasible,
        notes=notes or [],
    )


def classify_urgency(urgency_score: float) -> tuple[str, str]:
    """Maps a urgency_score to (key, human_label). Thresholds per §5."""
    if urgency_score >= URGENCY_IMMEDIATE_THRESHOLD:
        return "immediate",   "Immediate — Relocate within 3 months"
    elif urgency_score >= URGENCY_SHORT_TERM_THRESHOLD:
        return "short_term",  "Short-term — Relocate within 1 year"
    else:
        return "medium_term", "Medium-term — Monitor; plan for 1–3 years"


# ============================================================================
# Population exposure normalization
# ============================================================================

def compute_population_exposure_norm(
    exposed_population: int,
    reference_population: int = POPULATION_NORM_REFERENCE,
    exposed_fraction: float = 1.0,
) -> float:
    """
    Normalises exposed (at-risk) population against a reference.

    exposed_population: persons within the hazard zone (not full habitation total).
    reference_population: defaults to POPULATION_NORM_REFERENCE (5,000).
    exposed_fraction: proportion of the habitation within the hazard zone (0–1).
        When exposed_fraction = 1.0 (entire habitation at risk), the result
        is floored at EXPOSURE_FLOOR so tiny villages with 100% exposure
        are never ranked below large but mostly-safe habitations.

    Any habitation with ≥ 5,000 exposed persons → norm = 1.0.
    """
    if reference_population <= 0 or exposed_population <= 0:
        return 0.0
    raw = _clamp(exposed_population / reference_population)
    if exposed_fraction >= 1.0 and exposed_population > 0:
        return max(raw, EXPOSURE_FLOOR)
    return raw


# ============================================================================
# Site availability factor computation
# ============================================================================

def compute_site_availability_factor(
    candidate_capacity_scores_in_radius: list[float],
    min_capacity_score: float = MIN_SITE_CAPACITY_SCORE,
) -> float:
    """
    Returns SITE_FACTOR_WITH_SITE (1.0) if any candidate site within the
    search radius has capacity_score ≥ min_capacity_score (default 0.5).
    Returns SITE_FACTOR_WITHOUT_SITE (0.6) otherwise.

    The caller is responsible for computing 'candidate_capacity_scores_in_radius'
    (filtering candidate sites to those within the radius before calling this).
    """
    if any(cs >= min_capacity_score for cs in candidate_capacity_scores_in_radius):
        return SITE_FACTOR_WITH_SITE
    return SITE_FACTOR_WITHOUT_SITE


# ============================================================================
# Haversine distance helper (needed by matching_optimizer; defined here
# so it is available without importing geospatial libraries)
# ============================================================================

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Returns the great-circle distance in kilometres between two WGS84 points.
    Accurate to < 0.5% for distances relevant to this project (< 200 km).
    """
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ============================================================================
# Priority ranking (list-level operation)
# ============================================================================

def rank_by_urgency(results: list[UrgencyResult]) -> list[UrgencyResult]:
    """
    Sorts a list of UrgencyResults descending by urgency_score.
    Ties broken by hazard_score descending (higher hazard = higher rank).
    Returns a new list; does not mutate the input.
    """
    return sorted(results, key=lambda r: (r.urgency_score, r.hazard_score), reverse=True)


# ============================================================================
# Internal utility
# ============================================================================

def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(v)))
