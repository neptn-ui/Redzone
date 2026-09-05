// src/api/geo.js
// ============================================================================
// REDZONE — External GIS API Integration
//
// Nominatim: place geocoding and boundary lookup
// OSRM:      real road-network routing
//
// HONESTY RULES:
//   - If OSRM returns no route: resolve { routes: [], reason: 'ROUTING_UNAVAILABLE' }
//   - Never draw straight-line fallback routes — that is fabricated intelligence
//   - If Nominatim returns no boundary: resolve null — callers must handle
// ============================================================================

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const OSRM      = 'https://router.project-osrm.org/route/v1/driving'

const GEO_HEADERS = {
  'Accept-Language': 'en',
  'User-Agent': 'REDZONE-Emergency-Platform/2.0 (contact@redzone.example)',
}

// ── Geocoding ─────────────────────────────────────────────────────────────────

/**
 * Search for a place by name.
 * Returns an array of result objects normalized for AppStore.setArea().
 */
export async function geocode(query, { limit = 8, countrycodes = null } = {}) {
  const params = new URLSearchParams({
    q:              query,
    format:         'json',
    addressdetails: '1',
    limit:          String(limit),
    polygon_geojson: '0',  // don't fetch polygon here — use getBoundary() separately
  })
  if (countrycodes) params.set('countrycodes', countrycodes)

  const res = await fetch(`${NOMINATIM}/search?${params}`, { headers: GEO_HEADERS })
  if (!res.ok) throw new Error(`Nominatim error ${res.status}`)

  const raw = await res.json()
  return raw.map(r => ({
    osmId:      r.osm_id,
    osmType:    r.osm_type,
    name:       r.display_name.split(',')[0].trim(),
    displayName: r.display_name,
    lat:        parseFloat(r.lat),
    lon:        parseFloat(r.lon),
    zoom:       zoomFromType(r.type, r.class, parseFloat(r.importance)),
    state:      r.address?.state ?? null,
    country:    r.address?.country ?? null,
    district:   r.address?.county ?? r.address?.district ?? null,
    bbox:       r.boundingbox
      ? {
          south: parseFloat(r.boundingbox[0]),
          north: parseFloat(r.boundingbox[1]),
          west:  parseFloat(r.boundingbox[2]),
          east:  parseFloat(r.boundingbox[3]),
        }
      : null,
    placeType:  r.type,
    placeClass: r.class,
    importance: r.importance,
  }))
}

/**
 * Reverse geocode a lat/lon pair.
 */
export async function reverseGeocode(lat, lon) {
  const params = new URLSearchParams({
    lat, lon, format: 'json', addressdetails: '1',
  })
  const res = await fetch(`${NOMINATIM}/reverse?${params}`, { headers: GEO_HEADERS })
  if (!res.ok) throw new Error(`Nominatim reverse error ${res.status}`)
  const r = await res.json()
  return {
    name:     r.display_name.split(',')[0].trim(),
    state:    r.address?.state ?? null,
    country:  r.address?.country ?? null,
    district: r.address?.county ?? r.address?.district ?? null,
  }
}

/**
 * Fetch the polygon boundary for an OSM object.
 * Returns GeoJSON Feature or null if unavailable.
 */
export async function getBoundary(osmType, osmId) {
  try {
    const t = osmType === 'relation' ? 'R' : osmType === 'way' ? 'W' : 'N'
    const params = new URLSearchParams({
      osm_ids:        `${t}${osmId}`,
      polygon_geojson: '1',
      format:          'json',
    })
    const res = await fetch(`${NOMINATIM}/lookup?${params}`, { headers: GEO_HEADERS })
    if (!res.ok) return null
    const data = await res.json()
    const item = data?.[0]
    if (!item?.geojson) return null
    return {
      type: 'Feature',
      geometry: item.geojson,
      properties: { name: item.display_name },
    }
  } catch {
    return null
  }
}

// ── Routing ───────────────────────────────────────────────────────────────────

/**
 * Request a real road route from OSRM.
 *
 * Returns:
 *   { routes: [{ coordinates, distanceKm, durationMin, durationFormatted, steps }], status: 'ok' }
 *   { routes: [], status: 'unavailable', reason: 'ROUTING_UNAVAILABLE' }
 *
 * NEVER returns a straight-line fallback.
 */
export async function getRoute(origin, destination, { alternatives = true } = {}) {
  if (!origin?.lat || !origin?.lon || !destination?.lat || !destination?.lon) {
    return { routes: [], status: 'unavailable', reason: 'MISSING_COORDINATES' }
  }

  try {
    const coords = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`
    const params = new URLSearchParams({
      alternatives: alternatives ? 'true' : 'false',
      geometries:   'geojson',
      overview:     'full',
      steps:        'true',
      annotations:  'false',
    })

    const res = await fetch(`${OSRM}/${coords}?${params}`, {
      headers: { 'User-Agent': 'REDZONE-Emergency-Platform/2.0' },
    })

    if (!res.ok) {
      return { routes: [], status: 'unavailable', reason: 'OSRM_HTTP_ERROR' }
    }

    const data = await res.json()

    if (data.code !== 'Ok' || !data.routes?.length) {
      return { routes: [], status: 'unavailable', reason: 'NO_ROUTE_FOUND' }
    }

    const routes = data.routes.map((r, i) => ({
      index:             i,
      isPrimary:         i === 0,
      coordinates:       r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      distanceKm:        (r.distance / 1000).toFixed(1),
      durationMin:       Math.round(r.duration / 60),
      durationFormatted: formatDuration(r.duration),
      steps:             r.legs?.[0]?.steps?.map(s => ({
        instruction: s.maneuver?.instruction ?? s.name,
        distanceM:   Math.round(s.distance),
        durationSec: Math.round(s.duration),
      })) ?? [],
    }))

    return { routes, status: 'ok' }

  } catch (err) {
    if (err.name === 'AbortError') {
      return { routes: [], status: 'unavailable', reason: 'TIMEOUT' }
    }
    return { routes: [], status: 'unavailable', reason: 'NETWORK_ERROR' }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function zoomFromType(type, cls, importance) {
  // Estimate appropriate zoom based on place type
  if (cls === 'boundary' || type === 'administrative') {
    if (importance > 0.7) return 8   // large admin (state)
    if (importance > 0.5) return 10  // district
    return 12                         // sub-district
  }
  if (cls === 'place') {
    if (type === 'city')    return 11
    if (type === 'town')    return 12
    if (type === 'village') return 13
    if (type === 'hamlet')  return 14
  }
  return 12 // default
}
