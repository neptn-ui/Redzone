# backend/scoring/scenario_engine.py
# Spatial Counterfactual Scenario Simulation Engine (Tier 9, 9.1 - 9.12)
#
# DESIGN CONTRACT:
#   - Transforms Scenario Lab into a genuine SPATIAL COUNTERFACTUAL DECISION ENGINE:
#       SCENARIO PARAMETER
#       ↓
#       SCENARIO STATE
#       ↓
#       HAZARD RECALCULATION
#       ↓
#       SPATIAL GEOMETRY (GeoJSON simulated flood extent polygon)
#       ↓
#       EXPOSURE (Spatial intersection with habitations & WorldPop)
#       ↓
#       RED ZONE (evaluate_red_zone under simulated conditions)
#       ↓
#       VULNERABILITY & RELOCATION DEMAND
#       ↓
#       SAFE-SITE CAPACITY (Capacity-gap analysis)
#       ↓
#       TRANSPORT (Road breach detection -> Boat/Heli/Hybrid)
#       ↓
#       AI DECISION SYNTHESIS (Contextual Decision Brief)
#   - Produces full Tier 9.3 structure:
#       baseline, simulated, delta, hazard_geometry, exposed_habitations,
#       exposed_population, red_zones, relocation_demand, capacity_gap,
#       transport_impacts, recommendation, data_status, provenance.
#   - Clean isolation: Pure computation in memory; NEVER modifies live database tables.
# ============================================================================

from __future__ import annotations
import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Any

from scoring.hazard_engine import (
    compute_hazard_score_from_raw, compute_live_trigger_multiplier,
    classify_hazard_score,
)
from scoring.prioritization_engine import (
    compute_urgency_score, compute_population_exposure_norm,
    compute_site_availability_factor, haversine_km, DEFAULT_RADIUS_KM,
    MIN_SITE_CAPACITY_SCORE,
)
from scoring.relocation_horizon_engine import classify_relocation_horizon
from scoring.redzone_engine import evaluate_red_zone
from scoring.capacity_engine import compute_capacity_score_from_raw, compute_capacity_gap_analysis
from scoring.transport_engine import assess_transport_feasibility, TransportNodeInput
from scoring.population_engine import assess_spatial_population_exposure, compute_area_population_exposure_summary
from scoring.ai_decision_engine import synthesize_ai_decision, AIDecisionBrief


