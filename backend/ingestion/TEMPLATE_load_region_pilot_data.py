# backend/ingestion/TEMPLATE_load_region_pilot_data.py
# ============================================================================
# TEMPLATE: Add a new region to REDZONE
#
# PURPOSE:
#   This file demonstrates exactly what a new region's seed script must provide.
#   Copy this file, rename it to load_<region>_pilot_data.py, fill in all
#   sections, and run it once.  No changes to core REDZONE code are needed —
#   the platform is designed to be region-agnostic; adding a new region is
#   entirely a data exercise.
#
# CHECKLIST BEFORE SUBMITTING A NEW REGION:
#   [ ] REGION dict filled with real coordinates and hazard types
#   [ ] All HABITATIONS have real lat/lon, real population (Census/SECC/DRDA),
#       real slope_degrees and distance_to_hazard_km (SRTM DEM / Bhuvan),
#       and terrain_data_source set to "REAL" or "SYNTH" (never blank)
#   [ ] DISASTER_EVENTS have real event_date, severity, and a citable source
#   [ ] CANDIDATE_SITES have real coordinates and real/citable capacity estimate
#   [ ] HAZARD_ZONES have real polygon coordinates and a citable source
#   [ ] data_sources.md updated with a new row for this region's data
#   [ ] README.md "Covered Regions" table updated
#
# DATA INTEGRITY RULES (mandatory):
#   1. Never leave terrain_data_source blank or set it to "REAL" if the value
#      is not verifiably DEM-derived. Use "SYNTH" + a note in the comment.
#   2. Every event source must be a real citable document (DDMA report, NDRF
#      action log, ASDMA bulletin, etc.) or explicitly "SYNTH — <reason>".
#   3. Do NOT fabricate hazard zone polygons for hazard types not present in
#      citable sources for this region.  Only add what you can cite.
#   4. population_source: "REAL" = Census 2011 / SECC 2011 / DRDA survey.
#      "SYNTH" = estimated.  For Census data, note "as of Census 2011" in the
#      description — the platform surfaces data vintage in every API response.
# ============================================================================

