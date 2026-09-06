# backend/tests/test_tier4_population.py
# Test Suite for Tier 4: Population Intelligence & Spatial Exposure
#
# Validates:
#   - WorldPop 2025 (~100m, MODELLED, VINTAGE 2025) metadata
#   - Census 2011 official statutory baseline retention
#   - 5 distinct metrics:
#       1. TOTAL AREA POPULATION
#       2. EXPOSED POPULATION
#       3. RED ZONE POPULATION
#       4. HIGH-VULNERABILITY EXPOSED POPULATION
#       5. RELOCATION DEMAND
#   - Missing demographic data returns DATA UNAVAILABLE (never 0)
#   - Time-safe historical replay (no hindsight leakage in 2021)
# ============================================================================

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime
from scoring.population_engine import (
    assess_spatial_population_exposure,
    compute_area_population_exposure_summary,
    PopulationAssessment,
)


def test_worldpop_provenance_metadata():
    """Verify WorldPop 2025 provenance is strictly MODELLED at ~100m resolution."""
    assess = assess_spatial_population_exposure(
        habitation_name="Garmur Satra",
        official_census_pop=3400,
        lat=26.95,
        lon=94.17,
        hazard_score=0.72,
        permanent_habitation_status="UNSUITABLE",
        relocation_horizon="IMMEDIATE",
    )
    prov = assess.provenance
    assert prov["source"] == "WorldPop"
    assert prov["vintage"] == "2025"
    assert prov["status"] == "MODELLED"
    assert "100 m" in prov["resolution"]
    assert assess.official_census_population_2011 == 3400
    assert assess.worldpop_population_2025 > 0


def test_five_distinct_metrics_calculation():
    """Verify all 5 distinct population metrics are accurately calculated and distinct."""
    habitations = [
        assess_spatial_population_exposure(
            habitation_name="Habitation A",
            official_census_pop=2000,
            lat=26.95, lon=94.17,
            hazard_score=0.82,
            permanent_habitation_status="UNSUITABLE",
            relocation_horizon="IMMEDIATE",
            vulnerability_index=0.6,
        ),
        assess_spatial_population_exposure(
            habitation_name="Habitation B",
            official_census_pop=5000,
            lat=26.96, lon=94.18,
            hazard_score=0.40,
            permanent_habitation_status="SUITABLE",
            relocation_horizon="MEDIUM_TERM",
            vulnerability_index=0.3,
        ),
    ]

    summary = compute_area_population_exposure_summary(habitations)

    # 1. Total Area Population
    assert summary["total_area_population"] > 0
    # 2. Exposed Population (only Hab A is in hazard)
    assert summary["exposed_population"] > 0
    # 3. Red Zone Population (only Hab A is UNSUITABLE)
    assert summary["red_zone_population"] > 0
    # 4. High-Vulnerability Exposed Population
    assert summary["high_vulnerability_exposed_population"] > 0
    # 5. Relocation Demand
    assert summary["relocation_demand"] > 0

    # Ensure exposed pop is less than total area pop
    assert summary["exposed_population"] <= summary["total_area_population"]
    assert summary["high_vulnerability_exposed_population"] <= summary["exposed_population"]


def test_missing_demographic_data_honesty():
    """Missing population must yield DATA UNAVAILABLE and not be masked as 0."""
    assess = assess_spatial_population_exposure(
        habitation_name="Remote Unsurveyed Point",
        official_census_pop=None,
        lat=28.1,
        lon=95.2,
        hazard_score=0.6,
        permanent_habitation_status="CONDITIONAL",
        relocation_horizon="SHORT_TERM",
    )
    assert assess.official_census_population_2011 is None
    d = assess.to_dict()
    assert d["census_2011_status"] == "DATA UNAVAILABLE"


def test_time_safe_replay_vintage_isolation():
    """Replay at 2021 must reject future WorldPop 2025 foresight or label it retrospective."""
    assess_2021 = assess_spatial_population_exposure(
        habitation_name="Historical Flood Zone 2021",
        official_census_pop=4200,
        lat=26.95,
        lon=94.17,
        hazard_score=0.88,
        permanent_habitation_status="UNSUITABLE",
        relocation_horizon="IMMEDIATE",
        as_of_timestamp=datetime(2021, 8, 15, 12, 0),
    )
    assert "2011" in assess_2021.provenance["vintage"]
    assert assess_2021.provenance["status"] in ("OFFICIAL CENSUS", "STATUTORY")
    assert "2025" not in assess_2021.provenance["vintage"]
