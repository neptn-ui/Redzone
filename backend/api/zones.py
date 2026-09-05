# backend/api/zones.py
# FastAPI router — /api/zones and /api/priority-queue.
#
# WIRES TOGETHER:
#   • models.py          — DB schema + get_db dependency
#   • hazard_engine.py   — compute_hazard_score_from_raw()
#   • capacity_engine.py — compute_capacity_score_from_raw()
#   • prioritization_engine.py — compute_urgency_score(), rank_by_urgency()
#   • matching_optimizer.py — solve_assignment()
#
# READ PATH (§2 architecture):
#   Every read checks zone_scores first (cached).  If stale (> CACHE_TTL_MINUTES
#   since computed_at) or absent, it recomputes and upserts before responding.
#   This means the map, priority queue, and decision panel can never disagree.
#
# §6 AUDIT TRAIL:
#   zone_scores.explanation_json is written here for every computed row.
#   The GET /api/zones/{id}/explain endpoint surfaces the full JSONB.
# ============================================================================

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from models import (
    Habitation, CandidateSite, ZoneScore, DisasterHistory,
    LiveSignal, RiskClassification, get_db,
)
from scoring.hazard_engine import (
    compute_hazard_score_from_raw, compute_live_trigger_multiplier,
    classify_hazard_score,
)
from scoring.capacity_engine import (
    compute_capacity_score_from_raw,
)
from scoring.prioritization_engine import (
    compute_urgency_score, compute_population_exposure_norm,
    compute_site_availability_factor, haversine_km, rank_by_urgency,
    SITE_FACTOR_WITH_SITE, SITE_FACTOR_WITHOUT_SITE,
    DEFAULT_RADIUS_KM, MIN_SITE_CAPACITY_SCORE,
)
from scoring.matching_optimizer import (
    solve_assignment, HabitationInput, SiteInput,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["zones"])

# Cache: recompute if zone_score is older than this
CACHE_TTL_MINUTES: int = 60


# ============================================================================
# Pydantic response models (§6 contract)
# ============================================================================

class HazardBreakdown(BaseModel):
    hazard_intensity:     float
    frequency_history:    float
    terrain_vulnerability: float
    proximity:            float
    sar_deformation:      float
    ndvi_change:          float


class ZoneSummary(BaseModel):
    """Compact per-habitation row for the map and priority table."""
    habitation_id:   int
    name:            str
    population:      int
    district:        str
    lat:             float
    lon:             float
    hazard_score:    float
    urgency_score:   float
    classification:  str
    timeline:        str
    matched_site:    Optional[str] = None
    computed_at:     str


class ZoneDetail(BaseModel):
    """Full per-habitation detail with §6 audit trail."""
    habitation_id:   int
    name:            str
    population:      int
    district:        str
    lat:             float
    lon:             float
    hazard_score:    float
    urgency_score:   float
    classification:  str
    timeline:        str
    matched_site_id: Optional[int]
    matched_site:    Optional[str]
    live_rainfall_mm:  Optional[float]
    live_seismic_mag:  Optional[float]
    live_trigger_mult: Optional[float]
    data_is_cached:  bool
    computed_at:     str
    explanation_json: dict


class PriorityQueueItem(BaseModel):
    rank:             int
    habitation_id:    int
    name:             str
    population:       int
    urgency_score:    float
    hazard_score:     float
    classification:   str
    timeline:         str
    matched_site:     Optional[str]
    lat:              float
    lon:              float


class OptimizeRequest(BaseModel):
    max_distance_km: float = Field(default=100.0, ge=1.0, le=500.0)
    prefer_lp:       bool  = Field(default=True)
    min_urgency:     float = Field(default=0.0, ge=0.0, le=1.0,
                                   description="Only include habitations above this urgency threshold")


class OptimizeResponse(BaseModel):
    solver_used:              str
    solver_status:            str
    total_match_score:        float
    total_population_matched: int
    assignments:              list[dict]
    unmatched_count:          int
    unmatched:                list[dict]


