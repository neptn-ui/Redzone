# REDZONE: Autonomous Disaster Relocation & Risk-Aware Evacuation Platform

![REDZONE Platform Screenshot](./screenshot.png)

**REDZONE** is an enterprise decision-support and relocation engine engineered for disaster-management authorities (such as ASDMA, NDRF, and SDMAs). Moving beyond traditional reactive hazard monitoring, REDZONE implements an autonomous operational loop:

> *"Existing systems display where disasters are occurring. REDZONE answers the operational imperatives: **WHO** is at risk, **WHY** they are endangered, **WHERE** they can safely relocate, and **HOW** evacuation and resource allocation must be executed."*

---

## 🔄 The Core Operational Loop

REDZONE transitions disaster operations into structured, explainable execution:

$$\text{DETECT} \longrightarrow \text{ASSESS} \longrightarrow \text{PRIORITIZE} \longrightarrow \text{MATCH} \longrightarrow \text{ROUTE} \longrightarrow \text{RELOCATE} \longrightarrow \text{AUDIT}$$

1. **DETECT**: Ingests real-time geographic telemetry (OpenStreetMap waterways, transport networks, critical infrastructure, and USGS global seismic catalogs).
2. **ASSESS**: Computes multi-factor hazard scores with verifiable provenance tags (`REAL`, `MODELLED`, `RECONSTRUCTED`, `UNAVAILABLE`).
3. **PRIORITIZE**: Classifies exposed habitations into an actionable triage queue (`IMMEDIATE`, `SHORT_TERM`, `MED_TERM`, `STABLE`).
4. **MATCH**: Allocates displaced populations to verified Safe Sites using National Building Code (NBC 2016) shelter spatial standards (min. 9.5 m²/person).
5. **ROUTE**: Evaluates primary and alternate evacuation corridors via road networks (OSRM integration) with hazard avoidance.
6. **RELOCATE**: Generates field-ready Operational Manifests specifying NDRF personnel, transport logistics, and medical resource needs.
7. **AUDIT**: Provides complete mathematical Explainable AI (XAI) audit trails for every prioritization and capacity decision.

---

## 🛰 Multi-Hazard GIS Architecture

REDZONE features a dedicated GIS layer stack tailored to four primary disaster modalities:

### 1. Flood Inundation (`FLOOD`)
- **Centerline Geometry**: Real OpenStreetMap hydrology (rivers, canals, tributaries).
- **Inundation Buffers**: Dual-zone hydrodynamic approximation (2 km outer extent, 800 m high-depth zone).
- **Infrastructure Impact**: Identification of submerged bridges, vulnerable road links, and flooded community centers.

### 2. Riverbank Erosion (`EROSION`)
- **Active Channel**: Primary high-energy river thalweg.
- **Active Erosion Band**: 150 m high-intensity near-bank vulnerability buffer.
- **Projection Corridor**: 500 m modelled retreat zone identifying threatened settlements and compromised bridge abutments.

### 3. Slope Failure & Landslide (`LANDSLIDE`)
- **Susceptibility Zones**: Hazard score-proportional irregular terrain polygons.
- **Transport Vulnerability**: Detection of arterial roads intersecting high-susceptibility slope corridors.
- **Honest Provenance**: Explicit declaration of DEM/slope raster absence when satellite radar data is unavailable.

### 4. Seismic Impact (`EARTHQUAKE`)
- **USGS Real-Time Integration**: Live query of seismic events ($\ge M3.5$) within regional radius.
- **Modified Mercalli Intensity (MMI)**: Attenuation-based contour rings from MMI VII+ (Severe) to MMI III (Weak).
- **Impact Radius**: Pulsating epicenter beacon and radial structural risk assessment.

---

## 🧠 Algorithmic Scoring & Explainable AI (XAI)

### 1. Habitation Urgency Index
$$\text{Urgency Score} = w_h \cdot H_{\text{norm}} + w_p \cdot P_{\text{norm}} + w_i \cdot (1 - I_{\text{access}}) + w_v \cdot V_{\text{vuln}}$$
- **Hazard Exposure ($H_{\text{norm}}$)**: Distance to hazard front and modelled intensity.
- **Demographic Vulnerability ($P_{\text{norm}}, V_{\text{vuln}}$)**: Population density, children, elderly, and infirm ratios.
- **Infrastructure Isolation ($I_{\text{access}}$)**: Distance to arterial roads and bridges.

