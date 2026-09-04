# backend/api/sites.py
# FastAPI router — /api/sites
#
# Exposes candidate relocation sites with live capacity scores computed
# from capacity_engine.py. Read-only in this version; a POST endpoint
# is included for admin seeding (behind a future auth guard).
# ============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import CandidateSite, get_db
from scoring.capacity_engine import compute_capacity_score_from_raw, CapacityResult
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
    available_land_sqm:   float
    slope_degrees:        float
    distance_to_road_km:  float
    distance_to_water_km: float
    existing_occupancy:   int
    max_capacity_estimate: int
    available_capacity:   int
    capacity_score:       float
    distance_from_joshimath_km: Optional[float]
    data_source:          str


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

@router.get(
    "/sites",
    response_model=list[SiteSummary],
    summary="List all candidate relocation sites with capacity scores",
)
def list_sites(
    min_capacity_score: float = Query(default=0.0, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
):
    """
    Returns all candidate sites with live capacity scores from capacity_engine.
    Answers: WHERE can displaced populations go?
    """
    sites = db.query(CandidateSite).all()
    out: list[SiteSummary] = []
    for site in sites:
        result = _score_site(site)
        if result.capacity_score < min_capacity_score:
            continue
        lat, lon = _site_coords(site, db)
        out.append(SiteSummary(
            site_id=site.id,
            name=site.name,
            lat=lat,
            lon=lon,
            district=site.district,
            available_land_sqm=site.available_land_sqm,
            slope_degrees=site.slope_degrees,
            distance_to_road_km=site.distance_to_road_km,
            distance_to_water_km=site.distance_to_water_km,
            existing_occupancy=site.existing_occupancy,
            max_capacity_estimate=site.max_capacity_estimate,
            available_capacity=result.available_capacity,
            capacity_score=round(result.capacity_score, 4),
            distance_from_joshimath_km=site.distance_from_joshimath_km,
            data_source=site.data_source,
        ))
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
    return SiteDetail(
        site_id=site.id,
        name=site.name,
        lat=lat,
        lon=lon,
        district=site.district,
        available_land_sqm=site.available_land_sqm,
        slope_degrees=site.slope_degrees,
        distance_to_road_km=site.distance_to_road_km,
        distance_to_water_km=site.distance_to_water_km,
        existing_occupancy=site.existing_occupancy,
        max_capacity_estimate=site.max_capacity_estimate,
        available_capacity=result.available_capacity,
        capacity_score=round(result.capacity_score, 4),
        distance_from_joshimath_km=site.distance_from_joshimath_km,
        data_source=site.data_source,
        capacity_breakdown=result.to_explanation_json(),
    )


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
    db: Session = Depends(get_db),
):
    """
    Returns sites within radius_km of the given coordinate, filtered by
    min_capacity_score. Used by the map's "Find nearest safe site" feature.
    """
    sites  = db.query(CandidateSite).all()
    out: list[SiteSummary] = []
    for site in sites:
        result = _score_site(site)
        if result.capacity_score < min_capacity_score:
            continue
        s_lat, s_lon = _site_coords(site, db)
        d = haversine_km(lat, lon, s_lat, s_lon)
        if d > radius_km:
            continue
        out.append(SiteSummary(
            site_id=site.id,
            name=site.name,
            lat=s_lat, lon=s_lon,
            district=site.district,
            available_land_sqm=site.available_land_sqm,
            slope_degrees=site.slope_degrees,
            distance_to_road_km=site.distance_to_road_km,
            distance_to_water_km=site.distance_to_water_km,
            existing_occupancy=site.existing_occupancy,
            max_capacity_estimate=site.max_capacity_estimate,
            available_capacity=result.available_capacity,
            capacity_score=round(result.capacity_score, 4),
            distance_from_joshimath_km=site.distance_from_joshimath_km,
            data_source=site.data_source,
        ))
    out.sort(key=lambda s: s.capacity_score, reverse=True)
    return out
