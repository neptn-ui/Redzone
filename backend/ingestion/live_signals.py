# backend/ingestion/live_signals.py
# Live Signal Pollers — APScheduler jobs for rainfall and seismic data.
#
# §0 REGION-AGNOSTIC DESIGN:
#   This module has NO hardcoded region coordinates or names.
#   At every poll cycle, it reads all Region rows where owm_poll_enabled /
#   usgs_poll_enabled is True from the database, and writes one LiveSignal
#   row per region.  Adding a new region to the `regions` table automatically
#   means it starts getting live-polled — no code change required.
#
# DATA SOURCES (§3, data_sources.md §B):
#   Rainfall:  OpenWeatherMap Current Weather API
#              https://api.openweathermap.org/data/2.5/weather
#              REAL data when OWM_API_KEY is set; cached fallback otherwise.
#   Seismic:   USGS Earthquake Hazards API (GeoJSON feed)
#              https://earthquake.usgs.gov/fdsnws/event/1/query
#              REAL data — no API key required.
#
# RESILIENCE DESIGN:
#   If a live fetch fails (network, API key absent, rate limit):
#     • The last successful value from live_signals table is returned (is_cached=True).
#     • If no cached value exists, a zero-signal fallback is used.
#     • The Data Health Badge reads data_is_cached from zone_scores to surface this.
#
# The scheduler is started in main.py lifespan.
# This module only defines the job functions + the start/stop helpers.
# ============================================================================

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from models import LiveSignal, SignalType, Region, engine

log = logging.getLogger(__name__)

# ============================================================================
# Global (non-region-specific) configuration
# ============================================================================

OWM_API_KEY:     str   = os.getenv("OPENWEATHER_API_KEY") or os.getenv("OWM_API_KEY", "")
USGS_RADIUS_KM:  float = float(os.getenv("USGS_RADIUS_KM", "350"))
USGS_MIN_MAG:    float = float(os.getenv("USGS_MIN_MAG",   "2.0"))
USGS_LOOKBACK_H: int   = int(os.getenv("USGS_LOOKBACK_H",  "24"))

# Poll intervals (seconds)
RAINFALL_POLL_INTERVAL_S: int = int(os.getenv("RAINFALL_POLL_INTERVAL_S", "900"))  # 15 min
SEISMIC_POLL_INTERVAL_S:  int = int(os.getenv("SEISMIC_POLL_INTERVAL_S",  "300"))  # 5 min

HTTP_TIMEOUT_S: float = 10.0


# ============================================================================
# Per-region rainfall fetch — OpenWeatherMap
# ============================================================================

