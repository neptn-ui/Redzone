# backend/models.py
# SQLAlchemy 2.0 + GeoAlchemy2 — Section 4 schema (8 tables).
# This is the single shared source of truth for all table definitions.
# Scoring engines, API routers, and the ingestion layer all import from here.
#
# §0 REGION-AGNOSTIC DESIGN:
#   REDZONE is a general-purpose engine; no region's name, coordinates, or
#   district is hardcoded here.  The `regions` table is the operational key
#   for all per-region logic: live-signal scoping, radius defaults, and hazard
#   type configuration.  "Assam" is the first pilot dataset loaded via
#   backend/ingestion/load_assam_pilot_data.py — it is not special in any way.
# ============================================================================

import os
import enum
from datetime import datetime, date

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Float,
    Boolean,
    Text,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    UniqueConstraint,
    CheckConstraint,
    Index,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, relationship, Session
from sqlalchemy.ext.hybrid import hybrid_property
from geoalchemy2 import Geometry


# ============================================================================
# Database connection
# ============================================================================

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://ndrf_user:change_me_local_only@localhost:5432/red_zone",
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,          # detect stale connections before use
    pool_size=5,
    max_overflow=10,
    echo=False,                  # set True to log SQL in debug mode
)


def get_db():
    """
    FastAPI dependency that yields a SQLAlchemy Session and closes it after
    the request. Usage in a route:

        @router.get("/example")
        def example(db: Session = Depends(get_db)):
            ...
    """
    with Session(engine) as session:
        yield session


# ============================================================================
# Declarative base
# ============================================================================

class Base(DeclarativeBase):
    pass


# ============================================================================
# Python enums (mirrored in PostgreSQL ENUM columns via SAEnum)
# ============================================================================

class HazardType(str, enum.Enum):
    landslide       = "landslide"
    flood           = "flood"
    coastal_erosion = "coastal_erosion"
    cloudburst      = "cloudburst"
    subsidence      = "subsidence"
    debris_flow     = "debris_flow"


class SignalType(str, enum.Enum):
    rainfall = "rainfall"
    seismic  = "seismic"


class SatelliteSource(str, enum.Enum):
    S1 = "S1"    # Sentinel-1 SAR
    S2 = "S2"    # Sentinel-2 Optical


class RiskClassification(str, enum.Enum):
    immediate   = "immediate"    # score 0.75–1.00 · Red
    short_term  = "short_term"   # score 0.55–0.74 · Orange
    medium_term = "medium_term"  # score 0.35–0.54 · Yellow
    stable      = "stable"       # score 0.00–0.34 · Green


class RelocationHorizon(str, enum.Enum):
    """
    §2.2 — Operational relocation horizon buckets (replaces the old
    RiskClassification labels as the primary user-facing status).

    IMMEDIATE   — Life-safety evacuation required. Hazard active/imminent;
                  move population out now (hours to days), typically to
                  temporary shelter. Never downgraded silently if no site
                  is matched — escalate emergency shelter search instead.

    SHORT_TERM  — Temporary relocation / continued displacement. Elevated
                  sustained risk, not immediately life-threatening; interim
                  housing while a permanent solution is arranged (weeks to ~1 yr).

    MEDIUM_TERM — Permanent relocation / resettlement assessment. Hazard trend
                  indicates long-term non-viability (recurring events, worsening
                  deformation/erosion); triggers formal resettlement planning
                  (land acquisition, community consultation). 1–3 years.

    MONITOR     — No relocation currently recommended. Below action thresholds;
                  continued sensor/satellite/live-signal observation.
    """
    IMMEDIATE   = "IMMEDIATE"
    SHORT_TERM  = "SHORT_TERM"
    MEDIUM_TERM = "MEDIUM_TERM"
    MONITOR     = "MONITOR"


class CurrentConditions(str, enum.Enum):
    LIVE       = "LIVE"
    RECENT     = "RECENT"
    HISTORICAL = "HISTORICAL"


