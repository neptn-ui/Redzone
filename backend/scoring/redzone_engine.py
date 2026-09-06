# backend/scoring/redzone_engine.py
# Pure-function RED ZONE Engine (Tier 2)
#
# DESIGN CONTRACT (§2.1 - §2.4):
#   - Pipeline: Hazard exposure + Historical recurrence + Long-term hazard pattern
#     + Terrain -> RED ZONE ENGINE -> Permanent habitation status.
#   - Two independent fields always present:
#       current_conditions: LIVE | RECENT | HISTORICAL
#       permanent_habitation_status: SUITABLE | CONDITIONAL | UNSUITABLE | UNKNOWN
#     Today's quiet weather must never automatically flip a chronically unsafe
#     location to SUITABLE.
#   - Vulnerability informs priority and relocation sequencing, NOT physical classification.
#   - Produces first-class RedZoneOutput for every habitation / zone.
# ============================================================================

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Any


@dataclass
class RedZoneOutput:
    habitation_name: str
    permanent_habitation_status: str      # SUITABLE | CONDITIONAL | UNSUITABLE | UNKNOWN
    current_conditions: str               # LIVE | RECENT | HISTORICAL
    primary_hazard: str
    contributing_hazards: list[str]
    affected_population: int
    high_vulnerability_population: int
    relocation_horizon: str               # IMMEDIATE | SHORT_TERM | MEDIUM_TERM | MONITOR
    evidence: list[str]
    confidence: str                       # HIGH | MEDIUM | LOW
    data_status: str                      # OBSERVED | DERIVED | APPROXIMATED | MODELLED | UNAVAILABLE
    recommendation: str
    rationale: str
    is_red_zone: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "habitation_name": self.habitation_name,
            "status": self.permanent_habitation_status,
            "permanent_habitation_status": self.permanent_habitation_status,
            "current_conditions": self.current_conditions,
            "primary_hazard": self.primary_hazard,
            "contributing_hazards": self.contributing_hazards,
            "affected_population": self.affected_population,
            "high_vulnerability_population": self.high_vulnerability_population,
            "relocation_horizon": self.relocation_horizon,
            "evidence": self.evidence,
            "confidence": self.confidence,
            "data_status": self.data_status,
            "recommendation": self.recommendation,
            "rationale": self.rationale,
            "is_red_zone": self.is_red_zone,
        }


