# backend/tests/test_api_zones.py
# Section 14.3 Test Gate — api/zones.py
#
# Uses FastAPI TestClient with a fully mocked DB dependency.
# No PostgreSQL required. Tests route structure, response shape,
# status codes, and the scoring pipeline wiring.
#
# CASES:
#   1. GET /api/zones — returns list; each item has required fields
#   2. GET /api/zones/{id} — returns detail with explanation_json
#   3. GET /api/zones/{id}/explain — returns raw §6 JSONB
#   4. GET /api/priority-queue — returns list ranked by urgency
#   5. POST /api/optimize — returns solver result with assignments + unmatched
#   6. 404 on unknown habitation_id
# ============================================================================

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

# Guard: these packages are only available inside Docker (requirements.txt).
# On the host dev machine, these tests are skipped automatically.
sqlalchemy = pytest.importorskip("sqlalchemy",  reason="sqlalchemy not installed — run inside Docker")
fastapi    = pytest.importorskip("fastapi",     reason="fastapi not installed — run inside Docker")
httpx      = pytest.importorskip("httpx",       reason="httpx not installed — run inside Docker")

from unittest.mock import MagicMock, patch
from datetime import datetime

from fastapi.testclient import TestClient
from fastapi import FastAPI

# ============================================================================
# Build a minimal FastAPI app that mounts zones.router with a mocked DB
# ============================================================================

# We import zones.router but override get_db via dependency_overrides
# to return a mock session — so no real PostgreSQL is touched.

from api.zones import router as zones_router
from models import get_db

app = FastAPI()
app.include_router(zones_router, prefix="/api")


# ============================================================================
# Mock DB objects (mirror models.py structure)
# ============================================================================

def _make_habitation(id=1, name="Test Hab", population=500,
                     district="Chamoli"):
    h = MagicMock()
    h.id         = id
    h.name       = name
    h.population = population
    h.district   = district
    h.state      = "Uttarakhand"
    return h


def _make_zone_score(habitation_id=1, hazard=0.845, urgency=0.760,
                     cap=0.678, classification="immediate",
                     site_id=1):
    zs = MagicMock()
    zs.habitation_id   = habitation_id
    zs.hazard_score    = hazard
    zs.urgency_score   = urgency
    zs.capacity_score  = cap
    zs.classification  = MagicMock(value=classification)
    zs.matched_site_id = site_id
    zs.computed_at     = datetime(2026, 1, 1, 12, 0, 0)   # not stale for tests
    zs.live_rainfall_mm  = 45.0
    zs.live_seismic_mag  = None
    zs.live_trigger_mult = 1.15
    zs.data_is_cached    = False
    zs.explanation_json  = {
        "habitation": "Test Hab",
        "population": 500,
        "hazard": {
            "habitation": "Test Hab",
            "base_hazard_score": 0.845,
            "final_hazard_score": 0.845,
            "classification": "immediate",
            "classification_label": "Red — Immediate",
            "evidence": ["Test evidence"],
            "breakdown": {},
        },
        "urgency": {
            "habitation": "Test Hab",
            "urgency_score": 0.760,
            "timeline": "Immediate — Relocate within 3 months",
            "inputs": {
                "hazard_score": 0.845,
                "population_exposure_norm": 0.9,
                "site_availability_factor": 1.0,
            },
        },
        "matched_relocation_site": {
            "id": 1, "name": "Test Site", "capacity_score": 0.678
        },
        "live_signals": {
            "rainfall_mm_per_hr": 45.0,
            "seismic_magnitude": None,
            "trigger_multiplier": 1.15,
        },
        "computed_at": "2026-01-01T12:00:00Z",
    }
    return zs


def _make_site(id=1, name="Test Site"):
    s = MagicMock()
    s.id                   = id
    s.name                 = name
    s.available_land_sqm   = 45_000.0
    s.slope_degrees        = 8.0
    s.distance_to_road_km  = 0.3
    s.distance_to_water_km = 0.8
    s.existing_occupancy   = 420
    s.max_capacity_estimate = 2000
    return s


