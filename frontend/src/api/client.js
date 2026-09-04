// src/api/client.js
// Typed API client — all fetch calls centralized here.
// Vite proxies /api → localhost:8000 (vite.config.js).
// ============================================================

const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

export const api = {
  // Zones
  zones:         (params = {}) => request(`/zones?${new URLSearchParams(params)}`),
  zone:          (id) => request(`/zones/${id}`),
  zoneExplain:   (id) => request(`/zones/${id}/explain`),
  recalculate:   (id) => request(`/zones/${id}/recalculate`, { method: 'POST' }),

  // Priority queue
  priorityQueue: (params = {}) => request(`/priority-queue?${new URLSearchParams(params)}`),

  // Sites
  sites:         (params = {}) => request(`/sites?${new URLSearchParams(params)}`),
  site:          (id) => request(`/sites/${id}`),
  sitesNearby:   (lat, lon, radius = 100) =>
                   request(`/sites/nearby?lat=${lat}&lon=${lon}&radius_km=${radius}`),

  // Optimizer
  optimize:      (body = {}) => request('/optimize', { method: 'POST', body: JSON.stringify(body) }),

  // Recommendations
  recommendations: (params = {}) => request(`/recommendations?${new URLSearchParams(params)}`),

  // Scenario (what-if)
  whatIf: (body) => request('/scenario/what-if', { method: 'POST', body: JSON.stringify(body) }),

  // Report
  report: () => request('/report'),

  // Data health
  dataHealth: () => request('/data-health'),
}