class PermanentHabitationStatus(str, enum.Enum):
    SUITABLE    = "SUITABLE"
    CONDITIONAL = "CONDITIONAL"
    UNSUITABLE  = "UNSUITABLE"
    UNKNOWN     = "UNKNOWN"


class TransportNodeType(str, enum.Enum):
    ROAD_STAGING = "road_staging"
    HELIPAD      = "helipad"
    BOAT_JETTY   = "boat_jetty"
    FOOT_TRAIL   = "foot_trail"


# ============================================================================
# Table 0 — regions  (§0: platform configuration unit)
# Every habitation and candidate site belongs to exactly one region.
# Live-signal polling, search-radius defaults, and API filtering are all
# driven by this table — never by hardcoded coordinates or region names.
# ============================================================================

class Region(Base):
    """
    A geographic pilot region loaded into REDZONE.

    One row per region (e.g. "Assam Brahmaputra-Barak Pilot").
    center_lat/center_lon + bounding_radius_km define the approximate
    spatial extent used for search-radius defaults and live-signal polling.

    primary_hazard_types: JSON list of HazardType values active for this
        region, e.g. ["flood", "coastal_erosion"].

    owm_poll_enabled / usgs_poll_enabled: if True, the live_signals poller
        automatically polls this region at every cycle — no code change needed
        when a new region is added to this table.

    data_status:
        ACTIVE  — production quality, used in all API responses
        PILOT   — demo/hackathon quality, labelled as such in responses
        INACTIVE — temporarily disabled; not polled or returned by default
    """
    __tablename__ = "regions"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    name                 = Column(String(100), nullable=False, unique=True)
    state                = Column(String(100), nullable=False)
    country              = Column(String(100), nullable=False, default="India")
    center_lat           = Column(Float, nullable=False)
    center_lon           = Column(Float, nullable=False)
    bounding_radius_km   = Column(Float, nullable=False, default=50.0)

    # JSON list of HazardType string values active for this region.
    # e.g. ["flood", "coastal_erosion"]
    primary_hazard_types = Column(JSONB, nullable=False, default=list)

    owm_poll_enabled     = Column(Boolean, nullable=False, default=True)
    usgs_poll_enabled    = Column(Boolean, nullable=False, default=True)

    # ACTIVE | PILOT | INACTIVE
    data_status          = Column(String(20), nullable=False, default="PILOT")
    added_at             = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    habitations      = relationship("Habitation",    back_populates="region")
    candidate_sites  = relationship("CandidateSite", back_populates="region")

    def __repr__(self):
        return f"<Region id={self.id} name={self.name!r} status={self.data_status}>"


# ============================================================================
# Table 1 — habitations
# The atomic unit of analysis: a named settlement / ward cluster.
# ============================================================================

