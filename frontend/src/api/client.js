// src/api/client.js
// ============================================================================
// REDZONE — Centralized API Client
//
// All fetch calls centralized here. No fetch() calls in components.
// Vite proxies /api → localhost:8000 (vite.config.js).
//
// DESIGN CONTRACT:
//   - Every call may throw — callers must handle errors.
//   - No default/fallback values here. Unknown = throw or return null.
//   - Area filtering: pass { lat, lon, radius_km } to scope queries geographically.
// ============================================================================

const API_ORIGIN = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? import.meta.env.VITE_API_URL.replace(/\/+$/, '')
  : ''
const BASE = `${API_ORIGIN}/api`

async function request(path, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45000) // 45s timeout

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controller.signal,
      ...options,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`API ${res.status}: ${text}`)
    }
    return res.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildQuery(params) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')
  )
  return Object.keys(clean).length ? `?${new URLSearchParams(clean)}` : ''
}

export const api = {
  // ── Zones (all area-filtered) ────────────────────────────────────────────
  zones: (params = {}) =>
    request(`/zones${buildQuery(params)}`),

  zone: (id) =>
    request(`/zones/${id}`),

  zoneExplain: (id) =>
    request(`/zones/${id}/explain`),

  recalculate: (id) =>
    request(`/zones/${id}/recalculate`, { method: 'POST' }),

  // ── Priority queue (area-filtered) ───────────────────────────────────────
  priorityQueue: (params = {}) =>
    request(`/priority-queue${buildQuery(params)}`),

  // ── Sites (area-filtered) ─────────────────────────────────────────────────
  sites: (params = {}) =>
    request(`/sites${buildQuery(params)}`),

  site: (id) =>
    request(`/sites/${id}`),

  sitesNearby: (lat, lon, radiusKm = 50) =>
    request(`/sites/nearby${buildQuery({ lat, lon, radius_km: radiusKm })}`),

  // ── Optimizer ─────────────────────────────────────────────────────────────
  optimize: (body = {}) =>
    request('/optimize', { method: 'POST', body: JSON.stringify(body) }),

  // ── Recommendations (area-filtered) ──────────────────────────────────────
  recommendations: (params = {}) =>
    request(`/recommendations${buildQuery(params)}`),

  recommendationSynthesis: (params = {}) =>
    request(`/recommendations/synthesis${buildQuery(params)}`),

  // ── Scenario ─────────────────────────────────────────────────────────────
  whatIf: (body) =>
    request('/scenario/what-if', { method: 'POST', body: JSON.stringify(body) }),

  // ── Report ────────────────────────────────────────────────────────────────
  report: (params = {}) =>
    request(`/report${buildQuery(params)}`),

  // ── Data health ───────────────────────────────────────────────────────────
  dataHealth: () =>
    request('/data-health'),

  // ── Area context (Canonical AreaContext resolution) ────────
  areaContext: (lat, lon, radiusKm = 100, extra = {}) =>
    request(`/areas/context${buildQuery({ lat, lon, radius_km: radiusKm, ...extra })}`),

  // ── Events catalog (NEW) ──────────────────────────────────────────────────
  events: (params = {}) =>
    request(`/events${buildQuery(params)}`),

  event: (id) =>
    request(`/events/${id}`),

  replayEvent: (id, params = {}) =>
    request(`/events/${id}/replay${buildQuery(params)}`),

  eventsCoverage: (params = {}) =>
    request(`/events/coverage${buildQuery(params)}`),

  eventsCurrency: () =>
    request('/events/currency'),

  createEvent: (body) =>
    request('/events', { method: 'POST', body: JSON.stringify(body) }),

  // ── Human Decisions (§6.3) ────────────────────────────────────────────────
  recordDecision: (body) =>
    request('/recommendations/decision', { method: 'POST', body: JSON.stringify(body) }),

  decisions: (params = {}) =>
    request(`/recommendations/decisions${buildQuery(params)}`),
}

