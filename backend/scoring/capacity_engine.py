# backend/scoring/capacity_engine.py
# Capacity Scoring Engine — Section 5 formula.
#
# DESIGN PRINCIPLES (§5, §7):
#   - Pure functions only: no DB calls, no side effects.
#   - Every weight is a named constant at the top of this file.
#   - max_capacity_estimate uses the REAL NBC 2016 constant (9.5 m²/person)
#     documented in data_sources.md §E.1 — not an invented number.
#   - The audit trail is produced here and is always consistent with the
#     returned score.
#
# Formula (§5):
#   capacity_score = 0.30 × land_availability_norm
#                  + 0.25 × slope_safety_norm
#                  + 0.20 × infra_proximity_norm
#                  + 0.15 × water_access_norm
#                  + 0.10 × (1 − current_load_ratio)
#
# NBC 2016 minimum habitable area per person: 9.5 m²
#   (National Building Code 2016, Part 3, habitable room minimum)
#   Source: bis.gov.in / infralens.in — REAL constant, see data_sources.md §E.1
#   max_capacity_estimate = available_land_sqm ÷ 9.5
#   (conservative; intentionally underestimates to buffer for infra/roads)
# ============================================================================

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


# ============================================================================
# Scoring weights (§5 — expert-calibrated per spec; SYNTH per data_sources.md §E.3)
# ============================================================================

W_LAND_AVAILABILITY = 0.30
W_SLOPE_SAFETY      = 0.25
W_INFRA_PROXIMITY   = 0.20
W_WATER_ACCESS      = 0.15
W_LOAD_HEADROOM     = 0.10   # = weight on (1 - current_load_ratio)

_WEIGHT_SUM = (W_LAND_AVAILABILITY + W_SLOPE_SAFETY + W_INFRA_PROXIMITY +
               W_WATER_ACCESS + W_LOAD_HEADROOM)
assert abs(_WEIGHT_SUM - 1.0) < 1e-9, f"Capacity weights must sum to 1.0, got {_WEIGHT_SUM}"

# NBC 2016 minimum habitable area per person (REAL — data_sources.md §E.1)
NBC_MIN_AREA_PER_PERSON_SQM: float = 9.5

# Normalization domain constants (SYNTH — calibrated for Chamoli pilot sites)
LAND_MAX_SQM       = 100_000.0  # 10 ha — sites larger than this score 1.0
SLOPE_SAFE_MAX_DEG =    20.0    # slope ≥ 20° → 0.0 safety score
INFRA_MAX_KM       =     5.0    # road distance ≥ 5 km → 0.0
WATER_MAX_KM       =     5.0    # water distance ≥ 5 km → 0.0


# ============================================================================
# Result dataclass — carries score + full §6 audit trail
# ============================================================================

@dataclass
class CapacityResult:
    """
    Output of compute_capacity_score().
    Mirrors the structure of HazardResult so the API layer treats them uniformly.
    """
    site_name: str

    # Normalised component values (0–1)
    land_availability_norm: float
    slope_safety_norm:      float
    infra_proximity_norm:   float
    water_access_norm:      float
    load_headroom_norm:     float   # = 1 − current_load_ratio

    # Derived values
    current_load_ratio:       float
    max_capacity_estimate:    int    # persons; derived from NBC 2016 constant
    available_capacity:       int    # max_capacity_estimate − existing_occupancy

    # Final score
    capacity_score: float

    notes: list[str] = field(default_factory=list)

    def to_explanation_json(self) -> dict:
        """
        Returns the §6 audit trail dict for this site's capacity.
        """
        return {
            "site": self.site_name,
            "capacity_score": round(self.capacity_score, 4),
            "max_capacity_estimate": self.max_capacity_estimate,
            "available_capacity": self.available_capacity,
            "current_load_ratio": round(self.current_load_ratio, 4),
            "nbc_2016_min_area_per_person_sqm": NBC_MIN_AREA_PER_PERSON_SQM,
            "breakdown": {
                "land_availability": {
                    "value":        round(self.land_availability_norm, 4),
                    "weight":       W_LAND_AVAILABILITY,
                    "contribution": round(self.land_availability_norm * W_LAND_AVAILABILITY, 4),
                },
                "slope_safety": {
                    "value":        round(self.slope_safety_norm, 4),
                    "weight":       W_SLOPE_SAFETY,
                    "contribution": round(self.slope_safety_norm * W_SLOPE_SAFETY, 4),
                },
                "infra_proximity": {
                    "value":        round(self.infra_proximity_norm, 4),
                    "weight":       W_INFRA_PROXIMITY,
                    "contribution": round(self.infra_proximity_norm * W_INFRA_PROXIMITY, 4),
                },
                "water_access": {
                    "value":        round(self.water_access_norm, 4),
                    "weight":       W_WATER_ACCESS,
                    "contribution": round(self.water_access_norm * W_WATER_ACCESS, 4),
                },
                "load_headroom": {
                    "value":        round(self.load_headroom_norm, 4),
                    "weight":       W_LOAD_HEADROOM,
                    "contribution": round(self.load_headroom_norm * W_LOAD_HEADROOM, 4),
                    "note":         "(1 − current_load_ratio)",
                },
            },
            "formula": (
                f"{W_LAND_AVAILABILITY}×land_availability "
                f"+ {W_SLOPE_SAFETY}×slope_safety "
                f"+ {W_INFRA_PROXIMITY}×infra_proximity "
                f"+ {W_WATER_ACCESS}×water_access "
                f"+ {W_LOAD_HEADROOM}×(1−load_ratio)"
            ),
            "notes": self.notes,
        }


