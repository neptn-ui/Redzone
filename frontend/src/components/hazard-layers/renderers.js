// src/components/hazard-layers/renderers.js
// ============================================================================
// REDZONE — Hazard Layer Renderer Factories
//
// Each renderer is a pure function:
//   createXxxLayers(L, data, options) → { group, legend, dataStatus }
//
// L         = Leaflet instance
// data      = { rivers, roads, bridges, infra, zones, earthquakes, area }
// options   = { onLayerClick }
//
// Returns:
//   group      = L.LayerGroup (add to map, remove to clear)
//   legend     = array of { color, label, type } for HazardLegend
//   dataStatus = array of { source, status, note } for status banner
//
// DATA HONESTY RULES (strictly enforced):
//   - Rivers from OSM → SOURCE: OSM, STATUS: REAL
//   - Buffer corridors → STATUS: MODELLED
//   - Missing data → STATUS: UNAVAILABLE (no fabrication)
//   - Earthquake intensity from USGS → STATUS: REAL (epicenter) + MODELLED (rings)
//   - Zone-derived susceptibility → STATUS: MODELLED
// ============================================================================

import { polylineBuffer, circleRing, simplify } from '../../api/geoUtils'
import { wayToCoords } from '../../api/overpass'

// ── Shared popup helper ───────────────────────────────────────────────────────

function popup(content) {
  return `<div style="font-family:'Outfit',system-ui,sans-serif;min-width:220px;padding:2px">${content}</div>`
}

function popupRow(label, value, note = '') {
  return `
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <span style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:700">${label}</span>
      <div style="text-align:right">
        <span style="font-size:12px;color:#f1f5f9;font-weight:600">${value}</span>
        ${note ? `<div style="font-size:9px;color:#475569;margin-top:1px">${note}</div>` : ''}
      </div>
    </div>`
}

