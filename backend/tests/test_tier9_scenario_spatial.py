# backend/tests/test_tier9_scenario_spatial.py
# Test Suite for Tier 9: Scenario Lab Spatial Propagation
#
# Validates:
#   - Dynamic GeoJSON simulated flood geometry generation (§9.4, §9.5)
#   - Polygon expansion with river surge (+2m, +4m) and rainfall (80mm, 200mm)
#   - Dyke breach corridor generation on critical surge
#   - run_scenario_simulation end-to-end integration:
#       * Hazard recalculation
#       * Spatial GeoJSON output
#       * Population exposure
#       * Capacity-gap analysis
#       * Transport feasibility
#       * AI Decision Brief
#   - API endpoint POST /api/scenario/what-if returning complete Tier 9.3 payload
# ============================================================================

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from main import app
from scoring.scenario_engine import generate_simulated_flood_geometry, run_scenario_simulation

client = TestClient(app)


def test_baseline_scenario_geometry():
    """Baseline conditions (surge=0, rain=0) return nominal baseline channel geometry."""
    geom = generate_simulated_flood_geometry(
        center_lat=26.95,
        center_lon=94.17,
        river_level_delta_m=0.0,
        rainfall_mm_24h=0.0,
        habitations_coords=[(26.95, 94.17, "Garmur")],
    )
    assert geom["type"] == "FeatureCollection"
    assert len(geom["features"]) >= 1
    assert geom["status"] == "BASELINE_STANDBY"


def test_spatial_polygon_expansion_on_surge():
    """Higher river surge must generate expanded inundation polygon and critical severity."""
    geom_2m = generate_simulated_flood_geometry(
        center_lat=26.95,
        center_lon=94.17,
        river_level_delta_m=2.0,
        rainfall_mm_24h=120.0,
        habitations_coords=[(26.95, 94.17, "Garmur")],
    )
    assert geom_2m["status"] == "SIMULATION_ACTIVE"
    assert geom_2m["severity"] in ("SEVERE_SURGE", "CRITICAL_OVERTOPPING")
    # High surge generates dyke breach corridor feature
    assert len(geom_2m["features"]) >= 2
    breach_feat = [f for f in geom_2m["features"] if f["properties"].get("hazard_type") == "dyke_breach"]
    assert len(breach_feat) == 1

    geom_4m = generate_simulated_flood_geometry(
        center_lat=26.95,
        center_lon=94.17,
        river_level_delta_m=4.0,
        rainfall_mm_24h=200.0,
        habitations_coords=[(26.95, 94.17, "Garmur")],
    )
    assert geom_4m["severity"] == "CRITICAL_OVERTOPPING"
    assert geom_4m["features"][0]["properties"]["color"] == "#ef4444"


def test_run_scenario_simulation_pipeline():
    """Verifies the pure-function scenario simulation pipeline."""
    sample_habs = [
        {"id": 1, "name": "Garmur Satra", "lat": 26.95, "lon": 94.17, "population": 3400, "district": "Majuli", "slope_degrees": 1.2, "distance_to_hazard_km": 0.4},
        {"id": 2, "name": "Kamalabari Town", "lat": 26.91, "lon": 94.15, "population": 4800, "district": "Majuli", "slope_degrees": 1.8, "distance_to_hazard_km": 1.2},
    ]
    sample_sites = [
        {"id": 101, "name": "Jorhat Relief Camp", "lat": 26.75, "lon": 94.22, "available_capacity": 5000, "capacity_score": 0.85},
    ]

    result = run_scenario_simulation(
        center_lat=26.95,
        center_lon=94.17,
        radius_km=50.0,
        rainfall_mm_24h=150.0,
        river_level_delta_m=2.5,
        habitations_data=sample_habs,
        sites_data=sample_sites,
    )

    assert result["status"] == "SIMULATION_SUCCESS"
    assert result["mode"] == "SIMULATION"
    assert "hazard_geometry" in result
    assert result["hazard_geometry"]["type"] == "FeatureCollection"
    assert len(result["zones"]) == 2
    assert "population_summary" in result
    assert result["population_summary"]["exposed_population"] > 0
    assert "capacity_gap_report" in result
    assert "transport_assessment" in result
    assert "ai_decision_brief" in result
    assert result["provenance"]["data_status"] == "COUNTERFACTUAL"


def test_scenario_api_endpoint():
    """POST /api/scenario/what-if returns complete Tier 9.3 structure."""
    resp = client.post("/api/scenario/what-if", json={
        "lat": 26.95,
        "lon": 94.17,
        "radius_km": 50.0,
        "rainfall_mm_24h": 120.0,
        "river_level_delta_m": 2.0,
        "soil_saturation_pct": 80.0,
        "hazard_type": "flood",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "hazard_geometry" in data
    assert "zones" in data
    assert "population_summary" in data
    assert "capacity_gap_report" in data
    assert "transport_assessment" in data
    assert "ai_decision_brief" in data
    assert "provenance" in data
    assert data["provenance"]["data_status"] == "COUNTERFACTUAL"