# ============================================================================
# Normalization helpers
# ============================================================================

def normalize_land_availability(available_land_sqm: float) -> float:
    """
    More available land → higher score.
    0 sqm → 0.0; ≥ LAND_MAX_SQM (100,000 sqm = 10 ha) → 1.0.
    """
    return _clamp(available_land_sqm / LAND_MAX_SQM)


def normalize_slope_safety(slope_degrees: float) -> float:
    """
    Flatter terrain → safer for construction → higher score.
    0° → 1.0; ≥ SLOPE_SAFE_MAX_DEG (20°) → 0.0.
    Linearly interpolated; never negative.
    """
    if slope_degrees <= 0:
        return 1.0
    raw = 1.0 - (slope_degrees / SLOPE_SAFE_MAX_DEG)
    return _clamp(raw)


def normalize_infra_proximity(distance_to_road_km: float) -> float:
    """
    Closer to road → better infrastructure access → higher score.
    0 km (on road) → 1.0; ≥ INFRA_MAX_KM (5 km) → 0.0.
    """
    if distance_to_road_km <= 0:
        return 1.0
    return _clamp(1.0 - (distance_to_road_km / INFRA_MAX_KM))


def normalize_water_access(distance_to_water_km: float) -> float:
    """
    Closer to water source → better → higher score.
    0 km → 1.0; ≥ WATER_MAX_KM (5 km) → 0.0.
    """
    if distance_to_water_km <= 0:
        return 1.0
    return _clamp(1.0 - (distance_to_water_km / WATER_MAX_KM))


def compute_load_ratio(
    existing_occupancy: int,
    max_capacity_estimate: int,
) -> float:
    """
    Fraction of capacity already used.
    0.0 = empty; 1.0 = full. Clamped to [0, 1].
    """
    if max_capacity_estimate <= 0:
        return 1.0   # treat "no capacity" as full
    return _clamp(existing_occupancy / max_capacity_estimate)


def estimate_max_capacity(available_land_sqm: float) -> int:
    """
    Conservative capacity estimate using NBC 2016 minimum (9.5 m²/person).
    See data_sources.md §E.1.
    """
    if available_land_sqm <= 0:
        return 0
    return int(available_land_sqm / NBC_MIN_AREA_PER_PERSON_SQM)


# ============================================================================
# Primary scoring function
# ============================================================================

def compute_capacity_score(
    site_name: str,
    land_availability_norm: float,
    slope_safety_norm: float,
    infra_proximity_norm: float,
    water_access_norm: float,
    current_load_ratio: float,
    max_capacity_estimate: int,
    existing_occupancy: int,
    notes: Optional[list[str]] = None,
) -> CapacityResult:
    """
    Computes the transparent weighted capacity score for one candidate site.
    All norm arguments must be in [0, 1]; clamped on input.

    Returns a CapacityResult with the full audit trail.
    """
    la   = _clamp(land_availability_norm)
    ss   = _clamp(slope_safety_norm)
    ip   = _clamp(infra_proximity_norm)
    wa   = _clamp(water_access_norm)
    lr   = _clamp(current_load_ratio)
    lh   = 1.0 - lr   # load headroom

    score = (
        W_LAND_AVAILABILITY * la
        + W_SLOPE_SAFETY    * ss
        + W_INFRA_PROXIMITY * ip
        + W_WATER_ACCESS    * wa
        + W_LOAD_HEADROOM   * lh
    )

    available = max(0, max_capacity_estimate - existing_occupancy)

    return CapacityResult(
        site_name=site_name,
        land_availability_norm=la,
        slope_safety_norm=ss,
        infra_proximity_norm=ip,
        water_access_norm=wa,
        load_headroom_norm=lh,
        current_load_ratio=round(lr, 6),
        max_capacity_estimate=max_capacity_estimate,
        available_capacity=available,
        capacity_score=round(_clamp(score), 6),
        notes=notes or [],
    )


