# backend/api/scenario.py
# FastAPI router — /api/scenario
# What-If Scenario Lab API router.
# ============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from scoring.hazard_engine import compute_hazard_score_from_raw
from scoring.capacity_engine import compute_capacity_score_from_raw
from scoring.prioritization_engine import (
    compute_urgency_score, compute_population_exposure_norm,
    SITE_FACTOR_WITH_SITE,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["scenario"])


class ScenarioHabitationInput(BaseModel):
    name:                   str = "Custom Habitation"
    intensity_class:        int   = Field(default=3,   ge=0, le=5)
    event_count:            int   = Field(default=1,   ge=0)
    max_severity_ever:      int   = Field(default=3,   ge=1, le=5)
    slope_degrees:          float = Field(default=15.0, ge=0.0, le=90.0)
    distance_to_hazard_km:  float = Field(default=2.0,  ge=0.0)
    sar_deformation_cm_yr:  float = Field(default=0.5,  ge=0.0)
    ndvi_delta:             float = Field(default=-0.05)
    live_rainfall_mm_per_hr: float = Field(default=0.0, ge=0.0)
    live_seismic_magnitude:  float = Field(default=0.0, ge=0.0)
    population:              int   = Field(default=1000, ge=0)
    site_availability_factor: float = Field(default=1.0, ge=0.6, le=1.0)


class ScenarioSiteInput(BaseModel):
    name:                 str   = "Custom Site"
    available_land_sqm:   float = Field(default=50_000.0, ge=0.0)
    slope_degrees:        float = Field(default=10.0, ge=0.0, le=90.0)
    distance_to_road_km:  float = Field(default=1.0,  ge=0.0)
    distance_to_water_km: float = Field(default=1.5,  ge=0.0)
    existing_occupancy:   int   = Field(default=0,    ge=0)
    max_capacity_estimate: Optional[int] = None


class ScenarioRequest(BaseModel):
    habitation: ScenarioHabitationInput = ScenarioHabitationInput()
    site:       Optional[ScenarioSiteInput] = None


class ScenarioResult(BaseModel):
    habitation_name:     str
    hazard_score:        float
    classification:      str
    classification_label: str
    urgency_score:       float
    timeline:            str
    live_trigger_mult:   float
    capacity_score:      Optional[float]
    available_capacity:  Optional[int]
    hazard_breakdown:    dict
    capacity_breakdown:  Optional[dict]
    urgency_breakdown:   dict


@router.post(
    "/scenario/what-if",
    response_model=ScenarioResult,
    summary="What-if scenario: change any input and see score impact (no DB write)",
)
def what_if(req: ScenarioRequest):
    """
    Runs the scoring pipeline entirely in memory with custom inputs.
    Does NOT write to the database — safe for repeated UI exploration.

    Use this to answer: 'What happens to Joshimath's score if rainfall
    reaches 80 mm/hr?' or 'If we flatten Koti Farm to 5°, how much
    does capacity improve?'
    """
    h = req.habitation

    # Hazard score
    hazard_result = compute_hazard_score_from_raw(
        habitation_name=h.name,
        intensity_class=h.intensity_class,
        event_count=h.event_count,
        max_severity_ever=h.max_severity_ever,
        slope_degrees=h.slope_degrees,
        distance_to_hazard_km=h.distance_to_hazard_km,
        sar_deformation_cm_yr=h.sar_deformation_cm_yr,
        ndvi_delta=h.ndvi_delta,
        live_rainfall_mm_per_hr=h.live_rainfall_mm_per_hr,
        live_seismic_magnitude=h.live_seismic_magnitude,
    )

    # Capacity score (optional)
    cap_score = None
    cap_avail = None
    cap_breakdown = None
    if req.site:
        s = req.site
        cap_result = compute_capacity_score_from_raw(
            site_name=s.name,
            available_land_sqm=s.available_land_sqm,
            slope_degrees=s.slope_degrees,
            distance_to_road_km=s.distance_to_road_km,
            distance_to_water_km=s.distance_to_water_km,
            existing_occupancy=s.existing_occupancy,
            max_capacity_estimate=s.max_capacity_estimate,
        )
        cap_score     = round(cap_result.capacity_score, 4)
        cap_avail     = cap_result.available_capacity
        cap_breakdown = cap_result.to_explanation_json()

    # Urgency score
    pop_norm = compute_population_exposure_norm(h.population, exposed_fraction=1.0)
    urgency_result = compute_urgency_score(
        habitation_name=h.name,
        hazard_score=hazard_result.final_hazard_score,
        population_exposure_norm=pop_norm,
        site_availability_factor=h.site_availability_factor,
    )

    return ScenarioResult(
        habitation_name=h.name,
        hazard_score=round(hazard_result.final_hazard_score, 4),
        classification=hazard_result.classification,
        classification_label=hazard_result.classification_label,
        urgency_score=round(urgency_result.urgency_score, 4),
        timeline=urgency_result.timeline_label,
        live_trigger_mult=round(hazard_result.live_trigger_multiplier, 4),
        capacity_score=cap_score,
        available_capacity=cap_avail,
        hazard_breakdown=hazard_result.to_explanation_json(),
        capacity_breakdown=cap_breakdown,
        urgency_breakdown=urgency_result.to_explanation_json(),
    )
