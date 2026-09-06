# backend/ingestion/pilot_data_common.py
# Shared seeding logic reusable by any region's pilot data script.
#
# USAGE:
#   from ingestion.pilot_data_common import (
#       approx_boundary, seed_region, seed_habitations,
#       seed_disaster_history, seed_candidate_sites, seed_hazard_zones,
#   )
#
# Every region's seed script (e.g. load_assam_pilot_data.py) calls these
# helpers with its own data — no region-specific logic lives here.
# See backend/ingestion/TEMPLATE_load_region_pilot_data.py for the template.
# ============================================================================

import logging
from datetime import datetime

from sqlalchemy.orm import Session
from geoalchemy2.shape import from_shape
from shapely.geometry import Point, Polygon

from models import (
    Region, Habitation, HazardZone, DisasterHistory,
    CandidateSite, HazardType,
)

log = logging.getLogger("pilot_data_common")


def approx_boundary(lat: float, lon: float, radius_deg: float = 0.005) -> Polygon:
    """
    Returns a simple rectangular boundary polygon around a centroid.
    radius_deg ≈ 0.005° ≈ 550 m at typical Indian latitudes.
    Used when a precise cadastral boundary is unavailable.
    """
    d = radius_deg
    return Polygon([
        (lon - d, lat - d),
        (lon + d, lat - d),
        (lon + d, lat + d),
        (lon - d, lat + d),
        (lon - d, lat - d),
    ])


def seed_region(db: Session, region_data: dict) -> Region:
    """
    Upserts a Region row.  region_data must contain:
        name, state, country, center_lat, center_lon, bounding_radius_km,
        primary_hazard_types (list of str), data_status,
        owm_poll_enabled (bool), usgs_poll_enabled (bool)

    Returns the Region ORM object (id is set after flush).
    """
    existing = db.query(Region).filter_by(name=region_data["name"]).first()
    if existing:
        log.info("  skip region (exists): %s", region_data["name"])
        return existing

    obj = Region(
        name=region_data["name"],
        state=region_data["state"],
        country=region_data.get("country", "India"),
        center_lat=region_data["center_lat"],
        center_lon=region_data["center_lon"],
        bounding_radius_km=region_data["bounding_radius_km"],
        primary_hazard_types=region_data["primary_hazard_types"],
        owm_poll_enabled=region_data.get("owm_poll_enabled", True),
        usgs_poll_enabled=region_data.get("usgs_poll_enabled", True),
        data_status=region_data.get("data_status", "PILOT"),
    )
    db.add(obj)
    db.flush()
    log.info("  inserted region: %s (%s) id=%d", obj.name, obj.state, obj.id)
    return obj


def seed_habitations(db: Session, habitations: list[dict], region: Region) -> dict:
    """
    Upserts Habitation rows for the given region.

    Each entry in `habitations` must contain:
        name, lat, lon, population, population_source, district, state
    And should contain (§1.1 terrain — use 'MISSING' if unknown):
        slope_degrees, distance_to_hazard_km, terrain_data_source

    Returns a dict mapping habitation name → habitation id.
    """
    existing = {h.name for h in db.query(Habitation.name).all()}
    hab_map = {}

    for h in habitations:
        if h["name"] in existing:
            log.info("  skip habitation (exists): %s", h["name"])
            hab_map[h["name"]] = db.query(Habitation).filter_by(name=h["name"]).first().id
            continue

        terrain_source = h.get("terrain_data_source", "MISSING")
        slope = h.get("slope_degrees") if terrain_source != "MISSING" else None
        dist  = h.get("distance_to_hazard_km") if terrain_source != "MISSING" else None

        poly = approx_boundary(h["lat"], h["lon"])
        obj = Habitation(
            name=h["name"],
            geom=from_shape(Point(h["lon"], h["lat"]), srid=4326),
            boundary=from_shape(poly, srid=4326),
            population=h["population"],
            population_source=h["population_source"],
            district=h["district"],
            state=h["state"],
            region_id=region.id,
            slope_degrees=slope,
            distance_to_hazard_km=dist,
            terrain_data_source=terrain_source,
        )
        db.add(obj)
        db.flush()
        hab_map[h["name"]] = obj.id
        log.info(
            "  inserted habitation: %s (%s, pop=%d, slope=%.1f°, dist=%.1fkm, terrain=%s)",
            h["name"], h["district"], h["population"],
            slope or 0.0, dist or 0.0, terrain_source,
        )

    return hab_map