class Habitation(Base):
    """
    A settlement or ward cluster that may require relocation.
    geom     — centroid POINT  (EPSG:4326 / WGS84)
    boundary — approximate POLYGON outline of the habitation extent

    §0: district and state are free-text descriptive fields only.
    region_id is the operational foreign key — never default these values.

    §1.1 terrain fields:
        slope_degrees         — DEM-derived or SYNTH estimate; see terrain_data_source.
        distance_to_hazard_km — distance to nearest classified hazard source.
        terrain_data_source   — "REAL" (DEM/Bhuvan-derived) or "SYNTH" or "MISSING".
        If terrain_data_source is "MISSING", scoring will surface a MISSING flag
        rather than substituting a fake default.
    """
    __tablename__ = "habitations"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    name       = Column(String(200), nullable=False)
    geom       = Column(Geometry(geometry_type="POINT",    srid=4326), nullable=False)
    boundary   = Column(Geometry(geometry_type="POLYGON",  srid=4326), nullable=True)
    population = Column(Integer, nullable=False)

    # §0: no default — must be explicitly supplied by the seed script
    district   = Column(String(100), nullable=False)
    state      = Column(String(100), nullable=False)

    # Source-of-truth flag: REAL = from Census 2011; SYNTH = calibrated proxy
    population_source = Column(String(20), nullable=False, default="REAL")

    # §0: region FK — operational key for live-signal scoping, radius defaults
    region_id  = Column(Integer, ForeignKey("regions.id", ondelete="RESTRICT"),
                        nullable=False, index=True)

    # §1.1 Terrain attributes (replaces the deleted _PILOT_SLOPES/_PILOT_DISTANCES dicts)
    # Every seed script must supply real values; "MISSING" is the honest fallback.
    slope_degrees         = Column(Float, nullable=True)   # degrees; 0–90
    distance_to_hazard_km = Column(Float, nullable=True)   # km to nearest hazard source
    terrain_data_source   = Column(String(20), nullable=True)  # REAL | SYNTH | MISSING

    # Relationships
    region          = relationship("Region",        back_populates="habitations")
    disaster_events = relationship("DisasterHistory", back_populates="habitation",
                                   cascade="all, delete-orphan")
    zone_score      = relationship("ZoneScore", back_populates="habitation",
                                   uselist=False, cascade="all, delete-orphan")
    satellite_passes = relationship("SatellitePass", back_populates="habitation",
                                    cascade="all, delete-orphan")

    # Spatial index (GiST) — created explicitly for PostGIS query performance
    __table_args__ = (
        Index("ix_habitations_geom", "geom", postgresql_using="gist"),
    )

    def __repr__(self):
        return f"<Habitation id={self.id} name={self.name!r} pop={self.population}>"


# ============================================================================
# Table 2 — hazard_zones
# Spatial polygons classifying known hazard extents.
# ============================================================================

class HazardZone(Base):
    """
    A polygon defining a classified hazard area.
    intensity_class 1–5 per §4 (5 = most severe).
    source: e.g. 'Brahmaputra Board / ISRO Bhuvan', 'AUTO — sustained rainfall threshold'.
    """
    __tablename__ = "hazard_zones"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    hazard_type     = Column(SAEnum(HazardType, name="hazardtype"), nullable=False)
    geom            = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    intensity_class = Column(Integer, nullable=False)   # 1–5
    source          = Column(Text, nullable=False)       # cite or 'SYNTH — <reason>'
    last_updated    = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("intensity_class BETWEEN 1 AND 5",
                        name="chk_hazard_intensity_class"),
        Index("ix_hazard_zones_geom", "geom", postgresql_using="gist"),
    )

    def __repr__(self):
        return (f"<HazardZone id={self.id} type={self.hazard_type} "
                f"intensity={self.intensity_class}>")


# ============================================================================
# Table 3 — disaster_history
# Historical events associated with a habitation.
# Used in frequency_history_norm component of the hazard score.
# ============================================================================

class DisasterHistory(Base):
    """
    One record per historical disaster event for a habitation.
    severity: 1–5 (SYNTH scale derived from casualties / infrastructure loss).
    """
    __tablename__ = "disaster_history"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    habitation_id   = Column(Integer, ForeignKey("habitations.id",
                                                  ondelete="CASCADE"),
                              nullable=False, index=True)
    event_type      = Column(String(100), nullable=False)  # e.g. 'flood', 'landslide'
    event_date      = Column(Date, nullable=False)
    severity        = Column(Integer, nullable=False)       # 1–5
    casualties      = Column(Integer, nullable=True)        # NULL if unknown
    description     = Column(Text, nullable=True)
    source          = Column(Text, nullable=True)           # citation or 'SYNTH'

    habitation = relationship("Habitation", back_populates="disaster_events")

    __table_args__ = (
        CheckConstraint("severity BETWEEN 1 AND 5",
                        name="chk_disaster_severity"),
    )

    def __repr__(self):
        return (f"<DisasterHistory id={self.id} hab={self.habitation_id} "
                f"type={self.event_type} date={self.event_date}>")


# ============================================================================
# Table 4 — candidate_sites
# Potential relocation destinations for displaced habitations.
# ============================================================================