# ============================================================================
# DB session mock factory
# ============================================================================

def _make_mock_db(
    habs=None,
    sites=None,
    zone_score=None,
    return_none_zone=False,
):
    db = MagicMock()
    _habs  = habs  or [_make_habitation()]
    _sites = sites or [_make_site()]
    _zs    = zone_score or _make_zone_score()

    # query().all()
    def _query(model):
        q = MagicMock()
        if "Habitation" in str(model):
            q.all.return_value = _habs
            q.filter.return_value = q
        elif "CandidateSite" in str(model):
            q.all.return_value = _sites
            q.filter.return_value = q
        else:
            q.all.return_value = []
            q.filter.return_value = q
        return q
    db.query = _query

    # db.get(Model, pk)
    def _get(model, pk):
        name = str(model)
        if "ZoneScore" in name:
            return None if return_none_zone else _zs
        if "Habitation" in name:
            matching = [h for h in _habs if h.id == pk]
            return matching[0] if matching else None
        if "CandidateSite" in name:
            matching = [s for s in _sites if s.id == pk]
            return matching[0] if matching else None
        return None
    db.get = _get

    # Raw SQL execute — returns lat/lon stubs
    exec_result = MagicMock()
    exec_result.fetchone.return_value = (30.558, 79.564)
    exec_result.fetchall.return_value = []
    db.execute.return_value = exec_result

    db.merge    = MagicMock()
    db.commit   = MagicMock()
    db.rollback = MagicMock()

    return db


# ============================================================================
# CASE 1 — GET /api/zones returns list with required fields
# ============================================================================

class TestGetZones:

    def _client(self, **db_kwargs):
        mock_db = _make_mock_db(**db_kwargs)
        app.dependency_overrides[get_db] = lambda: mock_db
        c = TestClient(app, raise_server_exceptions=False)
        return c

    def test_returns_200(self):
        resp = self._client().get("/api/zones")
        assert resp.status_code == 200

    def test_returns_list(self):
        resp = self._client().get("/api/zones")
        assert isinstance(resp.json(), list)

    def test_item_has_required_fields(self):
        resp = self._client().get("/api/zones")
        body = resp.json()
        assert len(body) > 0
        item = body[0]
        required = {
            "habitation_id", "name", "population", "district",
            "lat", "lon", "hazard_score", "urgency_score",
            "classification", "computed_at",
        }
        assert required.issubset(item.keys()), (
            f"Missing fields: {required - set(item.keys())}"
        )

    def test_hazard_score_is_float_in_range(self):
        resp = self._client().get("/api/zones")
        for item in resp.json():
            assert 0.0 <= item["hazard_score"] <= 1.0

    def test_filter_by_classification(self):
        resp = self._client().get("/api/zones?classification=immediate")
        body = resp.json()
        for item in body:
            assert item["classification"] == "immediate"


# ============================================================================
# CASE 2 — GET /api/zones/{id} returns detail with explanation_json
# ============================================================================

class TestGetZoneDetail:

    def _client(self, **db_kwargs):
        mock_db = _make_mock_db(**db_kwargs)
        app.dependency_overrides[get_db] = lambda: mock_db
        return TestClient(app, raise_server_exceptions=False)

    def test_returns_200_for_known_id(self):
        resp = self._client().get("/api/zones/1")
        assert resp.status_code == 200

    def test_returns_explanation_json(self):
        resp = self._client().get("/api/zones/1")
        body = resp.json()
        assert "explanation_json" in body
        ej = body["explanation_json"]
        assert "hazard"  in ej
        assert "urgency" in ej

    def test_explanation_json_has_breakdown(self):
        resp = self._client().get("/api/zones/1")
        ej = resp.json()["explanation_json"]
        assert "hazard" in ej
        assert "final_hazard_score" in ej["hazard"] or "base_hazard_score" in ej["hazard"]

    def test_returns_404_for_unknown_id(self):
        resp = self._client().get("/api/zones/9999")
        assert resp.status_code == 404


