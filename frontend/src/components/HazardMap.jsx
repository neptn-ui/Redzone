// src/components/HazardMap.jsx
// ============================================================================
// REDZONE — Primary GIS Map Surface (HAZARD-LAYER ARCHITECTURE)
//
// The map is the product. It changes completely when hazard type changes.
//
// Hazard Type → Layer Renderer:
//   FLOOD      → FloodRenderer     (OSM rivers + modelled inundation)
//   EROSION    → ErosionRenderer   (OSM channel + modelled corridor)
//   LANDSLIDE  → LandslideRenderer (susceptibility zones + roads)
//   EARTHQUAKE → EarthquakeRenderer (USGS epicenter + intensity rings)
//   (none)     → Settlement markers only
//
// Data loading:
//   1. OSM Overpass API  — rivers, roads, bridges, infra (REAL)
//   2. USGS Earthquake   — recent seismic events        (REAL)
//   3. Backend zones     — exposed settlements           (MODELLED)
//   4. Layer renderer    — calls appropriate factory
//
// All layers labeled REAL / MODELLED / UNAVAILABLE.
// ============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../context/AppStore'
import MapInspectorPanel from './MapInspectorPanel'
import { HazardLegend } from './hazard-layers/HazardLegend'
import {
  createFloodLayers,
  createErosionLayers,
  createLandslideLayers,
  createEarthquakeLayers,
} from './hazard-layers/renderers'
import {
  fetchRivers, fetchMajorRoads, fetchBridges,
  fetchInfrastructure, fetchRecentEarthquakes,
} from '../api/overpass'

// ── Leaflet lazy loader ───────────────────────────────────────────────────────

let _L = null
function getLeaflet() {
  if (_L) return Promise.resolve(_L)
  return import('leaflet').then(mod => {
    _L = mod.default
    delete _L.Icon.Default.prototype._getIconUrl
    _L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    })
    return _L
  })
}

// ── Hazard type configuration ────────────────────────────────────────────────

const HAZARD_TYPES = [
  { id: null,         label: 'Overview',   color: 'text-slate-400' },
  { id: 'flood',      label: 'Flood',      color: 'text-blue-400' },
  { id: 'erosion',    label: 'Erosion',    color: 'text-orange-400' },
  { id: 'landslide',  label: 'Landslide',  color: 'text-amber-400' },
  { id: 'earthquake', label: 'Earthquake', color: 'text-red-400' },
]

// ── Settlement colours ────────────────────────────────────────────────────────

const CLF_COLOR = {
  immediate:   { fill: '#ef4444', stroke: '#ffffff' },
  short_term:  { fill: '#f97316', stroke: '#ffffff' },
  medium_term: { fill: '#f59e0b', stroke: '#ffffff' },
  stable:      { fill: '#22c55e', stroke: '#ffffff' },
}

function settlementPopup(zone) {
  const c = CLF_COLOR[zone.classification] ?? CLF_COLOR.stable
  const score = zone.hazard_score != null ? (zone.hazard_score * 100).toFixed(0) : '—'
  const clf = (zone.classification ?? 'unknown').replace(/_/g, ' ').toUpperCase()
  return `
    <div style="font-family:'Outfit',system-ui,sans-serif;min-width:200px">
      <div style="font-size:10px;font-weight:800;color:${c.fill};text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">${clf}</div>
      <div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:6px">${zone.name ?? '—'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
        <div style="padding:3px 6px;background:rgba(255,255,255,.04);border-radius:5px">
          <div style="font-size:8px;color:#64748b;text-transform:uppercase;font-weight:700">HAZARD</div>
          <div style="font-size:15px;font-weight:800;color:${c.fill};font-feature-settings:'tnum'">${score}</div>
          <div style="font-size:8px;color:#334155">MODELLED</div>
        </div>
        <div style="padding:3px 6px;background:rgba(255,255,255,.04);border-radius:5px">
          <div style="font-size:8px;color:#64748b;text-transform:uppercase;font-weight:700">POP</div>
          <div style="font-size:15px;font-weight:800;color:#f1f5f9;font-feature-settings:'tnum'">${(zone.population ?? 0).toLocaleString()}</div>
          <div style="font-size:8px;color:#334155">STATIC</div>
        </div>
      </div>
    </div>`
}

