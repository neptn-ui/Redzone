# backend/Dockerfile
# Python 3.11 slim — FastAPI + all ML/GIS dependencies
# =============================================================
FROM python:3.11-slim

# System deps needed by:
#   psycopg2      → libpq-dev
#   GeoPandas     → libgdal-dev, libgeos-dev
#   Shapely       → libgeos-dev
#   OpenCV        → libGL (headless)
#   scipy/numpy   → gfortran, libopenblas-dev
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq-dev \
        gdal-bin \
        libgdal-dev \
        libgeos-dev \
        libgeos++-dev \
        libgl1 \
        libglib2.0-0 \
        libopenblas-dev \
        gfortran \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer cached until requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# Copy source (development: volume-mounted anyway, but needed for production)
COPY . .

# Ensure data/cache directory exists at runtime
RUN mkdir -p /app/data/cache /app/data/pilot_district

EXPOSE 8000

# CMD is overridden in docker-compose.yml (--reload in dev, no --reload in prod)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
