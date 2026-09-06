# backend/api/recommendations.py
# FastAPI router — /api/recommendations
#
# Runs the full scoring + matching pipeline and returns a structured
# recommendation set. This is the primary "decision support" endpoint —
# the endpoint the frontend Decision Panel reads to populate action cards.
#
# Design (§0 — five questions):
#   WHO is at risk?              → priority_queue (from zones.py)
#   WHY are they at risk?        → explanation_json per habitation
#   WHERE can they go?           → matched site per habitation
#   WHO moves first?             → ranked by urgency_score
#   WHAT should authorities do?  → action cards (this file)
#
# §2.2: Action checklists now branch on relocation_horizon (IMMEDIATE /
# SHORT_TERM / MEDIUM_TERM / MONITOR) — four distinct authority workflows.
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
    rank:                         int
    habitation_id:                int
    habitation_name:              str
    population:                   int
    urgency_score:                float
    hazard_score:                 float
    classification:               str
    relocation_horizon:           Optional[str]
    timeline:                     str
    permanent_habitation_status:  str = "CONDITIONAL"
    current_conditions:           str = "LIVE"
    red_zone_status:              Optional[str] = None
    action_items:                 list[str]
    matched_site:                 Optional[str]
    matched_site_id:              Optional[int]
    region_name:                  str
    lat:                          float
    lon:                          float
    latest_decision:              Optional[dict] = None


class DecisionRequest(BaseModel):
    habitation_id:     int
    decision_type:     Optional[str] = None
    decision:          Optional[str] = None
    recommendation:    Optional[str] = "Relocation Directive"
    recommendation_id: Optional[str] = None
    reason:            Optional[str] = None
    operator:          Optional[str] = "SDMA Officer"
    operator_name:     Optional[str] = None
    modified_site_id:  Optional[int] = None
    habitation_name:   Optional[str] = None
    details:           Optional[dict] = None


class RecommendationResponse(BaseModel):
    generated_at:      str
    total_habitations: int
    immediate_count:   int
    short_term_count:  int
    medium_term_count: int
    monitor_count:     int
    action_cards:      list[ActionCard]
    optimizer_summary: dict


def _action_items(relocation_horizon: Optional[str],
                  matched_site: Optional[str]) -> list[str]:
    """
    §2.2: Generate authority action checklist based on RelocationHorizon bucket.
    Four distinct workflows — not the old two-branch classification check.
    """
    h = (relocation_horizon or "MONITOR").upper()
    items: list[str] = []

    if h == "IMMEDIATE":
        items += [
            "Issue evacuation advisory immediately — mobilise NDRF/SDRF within 24 hours",
            "Activate emergency shelter at matched site (or nearest government facility)",
            "Notify district collector, divisional commissioner, and state SDMA",
            "Set up temporary transit camp within 3 km of habitation",
            "Deploy search-and-rescue team; conduct head-count against Census records",
            "Coordinate with health department for medical triage at transit camp",
            "Brief media: issue only REDZONE-sourced hazard boundaries — no speculation",
        ]
        if not matched_site:
            items += [
                "ESCALATE SITE SEARCH: no viable permanent site within radius — "
                "contact NDMA / state housing board for emergency land allocation",
            ]

    elif h == "SHORT_TERM":
        items += [
            "Begin infrastructure preparation at relocation site (access road, water supply)",
            "Conduct community consultation and consent mapping (Gram Sabha / ward meeting)",
            "Survey road connectivity and flood risk at matched site",
            "Prepare DPR for land acquisition / PM Awas Yojana / state housing scheme",
            "Install early-warning sensors (rain gauges, river level sensors) at habitation",
            "Enrol population in PMJJBY/PMSBY insurance before relocation commences",
        ]

    elif h == "MEDIUM_TERM":
        items += [
            "Initiate long-term resettlement planning — file DPR with state SDMA",
            "Conduct seasonal re-assessment; update scores after next monsoon",
            "Install inclinometers or river-level gauges for trend monitoring",
            "Engage Gram Panchayat for voluntary relocation interest mapping",
            "Identify local community volunteers for early-warning relay network",
            "Document habituation's vulnerability profile (§2.1) for planning grant applications",
        ]

    else:  # MONITOR
        items += [
            "Continue sensor/satellite/live-signal observation — no relocation required",
            "Conduct bi-annual REDZONE re-assessment (post-monsoon and pre-monsoon)",
            "Maintain community awareness of NDRF helpline and evacuation routes",
        ]

    if matched_site and h != "IMMEDIATE":
        items.append(f"Coordinate site preparation with management at: {matched_site}")
    elif not matched_site and h != "MONITOR":
        items.append("Escalate site search — no viable relocation site matched within radius")

    return items


