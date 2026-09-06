# backend/migrations_tier1.py
from models import engine, Base
from sqlalchemy import text

def run_migrations():
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE zone_scores ADD COLUMN IF NOT EXISTS current_conditions VARCHAR(20) DEFAULT 'LIVE';"))
        conn.execute(text("ALTER TABLE zone_scores ADD COLUMN IF NOT EXISTS permanent_habitation_status VARCHAR(20) DEFAULT 'UNKNOWN';"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    print("Database schema migration completed successfully.")

if __name__ == "__main__":
    run_migrations()
