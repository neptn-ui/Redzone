import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, date, timedelta
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

from main import app
from models import (
    get_db, Habitation, CandidateSite, DisasterHistory, Region, ZoneScore,
    DecisionAudit, TransportNode
)
from scoring.hazard_engine import compute_permanent_habitation_status, compute_hazard_score
from scoring.transport_engine import assess_transport_feasibility, TransportNodeInput
from scoring.replay_engine import run_time_safe_replay


@pytest.fixture
def mock_db_session():
    """Mock database session providing test habitations, candidate sites, and regions."""
    db = MagicMock()

    hab1 = Habitation(
        id=101, name="Salmora Riverbank Settlement", district="Majuli",
        population=1240, region_id=1, slope_degrees=12.0, distance_to_hazard_km=0.2,
        terrain_data_source="REAL"
    )
    hab2 = Habitation(
        id=102, name="Jiadhal Embankment Sector", district="Dhemaji",
        population=850, region_id=1, slope_degrees=5.0, distance_to_hazard_km=0.4,
        terrain_data_source="REAL"
    )
    all_habs = [hab1, hab2]

    site1 = CandidateSite(
        id=201, name="Garmur High Ground Resettlement Area",
        max_capacity_estimate=2000, existing_occupancy=200, committed_population=0,
        available_land_sqm=50000.0, slope_degrees=4.0, distance_to_road_km=0.5,
        distance_to_water_km=0.8, hazard_free=True, region_id=1
    )
    all_sites = [site1]

    region1 = Region(
        id=1, name="Assam Brahmaputra-Barak Pilot", state="Assam",
        bounding_radius_km=150.0
    )
    region2 = Region(
        id=2, name="Delhi National Capital Region", state="Delhi",
        bounding_radius_km=50.0
    )

    def _query(model):
        q = MagicMock()
        model_str = str(model)
        if "Habitation" in model_str:
            q.all.return_value = all_habs
            q.filter.return_value = q
        elif "CandidateSite" in model_str:
            q.all.return_value = all_sites
            q.filter.return_value = q
        elif "Region" in model_str:
            q.all.return_value = [region1, region2]
            q.filter.return_value = q
        elif "DisasterHistory" in model_str:
            q.all.return_value = []
            q.filter.return_value = q
            q.scalar.return_value = date(2026, 7, 6)
        elif "DecisionAudit" in model_str:
            q.all.return_value = []
            q.filter.return_value = q
        else:
            q.all.return_value = []
            q.filter.return_value = q
        return q

    db.query = _query

    def _get(model, pk):
        model_str = str(model)
        if "Habitation" in model_str:
            for h in all_habs:
                if h.id == pk: return h
        elif "CandidateSite" in model_str:
            for s in all_sites:
                if s.id == pk: return s
        elif "Region" in model_str:
            return region1 if pk == 1 else region2
        return None

    db.get = _get
    exec_res = MagicMock()
    exec_res.fetchone.return_value = (26.95, 94.17)
    exec_res.fetchall.return_value = []
    db.execute.return_value = exec_res

    return db


# ============================================================================
# TIER 1 — Time-Safe Replay & Permanent Habitation Status
# ============================================================================

class TestTier1CorrectnessFoundations:

    def test_permanent_habitation_status_independent_of_quiet_weather(self):
        """Tier 1.2: Quiet weather must NOT flip a high-hazard, recurrent zone to SUITABLE."""
        status_quiet, rationale_quiet = compute_permanent_habitation_status(
            baseline_hazard_score=0.75,
            slope_degrees=32.0,
            historical_event_count=5,
            high_severity_event_count=2,
            soil_erosion_rate=25.0,
        )
        assert status_quiet == "UNSUITABLE"
        assert any(term in rationale_quiet.lower() for term in ("hazard", "slope", "disaster", "terrain"))

        # Moderate terrain with past events is CONDITIONAL, not SUITABLE
        status_mod, _ = compute_permanent_habitation_status(
            baseline_hazard_score=0.45,
            slope_degrees=10.0,
            historical_event_count=2,
            high_severity_event_count=0,
            soil_erosion_rate=5.0,
        )
        assert status_mod == "CONDITIONAL"

        # Genuinely safe site is SUITABLE
        status_safe, _ = compute_permanent_habitation_status(
            baseline_hazard_score=0.15,
            slope_degrees=4.0,
            historical_event_count=0,
            high_severity_event_count=0,
            soil_erosion_rate=1.0,
        )
        assert status_safe == "SUITABLE"

    def test_time_safe_replay_isolation_no_hindsight(self, mock_db_session):
        """Tier 1.1: Historical replay must accept as_of_timestamp and never mutate live tables."""
        event_meta = {
            "event_id": "test-flood-2022",
            "name": "Assam Flood 2022",
            "hazard_type": "flood",
            "lat": 26.95,
            "lon": 94.17,
            "date_start": "2022-06-08",
            "timeline": [
                {"timestamp": "2022-06-08", "label": "Rising Phase"},
                {"timestamp": "2022-06-12", "label": "Peak Inundation"},
            ]
        }
        early_as_of = datetime(2022, 6, 8, 12, 0, 0)
        res_early = run_time_safe_replay(mock_db_session, "test-flood-2022", event_meta, early_as_of)

        assert res_early["as_of_date"] == "2022-06-08"
        assert res_early["provenance_panel"]["replay_isolation"].startswith("PASS")
        # Ensure zero writes to live tables
        mock_db_session.commit.assert_not_called()