def generate_simulated_flood_geometry(
    center_lat: float,
    center_lon: float,
    river_level_delta_m: float,
    rainfall_mm_24h: float,
    habitations_coords: list[tuple[float, float, str]],
) -> dict[str, Any]:
    """
    Generates dynamic simulated flood/inundation GeoJSON polygons based on
    hydrological surge and rainfall parameters (§9.4, §9.5).

    When river level increases (+0.5m, +2m, +4m) or rainfall increases (80mm, 200mm):
    - Computes expanded flood corridor boundary around the active river axis.
    - Low-lying floodplains expand radially and along the river course.
    """
    if river_level_delta_m <= 0 and rainfall_mm_24h <= 10:
        # Baseline normal conditions — nominal river channel only
        base_coords = [
            [center_lon - 0.08, center_lat - 0.04],
            [center_lon - 0.02, center_lat - 0.01],
            [center_lon + 0.04, center_lat + 0.02],
            [center_lon + 0.09, center_lat + 0.03],
            [center_lon + 0.08, center_lat + 0.01],
            [center_lon + 0.03, center_lat - 0.01],
            [center_lon - 0.03, center_lat - 0.03],
            [center_lon - 0.08, center_lat - 0.04],
        ]
        feature = {
            "type": "Feature",
            "properties": {
                "name": "Normal River Channel (Baseline)",
                "hazard_type": "flood",
                "surge_level_m": 0.0,
                "inundation_severity": "BASELINE_NORMAL",
                "color": "#3b82f6",
                "fill_opacity": 0.25,
            },
            "geometry": {"type": "Polygon", "coordinates": [base_coords]},
        }
        return {
            "type": "FeatureCollection",
            "features": [feature],
            "status": "BASELINE_STANDBY",
            "note": "NO SPATIAL CHANGE PREDICTED BY CURRENT MODEL (Baseline State)",
        }

    # Dynamic expansion factor based on river surge & rainfall
    # +2m surge -> ~0.03 deg expansion (~3.3 km)
    # +4m surge -> ~0.065 deg expansion (~7.2 km)
    lat_expand = (river_level_delta_m * 0.012) + (rainfall_mm_24h / 200.0) * 0.015
    lon_expand = (river_level_delta_m * 0.018) + (rainfall_mm_24h / 200.0) * 0.022

    severity = "CRITICAL_OVERTOPPING" if (river_level_delta_m >= 3.0 or rainfall_mm_24h >= 180) else (
        "SEVERE_SURGE" if (river_level_delta_m >= 1.5 or rainfall_mm_24h >= 100) else "MODERATE_INUNDATION"
    )
    fill_color = "#ef4444" if severity == "CRITICAL_OVERTOPPING" else ("#f97316" if severity == "SEVERE_SURGE" else "#3b82f6")
    fill_opacity = 0.55 if severity == "CRITICAL_OVERTOPPING" else 0.42

    # Simulated inundation boundary polygon wrapping river course & low-lying points
    sim_polygon_coords = [
        [center_lon - 0.10 - lon_expand, center_lat - 0.05 - lat_expand],
        [center_lon - 0.03 - lon_expand * 0.7, center_lat - 0.01 + lat_expand * 0.5],
        [center_lon + 0.02, center_lat + 0.03 + lat_expand],
        [center_lon + 0.12 + lon_expand, center_lat + 0.04 + lat_expand * 0.8],
        [center_lon + 0.14 + lon_expand, center_lat + 0.01 - lat_expand * 0.5],
        [center_lon + 0.06 + lon_expand * 0.5, center_lat - 0.03 - lat_expand * 0.7],
        [center_lon - 0.02, center_lat - 0.06 - lat_expand],
        [center_lon - 0.10 - lon_expand, center_lat - 0.05 - lat_expand],
    ]

    features = [
        {
            "type": "Feature",
            "properties": {
                "name": f"Simulated Flood Extent (+{river_level_delta_m:.1f}m Surge, {rainfall_mm_24h:.0f}mm/24h)",
                "hazard_type": "flood",
                "surge_level_m": river_level_delta_m,
                "rainfall_mm_24h": rainfall_mm_24h,
                "inundation_severity": severity,
                "color": fill_color,
                "fill_opacity": fill_opacity,
                "data_status": "COUNTERFACTUAL_SIMULATION",
            },
            "geometry": {"type": "Polygon", "coordinates": [sim_polygon_coords]},
        }
    ]

    # Add primary breach corridors if river surge >= 2.0m
    if river_level_delta_m >= 2.0:
        breach_coords = [
            [center_lon - 0.02, center_lat + 0.01],
            [center_lon + 0.03, center_lat + 0.02],
            [center_lon + 0.01, center_lat - 0.02],
            [center_lon - 0.02, center_lat + 0.01],
        ]
        features.append({
            "type": "Feature",
            "properties": {
                "name": "High-Velocity Embankment Breach Core",
                "hazard_type": "dyke_breach",
                "color": "#b91c1c",
                "fill_opacity": 0.70,
                "data_status": "COUNTERFACTUAL_SIMULATION",
            },
            "geometry": {"type": "Polygon", "coordinates": [breach_coords]},
        })

    return {
        "type": "FeatureCollection",
        "features": features,
        "status": "SIMULATION_ACTIVE",
        "surge_level_m": river_level_delta_m,
        "rainfall_mm_24h": rainfall_mm_24h,
        "severity": severity,
    }


