# backend/api/manifest.py
# FastAPI router — /api/manifest (Deployment Manifest, §2.7)
#
# PURPOSE:
#   Generates a structured deployment manifest for NDRF/SDRF operations.
#   The manifest specifies how many personnel, what transport, and what
#   medical resources are needed to relocate one or more habitations.
#
# RESOURCE CALCULATION METHOD:
#   - Team count:   ceil(population / PERSONS_PER_TEAM)
#   - Transport:    ceil(population / TRANSPORT_CAPACITY_PERSONS) trucks
#   - Medical:      1 medical unit per 500 persons (minimum 1)
#   - Transit days: derived from relocation_horizon bucket
#
#   All constants are documented and env-overridable.
#   Vulnerability adjustment: if a vulnerability_index is provided (§2.1),
#   higher vulnerability increases resource allocation (elderly/disabled support).
#
# §0 REGION-AGNOSTIC: coordinates / district come from the DB, not hardcoded.
#
# PDF EXPORT:
#   GET /api/manifest/{manifest_id}/pdf exports a PDF via fpdf2.
#   PDF is returned as application/pdf.  If fpdf2 is not installed, returns
#   a 501 with instructions.
# ============================================================================

from __future__ import annotations

import logging
import math
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models import Habitation, ZoneScore, CandidateSite, Region, get_db

log = logging.getLogger(__name__)
router = APIRouter(tags=["manifest"])

# ── Resource calculation constants ──────────────────────────────────────────
PERSONS_PER_NDRF_TEAM:      int = int(os.getenv("PERSONS_PER_NDRF_TEAM", "50"))
TRANSPORT_CAPACITY_PERSONS: int = int(os.getenv("TRANSPORT_CAPACITY_PERSONS", "30"))
MEDICAL_UNIT_PERSONS:       int = int(os.getenv("MEDICAL_UNIT_PERSONS", "500"))
VULNERABILITY_SURGE_FACTOR: float = float(os.getenv("VULNERABILITY_SURGE_FACTOR", "1.3"))


# ── Pydantic models ──────────────────────────────────────────────────────────

class ManifestHabitationInput(BaseModel):
    habitation_id:       int
    vulnerability_index: Optional[float] = Field(None, ge=0.0, le=1.0,
        description="Social vulnerability index (§2.1); if provided, increases resource allocation")


class ResourceEstimate(BaseModel):
    ndrf_sdrf_teams:  int
    transport_trucks: int
    medical_units:    int
    transit_days_est: int
    vulnerability_adjusted: bool


class ManifestEntry(BaseModel):
    habitation_id:     int
    habitation_name:   str
    district:          str
    region_name:       str
    population:        int
    relocation_horizon: Optional[str]
    matched_site_id:   Optional[int]
    matched_site_name: Optional[str]
    resources:         ResourceEstimate
    notes:             list[str]


class DeploymentManifest(BaseModel):
    manifest_id:        str
    generated_at:       str
    generated_by:       str  # "REDZONE Engine v2.0"
    total_population:   int
    entries:            list[ManifestEntry]
    totals:             ResourceEstimate
    coordination_notes: list[str]
    data_note:          str


class ManifestRequest(BaseModel):
    habitations: list[ManifestHabitationInput] = Field(
        min_length=1, description="List of habitation_ids to include in this manifest"
    )
    requesting_authority: str = Field(
        default="District Collector / DDMA",
        description="Name of the requesting authority (appears on the PDF)"
    )


# ── Resource calculation ─────────────────────────────────────────────────────

_HORIZON_TRANSIT_DAYS = {
    "IMMEDIATE":   3,
    "SHORT_TERM":  30,
    "MEDIUM_TERM": 365,
    "MONITOR":     0,
}