# ============================================================================
# TIER 2 — RED ZONE First-Class Output & Warning Timeline
# ============================================================================

class TestTier2RedZoneAndTimeline:

    def test_red_zone_structured_output(self, mock_db_session):
        """Tier 2.1: Zone crossing threshold must output structured RED ZONE object."""
        event_meta = {
            "name": "Assam Flood 2026", "hazard_type": "flood", "lat": 26.95, "lon": 94.17,
            "date_start": "2026-06-15",
            "timeline": [{"timestamp": "2026-06-15", "label": "Warning"}]
        }
        res = run_time_safe_replay(mock_db_session, "ev-2026", event_meta, datetime(2026, 6, 15))
        red_zones = res["red_zones"]
        assert len(red_zones) > 0

        rz = red_zones[0]
        # Check contract fields
        assert "status" in rz
        assert "FOR PERMANENT HABITATION" in rz["status"]
        assert "primary_hazard" in rz
        assert isinstance(rz["contributing_hazards"], list)
        assert rz["affected_population"] > 0
        assert rz["high_vulnerability_population"] > 0
        assert rz["relocation_horizon"] in ("IMMEDIATE", "SHORT_TERM", "MEDIUM_TERM")
        assert "recommendation" in rz
        assert "data_status" in rz

    def test_warning_window_and_action_timeline(self, mock_db_session):
        """Tier 2.2 & 2.3: Warning window calculation and T-mark action timeline."""
        event_meta = {
            "name": "Assam Flood 2026", "hazard_type": "flood", "lat": 26.95, "lon": 94.17,
            "date_start": "2026-06-10",
            "timeline": [
                {"timestamp": "2026-06-10", "label": "Short-term advisory"},
                {"timestamp": "2026-06-14", "label": "Peak inundation"},
            ]
        }
        res = run_time_safe_replay(mock_db_session, "ev-2026", event_meta, datetime(2026, 6, 12))
        pww = res["proactive_warning_window"]
        assert "4 DAYS" in pww["warning_window"]
        assert "2026-06-10" in pww["first_detected"]

        wat = res["warning_action_timeline"]
        assert len(wat) >= 4
        t_marks = [step["t_mark"] for step in wat]
        assert "T-4" in t_marks
        assert "T-2" in t_marks
        assert "T" in t_marks


# ============================================================================
# TIER 3 — Data Honesty & Capacity/Vulnerability Surfacing
# ============================================================================

class TestTier3DataHonestyAndCapacity:

    def test_capacity_gap_analysis(self, mock_db_session):
        """Tier 3.3: Capacity-gap analysis produces headroom or gap with action."""
        event_meta = {"name": "Test", "hazard_type": "flood", "lat": 26.95, "lon": 94.17}
        res = run_time_safe_replay(mock_db_session, "ev-test", event_meta, datetime(2026, 6, 10))
        cap = res["capacity_analysis"]
        assert cap["status"] in ("SURPLUS", "DEFICIT")
        assert "available_capacity" in cap
        assert "relocation_demand" in cap
        assert "HEADROOM:" in cap["display_text"] or "GAP:" in cap["display_text"]
        assert "action" in cap

    def test_vulnerable_population_prioritization(self, mock_db_session):
        """Tier 3.4: Priority order breakdown elderly, disabled, high-risk households."""
        event_meta = {"name": "Test", "hazard_type": "flood", "lat": 26.95, "lon": 94.17}
        res = run_time_safe_replay(mock_db_session, "ev-test", event_meta, datetime(2026, 6, 10))
        vuln = res["vulnerability_prioritization"]
        assert vuln["total_population"] > 0
        assert vuln["high_vulnerability_population"] > 0
        assert any("Elderly" in p for p in vuln["priority_order"])
        assert any("Disabled" in p for p in vuln["priority_order"])


# ============================================================================
# TIER 4 — Transport-Mode Feasibility Engine
# ============================================================================