class CandidateSite(Base):
    """
    A candidate site for relocation.

    §0: district and state are free-text descriptive fields; region_id is the
    operational FK. No default values — must be explicitly supplied per record.

    max_capacity_estimate: available_land_sqm ÷ 9.5 (NBC 2016 minimum) × usability_factor.

    committed_population (§2.9): persons already committed to this site across
    prior or ongoing relocation waves. Available capacity =
    max_capacity_estimate − existing_occupancy − committed_population.

    hazard_free (§2.3): set by the spatial site-verification job. True if the
    site's geom does not fall inside or within 500m of any hazard_zones polygon.
    """
    __tablename__ = "candidate_sites"

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    name                  = Column(String(200), nullable=False)
    geom                  = Column(Geometry(geometry_type="POINT", srid=4326),
                                   nullable=False)
    available_land_sqm    = Column(Float, nullable=False)
    slope_degrees         = Column(Float, nullable=False)
    distance_to_road_km   = Column(Float, nullable=False)
    distance_to_water_km  = Column(Float, nullable=False)
    existing_occupancy    = Column(Integer, nullable=False, default=0)
    max_capacity_estimate = Column(Integer, nullable=False)
    committed_population  = Column(Integer, nullable=False, default=0)

    # §0: no default — must be explicitly supplied by the seed script
    district              = Column(String(100), nullable=False)
    state                 = Column(String(100), nullable=False)

    # §0: region FK
    region_id             = Column(Integer, ForeignKey("regions.id", ondelete="RESTRICT"),
                                   nullable=False, index=True)

    # Provenance flag per data_sources.md
    data_source           = Column(String(20), nullable=False, default="SYNTH")

    # §2.3 hazard-free verification result (set by scheduled spatial check)
    hazard_free                = Column(Boolean, nullable=True)   # None = not yet checked
    overlapping_hazard_zone_id = Column(Integer, ForeignKey("hazard_zones.id",
                                                             ondelete="SET NULL"),
                                        nullable=True)

    # Relationships
    region      = relationship("Region",      back_populates="candidate_sites")
    zone_scores = relationship("ZoneScore",   back_populates="matched_site")

    __table_args__ = (
        CheckConstraint("slope_degrees >= 0 AND slope_degrees <= 90",
                        name="chk_site_slope"),
        CheckConstraint("available_land_sqm > 0",
                        name="chk_site_land_positive"),
        Index("ix_candidate_sites_geom", "geom", postgresql_using="gist"),
    )

    def __repr__(self):
        return (f"<CandidateSite id={self.id} name={self.name!r} "
                f"capacity={self.max_capacity_estimate}>")


# ============================================================================
# Table 5 — zone_scores
# The single shared computed object (§2 architecture).
# Every read path — map, priority queue, audit trail — reads from this table.
# One row per habitation (updated atomically on each scoring run).
# ============================================================================