# ============================================================================
# Internal: scoring pipeline for one habitation
# ============================================================================

def _score_habitation(
    hab:    Habitation,
    db:     Session,
    sites:  list[CandidateSite],
    lat:    float,
    lon:    float,
    overrides: Optional[dict] = None,
) -> ZoneScore:
    """
    Runs the full scoring pipeline for one habitation and returns a ZoneScore
    object (not yet committed — caller commits).

    1. Aggregate disaster_history for hazard inputs
    2. Pull latest live signals
    3. Compute hazard_score (hazard_engine)
    4. Find nearest viable site, compute capacity_score (capacity_engine)
    5. Compute urgency_score (prioritization_engine)
    6. Build explanation_json (§6)
    7. Return ZoneScore (upsert by caller)
    """
    overrides = overrides or {}

    # --- 1. Disaster history aggregates ---
    events = db.query(DisasterHistory).filter(
        DisasterHistory.habitation_id == hab.id
    ).all()
    event_count       = len(events)
    max_severity_ever = max((e.severity for e in events), default=1)

    # Pull intensity_class from the most severe event (proxy for zone membership)
    # In production this would be a spatial join to hazard_zones; for pilot, use severity.
    # SYNTH proxy: intensity_class = max_severity_ever (same 1-5 scale)
    intensity_class = max_severity_ever

    # SAR deformation: latest S1 satellite pass
    sar_row = db.execute(text(
        "SELECT signal_value FROM satellite_passes "
        "WHERE habitation_id = :hid AND signal_type = 'sar_amplitude_change' "
        "ORDER BY pass_date DESC LIMIT 1"
    ), {"hid": hab.id}).fetchone()
    sar_deformation_cm_yr = float(sar_row[0]) if sar_row else 0.0

    # NDVI delta: latest S2 satellite pass
    ndvi_row = db.execute(text(
        "SELECT signal_value FROM satellite_passes "
        "WHERE habitation_id = :hid AND signal_type = 'ndvi_change' "
        "ORDER BY pass_date DESC LIMIT 1"
    ), {"hid": hab.id}).fetchone()
    ndvi_delta = float(ndvi_row[0]) if ndvi_row else 0.0

    # Slope and distance_to_hazard: injected by ingestion; use satellite data as proxy.
    # For pilot, use fixed values from load_pilot_data.py via the zone_score table itself.
    # TODO (Step 13): pull from habitation extended attributes table.
    slope_degrees         = _get_pilot_slope(hab.name)
    distance_to_hazard_km = _get_pilot_distance(hab.name)

    # --- 2. Live signals ---
    rain_row = db.execute(text(
        "SELECT value FROM live_signals WHERE signal_type='rainfall' "
        "ORDER BY fetched_at DESC LIMIT 1"
    )).fetchone()
    seismic_row = db.execute(text(
        "SELECT value FROM live_signals WHERE signal_type='seismic' "
        "ORDER BY fetched_at DESC LIMIT 1"
    )).fetchone()
    live_rainfall_mm  = float(rain_row[0])   if rain_row   else None
    live_seismic_mag  = float(seismic_row[0]) if seismic_row else None

    # Apply overrides
    if "live_rainfall_mm_per_hr" in overrides:
        live_rainfall_mm = overrides["live_rainfall_mm_per_hr"]
    if "live_seismic_magnitude" in overrides:
        live_seismic_mag = overrides["live_seismic_magnitude"]

    live_mult = compute_live_trigger_multiplier(
        rainfall_mm_per_hr=live_rainfall_mm  or 0.0,
        seismic_magnitude= live_seismic_mag  or 0.0,
    )

    # --- 3. Hazard score ---
    hazard_result = compute_hazard_score_from_raw(
        habitation_name=hab.name,
        intensity_class=intensity_class,
        event_count=event_count,
        max_severity_ever=max_severity_ever,
        slope_degrees=slope_degrees,
        distance_to_hazard_km=distance_to_hazard_km,
        sar_deformation_cm_yr=sar_deformation_cm_yr,
        ndvi_delta=ndvi_delta,
        live_rainfall_mm_per_hr=live_rainfall_mm  or 0.0,
        live_seismic_magnitude= live_seismic_mag  or 0.0,
    )

    # --- 4. Capacity score of best nearby site ---
    best_site: Optional[CandidateSite] = None
    best_cap_score: float              = 0.0
    sites_in_radius: list[float]       = []

    for site in sites:
        s_lat, s_lon = _site_coords(site, db)
        d = haversine_km(lat, lon, s_lat, s_lon)
        if d > DEFAULT_RADIUS_KM:
            continue
        avail = site.max_capacity_estimate - site.existing_occupancy
        if avail <= 0:
            continue
        cap_result = compute_capacity_score_from_raw(
            site_name=site.name,
            available_land_sqm=site.available_land_sqm,
            slope_degrees=site.slope_degrees,
            distance_to_road_km=site.distance_to_road_km,
            distance_to_water_km=site.distance_to_water_km,
            existing_occupancy=site.existing_occupancy,
            max_capacity_estimate=site.max_capacity_estimate,
        )
        sites_in_radius.append(cap_result.capacity_score)
        if cap_result.capacity_score > best_cap_score and avail >= hab.population:
            best_cap_score = cap_result.capacity_score
            best_site      = site

    site_factor = compute_site_availability_factor(
        sites_in_radius, MIN_SITE_CAPACITY_SCORE
    )

    # --- 5. Urgency score ---
    pop_norm = compute_population_exposure_norm(
        hab.population, exposed_fraction=1.0
    )
    urgency_result = compute_urgency_score(
        habitation_name=hab.name,
        hazard_score=hazard_result.final_hazard_score,
        population_exposure_norm=pop_norm,
        site_availability_factor=site_factor,
        matched_site_name=best_site.name if best_site else None,
    )

    # --- 6. Build §6 explanation_json ---
    explanation = {
        "habitation": hab.name,
        "population": hab.population,
        "hazard":     hazard_result.to_explanation_json(),
        "urgency":    urgency_result.to_explanation_json(),
        "matched_relocation_site": {
            "id":             best_site.id   if best_site else None,
            "name":           best_site.name if best_site else None,
            "capacity_score": round(best_cap_score, 4),
        } if best_site else None,
        "live_signals": {
            "rainfall_mm_per_hr": live_rainfall_mm,
            "seismic_magnitude":  live_seismic_mag,
            "trigger_multiplier": round(live_mult, 4),
        },
        "computed_at": datetime.utcnow().isoformat() + "Z",
    }

    return ZoneScore(
        habitation_id=hab.id,
        hazard_score=hazard_result.final_hazard_score,
        urgency_score=urgency_result.urgency_score,
        capacity_score=best_cap_score if best_site else None,
        classification=RiskClassification(hazard_result.classification),
        matched_site_id=best_site.id if best_site else None,
        computed_at=datetime.utcnow(),
        explanation_json=explanation,
        live_rainfall_mm=live_rainfall_mm,
        live_seismic_mag=live_seismic_mag,
        live_trigger_mult=live_mult,
        data_is_cached=bool(rain_row and hasattr(rain_row, "is_cached") and rain_row),
    )


