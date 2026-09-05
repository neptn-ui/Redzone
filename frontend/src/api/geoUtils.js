// src/api/geoUtils.js
// ============================================================================
// Pure-math geographic geometry utilities.
// No external dependencies (no turf.js).
//
// Used by hazard layer renderers to compute:
//   - River corridor buffers (for flood inundation, erosion corridor)
//   - Intensity ring polygons (for earthquake)
//   - Bearing / offset calculations
// ============================================================================

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

// Earth radius in meters
const R_EARTH = 6371000

// ── Core math ────────────────────────────────────────────────────────────────

export function metersToLat(meters) {
  return meters / 111320
}

export function metersToLon(meters, lat) {
  return meters / (111320 * Math.cos(lat * DEG2RAD))
}

// Haversine distance in meters
export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG2RAD
  const dLon = (lon2 - lon1) * DEG2RAD
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*DEG2RAD) * Math.cos(lat2*DEG2RAD) * Math.sin(dLon/2)**2
  return 2 * R_EARTH * Math.asin(Math.sqrt(a))
}

// ── Perpendicular buffer along a polyline ─────────────────────────────────────
//
// Given a polyline [[lat,lon]...] and a half-width in meters,
// returns a closed polygon that forms a corridor around the line.

export function polylineBuffer(coords, halfWidthMeters) {
  if (!coords || coords.length < 2) return null

  const left  = []
  const right = []

  for (let i = 0; i < coords.length; i++) {
    const [lat, lon] = coords[i]

    // Direction vector: use segment or average of adjacent segments
    let dLat, dLon
    if (i === 0) {
      dLat = coords[1][0] - coords[0][0]
      dLon = coords[1][1] - coords[0][1]
    } else if (i === coords.length - 1) {
      dLat = coords[i][0] - coords[i-1][0]
      dLon = coords[i][1] - coords[i-1][1]
    } else {
      dLat = coords[i+1][0] - coords[i-1][0]
      dLon = coords[i+1][1] - coords[i-1][1]
    }

    // Normalize
    const len = Math.sqrt(dLat*dLat + dLon*dLon)
    if (len < 1e-10) {
      left.push([lat, lon])
      right.push([lat, lon])
      continue
    }

    // Perpendicular (rotate 90°)
    const nx = -dLon / len
    const ny =  dLat / len

    // Scale to meters → degrees
    const dLatOff = nx * metersToLat(halfWidthMeters)
    const dLonOff = ny * metersToLon(halfWidthMeters, lat)

    left.push( [lat + dLatOff, lon + dLonOff])
    right.push([lat - dLatOff, lon - dLonOff])
  }

  // Polygon: left forward + right reversed
  const ring = [
    ...left,
    ...[...right].reverse(),
    left[0],  // close
  ]

  return ring  // [[lat,lon], ...]
}

// ── Circular ring polygon ────────────────────────────────────────────────────
// Creates a GeoJSON-compatible ring polygon (for earthquake intensity contours)

export function circleRing(lat, lon, radiusMeters, numPoints = 32) {
  const points = []
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI
    const dLat = metersToLat(radiusMeters) * Math.sin(angle)
    const dLon = metersToLon(radiusMeters, lat) * Math.cos(angle)
    points.push([lat + dLat, lon + dLon])
  }
  points.push(points[0])  // close
  return points  // [[lat,lon], ...]
}

// ── Simplify polyline ─────────────────────────────────────────────────────────
// Ramer-Douglas-Peucker — keeps rendering fast for dense OSM geometry

export function simplify(coords, epsilonDeg = 0.0001) {
  if (coords.length <= 2) return coords

  function perpendicularDist(p, start, end) {
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    if (dx === 0 && dy === 0) {
      return Math.sqrt((p[0]-start[0])**2 + (p[1]-start[1])**2)
    }
    const t = ((p[0]-start[0])*dx + (p[1]-start[1])*dy) / (dx*dx + dy*dy)
    const cx = start[0] + t*dx
    const cy = start[1] + t*dy
    return Math.sqrt((p[0]-cx)**2 + (p[1]-cy)**2)
  }

  function rdp(pts) {
    if (pts.length <= 2) return pts
    let maxDist = 0, idx = 0
    for (let i = 1; i < pts.length-1; i++) {
      const d = perpendicularDist(pts[i], pts[0], pts[pts.length-1])
      if (d > maxDist) { maxDist = d; idx = i }
    }
    if (maxDist > epsilonDeg) {
      const l = rdp(pts.slice(0, idx+1))
      const r = rdp(pts.slice(idx))
      return [...l.slice(0,-1), ...r]
    }
    return [pts[0], pts[pts.length-1]]
  }

  return rdp(coords)
}

// ── River segment lengths ─────────────────────────────────────────────────────

export function polylineLength(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += haversineM(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1])
  }
  return total
}
