-- Full migration script including regions table creation
-- Safe to run multiple times (idempotent)

CREATE TABLE IF NOT EXISTS regions (
    id                 SERIAL PRIMARY KEY,
    name               VARCHAR(120) NOT NULL UNIQUE,
    state              VARCHAR(120),
    country            VARCHAR(80)  DEFAULT 'India',
    center_lat         FLOAT        NOT NULL DEFAULT 0,
    center_lon         FLOAT        NOT NULL DEFAULT 0,
    bounding_radius_km FLOAT        NOT NULL DEFAULT 100,
    primary_hazard     VARCHAR(40),
    data_status        VARCHAR(20)  DEFAULT 'ACTIVE',
    census_year        INTEGER      DEFAULT 2011,
    notes              TEXT
);

ALTER TABLE habitations
    ADD COLUMN IF NOT EXISTS region_id              INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS slope_degrees          FLOAT,
    ADD COLUMN IF NOT EXISTS distance_to_hazard_km  FLOAT,
    ADD COLUMN IF NOT EXISTS terrain_data_source    VARCHAR(16) DEFAULT 'MISSING';

ALTER TABLE candidate_sites
    ADD COLUMN IF NOT EXISTS region_id                    INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS hazard_free                  BOOLEAN,
    ADD COLUMN IF NOT EXISTS overlapping_hazard_zone_id   INTEGER,
    ADD COLUMN IF NOT EXISTS committed_population         INTEGER DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'relocationhorizon') THEN
        CREATE TYPE relocationhorizon AS ENUM ('IMMEDIATE','SHORT_TERM','MEDIUM_TERM','MONITOR');
    END IF;
END
$$;

ALTER TABLE zone_scores
    ADD COLUMN IF NOT EXISTS relocation_horizon            relocationhorizon,
    ADD COLUMN IF NOT EXISTS relocation_horizon_rationale  TEXT,
    ADD COLUMN IF NOT EXISTS terrain_data_status           VARCHAR(16) DEFAULT 'MISSING',
    ADD COLUMN IF NOT EXISTS live_rainfall_mm              FLOAT,
    ADD COLUMN IF NOT EXISTS live_seismic_mag              FLOAT,
    ADD COLUMN IF NOT EXISTS live_trigger_mult             FLOAT;

ALTER TABLE live_signals
    ADD COLUMN IF NOT EXISTS region VARCHAR(120);

SELECT 'Migration complete' AS status;