def _calc_resources(population: int,
                    vulnerability_index: Optional[float],
                    horizon: Optional[str]) -> tuple[ResourceEstimate, list[str]]:
    """Returns (ResourceEstimate, notes list)."""
    vuln_adj = (vulnerability_index is not None and vulnerability_index >= 0.6)
    effective_pop = math.ceil(population * VULNERABILITY_SURGE_FACTOR) if vuln_adj else population

    teams    = max(1, math.ceil(effective_pop / PERSONS_PER_NDRF_TEAM))
    trucks   = max(1, math.ceil(effective_pop / TRANSPORT_CAPACITY_PERSONS))
    medical  = max(1, math.ceil(effective_pop / MEDICAL_UNIT_PERSONS))
    days     = _HORIZON_TRANSIT_DAYS.get(horizon or "MONITOR", 0)

    notes = []
    if vuln_adj:
        notes.append(
            f"Resource allocation increased by {int((VULNERABILITY_SURGE_FACTOR-1)*100)}% "
            f"due to vulnerability_index={vulnerability_index:.2f} ≥ 0.60 "
            f"(elderly/disabled/kutcha-housing population requires additional support)."
        )
    if horizon == "IMMEDIATE":
        notes.append("IMMEDIATE horizon: pre-position teams before monsoon peak. 24-hour activation window.")
    if horizon == "MONITOR":
        notes.append("MONITOR: no immediate deployment required. Pre-plan only.")

    return (
        ResourceEstimate(
            ndrf_sdrf_teams=teams,
            transport_trucks=trucks,
            medical_units=medical,
            transit_days_est=days,
            vulnerability_adjusted=vuln_adj,
        ),
        notes,
    )


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post(
    "/manifest",
    response_model=DeploymentManifest,
    summary="§2.7 — Generate NDRF/SDRF deployment manifest for selected habitations",
)
def create_manifest(
    req: ManifestRequest,
    db:  Session = Depends(get_db),
):
    """
    Generates a structured deployment manifest.

    Calculates required NDRF/SDRF teams, transport, and medical resources
    based on each habitation's population, relocation_horizon, and optional
    vulnerability_index.

    The manifest is designed for district-level briefings and SDMA coordination.
    """
    entries:      list[ManifestEntry] = []
    total_pop     = 0
    sum_teams     = 0
    sum_trucks    = 0
    sum_medical   = 0
    coord_notes:  list[str] = []

    for h_input in req.habitations:
        hab = db.get(Habitation, h_input.habitation_id)
        if not hab:
            raise HTTPException(
                status_code=404,
                detail=f"Habitation {h_input.habitation_id} not found"
            )

        zs = db.get(ZoneScore, hab.id)
        horizon    = zs.relocation_horizon.value if zs and zs.relocation_horizon else None
        site_id    = zs.matched_site_id if zs else None
        site_name: Optional[str] = None
        if site_id:
            site = db.get(CandidateSite, site_id)
            site_name = site.name if site else None

        region_name = ""
        if hab.region_id:
            r = db.get(Region, hab.region_id)
            region_name = r.name if r else ""

        resources, notes = _calc_resources(
            population=hab.population,
            vulnerability_index=h_input.vulnerability_index,
            horizon=horizon,
        )
        if not site_name:
            notes.append("No matched relocation site — escalate site search in parallel.")
        if horizon == "IMMEDIATE":
            coord_notes.append(
                f"{hab.name} ({hab.district}): IMMEDIATE — NDRF deployment required within 24h."
            )

        entries.append(ManifestEntry(
            habitation_id=hab.id,
            habitation_name=hab.name,
            district=hab.district,
            region_name=region_name,
            population=hab.population,
            relocation_horizon=horizon,
            matched_site_id=site_id,
            matched_site_name=site_name,
            resources=resources,
            notes=notes,
        ))

        total_pop   += hab.population
        sum_teams   += resources.ndrf_sdrf_teams
        sum_trucks  += resources.transport_trucks
        sum_medical += resources.medical_units

    manifest_id = f"MFT-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    totals = ResourceEstimate(
        ndrf_sdrf_teams=sum_teams,
        transport_trucks=sum_trucks,
        medical_units=sum_medical,
        transit_days_est=max(
            _HORIZON_TRANSIT_DAYS.get(
                (e.relocation_horizon or "MONITOR"), 0
            )
            for e in entries
        ) if entries else 0,
        vulnerability_adjusted=any(e.resources.vulnerability_adjusted for e in entries),
    )

    if not coord_notes:
        coord_notes = ["No IMMEDIATE habitations in this manifest — plan-level coordination only."]

    return DeploymentManifest(
        manifest_id=manifest_id,
        generated_at=datetime.now(timezone.utc).isoformat(),
        generated_by="REDZONE Engine v2.0",
        total_population=total_pop,
        entries=entries,
        totals=totals,
        coordination_notes=coord_notes,
        data_note=(
            "Resource estimates are computed from population, horizon, and vulnerability index. "
            "Actual deployment quantities must be confirmed by the DDMA/NDRF team commander. "
            "Population figures sourced from Census 2011 — may not reflect current figures."
        ),
    )