# ============================================================================
# CASE 3 — GET /api/zones/{id}/explain returns raw §6 JSONB
# ============================================================================

class TestExplainZone:

    def _client(self, **db_kwargs):
        mock_db = _make_mock_db(**db_kwargs)
        app.dependency_overrides[get_db] = lambda: mock_db
        return TestClient(app, raise_server_exceptions=False)

    def test_returns_200(self):
        resp = self._client().get("/api/zones/1/explain")
        assert resp.status_code == 200

    def test_returns_dict_not_list(self):
        resp = self._client().get("/api/zones/1/explain")
        assert isinstance(resp.json(), dict)

    def test_returns_404_when_no_score(self):
        resp = self._client(return_none_zone=True).get("/api/zones/1/explain")
        assert resp.status_code == 404


# ============================================================================
# CASE 4 — GET /api/priority-queue returns ranked list
# ============================================================================

class TestPriorityQueue:

    def _client(self, **db_kwargs):
        mock_db = _make_mock_db(**db_kwargs)
        app.dependency_overrides[get_db] = lambda: mock_db
        return TestClient(app, raise_server_exceptions=False)

    def test_returns_200(self):
        resp = self._client().get("/api/priority-queue")
        assert resp.status_code == 200

    def test_returns_list(self):
        resp = self._client().get("/api/priority-queue")
        assert isinstance(resp.json(), list)

    def test_items_have_rank(self):
        resp = self._client().get("/api/priority-queue")
        body = resp.json()
        if body:
            assert "rank" in body[0]
            assert body[0]["rank"] == 1

    def test_limit_parameter_respected(self):
        """limit=1 should return at most 1 item."""
        resp = self._client().get("/api/priority-queue?limit=1")
        assert len(resp.json()) <= 1


# ============================================================================
# CASE 5 — POST /api/optimize returns solver result
# ============================================================================

class TestOptimize:

    def _client(self, **db_kwargs):
        mock_db = _make_mock_db(**db_kwargs)
        app.dependency_overrides[get_db] = lambda: mock_db
        return TestClient(app, raise_server_exceptions=False)

    def test_returns_200(self):
        resp = self._client().post("/api/optimize", json={})
        assert resp.status_code == 200

    def test_response_has_required_fields(self):
        resp = self._client().post("/api/optimize", json={})
        body = resp.json()
        required = {
            "solver_used", "solver_status", "total_match_score",
            "total_population_matched", "assignments",
            "unmatched_count", "unmatched",
        }
        assert required.issubset(body.keys())

    def test_assignments_is_list(self):
        resp = self._client().post("/api/optimize", json={})
        assert isinstance(resp.json()["assignments"], list)

    def test_invalid_max_distance_returns_422(self):
        resp = self._client().post("/api/optimize", json={"max_distance_km": 0})
        assert resp.status_code == 422


# ============================================================================
# CASE 6 — 404 for unknown habitation
# ============================================================================

class TestNotFound:

    def _client(self):
        mock_db = _make_mock_db()
        app.dependency_overrides[get_db] = lambda: mock_db
        return TestClient(app, raise_server_exceptions=False)

    def test_zone_detail_404(self):
        assert self._client().get("/api/zones/9999").status_code == 404

    def test_explain_404_when_no_score(self):
        mock_db = _make_mock_db(return_none_zone=True)
        app.dependency_overrides[get_db] = lambda: mock_db
        c = TestClient(app, raise_server_exceptions=False)
        assert c.get("/api/zones/1/explain").status_code == 404

    def test_recalculate_404(self):
        assert self._client().post("/api/zones/9999/recalculate").status_code == 404