def fetch_rainfall_for_region(region: Region) -> Optional[float]:
    """
    Fetches current rainfall (mm/hr) from OpenWeatherMap for one region.
    Uses the region's center_lat/center_lon — no hardcoded coordinates.
    Returns None if the API key is absent or the request fails.
    """
    if not OWM_API_KEY:
        log.debug("OWM_API_KEY not set — skipping live rainfall fetch for %s", region.name)
        return None

    url = (
        f"https://api.openweathermap.org/data/2.5/weather"
        f"?lat={region.center_lat}&lon={region.center_lon}"
        f"&appid={OWM_API_KEY}&units=metric"
    )
    try:
        resp = httpx.get(url, timeout=HTTP_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
        rain_mm = data.get("rain", {}).get("1h", 0.0)
        log.info("OWM [%s]: rainfall=%.2f mm/hr", region.name, rain_mm)
        return float(rain_mm)
    except Exception as exc:
        log.warning("OWM fetch failed for region %s: %s", region.name, exc)
        return None


def poll_rainfall_all_regions() -> None:
    """
    APScheduler job: for each region with owm_poll_enabled=True, fetch
    rainfall and write a LiveSignal row. Automatically covers all regions
    present in the database — no code change needed when a region is added.
    """
    with Session(engine) as db:
        regions = (
            db.query(Region)
            .filter(Region.owm_poll_enabled == True,
                    Region.data_status.in_(["ACTIVE", "PILOT"]))
            .all()
        )

        for region in regions:
            value = fetch_rainfall_for_region(region)
            is_cached = False

            if value is None:
                last = (
                    db.query(LiveSignal)
                    .filter(LiveSignal.signal_type == SignalType.rainfall,
                            LiveSignal.region == region.name)
                    .order_by(LiveSignal.fetched_at.desc())
                    .first()
                )
                value     = float(last.value) if last else 0.0
                is_cached = True
                log.info("[%s] Rainfall: using cached value=%.2f mm/hr", region.name, value)

            signal = LiveSignal(
                signal_type=SignalType.rainfall,
                value=value,
                region=region.name,
                fetched_at=datetime.utcnow(),
                is_cached=is_cached,
            )
            db.add(signal)

        db.commit()


# ============================================================================
# Per-region seismic fetch — USGS Earthquake Hazards API
# ============================================================================

def fetch_seismic_for_region(region: Region) -> Optional[float]:
    """
    Fetches the maximum earthquake magnitude within USGS_RADIUS_KM of the
    region's center in the last USGS_LOOKBACK_H hours.
    Uses region.center_lat / region.center_lon — no hardcoded coordinates.

    USGS GeoJSON feed — no API key required (REAL data source).
    Returns 0.0 if no earthquakes found; None on network failure.
    """
    start_time = (datetime.utcnow() - timedelta(hours=USGS_LOOKBACK_H)).strftime(
        "%Y-%m-%dT%H:%M:%S"
    )
    url = (
        f"https://earthquake.usgs.gov/fdsnws/event/1/query"
        f"?format=geojson"
        f"&starttime={start_time}"
        f"&latitude={region.center_lat}&longitude={region.center_lon}"
        f"&maxradiuskm={USGS_RADIUS_KM}"
        f"&minmagnitude={USGS_MIN_MAG}"
        f"&orderby=magnitude"
    )
    try:
        resp = httpx.get(url, timeout=HTTP_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
        features = data.get("features", [])
        if not features:
            log.info("USGS [%s]: no earthquakes ≥ M%.1f in last %dh",
                     region.name, USGS_MIN_MAG, USGS_LOOKBACK_H)
            return 0.0
        max_mag = max(f["properties"]["mag"] for f in features if f["properties"]["mag"])
        log.info("USGS [%s]: max earthquake M%.1f in last %dh within %d km",
                 region.name, max_mag, USGS_LOOKBACK_H, USGS_RADIUS_KM)
        return float(max_mag)
    except Exception as exc:
        log.warning("USGS fetch failed for region %s: %s", region.name, exc)
        return None


def poll_seismic_all_regions() -> None:
    """
    APScheduler job: for each region with usgs_poll_enabled=True, fetch
    seismic magnitude and write a LiveSignal row.
    """
    with Session(engine) as db:
        regions = (
            db.query(Region)
            .filter(Region.usgs_poll_enabled == True,
                    Region.data_status.in_(["ACTIVE", "PILOT"]))
            .all()
        )

        for region in regions:
            value = fetch_seismic_for_region(region)
            is_cached = False

            if value is None:
                last = (
                    db.query(LiveSignal)
                    .filter(LiveSignal.signal_type == SignalType.seismic,
                            LiveSignal.region == region.name)
                    .order_by(LiveSignal.fetched_at.desc())
                    .first()
                )
                value     = float(last.value) if last else 0.0
                is_cached = True

            signal = LiveSignal(
                signal_type=SignalType.seismic,
                value=value,
                region=region.name,
                fetched_at=datetime.utcnow(),
                is_cached=is_cached,
            )
            db.add(signal)

        db.commit()


# ============================================================================
# Scheduler lifecycle helpers (called from main.py lifespan)
# ============================================================================

def start_scheduler():
    """
    Starts APScheduler with the rainfall and seismic jobs.
    Both jobs iterate all active regions from the database at each cycle —
    no region-specific configuration needed here.
    Returns the running scheduler instance so main.py can stop it on shutdown.
    """
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:
        log.warning("APScheduler not installed — live signal polling disabled")
        return None

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        poll_rainfall_all_regions,
        trigger="interval",
        seconds=RAINFALL_POLL_INTERVAL_S,
        id="rainfall_poller",
        max_instances=1,
        replace_existing=True,
        next_run_time=datetime.utcnow(),
    )
    scheduler.add_job(
        poll_seismic_all_regions,
        trigger="interval",
        seconds=SEISMIC_POLL_INTERVAL_S,
        id="seismic_poller",
        max_instances=1,
        replace_existing=True,
        next_run_time=datetime.utcnow(),
    )
    # Register §2.4 dynamic hazard detection job
    try:
        from ingestion.dynamic_hazard_zones import register_dynamic_hazard_job
        register_dynamic_hazard_job(scheduler)
    except Exception as exc:
        log.warning("Could not register dynamic hazard job: %s", exc)

    scheduler.start()
    log.info(
        "APScheduler started: rainfall every %ds, seismic every %ds, "
        "dynamic hazard check registered (all active regions)",
        RAINFALL_POLL_INTERVAL_S, SEISMIC_POLL_INTERVAL_S,
    )
    return scheduler


def stop_scheduler(scheduler) -> None:
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)
        log.info("APScheduler stopped")


