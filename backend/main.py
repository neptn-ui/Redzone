# backend/main.py
# FastAPI application entry point.
# Build order §14.2 — all routers mounted.
#
# §0 REGION-AGNOSTIC DESIGN:
#   Startup logs the count and names of active regions from the database.
#   No PILOT_DISTRICT/PILOT_STATE env var defaults — region configuration
#   lives entirely in the `regions` table, seeded by ingestion scripts.
# ======================================================================

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
    log.info("=== REDZONE — Region-Agnostic Disaster Relocation Platform — starting ===")

    try:
        from models import create_all_tables
        create_all_tables()
        log.info("Database tables verified / created.")
    except Exception as exc:
        log.warning("Could not create tables (DB may not be ready yet): %s", exc)

    # Log active regions from the database (region-agnostic startup summary)
    try:
        from models import engine, Region
        from sqlalchemy.orm import Session
        with Session(engine) as db:
            active_regions = (
                db.query(Region)
                .filter(Region.data_status.in_(["ACTIVE", "PILOT"]))
                .all()
            )
            if active_regions:
                names = ", ".join(r.name for r in active_regions)
                log.info("REDZONE started — %d active region(s) loaded: %s",
                         len(active_regions), names)
            else:
                log.warning(
                    "REDZONE started — NO regions loaded yet. "
                    "Run backend/ingestion/load_assam_pilot_data.py to seed the Assam pilot dataset, "
                    "or use TEMPLATE_load_region_pilot_data.py to add a new region."
                )
    except Exception as exc:
        log.warning("Could not query regions table: %s", exc)

    # Start live-signal pollers (APScheduler) — polls all active regions
    scheduler = None
    try:
        from ingestion.live_signals import start_scheduler
        scheduler = start_scheduler()
    except Exception as exc:
        log.warning("Could not start scheduler: %s", exc)

    app.state.scheduler = scheduler
    yield

    log.info("=== REDZONE Shutdown ===")
    try:
        from ingestion.live_signals import stop_scheduler
        stop_scheduler(app.state.scheduler)
    except Exception:
        pass


# ---------- App ---------------------------------------------------------
app = FastAPI(
    title="REDZONE — Region-Agnostic Disaster Relocation Platform",
    description=(
        "A general-purpose multi-hazard Red Zone identification and relocation "
        "decision-support engine.  Assam (Majuli, Dhemaji, Cachar) is the first "
        "loaded pilot dataset.  Any region in India (or beyond) can be added via "
        "backend/ingestion/TEMPLATE_load_region_pilot_data.py without code changes. "
        "Hazard scoring, safe-site matching, vulnerability assessment, and "
        "human-in-the-loop deployment planning."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)


# ---------- CORS (open in dev — tighten in production) ------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    """
    Platform root. Returns active regions from the database — no hardcoded values.
    """
    try:
        from models import engine, Region
        from sqlalchemy.orm import Session
        with Session(engine) as db:
            active = (
                db.query(Region)
                .filter(Region.data_status.in_(["ACTIVE", "PILOT"]))
                .all()
            )
            region_summary = [
                {"name": r.name, "state": r.state, "status": r.data_status}
                for r in active
            ]
    except Exception:
        region_summary = []

    return {
        "platform": "REDZONE — Region-Agnostic Disaster Relocation Platform",
        "version": "2.0.0",
        "active_regions": region_summary,
        "docs": "/docs",
        "note": (
            "Add new regions via backend/ingestion/TEMPLATE_load_region_pilot_data.py "
            "— no code changes required."
        ),
    }


@app.get("/api/data-health", tags=["meta"],
         summary="Data Health Badge — freshness of live signals per region")
def data_health():
    """
    Returns the freshness status of rainfall (OWM) and seismic (USGS) signals,
    broken down by active region.  The UI Data Health Badge reads this endpoint
    every 60 seconds.
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
    from api.regions import router as regions_router
    app.include_router(regions_router, prefix="/api")
except ImportError:
    log.warning("api/regions.py not yet present — /api/regions not mounted")

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
    from api.manifest import router as manifest_router
    app.include_router(manifest_router, prefix="/api")
except ImportError:
    log.warning("api/manifest.py not yet present")

try:
    from api.events import router as events_router
    app.include_router(events_router, prefix="/api")
except ImportError:
    log.warning("api/events.py not yet present")
