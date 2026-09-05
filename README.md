# REDZONE: Assam Flood & Erosion Relocation Engine

![REDZONE Platform Screenshot](./screenshot.png)

**REDZONE** is a highly specialized, decision-support platform built for disaster-management authorities (such as ASDMA and NDRF). It acts as a comprehensive Risk-Aware Relocation Engine specifically tailored for the highly vulnerable districts of Assam: **Majuli, Dhemaji, and Cachar**.

The core value proposition of REDZONE is simple but powerful:
> *"Existing systems can show authorities where flooding is happening. REDZONE answers the next critical questions: WHO should be prioritized, WHY are they at risk, WHERE can they safely relocate, and HOW should the relocation be executed?"*

## 🔄 The Core Operational Loop

REDZONE moves disaster response from purely reactive observation to proactive, structured execution through its core paradigm:

**RISK → REASON → DESTINATION → ROUTE → ACTION**

1. **DETECT**: Ingest live environmental and geospatial telemetry (river levels, rainfall, erosion).
2. **ASSESS**: Calculate multi-factor hazard scores using weighted geospatial and demographic inputs.
3. **PRIORITIZE**: Rank habitations in a P0-P2 queue to determine who needs immediate intervention.
4. **MATCH**: Intelligently allocate vulnerable populations to secure "Safe Sites" based on elevation, capacity, and distance.
5. **ROUTE**: Compare primary and alternate evacuation routes to avoid bottlenecks and submerged infrastructure.
6. **RELOCATE**: Generate field-ready Deployment Manifests specifying NDRF teams, transport logistics, and medical resource needs.
7. **MONITOR**: Provide an audit trail and XAI (Explainable AI) justifications for every decision made.

## 🛠 Platform Modules

### 1. Command Center (Situational Matrix)
A tactical dashboard displaying the live Priority Queue of habitations. The integrated **Decision Panel** employs Explainable AI to break down the exact environmental stressors (e.g., Slope Gradient, Distance to River, NDVI loss) causing a high risk score, providing a transparent audit trail for commanders.

### 2. Safe Site & Route Intelligence
An interactive GIS module that ranks available high-ground parcels (Safe Sites) based on capacity and distance. It provides route comparisons (Primary vs. Alternate), highlighting estimated travel times, road conditions, and critical chokepoints.

### 3. Relocation Planner
The operational wizard of the platform. A streamlined 4-step workflow that allows operators to select vulnerable habitations, assign them to a Safe Site, allocate resources (NDRF, Buses, Medical Kits), and instantly generate a standardized Deployment Manifest.

### 4. Scenario Lab
A sandbox environment for conducting environmental stress tests. Operators can use sliders to adjust hypothetical stressors—like increased river levels (+m), excess rainfall (mm/24h), and accelerated erosion—to see real-time projections on habitations, shifting from Baseline to Projected (+48h) states.

### 5. Incident Reports
A historical archive that stores generated deployment manifests and post-action audit trails, ensuring complete accountability and providing data for retrospective analysis.

## 🏗 System Architecture

REDZONE follows a decoupled, service-oriented architecture:

- **Frontend (Client)**: 
  - Built with **React** and **Vite**.
  - Styled with **Tailwind CSS** following a strict "Bloomberg Terminal + Professional GIS" aesthetic (Dark mode, monospaced data grids, high-contrast tactical colors).
  - Integrates **Leaflet** for high-performance spatial visualization and custom routing polylines.
  
- **Backend (API Engine)**:
  - Built with **Python** and **FastAPI**.
  - Powered by scientific computing libraries (`numpy`, `pandas`) to process complex prioritization matrixes, capacity matching, and hazard simulations.
  
- **Containerization**:
  - Fully containerized using **Docker** and `docker-compose` for rapid, consistent deployment in emergency operation centers.

## 🚀 Quickstart Guide

### Prerequisites
- Node.js (v18+)
- Python (3.10+)
- Docker & Docker Compose (Optional, but recommended)

### Running with Docker (Recommended)
```bash
docker-compose up --build
```
- The Frontend will be available at `http://localhost:5173`
- The Backend API will be available at `http://localhost:8000`

### Running Locally (Manual Setup)

**1. Start the Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**2. Start the Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## 🎨 Design Philosophy
The UI intentionally avoids gamified "cyberpunk" tropes. It utilizes high-contrast glassmorphism, precise data-density, and anti-emoji SVG primitives to ensure that critical operational data is legible, professional, and actionable under high-stress scenarios.

---
*Built for Smart India Hackathon 2026*