class ZoneScore(Base):
    """
    Computed scores for a habitation.

    This is the Risk & Capacity Graph row for one habitation.
    map, priority table, and Decision Panel all read from here —
    they can never disagree because there is one row (§2, §11).

    explanation_json: full audit trail per §6 specification.

    §2.2 relocation_horizon: the primary user-facing field.
    relocation_horizon_rationale: human-readable explanation of which
        condition(s) triggered the assigned horizon bucket.
    """
    __tablename__ = "zone_scores"

    # One-to-one with habitation
    habitation_id   = Column(Integer, ForeignKey("habitations.id",
                                                   ondelete="CASCADE"),
                              primary_key=True)
    hazard_score    = Column(Float, nullable=False)
    urgency_score   = Column(Float, nullable=False)
    capacity_score  = Column(Float, nullable=True)   # of matched site
    classification  = Column(SAEnum(RiskClassification, name="riskclassification"),
                              nullable=False)

    # §2.2 Primary user-facing relocation horizon
    relocation_horizon           = Column(SAEnum(RelocationHorizon, name="relocationhorizon"),
                                          nullable=True)
    relocation_horizon_rationale = Column(Text, nullable=True)

    matched_site_id = Column(Integer, ForeignKey("candidate_sites.id",
                                                   ondelete="SET NULL"),
                              nullable=True)
    computed_at     = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Full audit trail per §6
    explanation_json = Column(JSONB, nullable=False, default=dict)

    # Cached live-signal state at time of computation
    live_rainfall_mm  = Column(Float, nullable=True)
    live_seismic_mag  = Column(Float, nullable=True)
    live_trigger_mult = Column(Float, nullable=True, default=1.0)

    # Whether any input came from cache (not live)
    data_is_cached    = Column(Boolean, nullable=False, default=False)

    # §1.2 Independent current conditions and permanent habitation suitability
    current_conditions          = Column(String(20), nullable=True, default="LIVE")
    permanent_habitation_status = Column(String(20), nullable=True, default="CONDITIONAL")

    habitation   = relationship("Habitation",   back_populates="zone_score")
    matched_site = relationship("CandidateSite", back_populates="zone_scores")

    def __repr__(self):
        return (f"<ZoneScore hab={self.habitation_id} "
                f"hazard={self.hazard_score:.3f} urgency={self.urgency_score:.3f} "
                f"horizon={self.relocation_horizon}>")


# ============================================================================
# Table 6 — live_signals
# Rolling log of rainfall and seismic readings fetched by APScheduler.
# The latest record per (signal_type, region) drives live_trigger_multiplier.
# region must match Region.name for join-free filtering in _score_habitation().
# ============================================================================

class LiveSignal(Base):
    """
    One row per API fetch from OpenWeatherMap or USGS Earthquake API.
    The API fetches at a fixed interval (APScheduler); old rows are retained
    for trend analysis but scoring uses only the latest per (signal_type, region).

    fetched_at is the real timestamp from the API response — never hardcoded.
    region must match Region.name exactly for the per-region scoping in zones.py.
    """
    __tablename__ = "live_signals"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    signal_type = Column(SAEnum(SignalType, name="signaltype"), nullable=False)
    value       = Column(Float, nullable=False)   # mm/hr for rainfall, Mw for seismic
    region      = Column(String(100), nullable=False)
    fetched_at  = Column(DateTime, nullable=False)
    is_cached   = Column(Boolean, nullable=False, default=False)
    raw_response = Column(JSONB, nullable=True)    # full API response for audit

    __table_args__ = (
        Index("ix_live_signals_type_region_time", "signal_type", "region", "fetched_at"),
    )

    def __repr__(self):
        return (f"<LiveSignal type={self.signal_type} value={self.value} "
                f"region={self.region} at={self.fetched_at} cached={self.is_cached}>")


# ============================================================================
# Table 7 — satellite_passes
# Records of Sentinel-1 / Sentinel-2 passes over pilot habitations.
# signal_value: NDVI change (S2) or SAR amplitude change ratio (S1).
# ============================================================================

class SatellitePass(Base):
    """
    One row per Sentinel pass processed over a habitation.

    For S2: signal_type='ndvi_change', signal_value = NDVI_new − NDVI_old
    For S1: signal_type='sar_amplitude_change', signal_value = amplitude ratio

    pass_date is the real acquisition date from the Copernicus catalog —
    never hardcoded. The Data Health Badge shows this date.

    imagery_thumbnail_url: URL to a small PNG tile (RGB or false-color)
    stored in data/cache/sentinel/ for offline demo resilience.
    """
    __tablename__ = "satellite_passes"

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    habitation_id         = Column(Integer, ForeignKey("habitations.id",
                                                        ondelete="CASCADE"),
                                   nullable=False, index=True)
    source                = Column(SAEnum(SatelliteSource, name="satellitesource"),
                                   nullable=False)
    pass_date             = Column(Date, nullable=False)
    signal_type           = Column(String(50), nullable=False)  # 'ndvi_change' / 'sar_amplitude_change'
    signal_value          = Column(Float, nullable=False)
    cloud_cover_pct       = Column(Float, nullable=True)        # S2 only; None for S1
    imagery_thumbnail_url = Column(Text, nullable=True)
    is_cached             = Column(Boolean, nullable=False, default=True)  # pre-fetched = True
    notes                 = Column(Text, nullable=True)  # e.g. 'fallback pair — primary cloudy'

    habitation = relationship("Habitation", back_populates="satellite_passes")

    __table_args__ = (
        Index("ix_satellite_passes_hab_source_date",
              "habitation_id", "source", "pass_date"),
    )

    def __repr__(self):
        return (f"<SatellitePass id={self.id} hab={self.habitation_id} "
                f"source={self.source} date={self.pass_date} "
                f"signal={self.signal_type}={self.signal_value:.4f}>")


