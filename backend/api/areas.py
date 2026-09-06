# backend/api/areas.py
# FastAPI router — /api/areas
#
# Provides geographic context for a searched location.
# This allows the frontend to determine what data is available
# for a given area without assuming any specific region defaults.
#
# §0.5: area_context() returns which region_id/region_name a queried lat/lon
# falls under, sourced from the regions table's center+radius — no hardcoded
# coordinates or region-specific logic.
# ============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Habitation, CandidateSite, Region, get_db
from scoring.prioritization_engine import haversine_km

log = logging.getLogger(__name__)
router = APIRouter(tags=["areas"])


class AreaContextResponse(BaseModel):
    display_name:        Optional[str] = None
    lat:                 float
    lon:                 float
    lng:                 float
    radius_km:           float
    country:             Optional[str] = None
    state:               Optional[str] = None
    district:            Optional[str] = None
    resolution_source:   str = "Coordinates"
    # Counts of data available in this area
    habitation_count:    int
    site_count:          int
    has_zone_data:       bool
    has_site_data:       bool
    # Tier 0.1 / 0.3 — which region(s) this lat/lon genuinely falls under (nullable, zero fallback)
    matched_region_id:   Optional[int]  = None
    matched_region_name: Optional[str]  = None
    is_seeded:           bool = False
    # Data coverage note
    coverage_note:       str
    # Pilot data note — are we returning real or pilot data?
    data_status:         str   # 'REAL' | 'PILOT_ONLY' | 'NONE'


@router.get(
    "/areas/context",
    response_model=AreaContextResponse,
    summary="Get data availability context for a geographic area (§0.1, §0.3)",
)
def area_context(
    lat:          float = Query(..., description="Center latitude"),
    lon:          float = Query(..., description="Center longitude"),
    radius_km:    float = Query(100.0, description="Search radius in km"),
    display_name: Optional[str] = Query(None),
    country:      Optional[str] = Query(None),
    state:        Optional[str] = Query(None),
    district:     Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Tier 0.1, 0.3: Canonical AreaContext resolution.
    A Region must NEVER determine where the user actually is.
    If no seeded Region exists for the geocoded location:
      matched_region_id = None, matched_region_name = None, is_seeded = False.
    Strictly prohibits:
      - no match -> nearest Region
      - no match -> previous Region
      - Nepal -> closest known region -> Chamoli
    """
    matched_region_id: Optional[int] = None
    matched_region_name: Optional[str] = None
    active_regions = (
        db.query(Region)
        .filter(Region.data_status.in_(["ACTIVE", "PILOT"]))
        .all()
    )
    for r in active_regions:
        dist = haversine_km(lat, lon, r.center_lat, r.center_lon)
        if dist <= r.bounding_radius_km:
            matched_region_id   = r.id
            matched_region_name = r.name
            break  # genuine spatial containment only

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
        display_name=display_name or f"{lat:.4f}, {lon:.4f}",
        lat=lat,
        lon=lon,
        lng=lon,
        radius_km=radius_km,
        country=country,
        state=state,
        district=district,
        resolution_source="Nominatim / OpenStreetMap" if display_name else "Coordinates",
        habitation_count=hab_count,
        site_count=site_count,
        has_zone_data=hab_count > 0,
        has_site_data=site_count > 0,
        matched_region_id=matched_region_id,
        matched_region_name=matched_region_name,
        is_seeded=matched_region_id is not None,
        coverage_note=coverage_note,
        data_status=data_status,
    )
