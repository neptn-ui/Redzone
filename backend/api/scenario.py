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
from scoring.scenario_engine import run_scenario_simulation

log = logging.getLogger(__name__)
router = APIRouter(tags=["scenario"])


class ScenarioAreaRequest(BaseModel):
    lat: float
    lon: float
    radius_km: float = 100.0
    rainfall_mm_24h: float = 0.0
    river_level_delta_m: float = 0.0
    soil_saturation_pct: float = 0.0
    hazard_type: str = "flood"


@router.post(
    "/scenario/what-if",
    summary="Full Spatial Counterfactual Scenario Simulation (Tier 9)",
)
def what_if_area(
    req: ScenarioAreaRequest,
    db: Session = Depends(get_db),
):
    """
    Tier 9: Runs the full Spatial Counterfactual Scenario Simulation entirely in memory.
    Recalculates hazard, generates simulated flood extent geometry, intersects
    population grid, computes capacity gap, evaluates multimodal transport,
    and synthesizes an evidence-grounded AI Decision Brief.
    """
    from api.zones import _hab_coords, _site_coords

    habs = db.query(Habitation).all()
    sites = db.query(CandidateSite).all()

    habs_data = []
    for h in habs:
        h_lat, h_lon = _hab_coords(h, db)
        habs_data.append({
            "id": h.id,
            "name": h.name,
            "lat": h_lat,
            "lon": h_lon,
            "population": h.population,
            "district": h.district,
            "slope_degrees": h.slope_degrees or 1.0,
            "distance_to_hazard_km": h.distance_to_hazard_km or 2.0,
        })

    sites_data = []
    for s in sites:
        s_lat, s_lon = _site_coords(s, db)
        sites_data.append({
            "id": s.id,
            "name": s.name,
            "lat": s_lat,
            "lon": s_lon,
            "max_capacity_estimate": s.max_capacity_estimate,
            "existing_occupancy": s.existing_occupancy,
            "committed_population": s.committed_population or 0,
            "hazard_free": s.hazard_free,
        })

    result = run_scenario_simulation(
        center_lat=req.lat,
        center_lon=req.lon,
        radius_km=req.radius_km,
        rainfall_mm_24h=req.rainfall_mm_24h,
        river_level_delta_m=req.river_level_delta_m,
        soil_saturation_pct=req.soil_saturation_pct,
        hazard_type=req.hazard_type,
        habitations_data=habs_data,
        sites_data=sites_data,
    )

    return result
