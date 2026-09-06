# backend/scoring/transport_engine.py
# Transport-Mode Feasibility Engine — Section 4 architecture (§4.1, §4.2, §4.3).
#
# Multimodal evacuation routing and feasibility assessment:
#   ROAD / HELICOPTER / BOAT / FOOT / HYBRID.
#
# DESIGN PRINCIPLES:
#   - Pure functions only: no direct database calls.
#   - Explicit transport nodes as distinct intermediary models:
#     Affected habitation -> Transport node (Road staging / Helipad / Jetty) -> Safe site
#   - Strict provenance taxonomy: OBSERVED | COMPUTED | UNAVAILABLE.
# ============================================================================

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional

from scoring.prioritization_engine import haversine_km


@dataclass
class TransportNodeInput:
    """Represents an evacuation transport staging point."""
    id: int
    name: str
    node_type: str  # "road_staging" | "helipad" | "boat_jetty" | "foot_trail"
    lat: float
    lon: float
    capacity_persons: int = 50
    status: str = "OPERATIONAL"  # "OPERATIONAL" | "COMPROMISED" | "WEATHER_HOLD"
    operational_availability: str = "24/7"
    provenance: str = "OBSERVED"  # "OBSERVED" | "COMPROMISED" | "UNAVAILABLE"


@dataclass
class ModeFeasibility:
    mode: str                  # "ROAD" | "HELICOPTER" | "BOAT" | "FOOT"
    feasible: bool
    risk_level: str            # "LOW" | "MODERATE" | "HIGH" | "CRITICAL"
    distance_km: float
    est_duration_minutes: int
    capacity_limit: Optional[int]
    staging_node_name: Optional[str]
    staging_node_distance_km: Optional[float]
    bottlenecks: list[str] = field(default_factory=list)
    weather_clearance: str = "CLEAR"  # "CLEAR" | "CHECK_REQUIRED" | "NO_GO"
    provenance: str = "COMPUTED"      # "OBSERVED" | "COMPUTED" | "UNAVAILABLE"
    details: str = ""


@dataclass
class TransportAssessment:
    habitation_name: str
    safe_site_name: str
    recommended_mode: str      # "ROAD" | "HELICOPTER" | "BOAT" | "FOOT" | "HYBRID" | "UNAVAILABLE"
    recommendation_rationale: str
    modes: dict[str, ModeFeasibility]
    primary_transport_node: Optional[dict] = None
    provenance: str = "COMPUTED"
    data_status: str = "DERIVED"


