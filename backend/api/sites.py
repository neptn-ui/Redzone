# backend/api/sites.py
# FastAPI router — /api/sites
#
# Exposes candidate relocation sites with live capacity scores computed
# from capacity_engine.py.
#
# §0.5: region_id/region_name filter parameters added.
# §2.3: hazard_free flag and overlapping_hazard_zone_id exposed in SiteSummary.
# §2.9: available_capacity deducts committed_population.
# ============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import CandidateSite, Region, get_db
from scoring.capacity_engine import (
    compute_capacity_score_from_raw,
    compute_capacity_gap_analysis,
    CapacityResult,
)
from scoring.prioritization_engine import haversine_km

log = logging.getLogger(__name__)
router = APIRouter(tags=["sites"])


# ============================================================================
# Pydantic models
# ============================================================================

class SiteSummary(BaseModel):
    site_id:              int
    name:                 str
    lat:                  float
    lon:                  float
    district:             str
    region_name:          str
    available_land_sqm:   float
    slope_degrees:        float
    distance_to_road_km:  float
    distance_to_water_km: float
    existing_occupancy:   int
    committed_population: int
    max_capacity_estimate: int
    available_capacity:   int
    capacity_score:       float
    data_source:          str
    # §2.3 hazard-free verification
    hazard_free:                Optional[bool] = None   # None = not yet checked
    overlapping_hazard_zone_id: Optional[int]  = None


class SiteDetail(SiteSummary):
    capacity_breakdown: dict   # full §6 audit trail from capacity_engine


class NearbyRequest(BaseModel):
    lat:             float
    lon:             float
    radius_km:       float = 100.0
    min_capacity_score: float = 0.0


# ============================================================================
# Helpers
# ============================================================================

def _site_coords(site: CandidateSite, db: Session) -> tuple[float, float]:
    row = db.execute(text(
        "SELECT ST_Y(geom), ST_X(geom) FROM candidate_sites WHERE id = :id"
    ), {"id": site.id}).fetchone()
    return (float(row[0]), float(row[1])) if row else (0.0, 0.0)


def _score_site(site: CandidateSite) -> CapacityResult:
    result = compute_capacity_score_from_raw(
        site_name=site.name,
        available_land_sqm=site.available_land_sqm,
        slope_degrees=site.slope_degrees,
        distance_to_road_km=site.distance_to_road_km,
        distance_to_water_km=site.distance_to_water_km,
        existing_occupancy=site.existing_occupancy,
        max_capacity_estimate=site.max_capacity_estimate,
    )
    return result


# ============================================================================
# Routes
# ============================================================================

def _build_summary(site: CandidateSite, lat: float, lon: float,
                   result: CapacityResult, region_name: str) -> SiteSummary:
    avail = (site.max_capacity_estimate
             - site.existing_occupancy
             - (site.committed_population or 0))
    return SiteSummary(
        site_id=site.id,
        name=site.name,
        lat=lat, lon=lon,
        district=site.district,
        region_name=region_name,
        available_land_sqm=site.available_land_sqm,
        slope_degrees=site.slope_degrees,
        distance_to_road_km=site.distance_to_road_km,
        distance_to_water_km=site.distance_to_water_km,
        existing_occupancy=site.existing_occupancy,
        committed_population=site.committed_population or 0,
        max_capacity_estimate=site.max_capacity_estimate,
        available_capacity=avail,
        capacity_score=round(result.capacity_score, 4),
        data_source=site.data_source,
        hazard_free=site.hazard_free,
        overlapping_hazard_zone_id=site.overlapping_hazard_zone_id,
    )


@router.get(
    "/sites",
    response_model=list[SiteSummary],
    summary="List all candidate relocation sites with capacity scores",
)
def list_sites(
    min_capacity_score: float = Query(default=0.0, ge=0.0, le=1.0),
    region_id:   Optional[int] = Query(None, description="Filter by region.id"),
    region_name: Optional[str] = Query(None, description="Filter by region.name"),
    hazard_free_only: bool = Query(False, description="Only return hazard-free sites"),
    db: Session = Depends(get_db),
):
    """
    Returns all candidate sites with live capacity scores from capacity_engine.
    Answers: WHERE can displaced populations go?
    """
    sites = db.query(CandidateSite).all()
    out: list[SiteSummary] = []
    for site in sites:
        # Region filters
        if region_id and site.region_id != region_id:
            continue
        if region_name:
            r = db.get(Region, site.region_id) if site.region_id else None
            if not r or r.name.lower() != region_name.lower():
                continue
        # §2.3 hazard-free filter
        if hazard_free_only and site.hazard_free is False:
            continue

        result = _score_site(site)
        if result.capacity_score < min_capacity_score:
            continue
        lat, lon = _site_coords(site, db)
        r_name = ""
        if site.region_id:
            r = db.get(Region, site.region_id)
            r_name = r.name if r else ""
        out.append(_build_summary(site, lat, lon, result, r_name))
    out.sort(key=lambda s: s.capacity_score, reverse=True)
    return out