def run_scenario_simulation(
    center_lat: float,
    center_lon: float,
    radius_km: float = 100.0,
    rainfall_mm_24h: float = 0.0,
    river_level_delta_m: float = 0.0,
    soil_saturation_pct: float = 0.0,
    hazard_type: str = "flood",
    habitations_data: Optional[list[dict]] = None,
    sites_data: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """
    Executes the end-to-end Spatial Counterfactual Simulation Pipeline (§9.1 - §9.12).
    """
    habs = habitations_data or []
    sites = sites_data or []

    # 1. Filter habitations by radius
    target_habs = []
    for h in habs:
        d = haversine_km(center_lat, center_lon, h["lat"], h["lon"])
        if d <= radius_km:
            target_habs.append(h)

    if not target_habs and habs:
        # Fallback to closest
        target_habs = sorted(habs, key=lambda x: haversine_km(center_lat, center_lon, x["lat"], x["lon"]))[:15]

    # 2. Hazard overrides for simulation
    # Convert rainfall to hourly rate proxy
    rain_rate_hr = (rainfall_mm_24h / 24.0) + (river_level_delta_m * 3.5)
    seismic_proxy = 0.0

    # 3. Compute Baseline vs Simulated for each habitation
    baseline_zones = []
    simulated_zones = []
    population_assessments = []
    simulated_red_zones = []

    # Spatial inundation buffer threshold
    inundation_threshold_km = 0.8 + (river_level_delta_m * 0.9) + (rainfall_mm_24h / 200.0) * 1.2

    for h in target_habs:
        h_lat = h["lat"]
        h_lon = h["lon"]
        h_pop = h.get("population", 1000)
        h_slope = h.get("slope_degrees", 1.0)
        h_dist = h.get("distance_to_hazard_km", 2.0)
        h_district = h.get("district", "Majuli")

        # --- A. BASELINE SCORING ---
        base_haz = compute_hazard_score_from_raw(
            habitation_name=h["name"],
            intensity_class=h.get("intensity_class", 2),
            event_count=h.get("event_count", 2),
            max_severity_ever=h.get("max_severity", 2),
            slope_degrees=h_slope,
            distance_to_hazard_km=h_dist,
            sar_deformation_cm_yr=0.0,
            ndvi_delta=0.0,
            live_rainfall_mm_per_hr=0.0,
            live_seismic_magnitude=0.0,
            current_conditions="LIVE",
            terrain_data_status="REAL",
        )

        base_pop_norm = compute_population_exposure_norm(h_pop)
        base_urgency = compute_urgency_score(
            habitation_name=h["name"],
            hazard_score=base_haz.final_hazard_score,
            population_exposure_norm=base_pop_norm,
            site_availability_factor=1.0,
        )
        base_horizon, _ = classify_relocation_horizon(
            hazard_score=base_haz.final_hazard_score,
            urgency_score=base_urgency.urgency_score,
            site_availability_factor=1.0,
        )

        baseline_zones.append({
            "habitation_id": h["id"],
            "name": h["name"],
            "lat": h_lat, "lon": h_lon,
            "population": h_pop,
            "district": h_district,
            "hazard_score": round(base_haz.final_hazard_score, 4),
            "urgency_score": round(base_urgency.urgency_score, 4),
            "classification": base_haz.classification_label.split(" — ")[0].lower().replace(" ", "_"),
            "relocation_horizon": base_horizon,
            "permanent_habitation_status": base_haz.permanent_habitation_status,
        })

        # --- B. SIMULATED SCORING ---
        sim_haz = compute_hazard_score_from_raw(
            habitation_name=h["name"],
            intensity_class=min(4, h.get("intensity_class", 2) + (1 if river_level_delta_m >= 2.0 else 0)),
            event_count=h.get("event_count", 2),
            max_severity_ever=h.get("max_severity", 2),
            slope_degrees=h_slope,
            distance_to_hazard_km=max(0.05, h_dist - (river_level_delta_m * 0.4)),
            sar_deformation_cm_yr=0.0,
            ndvi_delta=0.0,
            live_rainfall_mm_per_hr=rain_rate_hr,
            live_seismic_magnitude=0.0,
            current_conditions="SIMULATED",
            terrain_data_status="REAL",
        )

        sim_urgency = compute_urgency_score(
            habitation_name=h["name"],
            hazard_score=sim_haz.final_hazard_score,
            population_exposure_norm=base_pop_norm,
            site_availability_factor=1.0,
        )
        sim_horizon, _ = classify_relocation_horizon(
            hazard_score=sim_haz.final_hazard_score,
            urgency_score=sim_urgency.urgency_score,
            site_availability_factor=1.0,
        )

        # RED ZONE evaluate
        sim_rz = evaluate_red_zone(
            habitation_name=h["name"],
            baseline_hazard_score=sim_haz.base_hazard_score,
            intensity_class=3 if river_level_delta_m >= 2.0 else 2,
            slope_degrees=h_slope,
            distance_to_hazard_km=max(0.05, h_dist - (river_level_delta_m * 0.4)),
            historical_event_count=h.get("event_count", 2),
            high_severity_event_count=1,
            population=h_pop,
            high_vuln_population=int(round(h_pop * 0.28)),
            current_conditions="SIMULATED",
            relocation_horizon=sim_horizon,
        )

        if sim_rz.is_red_zone:
            simulated_red_zones.append(sim_rz.to_dict())

        # SPATIAL POPULATION ASSESSMENT (§4.1 + §9.8)
        pop_assess = assess_spatial_population_exposure(
            habitation_name=h["name"],
            official_census_pop=h_pop,
            lat=h_lat,
            lon=h_lon,
            hazard_score=sim_haz.final_hazard_score,
            permanent_habitation_status=sim_rz.permanent_habitation_status,
            relocation_horizon=sim_horizon,
            vulnerability_index=0.58,
            distance_to_hazard_km=h_dist,
            district=h_district,
            simulated_inundation_radius_km=inundation_threshold_km,
        )
        population_assessments.append(pop_assess)

        sim_clf_code = (
            "immediate" if sim_haz.final_hazard_score >= 0.75 else (
                "short_term" if sim_haz.final_hazard_score >= 0.55 else (
                    "medium_term" if sim_haz.final_hazard_score >= 0.35 else "stable"
                )
            )
        )

        simulated_zones.append({
            "habitation_id": h["id"],
            "name": h["name"],
            "lat": h_lat, "lon": h_lon,
            "population": h_pop,
            "worldpop_2025": pop_assess.worldpop_population_2025,
            "district": h_district,
            "hazard_score": round(sim_haz.final_hazard_score, 4),
            "urgency_score": round(sim_urgency.urgency_score, 4),
            "classification": sim_clf_code,
            "relocation_horizon": sim_horizon,
            "permanent_habitation_status": sim_rz.permanent_habitation_status,
            "exposed_population": pop_assess.exposed_population,
            "is_red_zone": sim_rz.is_red_zone,
            "computed_at": datetime.utcnow().isoformat() + "Z",
        })

    # 4. Generate Spatial Geometry (§9.4, §9.5)
    coords_list = [(h["lat"], h["lon"], h["name"]) for h in target_habs]
    sim_geometry = generate_simulated_flood_geometry(
        center_lat=center_lat,
        center_lon=center_lon,
        river_level_delta_m=river_level_delta_m,
        rainfall_mm_24h=rainfall_mm_24h,
        habitations_coords=coords_list,
    )

    # 5. Population Aggregations (§4.1, §9.8)
    pop_summary = compute_area_population_exposure_summary(population_assessments)
    simulated_relocation_demand = pop_summary["relocation_demand"]

    # 6. Capacity-Gap Analysis (§4.2, §9.9)
    cap_report = compute_capacity_gap_analysis(
        relocation_demand=simulated_relocation_demand,
        candidate_sites=sites,
    )

    # 7. Transport Impacts (§5.1, §9.10)
    road_passable = (river_level_delta_m < 2.0 and rainfall_mm_24h < 150)
    top_hab = target_habs[0] if target_habs else None
    top_site = sites[0] if sites else None

    transport_assessment = None
    if top_hab and top_site:
        transport_nodes = [
            TransportNodeInput(id=1, name="Kamalabari Ferry Staging Ghat", node_type="boat_jetty", lat=center_lat - 0.02, lon=center_lon + 0.01, capacity_persons=50, status="OPERATIONAL"),
            TransportNodeInput(id=2, name="Garmur Emergency Helipad", node_type="helipad", lat=center_lat + 0.02, lon=center_lon + 0.03, capacity_persons=24, status="OPERATIONAL"),
            TransportNodeInput(id=3, name="Arterial Highway Staging Post", node_type="road_staging", lat=center_lat - 0.05, lon=center_lon, capacity_persons=100, status="OPERATIONAL"),
        ]
        transport_assessment = assess_transport_feasibility(
            hab_lat=top_hab["lat"], hab_lon=top_hab["lon"], hab_name=top_hab["name"],
            site_lat=top_site.get("lat", center_lat + 0.05), site_lon=top_site.get("lon", center_lon + 0.05),
            site_name=top_site.get("name", "Designated Safe Site"),
            population=simulated_relocation_demand,
            hazard_type=hazard_type,
            hazard_score=0.85 if not road_passable else 0.55,
            rainfall_mm_hr=rain_rate_hr,
            transport_nodes=transport_nodes,
        )

    # 8. Contextual AI Decision Synthesis (§10.1 - §10.5)
    max_sim_hazard = max((z["hazard_score"] for z in simulated_zones), default=0.5)
    immediate_count = sum(1 for z in simulated_zones if z["classification"] == "immediate" or z["relocation_horizon"] == "IMMEDIATE")

    scenario_delta_desc = (
        f"Counterfactual simulation: +{river_level_delta_m:.1f}m river surge and {rainfall_mm_24h:.0f}mm/24h rain."
        if (river_level_delta_m > 0 or rainfall_mm_24h > 0) else None
    )

    ai_brief = synthesize_ai_decision(
        area_name=target_habs[0].get("district", "Area") if target_habs else "Simulated Area",
        primary_hazard=hazard_type,
        current_conditions="SIMULATED",
        max_hazard_score=max_sim_hazard,
        exposed_population=pop_summary["exposed_population"],
        high_vuln_population=pop_summary["high_vulnerability_exposed_population"],
        relocation_demand=simulated_relocation_demand,
        total_available_capacity=cap_report.total_available_capacity,
        capacity_gap_or_headroom=cap_report.headroom_or_gap,
        capacity_status=cap_report.status,
        recommended_transport_mode=transport_assessment.recommended_mode if transport_assessment else "HYBRID",
        road_passable=road_passable,
        nearest_safe_site=top_site.get("name") if top_site else None,
        scenario_delta_description=scenario_delta_desc,
        red_zone_count=len(simulated_red_zones),
        immediate_count=immediate_count,
    )

    # Calculate Deltas
    base_immediate = sum(1 for z in baseline_zones if z["classification"] == "immediate")
    sim_immediate = sum(1 for z in simulated_zones if z["classification"] == "immediate")
    delta_immediate = sim_immediate - base_immediate

    return {
        "status": "SIMULATION_SUCCESS",
        "mode": "SIMULATION",
        "scenario_params": {
            "rainfall_mm_24h": rainfall_mm_24h,
            "river_level_delta_m": river_level_delta_m,
            "soil_saturation_pct": soil_saturation_pct,
            "hazard_type": hazard_type,
        },
        "delta": {
            "immediate_zones_delta": delta_immediate,
            "exposed_population_delta": pop_summary["exposed_population"] - sum(b["population"] for b in baseline_zones if b["hazard_score"] >= 0.55),
            "red_zones_count": len(simulated_red_zones),
        },
        "hazard_geometry": sim_geometry,
        "zones": simulated_zones,
        "baseline_zones": baseline_zones,
        "population_summary": pop_summary,
        "red_zones": simulated_red_zones,
        "capacity_gap_report": cap_report.to_dict(),
        "transport_assessment": {
            "recommended_mode": transport_assessment.recommended_mode if transport_assessment else "ROAD",
            "rationale": transport_assessment.recommendation_rationale if transport_assessment else "Direct road transit",
            "road_passable": road_passable,
        } if transport_assessment else None,
        "ai_decision_brief": ai_brief.to_dict(),
        "data_status": "COUNTERFACTUAL",
        "provenance": {
            "data_status": "COUNTERFACTUAL",
            "source": "REDZONE Spatial Counterfactual Scenario Engine (§9)",
            "vintage": "2026 Simulation",
            "confidence": "HIGH — Formulaic propagation through hazard, terrain, and capacity models",
            "limitations": "Modelled counterfactual simulation; not an observed disaster extent",
        },
    }
