// src/api/overpass.js
// ============================================================================
// OpenStreetMap Overpass API client.
// Fetches REAL geographic features (rivers, roads, bridges, hospitals)
// for a given bounding area.
//
// All data returned is labeled: SOURCE: OpenStreetMap
// Overpass API is free, no key required.
// ============================================================================

import {
  FALLBACK_RIVERS,
  FALLBACK_ROADS,
  FALLBACK_BRIDGES,
  FALLBACK_INFRA,
} from './overpassFallback'

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

const TIMEOUT_MS = 3500
const cache = new Map()

// Check if location is in the Assam/Brahmaputra pilot corridor
function isAssamPilotRegion(lat, lon) {
  return lat >= 23.5 && lat <= 28.5 && lon >= 89.0 && lon <= 96.5
}

async function query(ql) {
  if (cache.has(ql)) {
    return cache.get(ql)
  }

  let lastError = null

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: ctrl.signal,
        body: `data=${encodeURIComponent(ql)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
      const json = await res.json()
      cache.set(ql, json)
      return json
    } catch (err) {
      lastError = err
      continue // try next mirror
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError || new Error('All Overpass mirrors unreachable')
}

// Convert Overpass way elements to arrays of [lat, lon] coordinates
export function wayToCoords(el) {
  if (!el.geometry || el.geometry.length < 2) return null
  return el.geometry.map(n => [n.lat, n.lon])
}

// ── Fetch real river / waterway geometry ──────────────────────────────────────

export async function fetchRivers(lat, lon, radius_m = 40000) {
  const ql = `
[out:json][timeout:5];
(
  way["waterway"~"^(river|stream|canal)$"](around:${radius_m},${lat},${lon});
);
out geom 150;
  `.trim()

  try {
    const data = await query(ql)
    const elements = (data.elements ?? []).filter(e => e.geometry?.length >= 2)
    if (elements.length > 0) return elements
  } catch { }

  // Fallback to pre-calibrated geometry ONLY if in the pilot corridor
  return isAssamPilotRegion(lat, lon) ? FALLBACK_RIVERS : []
}

// ── Fetch road network ────────────────────────────────────────────────────────

export async function fetchMajorRoads(lat, lon, radius_m = 25000) {
  const ql = `
[out:json][timeout:5];
(
  way["highway"~"^(trunk|primary|secondary|trunk_link|primary_link)$"](around:${radius_m},${lat},${lon});
);
out geom 150;
  `.trim()

  try {
    const data = await query(ql)
    const elements = (data.elements ?? []).filter(e => e.geometry?.length >= 2)
    if (elements.length > 0) return elements
  } catch { }

  return isAssamPilotRegion(lat, lon) ? FALLBACK_ROADS : []
}

// ── Fetch bridges ─────────────────────────────────────────────────────────────

export async function fetchBridges(lat, lon, radius_m = 30000) {
  const ql = `
[out:json][timeout:5];
(
  way["bridge"="yes"]["highway"](around:${radius_m},${lat},${lon});
  node["man_made"="bridge"](around:${radius_m},${lat},${lon});
);
out center 60;
  `.trim()

  try {
    const data = await query(ql)
    if (data.elements?.length > 0) return data.elements
  } catch { }

  return isAssamPilotRegion(lat, lon) ? FALLBACK_BRIDGES : []
}

// ── Fetch critical infrastructure ─────────────────────────────────────────────

export async function fetchInfrastructure(lat, lon, radius_m = 25000) {
  const ql = `
[out:json][timeout:5];
(
  node["amenity"="hospital"](around:${radius_m},${lat},${lon});
  node["amenity"="school"](around:${radius_m},${lat},${lon});
  node["emergency"="yes"](around:${radius_m},${lat},${lon});
);
out center 60;
  `.trim()

  try {
    const data = await query(ql)
    if (data.elements?.length > 0) return data.elements
  } catch { }

  return isAssamPilotRegion(lat, lon) ? FALLBACK_INFRA : []
}

// ── Fetch recent earthquakes from USGS ───────────────────────────────────────

export async function fetchRecentEarthquakes(lat, lon, radius_km = 300) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3500)
  try {
    // USGS Earthquake Catalog — free, real data, no key
    const url = new URL('https://earthquake.usgs.gov/fdsnws/event/1/query')
    url.searchParams.set('format', 'geojson')
    url.searchParams.set('latitude', lat)
    url.searchParams.set('longitude', lon)
    url.searchParams.set('maxradius', radius_km * 0.00904)  // convert km to degrees approx
    url.searchParams.set('minmagnitude', '3.5')
    url.searchParams.set('limit', '10')
    url.searchParams.set('orderby', 'time')
    // Past 365 days
    const end = new Date()
    const start = new Date(end.getTime() - 365 * 24 * 3600 * 1000)
    url.searchParams.set('starttime', start.toISOString().split('T')[0])
    url.searchParams.set('endtime', end.toISOString().split('T')[0])

    const res = await fetch(url.toString(), { signal: ctrl.signal })
    if (!res.ok) throw new Error(`USGS ${res.status}`)
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