@router.get(
    "/sites/{site_id}",
    response_model=SiteDetail,
    summary="Detail view for one candidate site (§6 capacity breakdown)",
)
def get_site(site_id: int, db: Session = Depends(get_db)):
    site = db.get(CandidateSite, site_id)
    if not site:
        raise HTTPException(status_code=404, detail=f"Site {site_id} not found")
    result = _score_site(site)
    lat, lon = _site_coords(site, db)
    r_name = ""
    if site.region_id:
        r = db.get(Region, site.region_id)
        r_name = r.name if r else ""
    summary = _build_summary(site, lat, lon, result, r_name)
    return SiteDetail(**summary.model_dump(), capacity_breakdown=result.to_explanation_json())


@router.get(
    "/sites/nearby",
    response_model=list[SiteSummary],
    summary="Find candidate sites within a radius of a given coordinate",
)
def sites_nearby(
    lat:                float = Query(..., description="WGS84 latitude"),
    lon:                float = Query(..., description="WGS84 longitude"),
    radius_km:          float = Query(default=100.0, ge=1.0, le=500.0),
    min_capacity_score: float = Query(default=0.0, ge=0.0, le=1.0),
    hazard_free_only:   bool  = Query(False),
    db: Session = Depends(get_db),
):
    """
    Returns sites within radius_km of the given coordinate, filtered by
    min_capacity_score. Used by the map's "Find nearest safe site" feature.
    """
    sites  = db.query(CandidateSite).all()
    out: list[SiteSummary] = []
    for site in sites:
        if hazard_free_only and site.hazard_free is False:
            continue
        result = _score_site(site)
        if result.capacity_score < min_capacity_score:
            continue
        s_lat, s_lon = _site_coords(site, db)
        d = haversine_km(lat, lon, s_lat, s_lon)
        if d > radius_km:
            continue
        r_name = ""
        if site.region_id:
            r = db.get(Region, site.region_id)
            r_name = r.name if r else ""
        out.append(_build_summary(site, s_lat, s_lon, result, r_name))
    out.sort(key=lambda s: s.capacity_score, reverse=True)
    return out


@router.get(
    "/sites/capacity-gap",
    summary="Compute capacity-gap analysis for relocation demand (Tier 4.2, 4.3)",
)
def capacity_gap_analysis(
    demand: int = Query(0, ge=0, description="Total exposed population demanding relocation"),
    region_id: Optional[int] = Query(None),
    region_name: Optional[str] = Query(None),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    radius_km: Optional[float] = Query(120.0),
    db: Session = Depends(get_db),
):
    query = db.query(CandidateSite)
    if region_id:
        query = query.filter(CandidateSite.region_id == region_id)
    if region_name:
        r = db.query(Region).filter(Region.name.ilike(region_name)).first()
        if r:
            query = query.filter(CandidateSite.region_id == r.id)

    sites = query.all()
    filtered_sites = []
    
    for s in sites:
        if s.hazard_free is False:
            continue
        if lat is not None and lon is not None and radius_km is not None:
            s_lat, s_lon = _site_coords(s, db)
            if haversine_km(lat, lon, s_lat, s_lon) > radius_km:
                continue
        filtered_sites.append({
            "name": s.name,
            "max_capacity_estimate": s.max_capacity_estimate,
            "existing_occupancy": s.existing_occupancy,
            "committed_population": s.committed_population or 0,
            "hazard_free": s.hazard_free,
            "data_source": s.data_source,
        })

    report = compute_capacity_gap_analysis(relocation_demand=demand, candidate_sites=filtered_sites)
    return report.to_dict()

