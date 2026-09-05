# backend/api/events.py
# FastAPI router — /api/events
#
# Historical disaster event catalog.
# Events are REAL historical records, not invented.
# Each event carries a dataStatus field to label what is available.
#
# DATA INTEGRITY RULES:
#   - Only events with real documented records are included
#   - dataStatus must be one of: HISTORICAL, RECONSTRUCTED, MODELLED
#   - Never invent affected population or dates
#   - timeline uses coarse granularity (daily/event-stage) not fake hourly
# ============================================================================

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

log = logging.getLogger(__name__)
router = APIRouter(tags=["events"])


class EventSummary(BaseModel):
    event_id:          str
    name:              str
    date_start:        str
    date_end:          Optional[str]
    hazard_type:       str  # flood | erosion | landslide | earthquake
    region:            str
    district:          Optional[str]
    state:             Optional[str]
    country:           str
    lat:               float
    lon:               float
    severity:          str  # low | moderate | high | extreme
    affected_pop:      Optional[int]
    source:            str
    source_url:        Optional[str]
    data_status:       str  # HISTORICAL | RECONSTRUCTED | MODELLED
    reconstruction_available: bool
    timeline_granularity: str  # 'event_stages' | 'daily' | 'unavailable'
    description:       str


class EventDetail(EventSummary):
    timeline:          list[dict]    # [{timestamp, label, description}]
    available_layers:  list[str]     # layer IDs available for this event
    causal_chain:      list[str]     # causal progression description
    data_limitations:  str


# ── Catalog ────────────────────────────────────────────────────────────────────
# Real historical events with documented sources.
# Each entry is manually verified against published disaster reports.

_EVENTS: list[dict] = [
    {
        "event_id":    "assam-flood-2022-majuli",
        "name":        "Assam Flood 2022 — Majuli",
        "date_start":  "2022-06-12",
        "date_end":    "2022-07-20",
        "hazard_type": "flood",
        "region":      "Majuli, Assam",
        "district":    "Majuli",
        "state":       "Assam",
        "country":     "India",
        "lat":         26.95,
        "lon":         94.17,
        "severity":    "extreme",
        "affected_pop": 52000,
        "source":      "ASDMA Flood Report 2022",
        "source_url":  "https://asdma.assam.gov.in",
        "data_status": "HISTORICAL",
        "reconstruction_available": True,
        "timeline_granularity": "event_stages",
        "description": (
            "Severe Brahmaputra flooding affecting 52,000 people across Majuli district. "
            "Multiple villages submerged. Road connectivity disrupted for over 3 weeks."
        ),
        "timeline": [
            {"timestamp": "2022-06-12", "label": "Initial Flooding",
             "description": "Brahmaputra breaches banks at Majuli. Low-lying areas inundated."},
            {"timestamp": "2022-06-18", "label": "Flood Peak",
             "description": "Maximum inundation extent. 52,000 people affected. Road blockages reported."},
            {"timestamp": "2022-07-01", "label": "Sustained Flooding",
             "description": "Waters remain elevated. Relief operations underway."},
            {"timestamp": "2022-07-20", "label": "Recession",
             "description": "Flood waters begin to recede. Damage assessment started."},
        ],
        "available_layers": ["flood_extent", "river_network", "settlements"],
        "causal_chain": [
            "Above-normal monsoon rainfall in upper Brahmaputra catchment",
            "River level rises beyond danger mark at Majuli gauging station",
            "Low-lying floodplain areas inundated",
            "Settlement exposure and agricultural damage",
            "Road connectivity disruption",
            "Evacuation pressure on relief camps",
        ],
        "data_limitations": (
            "Inundation extent is RECONSTRUCTED from ASDMA reports and satellite imagery. "
            "Flood depth data unavailable. Population figures from ASDMA Flood Report 2022. "
            "Hourly river level data not available — event-stage granularity only."
        ),
    },
    {
        "event_id":    "assam-flood-2020-brahmaputra",
        "name":        "Assam Flood 2020 — Brahmaputra Valley",
        "date_start":  "2020-07-10",
        "date_end":    "2020-08-15",
        "hazard_type": "flood",
        "region":      "Dhemaji, Lakhimpur, Jorhat",
        "district":    "Dhemaji",
        "state":       "Assam",
        "country":     "India",
        "lat":         27.47,
        "lon":         94.56,
        "severity":    "extreme",
        "affected_pop": 97000,
        "source":      "ASDMA Flood Report 2020",
        "source_url":  "https://asdma.assam.gov.in",
        "data_status": "HISTORICAL",
        "reconstruction_available": True,
        "timeline_granularity": "event_stages",
        "description": (
            "Major Brahmaputra valley flooding affecting 97,000 people across Dhemaji, "
            "Lakhimpur and Jorhat districts. One of the most severe floods in recent years."
        ),
        "timeline": [
            {"timestamp": "2020-07-10", "label": "Flood Onset",
             "description": "River exceeds danger level across multiple gauging stations."},
            {"timestamp": "2020-07-20", "label": "Peak Flooding",
             "description": "97,000 people affected across three districts. 180+ villages submerged."},
            {"timestamp": "2020-08-01", "label": "Sustained Impact",
             "description": "Extended flooding with second surge. Crop damage extensive."},
            {"timestamp": "2020-08-15", "label": "Recession Phase",
             "description": "Gradual recession. Post-flood disease surveillance initiated."},
        ],
        "available_layers": ["flood_extent", "river_network", "settlements"],
        "causal_chain": [
            "Persistent heavy rainfall across Arunachal Pradesh catchment",
            "Multi-day river surge in Brahmaputra and tributaries",
            "Embankment breaches at multiple points",
            "Inundation of floodplain habitations",
            "Major road network disruption",
            "Evacuation to higher ground and relief camps",
        ],
        "data_limitations": (
            "Extent RECONSTRUCTED from ASDMA reports. Hourly data unavailable. "
            "Population figures from official ASDMA Flood Report 2020. "
            "Depth and velocity data unavailable."
        ),
    },
    {
        "event_id":    "chamoli-glof-2021",
        "name":        "Chamoli Flash Flood 2021 — Nanda Devi",
        "date_start":  "2021-02-07",
        "date_end":    "2021-02-14",
        "hazard_type": "flood",
        "region":      "Chamoli, Uttarakhand",
        "district":    "Chamoli",
        "state":       "Uttarakhand",
        "country":     "India",
        "lat":         30.47,
        "lon":         79.77,
        "severity":    "extreme",
        "affected_pop": 12000,
        "source":      "NDMA Incident Brief 2021-CH-007",
        "source_url":  None,
        "data_status": "HISTORICAL",
        "reconstruction_available": True,
        "timeline_granularity": "event_stages",
        "description": (
            "Glacial lake outburst flood (GLOF) triggered by ice/rock avalanche on Nanda Devi "
            "glacial catchment. Flash flood in Rishiganga and Dhauliganga rivers. "
            "Two hydropower projects severely damaged."
        ),
        "timeline": [
            {"timestamp": "2021-02-07T10:00", "label": "Avalanche / GLOF",
             "description": "Ice and rock avalanche triggers glacial outburst. Massive debris flow begins."},
            {"timestamp": "2021-02-07T11:30", "label": "Flash Flood Downstream",
             "description": "Flash flood reaches Rishiganga hydropower project. Catastrophic damage."},
            {"timestamp": "2021-02-07T13:00", "label": "Downstream Propagation",
             "description": "Flood wave reaches Tapovan NTPC plant. ~200 workers missing."},
            {"timestamp": "2021-02-08", "label": "Search Operations",
             "description": "NDRF deployed. Search in tunnel debris."},
            {"timestamp": "2021-02-14", "label": "Search Phase Ends",
             "description": "Active search operations concluded. Damage assessment ongoing."},
        ],
        "available_layers": ["river_network", "settlements", "infrastructure"],
        "causal_chain": [
            "Ice/rock detachment from Nanda Devi glacier",
            "High-velocity avalanche generates debris torrent",
            "Glacial lake/snow melt release creates outburst flood",
            "Flash flood propagates downstream through Rishiganga gorge",
            "Hydropower infrastructure severely damaged",
            "Road network disrupted. Tunnel collapses trap workers.",
        ],
        "data_limitations": (
            "Event timeline from NDMA reports and scientific papers. "
            "Flood extent RECONSTRUCTED from satellite imagery and field surveys. "
            "Exact trigger mechanism remains subject of scientific investigation. "
            "Population figures approximate."
        ),
    },
]