# ============================================================================
# Table 8 — transport_nodes (§4.2)
# Distinct model objects for multimodal evacuation (Road staging, Helipad, Jetty)
# ============================================================================

class TransportNode(Base):
    """
    A multimodal transport node / staging facility for disaster relocation.
    Tracks accessibility, capacity, operational status, and multimodal provenance.
    """
    __tablename__ = "transport_nodes"

    id                       = Column(Integer, primary_key=True, autoincrement=True)
    name                     = Column(String(200), nullable=False)
    node_type                = Column(SAEnum(TransportNodeType, name="transportnodetype"), nullable=False)
    geom                     = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    capacity_persons         = Column(Integer, nullable=False, default=50)
    status                   = Column(String(30), nullable=False, default="OPERATIONAL")  # OPERATIONAL | COMPROMISED | WEATHER_HOLD
    region_id                = Column(Integer, ForeignKey("regions.id", ondelete="CASCADE"), nullable=False, index=True)
    district                 = Column(String(100), nullable=False)
    operational_availability = Column(String(100), nullable=False, default="24/7 All-weather")
    data_provenance          = Column(String(30), nullable=False, default="OBSERVED")  # OBSERVED | DERIVED | MODELLED | UNAVAILABLE

    __table_args__ = (
        Index("ix_transport_nodes_geom", "geom", postgresql_using="gist"),
    )

    def __repr__(self):
        return f"<TransportNode id={self.id} name={self.name!r} type={self.node_type} status={self.status}>"


# ============================================================================
# Table 9 — decision_audits (§6.3)
# Human-in-the-loop decision capture (APPROVE / MODIFY / OVERRIDE)
# ============================================================================

class DecisionAudit(Base):
    """
    Audit log of human-in-the-loop operator decisions on RED ZONE relocation recommendations.
    """
    __tablename__ = "decision_audits"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    habitation_id  = Column(Integer, ForeignKey("habitations.id", ondelete="CASCADE"), nullable=False, index=True)
    decision_type  = Column(String(20), nullable=False)  # APPROVE | MODIFY | OVERRIDE
    recommendation = Column(Text, nullable=False)
    reason         = Column(Text, nullable=True)
    operator       = Column(String(100), nullable=False, default="SDMA Officer")
    timestamp      = Column(DateTime, nullable=False, default=datetime.utcnow)
    details        = Column(JSONB, nullable=False, default=dict)

    def __repr__(self):
        return f"<DecisionAudit id={self.id} hab={self.habitation_id} action={self.decision_type} by={self.operator}>"


# ============================================================================
# DDL helper
# ============================================================================

def create_all_tables():
    """
    Create all tables (and PostGIS extension) if they do not already exist.
    Called from main.py lifespan on startup.
    Safe to call on a database that already has the tables (no-op).
    """
    from sqlalchemy import text
    with engine.begin() as conn:
        # PostGIS extension must exist before GeoAlchemy2 geometry columns
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.create_all(bind=engine)


if __name__ == "__main__":
    # Quick sanity check: python models.py  (requires a running PostGIS)
    print("Creating tables...")
    create_all_tables()
    print("Done. Tables in database:")
    from sqlalchemy import inspect
    inspector = inspect(engine)
    for t in inspector.get_table_names():
        print(f"  {t}")
