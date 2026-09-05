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
}) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const prevAreaRef  = useRef(null)

  // Layer group refs — each cleared before new hazard renders
  const hazardGroupRef  = useRef(null)
  const settlementGrpRef= useRef(null)
  const siteGrpRef      = useRef(null)
  const routeGrpRef     = useRef(null)

  const { area, activeLayers, hazard, setHazard, setSelectedFeature } = useAppStore()

  const [activeHazard, setActiveHazard] = useState(hazard?.type ?? null)
  const [osmData,      setOsmData]      = useState({ rivers: [], roads: [], bridges: [], infra: [], earthquakes: null })
  const leafletRef     = useRef(null)     // the actual L instance
  const [mapReady, setMapReady] = useState(false)  // triggers hazard re-render
  const [osmLoading,   setOsmLoading]   = useState(false)
  const [osmError,     setOsmError]     = useState(null)
  const [hazardResult, setHazardResult] = useState({ legend: [], dataStatus: [] })

  // Sync external hazard state (e.g. from Historical Replay or Scenario Lab) to local map state
  useEffect(() => {
    setActiveHazard(hazard?.type ?? null)
  }, [hazard?.type])

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

  // ── Fly to area ───────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map || !area) return
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
  }, [area])

  // ── Load OSM data when area changes ──────────────────────────────────────
  const prevOsmAreaRef = useRef(null)

  useEffect(() => {
    if (!area?.lat || !area?.lon) {
      setOsmData({ rivers: [], roads: [], bridges: [], infra: [], earthquakes: null })
      setOsmLoading(false)
      return
    }

    const areaKey = `${Number(area.lat).toFixed(3)},${Number(area.lon).toFixed(3)}`
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

    const radius = (area.zoom ?? 11) >= 12 ? 15000 : (area.zoom ?? 11) >= 10 ? 30000 : 45000

    Promise.allSettled([
      fetchRivers(area.lat, area.lon, radius),
      fetchMajorRoads(area.lat, area.lon, radius * 0.6),
      fetchBridges(area.lat, area.lon, radius),
      fetchInfrastructure(area.lat, area.lon, radius * 0.5),
      fetchRecentEarthquakes(area.lat, area.lon, 300),
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
  }, [area?.lat, area?.lon, area?.zoom])

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