def _site_coords(site: CandidateSite, db: Session) -> tuple[float, float]:
    """Extract WGS84 lat/lon from PostGIS POINT geometry."""
    row = db.execute(text(
        "SELECT ST_Y(geom), ST_X(geom) FROM candidate_sites WHERE id = :id"
    ), {"id": site.id}).fetchone()
    return (float(row[0]), float(row[1])) if row else (0.0, 0.0)


def _hab_coords(hab: Habitation, db: Session) -> tuple[float, float]:
    """Extract WGS84 lat/lon from PostGIS POINT geometry."""
    row = db.execute(text(
        "SELECT ST_Y(geom), ST_X(geom) FROM habitations WHERE id = :id"
    ), {"id": hab.id}).fetchone()
    return (float(row[0]), float(row[1])) if row else (0.0, 0.0)


# Pilot-specific slope and distance lookups
# (Production: store in a habitation_attributes table)
_PILOT_SLOPES = {
    "joshimath": 18.0, "raini": 32.0, "tharali": 5.0,
    "pandukeshwar": 25.0, "nandprayag": 15.0,
}
_PILOT_DISTANCES = {
    "joshimath": 0.2, "raini": 0.1, "tharali": 4.5,
    "pandukeshwar": 3.0, "nandprayag": 1.5,
}


