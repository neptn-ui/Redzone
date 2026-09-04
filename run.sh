#!/usr/bin/env bash
# run.sh — SIH26191 Risk-Aware Relocation Platform
# One-command start per §10 / §16
#
# Usage:
#   ./run.sh          — start all services + seed pilot data
#   ./run.sh --build  — force rebuild of images before starting
#   ./run.sh --clean  — wipe database volume and restart fresh
#
# Requirements: Docker + docker compose v2, bash
# =============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
BLU='\033[0;34m'
NC='\033[0m'   # no color

log()  { echo -e "${BLU}[run.sh]${NC} $*"; }
ok()   { echo -e "${GRN}[OK]${NC} $*"; }
warn() { echo -e "${YLW}[WARN]${NC} $*"; }
die()  { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ---- Check prerequisites ---------------------------------
command -v docker &>/dev/null || die "Docker not found. Install Docker Desktop."
docker compose version &>/dev/null || die "docker compose v2 not found."

# ---- Parse arguments -------------------------------------
BUILD_FLAG=""
CLEAN=false

for arg in "$@"; do
  case $arg in
    --build)  BUILD_FLAG="--build" ;;
    --clean)  CLEAN=true ;;
    *) warn "Unknown argument: $arg (ignored)" ;;
  esac
done

# ---- .env guard ------------------------------------------
if [[ ! -f ".env" ]]; then
  warn ".env not found — creating from .env.example with placeholder values."
  warn "Edit .env and add real API keys before using live data features."
  cp .env.example .env
fi

# ---- Clean slate -----------------------------------------
if [[ "$CLEAN" == "true" ]]; then
  warn "--clean: stopping and removing the database volume (all data will be lost)"
  docker compose down -v --remove-orphans
fi

# ---- Pull / build ----------------------------------------
log "Starting services..."
docker compose up -d $BUILD_FLAG --remove-orphans

# ---- Wait for db healthcheck -----------------------------
log "Waiting for PostGIS to be healthy..."
RETRIES=30
until docker compose exec db pg_isready -U "$(grep POSTGRES_USER .env | cut -d= -f2)" -q 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [[ $RETRIES -le 0 ]]; then
    die "PostGIS did not become healthy in time. Check: docker compose logs db"
  fi
  sleep 2
done
ok "PostGIS is healthy."

# ---- Wait for backend health endpoint --------------------
log "Waiting for backend API to be reachable..."
RETRIES=30
until curl -sf http://localhost:8000/healthz &>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [[ $RETRIES -le 0 ]]; then
    warn "Backend health endpoint not responding. It may still be loading. Check: docker compose logs backend"
    break
  fi
  sleep 2
done
ok "Backend API is up."

# ---- Seed pilot data -------------------------------------
log "Seeding Chamoli pilot dataset..."
docker compose exec backend python ingestion/load_pilot_data.py \
  && ok "Pilot data loaded." \
  || warn "Seed script not yet present — will load when backend/ingestion/load_pilot_data.py is created."

# ---- Done ------------------------------------------------
echo ""
echo -e "${GRN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GRN}║  SIH26191 · Risk-Aware Relocation Platform · RUNNING    ║${NC}"
echo -e "${GRN}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GRN}║  Frontend  →  http://localhost:5173                      ║${NC}"
echo -e "${GRN}║  Backend   →  http://localhost:8000                      ║${NC}"
echo -e "${GRN}║  API Docs  →  http://localhost:8000/docs                 ║${NC}"
echo -e "${GRN}║  Database  →  localhost:5432  (PostGIS 15-3.4)           ║${NC}"
echo -e "${GRN}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GRN}║  Logs:   docker compose logs -f [db|backend|frontend]    ║${NC}"
echo -e "${GRN}║  Stop:   docker compose down                             ║${NC}"
echo -e "${GRN}║  Reset:  ./run.sh --clean                                ║${NC}"
echo -e "${GRN}╚══════════════════════════════════════════════════════════╝${NC}"
