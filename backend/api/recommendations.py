# backend/api/recommendations.py
# FastAPI router — /api/recommendations
#
# Runs the full scoring + matching pipeline and returns a structured
# recommendation set. This is the primary "decision support" endpoint —
# the endpoint the frontend Decision Panel reads to populate action cards.
#
# Design (§0 — five questions):
#   WHO is at risk?       → priority_queue (from zones.py)
#   WHY are they at risk? → explanation_json per habitation
#   WHERE can they go?    → matched site per habitation
#   WHO moves first?      → ranked by urgency_score
#   WHAT should authorities do? → action cards (this file)
# ============================================================================

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models import Habitation, CandidateSite, ZoneScore, get_db
from api.zones import list_zones, run_optimize, OptimizeRequest

log = logging.getLogger(__name__)
router = APIRouter(tags=["recommendations"])


class ActionCard(BaseModel):
    """
    A structured authority action for one habitation.
    Corresponds to the Decision Panel card (§12).
    """
    rank:           int
    habitation_id:  int
    habitation_name: str
    population:     int
    urgency_score:  float
    hazard_score:   float
    classification: str
    timeline:       str
    action_items:   list[str]
    matched_site:   Optional[str]
    matched_site_id: Optional[int]
    lat:            float
    lon:            float


class RecommendationResponse(BaseModel):
    generated_at:     str
    total_habitations: int
    immediate_count:  int
    short_term_count: int
    medium_term_count: int
    action_cards:     list[ActionCard]
    optimizer_summary: dict


def _action_items(classification: str, timeline: str, matched_site: Optional[str]) -> list[str]:
    """Generate authority action checklist based on classification."""
    items = []
    if classification == "immediate":
        items += [
            "Issue evacuation advisory immediately",
            "Deploy NDRF/SDRF teams within 24 hours",
            "Activate emergency shelter at matched site",
            "Notify district collector and divisional commissioner",
            "Set up temporary transit camp within 3 km",
        ]
    elif classification == "short_term":
        items += [
            "Begin infrastructure preparation at relocation site",
            "Conduct community consultation meetings",
            "Survey road connectivity to matched site",
            "Prepare land acquisition / government housing scheme",
        ]
    else:
        items += [
            "Install monitoring sensors (inclinometers, rain gauges)",
            "Conduct seasonal re-assessment",
            "Identify local volunteers for early-warning relay",
        ]

    if matched_site:
        items.append(f"Coordinate with site management at {matched_site}")
    else:
        items.append("Escalate site search — no viable site within 100 km radius")

    return items


@router.get(
    "/recommendations",
    response_model=RecommendationResponse,
    summary="Full recommendation set — action cards for all at-risk habitations",
)
def get_recommendations(
    min_urgency:     float = Query(default=0.0, ge=0.0, le=1.0),
    max_distance_km: float = Query(default=100.0, ge=1.0, le=500.0),
    db: Session = Depends(get_db),
):
    """
    Runs the full pipeline:
      1. Fetch all zone scores (with cache/recompute)
      2. Run matching optimizer
      3. Build action cards

    Returns the structured recommendation set for the Decision Panel.
    """
    # 1. Get all zones (uses cache)
    zones = list_zones(db=db)
    zones_by_id = {z.habitation_id: z for z in zones}

    # 2. Run optimizer
    opt_result = run_optimize(
        OptimizeRequest(max_distance_km=max_distance_km, prefer_lp=False),
        db=db,
    )
    site_map = {a["habitation_id"]: (a["site_id"], a["site_name"])
                for a in opt_result.assignments}

    # 3. Build action cards
    filtered = [z for z in zones if z.urgency_score >= min_urgency]
    filtered.sort(key=lambda z: (z.urgency_score, z.hazard_score), reverse=True)

    cards: list[ActionCard] = []
    for i, z in enumerate(filtered):
        site_id, site_name = site_map.get(z.habitation_id, (None, z.matched_site))
        cards.append(ActionCard(
            rank=i + 1,
            habitation_id=z.habitation_id,
            habitation_name=z.name,
            population=z.population,
            urgency_score=z.urgency_score,
            hazard_score=z.hazard_score,
            classification=z.classification,
            timeline=z.timeline,
            action_items=_action_items(z.classification, z.timeline, site_name),
            matched_site=site_name,
            matched_site_id=site_id,
            lat=z.lat,
            lon=z.lon,
        ))

    immediate  = sum(1 for z in zones if z.classification == "immediate")
    short_term = sum(1 for z in zones if z.classification == "short_term")
    medium     = sum(1 for z in zones if z.classification == "medium_term")

    return RecommendationResponse(
        generated_at=datetime.utcnow().isoformat() + "Z",
        total_habitations=len(zones),
        immediate_count=immediate,
        short_term_count=short_term,
        medium_term_count=medium,
        action_cards=cards,
        optimizer_summary={
            "solver_used":              opt_result.solver_used,
            "solver_status":            opt_result.solver_status,
            "total_match_score":        opt_result.total_match_score,
            "total_population_matched": opt_result.total_population_matched,
            "unmatched_count":          opt_result.unmatched_count,
        },
    )
