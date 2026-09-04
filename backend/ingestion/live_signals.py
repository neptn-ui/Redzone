# backend/ingestion/live_signals.py
# Live Signal Pollers — APScheduler jobs for rainfall and seismic data.
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
# The scheduler is started in main.py lifespan (Step 13 of build order).
# This module only defines the job functions + the start/stop helpers.
# ============================================================================

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import httpx                    # already in requirements.txt (FastAPI dep)
from sqlalchemy.orm import Session

from models import LiveSignal, SignalType, engine

log = logging.getLogger(__name__)

# ============================================================================
# Configuration (from environment; sane defaults for demo)
# ============================================================================

OWM_API_KEY:    str   = os.getenv("OPENWEATHER_API_KEY") or os.getenv("OWM_API_KEY", "")
OWM_LAT:        float = float(os.getenv("OWM_LAT",  "26.960"))   # Assam (Majuli/Brahmaputra corridor)
OWM_LON:        float = float(os.getenv("OWM_LON",  "94.220"))
OWM_REGION:     str   = os.getenv("OWM_REGION",  "Assam")

USGS_LAT:       float = float(os.getenv("USGS_LAT",   "26.500"))
USGS_LON:       float = float(os.getenv("USGS_LON",   "93.500"))
USGS_RADIUS_KM: float = float(os.getenv("USGS_RADIUS_KM", "350"))
USGS_MIN_MAG:   float = float(os.getenv("USGS_MIN_MAG",   "2.0"))
USGS_LOOKBACK_H: int  = int(os.getenv("USGS_LOOKBACK_H",  "24"))

# Poll intervals (seconds)
RAINFALL_POLL_INTERVAL_S: int = int(os.getenv("RAINFALL_POLL_INTERVAL_S",  "900"))  # 15 min
SEISMIC_POLL_INTERVAL_S:  int = int(os.getenv("SEISMIC_POLL_INTERVAL_S",   "300"))  # 5 min

HTTP_TIMEOUT_S: float = 10.0


# ============================================================================
# Rainfall poller — OpenWeatherMap
# ============================================================================

def fetch_rainfall_owm() -> Optional[float]:
    """
    Fetches current rainfall intensity (mm/hr) from OpenWeatherMap.
    Returns None if the API key is absent or the request fails.

    OWM returns rain in "rain.1h" (mm in last 1 hour).
    We treat this as mm/hr for the hazard engine trigger multiplier.
    """
    if not OWM_API_KEY:
        log.debug("OWM_API_KEY not set — skipping live rainfall fetch")
        return None

    url = (
        f"https://api.openweathermap.org/data/2.5/weather"
        f"?lat={OWM_LAT}&lon={OWM_LON}&appid={OWM_API_KEY}&units=metric"
    )
    try:
        resp = httpx.get(url, timeout=HTTP_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
        # "rain" key only present if it's actually raining
        rain_mm = data.get("rain", {}).get("1h", 0.0)
        log.info("OWM: rainfall=%.2f mm/hr at %s", rain_mm, OWM_REGION)
        return float(rain_mm)
    except Exception as exc:
        log.warning("OWM fetch failed: %s", exc)
        return None


def poll_rainfall(raw_response: Optional[dict] = None) -> None:
    """
    APScheduler job: fetch rainfall, write to live_signals.
    Falls back to last cached value if fetch fails.
    """
    value = fetch_rainfall_owm()
    is_cached = False

    with Session(engine) as db:
        if value is None:
            # Use last cached value
            last = (
                db.query(LiveSignal)
                .filter(LiveSignal.signal_type == SignalType.rainfall,
                        LiveSignal.region == OWM_REGION)
                .order_by(LiveSignal.fetched_at.desc())
                .first()
            )
            value     = float(last.value) if last else 0.0
            is_cached = True
            log.info("Rainfall: using cached value=%.2f mm/hr", value)

        signal = LiveSignal(
            signal_type=SignalType.rainfall,
            value=value,
            region=OWM_REGION,
            fetched_at=datetime.utcnow(),
            is_cached=is_cached,
            raw_response=raw_response,
        )
        db.add(signal)
        db.commit()
        log.debug("Stored rainfall signal: %.2f mm/hr (cached=%s)", value, is_cached)


# ============================================================================
# Seismic poller — USGS Earthquake Hazards API
# ============================================================================

def fetch_seismic_usgs() -> Optional[float]:
    """
    Fetches the maximum earthquake magnitude within USGS_RADIUS_KM of the
    pilot region in the last USGS_LOOKBACK_H hours.

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
        f"&latitude={USGS_LAT}&longitude={USGS_LON}"
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
            log.info("USGS: no earthquakes ≥ M%.1f in last %dh", USGS_MIN_MAG, USGS_LOOKBACK_H)
            return 0.0
        max_mag = max(f["properties"]["mag"] for f in features if f["properties"]["mag"])
        log.info("USGS: max earthquake M%.1f in last %dh within %d km",
                 max_mag, USGS_LOOKBACK_H, USGS_RADIUS_KM)
        return float(max_mag)
    except Exception as exc:
        log.warning("USGS fetch failed: %s", exc)
        return None


def poll_seismic() -> None:
    """
    APScheduler job: fetch seismic magnitude, write to live_signals.
    """
    value = fetch_seismic_usgs()
    is_cached = False

    with Session(engine) as db:
        if value is None:
            last = (
                db.query(LiveSignal)
                .filter(LiveSignal.signal_type == SignalType.seismic,
                        LiveSignal.region == OWM_REGION)
                .order_by(LiveSignal.fetched_at.desc())
                .first()
            )
            value     = float(last.value) if last else 0.0
            is_cached = True

        signal = LiveSignal(
            signal_type=SignalType.seismic,
            value=value,
            region=OWM_REGION,
            fetched_at=datetime.utcnow(),
            is_cached=is_cached,
        )
        db.add(signal)
        db.commit()
        log.debug("Stored seismic signal: M%.1f (cached=%s)", value, is_cached)


# ============================================================================
# Scheduler lifecycle helpers (called from main.py lifespan)
# ============================================================================

def start_scheduler():
    """
    Starts APScheduler with the rainfall and seismic jobs.
    Returns the running scheduler instance so main.py can stop it on shutdown.
    """
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:
        log.warning("APScheduler not installed — live signal polling disabled")
        return None

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        poll_rainfall,
        trigger="interval",
        seconds=RAINFALL_POLL_INTERVAL_S,
        id="rainfall_poller",
        max_instances=1,
        replace_existing=True,
        next_run_time=datetime.utcnow(),   # run immediately on start
    )
    scheduler.add_job(
        poll_seismic,
        trigger="interval",
        seconds=SEISMIC_POLL_INTERVAL_S,
        id="seismic_poller",
        max_instances=1,
        replace_existing=True,
        next_run_time=datetime.utcnow(),
    )
    scheduler.start()
    log.info(
        "APScheduler started: rainfall every %ds, seismic every %ds",
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
    Returns the freshness of the latest rainfall and seismic signals.
    Used by the Data Health Badge (§11).
    """
    def _latest(signal_type: SignalType) -> Optional[LiveSignal]:
        return (
            db.query(LiveSignal)
            .filter(LiveSignal.signal_type == signal_type)
            .order_by(LiveSignal.fetched_at.desc())
            .first()
        )

    rain = _latest(SignalType.rainfall)
    seis = _latest(SignalType.seismic)
    now  = datetime.utcnow()

    def _age_minutes(sig) -> Optional[float]:
        if not sig:
            return None
        return round((now - sig.fetched_at).total_seconds() / 60, 1)

    return {
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
