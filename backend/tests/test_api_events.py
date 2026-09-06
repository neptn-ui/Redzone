# backend/tests/test_api_events.py
# Tests for Section 2.13 — Historical Events, Data Currency, and SDMA Ingestion

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import MagicMock
from datetime import date, datetime
from fastapi.testclient import TestClient
from fastapi import FastAPI

from api.events import router as events_router
from models import get_db

app = FastAPI()
app.include_router(events_router, prefix="/api")


def _make_mock_db():
    db = MagicMock()
    # Mock scalar for max(DisasterHistory.event_date)
    scalar_mock = MagicMock()
    scalar_mock.scalar.return_value = date(2026, 7, 6)
    db.query.return_value = scalar_mock
    db.execute.return_value = MagicMock()
    db.commit = MagicMock()
    db.add = MagicMock()
    return db


class TestApiEvents:
    def _client(self, mock_db=None):
        db = mock_db or _make_mock_db()
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app)

    def test_list_events_includes_2026(self):
        client = self._client()
        r = client.get("/api/events")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 4
        # Verify 2026 event is present
        event_2026 = next((e for e in data if "2026" in e["date_start"]), None)
        assert event_2026 is not None
        assert "Assam" in event_2026["name"]

    def test_get_events_currency(self):
        client = self._client()
        r = client.get("/api/events/currency")
        assert r.status_code == 200
        curr = r.json()
        assert "latest_event_date" in curr
        assert "2026" in curr["latest_event_date"]
        assert curr["currency_status"] in ("CURRENT", "RECENT", "INGESTION_LAG")
        assert "days_since_latest" in curr
        assert isinstance(curr["days_since_latest"], int)
        assert curr["total_catalog_events"] >= 4

    def test_get_event_detail_timeline(self):
        client = self._client()
        r = client.get("/api/events/assam-flood-2026-brahmaputra-barak")
        assert r.status_code == 200
        detail = r.json()
        assert detail["event_id"] == "assam-flood-2026-brahmaputra-barak"
        assert len(detail["timeline"]) >= 3
        assert "causal_chain" in detail
        assert "data_limitations" in detail

    def test_create_event_endpoint(self):
        db = _make_mock_db()
        # Mock empty duplicate check so add executes
        query_mock = MagicMock()
        query_mock.filter.return_value.all.return_value = []
        query_mock.filter.return_value.first.return_value = None
        db.query.return_value = query_mock

        client = self._client(mock_db=db)
        payload = {
            "event_id": "test-cachar-2026-flash",
            "name": "Test Cachar Flash Flood 2026",
            "date_start": "2026-07-15",
            "hazard_type": "flood",
            "region": "Assam",
            "district": "Cachar",
            "lat": 24.83,
            "lon": 92.79,
            "severity": "extreme",
            "severity_int": 5,
            "source": "Cachar DDMA Verification",
            "description": "Flash flooding along Sadarghat embankment.",
        }
        r = client.post("/api/events", json=payload)
        assert r.status_code == 201
        res = r.json()
        assert res["status"] == "created"
        assert res["event_id"] == "test-cachar-2026-flash"
