# backend/api/areas.py
# FastAPI router — /api/areas
#
# Provides geographic context for a searched location.
# This allows the frontend to determine what data is available
# for a given area without assuming Assam/Majuli defaults.
# ============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Habitation, CandidateSite, get_db
from scoring.prioritization_engine import haversine_km

log = logging.getLogger(__name__)
router = APIRouter(tags=["areas"])


class AreaContextResponse(BaseModel):
    lat: float
    lon: float
    radius_km: float
    # Counts of data available in this area
    habitation_count: int
    site_count: int
    has_zone_data: bool
    has_site_data: bool
    # Data coverage note
    coverage_note: str
    # Pilot data note — are we returning real or pilot data?
    data_status: str   # 'REAL' | 'PILOT_ONLY' | 'NONE'


@router.get(
    "/areas/context",
    response_model=AreaContextResponse,
    summary="Get data availability context for a geographic area",
)
def area_context(
    lat:       float = Query(..., description="Center latitude"),
    lon:       float = Query(..., description="Center longitude"),
    radius_km: float = Query(100.0, description="Search radius in km"),
    db: Session = Depends(get_db),
):
    """
    Returns what REDZONE data is available for a geographic area.
    Used by the frontend to decide whether to show real data or
    indicate that only pilot/demo data is available.

    This endpoint is honest: it never fabricates coverage.
    """
    # Count habitations within radius
    all_habs = db.query(Habitation).all()
    hab_count = 0
    for hab in all_habs:
        row = db.execute(
            text("SELECT ST_Y(geom), ST_X(geom) FROM habitations WHERE id = :id"),
            {"id": hab.id}
        ).fetchone()
        if row:
            h_lat, h_lon = float(row[0]), float(row[1])
            if haversine_km(lat, lon, h_lat, h_lon) <= radius_km:
                hab_count += 1

    # Count sites within radius
    all_sites = db.query(CandidateSite).all()
    site_count = 0
    for site in all_sites:
        row = db.execute(
            text("SELECT ST_Y(geom), ST_X(geom) FROM candidate_sites WHERE id = :id"),
            {"id": site.id}
        ).fetchone()
        if row:
            s_lat, s_lon = float(row[0]), float(row[1])
            if haversine_km(lat, lon, s_lat, s_lon) <= radius_km:
                site_count += 1

    if hab_count == 0 and site_count == 0:
        data_status = "NONE"
        coverage_note = (
            f"No REDZONE habitation or site data found within {radius_km:.0f} km of this location. "
            "The platform currently holds pilot data for select districts. "
            "Risk scores, priority queues, and safe sites will not be available."
        )
    elif hab_count > 0:
        data_status = "REAL"
        coverage_note = (
            f"{hab_count} habitation records and {site_count} candidate sites "
            f"found within {radius_km:.0f} km. Scoring uses the REDZONE hazard and capacity engines."
        )
    else:
        data_status = "PILOT_ONLY"
        coverage_note = (
            f"Candidate sites found ({site_count}) but no habitation records "
            f"within {radius_km:.0f} km."
        )

    return AreaContextResponse(
        lat=lat,
        lon=lon,
        radius_km=radius_km,
        habitation_count=hab_count,
        site_count=site_count,
        has_zone_data=hab_count > 0,
        has_site_data=site_count > 0,
        coverage_note=coverage_note,
        data_status=data_status,
    )