def seed_disaster_history(db: Session, events_by_name: dict, hab_map: dict) -> None:
    """
    Seeds DisasterHistory rows.
    events_by_name: {habitation_name: [event_dict, ...]}
    Skips if disaster_history table already has rows (idempotent global guard).
    """
    existing_events = {
        (dh.habitation_id, dh.event_date, dh.event_type)
        for dh in db.query(DisasterHistory.habitation_id, DisasterHistory.event_date, DisasterHistory.event_type).all()
    }

    for hab_name, events in events_by_name.items():
        hid = hab_map.get(hab_name)
        if not hid:
            log.warning("  no habitation_id for '%s' — skipping event", hab_name)
            continue
        for ev in events:
            key = (hid, ev["event_date"], ev["event_type"])
            if key in existing_events:
                continue
            obj = DisasterHistory(
                habitation_id=hid,
                event_type=ev["event_type"],
                event_date=ev["event_date"],
                severity=ev["severity"],
                casualties=ev.get("casualties"),
                description=ev["description"],
                source=ev["source"],
            )
            db.add(obj)
            existing_events.add(key)
            log.info("  inserted event: %s for %s (%s)", ev["event_type"], hab_name, ev["event_date"])


def seed_candidate_sites(db: Session, sites: list[dict], region: Region) -> list:
    """
    Upserts CandidateSite rows for the given region.

    Each entry must contain:
        name, lat, lon, available_land_sqm, slope_degrees,
        distance_to_road_km, distance_to_water_km, existing_occupancy,
        max_capacity_estimate, data_source, district, state

    Returns a list of CandidateSite ORM objects.
    """
    existing = {s.name for s in db.query(CandidateSite.name).all()}
    result = []

    for s in sites:
        if s["name"] in existing:
            log.info("  skip site (exists): %s", s["name"])
            result.append(db.query(CandidateSite).filter_by(name=s["name"]).first())
            continue

        obj = CandidateSite(
            name=s["name"],
            geom=from_shape(Point(s["lon"], s["lat"]), srid=4326),
            available_land_sqm=s["available_land_sqm"],
            slope_degrees=s["slope_degrees"],
            distance_to_road_km=s["distance_to_road_km"],
            distance_to_water_km=s["distance_to_water_km"],
            existing_occupancy=s.get("existing_occupancy", 0),
            max_capacity_estimate=s["max_capacity_estimate"],
            committed_population=s.get("committed_population", 0),
            district=s["district"],
            state=s["state"],
            region_id=region.id,
            data_source=s["data_source"],
        )
        db.add(obj)
        result.append(obj)
        log.info("  inserted site: %s (%s, cap=%d)", s["name"], s["district"], s["max_capacity_estimate"])

    return result


def seed_hazard_zones(db: Session, zones: list[dict]) -> None:
    """
    Seeds HazardZone rows.  Each zone dict must contain:
        hazard_type (HazardType enum), coords (list of (lon, lat) tuples),
        intensity_class (1–5), source (citation string)

    Skips if hazard_zones table already has rows (idempotent global guard).
    Call with --reset to clear first if needed.
    """
    if db.query(HazardZone).count() > 0:
        log.info("  skip hazard zones (already seeded)")
        return

    for z in zones:
        poly = Polygon(z["coords"])
        obj = HazardZone(
            hazard_type=z["hazard_type"],
            geom=from_shape(poly, srid=4326),
            intensity_class=z["intensity_class"],
            source=z["source"],
            last_updated=datetime.utcnow(),
        )
        db.add(obj)
        log.info("  inserted zone: %s intensity=%d", z["hazard_type"], z["intensity_class"])
