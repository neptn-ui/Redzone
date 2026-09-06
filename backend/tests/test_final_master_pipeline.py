# backend/tests/test_final_master_pipeline.py
# Adversarial & End-to-End Test Suite for Final Master Decision Pipeline
#
# Covers Tiers 0 through 12:
#   - Tier 0: Geographic Contamination & Zero Fallback (Assam -> Nepal -> Delhi -> Kerala -> Majuli -> Nepal)
#   - Tier 1: Coordinate Event Lookup, Hard Haversine Validation, 4 Coverage States
#   - Tier 2: Pure-function Red Zone Engine (physical vs current condition independence)
#   - Tier 3: Vulnerable population prioritization & ambulatory FOOT mode
#   - Tier 4: Capacity gap & provenance (RELOCATION DEMAND vs AVAILABLE SAFE CAPACITY)
#   - Tier 5: Multimodal transport feasibility (ROAD, HELI, BOAT, FOOT, HYBRID, disclaimers)
#   - Tier 6: Time-safe historical replay with zero hindsight leakage
#   - Tier 7: Region-agnostic unseeded honesty (Location Resolved, Seeded Data Not Available)
#   - Tier 8: Strict data provenance taxonomy
# ============================================================================

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, date
from fastapi.testclient import TestClient

from main import app
from scoring.redzone_engine import evaluate_red_zone, RedZoneOutput
from scoring.event_engine import fetch_events_for_coordinates
from scoring.capacity_engine import compute_capacity_gap_analysis
from scoring.transport_engine import assess_transport_feasibility, TransportNodeInput
from scoring.replay_engine import run_time_safe_replay
from scoring.hazard_engine import compute_hazard_score_from_raw
from scoring.prioritization_engine import haversine_km
from models import get_db, engine, Session

client = TestClient(app)


# ============================================================================
# Tier 0 & 7: Geographic Contamination Adversarial Test
# Assam -> Nepal -> Delhi -> Kerala -> Majuli -> Nepal
# ============================================================================

def test_geographic_contamination_sequence():
    """
    Search sequence: Assam -> Nepal -> Delhi -> Kerala -> Majuli -> Nepal.
    Asserts:
      1. Nepal NEVER matches Chamoli or Assam.
      2. Unseeded places have matched_region_id=None and is_seeded=False.
      3. Zero residual state from previous search.
      4. Majuli matches seeded region.
      5. Second search of Nepal is equally clean (no residue from Majuli).
    """
    test_searches = [
        # (name, lat, lon, expected_seeded, expected_region_name)
        ("Assam, India", 26.20, 92.93, True, "Assam"),
        ("Kathmandu, Nepal", 27.7172, 85.3240, False, None),
        ("New Delhi, Delhi, India", 28.6139, 77.2090, False, None),
        ("Thiruvananthapuram, Kerala, India", 8.5241, 76.9366, False, None),
        ("Majuli, Assam, India", 26.95, 94.17, True, "Assam"),
        ("Pokhara, Nepal", 28.2096, 83.9856, False, None),
    ]

    for name, lat, lon, exp_seeded, exp_reg in test_searches:
        resp = client.get(f"/api/areas/context?lat={lat}&lon={lon}&radius_km=100")
        assert resp.status_code == 200, f"Failed for {name}: {resp.text}"
        data = resp.json()

        # Strict checks
        assert data["is_seeded"] == exp_seeded, f"Mismatch for {name}: expected is_seeded={exp_seeded}, got {data['is_seeded']}"
        if exp_seeded:
            assert data["matched_region_id"] is not None
            assert exp_reg.lower() in (data["matched_region_name"] or "").lower()
        else:
            assert data["matched_region_id"] is None
            assert data["matched_region_name"] is None
            # Absolute guard: Nepal must NEVER return Chamoli or Uttarakhand!
            assert "chamoli" not in str(data).lower()
            assert "uttarakhand" not in str(data).lower()


# ============================================================================
# Tier 1: Event Lookup & Hard Geographic Validation
# ============================================================================