@router.get(
    "/recommendations",
    response_model=RecommendationResponse,
    summary="Full recommendation set — action cards for all at-risk habitations",
)
def get_recommendations(
    min_urgency:      float = Query(default=0.0, ge=0.0, le=1.0),
    max_distance_km:  float = Query(default=100.0, ge=1.0, le=500.0),
    region_id:        Optional[int]  = Query(None),
    region_name:      Optional[str]  = Query(None),
    relocation_horizon: Optional[str] = Query(None, description="Filter: IMMEDIATE|SHORT_TERM|MEDIUM_TERM|MONITOR"),
    db: Session = Depends(get_db),
):
    """
    Runs the full pipeline:
      1. Fetch all zone scores (with cache/recompute)
      2. Run matching optimizer
      3. Build §2.2 horizon-branched action cards

    Returns the structured recommendation set for the Decision Panel.
    """
    # 1. Get all zones (uses cache)
    zones = list_zones(
        db=db,
        region_id=region_id,
        region_name=region_name,
        relocation_horizon=relocation_horizon,
    )
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
    from models import DecisionAudit

    # Pre-fetch latest decisions for habitations
    audits = db.query(DecisionAudit).order_by(DecisionAudit.timestamp.desc()).all()
    decisions_by_hab: dict[int, dict] = {}
    for a in audits:
        if a.habitation_id not in decisions_by_hab:
            decisions_by_hab[a.habitation_id] = {
                "decision_type": a.decision_type,
                "reason": a.reason,
                "operator": a.operator,
                "timestamp": a.timestamp.isoformat() + "Z",
            }

    for i, z in enumerate(filtered):
        site_id, site_name = site_map.get(z.habitation_id, (None, z.matched_site))
        is_rz = (z.permanent_habitation_status in ("UNSUITABLE", "CONDITIONAL")
                 or z.relocation_horizon in ("IMMEDIATE", "SHORT_TERM")
                 or z.hazard_score >= 0.55)
        cards.append(ActionCard(
            rank=i + 1,
            habitation_id=z.habitation_id,
            habitation_name=z.name,
            population=z.population,
            urgency_score=z.urgency_score,
            hazard_score=z.hazard_score,
            classification=z.classification,
            relocation_horizon=z.relocation_horizon,
            timeline=z.timeline,
            permanent_habitation_status=z.permanent_habitation_status,
            current_conditions=z.current_conditions,
            red_zone_status="RED_ZONE" if is_rz else None,
            action_items=_action_items(z.relocation_horizon, site_name),
            matched_site=site_name,
            matched_site_id=site_id,
            region_name=z.region_name,
            lat=z.lat,
            lon=z.lon,
            latest_decision=decisions_by_hab.get(z.habitation_id),
        ))

    # Count by horizon bucket
    all_zones_for_count = list_zones(db=db, region_id=region_id, region_name=region_name)
    immediate   = sum(1 for z in all_zones_for_count if z.relocation_horizon == "IMMEDIATE")
    short_term  = sum(1 for z in all_zones_for_count if z.relocation_horizon == "SHORT_TERM")
    medium_term = sum(1 for z in all_zones_for_count if z.relocation_horizon == "MEDIUM_TERM")
    monitor_c   = sum(1 for z in all_zones_for_count if z.relocation_horizon == "MONITOR")

    return RecommendationResponse(
        generated_at=datetime.utcnow().isoformat() + "Z",
        total_habitations=len(all_zones_for_count),
        immediate_count=immediate,
        short_term_count=short_term,
        medium_term_count=medium_term,
        monitor_count=monitor_c,
        action_cards=cards,
        optimizer_summary={
            "solver_used":              opt_result.solver_used,
            "solver_status":            opt_result.solver_status,
            "total_match_score":        opt_result.total_match_score,
            "total_population_matched": opt_result.total_population_matched,
            "unmatched_count":          opt_result.unmatched_count,
        },
    )


@router.post(
    "/recommendations/decision",
    response_model=dict,
    status_code=201,
    summary="Capture human-in-the-loop decision (APPROVE / MODIFY / OVERRIDE) (§6.3)",
)
def record_decision(
    req: DecisionRequest,
    db: Session = Depends(get_db),
):
    """
    §6.3: Human-in-the-loop final decision capture.
    Persists operator action, timestamp, and modification/override rationale.
    """
    from models import DecisionAudit

    d_type = (req.decision_type or req.decision or "APPROVE").upper()
    op = req.operator_name or req.operator or "SDMA Officer"
    rec = req.recommendation or "Relocation Recommendation"

    audit_details = req.details or {}
    if req.modified_site_id is not None:
        audit_details["modified_site_id"] = req.modified_site_id
    if req.recommendation_id:
        audit_details["recommendation_id"] = req.recommendation_id
    if req.habitation_name:
        audit_details["habitation_name"] = req.habitation_name

    audit = DecisionAudit(
        habitation_id=req.habitation_id,
        decision_type=d_type,
        recommendation=rec,
        reason=req.reason or f"SDMA {d_type} directive issued",
        operator=op,
        timestamp=datetime.utcnow(),
        details=audit_details,
    )
    db.add(audit)
    db.commit()
    try:
        db.refresh(audit)
        audit_id = audit.id
    except Exception:
        audit_id = 1

    return {
        "status": "recorded",
        "audit_id": audit_id,
        "decision": d_type,
        "decision_type": d_type,
        "habitation_id": req.habitation_id,
        "operator": op,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "message": f"Decision '{d_type}' recorded by {op}.",
    }