function sitePopup(site) {
  const score = site.capacity_score != null ? (site.capacity_score * 100).toFixed(0) : '—'
  return `
    <div style="font-family:'Outfit',system-ui,sans-serif;min-width:180px">
      <div style="font-size:10px;font-weight:800;color:#3b82f6;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">SAFE SITE</div>
      <div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:6px">${site.name ?? '—'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
        <div style="padding:3px 6px;background:rgba(59,130,246,.08);border-radius:5px;border:1px solid rgba(59,130,246,.2)">
          <div style="font-size:8px;color:#64748b;font-weight:700">CAPACITY</div>
          <div style="font-size:15px;font-weight:800;color:#60a5fa">${site.available_capacity ?? '—'}</div>
        </div>
        <div style="padding:3px 6px;background:rgba(59,130,246,.08);border-radius:5px;border:1px solid rgba(59,130,246,.2)">
          <div style="font-size:8px;color:#64748b;font-weight:700">SCORE</div>
          <div style="font-size:15px;font-weight:800;color:#60a5fa">${score}%</div>
          <div style="font-size:8px;color:#334155">MODELLED</div>
        </div>
      </div>
    </div>`
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function HazardMap({
  zones    = [],
  sites    = [],
  route    = null,
  onZoneSelect = null,
  event    = null,
  activeTimestamp = null,
  simulatedHazardGeometry = null,
  isSimulationMode = false,
}) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const prevAreaRef  = useRef(null)

  // Layer group refs — each cleared before new hazard renders
  const hazardGroupRef    = useRef(null)
  const settlementGrpRef  = useRef(null)
  const siteGrpRef        = useRef(null)
  const routeGrpRef       = useRef(null)
  const eventImpactGrpRef = useRef(null)
  const simulatedGrpRef   = useRef(null)

  const { area, activeLayers, hazard, setHazard, setSelectedFeature, historicalEvent, historicalTimestamp } = useAppStore()

  const currentEvent = event || historicalEvent
  const currentTimestamp = activeTimestamp || historicalTimestamp

  const [activeHazard, setActiveHazard] = useState(currentEvent?.hazard_type ?? hazard?.type ?? null)
  const [osmData,      setOsmData]      = useState({ rivers: [], roads: [], bridges: [], infra: [], earthquakes: null })
  const leafletRef     = useRef(null)     // the actual L instance
  const [mapReady, setMapReady] = useState(false)  // triggers hazard re-render
  const [osmLoading,   setOsmLoading]   = useState(false)
  const [osmError,     setOsmError]     = useState(null)
  const [hazardResult, setHazardResult] = useState({ legend: [], dataStatus: [] })

  // Sync external hazard state (e.g. from Historical Replay or Scenario Lab) to local map state
  useEffect(() => {
    if (currentEvent?.hazard_type) {
      setActiveHazard(currentEvent.hazard_type)
    } else {
      setActiveHazard(hazard?.type ?? null)
    }
  }, [hazard?.type, currentEvent?.hazard_type])

  // ── Init Leaflet ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return
    let map
    let resizeObserver = null

    getLeaflet().then(L => {
      if (mapRef.current || !containerRef.current) return

      map = L.map(containerRef.current, {
        center: [20.59, 78.96],
        zoom: 5,
        minZoom: 3,
        maxBounds: [[-85, -180], [85, 180]],
        maxBoundsViscosity: 1.0,
        worldCopyJump: false,
        zoomControl: false,
        attributionControl: true,
      })

      // ESRI World Imagery satellite
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri &mdash; Esri, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN',
          maxZoom: 19,
          opacity: 0.95,
          noWrap: true,
          bounds: [[-85, -180], [85, 180]],
        }
      ).addTo(map)

      // ESRI label overlay
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          opacity: 0.85,
          noWrap: true,
          bounds: [[-85, -180], [85, 180]],
        }
      ).addTo(map)

      L.control.zoom({ position: 'bottomright' }).addTo(map)
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)

      // Add pulse keyframe to map container
      const style = document.createElement('style')
      style.textContent = `@keyframes epi-pulse { 0%{opacity:0.8;transform:scale(1)} 70%{opacity:0;transform:scale(3)} 100%{opacity:0;transform:scale(3)} }`
      map.getContainer().appendChild(style)

      mapRef.current = map
      leafletRef.current = L
      _L = L
      setMapReady(true)  // signal that Leaflet is ready — triggers hazard layer effects

      // Force recalculation once DOM flex layout settles
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize({ debounceMoveend: true })
        }
      }, 100)
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize({ debounceMoveend: true })
        }
      }, 400)

      // Automatic resize observer: recalculate dimensions whenever panels open/close or window resizes
      if (window.ResizeObserver && containerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          if (mapRef.current) {
            mapRef.current.invalidateSize({ debounceMoveend: true })
          }
        })
        resizeObserver.observe(containerRef.current)
      }
    })

    return () => {
      if (resizeObserver) resizeObserver.disconnect()
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      leafletRef.current = null
      setMapReady(false)
    }
  }, [])

  // ── Fly to area or event ──────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (currentEvent?.lat && currentEvent?.lon) {
      const eventKey = `event_${currentEvent.event_id || currentEvent.name}_${currentEvent.lat}_${currentEvent.lon}`
      if (prevAreaRef.current === eventKey) return
      prevAreaRef.current = eventKey
      map.flyTo([currentEvent.lat, currentEvent.lon], currentEvent.zoom ?? 10, { duration: 1.4 })
      return
    }

    if (!area) return
    const key = `${area.lat},${area.lon}`
    if (prevAreaRef.current === key) return
    prevAreaRef.current = key

    if (area.bbox) {
      try {
        map.flyToBounds(
          [[area.bbox.south, area.bbox.west], [area.bbox.north, area.bbox.east]],
          { duration: 1.2, padding: [40, 40] }
        )
        return
      } catch {}
    }
    map.flyTo([area.lat, area.lon], area.zoom ?? 11, { duration: 1.2 })
  }, [area, currentEvent?.event_id, currentEvent?.lat, currentEvent?.lon])

  // ── Load OSM data when area or event changes ──────────────────────────────
  const prevOsmAreaRef = useRef(null)

  useEffect(() => {
    const effLat = currentEvent?.lat ?? area?.lat
    const effLon = currentEvent?.lon ?? area?.lon
    const effZoom = currentEvent?.zoom ?? area?.zoom ?? 10

    if (!effLat || !effLon) {
      setOsmData({ rivers: [], roads: [], bridges: [], infra: [], earthquakes: null })
      setOsmLoading(false)
      return
    }

    const areaKey = `${Number(effLat).toFixed(3)},${Number(effLon).toFixed(3)}`
    if (prevOsmAreaRef.current === areaKey) {
      return
    }
    prevOsmAreaRef.current = areaKey

    let isCurrent = true
    setOsmLoading(true)
    setOsmError(null)

    // Hard safety timeout: loader never spins longer than 4.5 seconds
    const safetyTimer = setTimeout(() => {
      if (isCurrent) setOsmLoading(false)
    }, 4500)

    const radius = effZoom >= 12 ? 15000 : effZoom >= 10 ? 30000 : 45000

    Promise.allSettled([
      fetchRivers(effLat, effLon, radius),
      fetchMajorRoads(effLat, effLon, radius * 0.6),
      fetchBridges(effLat, effLon, radius),
      fetchInfrastructure(effLat, effLon, radius * 0.5),
      fetchRecentEarthquakes(effLat, effLon, 300),
    ]).then(([rv, rd, br, inf, eq]) => {
      if (!isCurrent) return
      setOsmData({
        rivers:      rv.status === 'fulfilled' ? (rv.value ?? []) : [],
        roads:       rd.status === 'fulfilled' ? (rd.value ?? []) : [],
        bridges:     br.status === 'fulfilled' ? (br.value ?? []) : [],
        infra:       inf.status === 'fulfilled' ? (inf.value ?? []) : [],
        earthquakes: eq.status === 'fulfilled' ? eq.value : null,
      })
      if (rv.status === 'rejected' && rd.status === 'rejected') {
        setOsmError('OSM Overpass unavailable — using local telemetry')
      }
    }).catch(err => {
      console.warn('[HazardMap] OSM fetch error:', err)
    }).finally(() => {
      clearTimeout(safetyTimer)
      if (isCurrent) setOsmLoading(false)
    })

    return () => {
      isCurrent = false
      clearTimeout(safetyTimer)
    }
  }, [area?.lat, area?.lon, area?.zoom, currentEvent?.lat, currentEvent?.lon])

  // ── Render hazard layers when hazard or OSM data changes ─────────────────

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    // Remove old hazard group
    if (hazardGroupRef.current) {
      hazardGroupRef.current.remove()
      hazardGroupRef.current = null
    }

    if (!activeHazard) {
      setHazardResult({ legend: [], dataStatus: [] })
      return
    }

    const layerData = {
      rivers:      osmData.rivers,
      roads:       osmData.roads,
      bridges:     osmData.bridges,
      infra:       osmData.infra,
      earthquakes: osmData.earthquakes,
      zones:       zones,
      area:        area,
    }

    let result
    switch (activeHazard) {
      case 'flood':
        result = createFloodLayers(L, layerData)
        break
      case 'erosion':
        result = createErosionLayers(L, layerData)
        break
      case 'landslide':
        result = createLandslideLayers(L, layerData)
        break
      case 'earthquake':
        result = createEarthquakeLayers(L, layerData)
        break
      default:
        setHazardResult({ legend: [], dataStatus: [] })
        return
    }

    result.group.addTo(map)
    hazardGroupRef.current = result.group
    setHazardResult({ legend: result.legend, dataStatus: result.dataStatus })
  }, [activeHazard, osmData, zones, area, mapReady])

  // ── Settlement markers (always shown in overview, behind hazard layers) ───

  useEffect(() => {
    const map = mapRef.current
    if (!map || !_L) return

    if (settlementGrpRef.current) { settlementGrpRef.current.remove() }

    if (!activeLayers.settlements) {
      settlementGrpRef.current = null
      return
    }

    const grp = _L.layerGroup()
    zones.forEach(zone => {
      const c = CLF_COLOR[zone.classification] ?? CLF_COLOR.stable
      const r = zone.population > 10000 ? 10 : zone.population > 3000 ? 8 : 6

      _L.circleMarker([zone.lat, zone.lon], {
        radius: r, color: '#ffffff', weight: 1.5,
        fillColor: c.fill, fillOpacity: 0.9,
      })
        .bindPopup(settlementPopup(zone), { maxWidth: 260, className: 'rz-popup' })
        .on('click', () => {
          onZoneSelect?.(zone.habitation_id)
          setSelectedFeature({ ...zone, featureType: 'habitation' })
        })
        .addTo(grp)
    })
    grp.addTo(map)
    settlementGrpRef.current = grp
  }, [zones, activeLayers.settlements, setSelectedFeature, onZoneSelect])

  // ── Site markers ──────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !_L) return

    if (siteGrpRef.current) { siteGrpRef.current.remove() }

    if (!activeLayers.safe_sites) { siteGrpRef.current = null; return }

    const grp = _L.layerGroup()
    sites.forEach(site => {
      if (!site.lat || !site.lon) return
      const icon = _L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:3px;background:#1d4ed8;border:2px solid #fff;box-shadow:0 0 8px rgba(59,130,246,.7)"></div>`,
        iconSize: [14,14], iconAnchor: [7,7], className: '',
      })
      _L.marker([site.lat, site.lon], { icon })
        .bindPopup(sitePopup(site), { maxWidth: 220, className: 'rz-popup' })
        .on('click', () => setSelectedFeature({ ...site, featureType: 'safe_site' }))
        .addTo(grp)
    })
    grp.addTo(map)
    siteGrpRef.current = grp
  }, [sites, activeLayers.safe_sites, setSelectedFeature])

  // ── Route ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !_L) return

    if (routeGrpRef.current) { routeGrpRef.current.remove(); routeGrpRef.current = null }

    if (!route?.coordinates?.length || !activeLayers.routes) return

    const grp = _L.layerGroup()
    _L.polyline(route.coordinates, { color: '#1d4ed8', weight: 8, opacity: 0.25 }).addTo(grp)
    _L.polyline(route.coordinates, {
      color: '#3b82f6', weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round',
    }).addTo(grp)
    grp.addTo(map)
    routeGrpRef.current = grp

    try { map.fitBounds(_L.polyline(route.coordinates).getBounds(), { padding: [60, 60] }) } catch {}
  }, [route, activeLayers.routes])

  // ── Event Impact Layer (Beacon, Inundation Extent, Hotspots) ─────────────
  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    if (eventImpactGrpRef.current) {
      eventImpactGrpRef.current.remove()
      eventImpactGrpRef.current = null
    }

    if (!currentEvent || !currentEvent.lat || !currentEvent.lon) return

    const grp = L.layerGroup()
    const hazardColor = currentEvent.hazard_type === 'flood' ? '#3b82f6'
      : currentEvent.hazard_type === 'erosion' ? '#f97316'
      : currentEvent.hazard_type === 'landslide' ? '#d97706'
      : '#ef4444'

    // 1. Epicenter Beacon Marker
    const beaconIcon = L.divIcon({
      html: `
        <div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
          <div style="position:absolute;width:44px;height:44px;border-radius:50%;background:${hazardColor};opacity:0.35;animation:epi-pulse 2s infinite ease-out;"></div>
          <div style="position:absolute;width:26px;height:26px;border-radius:50%;background:${hazardColor};opacity:0.6;animation:epi-pulse 2s 0.6s infinite ease-out;"></div>
          <div style="position:relative;width:16px;height:16px;border-radius:50%;background:#ffffff;border:3px solid ${hazardColor};box-shadow:0 0 12px ${hazardColor};"></div>
        </div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      className: '',
    })

    const beaconPopup = `
      <div style="font-family:'Outfit',system-ui,sans-serif;min-width:240px;padding:2px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
          <span style="font-size:9px;font-weight:800;color:${hazardColor};text-transform:uppercase;letter-spacing:.08em;">${currentEvent.hazard_type?.toUpperCase()} FOCAL CENTER</span>
          <span style="font-size:8px;font-weight:700;color:#f59e0b;padding:1px 5px;border:1px solid rgba(245,158,11,0.3);border-radius:3px;">${currentEvent.data_status || 'HISTORICAL'}</span>
        </div>
        <div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:4px;">${currentEvent.name}</div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;line-height:1.4;">${currentEvent.description || ''}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;background:rgba(255,255,255,0.04);padding:6px;border-radius:6px;">
          <div>
            <div style="font-size:8px;color:#64748b;font-weight:700;">SEVERITY</div>
            <div style="font-size:13px;font-weight:800;color:#ef4444;">${currentEvent.severity?.toUpperCase() || 'HIGH'}</div>
          </div>
          <div>
            <div style="font-size:8px;color:#64748b;font-weight:700;">AFFECTED</div>
            <div style="font-size:13px;font-weight:800;color:#f1f5f9;">${currentEvent.affected_pop ? (currentEvent.affected_pop / 1000).toFixed(0) + 'K' : '—'}</div>
          </div>
        </div>
      </div>`

    L.marker([currentEvent.lat, currentEvent.lon], { icon: beaconIcon })
      .bindPopup(beaconPopup, { maxWidth: 280, className: 'rz-popup' })
      .addTo(grp)

    // 2. Inundation & Impact Reach Rings
    L.circle([currentEvent.lat, currentEvent.lon], {
      radius: 35000,
      color: hazardColor,
      weight: 1.5,
      dashArray: '6, 8',
      fillColor: hazardColor,
      fillOpacity: 0.06,
    }).bindTooltip(`DOCUMENTED IMPACT REACH (~35 km) — ${currentEvent.affected_pop ? (currentEvent.affected_pop / 1000).toFixed(0) + 'K affected' : ''}`, { sticky: true }).addTo(grp)

    L.circle([currentEvent.lat, currentEvent.lon], {
      radius: 14000,
      color: hazardColor,
      weight: 2,
      fillColor: hazardColor,
      fillOpacity: 0.16,
    }).bindTooltip(`SEVERE IMPACT CORE — High Inundation Depth`, { sticky: true }).addTo(grp)

    // 3. Impact Hotspots
    const hotspots = currentEvent.impact_hotspots || []
    hotspots.forEach(hs => {
      const isCurrentStage = hs.timestamp === currentTimestamp || (currentEvent.timeline && currentEvent.timeline[hs.stage_idx - 1]?.timestamp === currentTimestamp)
      const hsBorder = isCurrentStage ? '#f59e0b' : hazardColor
      const hsGlow = isCurrentStage ? '0 0 10px #f59e0b' : '0 2px 8px rgba(0,0,0,0.6)'

      const hsIcon = L.divIcon({
        html: `
          <div style="display:flex;align-items:center;gap:6px;background:#0b0f1a;border:1.5px solid ${hsBorder};padding:4px 8px;border-radius:6px;box-shadow:${hsGlow};white-space:nowrap;cursor:pointer;">
            <span style="width:7px;height:7px;border-radius:50%;background:${hsBorder};display:inline-block;${isCurrentStage ? 'box-shadow:0 0 6px #f59e0b;' : ''}"></span>
            <span style="font-size:10px;font-weight:700;color:#f1f5f9;font-family:'Outfit',sans-serif;">${hs.name}</span>
          </div>`,
        iconSize: [120, 26],
        iconAnchor: [60, 13],
        className: '',
      })

      const hsPopup = `
        <div style="font-family:'Outfit',system-ui,sans-serif;min-width:240px;padding:2px;">
          <div style="font-size:9px;font-weight:800;color:${hazardColor};text-transform:uppercase;margin-bottom:2px;">${hs.type || 'GROUND INCIDENT'}</div>
          <div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:4px;">${hs.name}</div>
          <div style="font-size:10px;color:#64748b;margin-bottom:6px;">District: ${hs.district || currentEvent.district || 'Assam'} · Recorded ${hs.timestamp || currentEvent.date_start}</div>
          <div style="font-size:11px;color:#cbd5e1;line-height:1.45;margin-bottom:8px;">${hs.description}</div>
          <div style="font-size:8px;font-weight:700;color:#f59e0b;padding:2px 6px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:4px;display:inline-block;">RECONSTRUCTED GROUND INCIDENT</div>
        </div>`

      L.marker([hs.lat, hs.lon], { icon: hsIcon })
        .bindPopup(hsPopup, { maxWidth: 280, className: 'rz-popup' })
        .addTo(grp)
    })

    grp.addTo(map)
    eventImpactGrpRef.current = grp
  }, [currentEvent, currentTimestamp, mapReady])

  // ── Simulated Hazard Geometry Layer (Counterfactual Propagation §9.4) ──────
  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !mapReady) return

    if (simulatedGrpRef.current) {
      simulatedGrpRef.current.remove()
      simulatedGrpRef.current = null
    }

    if (!isSimulationMode || !simulatedHazardGeometry?.features?.length) return

    const simLayer = L.geoJSON(simulatedHazardGeometry, {
      style: (feature) => {
        const props = feature.properties || {}
        const isBreach = props.hazard_type === 'dyke_breach'
        return {
          color: props.color || '#ef4444',
          weight: isBreach ? 3 : 2,
          dashArray: isBreach ? '5, 5' : undefined,
          fillColor: props.color || '#ef4444',
          fillOpacity: props.fill_opacity != null ? props.fill_opacity : 0.45,
        }
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {}
        layer.bindPopup(`
          <div style="font-family:'Outfit',system-ui,sans-serif;min-width:220px;padding:2px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
              <span style="font-size:9px;font-weight:800;color:${p.color || '#ef4444'};text-transform:uppercase;letter-spacing:.08em;">
                SIMULATED INUNDATION EXTENT
              </span>
              <span style="font-size:8px;font-weight:700;color:#f59e0b;padding:1px 5px;border:1px solid rgba(245,158,11,0.3);border-radius:3px;">
                COUNTERFACTUAL
              </span>
            </div>
            <div style="font-size:12px;font-weight:700;color:#f1f5f9;margin-bottom:4px;">${p.name || 'Simulated Flood Extent'}</div>
            <div style="font-size:10px;color:#94a3b8;margin-bottom:6px;">
              Severity: <strong style="color:${p.color || '#ef4444'}">${p.inundation_severity || 'ELEVATED'}</strong>
              ${p.surge_level_m != null ? ` · Surge: +${p.surge_level_m}m` : ''}
              ${p.rainfall_mm_24h != null ? ` · Rain: ${p.rainfall_mm_24h}mm/24h` : ''}
            </div>
            <div style="font-size:8px;color:#cbd5e1;background:rgba(239,68,68,0.1);padding:4px;border-radius:4px;border:1px solid rgba(239,68,68,0.2);">
              SPATIAL PROPAGATION: Habitations within this polygon are evaluated under elevated exposure.
            </div>
          </div>
        `, { maxWidth: 280, className: 'rz-popup' })
      }
    })

    simLayer.addTo(map)
    simulatedGrpRef.current = simLayer

    try {
      const bounds = simLayer.getBounds()
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
      }
    } catch {}
  }, [simulatedHazardGeometry, isSimulationMode, mapReady])

  // ── Handle hazard type switch ─────────────────────────────────────────────

  const handleHazardSwitch = useCallback((id) => {
    setActiveHazard(id)
    setHazard(id ? { type: id } : null)
  }, [setHazard])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex-1 h-full w-full min-h-0 overflow-hidden" style={{ height: '100%' }}>

      {/* Map container - Isolated stacking context ensures Leaflet internal panes (200-1000) stay inside z-0 */}
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full z-0"
        id="redzone-map"
        style={{ isolation: 'isolate' }}
      />

      {/* Map Inspector panel overlay - z-30, guaranteed above map */}
      <MapInspectorPanel />

      {/* ── Hazard type switcher bar ── */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex gap-1 bg-[#0c101d] border border-white/[0.12] rounded-xl px-2 py-1.5 shadow-2xl">
        {HAZARD_TYPES.map(ht => (
          <button
            key={String(ht.id)}
            onClick={() => handleHazardSwitch(ht.id)}
            disabled={!area && ht.id !== null}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider font-mono transition-all disabled:opacity-30 ${
              activeHazard === ht.id
                ? `bg-white/[0.12] border border-white/[0.2] ${ht.color}`
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {ht.label}
          </button>
        ))}
      </div>

      {/* OSM loading indicator */}
      {osmLoading && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0c101d] border border-blue-500/30 shadow-2xl">
          <div className="w-3 h-3 border border-blue-500/40 border-t-blue-400 rounded-full animate-spin" />
          <span className="text-[9px] font-mono text-blue-400 uppercase tracking-widest">Fetching OSM geographic data...</span>
        </div>
      )}

      {/* OSM error notice */}
      {osmError && !osmLoading && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg bg-[#0c101d] border border-amber-500/30 shadow-2xl">
          <span className="text-[9px] font-mono text-amber-400">{osmError}</span>
        </div>
      )}

      {/* Historical Event Map HUD Overlay */}
      {currentEvent && (
        <div className="absolute top-4 left-4 z-20 max-w-sm bg-[#0c101d]/95 backdrop-blur-md border border-amber-500/40 rounded-xl p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[9px] font-bold font-mono uppercase tracking-widest text-amber-400">
                HISTORICAL REPLAY · {currentEvent.data_status || 'RECONSTRUCTED'}
              </span>
            </div>
            <span className="text-[9px] font-mono font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
              {currentEvent.severity?.toUpperCase()}
            </span>
          </div>
          <div className="text-xs font-bold text-slate-100 mb-0.5 leading-tight">{currentEvent.name}</div>
          <div className="text-[10px] text-slate-400 font-mono mb-2">{currentEvent.region}</div>
          
          {/* Active timeline stage info */}
          {currentEvent.timeline && currentEvent.timeline.length > 0 && (() => {
            const activeStage = currentEvent.timeline.find(s => s.timestamp === currentTimestamp) || currentEvent.timeline[0]
            const stageIdx = currentEvent.timeline.findIndex(s => s.timestamp === (activeStage?.timestamp)) + 1
            return (
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-2 mt-1.5">
                <div className="flex items-center justify-between text-[9px] font-mono mb-1">
                  <span className="text-amber-400 font-bold">STAGE {stageIdx} OF {currentEvent.timeline.length}</span>
                  <span className="text-slate-500">{activeStage?.timestamp}</span>
                </div>
                <div className="text-[11px] font-semibold text-slate-200 leading-snug">{activeStage?.label}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{activeStage?.description}</div>
              </div>
            )
          })()}

          <div className="text-[8px] text-slate-500 font-mono mt-2 flex items-center justify-between border-t border-white/[0.04] pt-1.5">
            <span>● Click markers to inspect ground impact</span>
            <span>{currentEvent.affected_pop ? `${(currentEvent.affected_pop / 1000).toFixed(0)}K exposed` : ''}</span>
          </div>
        </div>
      )}

      {/* Simulation Lab Counterfactual HUD */}
      {isSimulationMode && simulatedHazardGeometry?.features?.length > 0 && (
        <div className="absolute top-4 right-4 z-20 max-w-xs bg-[#0c101d]/95 backdrop-blur-md border border-blue-500/40 rounded-xl p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              <span className="text-[9px] font-bold font-mono uppercase tracking-widest text-blue-400">
                SIMULATION LAB · COUNTERFACTUAL
              </span>
            </div>
          </div>
          <div className="text-xs font-bold text-slate-100 mb-0.5 leading-tight">Simulated Inundation Extent Rendered</div>
          <div className="text-[10px] text-slate-400 font-mono">
            {simulatedHazardGeometry.severity || 'ACTIVE SCENARIO'} · {simulatedHazardGeometry.features.length} GeoJSON feature(s)
          </div>
        </div>
      )}

      {/* Dynamic hazard legend + data status */}
      <HazardLegend
        legend={hazardResult.legend}
        dataStatus={hazardResult.dataStatus}
        hazardType={activeHazard}
        loading={osmLoading}
      />

      {/* Overview legend (no hazard selected) */}
      {!activeHazard && zones.length > 0 && (
        <div className="absolute bottom-8 right-4 z-20 bg-[#0c101d] border border-white/[0.12] rounded-xl p-3 shadow-2xl">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2 font-mono">ZONE CLASSIFICATION</div>
          {[
            { key: 'immediate',   label: 'IMMEDIATE'   },
            { key: 'short_term',  label: 'SHORT TERM'  },
            { key: 'medium_term', label: 'MEDIUM TERM' },
            { key: 'stable',      label: 'STABLE'      },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2 mb-1">
              <div className="w-3 h-3 rounded-full" style={{ background: CLF_COLOR[key].fill, border: '1px solid #ffffff50' }} />
              <span className="text-[10px] text-slate-300 font-mono">{label}</span>
              <span className="text-[7px] font-mono text-slate-500 ml-auto">MODELLED</span>
            </div>
          ))}
          {sites.length > 0 && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/[0.08]">
              <div className="w-3 h-3 rounded-sm" style={{ background: '#1d4ed8', border: '2px solid #fff' }} />
              <span className="text-[10px] text-slate-300 font-mono">SAFE SITE</span>
            </div>
          )}
        </div>
      )}

      {/* No area hint */}
      {!area && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">INDIA — OVERVIEW</div>
            <div className="text-[11px] text-slate-600 font-mono">Search for an area — then select a hazard type above</div>
          </div>
        </div>
      )}
    </div>
  )
}