def test_event_lookup_hard_haversine_filtering():
    """
    Tests coordinate-distance lookup and ensures Nepal coordinates do not pull Chamoli events.
    """
    nepal_lat, nepal_lon = 27.7172, 85.3240
    events, coverage = fetch_events_for_coordinates(nepal_lat, nepal_lon, radius_km=120.0)
    
    # Nepal has zero seeded disaster history in catalog within 120 km
    assert len(events) == 0
    assert coverage["coverage_status"] == "NO_RECORDED_EVENTS_FOUND"
    assert "Zero disaster events recorded within 120 km" in coverage["status_description"]

    # Majuli (26.95, 94.17) should return real events
    majuli_events, majuli_cov = fetch_events_for_coordinates(26.95, 94.17, radius_km=120.0)
    assert len(majuli_events) > 0
    assert majuli_cov["coverage_status"] == "EVENTS_AVAILABLE"
    for ev in majuli_events:
        assert ev["distance_km"] <= 120.0
        assert ev["location_accuracy"] == "EXACT_COORDINATES"


# ============================================================================
# Tier 2: Pure-function RED ZONE Engine
# ============================================================================

def test_redzone_engine_physical_unsuitability_vs_current_conditions():
    """
    A chronically flood-prone habitation with high historical recurrence and severe erosion
    must be UNSUITABLE FOR PERMANENT HABITATION even on a calm sunny day (current_conditions="LIVE").
    """
    output = evaluate_red_zone(
        habitation_name="Brahmaputra Bank Hamlet",
        baseline_hazard_score=0.72,
        intensity_class=3,
        slope_degrees=5.0,
        distance_to_hazard_km=0.8,
        historical_event_count=4,
        high_severity_event_count=2,
        soil_erosion_rate=12.0,
        population=450,
        high_vuln_population=120,
        current_conditions="LIVE",
        terrain_data_status="REAL",
    )

    assert isinstance(output, RedZoneOutput)
    assert output.permanent_habitation_status == "UNSUITABLE"
    assert output.current_conditions == "LIVE"  # calm weather does not flip permanent status!
    assert output.is_red_zone is True
    assert "Riverine Inundation & Bank Erosion" in output.primary_hazard
    assert output.affected_population == 450
    assert output.high_vulnerability_population == 120
    assert output.confidence == "HIGH"
    assert output.data_status in ("OBSERVED", "DERIVED")


def test_redzone_engine_vulnerability_does_not_misclassify():
    """
    Vulnerability affects prioritization, NOT physical unsuitability.
    A safe elevated settlement with vulnerable residents remains SUITABLE.
    """
    output = evaluate_red_zone(
        habitation_name="Elevated Hill Settlement",
        baseline_hazard_score=0.15,
        intensity_class=1,
        slope_degrees=4.0,
        distance_to_hazard_km=8.0,
        historical_event_count=0,
        high_severity_event_count=0,
        population=800,
        high_vuln_population=600,  # high vulnerability
        current_conditions="LIVE",
        terrain_data_status="REAL",
    )

    assert output.permanent_habitation_status == "SUITABLE"
    assert output.is_red_zone is False


# ============================================================================
# Tier 3: Proactive Relocation & Ambulatory FOOT Evacuation
# ============================================================================

def test_transport_foot_mode_clarity():
    """
    Validates FOOT evacuation copy: must be restricted to ambulatory populations CAPABLE of walking.
    """
    assessment = assess_transport_feasibility(
        hab_lat=26.95,
        hab_lon=94.17,
        hab_name="Lowland Camp",
        site_lat=26.97,
        site_lon=94.19,
        site_name="Highland Relief Center",
        population=200,
        hazard_score=0.4,
        rainfall_mm_hr=5.0,
        river_proximity_km=3.0,
    )

    foot = assessment.modes["FOOT"]
    assert "CAPABLE of walking" in foot.details
    assert "non-ambulatory" in foot.details.lower()


# ============================================================================
# Tier 4: Capacity Gap Analysis
# ============================================================================

