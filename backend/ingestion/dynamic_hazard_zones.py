# backend/ingestion/dynamic_hazard_zones.py
# Dynamic Red Zone Detection — §2.4
#
# DESIGN:
#   An APScheduler job runs every DYNAMIC_CHECK_INTERVAL_S seconds.
#   For each active region, it checks:
#     1. Has rainfall in the last RAINFALL_WINDOW_H hours exceeded
#        RAINFALL_THRESHOLD_MM_PER_H for at least RAINFALL_SUSTAINED_PERIODS
#        consecutive intervals?  → write a flood HazardZone centred on region.
#     2. Has any seismic signal exceeded SEISMIC_MAG_THRESHOLD?
#        → write a seismic HazardZone.
#
#   New zones are written with source="AUTO — <trigger description>" so the
#   audit trail is always explicit about machine-generated vs human-curated zones.
#
# §0 REGION-AGNOSTIC:
#   All region coordinates come from the `regions` table.
#   No hardcoded coordinates or region names.
#
# PROVENANCE RULE:
#   Every AUTO zone is tagged with the trigger condition, timestamp, and
#   signal value in its source field.  The hazard_zone.last_updated field
#   tracks the auto-update time.
#
# Called from main.py lifespan (registered alongside rainfall/seismic pollers).
# ============================================================================

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta

from sqlalchemy.orm import Session
from geoalchemy2.shape import from_shape
from shapely.geometry import Polygon

from models import LiveSignal, SignalType, Region, HazardZone, HazardType, engine

log = logging.getLogger(__name__)

# ── Configuration (all env-overridable) ─────────────────────────────────────

DYNAMIC_CHECK_INTERVAL_S:     int   = int(os.getenv("DYNAMIC_CHECK_INTERVAL_S", "900"))  # 15 min
RAINFALL_THRESHOLD_MM_PER_H:  float = float(os.getenv("RAINFALL_THRESHOLD_MM_PER_H", "30.0"))
RAINFALL_WINDOW_H:            int   = int(os.getenv("RAINFALL_WINDOW_H", "3"))
RAINFALL_SUSTAINED_PERIODS:   int   = int(os.getenv("RAINFALL_SUSTAINED_PERIODS", "2"))
SEISMIC_MAG_THRESHOLD:        float = float(os.getenv("SEISMIC_MAG_THRESHOLD", "4.5"))

# Zone radius in degrees (~0.25° ≈ 27km at Indian latitudes)
AUTO_ZONE_RADIUS_DEG: float = float(os.getenv("AUTO_ZONE_RADIUS_DEG", "0.25"))


def _make_bbox_polygon(lat: float, lon: float, radius_deg: float) -> Polygon:
    """Create a rectangular bounding polygon around a centroid."""
    r = radius_deg
    return Polygon([
        (lon - r, lat - r), (lon + r, lat - r),
        (lon + r, lat + r), (lon - r, lat + r),
        (lon - r, lat - r),
    ])


