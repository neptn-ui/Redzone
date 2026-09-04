# backend/models.py
# SQLAlchemy 2.0 + GeoAlchemy2 — Section 4 schema (7 tables).
# This is the single shared source of truth for all table definitions.
# Scoring engines, API routers, and the ingestion layer all import from here.
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
    landslide      = "landslide"
    flood          = "flood"
    coastal_erosion = "coastal_erosion"
    cloudburst     = "cloudburst"
    subsidence     = "subsidence"       # added for Joshimath realism
    debris_flow    = "debris_flow"      # added for Chamoli classification


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


# ============================================================================
# Table 1 — habitations
# The atomic unit of analysis: a named settlement / ward cluster.
# ============================================================================

class Habitation(Base):
    """
    A settlement or ward cluster that may require relocation.
    geom     — centroid POINT  (EPSG:4326 / WGS84)
    boundary — approximate POLYGON outline of the habitation extent
    """
    __tablename__ = "habitations"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    name       = Column(String(200), nullable=False)
    geom       = Column(Geometry(geometry_type="POINT",    srid=4326), nullable=False)
    boundary   = Column(Geometry(geometry_type="POLYGON",  srid=4326), nullable=True)
    population = Column(Integer, nullable=False)
    district   = Column(String(100), nullable=False, default="Majuli")
    state      = Column(String(100), nullable=False, default="Assam")

    # Source-of-truth flag: REAL = from Census 2011; SYNTH = calibrated proxy
    population_source = Column(String(20), nullable=False, default="REAL")

    # Relationships
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
# Spatial polygons classifying known hazard extents in Chamoli.
# ============================================================================

class HazardZone(Base):
    """
    A polygon defining a classified hazard area.
    intensity_class 1–5 per §4 (5 = most severe).
    source: e.g. 'ISRO Cartosat-2S Jan 2023', 'SYNTH — NH-7 corridor'.
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

    Numeric attributes are SYNTH (calibrated) for the Chamoli pilot —
    documented in data_sources.md Part D.

    max_capacity_estimate: available_land_sqm ÷ 9.5 (NBC 2016 minimum) × usability_factor.
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
    district              = Column(String(100), nullable=False, default="Chamoli")
    state                 = Column(String(100), nullable=False, default="Uttarakhand")

    # Synthetic flag per data_sources.md
    data_source           = Column(String(20), nullable=False, default="SYNTH")
    # Government-reported distance from Joshimath (REAL where available)
    distance_from_joshimath_km = Column(Float, nullable=True)

    # Relationships
    zone_scores = relationship("ZoneScore", back_populates="matched_site")

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
    matched_site_id = Column(Integer, ForeignKey("candidate_sites.id",
                                                   ondelete="SET NULL"),
                              nullable=True)
    computed_at     = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Full audit trail per §6 (example structure in spec):
    # {
    #   "habitation": "...",
    #   "hazard_score": 0.86,
    #   "classification": "Red — Immediate",
    #   "breakdown": { <component>: {value, weight, contribution} },
    #   "evidence": ["..."],
    #   "matched_relocation_site": { name, distance_km, capacity_score }
    # }
    explanation_json = Column(JSONB, nullable=False, default=dict)

    # Cached live-signal state at time of computation
    live_rainfall_mm  = Column(Float, nullable=True)
    live_seismic_mag  = Column(Float, nullable=True)
    live_trigger_mult = Column(Float, nullable=True, default=1.0)

    # Whether any input came from cache (not live)
    data_is_cached    = Column(Boolean, nullable=False, default=False)

    habitation   = relationship("Habitation",   back_populates="zone_score")
    matched_site = relationship("CandidateSite", back_populates="zone_scores")

    def __repr__(self):
        return (f"<ZoneScore hab={self.habitation_id} "
                f"hazard={self.hazard_score:.3f} urgency={self.urgency_score:.3f} "
                f"class={self.classification}>")


# ============================================================================
# Table 6 — live_signals
# Rolling log of rainfall and seismic readings fetched by APScheduler.
# The latest record per (signal_type, region) drives live_trigger_multiplier.
# ============================================================================

class LiveSignal(Base):
    """
    One row per API fetch from OpenWeatherMap or USGS Earthquake API.
    The API fetches at a fixed interval (APScheduler); old rows are retained
    for trend analysis but scoring uses only the latest per region.

    fetched_at is the real timestamp from the API response — never hardcoded.
    """
    __tablename__ = "live_signals"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    signal_type = Column(SAEnum(SignalType, name="signaltype"), nullable=False)
    value       = Column(Float, nullable=False)   # mm/hr for rainfall, Mw for seismic
    region      = Column(String(100), nullable=False, default="Chamoli")
    fetched_at  = Column(DateTime, nullable=False)
    is_cached   = Column(Boolean, nullable=False, default=False)
    raw_response = Column(JSONB, nullable=True)    # full API response for audit

    __table_args__ = (
        Index("ix_live_signals_type_region_time", "signal_type", "region", "fetched_at"),
    )

    def __repr__(self):
        return (f"<LiveSignal type={self.signal_type} value={self.value} "
                f"at={self.fetched_at} cached={self.is_cached}>")


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
