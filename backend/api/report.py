# backend/api/report.py
# FastAPI router — /api/report
#
# Exports the current platform state as a structured JSON report.
# Designed for: district collector briefings, SIH demo export, and
# integration with external GIS / disaster management systems.
#
# PDF generation (nice-to-have §22): guarded with ImportError on reportlab.
# ============================================================================

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from models import Habitation, CandidateSite, ZoneScore, LiveSignal, Region, get_db
from api.zones import list_zones

log = logging.getLogger(__name__)
router = APIRouter(tags=["report"])


@router.get(
    "/report",
    summary="Export full platform state as structured JSON",
)
def export_report(db: Session = Depends(get_db)):
    """
    Exports all habitation scores, site inventory, and live signal status
    in a single structured JSON response.

    Each section is independently fault-tolerant — a failure in one section
    returns DATA_UNAVAILABLE for that section instead of a 500.
    """
    # Active regions from DB — not from hardcoded env vars
    try:
        active_regions = (
            db.query(Region)
            .filter(Region.data_status.in_(["ACTIVE", "PILOT"]))
            .all()
        )
        region_names = ", ".join(r.name for r in active_regions) or "(no regions loaded)"
    except Exception:
        region_names = "(unavailable)"

    # ── Zones ────────────────────────────────────────────────────────────────
    zones = []
    zones_error = None
    try:
        zones = list_zones(db=db)
    except Exception as exc:
        zones_error = str(exc)
        log.warning("Report: zones failed: %s", exc)

    immediate  = [z for z in zones if z.classification == "immediate"]
    short_term = [z for z in zones if z.classification == "short_term"]

    # ── Sites ─────────────────────────────────────────────────────────────────
    sites_export = []
    sites_error = None
    try:
        sites_raw = db.query(CandidateSite).all()
        for s in sites_raw:
            entry: dict[str, Any] = {
                "id":                       s.id,
                "name":                     s.name,
                "max_capacity_estimate":    s.max_capacity_estimate,
                "available_land_sqm":       s.available_land_sqm,
                "slope_degrees":            s.slope_degrees,
                "distance_to_road_km":      s.distance_to_road_km,
                "data_source":              s.data_source,
                "hazard_free":              s.hazard_free,
            }
            sites_export.append(entry)
    except Exception as exc:
        sites_error = str(exc)
        log.warning("Report: sites failed: %s", exc)

    # ── Live signals ──────────────────────────────────────────────────────────
    live_signals = {"status": "UNAVAILABLE"}
    try:
        rain = (db.query(LiveSignal)
                .filter(LiveSignal.signal_type == "rainfall")
                .order_by(LiveSignal.fetched_at.desc()).first())
        seis = (db.query(LiveSignal)
                .filter(LiveSignal.signal_type == "seismic")
                .order_by(LiveSignal.fetched_at.desc()).first())
        live_signals = {
            "rainfall_mm_per_hr":  float(rain.value) if rain else None,
            "rainfall_fetched_at": rain.fetched_at.isoformat() + "Z" if rain else None,
            "rainfall_cached":     rain.is_cached if rain else True,
            "seismic_magnitude":   float(seis.value) if seis else None,
            "seismic_fetched_at":  seis.fetched_at.isoformat() + "Z" if seis else None,
            "seismic_cached":      seis.is_cached if seis else True,
        }
    except Exception as exc:
        live_signals = {"status": "UNAVAILABLE", "error": str(exc)}
        log.warning("Report: live signals failed: %s", exc)

    # ── Priority queue ────────────────────────────────────────────────────────
    priority_queue = []
    try:
        priority_queue = [
            {
                "rank":               i + 1,
                "habitation":         z.name,
                "district":           z.district,
                "region_name":        z.region_name,
                "population":         z.population,
                "hazard_score":       z.hazard_score,
                "urgency_score":      z.urgency_score,
                "classification":     z.classification,
                "relocation_horizon": z.relocation_horizon,
                "timeline":           z.timeline,
                "matched_site":       z.matched_site,
                "terrain_data_status": z.terrain_data_status,
            }
            for i, z in enumerate(
                sorted(zones, key=lambda z: z.urgency_score, reverse=True)
            )
        ]
    except Exception as exc:
        log.warning("Report: priority queue failed: %s", exc)

    return {
        "report_metadata": {
            "title":          "REDZONE Emergency Command Platform — Situation Report",
            "active_regions": region_names,
            "generated_at":   datetime.now(timezone.utc).isoformat(),
            "version":        "2.0.0",
        },
        "executive_summary": {
            "total_habitations":   len(zones),
            "immediate_action":    len(immediate),
            "short_term_action":   len(short_term),
            "total_at_risk_pop":   sum(z.population for z in immediate + short_term) if zones else 0,
            "candidate_sites":     len(sites_export),
            "zones_error":         zones_error,
            "sites_error":         sites_error,
        },
        "live_signals": live_signals,
        "priority_queue": priority_queue,
        "candidate_sites": sites_export,
        "data_note": (
            "Scores are computed from a combination of REAL and SYNTH data. "
            "See data_sources.md for field-level provenance. "
            "SYNTH fields are calibrated proxies — not measurements."
        ),
    }
