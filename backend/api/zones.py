# backend/api/zones.py
# FastAPI router — /api/zones and /api/priority-queue.
#
# WIRES TOGETHER:
#   • models.py          — DB schema + get_db dependency
#   • hazard_engine.py   — compute_hazard_score_from_raw()
#   • capacity_engine.py — compute_capacity_score_from_raw()
#   • prioritization_engine.py — compute_urgency_score(), rank_by_urgency()
#   • matching_optimizer.py — solve_assignment()
#   • relocation_horizon_engine.py — classify_relocation_horizon()
#
# READ PATH (§2 architecture):
#   Every read checks zone_scores first (cached).  If stale (> CACHE_TTL_MINUTES
#   since computed_at) or absent, it recomputes and upserts before responding.
#   This means the map, priority queue, and decision panel can never disagree.
#
# §6 AUDIT TRAIL:
#   zone_scores.explanation_json is written here for every computed row.
#   The GET /api/zones/{id}/explain endpoint surfaces the full JSONB.
#
# §0 REGION-AGNOSTIC:
#   No hardcoded region coordinates or names.  All radius/bounding logic uses
#   each habitation's region.bounding_radius_km from the regions table.
#   Live signals are scoped per region.name — never a global latest value.
#
# §1.1 TERRAIN DATA:
#   slope_degrees and distance_to_hazard_km are read directly from
#   habitation.slope_degrees / habitation.distance_to_hazard_km.
#   If terrain_data_source == "MISSING" or the column is NULL, the field is
#   surfaced as terrain_data_status: "MISSING" in explanation_json — NEVER
#   substituted with a fake default (the old _PILOT_SLOPES/_PILOT_DISTANCES
#   dicts have been deleted entirely).
#
# §1.2 SPATIAL HAZARD ZONE QUERY:
#   _score_habitation() queries hazard_zones using ST_DWithin(hab.geom, hz.geom,
#   0.005°  ≈ 550 m buffer).  The matched zone's intensity_class feeds the
#   hazard engine directly.  DisasterHistory-derived severity is the fallback
#   when no zone is matched — documented in the explanation_json.
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
    LiveSignal, RiskClassification, RelocationHorizon, Region, get_db,
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
from scoring.relocation_horizon_engine import (
    classify_relocation_horizon,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["zones"])

# Cache: recompute if zone_score is older than this
CACHE_TTL_MINUTES: int = 60


# ============================================================================
# Pydantic response models (§6 contract)
# ============================================================================

class HazardBreakdown(BaseModel):
    hazard_intensity:      float
    frequency_history:     float
    terrain_vulnerability: float
    proximity:             float
    sar_deformation:       float
    ndvi_change:           float


class MatchedHazardZone(BaseModel):
    """Spatial hazard zone that contains or is within 550m of the habitation."""
    zone_id:         int
    hazard_type:     str
    intensity_class: int
    source:          str


class ZoneSummary(BaseModel):
    """Compact per-habitation row for the map and priority table."""
    habitation_id:       int
    name:                str
    population:          int
    district:            str
    region_name:         str
    lat:                 float
    lon:                 float
    hazard_score:        float
    urgency_score:       float
    classification:      str
    relocation_horizon:  Optional[str] = None
    timeline:            str
    current_conditions:  str = "LIVE"
    permanent_habitation_status: str = "CONDITIONAL"
    permanent_habitation_rationale: Optional[str] = None
    matched_site:        Optional[str] = None
    terrain_data_status: str           # REAL | SYNTH | MISSING
    computed_at:         str