### 2. Safe Site Capacity Index (NBC 2016 Compliant)
$$\text{Capacity Score} = 0.30 \cdot L_{\text{avail}} + 0.25 \cdot S_{\text{safety}} + 0.20 \cdot I_{\text{prox}} + 0.15 \cdot W_{\text{access}} + 0.10 \cdot (1 - \text{Load Ratio})$$
- **Land Availability ($L_{\text{avail}}$)**: Verified usable area divided by NBC 2016 standard ($9.5\text{ m}^2/\text{person}$).
- **Slope Safety ($S_{\text{safety}}$)**: Terrain gradient within safe habitation envelope ($< 20^\circ$).
- **Infrastructure Proximity ($I_{\text{prox}}$)**: Distance to primary road network ($< 5\text{ km} = 1.0$).
- **Water Access ($W_{\text{access}}$)**: Proximity to potable water networks.
- **Load Headroom**: Remaining unallocated shelter capacity.

---

## 🛠 Platform Modules

| Module | Purpose | Key Capabilities |
| :--- | :--- | :--- |
| **Command Center** | Situational Awareness | Real-time map, P0–P2 priority triage queue, stressor breakdown. |
| **Safe Site Intelligence** | Shelter Matching | NBC 2016 capacity audits, terrain safety scoring, live OSRM route computation. |
| **Relocation Planner** | Operational Execution | 4-step wizard: Selection $\rightarrow$ Allocation $\rightarrow$ Logistics $\rightarrow$ Deployment Manifest. |
| **Scenario Lab** | Predictive Simulation | What-if modeling (rainfall +mm, river surge +m, erosion rate $\Delta$) with +48h projections. |
| **Events & Historical Replay**| Forensic Analysis | Scrub through historical disaster timelines to audit systemic response efficacy. |
| **Incident Reports** | Accountability & Records | Searchable archive of generated deployment manifests and post-action audit trails. |

---

## 🏗 System Architecture & Technology Stack

```
redzone/
├── backend/                  # FastAPI Application
│   ├── api/                  # Modular endpoints (zones, sites, events, scenario, areas)
│   ├── scoring/              # Core math engines (capacity_engine, hazard_engine, matching_optimizer)
│   ├── models.py             # SQLAlchemy models & schema definitions
│   └── main.py               # Application entrypoint & middleware
└── frontend/                 # React 18 + Vite SPA
    ├── src/
    │   ├── api/              # Client API, Overpass multi-mirror failover, OSRM routing
    │   ├── components/       # HazardMap, MapInspectorPanel, HazardLegend, GlobalSearch
    │   ├── context/          # AppStore (state machine) & AreaContext
    │   └── pages/            # CommandCenter, SafeSiteIntelligence, RelocationPlanner, etc.
```

- **Frontend**: React 18, Vite, Vanilla CSS + Tailwind utility layer, Leaflet GIS, Framer Motion.
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, SQLite/PostGIS, Pydantic v2.
- **Telemetry**: OpenStreetMap Overpass API (multi-mirror with failover cache), USGS Earthquake API, OSRM Routing.

---

## 🚀 Quickstart Guide

### Prerequisites
- Node.js (v18+)
- Python (3.10+)

### 1. Start the Backend API
```bash
cd backend
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Start the Frontend Application
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🔒 Data Provenance & Reliability Contract

REDZONE adheres to strict truth-in-data principles:
- **No Hallucinated Data**: Every visual entity displays a provenance badge (`REAL`, `MODELLED`, `RECONSTRUCTED`, `UNAVAILABLE`).
- **Fail-Safe Offline Mode**: If external OSM Overpass servers are rate-limited or unreachable, the system automatically falls back to local high-resolution pilot corridor telemetry without freezing the interface.
- **Auditable AI**: No black-box decisions; all recommendations are fully decomposed into weighted mathematical factors.

---

*Built for Smart India Hackathon 2026 · Risk-Aware Relocation Platform*
