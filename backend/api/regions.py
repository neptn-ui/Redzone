# backend/api/regions.py
# FastAPI router — /api/regions
#
# §0.5 Multi-region API: returns all active regions with basic statistics.
# §2.10 Multi-region SDMA: /api/regions/compare aggregates across regions.
#
# These endpoints answer: "Which parts of India does REDZONE cover right now?"
# and "How do the active regions compare on relocation horizon counts?"
# ============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import (
    Region, Habitation, CandidateSite, ZoneScore,
    RelocationHorizon, get_db,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["regions"])


# ============================================================================
# Pydantic models
# ============================================================================

class RegionStats(BaseModel):
    id:                  int
    name:                str
    state:               str
    country:             str
    center_lat:          float
    center_lon:          float
    bounding_radius_km:  float
    primary_hazard_types: list
    data_status:         str
    habitation_count:    int
    site_count:          int
    immediate_count:     int    # habitations with IMMEDIATE horizon
    short_term_count:    int
    medium_term_count:   int
    monitor_count:       int
    total_at_risk_population: int


class RegionComparison(BaseModel):
    regions: list[RegionStats]
    national_summary: dict


# ============================================================================
# Routes
# ============================================================================

@router.get(
    "/regions",
    response_model=list[RegionStats],
    summary="§0.5 — List active regions with basic statistics",
)
def list_regions(db: Session = Depends(get_db)):
    """
    Returns all ACTIVE/PILOT regions with habitation_count, site_count,
    and relocation_horizon breakdown.  This is the platform's top-level
    "which parts of India does REDZONE cover right now" endpoint.
    """
    regions = (
        db.query(Region)
        .filter(Region.data_status.in_(["ACTIVE", "PILOT"]))
        .all()
    )
    result = []
    for r in regions:
        hab_count  = db.query(Habitation).filter(Habitation.region_id == r.id).count()
        site_count = db.query(CandidateSite).filter(CandidateSite.region_id == r.id).count()

        # Count habitations per horizon bucket for this region
        def _horizon_count(horizon_val: str) -> int:
            return (
                db.query(ZoneScore)
                .join(Habitation, ZoneScore.habitation_id == Habitation.id)
                .filter(Habitation.region_id == r.id,
                        ZoneScore.relocation_horizon == horizon_val)
                .count()
            )

        # Total at-risk population (IMMEDIATE + SHORT_TERM habitations)
        at_risk_pop = (
            db.query(func.sum(Habitation.population))
            .join(ZoneScore, ZoneScore.habitation_id == Habitation.id)
            .filter(Habitation.region_id == r.id,
                    ZoneScore.relocation_horizon.in_(
                        [RelocationHorizon.IMMEDIATE, RelocationHorizon.SHORT_TERM]
                    ))
            .scalar()
        ) or 0

        result.append(RegionStats(
            id=r.id,
            name=r.name,
            state=r.state,
            country=r.country,
            center_lat=r.center_lat,
            center_lon=r.center_lon,
            bounding_radius_km=r.bounding_radius_km,
            primary_hazard_types=r.primary_hazard_types or [],
            data_status=r.data_status,
            habitation_count=hab_count,
            site_count=site_count,
            immediate_count=_horizon_count("IMMEDIATE"),
            short_term_count=_horizon_count("SHORT_TERM"),
            medium_term_count=_horizon_count("MEDIUM_TERM"),
            monitor_count=_horizon_count("MONITOR"),
            total_at_risk_population=int(at_risk_pop),
        ))

    return result


@router.get(
    "/regions/{region_id}",
    response_model=RegionStats,
    summary="Get one region's statistics",
)
def get_region(region_id: int, db: Session = Depends(get_db)):
    r = db.get(Region, region_id)
    if not r:
        raise HTTPException(status_code=404, detail=f"Region {region_id} not found")

    regions_list = list_regions(db=db)
    for rs in regions_list:
        if rs.id == region_id:
            return rs
    raise HTTPException(status_code=404, detail=f"Region {region_id} not in active set")


@router.get(
    "/regions/compare",
    response_model=RegionComparison,
    summary="§2.10 — Compare all active regions on relocation horizon and hazard coverage",
)
def compare_regions(db: Session = Depends(get_db)):
    """
    Aggregates priority queues and relocation-horizon summaries across ALL
    active regions in the `regions` table.

    This makes the "state-level and eventually national-level SDMA usability"
    claim real: Indian states manage multiple districts, and the Union
    government coordinates across states.  This endpoint grows automatically
    as new regions are added — no code change needed.
    """
    region_stats = list_regions(db=db)

    # National totals
    national = {
        "IMMEDIATE":   {"count": 0, "total_population": 0},
        "SHORT_TERM":  {"count": 0, "total_population": 0},
        "MEDIUM_TERM": {"count": 0, "total_population": 0},
        "MONITOR":     {"count": 0, "total_population": 0},
    }

    for rs in region_stats:
        # For national counts we need population too; join
        for horizon_key, count_attr in [
            ("IMMEDIATE",   "immediate_count"),
            ("SHORT_TERM",  "short_term_count"),
            ("MEDIUM_TERM", "medium_term_count"),
            ("MONITOR",     "monitor_count"),
        ]:
            c = getattr(rs, count_attr)
            national[horizon_key]["count"] += c

        national["IMMEDIATE"]["total_population"]   += 0  # populated below
        national["SHORT_TERM"]["total_population"]  += rs.total_at_risk_population

    # Recompute national population totals properly
    for horizon_key, horizon_val in [
        ("IMMEDIATE",   RelocationHorizon.IMMEDIATE),
        ("SHORT_TERM",  RelocationHorizon.SHORT_TERM),
        ("MEDIUM_TERM", RelocationHorizon.MEDIUM_TERM),
        ("MONITOR",     RelocationHorizon.MONITOR),
    ]:
        pop = (
            db.query(func.sum(Habitation.population))
            .join(ZoneScore, ZoneScore.habitation_id == Habitation.id)
            .filter(ZoneScore.relocation_horizon == horizon_val)
            .scalar()
        ) or 0
        national[horizon_key]["total_population"] = int(pop)

    return RegionComparison(
        regions=region_stats,
        national_summary=national,
    )