class ZoneDetail(BaseModel):
    """Full per-habitation detail with §6 audit trail."""
    habitation_id:              int
    name:                       str
    population:                 int
    district:                   str
    region_name:                str
    lat:                        float
    lon:                        float
    hazard_score:               float
    urgency_score:              float
    classification:             str
    relocation_horizon:         Optional[str] = None
    relocation_horizon_rationale: Optional[str] = None
    current_conditions:         str = "LIVE"
    permanent_habitation_status: str = "CONDITIONAL"
    timeline:                   str
    matched_site_id:            Optional[int]
    matched_site:               Optional[str]
    matched_hazard_zones:       list[MatchedHazardZone] = []
    live_rainfall_mm:           Optional[float]
    live_seismic_mag:           Optional[float]
    live_trigger_mult:          Optional[float]
    terrain_data_status:        str
    data_is_cached:             bool
    computed_at:                str
    explanation_json:           dict


class PriorityQueueItem(BaseModel):
    rank:                int
    habitation_id:       int
    name:                str
    population:          int
    urgency_score:       float
    hazard_score:        float
    classification:      str
    relocation_horizon:  Optional[str] = None
    timeline:            str
    matched_site:        Optional[str]
    region_name:         str
    lat:                 float
    lon:                 float


class PriorityQueueSummary(BaseModel):
    """
    §2.2 — Aggregated relocation horizon counts, national + per-region.
    """
    national: dict
    by_region: dict


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
    site_coords_cache: Optional[dict] = None,  # {site.id: (lat, lon)}
    as_of_timestamp: Optional[datetime] = None,
    is_historical_replay: bool = False,
) -> ZoneScore:
    """
    Runs the full scoring pipeline for one habitation and returns a ZoneScore
    object (not yet committed — caller commits).

    1.  Spatial hazard zone query (§1.2) — ST_DWithin 550m buffer
    2.  Aggregate disaster_history for hazard inputs (time-safe when as_of_timestamp passed)
    3.  Pull latest region-scoped live signals (§0.3) (time-safe when as_of_timestamp passed)
    4.  Compute hazard_score (hazard_engine)
    5.  Find nearest viable site, compute capacity_score (capacity_engine)
    6.  Compute urgency_score (prioritization_engine)
    7.  Classify relocation_horizon (§2.2)
    8.  Build explanation_json (§6)
    9.  Return ZoneScore (upsert by caller)
    """
    overrides = overrides or {}

    # Resolve region name for live-signal scoping (§0.3)
    region_name: str = ""
    if hab.region_id:
        region = db.get(Region, hab.region_id)
        region_name = region.name if region else ""

    # --- 1. Spatial hazard zone query (§1.2) ---
    # ST_DWithin with 0.005° ≈ 550m buffer at Indian latitudes (documented threshold)
    hz_rows = db.execute(text(
        "SELECT id, hazard_type, intensity_class, source "
        "FROM hazard_zones "
        "WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 0.005)"
        "ORDER BY intensity_class DESC"
    ), {"lat": lat, "lon": lon}).fetchall()

    matched_hazard_zones: list[dict] = []
    spatial_intensity_class: Optional[int] = None

    for row in hz_rows:
        matched_hazard_zones.append({
            "zone_id":         row[0],
            "hazard_type":     row[1],
            "intensity_class": row[2],
            "source":          row[3],
        })
        if spatial_intensity_class is None:
            spatial_intensity_class = row[2]  # highest intensity (ordered DESC)

    # --- 2. Disaster history aggregates (TIME-SAFE: no hindsight leakage) ---
    events_q = db.query(DisasterHistory).filter(DisasterHistory.habitation_id == hab.id)
    if as_of_timestamp:
        as_of_date = as_of_timestamp.date() if isinstance(as_of_timestamp, datetime) else as_of_timestamp
        events_q = events_q.filter(DisasterHistory.event_date <= as_of_date)
    events = events_q.all()
    event_count       = len(events)
    max_severity_ever = max((e.severity for e in events), default=1)

    # §1.2 blend rule: if spatial zone is matched, use its intensity_class directly.
    # Otherwise, use DisasterHistory-derived severity as proxy (documented fallback).
    if spatial_intensity_class is not None:
        intensity_class = spatial_intensity_class
        intensity_source = "spatial_hazard_zone"
    else:
        intensity_class = max_severity_ever
        intensity_source = "disaster_history_proxy"

    # SAR deformation: latest S1 satellite pass (TIME-SAFE)
    sar_sql = (
        "SELECT signal_value FROM satellite_passes "
        "WHERE habitation_id = :hid AND signal_type = 'sar_amplitude_change'"
    )
    sar_params = {"hid": hab.id}
    if as_of_timestamp:
        sar_sql += " AND pass_date <= :as_of_d"
        sar_params["as_of_d"] = as_of_timestamp.date() if isinstance(as_of_timestamp, datetime) else as_of_timestamp
    sar_sql += " ORDER BY pass_date DESC LIMIT 1"
    sar_row = db.execute(text(sar_sql), sar_params).fetchone()
    sar_deformation_cm_yr = float(sar_row[0]) if sar_row else 0.0

    # NDVI delta: latest S2 satellite pass (TIME-SAFE)
    ndvi_sql = (
        "SELECT signal_value FROM satellite_passes "
        "WHERE habitation_id = :hid AND signal_type = 'ndvi_change'"
    )
    ndvi_params = {"hid": hab.id}
    if as_of_timestamp:
        ndvi_sql += " AND pass_date <= :as_of_d"
        ndvi_params["as_of_d"] = as_of_timestamp.date() if isinstance(as_of_timestamp, datetime) else as_of_timestamp
    ndvi_sql += " ORDER BY pass_date DESC LIMIT 1"
    ndvi_row = db.execute(text(ndvi_sql), ndvi_params).fetchone()
    ndvi_delta = float(ndvi_row[0]) if ndvi_row else 0.0

    # §1.1 Terrain: read from habitation columns — NO fallback defaults.
    slope_degrees         = hab.slope_degrees
    distance_to_hazard_km = hab.distance_to_hazard_km
    terrain_data_status   = hab.terrain_data_source or "MISSING"

    if slope_degrees is None or distance_to_hazard_km is None:
        terrain_data_status = "MISSING"
        slope_degrees         = slope_degrees         or 0.0
        distance_to_hazard_km = distance_to_hazard_km or 0.0

    # --- 3. Region-scoped live signals (TIME-SAFE: no hindsight leakage) ---
    rain_sql = "SELECT value, is_cached FROM live_signals WHERE signal_type='rainfall' AND region=:region"
    rain_params = {"region": region_name}
    if as_of_timestamp:
        rain_sql += " AND fetched_at <= :as_of"
        rain_params["as_of"] = as_of_timestamp
    rain_sql += " ORDER BY fetched_at DESC LIMIT 1"
    rain_row = db.execute(text(rain_sql), rain_params).fetchone()

    seismic_sql = "SELECT value, is_cached FROM live_signals WHERE signal_type='seismic' AND region=:region"
    seismic_params = {"region": region_name}
    if as_of_timestamp:
        seismic_sql += " AND fetched_at <= :as_of"
        seismic_params["as_of"] = as_of_timestamp
    seismic_sql += " ORDER BY fetched_at DESC LIMIT 1"
    seismic_row = db.execute(text(seismic_sql), seismic_params).fetchone()

    live_rainfall_mm  = float(rain_row[0])   if rain_row   else None
    live_seismic_mag  = float(seismic_row[0]) if seismic_row else None

    # Apply overrides (scenario lab)
    if "live_rainfall_mm_per_hr" in overrides:
        live_rainfall_mm = overrides["live_rainfall_mm_per_hr"]
    if "live_seismic_magnitude" in overrides:
        live_seismic_mag = overrides["live_seismic_magnitude"]

    live_mult = compute_live_trigger_multiplier(
        rainfall_mm_per_hr=live_rainfall_mm  or 0.0,
        seismic_magnitude= live_seismic_mag  or 0.0,
    )

    # Determine current conditions status
    if is_historical_replay or as_of_timestamp:
        current_conditions = "HISTORICAL"
    elif rain_row and len(rain_row) > 1 and rain_row[1]:
        current_conditions = "RECENT"
    else:
        current_conditions = "LIVE"

    # --- 4. Hazard score ---
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
        current_conditions=current_conditions,
        terrain_data_status=terrain_data_status,
    )

    # --- 5. Capacity score of best nearby site ---
    best_site: Optional[CandidateSite] = None
    best_cap_score: float              = 0.0
    sites_in_radius: list[float]       = []

    for site in sites:
        if site_coords_cache and site.id in site_coords_cache:
            s_lat, s_lon = site_coords_cache[site.id]
        else:
            s_lat, s_lon = _site_coords(site, db)
        d = haversine_km(lat, lon, s_lat, s_lon)
        if d > DEFAULT_RADIUS_KM:
            continue
        avail = (site.max_capacity_estimate
                 - site.existing_occupancy
                 - (site.committed_population or 0))
        if avail <= 0:
            continue
        if site.hazard_free is False:
            log.debug("Skipping site %s — flagged hazard_free=False", site.name)
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

    # --- 6. Urgency score ---
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

    # --- 7. Relocation horizon (§2.2) ---
    horizon, horizon_rationale = classify_relocation_horizon(
        hazard_score=hazard_result.final_hazard_score,
        urgency_score=urgency_result.urgency_score,
        site_availability_factor=site_factor,
    )

    # --- 8. Build §6 explanation_json ---
    explanation = {
        "habitation": hab.name,
        "region":     region_name,
        "population": hab.population,
        "current_conditions": current_conditions,
        "permanent_habitation_status": hazard_result.permanent_habitation_status,
        "permanent_habitation_rationale": hazard_result.permanent_habitation_rationale,
        "as_of_timestamp": as_of_timestamp.isoformat() if as_of_timestamp else None,
        "is_historical_replay": is_historical_replay,
        "terrain": {
            "slope_degrees":          slope_degrees,
            "distance_to_hazard_km":  distance_to_hazard_km,
            "terrain_data_status":    terrain_data_status,
        },
        "hazard": {
            **hazard_result.to_explanation_json(),
            "intensity_source": intensity_source,
            "matched_hazard_zones": matched_hazard_zones,
        },
        "urgency":    urgency_result.to_explanation_json(),
        "relocation_horizon": {
            "horizon":   horizon,
            "rationale": horizon_rationale,
        },
        "matched_relocation_site": {
            "id":             best_site.id   if best_site else None,
            "name":           best_site.name if best_site else None,
            "capacity_score": round(best_cap_score, 4),
        } if best_site else None,
        "live_signals": {
            "region":              region_name,
            "rainfall_mm_per_hr":  live_rainfall_mm,
            "seismic_magnitude":   live_seismic_mag,
            "trigger_multiplier":  round(live_mult, 4),
        },
        "computed_at": (as_of_timestamp or datetime.utcnow()).isoformat() + "Z",
    }

    return ZoneScore(
        habitation_id=hab.id,
        hazard_score=hazard_result.final_hazard_score,
        urgency_score=urgency_result.urgency_score,
        capacity_score=best_cap_score if best_site else None,
        classification=RiskClassification(hazard_result.classification),
        relocation_horizon=RelocationHorizon(horizon),
        relocation_horizon_rationale=horizon_rationale,
        current_conditions=current_conditions,
        permanent_habitation_status=hazard_result.permanent_habitation_status,
        matched_site_id=best_site.id if best_site else None,
        computed_at=as_of_timestamp if as_of_timestamp else datetime.utcnow(),
        explanation_json=explanation,
        live_rainfall_mm=live_rainfall_mm,
        live_seismic_mag=live_seismic_mag,
        live_trigger_mult=live_mult,
        data_is_cached=bool(rain_row and len(rain_row) > 1 and rain_row[1]),
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


def _is_stale(zs: ZoneScore) -> bool:
    return (datetime.utcnow() - zs.computed_at) > timedelta(minutes=CACHE_TTL_MINUTES)


def _terrain_status(hab: Habitation) -> str:
    """Returns the terrain data status string for a habitation."""
    if hab.terrain_data_source and hab.slope_degrees is not None and hab.distance_to_hazard_km is not None:
        return hab.terrain_data_source
    return "MISSING"


# ============================================================================
# Routes
# ============================================================================

@router.get(
    "/zones",
    response_model=list[ZoneSummary],
    summary="List habitation risk zones (region/district/area-filtered)",
)
def list_zones(
    classification: Optional[str] = Query(None, description="Filter: immediate|short_term|medium_term|stable"),
    relocation_horizon: Optional[str] = Query(None, description="Filter: IMMEDIATE|SHORT_TERM|MEDIUM_TERM|MONITOR"),
    district:       Optional[str] = Query(None),
    state:          Optional[str] = Query(None),
    region_id:      Optional[int] = Query(None, description="Filter by region.id"),
    region_name:    Optional[str] = Query(None, description="Filter by region.name"),
    lat:            Optional[float] = Query(None, description="Center latitude for geographic filter"),
    lon:            Optional[float] = Query(None, description="Center longitude for geographic filter"),
    radius_km:      Optional[float] = Query(None, description="Search radius in km from lat/lon"),
    limit:          Optional[int]   = Query(None, description="Max results"),
    db: Session = Depends(get_db),
):
    """
    Returns habitations with their current hazard / urgency scores.

    §0: radius_km uses each matched region's bounding_radius_km as a floor
    when the caller's value is smaller — no hardcoded Assam bounding box.

    Scores are read from zone_scores (cache). Stale or missing scores are
    recomputed on-the-fly before returning.
    """
    # Unwrap Query objects if called directly as a Python function (e.g. from priority_queue)
    if hasattr(district, "default"):        district = district.default
    if hasattr(state, "default"):           state = state.default
    if hasattr(classification, "default"):  classification = classification.default
    if hasattr(relocation_horizon, "default"): relocation_horizon = relocation_horizon.default
    if hasattr(lat, "default"):             lat = lat.default
    if hasattr(lon, "default"):             lon = lon.default
    if hasattr(radius_km, "default"):       radius_km = radius_km.default
    if hasattr(limit, "default"):           limit = limit.default
    if hasattr(region_id, "default"):       region_id = region_id.default
    if hasattr(region_name, "default"):     region_name = region_name.default

    habs  = db.query(Habitation).all()
    sites = db.query(CandidateSite).all()

    # Bulk pre-load all habitation + site coordinates (2 queries instead of N×M)
    hab_coords_cache: dict[int, tuple[float, float]] = {}
    site_coords_cache: dict[int, tuple[float, float]] = {}
    try:
        rows = db.execute(text(
            "SELECT id, ST_Y(geom), ST_X(geom) FROM habitations"
        )).fetchall()
        for r in rows:
            hab_coords_cache[r[0]] = (float(r[1]), float(r[2]))
        rows = db.execute(text(
            "SELECT id, ST_Y(geom), ST_X(geom) FROM candidate_sites"
        )).fetchall()
        for r in rows:
            site_coords_cache[r[0]] = (float(r[1]), float(r[2]))
    except Exception as e:
        log.warning("Bulk coord preload failed, falling back to per-row queries: %s", e)

    # Pre-load region objects
    region_cache: dict[int, Region] = {}
    for r in db.query(Region).all():
        region_cache[r.id] = r

    results: list[ZoneSummary] = []
    for hab in habs:
        if district and hab.district and hab.district.lower() != district.lower():
            continue
        if state and getattr(hab, "state", None) and hab.state.lower() != state.lower():
            continue
        if region_id and hab.region_id != region_id:
            continue
        if region_name:
            region = db.get(Region, hab.region_id) if hab.region_id else None
            if not region or region.name.lower() != region_name.lower():
                continue

        if hab.id in hab_coords_cache:
            hab_lat, hab_lon = hab_coords_cache[hab.id]
        else:
            hab_lat, hab_lon = _hab_coords(hab, db)

        # §0.2 Geographic filter — use region's bounding_radius_km as floor.
        if lat is not None and lon is not None and radius_km is not None:
            dist = haversine_km(lat, lon, hab_lat, hab_lon)
            effective_radius = radius_km
            if hab.region_id:
                region_obj = region_cache.get(hab.region_id) or db.get(Region, hab.region_id)
                if region_obj and radius_km < region_obj.bounding_radius_km:
                    effective_radius = region_obj.bounding_radius_km
            if dist > effective_radius:
                continue

        # Read or recompute zone_score
        zs = db.get(ZoneScore, hab.id)
        if zs is None or _is_stale(zs):
            zs = _score_habitation(hab, db, sites, hab_lat, hab_lon,
                                   site_coords_cache=site_coords_cache)
            db.merge(zs)
            try:
                db.commit()
            except Exception:
                db.rollback()
                log.exception("Failed to persist zone_score for hab %d", hab.id)

        if classification and zs.classification.value != classification:
            continue
        if relocation_horizon and (not zs.relocation_horizon
                                   or zs.relocation_horizon.value != relocation_horizon):
            continue

        site_name = None
        if zs.matched_site_id:
            s = db.get(CandidateSite, zs.matched_site_id)
            if s:
                site_name = s.name

        # Resolve region name for the response (use cache)
        r_name = ""
        if hab.region_id:
            r = region_cache.get(hab.region_id) or db.get(Region, hab.region_id)
            r_name = r.name if r else ""

        results.append(ZoneSummary(
            habitation_id=hab.id,
            name=hab.name,
            population=hab.population,
            district=hab.district,
            region_name=r_name,
            lat=hab_lat, lon=hab_lon,
            hazard_score=round(zs.hazard_score, 4),
            urgency_score=round(zs.urgency_score, 4),
            classification=zs.classification.value,
            relocation_horizon=zs.relocation_horizon.value if zs.relocation_horizon else None,
            timeline=zs.explanation_json.get("urgency", {}).get("timeline", ""),
            current_conditions=getattr(zs, "current_conditions", "LIVE") if isinstance(getattr(zs, "current_conditions", None), str) else "LIVE",
            permanent_habitation_status=getattr(zs, "permanent_habitation_status", "CONDITIONAL") if isinstance(getattr(zs, "permanent_habitation_status", None), str) else "CONDITIONAL",
            permanent_habitation_rationale=zs.explanation_json.get("permanent_habitation_rationale") if isinstance(zs.explanation_json, dict) else None,
            matched_site=site_name,
            terrain_data_status=_terrain_status(hab),
            computed_at=zs.computed_at.isoformat() + "Z",
        ))

    if limit:
        results = results[:limit]

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

    r_name = ""
    if hab.region_id:
        r = db.get(Region, hab.region_id)
        r_name = r.name if r else ""

    # Extract matched hazard zones from explanation_json for the response model
    matched_zones_raw = (
        zs.explanation_json.get("hazard", {}).get("matched_hazard_zones", [])
    )
    matched_zones = [
        MatchedHazardZone(
            zone_id=z["zone_id"],
            hazard_type=z["hazard_type"],
            intensity_class=z["intensity_class"],
            source=z["source"],
        )
        for z in matched_zones_raw
    ]

    return ZoneDetail(
        habitation_id=hab.id,
        name=hab.name,
        population=hab.population,
        district=hab.district,
        region_name=r_name,
        lat=lat, lon=lon,
        hazard_score=round(zs.hazard_score, 4),
        urgency_score=round(zs.urgency_score, 4),
        classification=zs.classification.value,
        relocation_horizon=zs.relocation_horizon.value if zs.relocation_horizon else None,
        relocation_horizon_rationale=zs.relocation_horizon_rationale,
        current_conditions=getattr(zs, "current_conditions", "LIVE") if isinstance(getattr(zs, "current_conditions", None), str) else "LIVE",
        permanent_habitation_status=getattr(zs, "permanent_habitation_status", "CONDITIONAL") if isinstance(getattr(zs, "permanent_habitation_status", None), str) else "CONDITIONAL",
        timeline=zs.explanation_json.get("urgency", {}).get("timeline", ""),
        matched_site_id=zs.matched_site_id,
        matched_site=site_name,
        matched_hazard_zones=matched_zones,
        live_rainfall_mm=zs.live_rainfall_mm,
        live_seismic_mag=zs.live_seismic_mag,
        live_trigger_mult=zs.live_trigger_mult,
        terrain_data_status=_terrain_status(hab),
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
    limit:          int   = Query(default=50, ge=1, le=500),
    min_urgency:    float = Query(default=0.0, ge=0.0, le=1.0),
    region_id:      Optional[int]   = Query(None),
    region_name:    Optional[str]   = Query(None),
    relocation_horizon: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Returns the priority-ordered list of at-risk habitations.
    Reads from zone_scores (recomputes if stale).
    Answers the question: WHO SHOULD MOVE FIRST?
    """
    all_zones = list_zones(
        db=db,
        region_id=region_id,
        region_name=region_name,
        relocation_horizon=relocation_horizon,
    )
    filtered = [z for z in all_zones if z.urgency_score >= min_urgency]
    filtered.sort(key=lambda z: (z.urgency_score, z.hazard_score), reverse=True)
    filtered = filtered[:limit]

    return [
        PriorityQueueItem(
            rank=i + 1,
            habitation_id=z.habitation_id,
            name=z.name,
            population=z.population,
            urgency_score=z.urgency_score,
            hazard_score=z.hazard_score,
            classification=z.classification,
            relocation_horizon=z.relocation_horizon,
            timeline=z.timeline,
            matched_site=z.matched_site,
            region_name=z.region_name,
            lat=z.lat,
            lon=z.lon,
        )
        for i, z in enumerate(filtered)
    ]


@router.get(
    "/priority-queue/summary",
    response_model=PriorityQueueSummary,
    summary="§2.2 Relocation horizon counts — national and per-region",
)
def priority_queue_summary(db: Session = Depends(get_db)):
    """
    Returns habitation counts grouped by RelocationHorizon bucket,
    both nationally and per active region.

    This is the literal mapping to the PS 'Expected Solution' requirement:
    IMMEDIATE / SHORT_TERM / MEDIUM_TERM / MONITOR buckets with population totals,
    available nationally and per-region for multi-district SDMA use.
    """
    all_zones = list_zones(db=db)
    horizons  = [h.value for h in RelocationHorizon]

    def _empty_buckets():
        return {h: {"count": 0, "total_population": 0} for h in horizons}

    national = _empty_buckets()
    by_region: dict[str, dict] = {}

    for z in all_zones:
        h = z.relocation_horizon or "MONITOR"
        national[h]["count"] += 1
        national[h]["total_population"] += z.population

        r = z.region_name or "Unknown"
        if r not in by_region:
            by_region[r] = _empty_buckets()
        by_region[r][h]["count"] += 1
        by_region[r][h]["total_population"] += z.population

    return PriorityQueueSummary(national=national, by_region=by_region)


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
        avail = (site.max_capacity_estimate
                 - site.existing_occupancy
                 - (site.committed_population or 0))
        if avail <= 0:
            continue
        if site.hazard_free is False:
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
