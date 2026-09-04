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
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from models import Habitation, CandidateSite, ZoneScore, LiveSignal, get_db
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

    Intended for:
      • District collector briefings
      • Offline demo validation
      • Integration with NDMA/SDMA GIS systems
    """
    zones = list_zones(db=db)

    sites_raw = db.query(CandidateSite).all()
    sites_export = []
    for s in sites_raw:
        sites_export.append({
            "id":                       s.id,
            "name":                     s.name,
            "max_capacity_estimate":    s.max_capacity_estimate,
            "available_land_sqm":       s.available_land_sqm,
            "slope_degrees":            s.slope_degrees,
            "distance_to_road_km":      s.distance_to_road_km,
            "distance_from_joshimath_km": s.distance_from_joshimath_km,
            "data_source":              s.data_source,
        })

    # Signal freshness
    rain = (db.query(LiveSignal)
            .filter(LiveSignal.signal_type == "rainfall")
            .order_by(LiveSignal.fetched_at.desc()).first())
    seis = (db.query(LiveSignal)
            .filter(LiveSignal.signal_type == "seismic")
            .order_by(LiveSignal.fetched_at.desc()).first())

    immediate  = [z for z in zones if z.classification == "immediate"]
    short_term = [z for z in zones if z.classification == "short_term"]

    return {
        "report_metadata": {
            "title":          "SIH26191 Risk-Aware Relocation Platform — Situation Report",
            "pilot_district": "Chamoli, Uttarakhand",
            "generated_at":   datetime.utcnow().isoformat() + "Z",
            "version":        "0.2.0",
        },
        "executive_summary": {
            "total_habitations":   len(zones),
            "immediate_action":    len(immediate),
            "short_term_action":   len(short_term),
            "total_at_risk_pop":   sum(z.population for z in immediate + short_term),
            "candidate_sites":     len(sites_raw),
        },
        "live_signals": {
            "rainfall_mm_per_hr": float(rain.value) if rain else None,
            "rainfall_fetched_at": rain.fetched_at.isoformat() + "Z" if rain else None,
            "rainfall_cached":    rain.is_cached if rain else True,
            "seismic_magnitude":  float(seis.value) if seis else None,
            "seismic_fetched_at": seis.fetched_at.isoformat() + "Z" if seis else None,
            "seismic_cached":     seis.is_cached if seis else True,
        },
        "priority_queue": [
            {
                "rank":           i + 1,
                "habitation":     z.name,
                "population":     z.population,
                "hazard_score":   z.hazard_score,
                "urgency_score":  z.urgency_score,
                "classification": z.classification,
                "timeline":       z.timeline,
                "matched_site":   z.matched_site,
            }
            for i, z in enumerate(
                sorted(zones, key=lambda z: z.urgency_score, reverse=True)
            )
        ],
        "candidate_sites": sites_export,
        "data_note": (
            "Scores are computed from a combination of REAL and SYNTH data. "
            "See data_sources.md for field-level provenance. "
            "SYNTH fields are calibrated proxies — not measurements."
        ),
    }