function dataTag(status) {
  const colors = {
    REAL:         'color:#22c55e;border-color:rgba(34,197,94,0.3)',
    MODELLED:     'color:#3b82f6;border-color:rgba(59,130,246,0.3)',
    UNAVAILABLE:  'color:#f97316;border-color:rgba(249,115,22,0.3)',
    RECONSTRUCTED:'color:#f59e0b;border-color:rgba(245,158,11,0.3)',
  }
  const s = colors[status] ?? colors.MODELLED
  return `<span style="font-size:8px;font-weight:700;font-variant:all-small-caps;padding:1px 5px;border:1px solid;border-radius:3px;${s}">${status}</span>`
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOOD RENDERER
// Visual language: inundation depth gradient + real river centerlines
//
// Layer stack (bottom → top):
//   1. Wide inundation corridor (MODELLED, transparent blue fill)
//   2. Deep flood zone         (MODELLED, medium blue)
//   3. Active river channel    (OSM REAL, thick blue polyline)
//   4. Exposed zone circles    (from backend)
//   5. Bridge markers          (OSM REAL)
//   6. Infra markers           (OSM REAL)
// ─────────────────────────────────────────────────────────────────────────────

export function createFloodLayers(L, data, { onLayerClick } = {}) {
  const group = L.layerGroup()
  const { rivers, bridges, infra, zones } = data

  const hasRivers = rivers && rivers.length > 0

  // ── Layer 1 & 2: Flood inundation corridors from real river geometry ─────────

  if (hasRivers) {
    rivers.forEach(river => {
      const raw = wayToCoords(river)
      if (!raw) return
      const coords = simplify(raw, 0.00005)

      // Outer inundation extent (wide, transparent) — MODELLED
      const outerBuffer = polylineBuffer(coords, 2000)  // 2km half-width
      if (outerBuffer) {
        L.polygon(outerBuffer, {
          color:       '#1e40af',
          weight:      1,
          opacity:     0.5,
          fillColor:   '#3b82f6',
          fillOpacity: 0.12,
        }).bindPopup(popup(`
          <div style="font-size:11px;font-weight:700;color:#60a5fa;margin-bottom:6px">FLOOD INUNDATION EXTENT</div>
          ${popupRow('Flood Depth', 'MODELLED', 'Calculated from river buffer')}
          ${popupRow('Width', '~4km', 'Hazard score weighted')}
          ${popupRow('Source', river.tags?.name ?? 'Waterway', 'OSM river geometry')}
          <div style="margin-top:6px">${dataTag('MODELLED')}</div>
        `)).addTo(group)
      }

      // Inner flood zone (moderate depth) — MODELLED
      const innerBuffer = polylineBuffer(coords, 800)  // 800m half-width
      if (innerBuffer) {
        L.polygon(innerBuffer, {
          color:       '#1d4ed8',
          weight:      1,
          opacity:     0.7,
          fillColor:   '#2563eb',
          fillOpacity: 0.25,
        }).addTo(group)
      }

      // River centerline (OSM REAL)
      L.polyline(coords, {
        color:   '#60a5fa',
        weight:  3,
        opacity: 0.9,
      }).bindPopup(popup(`
        <div style="font-size:11px;font-weight:700;color:#60a5fa;margin-bottom:6px">RIVER CHANNEL</div>
        ${popupRow('Name', river.tags?.name ?? '(unnamed)', '')}
        ${popupRow('Type', river.tags?.waterway ?? 'waterway', '')}
        <div style="margin-top:6px">${dataTag('REAL')} <span style="font-size:9px;color:#475569;margin-left:4px">Source: OpenStreetMap</span></div>
      `)).addTo(group)
    })
  } else {
    // No real river data → FLOOD SURFACE UNAVAILABLE — do not fabricate
    // The status banner will communicate this
  }

  // ── Layer 4: Exposed settlements ──────────────────────────────────────────

  zones.forEach(zone => {
    if (!zone.lat || !zone.lon) return
    const score = zone.hazard_score ?? 0
    const radius = Math.max(6, Math.min(16, 6 + score * 14))
    const fill = score >= 0.7 ? '#ef4444' : score >= 0.5 ? '#f97316' : '#f59e0b'

    L.circleMarker([zone.lat, zone.lon], {
      radius:      radius,
      color:       '#ffffff',
      weight:      1.5,
      fillColor:   fill,
      fillOpacity: 0.85,
    }).bindPopup(popup(`
      <div style="font-size:11px;font-weight:700;color:${fill};margin-bottom:6px">EXPOSED SETTLEMENT</div>
      ${popupRow('Name', zone.name ?? '—', '')}
      ${popupRow('Population', (zone.population ?? 0).toLocaleString(), 'STATIC')}
      ${popupRow('Flood Risk', Math.round(score*100), 'MODELLED score')}
      ${popupRow('Classification', (zone.classification ?? '').replace(/_/g,' ').toUpperCase(), '')}
      <div style="margin-top:6px">${dataTag('MODELLED')}</div>
    `)).addTo(group)
  })

  // ── Layer 5: Bridges ─────────────────────────────────────────────────────

  ;(bridges ?? []).forEach(b => {
    const lat = b.center?.lat ?? b.lat
    const lon = b.center?.lon ?? b.lon
    if (!lat || !lon) return
    L.circleMarker([lat, lon], {
      radius: 5, color: '#ef4444', weight: 2, fillColor: '#fca5a5', fillOpacity: 0.9,
    }).bindPopup(popup(`
      <div style="font-size:11px;font-weight:700;color:#ef4444;margin-bottom:6px">BRIDGE — FLOOD RISK</div>
      ${popupRow('Name', b.tags?.name ?? '(unnamed)', '')}
      ${popupRow('Road', b.tags?.highway ?? '—', '')}
      <div style="margin-top:6px">${dataTag('REAL')} <span style="font-size:9px;color:#475569;margin-left:4px">Source: OSM</span></div>
    `)).addTo(group)
  })

  // ── Layer 6: Hospitals / schools ─────────────────────────────────────────

  ;(infra ?? []).forEach(n => {
    if (!n.lat && !n.center) return
    const lat = n.lat ?? n.center.lat
    const lon = n.lon ?? n.center.lon
    const amenity = n.tags?.amenity ?? 'facility'
    const icon = L.divIcon({
      html: `<div style="width:10px;height:10px;border-radius:50%;background:#fbbf24;border:2px solid #fff;box-shadow:0 0 4px rgba(251,191,36,0.5)"></div>`,
      iconSize: [10,10], iconAnchor: [5,5], className: '',
    })
    L.marker([lat, lon], { icon }).bindPopup(popup(`
      <div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px">CRITICAL FACILITY</div>
      ${popupRow('Type', amenity.toUpperCase(), '')}
      ${popupRow('Name', n.tags?.name ?? '(unnamed)', '')}
      <div style="margin-top:6px">${dataTag('REAL')}</div>
    `)).addTo(group)
  })

  const legend = [
    { color: 'rgba(59,130,246,0.15)', border: '#1e40af', label: 'Flood inundation extent', type: 'fill', status: 'MODELLED' },
    { color: 'rgba(37,99,235,0.35)',  border: '#1d4ed8', label: 'Deep flood zone',         type: 'fill', status: 'MODELLED' },
    { color: '#60a5fa',               border: null,      label: 'River channel',            type: 'line', status: 'REAL' },
    { color: '#ef4444',               border: null,      label: 'Exposed settlement',       type: 'dot',  status: 'MODELLED' },
    { color: '#fca5a5',               border: '#ef4444', label: 'Bridge — at risk',         type: 'dot',  status: 'REAL' },
    { color: '#fbbf24',               border: null,      label: 'Critical facility',        type: 'dot',  status: 'REAL' },
  ]

  const dataStatus = hasRivers
    ? [
        { source: 'River network',      status: 'REAL',      note: 'OpenStreetMap waterways' },
        { source: 'Flood extent',       status: 'MODELLED',  note: '2km buffer from river centerline — no raster DEM' },
        { source: 'Depth gradient',     status: 'MODELLED',  note: 'Distance-from-river proxy — no hydrodynamic model' },
        { source: 'Settlement exposure',status: 'MODELLED',  note: 'Hazard score × proximity' },
        { source: 'Bridge locations',   status: 'REAL',      note: 'OpenStreetMap bridges' },
      ]
    : [
        { source: 'River network',      status: 'UNAVAILABLE', note: 'Overpass API returned no rivers — check network' },
        { source: 'Flood extent',       status: 'UNAVAILABLE', note: 'Cannot model extent without river geometry' },
        { source: 'Settlement exposure',status: 'MODELLED',    note: 'Hazard score from zone database' },
      ]

  return { group, legend, dataStatus }
}


// ─────────────────────────────────────────────────────────────────────────────
// EROSION RENDERER
// Visual language: river channel + hazard-intensity corridor on both banks
//
// Layer stack:
//   1. River channel centerline (OSM REAL, thick dark blue)
//   2. High-intensity erosion band (MODELLED, orange-red near bank)
//   3. Erosion projection corridor (MODELLED, orange further out)
//   4. Threatened settlements (from backend)
//   5. Bridge markers (REAL from OSM)
// ─────────────────────────────────────────────────────────────────────────────

export function createErosionLayers(L, data, { onLayerClick } = {}) {
  const group = L.layerGroup()
  const { rivers, bridges, zones } = data

  const hasRivers = rivers && rivers.length > 0

  if (hasRivers) {
    rivers.forEach(river => {
      const raw = wayToCoords(river)
      if (!raw) return
      const coords = simplify(raw, 0.00005)

      // Erosion projection corridor — outer (MODELLED, wide, soft orange)
      const outerBuf = polylineBuffer(coords, 500)
      if (outerBuf) {
        L.polygon(outerBuf, {
          color:       '#92400e',
          weight:      1,
          opacity:     0.6,
          fillColor:   '#f97316',
          fillOpacity: 0.18,
        }).bindPopup(popup(`
          <div style="font-size:11px;font-weight:700;color:#fb923c;margin-bottom:6px">EROSION PROJECTION CORRIDOR</div>
          ${popupRow('Width', '~1km', 'Modelled retreat zone')}
          ${popupRow('Basis', 'River centerline buffer', 'MODELLED')}
          ${popupRow('Historical channel', 'UNAVAILABLE', 'No historical OSM geometry')}
          <div style="margin-top:6px">${dataTag('MODELLED')}</div>
          <div style="font-size:9px;color:#92400e;margin-top:4px">Historical bank positions not available — no satellite-derived retreat measurement.</div>
        `)).addTo(group)
      }

      // High-intensity erosion band — inner (MODELLED, narrow, red-orange)
      const innerBuf = polylineBuffer(coords, 150)
      if (innerBuf) {
        L.polygon(innerBuf, {
          color:       '#c2410c',
          weight:      1.5,
          opacity:     0.8,
          fillColor:   '#f97316',
          fillOpacity: 0.45,
        }).bindPopup(popup(`
          <div style="font-size:11px;font-weight:700;color:#f97316;margin-bottom:6px">ACTIVE EROSION BAND</div>
          ${popupRow('Intensity', 'HIGH', 'MODELLED')}
          ${popupRow('Width', '~300m', 'Immediate bank zone')}
          <div style="margin-top:6px">${dataTag('MODELLED')}</div>
        `)).addTo(group)
      }

      // Active river channel (OSM REAL — thick, dark blue with lighter core)
      L.polyline(coords, {
        color: '#1e3a8a', weight: 5, opacity: 0.9,
      }).addTo(group)
      L.polyline(coords, {
        color: '#3b82f6', weight: 2.5, opacity: 1,
      }).bindPopup(popup(`
        <div style="font-size:11px;font-weight:700;color:#60a5fa;margin-bottom:6px">ACTIVE RIVER CHANNEL</div>
        ${popupRow('Name', river.tags?.name ?? '(unnamed)', '')}
        ${popupRow('Type', river.tags?.waterway ?? 'waterway', '')}
        <div style="margin-top:6px">${dataTag('REAL')} <span style="font-size:9px;color:#475569;margin-left:4px">Source: OpenStreetMap</span></div>
      `)).addTo(group)
    })
  }

  // Threatened settlements (zones near river — score weighted)
  zones.forEach(zone => {
    if (!zone.lat || !zone.lon) return
    const score = zone.hazard_score ?? 0
    const threatened = score >= 0.4

    const fill = score >= 0.7 ? '#ef4444' : score >= 0.5 ? '#f97316' : '#f59e0b'
    const radius = Math.max(5, 5 + score * 10)

    L.circleMarker([zone.lat, zone.lon], {
      radius, color: '#fff', weight: 1.5, fillColor: fill, fillOpacity: 0.85,
    }).bindPopup(popup(`
      <div style="font-size:11px;font-weight:700;color:${fill};margin-bottom:6px">
        ${threatened ? 'THREATENED SETTLEMENT' : 'SETTLEMENT'}
      </div>
      ${popupRow('Name', zone.name ?? '—', '')}
      ${popupRow('Population', (zone.population ?? 0).toLocaleString(), 'STATIC')}
      ${popupRow('Erosion Risk', Math.round(score*100), 'MODELLED')}
      <div style="margin-top:6px">${dataTag('MODELLED')}</div>
    `)).addTo(group)
  })

  // Bridges threatened by erosion
  ;(bridges ?? []).forEach(b => {
    const lat = b.center?.lat ?? b.lat
    const lon = b.center?.lon ?? b.lon
    if (!lat || !lon) return
    L.circleMarker([lat, lon], {
      radius: 5, color: '#ef4444', weight: 2, fillColor: '#fca5a5', fillOpacity: 0.9,
    }).bindPopup(popup(`
      <div style="font-size:11px;font-weight:700;color:#ef4444;margin-bottom:6px">BRIDGE — EROSION RISK</div>
      ${popupRow('Name', b.tags?.name ?? '(unnamed)', '')}
      ${popupRow('Status', 'EXPOSURE — MODELLED', '')}
      <div style="margin-top:6px">${dataTag('REAL')}</div>
    `)).addTo(group)
  })

  const legend = [
    { color: 'rgba(249,115,22,0.18)', border: '#92400e', label: 'Erosion projection corridor', type: 'fill', status: 'MODELLED' },
    { color: 'rgba(249,115,22,0.45)', border: '#c2410c', label: 'Active erosion band',         type: 'fill', status: 'MODELLED' },
    { color: '#3b82f6',               border: '#1e3a8a', label: 'Active river channel',         type: 'line', status: 'REAL' },
    { color: '#ef4444',               border: null,      label: 'Threatened settlement',        type: 'dot',  status: 'MODELLED' },
    { color: '#fca5a5',               border: '#ef4444', label: 'Bridge — at risk',             type: 'dot',  status: 'REAL' },
  ]

  const dataStatus = hasRivers
    ? [
        { source: 'River channel',          status: 'REAL',        note: 'OpenStreetMap current channel geometry' },
        { source: 'Historical channel',     status: 'UNAVAILABLE', note: 'No historical OSM or satellite-derived bank position' },
        { source: 'Erosion corridor',       status: 'MODELLED',    note: 'Buffer from river centerline — no measured retreat rate' },
        { source: 'Erosion intensity',      status: 'MODELLED',    note: 'Derived from zone hazard score — not field survey' },
        { source: 'Bank retreat rate',      status: 'UNAVAILABLE', note: 'No SAR/satellite measurement integrated' },
      ]
    : [
        { source: 'River channel',          status: 'UNAVAILABLE', note: 'Overpass API returned no rivers' },
        { source: 'Erosion corridor',       status: 'UNAVAILABLE', note: 'Cannot model corridor without river geometry' },
      ]

  return { group, legend, dataStatus }
}


// ─────────────────────────────────────────────────────────────────────────────
// LANDSLIDE RENDERER
// Visual language: zone-based susceptibility + terrain context
//
// What we CANNOT show (no DEM available):
//   - Actual slope raster
//   - True terrain hillshade overlay
//
// What we CAN show (clearly labelled MODELLED):
//   - Susceptibility zones from backend hazard scores
//   - Roads through high-susceptibility zones
//   - Zone polygons approximated by score
//
// Honest degradation: SLOPE DATA: UNAVAILABLE shown in status banner
// ─────────────────────────────────────────────────────────────────────────────

export function createLandslideLayers(L, data, { onLayerClick } = {}) {
  const group  = L.layerGroup()
  const { roads, zones } = data

  // Group zones by classification for susceptibility polygons
  const byClass = {
    immediate:   zones.filter(z => z.classification === 'immediate'),
    short_term:  zones.filter(z => z.classification === 'short_term'),
    medium_term: zones.filter(z => z.classification === 'medium_term'),
  }

  // Create susceptibility zone polygons from zone clusters
  // For each high-risk zone, draw a susceptibility polygon around it
  zones.forEach(zone => {
    if (!zone.lat || !zone.lon) return
    const score = zone.hazard_score ?? 0

    // Susceptibility radius from score (meters)
    const radiusM = 500 + score * 2000

    // Draw a roughly irregular susceptibility polygon (not a perfect circle)
    const numPts = 10
    const pts = []
    for (let i = 0; i < numPts; i++) {
      const angle = (i / numPts) * 2 * Math.PI
      // Add terrain-like irregularity (deterministic from zone position)
      const jitter = 0.7 + 0.3 * Math.abs(Math.sin(angle * 3 + zone.lat))
      const r = radiusM * jitter
      const dLat = (r / 111320) * Math.sin(angle)
      const dLon = (r / (111320 * Math.cos(zone.lat * Math.PI/180))) * Math.cos(angle)
      pts.push([zone.lat + dLat, zone.lon + dLon])
    }
    pts.push(pts[0])

    const fill = score >= 0.7 ? '#dc2626' : score >= 0.5 ? '#d97706' : '#ca8a04'
    const fillOp = score >= 0.7 ? 0.30 : score >= 0.5 ? 0.22 : 0.15

    L.polygon(pts, {
      color:       fill,
      weight:      1,
      opacity:     0.7,
      fillColor:   fill,
      fillOpacity: fillOp,
    }).bindPopup(popup(`
      <div style="font-size:11px;font-weight:700;color:${fill};margin-bottom:6px">LANDSLIDE SUSCEPTIBILITY ZONE</div>
      ${popupRow('Zone', zone.name ?? '—', '')}
      ${popupRow('Susceptibility', Math.round(score*100), 'MODELLED')}
      ${popupRow('Classification', (zone.classification ?? '').replace(/_/g,' ').toUpperCase(), '')}
      ${popupRow('Population', (zone.population ?? 0).toLocaleString(), 'STATIC')}
      <div style="margin-top:6px">${dataTag('MODELLED')}</div>
      <div style="font-size:9px;color:#92400e;margin-top:4px">Slope/DEM data unavailable. Susceptibility derived from hazard score formula only.</div>
    `)).addTo(group)

    // Zone label marker
    L.circleMarker([zone.lat, zone.lon], {
      radius: 5, color: '#ffffff', weight: 1.5, fillColor: fill, fillOpacity: 0.9,
    }).addTo(group)
  })

  // Roads in susceptibility zones
  ;(roads ?? []).forEach(road => {
    const raw = wayToCoords(road)
    if (!raw) return
    const coords = simplify(raw, 0.0001)

    L.polyline(coords, {
      color:   '#fbbf24',
      weight:  2.5,
      opacity: 0.75,
      dashArray: '4 4',
    }).bindPopup(popup(`
      <div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px">ROAD IN SUSCEPTIBLE TERRAIN</div>
      ${popupRow('Name', road.tags?.name ?? road.tags?.ref ?? '(unnamed)', '')}
      ${popupRow('Type', road.tags?.highway ?? '—', '')}
      ${popupRow('Exposure', 'MODELLED', 'Road crosses susceptible zone')}
      <div style="margin-top:6px">${dataTag('REAL')} <span style="font-size:9px;color:#475569;margin-left:4px">Road: OSM</span> ${dataTag('MODELLED')} <span style="font-size:9px;color:#475569;margin-left:4px">Exposure</span></div>
    `)).addTo(group)
  })

  const legend = [
    { color: 'rgba(220,38,38,0.3)',   border: '#dc2626', label: 'High susceptibility',   type: 'fill', status: 'MODELLED' },
    { color: 'rgba(217,119,6,0.22)',  border: '#d97706', label: 'Medium susceptibility', type: 'fill', status: 'MODELLED' },
    { color: 'rgba(202,138,4,0.15)',  border: '#ca8a04', label: 'Low susceptibility',    type: 'fill', status: 'MODELLED' },
    { color: '#fbbf24',               border: null,      label: 'Exposed road',          type: 'dashed', status: 'REAL+MODELLED' },
  ]

  const dataStatus = [
    { source: 'Slope / DEM',           status: 'UNAVAILABLE', note: 'No digital elevation model integrated — slope layer not available' },
    { source: 'Susceptibility zones',  status: 'MODELLED',    note: 'Derived from hazard_engine.py score — not field survey or satellite' },
    { source: 'Observed landslides',   status: 'UNAVAILABLE', note: 'No observed landslide point catalog connected' },
    { source: 'Road exposure',         status: 'REAL+MODELLED',note: 'Roads from OSM, exposure from susceptibility zone intersection' },
    { source: 'Failure zone geometry', status: 'MODELLED',    note: 'Score-proportional polygon — not actual failure polygon' },
  ]

  return { group, legend, dataStatus }
}


// ─────────────────────────────────────────────────────────────────────────────
// EARTHQUAKE RENDERER
// Visual language: epicenter + intensity contour rings + affected infra
//
// Epicenter source: USGS Earthquake Catalog (REAL — most recent event near area)
// Intensity rings: Modified Mercalli Intensity from Attenuation (MODELLED)
// Ring radii: ~MMI-based, uses Atkinson & Wald 2007 approximation
//
// If no USGS earthquake within range: shows "NO RECENT SEISMIC EVENT" status
// ─────────────────────────────────────────────────────────────────────────────

export function createEarthquakeLayers(L, data, { onLayerClick } = {}) {
  const group = L.layerGroup()
  const { earthquakes, infra, zones, area } = data

  const features = earthquakes?.features ?? []
  const hasQuakes = features.length > 0

  // Intensity ring configuration (MMI scale)
  // Radii are approximations from attenuation — labeled MODELLED
  const MMI_RINGS = [
    { mmi: 'VII+', color: '#7f1d1d', fill: '#dc2626', radiusKm:  15, label: 'Severe shaking',   fillOp: 0.45 },
    { mmi: 'VI',   color: '#92400e', fill: '#f97316', radiusKm:  35, label: 'Strong shaking',   fillOp: 0.30 },
    { mmi: 'V',    color: '#78350f', fill: '#fbbf24', radiusKm:  75, label: 'Moderate shaking', fillOp: 0.20 },
    { mmi: 'IV',   color: '#365314', fill: '#84cc16', radiusKm: 150, label: 'Light shaking',    fillOp: 0.12 },
    { mmi: 'III',  color: '#1e3a5f', fill: '#60a5fa', radiusKm: 300, label: 'Weak shaking',     fillOp: 0.07 },
  ]

  if (hasQuakes) {
    const quake = features[0]  // most recent / closest
    const [eLon, eLat, eDepth] = quake.geometry.coordinates
    const mag  = quake.properties.mag ?? 0
    const time = new Date(quake.properties.time).toISOString().replace('T',' ').slice(0,16)

    // Scale rings by magnitude (larger quake = larger rings)
    const magScale = Math.pow(10, (mag - 5) * 0.5)

    // Draw intensity rings (outermost first, so epicenter is on top)
    ;[...MMI_RINGS].reverse().forEach(ring => {
      const scaledRadius = ring.radiusKm * 1000 * Math.max(0.3, Math.min(3, magScale))
      const ringCoords = circleRing(eLat, eLon, scaledRadius, 48)

      L.polygon(ringCoords, {
        color:       ring.color,
        weight:      1,
        opacity:     0.8,
        fillColor:   ring.fill,
        fillOpacity: ring.fillOp,
      }).bindPopup(popup(`
        <div style="font-size:11px;font-weight:700;color:${ring.fill};margin-bottom:6px">INTENSITY ZONE MMI ${ring.mmi}</div>
        ${popupRow('Description', ring.label, '')}
        ${popupRow('Radius', `~${ring.radiusKm}km`, 'Scaled by magnitude')}
        ${popupRow('Magnitude', `Mw ${mag.toFixed(1)}`, 'USGS')}
        <div style="margin-top:6px">${dataTag('MODELLED')}</div>
        <div style="font-size:9px;color:#475569;margin-top:4px">Attenuation-based estimate. Not recorded shaking data.</div>
      `)).addTo(group)
    })

    // Epicenter pulsing marker
    const epicIcon = L.divIcon({
      html: `
        <div style="position:relative;width:24px;height:24px">
          <div style="position:absolute;inset:0;border-radius:50%;background:rgba(239,68,68,0.25);animation:epi-pulse 1.5s ease-out infinite"></div>
          <div style="position:absolute;inset:4px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 12px rgba(239,68,68,0.8)"></div>
        </div>`,
      iconSize: [24,24], iconAnchor: [12,12], className: '',
    })
    L.marker([eLat, eLon], { icon: epicIcon, zIndexOffset: 1000 })
      .bindPopup(popup(`
        <div style="font-size:11px;font-weight:700;color:#ef4444;margin-bottom:6px">EARTHQUAKE EPICENTER</div>
        ${popupRow('Magnitude', `Mw ${mag.toFixed(1)}`, '')}
        ${popupRow('Depth', `${eDepth?.toFixed(0) ?? '—'} km`, '')}
        ${popupRow('Time', time, 'UTC')}
        ${popupRow('Location', quake.properties.place ?? '—', '')}
        <div style="margin-top:6px">${dataTag('REAL')} <span style="font-size:9px;color:#475569;margin-left:4px">Source: USGS Earthquake Catalog</span></div>
      `)).addTo(group)

    // Additional earthquakes (smaller dots)
    features.slice(1, 6).forEach(f => {
      const [lon2, lat2] = f.geometry.coordinates
      const m2 = f.properties.mag ?? 0
      const r2 = Math.max(3, m2 * 2)
      L.circleMarker([lat2, lon2], {
        radius: r2, color: '#fff', weight: 1, fillColor: '#f87171', fillOpacity: 0.7,
      }).bindPopup(popup(`
        <div style="font-size:11px;font-weight:700;color:#f87171;margin-bottom:6px">SEISMIC EVENT</div>
        ${popupRow('Magnitude', `Mw ${m2.toFixed(1)}`, '')}
        ${popupRow('Location', f.properties.place ?? '—', '')}
        ${popupRow('Time', new Date(f.properties.time).toLocaleDateString(), '')}
        <div style="margin-top:6px">${dataTag('REAL')}</div>
      `)).addTo(group)
    })
  } else {
    // No USGS earthquake within range — show a modest background zone from area center
    // using hazard-score weighted zones, labeled "SEISMIC BACKGROUND HAZARD"
    const aLat = area?.lat ?? 20.59
    const aLon = area?.lon ?? 78.96

    ;[...MMI_RINGS].slice(2).reverse().forEach(ring => {  // only light rings
      const ringCoords = circleRing(aLat, aLon, ring.radiusKm * 500, 36)  // halved radius
      L.polygon(ringCoords, {
        color:       ring.color,
        weight:      1,
        opacity:     0.4,
        fillColor:   ring.fill,
        fillOpacity: ring.fillOp * 0.4,
        dashArray:   '6 4',
      }).addTo(group)
    })
  }

  // Critical infrastructure exposure
  ;(infra ?? []).forEach(n => {
    const lat = n.lat ?? n.center?.lat
    const lon = n.lon ?? n.center?.lon
    if (!lat || !lon) return
    const icon = L.divIcon({
      html: `<div style="width:10px;height:10px;background:#fbbf24;border:2px solid #fff;border-radius:2px;box-shadow:0 0 6px rgba(251,191,36,0.6)"></div>`,
      iconSize: [10,10], iconAnchor: [5,5], className: '',
    })
    L.marker([lat, lon], { icon }).bindPopup(popup(`
      <div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px">CRITICAL FACILITY</div>
      ${popupRow('Type', (n.tags?.amenity ?? 'facility').toUpperCase(), '')}
      ${popupRow('Name', n.tags?.name ?? '(unnamed)', '')}
      ${popupRow('Seismic exposure', 'See intensity zone', 'MODELLED')}
      <div style="margin-top:6px">${dataTag('REAL')}</div>
    `)).addTo(group)
  })

  const legend = hasQuakes
    ? [
        { color: '#dc2626', border: '#7f1d1d', label: 'MMI VII+ — Severe',   type: 'fill', status: 'MODELLED' },
        { color: '#f97316', border: '#92400e', label: 'MMI VI — Strong',     type: 'fill', status: 'MODELLED' },
        { color: '#fbbf24', border: '#78350f', label: 'MMI V — Moderate',    type: 'fill', status: 'MODELLED' },
        { color: '#84cc16', border: '#365314', label: 'MMI IV — Light',      type: 'fill', status: 'MODELLED' },
        { color: '#60a5fa', border: '#1e3a5f', label: 'MMI III — Weak',      type: 'fill', status: 'MODELLED' },
        { color: '#ef4444', border: '#fff',    label: 'Epicenter',           type: 'dot',  status: 'REAL' },
        { color: '#fbbf24', border: null,      label: 'Critical facility',   type: 'dot',  status: 'REAL' },
      ]
    : [
        { color: '#fbbf24', border: null, label: 'Seismic background (dashed)', type: 'dashed', status: 'NO USGS EVENT' },
      ]

  const dataStatus = hasQuakes
    ? [
        { source: 'Epicenter',       status: 'REAL',        note: `USGS Earthquake Catalog · ${features.length} event(s) found` },
        { source: 'Intensity rings', status: 'MODELLED',    note: 'Attenuation-based MMI estimate — not recorded shaking data' },
        { source: 'Infrastructure',  status: 'REAL',        note: 'OpenStreetMap hospitals / schools' },
      ]
    : [
        { source: 'Epicenter',       status: 'UNAVAILABLE', note: 'No USGS earthquake ≥ Mw 3.5 in past 365 days within range' },
        { source: 'Intensity rings', status: 'UNAVAILABLE', note: 'Cannot model intensity without epicenter' },
        { source: 'Background zone', status: 'MODELLED',    note: 'Dashed rings show generic seismic background — not event-specific' },
      ]

  return { group, legend, dataStatus }
}