def compute_capacity_score_from_raw(
    site_name: str,
    available_land_sqm: float,
    slope_degrees: float,
    distance_to_road_km: float,
    distance_to_water_km: float,
    existing_occupancy: int,
    max_capacity_estimate: Optional[int] = None,
) -> CapacityResult:
    """
    Convenience wrapper: accepts raw domain values (matching the
    candidate_sites table columns), normalises internally, then calls
    compute_capacity_score().

    If max_capacity_estimate is None, it is derived from available_land_sqm
    using the NBC 2016 constant (estimate_max_capacity()).
    """
    if max_capacity_estimate is None:
        max_capacity_estimate = estimate_max_capacity(available_land_sqm)

    load_ratio = compute_load_ratio(existing_occupancy, max_capacity_estimate)

    notes = [
        f"Available land: {available_land_sqm:,.0f} sqm",
        f"Slope: {slope_degrees:.1f}°",
        f"Distance to road: {distance_to_road_km:.1f} km",
        f"Distance to water: {distance_to_water_km:.1f} km",
        f"Existing occupancy: {existing_occupancy} persons",
        f"Max capacity (NBC 2016 @ {NBC_MIN_AREA_PER_PERSON_SQM} m²/person): "
        f"{max_capacity_estimate} persons",
        f"Available capacity: {max(0, max_capacity_estimate - existing_occupancy)} persons",
        f"Current load ratio: {load_ratio:.1%}",
    ]

    return compute_capacity_score(
        site_name=site_name,
        land_availability_norm=normalize_land_availability(available_land_sqm),
        slope_safety_norm=normalize_slope_safety(slope_degrees),
        infra_proximity_norm=normalize_infra_proximity(distance_to_road_km),
        water_access_norm=normalize_water_access(distance_to_water_km),
        current_load_ratio=load_ratio,
        max_capacity_estimate=max_capacity_estimate,
        existing_occupancy=existing_occupancy,
        notes=notes,
    )


# ============================================================================
# Internal utility
# ============================================================================

def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(v)))


# ============================================================================
# Tier 4.2 & 4.3 — Capacity-Gap Analysis & Provenance Engine
# ============================================================================

@dataclass
class CapacityGapReport:
    total_relocation_demand: int
    total_gross_capacity: int
    total_committed_population: int
    total_available_capacity: int
    status: str              # "SURPLUS_HEADROOM" | "DEFICIT_GAP"
    headroom_or_gap: int     # positive for headroom, negative for gap
    action_required: str     # "Capacity adequate for immediate intake" | "Identify additional candidate sites"
    sites_included: list[dict]
    source: str              # "NBC 2016 Table 3 / SDMA Registry"
    vintage: str             # "NBC 2016 / ASDMA 2026"
    confidence: str          # "HIGH" | "MEDIUM"
    provenance_details: str

    def to_dict(self) -> dict:
        return {
            "total_relocation_demand": self.total_relocation_demand,
            "total_gross_capacity": self.total_gross_capacity,
            "total_committed_population": self.total_committed_population,
            "total_available_capacity": self.total_available_capacity,
            "status": self.status,
            "headroom_or_gap": self.headroom_or_gap,
            "action_required": self.action_required,
            "sites_included": self.sites_included,
            "source": self.source,
            "vintage": self.vintage,
            "confidence": self.confidence,
            "provenance_details": self.provenance_details,
        }


def compute_capacity_gap_analysis(
    relocation_demand: int,
    candidate_sites: list[dict],
) -> CapacityGapReport:
    """
    Tier 4.2: RELOCATION DEMAND vs AVAILABLE SAFE CAPACITY -> HEADROOM or GAP.
    On a gap: explicit ACTION "Identify additional candidate sites".
    Never selects an over-capacity site as though it can accommodate everyone.
    
    Tier 4.3: Aggregate capacity figure is inspectable down to:
    sites included, gross capacity, committed population, resulting headroom, source, vintage, confidence.
    """
    total_gross = 0
    total_committed = 0
    total_avail = 0
    sites_summary = []

    for s in candidate_sites:
        name = s.get("name", "Unknown Site")
        gross = int(s.get("max_capacity_estimate", 0))
        occ = int(s.get("existing_occupancy", 0))
        comm = int(s.get("committed_population", 0))
        avail = max(0, gross - occ - comm)
        
        total_gross += gross
        total_committed += (occ + comm)
        total_avail += avail
        
        sites_summary.append({
            "site_name": name,
            "gross_capacity": gross,
            "committed_population": occ + comm,
            "available_headroom": avail,
            "hazard_free": s.get("hazard_free", True),
            "source": s.get("data_source", "SDMA Site Registry / NBC 2016"),
        })

    headroom_or_gap = total_avail - relocation_demand
    
    if headroom_or_gap >= 0:
        status = "SURPLUS_HEADROOM"
        action = "Capacity adequate for immediate intake and phased resettlement."
    else:
        status = "DEFICIT_GAP"
        action = "Identify additional candidate sites. Relocation demand exceeds verified safe capacity."

    provenance_details = (
        f"Calculated from {len(candidate_sites)} candidate site(s). Gross capacity derived from NBC 2016 "
        f"standard ({NBC_MIN_AREA_PER_PERSON_SQM} m²/person) minus committed/existing occupancy."
    )

    return CapacityGapReport(
        total_relocation_demand=relocation_demand,
        total_gross_capacity=total_gross,
        total_committed_population=total_committed,
        total_available_capacity=total_avail,
        status=status,
        headroom_or_gap=headroom_or_gap,
        action_required=action,
        sites_included=sites_summary,
        source="NBC 2016 Table 3 / SDMA Registry",
        vintage="NBC 2016 / ASDMA 2026",
        confidence="HIGH" if len(candidate_sites) > 0 else "MEDIUM",
        provenance_details=provenance_details,
    )

