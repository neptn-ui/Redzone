# frontend/Dockerfile
# Node 20 (LTS) — React + Vite dev server
# =============================================================
FROM node:20-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline

# Copy source (dev: volume-mounted anyway)
COPY . .

EXPOSE 5173

# CMD is overridden in docker-compose.yml with --host 0.0.0.0
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