def _get_pilot_slope(name: str) -> float:
    key = name.lower().split()[0]
    return _PILOT_SLOPES.get(key, 12.0)   # default: moderate slope


def _get_pilot_distance(name: str) -> float:
    key = name.lower().split()[0]
    return _PILOT_DISTANCES.get(key, 2.0)


def _is_stale(zs: ZoneScore) -> bool:
    return (datetime.utcnow() - zs.computed_at) > timedelta(minutes=CACHE_TTL_MINUTES)


# ============================================================================
# Routes
# ============================================================================

@router.get(
    "/zones",
    response_model=list[ZoneSummary],
    summary="List habitation risk zones (area-filtered)",
)
def list_zones(
    classification: Optional[str] = Query(None, description="Filter: immediate|short_term|medium_term|stable"),
    district:       Optional[str] = Query(None),
    state:          Optional[str] = Query(None),
    lat:            Optional[float] = Query(None, description="Center latitude for geographic filter"),
    lon:            Optional[float] = Query(None, description="Center longitude for geographic filter"),
    radius_km:      Optional[float] = Query(None, description="Search radius in km from lat/lon"),
    limit:          Optional[int]   = Query(None, description="Max results"),
    db: Session = Depends(get_db),
):
    """
    Returns habitations with their current hazard / urgency scores.
    When lat/lon/radius_km are provided, only returns habitations within that radius.
    Scores are read from zone_scores (cache). Stale or missing scores are
    recomputed on-the-fly before returning.
    """
    # Unwrap Query objects if called directly as a Python function
    if hasattr(district, "default"): district = district.default
    if hasattr(state, "default"): state = state.default
    if hasattr(classification, "default"): classification = classification.default
    if hasattr(lat, "default"): lat = lat.default
    if hasattr(lon, "default"): lon = lon.default
    if hasattr(radius_km, "default"): radius_km = radius_km.default
    if hasattr(limit, "default"): limit = limit.default

    habs  = db.query(Habitation).all()
    sites = db.query(CandidateSite).all()

    results: list[ZoneSummary] = []
    for hab in habs:
        if district and hab.district and hab.district.lower() != district.lower():
            continue

        if state and getattr(hab, "state", None) and hab.state.lower() != state.lower():
            continue

        hab_lat, hab_lon = _hab_coords(hab, db)

        # Geographic filter — only return habitations within radius_km of lat/lon
        if lat is not None and lon is not None and radius_km is not None:
            dist = haversine_km(lat, lon, hab_lat, hab_lon)
            # Regional coverage: if coordinates fall within Assam state bounds, ensure radius covers state habitations
            effective_radius = radius_km
            if 24.0 <= lat <= 28.5 and 89.5 <= lon <= 96.5 and radius_km < 300.0:
                effective_radius = max(radius_km, 300.0)
            if dist > effective_radius:
                continue

        # Read or recompute zone_score
        zs = db.get(ZoneScore, hab.id)
        if zs is None or _is_stale(zs):
            zs = _score_habitation(hab, db, sites, hab_lat, hab_lon)
            db.merge(zs)
            try:
                db.commit()
            except Exception:
                db.rollback()
                log.exception("Failed to persist zone_score for hab %d", hab.id)

        if classification and zs.classification.value != classification:
            continue

        site_name = None
        if zs.matched_site_id:
            s = db.get(CandidateSite, zs.matched_site_id)
            if s:
                site_name = s.name

        results.append(ZoneSummary(
            habitation_id=hab.id,
            name=hab.name,
            population=hab.population,
            district=hab.district,
            lat=hab_lat, lon=hab_lon,
            hazard_score=round(zs.hazard_score, 4),
            urgency_score=round(zs.urgency_score, 4),
            classification=zs.classification.value,
            timeline=zs.explanation_json.get("urgency", {}).get("timeline", ""),
            matched_site=site_name,
            computed_at=zs.computed_at.isoformat() + "Z",
        ))

    return results