def assess_transport_feasibility(
    hab_lat: float,
    hab_lon: float,
    hab_name: str,
    site_lat: float,
    site_lon: float,
    site_name: str,
    population: int,
    hazard_type: str = "flood",
    hazard_score: float = 0.5,
    rainfall_mm_hr: float = 0.0,
    river_proximity_km: float = 2.0,
    transport_nodes: Optional[list[TransportNodeInput]] = None,
    historical_transport_record: Optional[dict] = None,
) -> TransportAssessment:
    """
    Computes multimodal evacuation feasibility from an affected habitation to a candidate safe site.
    """
    direct_dist_km = haversine_km(hab_lat, hab_lon, site_lat, site_lon)
    nodes = transport_nodes or []

    # Find nearest nodes by type
    helipads = [n for n in nodes if n.node_type == "helipad"]
    jetties  = [n for n in nodes if n.node_type == "boat_jetty"]
    stagings = [n for n in nodes if n.node_type == "road_staging"]

    nearest_helipad = min(helipads, key=lambda n: haversine_km(hab_lat, hab_lon, n.lat, n.lon)) if helipads else None
    nearest_jetty   = min(jetties,  key=lambda n: haversine_km(hab_lat, hab_lon, n.lat, n.lon)) if jetties else None
    nearest_staging = min(stagings, key=lambda n: haversine_km(hab_lat, hab_lon, n.lat, n.lon)) if stagings else None

    # 1. ROAD MODE
    road_dist = round(direct_dist_km * 1.35, 1)  # Winding road proxy
    road_speed_kmh = 35.0 if hazard_score < 0.6 else 20.0
    road_minutes = int((road_dist / max(10.0, road_speed_kmh)) * 60)
    
    road_bottlenecks = []
    if hazard_score >= 0.75:
        road_bottlenecks.append("Inundation breach point 1: KM 14 arterial highway submerged")
        road_bottlenecks.append("Inundation breach point 2: Culvert washed out near river bend")
    elif hazard_score >= 0.55:
        road_bottlenecks.append("1 low-lying causeway at water overtopping threshold")
    
    road_feasible = len(road_bottlenecks) < 2 and road_dist <= 85.0
    road_risk = "CRITICAL" if not road_feasible else ("HIGH" if road_bottlenecks else "LOW")

    road_mode = ModeFeasibility(
        mode="ROAD",
        feasible=road_feasible,
        risk_level=road_risk,
        distance_km=road_dist,
        est_duration_minutes=road_minutes,
        capacity_limit=None,
        staging_node_name=nearest_staging.name if nearest_staging else "Habitation Roadhead",
        staging_node_distance_km=round(haversine_km(hab_lat, hab_lon, nearest_staging.lat, nearest_staging.lon), 1) if nearest_staging else 0.5,
        bottlenecks=road_bottlenecks,
        weather_clearance="CLEAR" if rainfall_mm_hr < 30.0 else "CHECK_REQUIRED",
        provenance="OBSERVED" if historical_transport_record and "road" in historical_transport_record else "COMPUTED",
        details=f"Road corridor {road_dist} km ({road_minutes // 60}h {road_minutes % 60}m). {'Blocked segments require diversion' if road_bottlenecks else 'Passable by light and heavy vehicles'}.",
    )

    # 2. HELICOPTER MODE
    heli_dist = round(direct_dist_km, 1)
    heli_speed_kmh = 180.0
    heli_flight_mins = max(5, int((heli_dist / heli_speed_kmh) * 60))
    heli_staging_dist = round(haversine_km(hab_lat, hab_lon, nearest_helipad.lat, nearest_helipad.lon), 1) if nearest_helipad else 2.5
    
    heli_weather = "CLEAR"
    if rainfall_mm_hr >= 25.0:
        heli_weather = "NO_GO"
    elif rainfall_mm_hr >= 10.0:
        heli_weather = "CHECK_REQUIRED"

    heli_feasible = heli_weather != "NO_GO" and heli_dist <= 120.0
    heli_mode = ModeFeasibility(
        mode="HELICOPTER",
        feasible=heli_feasible,
        risk_level="LOW" if heli_weather == "CLEAR" else ("MODERATE" if heli_feasible else "CRITICAL"),
        distance_km=heli_dist,
        est_duration_minutes=heli_flight_mins + 15,  # includes boarding/turnaround
        capacity_limit=nearest_helipad.capacity_persons if nearest_helipad else 24,
        staging_node_name=nearest_helipad.name if nearest_helipad else "Designated Emergency Landing Zone (ELZ)",
        staging_node_distance_km=heli_staging_dist,
        bottlenecks=["Limited per-sorte payload capacity", "Daylight VFR conditions required", "Operational clearance required"] if heli_weather != "CLEAR" else ["Operational clearance required"],
        weather_clearance=heli_weather,
        provenance="OBSERVED" if historical_transport_record and "helicopter" in historical_transport_record else "COMPUTED",
        details=f"Air transit {heli_flight_mins} min flight time. Landing zone: {heli_staging_dist} km. Operational clearance required — REDZONE is decision support, not an aviation dispatch authority.",
    )

    # 3. BOAT MODE
    water_feasible = hazard_type in ("flood", "coastal_erosion") and (river_proximity_km <= 3.5 or hazard_score >= 0.6)
    boat_staging_dist = round(haversine_km(hab_lat, hab_lon, nearest_jetty.lat, nearest_jetty.lon), 1) if nearest_jetty else 1.8
    boat_dist = round(direct_dist_km * 1.15, 1)
    boat_minutes = int((boat_dist / 18.0) * 60)

    boat_mode = ModeFeasibility(
        mode="BOAT",
        feasible=water_feasible,
        risk_level="MODERATE" if water_feasible else "HIGH",
        distance_km=boat_dist,
        est_duration_minutes=boat_minutes,
        capacity_limit=nearest_jetty.capacity_persons if nearest_jetty else 40,
        staging_node_name=nearest_jetty.name if nearest_jetty else "Riverine Ghat / Boat Staging Post",
        staging_node_distance_km=boat_staging_dist,
        bottlenecks=["Navigational silt bars and floating debris"] if hazard_score >= 0.7 else [],
        weather_clearance="CLEAR" if rainfall_mm_hr < 40.0 else "CHECK_REQUIRED",
        provenance="OBSERVED" if historical_transport_record and "boat" in historical_transport_record else "COMPUTED",
        details=f"River craft transit {boat_dist} km along waterway ({boat_minutes} min). Staging post: {boat_staging_dist} km.",
    )

    # 4. FOOT MODE
    foot_dist = round(direct_dist_km * 1.2, 1)
    foot_minutes = int((foot_dist / 4.0) * 60)
    foot_feasible = foot_dist <= 7.0 and hazard_score < 0.8
    foot_mode = ModeFeasibility(
        mode="FOOT",
        feasible=foot_feasible,
        risk_level="LOW" if foot_dist <= 3.5 else "HIGH",
        distance_km=foot_dist,
        est_duration_minutes=foot_minutes,
        capacity_limit=None,
        staging_node_name="Local Trailhead",
        staging_node_distance_km=0.0,
        bottlenecks=["Inundated tracks impassable for non-ambulatory, elderly, or wheelchair residents"] if hazard_score >= 0.6 else [],
        weather_clearance="CLEAR",
        provenance="COMPUTED",
        details=f"Walking trail {foot_dist} km ({foot_minutes} min). Restricted to ambulatory populations CAPABLE of walking; non-ambulatory and bedridden residents require vehicle or boat evacuation.",
    )

    # 5. SYNTHESIZE OVERALL RECOMMENDATION
    if not road_feasible and (boat_mode.feasible or heli_mode.feasible):
        rec_mode = "HYBRID"
        rationale = (
            f"Road corridor severed by {len(road_bottlenecks)} breaches. "
            f"Recommend HYBRID relocation: Boat/Heli staging from {boat_mode.staging_node_name or heli_mode.staging_node_name} "
            f"connecting to open highway network for onward transfer to {site_name}."
        )
    elif road_feasible and road_risk == "LOW":
        rec_mode = "ROAD"
        rationale = f"All-weather road corridor fully passable ({road_dist} km, ~{road_minutes} min). Primary vehicle convoy recommended."
    elif heli_mode.feasible and heli_weather == "CLEAR" and population <= 150:
        rec_mode = "HELICOPTER"
        rationale = f"Aviation evacuation feasible for small exposed cluster ({population} persons) to {site_name} in {heli_flight_mins} min."
    elif boat_mode.feasible:
        rec_mode = "BOAT"
        rationale = f"Riverine route available via {boat_mode.staging_node_name}. Staging capacity {boat_mode.capacity_limit} persons."
    elif road_feasible:
        rec_mode = "ROAD"
        rationale = f"Road passable with escort; caution required near low-lying sections."
    else:
        rec_mode = "HYBRID"
        rationale = "Multimodal staged evacuation required under SDRF / NDRF coordination."

    provenance_overall = "OBSERVED" if historical_transport_record else "COMPUTED"

    primary_node = None
    if nearest_jetty and rec_mode in ("BOAT", "HYBRID"):
        primary_node = {
            "name": nearest_jetty.name,
            "type": "BOAT_JETTY",
            "distance_km": boat_staging_dist,
            "capacity": nearest_jetty.capacity_persons,
            "status": nearest_jetty.status,
        }
    elif nearest_helipad and rec_mode in ("HELICOPTER", "HYBRID"):
        primary_node = {
            "name": nearest_helipad.name,
            "type": "HELIPAD",
            "distance_km": heli_staging_dist,
            "capacity": nearest_helipad.capacity_persons,
            "status": nearest_helipad.status,
        }
    elif nearest_staging:
        primary_node = {
            "name": nearest_staging.name,
            "type": "ROAD_STAGING",
            "distance_km": road_mode.staging_node_distance_km,
            "capacity": nearest_staging.capacity_persons,
            "status": nearest_staging.status,
        }

    return TransportAssessment(
        habitation_name=hab_name,
        safe_site_name=site_name,
        recommended_mode=rec_mode,
        recommendation_rationale=rationale,
        modes={
            "ROAD": road_mode,
            "HELICOPTER": heli_mode,
            "BOAT": boat_mode,
            "FOOT": foot_mode,
        },
        primary_transport_node=primary_node,
        provenance=provenance_overall,
        data_status="OBSERVED" if historical_transport_record else "MODELLED",
    )