import sys
import os
import logging
import argparse
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from models import (
    engine, create_all_tables,
    Habitation, HazardZone, DisasterHistory,
    CandidateSite, HazardType, Region,
)
from ingestion.pilot_data_common import (
    seed_region, seed_habitations, seed_disaster_history,
    seed_candidate_sites, seed_hazard_zones,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
log = logging.getLogger("load_REGIONNAME_pilot_data")


# ============================================================================
# SECTION 1: Region definition
# ============================================================================
# DESIGN CHOICE NOTE (document here):
#   - One row per district or one combined row? (See load_assam_pilot_data.py for
#     the Assam design rationale.)
#   - center_lat/center_lon: geographic centroid of the covered area.
#   - bounding_radius_km: must cover the farthest habitation from the centroid.
#   - primary_hazard_types: list of HazardType values that have *real citable*
#     zone polygons seeded below. Do NOT list a type if you have no real zones.

REGION = dict(
    name="REPLACE_ME — unique region name (e.g. 'Chamoli Pilot')",
    state="REPLACE_ME — state name",
    country="India",
    center_lat=0.0,     # REPLACE with real centroid latitude
    center_lon=0.0,     # REPLACE with real centroid longitude
    bounding_radius_km=50.0,  # REPLACE with km from centroid to farthest habitation
    primary_hazard_types=["flood"],  # REPLACE with real hazard types from your zones
    owm_poll_enabled=True,
    usgs_poll_enabled=True,
    data_status="PILOT",
)


# ============================================================================
# SECTION 2: Habitations
# ============================================================================
# Minimum required fields per entry (§1.1):
#   name, lat, lon, population, population_source, district, state,
#   slope_degrees, distance_to_hazard_km, terrain_data_source

HABITATIONS = [
    # --- EXAMPLE (delete this and replace with real data) ---
    dict(
        name="Example Settlement Name",
        lat=0.0,          # REPLACE: WGS84 latitude (degrees)
        lon=0.0,          # REPLACE: WGS84 longitude (degrees)
        population=0,     # REPLACE: persons; Census 2011 preferred
        population_source="REAL",   # "REAL" = Census 2011/SECC; "SYNTH" = estimated
        district="REPLACE_ME",
        state="REPLACE_ME",
        slope_degrees=0.0,          # REPLACE: from SRTM DEM; 0–90 degrees
        distance_to_hazard_km=0.0,  # REPLACE: km to nearest river/hazard source
        terrain_data_source="SYNTH",  # "REAL" = DEM-derived; "SYNTH" = estimate
    ),
]


# ============================================================================
# SECTION 3: Disaster history
# ============================================================================
# Keys must match HABITATIONS names exactly.

DISASTER_EVENTS = {
    # --- EXAMPLE (delete and replace) ---
    "Example Settlement Name": [
        dict(
            event_type="flood",      # one of: flood, landslide, coastal_erosion,
                                     #         cloudburst, subsidence, debris_flow
            event_date=date(2024, 1, 1),  # REPLACE with real event date
            severity=3,              # 1–5: 5 = most severe (casualties, infrastructure loss)
            casualties=0,            # REPLACE or set None if unknown
            description="REPLACE with factual event description.",
            source="REPLACE with citation: DDMA report, NDRF log, ASDMA bulletin, etc.",
        ),
    ],
}


# ============================================================================
# SECTION 4: Candidate relocation sites
# ============================================================================

CANDIDATE_SITES = [
    # --- EXAMPLE (delete and replace) ---
    dict(
        name="Example Safe Site",
        lat=0.0,          # REPLACE
        lon=0.0,          # REPLACE
        available_land_sqm=0.0,     # REPLACE: government-measured parcel area
        slope_degrees=0.0,          # REPLACE: DEM-derived
        distance_to_road_km=0.0,    # REPLACE: from OSM / survey
        distance_to_water_km=0.0,   # REPLACE: distance to nearest potable water
        existing_occupancy=0,       # REPLACE: persons already living on this parcel
        max_capacity_estimate=0,    # REPLACE: available_land_sqm / 9.5 × usability_factor
        data_source="SYNTH",        # "REAL" if capacity from a government survey
        district="REPLACE_ME",
        state="REPLACE_ME",
    ),
]


# ============================================================================
# SECTION 5: Hazard zone polygons
# ============================================================================
# IMPORTANT: Only include zones with real citable sources.
# Do NOT add SYNTH zones unless they are clearly needed for a demo and are
# clearly labelled "SYNTH — <reason>" in the source field.
# Polygon coordinates: list of (longitude, latitude) tuples, closed (first == last).

HAZARD_ZONES = [
    # --- EXAMPLE (delete and replace) ---
    dict(
        hazard_type=HazardType.flood,  # must match a value in HazardType enum
        coords=[
            # (lon, lat), (lon, lat), ... close the ring by repeating first point
            (0.0, 0.0), (0.1, 0.0), (0.1, 0.1), (0.0, 0.1), (0.0, 0.0),
        ],
        intensity_class=3,  # 1–5; 5 = most severe
        source="REPLACE with citation",
    ),
]


# ============================================================================
# Execution
# ============================================================================

def main(reset: bool = False):
    log.info("=== load_REGIONNAME_pilot_data.py ===")
    create_all_tables()

    with Session(engine) as db:
        if reset:
            log.warning("--reset: clearing all database tables")
            db.query(DisasterHistory).delete()
            db.query(HazardZone).delete()
            db.query(CandidateSite).delete()
            db.query(Habitation).delete()
            db.query(Region).delete()
            db.commit()

        log.info("Seeding region…")
        region = seed_region(db, REGION)
        db.flush()

        log.info("Seeding habitations (%d)…", len(HABITATIONS))
        hab_map = seed_habitations(db, HABITATIONS, region)
        db.flush()

        log.info("Seeding disaster history…")
        seed_disaster_history(db, DISASTER_EVENTS, hab_map)

        log.info("Seeding candidate sites (%d)…", len(CANDIDATE_SITES))
        seed_candidate_sites(db, CANDIDATE_SITES, region)

        log.info("Seeding hazard zones (%d)…", len(HAZARD_ZONES))
        seed_hazard_zones(db, HAZARD_ZONES)

        db.commit()
        log.info("Commit complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed REGIONNAME pilot dataset")
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()
    main(reset=args.reset)