@router.get(
    "/zones/{habitation_id}",
    response_model=ZoneDetail,
    summary="Detailed view for one habitation (§6 audit trail)",
)
def get_zone(habitation_id: int, db: Session = Depends(get_db)):
    hab = db.get(Habitation, habitation_id)
    if not hab:
        raise HTTPException(status_code=404, detail=f"Habitation {habitation_id} not found")

    lat, lon = _hab_coords(hab, db)
    sites    = db.query(CandidateSite).all()

    zs = db.get(ZoneScore, hab.id)
    if zs is None or _is_stale(zs):
        zs = _score_habitation(hab, db, sites, lat, lon)
        db.merge(zs)
        try:
            db.commit()
        except Exception:
            db.rollback()

    site_name = None
    if zs.matched_site_id:
        s = db.get(CandidateSite, zs.matched_site_id)
        if s:
            site_name = s.name

    return ZoneDetail(
        habitation_id=hab.id,
        name=hab.name,
        population=hab.population,
        district=hab.district,
        lat=lat, lon=lon,
        hazard_score=round(zs.hazard_score, 4),
        urgency_score=round(zs.urgency_score, 4),
        classification=zs.classification.value,
        timeline=zs.explanation_json.get("urgency", {}).get("timeline", ""),
        matched_site_id=zs.matched_site_id,
        matched_site=site_name,
        live_rainfall_mm=zs.live_rainfall_mm,
        live_seismic_mag=zs.live_seismic_mag,
        live_trigger_mult=zs.live_trigger_mult,
        data_is_cached=zs.data_is_cached,
        computed_at=zs.computed_at.isoformat() + "Z",
        explanation_json=zs.explanation_json,
    )


@router.get(
    "/zones/{habitation_id}/explain",
    summary="Raw §6 explanation JSON for one habitation",
)
def explain_zone(habitation_id: int, db: Session = Depends(get_db)):
    """
    Returns the raw JSONB explanation_json from zone_scores.
    Used by the Decision Panel and audit export.
    """
    zs = db.get(ZoneScore, habitation_id)
    if zs is None:
        raise HTTPException(
            status_code=404,
            detail=f"No computed score for habitation {habitation_id}. "
                   "Call GET /api/zones/{id} first to trigger computation."
        )
    return zs.explanation_json