@router.get(
    "/recommendations/decisions",
    response_model=list[dict],
    summary="List audit log of human decisions (§6.3)",
)
def list_decisions(
    habitation_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    from models import DecisionAudit
    q = db.query(DecisionAudit).order_by(DecisionAudit.timestamp.desc())
    if habitation_id:
        q = q.filter(DecisionAudit.habitation_id == habitation_id)
    audits = q.limit(50).all()
    return [
        {
            "audit_id": a.id,
            "habitation_id": a.habitation_id,
            "decision_type": a.decision_type,
            "recommendation": a.recommendation,
            "reason": a.reason,
            "operator": a.operator,
            "timestamp": a.timestamp.isoformat() + "Z",
        }
        for a in audits
    ]


@router.get(
    "/recommendations/synthesis",
    response_model=dict,
    summary="Generate contextual, evidence-grounded AI Decision Brief (§10)",
)
def get_recommendation_synthesis(
    region_id: Optional[int] = Query(None),
    region_name: Optional[str] = Query(None),
    habitation_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Contextual AI Decision Synthesis (Tier 10, §10.1 - §10.7).
    Deterministic interpretation of verified REDZONE engine outputs into an
    authoritative 12-field SDMA Decision Brief.
    """
    from scoring.ai_decision_engine import synthesize_ai_decision
    from scoring.capacity_engine import compute_capacity_gap_analysis
    from models import CandidateSite

    # Fetch zones
    zones = list_zones(db=db, region_id=region_id, region_name=region_name)
    if not zones:
        brief = synthesize_ai_decision(
            area_name=region_name or "Area",
            current_conditions="LIVE",
            max_hazard_score=0.2,
            exposed_population=0,
            relocation_demand=0,
        )
        return brief.to_dict()

    if habitation_id:
        target_zones = [z for z in zones if z.habitation_id == habitation_id]
        if not target_zones:
            target_zones = zones
    else:
        target_zones = zones

    max_hazard = max((z.hazard_score for z in target_zones), default=0.0)
    immediate_count = sum(1 for z in target_zones if z.relocation_horizon == "IMMEDIATE")
    red_zone_count = sum(
        1 for z in target_zones
        if z.permanent_habitation_status in ("UNSUITABLE", "CONDITIONAL")
        or z.relocation_horizon in ("IMMEDIATE", "SHORT_TERM")
        or z.hazard_score >= 0.55
    )

    exposed_pop = sum(z.population for z in target_zones if z.hazard_score >= 0.55)
    high_vuln_pop = int(round(exposed_pop * 0.28))
    relocation_demand = sum(
        z.population for z in target_zones
        if z.relocation_horizon in ("IMMEDIATE", "SHORT_TERM") or z.permanent_habitation_status == "UNSUITABLE"
    )

    # Fetch candidate sites
    sites_q = db.query(CandidateSite)
    if region_id:
        sites_q = sites_q.filter(CandidateSite.region_id == region_id)
    sites = [s.to_dict() for s in sites_q.all()]

    cap_report = compute_capacity_gap_analysis(
        relocation_demand=relocation_demand,
        candidate_sites=sites,
    )

    area_title = region_name or (target_zones[0].region_name if target_zones else "Regional SDMA Command")
    nearest_site_name = sites[0]["name"] if sites else "Designated Safe Site"

    brief = synthesize_ai_decision(
        area_name=area_title,
        primary_hazard="flood",
        current_conditions="LIVE",
        max_hazard_score=max_hazard,
        exposed_population=exposed_pop,
        high_vuln_population=high_vuln_pop,
        relocation_demand=relocation_demand,
        total_available_capacity=cap_report.total_available_capacity,
        capacity_gap_or_headroom=cap_report.headroom_or_gap,
        capacity_status=cap_report.status,
        recommended_transport_mode="ROAD" if max_hazard < 0.75 else "HYBRID",
        road_passable=(max_hazard < 0.75),
        nearest_safe_site=nearest_site_name,
        red_zone_count=red_zone_count,
        immediate_count=immediate_count,
    )
    return brief.to_dict()