def evaluate_red_zone(
    habitation_name: str,
    baseline_hazard_score: float,
    intensity_class: int = 1,
    slope_degrees: float = 0.0,
    distance_to_hazard_km: float = 10.0,
    historical_event_count: int = 0,
    high_severity_event_count: int = 0,
    soil_erosion_rate: Optional[float] = None,
    sar_deformation_cm_yr: Optional[float] = None,
    population: int = 0,
    high_vuln_population: int = 0,
    current_conditions: str = "LIVE",
    terrain_data_status: str = "REAL",
    relocation_horizon: Optional[str] = None,
    active_landslide_zone: bool = False,
) -> RedZoneOutput:
    """
    Dedicated pure function classifying permanent habitation suitability and generating
    a first-class Red Zone decision output.
    
    CRITICAL RULE (§2.2):
    Evaluates permanent physical unsuitability based on long-term baseline hazard,
    topography, soil erosion, and historical recurrence.
    Current conditions (quiet weather vs storm) do NOT alter permanent habitation status.
    
    CRITICAL RULE (§2.3):
    Vulnerability affects prioritization and relocation demand, NOT the physical
    classification itself.
    """
    evidence: list[str] = []
    contributing: list[str] = []

    # 1. Evidence collection
    if historical_event_count > 0:
        evidence.append(f"{historical_event_count} recorded disaster event(s) in catalog")
    if high_severity_event_count > 0:
        evidence.append(f"{high_severity_event_count} severe/critical disaster recurrence(s)")
    if slope_degrees >= 25.0:
        evidence.append(f"Steep unstable slope ({slope_degrees:.1f}°)")
        contributing.append("Slope Instability")
    if distance_to_hazard_km <= 2.0:
        evidence.append(f"Critical proximity to active hazard front ({distance_to_hazard_km:.2f} km)")
        contributing.append("Riverbank / Fault Proximity")
    if soil_erosion_rate and soil_erosion_rate >= 10.0:
        evidence.append(f"Severe soil/bank erosion ({soil_erosion_rate:.1f} m/yr)")
        contributing.append("Severe Soil Erosion")
    if sar_deformation_cm_yr and abs(sar_deformation_cm_yr) >= 2.0:
        evidence.append(f"Sentinel-1 ground deformation ({sar_deformation_cm_yr:.1f} cm/yr)")
        contributing.append("Ground Subsidence")
    if active_landslide_zone:
        evidence.append("Active mapped landslide corridor")
        contributing.append("Active Landslide")

    # Primary hazard determination
    if slope_degrees >= 20.0 or active_landslide_zone:
        primary_hazard = "Landslide / Slope Failure"
    elif distance_to_hazard_km <= 3.0 or (soil_erosion_rate and soil_erosion_rate >= 5.0):
        primary_hazard = "Riverine Inundation & Bank Erosion"
    elif baseline_hazard_score >= 0.5:
        primary_hazard = "Multi-Hazard Flash Flooding"
    else:
        primary_hazard = "Low Baseline Hazard"

    # 2. Permanent Habitation Classification (§2.1, §2.2)
    # Check for missing data first
    if terrain_data_status == "MISSING" and historical_event_count == 0 and baseline_hazard_score < 0.2:
        status = "UNKNOWN"
        rationale = "Insufficient terrain and historical disaster records to determine permanent suitability."
        recommendation = "Commission geological survey and terrain LiDAR mapping before permanent development."
        confidence = "LOW"
        data_status = "UNAVAILABLE"
    elif (
        baseline_hazard_score >= 0.65
        or (historical_event_count >= 3 and high_severity_event_count >= 2)
        or slope_degrees >= 30.0
        or (soil_erosion_rate is not None and soil_erosion_rate >= 20.0)
        or active_landslide_zone
    ):
        status = "UNSUITABLE"
        rationale = "Unsuitable for permanent human habitation due to chronic disaster recurrence, active geological displacement, or extreme terrain exposure."
        recommendation = "Designate as RED ZONE (No-Habitation Zone). Prioritize structured relocation of remaining households to planned safe sites."
        confidence = "HIGH" if terrain_data_status == "REAL" else "MEDIUM"
        data_status = "OBSERVED" if historical_event_count >= 2 else "DERIVED"
    elif (
        baseline_hazard_score >= 0.40
        or historical_event_count >= 1
        or slope_degrees >= 15.0
        or distance_to_hazard_km <= 2.5
        or (soil_erosion_rate is not None and soil_erosion_rate >= 5.0)
    ):
        status = "CONDITIONAL"
        rationale = "Conditional permanent habitation. Recurring hazard zone requiring structural flood protection, elevated plinths, and seasonal evacuation readiness."
        recommendation = "Conditional occupancy permitted with mandatory early warning integration and emergency evacuation pre-positioning."
        confidence = "HIGH" if terrain_data_status == "REAL" else "MEDIUM"
        data_status = "DERIVED"
    else:
        status = "SUITABLE"
        rationale = "Suitable for permanent habitation under baseline geological, hydrological, and environmental conditions."
        recommendation = "Maintain standard civil safety codes and periodic catchment monitoring."
        confidence = "HIGH" if terrain_data_status == "REAL" else "MEDIUM"
        data_status = "DERIVED"

    # 3. Horizon synchronization
    if relocation_horizon:
        horizon = relocation_horizon
    else:
        if status == "UNSUITABLE":
            horizon = "IMMEDIATE" if baseline_hazard_score >= 0.75 else "SHORT_TERM"
        elif status == "CONDITIONAL":
            horizon = "SHORT_TERM" if baseline_hazard_score >= 0.55 else "MEDIUM_TERM"
        else:
            horizon = "MONITOR"

    is_red_zone = (status == "UNSUITABLE") or (status == "CONDITIONAL" and horizon in ("IMMEDIATE", "SHORT_TERM"))

    return RedZoneOutput(
        habitation_name=habitation_name,
        permanent_habitation_status=status,
        current_conditions=current_conditions,
        primary_hazard=primary_hazard,
        contributing_hazards=contributing,
        affected_population=population,
        high_vulnerability_population=high_vuln_population,
        relocation_horizon=horizon,
        evidence=evidence,
        confidence=confidence,
        data_status=data_status,
        recommendation=recommendation,
        rationale=rationale,
        is_red_zone=is_red_zone,
    )
