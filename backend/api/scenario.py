# backend/api/scenario.py
# FastAPI router — /api/scenario
# What-If Scenario Lab API router.
# ============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models import Habitation, CandidateSite, get_db
from scoring.hazard_engine import compute_hazard_score_from_raw
from scoring.capacity_engine import compute_capacity_score_from_raw
from scoring.prioritization_engine import (
    compute_urgency_score, compute_population_exposure_norm,
    SITE_FACTOR_WITH_SITE,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["scenario"])


class ScenarioAreaRequest(BaseModel):
    lat: float
    lon: float
    radius_km: float = 100.0
    rainfall_mm_24h: float = 0.0
    river_level_delta_m: float = 0.0
    soil_saturation_pct: float = 0.0


@router.post(
    "/scenario/what-if",
    summary="Bulk what-if scenario for an area",
)
def what_if_area(
    req: ScenarioAreaRequest,
    db: Session = Depends(get_db),
):
    """
    Runs the scoring pipeline entirely in memory with custom inputs for an entire area.
    Does NOT write to the database — safe for repeated UI exploration.
    """
    from api.zones import _score_habitation, ZoneSummary, _hab_coords
    from scoring.prioritization_engine import haversine_km

    habs  = db.query(Habitation).all()
    sites = db.query(CandidateSite).all()

    # Convert frontend params to backend overrides
    overrides = {}
    if req.rainfall_mm_24h > 0:
        overrides["live_rainfall_mm_per_hr"] = req.rainfall_mm_24h / 24.0
    if req.soil_saturation_pct > 0:
        overrides["live_rainfall_mm_per_hr"] = (req.soil_saturation_pct / 100.0) * 50.0  # Proxy
    
    results = []
    for hab in habs:
        hab_lat, hab_lon = _hab_coords(hab, db)
        if haversine_km(req.lat, req.lon, hab_lat, hab_lon) > req.radius_km:
            continue
            
        zs = _score_habitation(hab, db, sites, hab_lat, hab_lon, overrides=overrides)
        
        site_name = None
        if zs.matched_site_id:
            s = db.get(CandidateSite, zs.matched_site_id)
            if s: site_name = s.name
            
        results.append({
            "habitation_id": hab.id,
            "name": hab.name,
            "population": hab.population,
            "district": hab.district,
            "lat": hab_lat, "lon": hab_lon,
            "hazard_score": round(float(zs.hazard_score), 4),
            "urgency_score": round(float(zs.urgency_score), 4),
            "classification": zs.classification.value,
            "timeline": zs.explanation_json.get("urgency", {}).get("timeline", ""),
            "matched_site": site_name,
            "computed_at": zs.computed_at.isoformat() + "Z",
        })
    return results