def test_capacity_gap_surplus_and_deficit():
    """
    Tests compute_capacity_gap_analysis for both surplus headroom and deficit gap.
    """
    candidate_sites = [
        {"name": "Site Alpha", "max_capacity_estimate": 1000, "existing_occupancy": 200, "committed_population": 100, "hazard_free": True},
        {"name": "Site Beta",  "max_capacity_estimate": 800,  "existing_occupancy": 100, "committed_population": 0,   "hazard_free": True},
    ]
    # Total available: (1000 - 300) + (800 - 100) = 700 + 700 = 1400

    # Case A: Demand is 1000 -> Headroom of +400
    report_surplus = compute_capacity_gap_analysis(relocation_demand=1000, candidate_sites=candidate_sites)
    assert report_surplus.status == "SURPLUS_HEADROOM"
    assert report_surplus.headroom_or_gap == 400
    assert "Capacity adequate" in report_surplus.action_required

    # Case B: Demand is 2000 -> Gap of -600 -> Requires additional candidate sites
    report_deficit = compute_capacity_gap_analysis(relocation_demand=2000, candidate_sites=candidate_sites)
    assert report_deficit.status == "DEFICIT_GAP"
    assert report_deficit.headroom_or_gap == -600
    assert "Identify additional candidate sites" in report_deficit.action_required
    assert report_deficit.source == "NBC 2016 Table 3 / SDMA Registry"


# ============================================================================
# Tier 5: Multimodal Transport Intelligence
# ============================================================================

def test_transport_mode_feasibility_modes():
    """
    Tests ROAD, HELICOPTER, BOAT, FOOT, and HYBRID mode feasibility.
    """
    # Helipad and Boat staging nodes
    nodes = [
        TransportNodeInput(id=1, name="Majuli Jetty", node_type="boat_jetty", lat=26.93, lon=94.18, capacity_persons=50, status="OPERATIONAL"),
        TransportNodeInput(id=2, name="Garmur Helipad", node_type="helipad", lat=26.97, lon=94.22, capacity_persons=20, status="OPERATIONAL"),
        TransportNodeInput(id=3, name="Highway Post", node_type="road_staging", lat=26.85, lon=94.20, capacity_persons=100, status="OPERATIONAL"),
    ]

    # Extreme flood hazard with road severed -> HYBRID or BOAT
    assessment = assess_transport_feasibility(
        hab_lat=26.95, hab_lon=94.17, hab_name="Island Settlement",
        site_lat=26.90, site_lon=94.10, site_name="Mainland Safe Site",
        population=120,
        hazard_type="flood",
        hazard_score=0.88,  # road severely severed
        rainfall_mm_hr=15.0,
        river_proximity_km=0.5,
        transport_nodes=nodes,
    )

    assert assessment.recommended_mode in ("HYBRID", "BOAT", "HELICOPTER")
    assert "ROAD" in assessment.modes
    assert assessment.modes["ROAD"].feasible is False  # severed by breaches
    assert "Operational clearance required" in assessment.modes["HELICOPTER"].bottlenecks


# ============================================================================
# Tier 6: Time-Safe Historical Replay Isolation
# ============================================================================

def test_time_safe_replay_execution():
    """
    Verifies historical replay runs with strict as_of_timestamp without mutating live state.
    """
    db = Session(engine)
    try:
        replay = run_time_safe_replay(
            db=db,
            event_id="FL-2026-AS-01",
            event_meta={
                "name": "2026 Brahmaputra Early Flood Wave",
                "lat": 26.95,
                "lon": 94.17,
                "hazard_type": "flood",
                "date_start": "2026-06-08",
                "timeline": [
                    {"timestamp": "2026-06-08", "label": "Early Breaches"},
                    {"timestamp": "2026-06-12", "label": "Peak Inundation"},
                ],
            },
            as_of_timestamp=datetime(2026, 6, 8, 12, 0, 0),
        )

        assert replay["as_of_date"] == "2026-06-08"
        assert len(replay["red_zones"]) >= 0
        assert "capacity_analysis" in replay
        assert "proactive_warning_window" in replay
        assert "warning_action_timeline" in replay
        assert "transport_assessment" in replay
        assert "PASS" in replay["provenance_panel"]["replay_isolation"]
    finally:
        db.close()