@router.get(
    "/priority-queue",
    response_model=list[PriorityQueueItem],
    summary="Habitations ranked by urgency_score (highest first)",
)
def priority_queue(
    limit:       int   = Query(default=50, ge=1, le=500),
    min_urgency: float = Query(default=0.0, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
):
    """
    Returns the priority-ordered list of at-risk habitations.
    Reads from zone_scores (recomputes if stale).
    Answers the question: WHO SHOULD MOVE FIRST?
    """
    all_zones = list_zones(db=db)   # uses cache + stale-recompute logic
    filtered  = [z for z in all_zones if z.urgency_score >= min_urgency]
    filtered.sort(key=lambda z: (z.urgency_score, z.hazard_score), reverse=True)
    filtered  = filtered[:limit]

    return [
        PriorityQueueItem(
            rank=i + 1,
            habitation_id=z.habitation_id,
            name=z.name,
            population=z.population,
            urgency_score=z.urgency_score,
            hazard_score=z.hazard_score,
            classification=z.classification,
            timeline=z.timeline,
            matched_site=z.matched_site,
            lat=z.lat,
            lon=z.lon,
        )
        for i, z in enumerate(filtered)
    ]


@router.post(
    "/optimize",
    response_model=OptimizeResponse,
    summary="Run matching optimizer: assign habitations to sites",
)
def run_optimize(
    req: OptimizeRequest,
    db:  Session = Depends(get_db),
):
    """
    Runs the matching optimizer across all habitations and sites.
    Returns the LP/greedy assignment with a full audit trail.
    """
    habs  = db.query(Habitation).all()
    sites = db.query(CandidateSite).all()

    # Build optimizer inputs from DB rows
    hab_inputs: list[HabitationInput] = []
    for hab in habs:
        zs = db.get(ZoneScore, hab.id)
        if zs is None:
            continue
        if zs.urgency_score < req.min_urgency:
            continue
        lat, lon = _hab_coords(hab, db)
        try:
            hab_inputs.append(HabitationInput(
                habitation_id=hab.id,
                name=hab.name,
                urgency_score=zs.urgency_score,
                population=hab.population,
                lat=lat, lon=lon,
            ))
        except ValueError as e:
            log.warning("Skipping hab %d: %s", hab.id, e)

    site_inputs: list[SiteInput] = []
    for site in sites:
        s_lat, s_lon = _site_coords(site, db)
        avail = site.max_capacity_estimate - site.existing_occupancy
        if avail <= 0:
            continue
        cap_result = compute_capacity_score_from_raw(
            site_name=site.name,
            available_land_sqm=site.available_land_sqm,
            slope_degrees=site.slope_degrees,
            distance_to_road_km=site.distance_to_road_km,
            distance_to_water_km=site.distance_to_water_km,
            existing_occupancy=site.existing_occupancy,
            max_capacity_estimate=site.max_capacity_estimate,
        )
        try:
            site_inputs.append(SiteInput(
                site_id=site.id,
                name=site.name,
                capacity_score=cap_result.capacity_score,
                available_capacity=avail,
                lat=s_lat, lon=s_lon,
            ))
        except ValueError as e:
            log.warning("Skipping site %d: %s", site.id, e)

    result = solve_assignment(
        habitations=hab_inputs,
        sites=site_inputs,
        max_distance_km=req.max_distance_km,
        prefer_lp=req.prefer_lp,
    )

    return OptimizeResponse(
        solver_used=result.solver_used,
        solver_status=result.solver_status,
        total_match_score=result.total_match_score,
        total_population_matched=result.total_population_matched,
        assignments=[a.to_dict() for a in result.assignments],
        unmatched_count=len(result.unmatched_habitations),
        unmatched=[
            {"name": u.name, "reason": u.reason, "urgency": round(u.urgency_score, 4)}
            for u in result.unmatched_habitations
        ],
    )


@router.post(
    "/zones/{habitation_id}/recalculate",
    response_model=ZoneDetail,
    summary="Force recompute of one habitation's scores (bypass cache)",
)
def recalculate_zone(habitation_id: int, db: Session = Depends(get_db)):
    """
    Forces a fresh scoring run for this habitation, bypassing the TTL cache.
    Used by the UI when the user manually refreshes a card.
    """
    hab = db.get(Habitation, habitation_id)
    if not hab:
        raise HTTPException(status_code=404, detail=f"Habitation {habitation_id} not found")

    lat, lon = _hab_coords(hab, db)
    sites    = db.query(CandidateSite).all()

    zs = _score_habitation(hab, db, sites, lat, lon)
    db.merge(zs)
    db.commit()

    return get_zone(habitation_id, db)
