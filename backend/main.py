# backend/main.py
# FastAPI application entry point.
# Build order §14.2 — all routers mounted.
# ======================================================================

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
log = logging.getLogger("main")


# ---------- Lifespan (startup / shutdown) --------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("=== SIH26191 Risk-Aware Relocation Platform — starting ===")
    log.info("Pilot region: %s, %s", os.getenv("PILOT_DISTRICT", "Majuli, Dhemaji, Cachar"),
             os.getenv("PILOT_STATE", "Assam"))

    try:
        from models import create_all_tables
        create_all_tables()
        log.info("Database tables verified / created.")
    except Exception as exc:
        log.warning("Could not create tables (DB may not be ready yet): %s", exc)

    # Start live-signal pollers (APScheduler)
    scheduler = None
    try:
        from ingestion.live_signals import start_scheduler
        scheduler = start_scheduler()
    except Exception as exc:
        log.warning("Could not start scheduler: %s", exc)

    app.state.scheduler = scheduler
    yield

    log.info("=== Shutdown ===")
    try:
        from ingestion.live_signals import stop_scheduler
        stop_scheduler(app.state.scheduler)
    except Exception:
        pass


# ---------- App ---------------------------------------------------------
app = FastAPI(
    title="REDZONE — Geographic Disaster Intelligence Platform",
    description=(
        "Location-agnostic disaster decision-support and relocation engine. "
        "Hazard scoring, safe-site matching, OSRM routing, and human-in-the-loop "
        "deployment planning."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)


# ---------- CORS (open in dev — tighten in production) ------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],         # Vite dev server on localhost:5173
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Health endpoint (polled by run.sh) --------------------------
@app.get("/healthz", tags=["meta"])
async def health():
    return {"status": "ok", "version": app.version}


@app.get("/", tags=["meta"])
async def root():
    return {
        "platform": "SIH26191 · Risk-Aware Relocation Platform",
        "pilot_district": os.getenv("PILOT_DISTRICT", "Majuli, Dhemaji, Cachar"),
        "pilot_state":    os.getenv("PILOT_STATE", "Assam"),
        "docs": "/docs",
    }


@app.get("/api/data-health", tags=["meta"],
         summary="Data Health Badge — freshness of live signals")
def data_health():
    """
    Returns the freshness status of rainfall (OWM) and seismic (USGS) signals.
    The UI Data Health Badge reads this endpoint every 60 seconds.
    """
    try:
        from models import engine
        from sqlalchemy.orm import Session
        from ingestion.live_signals import get_signal_health
        with Session(engine) as db:
            return get_signal_health(db)
    except Exception as exc:
        return {"status": "unavailable", "error": str(exc)}


# ---------- API routers (mounted incrementally per §14.2) ---------------
# These imports are guarded so the skeleton runs even before the
# individual API modules are written.

try:
    from api.zones import router as zones_router
    app.include_router(zones_router, prefix="/api")
except ImportError:
    log.warning("api/zones.py not yet present — /api/zones not mounted")

try:
    from api.sites import router as sites_router
    app.include_router(sites_router, prefix="/api")
except ImportError:
    log.warning("api/sites.py not yet present — /api/sites not mounted")

try:
    from api.recommendations import router as rec_router
    app.include_router(rec_router, prefix="/api")
except ImportError:
    log.warning("api/recommendations.py not yet present")

try:
    from api.scenario import router as scenario_router
    app.include_router(scenario_router, prefix="/api")
except ImportError:
    log.warning("api/scenario.py not yet present")

try:
    from api.report import router as report_router
    app.include_router(report_router, prefix="/api")
except ImportError:
    log.warning("api/report.py not yet present")

try:
    from api.areas import router as areas_router
    app.include_router(areas_router, prefix="/api")
except ImportError:
    log.warning("api/areas.py not yet present")

try:
    from api.events import router as events_router
    app.include_router(events_router, prefix="/api")
except ImportError:
    log.warning("api/events.py not yet present")