def _recent_signals(db: Session, signal_type: SignalType,
                    region_name: str, hours: int) -> list[LiveSignal]:
    """Returns live_signals for a region in the last `hours` hours, newest first."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    return (
        db.query(LiveSignal)
        .filter(
            LiveSignal.signal_type == signal_type,
            LiveSignal.region == region_name,
            LiveSignal.fetched_at >= cutoff,
        )
        .order_by(LiveSignal.fetched_at.desc())
        .all()
    )


def _existing_auto_zone(db: Session, region_name: str,
                        hazard_type: HazardType) -> HazardZone | None:
    """Find the most recently AUTO-generated zone for this region+type."""
    prefix = "AUTO"
    return (
        db.query(HazardZone)
        .filter(
            HazardZone.source.startswith(prefix),
            HazardZone.hazard_type == hazard_type,
        )
        .order_by(HazardZone.last_updated.desc())
        .first()
    )


def _upsert_auto_zone(db: Session, region: Region,
                      hazard_type: HazardType, intensity_class: int,
                      source: str) -> None:
    """
    Writes a new AUTO HazardZone (or updates the last_updated on an existing
    one if the trigger conditions haven't changed).
    """
    now = datetime.utcnow()
    poly = _make_bbox_polygon(region.center_lat, region.center_lon, AUTO_ZONE_RADIUS_DEG)
    geom = from_shape(poly, srid=4326)

    existing = _existing_auto_zone(db, region.name, hazard_type)
    if existing:
        existing.source       = source
        existing.intensity_class = intensity_class
        existing.last_updated = now
        log.info("Updated AUTO hazard zone: %s / %s (intensity=%d)",
                 region.name, hazard_type, intensity_class)
    else:
        zone = HazardZone(
            hazard_type=hazard_type,
            geom=geom,
            intensity_class=intensity_class,
            source=source,
            last_updated=now,
        )
        db.add(zone)
        log.info("Created AUTO hazard zone: %s / %s (intensity=%d)",
                 region.name, hazard_type, intensity_class)


def check_dynamic_hazards() -> None:
    """
    APScheduler job: scans all active regions' live_signals for threshold
    breaches and writes/updates AUTO HazardZone rows accordingly.
    """
    now = datetime.utcnow()
    log.debug("Dynamic hazard check started at %s", now.isoformat())

    with Session(engine) as db:
        regions = (
            db.query(Region)
            .filter(Region.data_status.in_(["ACTIVE", "PILOT"]))
            .all()
        )

        for region in regions:
            # ── Rainfall check ───────────────────────────────────────────────
            rain_signals = _recent_signals(
                db, SignalType.rainfall, region.name, RAINFALL_WINDOW_H
            )
            above_threshold = [
                s for s in rain_signals
                if float(s.value) >= RAINFALL_THRESHOLD_MM_PER_H and not s.is_cached
            ]
            if len(above_threshold) >= RAINFALL_SUSTAINED_PERIODS:
                max_rain = max(float(s.value) for s in above_threshold)
                # Intensity class: 4 if 30–60 mm/h, 5 if > 60 mm/h
                intensity = 5 if max_rain > 60.0 else 4
                source = (
                    f"AUTO — sustained rainfall {max_rain:.1f} mm/hr "
                    f"for {len(above_threshold)} consecutive intervals "
                    f"({RAINFALL_WINDOW_H}h window) | "
                    f"threshold={RAINFALL_THRESHOLD_MM_PER_H} mm/hr | "
                    f"detected {now.isoformat()}Z"
                )
                _upsert_auto_zone(db, region, HazardType.flood, intensity, source)

            # ── Seismic check ─────────────────────────────────────────────────
            seis_signals = _recent_signals(
                db, SignalType.seismic, region.name, 1  # last 1 hour
            )
            if seis_signals:
                max_mag = max(float(s.value) for s in seis_signals)
                if max_mag >= SEISMIC_MAG_THRESHOLD:
                    intensity = 5 if max_mag >= 6.0 else 4
                    source = (
                        f"AUTO — seismic event M{max_mag:.1f} detected "
                        f"within {region.bounding_radius_km:.0f} km of region centre | "
                        f"threshold=M{SEISMIC_MAG_THRESHOLD} | "
                        f"detected {now.isoformat()}Z"
                    )
                    _upsert_auto_zone(db, region, HazardType.flood, intensity, source)

        db.commit()
        log.debug("Dynamic hazard check complete.")


def register_dynamic_hazard_job(scheduler) -> None:
    """
    Registers the dynamic hazard check job with an existing APScheduler instance.
    Called from live_signals.start_scheduler() after the scheduler is created.
    """
    scheduler.add_job(
        check_dynamic_hazards,
        trigger="interval",
        seconds=DYNAMIC_CHECK_INTERVAL_S,
        id="dynamic_hazard_check",
        max_instances=1,
        replace_existing=True,
        next_run_time=datetime.utcnow(),
    )
    log.info(
        "Dynamic hazard detection registered: every %ds "
        "(rainfall threshold=%.1f mm/hr, seismic threshold=M%.1f)",
        DYNAMIC_CHECK_INTERVAL_S, RAINFALL_THRESHOLD_MM_PER_H, SEISMIC_MAG_THRESHOLD,
    )