@router.get(
    "/manifest/{manifest_id}/pdf",
    summary="§2.7 — Export a manifest as PDF (requires fpdf2)",
    responses={501: {"description": "fpdf2 not installed"}},
)
def export_manifest_pdf(
    manifest_id: str,
    habitation_ids: str = Query(..., description="Comma-separated habitation IDs"),
    db: Session = Depends(get_db),
):
    """
    Exports the deployment manifest as a downloadable PDF.
    Requires `fpdf2` in requirements.txt.
    If not installed, returns 501 with pip install instructions.
    """
    try:
        from fpdf import FPDF
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="PDF export requires fpdf2. Install with: pip install fpdf2"
        )

    ids = [int(x.strip()) for x in habitation_ids.split(",") if x.strip()]
    inputs = [ManifestHabitationInput(habitation_id=hid) for hid in ids]
    manifest = create_manifest(ManifestRequest(habitations=inputs), db=db)

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "REDZONE — Deployment Manifest", ln=True, align="C")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"Manifest ID: {manifest.manifest_id}", ln=True)
    pdf.cell(0, 6, f"Generated: {manifest.generated_at}", ln=True)
    pdf.cell(0, 6, f"Total Population: {manifest.total_population}", ln=True)
    pdf.ln(5)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Coordination Notes", ln=True)
    pdf.set_font("Helvetica", "", 10)
    for note in manifest.coordination_notes:
        pdf.multi_cell(0, 6, f"• {note}")
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Habitation Entries", ln=True)
    for entry in manifest.entries:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, f"{entry.habitation_name} — {entry.district} ({entry.region_name})", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(0, 5, f"  Population: {entry.population} | Horizon: {entry.relocation_horizon or 'N/A'}", ln=True)
        pdf.cell(0, 5, f"  Matched Site: {entry.matched_site_name or 'None — escalate search'}", ln=True)
        r = entry.resources
        pdf.cell(0, 5,
                 f"  NDRF/SDRF Teams: {r.ndrf_sdrf_teams} | Trucks: {r.transport_trucks} | Medical Units: {r.medical_units}",
                 ln=True)
        for note in entry.notes:
            pdf.multi_cell(0, 5, f"  NOTE: {note}")
        pdf.ln(2)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "TOTALS", ln=True)
    pdf.set_font("Helvetica", "", 10)
    t = manifest.totals
    pdf.cell(0, 6, f"  NDRF/SDRF Teams: {t.ndrf_sdrf_teams}", ln=True)
    pdf.cell(0, 6, f"  Transport Trucks: {t.transport_trucks}", ln=True)
    pdf.cell(0, 6, f"  Medical Units: {t.medical_units}", ln=True)
    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8)
    pdf.multi_cell(0, 5, manifest.data_note)

    pdf_bytes = pdf.output()
    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={manifest.manifest_id}.pdf"},
    )