# ============================================================================
# Data health check (read by GET /api/data-health in main.py)
# ============================================================================

def get_signal_health(db: Session) -> dict:
    """
    Returns the freshness of the latest rainfall and seismic signals,
    broken down by region.  Used by the Data Health Badge (§11).
    """
    def _latest_per_type(signal_type: SignalType, region_name: str) -> Optional[LiveSignal]:
        return (
            db.query(LiveSignal)
            .filter(LiveSignal.signal_type == signal_type,
                    LiveSignal.region == region_name)
            .order_by(LiveSignal.fetched_at.desc())
            .first()
        )

    regions = (
        db.query(Region)
        .filter(Region.data_status.in_(["ACTIVE", "PILOT"]))
        .all()
    )
    now = datetime.utcnow()

    def _age_minutes(sig) -> Optional[float]:
        if not sig:
            return None
        return round((now - sig.fetched_at).total_seconds() / 60, 1)

    result = {}
    for r in regions:
        rain = _latest_per_type(SignalType.rainfall, r.name)
        seis = _latest_per_type(SignalType.seismic, r.name)
        result[r.name] = {
            "rainfall": {
                "value_mm_per_hr": float(rain.value) if rain else None,
                "fetched_at":      rain.fetched_at.isoformat() + "Z" if rain else None,
                "age_minutes":     _age_minutes(rain),
                "is_cached":       rain.is_cached if rain else True,
                "status":          "ok" if rain and not rain.is_cached else "cached",
            },
            "seismic": {
                "value_magnitude": float(seis.value) if seis else None,
                "fetched_at":      seis.fetched_at.isoformat() + "Z" if seis else None,
                "age_minutes":     _age_minutes(seis),
                "is_cached":       seis.is_cached if seis else True,
                "status":          "ok" if seis and not seis.is_cached else "cached",
            },
        }

    primary_data = next(iter(result.values()), None) if result else None
    top_rainfall = primary_data["rainfall"] if primary_data else {
        "value_mm_per_hr": None,
        "fetched_at": None,
        "age_minutes": None,
        "is_cached": True,
        "status": "cached",
    }
    top_seismic = primary_data["seismic"] if primary_data else {
        "value_magnitude": None,
        "fetched_at": None,
        "age_minutes": None,
        "is_cached": True,
        "status": "cached",
    }

    return {
        "rainfall": top_rainfall,
        "seismic":  top_seismic,
        "regions":  result,
        **result,
    }