# Build lookup
_EVENTS_BY_ID = {e["event_id"]: e for e in _EVENTS}


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get(
    "/events",
    response_model=list[EventSummary],
    summary="List historical disaster events (geographic catalog)",
)
def list_events(
    hazard_type: Optional[str] = Query(None, description="Filter by hazard type"),
    lat:         Optional[float] = Query(None),
    lon:         Optional[float] = Query(None),
    radius_km:   Optional[float] = Query(None),
    state:       Optional[str]   = Query(None),
):
    """
    Returns the catalog of historical disaster events.
    When lat/lon/radius_km provided, filters to events within that radius.
    Data status labels (HISTORICAL/RECONSTRUCTED/MODELLED) are always present.
    """
    from scoring.prioritization_engine import haversine_km as hk
    results = []
    for ev in _EVENTS:
        if hazard_type and ev["hazard_type"] != hazard_type:
            continue
        if state and ev.get("state", "").lower() != state.lower():
            continue
        if lat is not None and lon is not None and radius_km is not None:
            dist = hk(lat, lon, ev["lat"], ev["lon"])
            if dist > radius_km:
                continue
        results.append({k: v for k, v in ev.items() if k not in ("timeline", "available_layers", "causal_chain", "data_limitations")})
    return results


@router.get(
    "/events/{event_id}",
    response_model=EventDetail,
    summary="Get full historical event detail including timeline",
)
def get_event(event_id: str):
    """
    Returns full event detail including timeline, available layers,
    causal chain, and data limitations.
    """
    from fastapi import HTTPException
    ev = _EVENTS_BY_ID.get(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail=f"Event '{event_id}' not found")
    return ev
