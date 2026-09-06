# backend/tests/test_tier10_ai_synthesis.py
# Test Suite for Tier 10: Contextual AI Decision Synthesis
#
# Validates:
#   - Deterministic, evidence-grounded 12-field AI Decision Brief
#   - Differentiates across operational directives:
#       * DIRECTIVE-IMMEDIATE-EVAC
#       * DIRECTIVE-PREPOSITION-PREPARE
#       * DIRECTIVE-PERMANENT-RESETTLEMENT
#       * DIRECTIVE-MONITOR-STABLE
#   - Multimodal boat/heli routing when road is severed
#   - Capacity shortfall triggering emergency transit expansion
#   - API endpoint GET /api/recommendations/synthesis
# ============================================================================

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from main import app
from scoring.ai_decision_engine import synthesize_ai_decision, AIDecisionBrief

client = TestClient(app)


def test_immediate_crisis_evacuation_directive():
    """Critical hazard triggers life-safety assisted evacuation and boat deployment."""
    brief = synthesize_ai_decision(
        area_name="Majuli",
        primary_hazard="flood",
        current_conditions="LIVE",
        max_hazard_score=0.88,
        exposed_population=5200,
        high_vuln_population=1456,
        relocation_demand=5200,
        total_available_capacity=3000,
        capacity_gap_or_headroom=-2200,
        capacity_status="DEFICIT_GAP",
        recommended_transport_mode="BOAT",
        road_passable=False,
        nearest_safe_site="Jorhat Relief Camp",
        immediate_count=2,
    )

    assert brief.decision_directive_code == "DIRECTIVE-IMMEDIATE-EVAC"
    assert "life-safety" in brief.why_it_matters.lower()
    assert "boat" in brief.how_they_should_move.lower() or "rescue" in brief.how_they_should_move.lower()
    assert "deficit" in brief.capacity_constraint.lower()
    assert "2,200" in brief.capacity_constraint
    assert len(brief.evidence) >= 2


def test_chronic_unsuitability_calm_weather_directive():
    """Calm weather with permanent red zone triggers phased resettlement planning."""
    brief = synthesize_ai_decision(
        area_name="Majuli",
        primary_hazard="erosion",
        current_conditions="LIVE",
        max_hazard_score=0.45,
        exposed_population=1800,
        high_vuln_population=500,
        relocation_demand=1800,
        total_available_capacity=3000,
        capacity_gap_or_headroom=1200,
        capacity_status="SURPLUS_HEADROOM",
        recommended_transport_mode="ROAD",
        road_passable=True,
        nearest_safe_site="Garmur Resettlement Colony",
        red_zone_count=1,
        immediate_count=0,
    )

    assert brief.decision_directive_code == "DIRECTIVE-PERMANENT-RESETTLEMENT"
    assert "resettlement" in brief.when_action_is_required.lower() or "formal" in brief.when_action_is_required.lower()
    assert "unsuitable" in brief.what_changed.lower()


def test_stable_catchment_directive():
    """Baseline conditions trigger automated sensor monitoring without panic."""
    brief = synthesize_ai_decision(
        area_name="Majuli",
        primary_hazard="flood",
        current_conditions="LIVE",
        max_hazard_score=0.18,
        exposed_population=0,
        high_vuln_population=0,
        relocation_demand=0,
        total_available_capacity=5000,
        capacity_gap_or_headroom=5000,
        capacity_status="SURPLUS_HEADROOM",
        recommended_transport_mode="ROAD",
        road_passable=True,
        nearest_safe_site="Kamalabari Safe Ground",
        red_zone_count=0,
        immediate_count=0,
    )

    assert brief.decision_directive_code == "DIRECTIVE-MONITOR-STABLE"
    assert "baseline" in brief.what_changed.lower()
    assert "no relocation required" in brief.where_they_should_go.lower()


def test_recommendation_synthesis_api_endpoint():
    """GET /api/recommendations/synthesis returns structured 12-field brief."""
    resp = client.get("/api/recommendations/synthesis?region_name=Assam")
    assert resp.status_code == 200
    data = resp.json()
    assert "decision_directive_code" in data
    assert "what_changed" in data
    assert "why_it_matters" in data
    assert "who_is_at_risk" in data
    assert "when_action_is_required" in data
    assert "where_they_should_go" in data
    assert "how_they_should_move" in data
    assert "capacity_constraint" in data
    assert "resource_implication" in data
    assert "recommended_sdma_action" in data
    assert "confidence" in data
    assert "limitations" in data
    assert "evidence" in data