class TestTier4TransportModeIntelligence:

    def test_multimodal_transport_feasibility(self):
        """Tier 4.1 & 4.2: Assesses ROAD, HELICOPTER, BOAT, FOOT with distinct nodes and provenance."""
        nodes = [
            TransportNodeInput(id=1, name="Kamalabari Ghat", node_type="boat_jetty", lat=26.93, lon=94.18, capacity_persons=50),
            TransportNodeInput(id=2, name="Garmur Helipad", node_type="helipad", lat=26.97, lon=94.22, capacity_persons=20),
            TransportNodeInput(id=3, name="Jorhat Road Staging", node_type="road_staging", lat=26.75, lon=94.21, capacity_persons=100),
        ]

        # Severe flood scenario (road blocked, boat available)
        assessment = assess_transport_feasibility(
            hab_lat=26.95, hab_lon=94.17, hab_name="Salmora",
            site_lat=26.98, site_lon=94.25, site_name="Garmur Higher Ground",
            population=500,
            hazard_type="flood",
            hazard_score=0.88,
            rainfall_mm_hr=35.0,
            river_proximity_km=0.3,
            transport_nodes=nodes,
            historical_transport_record={"boat": True},
        )

        assert assessment.recommended_mode in ("BOAT", "HYBRID", "HELICOPTER")
        modes_upper = {k.upper(): v for k, v in assessment.modes.items()}
        assert "ROAD" in modes_upper
        assert "BOAT" in modes_upper
        assert "HELICOPTER" in modes_upper
        assert modes_upper["BOAT"].feasible is True
        assert modes_upper["ROAD"].risk_level in ("HIGH", "CRITICAL")
        assert modes_upper["BOAT"].provenance == "OBSERVED"
        assert modes_upper["HELICOPTER"].provenance == "COMPUTED"


# ============================================================================
# TIER 5 — Region-Aware Event History & Coverage
# ============================================================================

class TestTier5RegionAwareEventHistory:

    def test_strict_region_scoping_no_cross_contamination(self):
        """Tier 5.1: Delhi queries must never return Assam events."""
        client = TestClient(app)
        # Query events near Delhi (lat ~28.6, lon ~77.2)
        r = client.get("/api/events?lat=28.61&lon=77.20&radius_km=100")
        assert r.status_code == 200
        delhi_events = r.json()
        for ev in delhi_events:
            assert "Assam" not in ev.get("region", "")
            assert "Majuli" not in ev.get("name", "")

        # Query events near Majuli, Assam (lat ~26.95, lon ~94.17)
        r_assam = client.get("/api/events?lat=26.95&lon=94.17&radius_km=100")
        assert r_assam.status_code == 200
        assam_events = r_assam.json()
        assert len(assam_events) > 0
        for ev in assam_events:
            assert "Assam" in ev.get("region", "") or "Assam" in ev.get("name", "") or ev.get("state") == "Assam"

    def test_event_source_coverage_three_states(self):
        """Tier 5.2: Reports EVENTS_AVAILABLE, NO_RECORDED_EVENTS_FOUND, or SOURCE_UNAVAILABLE."""
        client = TestClient(app)
        r = client.get("/api/events/coverage")
        assert r.status_code == 200
        cov = r.json()
        cov_status = cov.get("status") or cov.get("coverage_status")
        assert cov_status in ("EVENTS_AVAILABLE", "NO_RECORDED_EVENTS_FOUND", "SOURCE_UNAVAILABLE")
        assert "sources" in cov
        assert cov.get("cache_ttl_hours", 24) == 24


# ============================================================================
# TIER 6 — Human-in-the-Loop Decisions
# ============================================================================

class TestTier6HumanInTheLoopDecision:

    def test_decision_record_approve_modify_override(self, mock_db_session):
        """Tier 6.3: Captures and persists SDMA operator approval, modification, or override."""
        client = TestClient(app)
        app.dependency_overrides[get_db] = lambda: mock_db_session

        decision_payload = {
            "recommendation_id": "REC-MAJULI-2026-TEST",
            "habitation_id": 101,
            "habitation_name": "Salmora Riverbank Settlement",
            "decision": "MODIFY",
            "reason": "Prioritize deploying 4 rescue country boats before convoy dispatch",
            "operator_name": "SDMA Field Commander Baruah",
            "modified_site_id": 201
        }

        r = client.post("/api/recommendations/decision", json=decision_payload)
        assert r.status_code == 201
        res = r.json()
        assert res["status"] == "recorded"
        assert res["decision"] == "MODIFY"
        assert "audit_id" in res
        # Verify db.add and commit called for audit
        assert mock_db_session.add.called
        assert mock_db_session.commit.called
