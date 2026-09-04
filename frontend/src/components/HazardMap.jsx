import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

function getLeaflet() {
  if (typeof window !== 'undefined' && window.L) return window.L
  if (L && L.map) return L
  if (L && L.default && L.default.map) return L.default
  return L || null
}

const RISK_COLORS = {
  immediate:   '#ef4444',
  short_term:  '#f97316',
  medium_term: '#eab308',
  stable:      '#22c55e',
}

function markerRadius(population) {
  if (population > 8000) return 16
  if (population > 4000) return 12
  if (population > 1500) return 9
  return 6
}

function popupHTML(zone) {
  const color = RISK_COLORS[zone.classification] || '#94a3b8'
  return `
    <div style="min-width:210px;font-family:'Outfit',-apple-system,sans-serif;padding:2px 4px">
      <div style="font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:4px;letter-spacing:-0.01em">${zone.name}</div>
      <div style="font-size:10px;font-mono;color:#60a5fa;margin-bottom:8px">${zone.district || 'Assam'} District</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <span style="padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;background:${color}18;border:1px solid ${color}40;color:${color}">
          ${zone.classification.replace('_', ' ')}
        </span>
      </div>
      <div style="font-size:12px;color:#94a3b8;line-height:1.75">
        <div style="display:flex;justify-content:space-between"><span>Hazard Index:</span><strong style="color:#f1f5f9;font-family:'JetBrains Mono',monospace">${(zone.hazard_score * 100).toFixed(0)} / 100</strong></div>
        <div style="display:flex;justify-content:space-between"><span>Urgency Index:</span><strong style="color:#f1f5f9;font-family:'JetBrains Mono',monospace">${(zone.urgency_score * 100).toFixed(0)} / 100</strong></div>
        <div style="display:flex;justify-content:space-between"><span>Population:</span><strong style="color:#f1f5f9;font-family:'JetBrains Mono',monospace">${(zone.population || 0).toLocaleString()}</strong></div>
        ${zone.matched_site ? `<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.08);color:#60a5fa;font-size:11px">Safe Parcel: <strong>${zone.matched_site}</strong></div>` : ''}
      </div>
      <div style="margin-top:10px;font-size:11px;font-weight:600;color:#3b82f6;cursor:pointer">Open Full Audit Breakdown →</div>
    </div>
  `
}

function sitePopupHTML(site) {
  return `
    <div style="min-width:190px;font-family:'Outfit',-apple-system,sans-serif;padding:2px 4px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <div style="width:8px;height:8px;background:#3b82f6;transform:rotate(45deg);box-shadow:0 0 6px #3b82f6"></div>
        <div style="font-size:13px;font-weight:700;color:#60a5fa">${site.name}</div>
      </div>
      <div style="font-size:10px;font-mono;color:#94a3b8;margin-bottom:6px">${site.district || 'Assam'} · Highland Safe Parcel</div>
      <div style="font-size:12px;color:#94a3b8;line-height:1.75">
        <div style="display:flex;justify-content:space-between"><span>Capacity Score:</span><strong style="color:#f1f5f9;font-family:'JetBrains Mono',monospace">${(site.capacity_score * 100).toFixed(0)}%</strong></div>
        <div style="display:flex;justify-content:space-between"><span>Available:</span><strong style="color:#f1f5f9;font-family:'JetBrains Mono',monospace">${(site.available_capacity || 0).toLocaleString()} ppl</strong></div>
        <div style="display:flex;justify-content:space-between"><span>Slope:</span><strong style="color:#f1f5f9;font-family:'JetBrains Mono',monospace">${site.slope_degrees}°</strong></div>
      </div>
    </div>
  `
}

export default function HazardMap({ zones = [], sites = [], selectedId, onSelect, route = null }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const tileLayerRef = useRef(null)
  const routeLineRef = useRef(null)
  const [mapInstance, setMapInstance] = useState(null)
  const [mapMode, setMapMode] = useState('dark') // 'dark' | 'satellite'
  const [activeLayer, setActiveLayer] = useState('RISK')
  const markersRef   = useRef([])
  const siteMarksRef = useRef([])

  // Init map once with async retry
  useEffect(() => {
    let active = true

    function init() {
      if (!active || !containerRef.current) return
      const Leaf = getLeaflet()
      if (!Leaf) {
        setTimeout(init, 80)
        return
      }

      if (mapRef.current) {
        try {
          mapRef.current.remove()
        } catch (e) {}
        mapRef.current = null
      }
      if (containerRef.current._leaflet_id) {
        containerRef.current._leaflet_id = null
      }

      try {
        const map = Leaf.map(containerRef.current, {
          center: [26.20, 93.80],
          zoom: 8,
          zoomControl: true,
          attributionControl: true,
        })
        mapRef.current = map
        setMapInstance(map)

        // Use high-performance Esri Dark Gray Canvas tiles (reliable, dark theme)
        const darkTiles = Leaf.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
          attribution: '&copy; Esri, HERE, Garmin, FAO, NOAA, USGS',
          maxZoom: 16,
        }).addTo(map)
        tileLayerRef.current = darkTiles

        setTimeout(() => map.invalidateSize(), 100)
        setTimeout(() => map.invalidateSize(), 300)
        setTimeout(() => map.invalidateSize(), 800)
      } catch (err) {
        console.error('Leaflet init error:', err)
      }
    }

    init()

    const onResize = () => mapRef.current?.invalidateSize()
    window.addEventListener('resize', onResize)

    return () => {
      active = false
      window.removeEventListener('resize', onResize)
      if (mapRef.current) {
        try {
          mapRef.current.remove()
        } catch (e) {}
        mapRef.current = null
      }
      setMapInstance(null)
      if (containerRef.current) {
        containerRef.current._leaflet_id = null
      }
    }
  }, [])

  // Handle Layer Toggle (Dark vs Satellite)
  const toggleMapMode = (mode) => {
    setMapMode(mode)
    const Leaf = getLeaflet()
    const map = mapRef.current
    if (!Leaf || !map) return

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current)
    }

    if (mode === 'satellite') {
      tileLayerRef.current = Leaf.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 18,
      }).addTo(map)
    } else {
      tileLayerRef.current = Leaf.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, HERE, Garmin, FAO, NOAA, USGS',
        maxZoom: 16,
      }).addTo(map)
    }
  }

  // Update habitation markers
  useEffect(() => {
    const Leaf = getLeaflet()
    const map = mapInstance || mapRef.current
    if (!Leaf || !map) return

    map.invalidateSize()

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    zones.forEach(zone => {
      const color  = RISK_COLORS[zone.classification] || '#94a3b8'
      const radius = markerRadius(zone.population)
      const isSelected = zone.habitation_id === selectedId

      const circle = Leaf.circleMarker([zone.lat, zone.lon], {
        radius,
        color: isSelected ? '#ffffff' : color,
        weight: isSelected ? 3 : 1.5,
        opacity: 1,
        fillColor: color,
        fillOpacity: 0.85,
        className: zone.classification === 'immediate' ? 'animate-risk-pulse' : '',
      })
        .bindPopup(popupHTML(zone), { maxWidth: 280 })
        .on('click', () => onSelect && onSelect(zone.habitation_id))
        .addTo(map)

      markersRef.current.push(circle)
    })

    if (!selectedId && zones.length > 0) {
      try {
        const validCoords = zones.filter(z => z.lat && z.lon).map(z => [z.lat, z.lon])
        if (validCoords.length > 0) {
          const bounds = Leaf.latLngBounds(validCoords)
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 11 })
        }
      } catch (err) {}
    }
  }, [mapInstance, zones, selectedId])

  // Update site markers (diamond icons)
  useEffect(() => {
    const Leaf = getLeaflet()
    const map = mapInstance || mapRef.current
    if (!Leaf || !map) return

    siteMarksRef.current.forEach(m => m.remove())
    siteMarksRef.current = []

    sites.forEach(site => {
      if (!site.lat || !site.lon) return
      const score = site.capacity_score || 0
      const blue  = `hsl(${200 + score * 40},85%,${52 + score * 15}%)`
      const icon  = Leaf.divIcon({
        html: `<div style="width:12px;height:12px;background:${blue};border:2px solid rgba(255,255,255,0.8);transform:rotate(45deg);box-shadow:0 0 8px ${blue}"></div>`,
        className: '',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      })
      const marker = Leaf.marker([site.lat, site.lon], { icon })
        .bindPopup(sitePopupHTML(site), { maxWidth: 240 })
        .addTo(map)
      siteMarksRef.current.push(marker)
    })
  }, [mapInstance, sites])

  // Pan to selected habitation
  useEffect(() => {
    const map = mapInstance || mapRef.current
    if (!map || !selectedId || !zones.length || route) return
    const zone = zones.find(z => z.habitation_id === selectedId)
    if (zone) map.panTo([zone.lat, zone.lon], { animate: true, duration: 0.8 })
  }, [mapInstance, selectedId, zones, route])

  // Draw Route
  useEffect(() => {
    const Leaf = getLeaflet()
    const map = mapInstance || mapRef.current
    if (!Leaf || !map) return

    if (routeLineRef.current) {
      routeLineRef.current.remove()
      routeLineRef.current = null
    }

    if (route && route.coordinates && route.coordinates.length > 0) {
      routeLineRef.current = Leaf.polyline(route.coordinates, {
        color: route.color || '#3b82f6',
        weight: 4,
        opacity: 0.8,
        dashArray: '8, 8',
        lineCap: 'round',
      }).addTo(map)

      map.fitBounds(routeLineRef.current.getBounds(), { padding: [80, 80], maxZoom: 12 })
    }
  }, [mapInstance, route])

  return (
    <div className="relative flex-1 min-h-0 h-full w-full bg-[#090d16]" style={{ minHeight: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full"
        id="hazard-map"
        style={{ width: '100%', height: '100%', zIndex: 1 }}
      />

      {/* Live Situation HUD */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] hidden md:flex items-center gap-4 px-6 py-2.5 rounded-full border border-white/[0.08] bg-slate-950/85 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2 border-r border-white/10 pr-4">
          <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider">River Level</span>
          <span className="text-xs font-bold text-red-400">↑ +1.8m</span>
        </div>
        <div className="flex items-center gap-2 border-r border-white/10 pr-4">
          <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider">Rainfall</span>
          <span className="text-xs font-bold text-blue-400">142 mm / 24h</span>
        </div>
        <div className="flex items-center gap-2 border-r border-white/10 pr-4">
          <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider">Erosion</span>
          <span className="text-xs font-bold text-orange-400">HIGH</span>
        </div>
        <div className="flex items-center gap-2 border-r border-white/10 pr-4">
          <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider">Road Access</span>
          <span className="text-xs font-bold text-emerald-400">82%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider">Confidence</span>
          <span className="text-xs font-bold text-slate-200">91%</span>
        </div>
      </div>

      {/* Layer Switcher & Map Controls */}
      <div className="absolute top-4 left-4 z-[500] flex flex-col gap-2">
        <div className="flex flex-col p-1.5 rounded-xl bg-slate-950/85 border border-white/[0.08] backdrop-blur-xl shadow-[0_4px_16px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] w-36">
          {['RISK', 'FLOOD DEPTH', 'EROSION', 'POPULATION', 'ROADS'].map(layer => (
            <button
              key={layer}
              onClick={() => setActiveLayer(layer)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-left transition-all ${
                activeLayer === layer
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
            >
              {layer}
            </button>
          ))}
        </div>

        {/* Basemap Toggle */}
        <div className="flex flex-col p-1.5 rounded-xl bg-slate-950/85 border border-white/[0.08] backdrop-blur-xl shadow-lg w-36">
          <button
            onClick={() => toggleMapMode('dark')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-left transition-all ${
              mapMode === 'dark'
                ? 'bg-blue-600/20 text-blue-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            Tactical Dark
          </button>
          <button
            onClick={() => toggleMapMode('satellite')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-left transition-all ${
              mapMode === 'satellite'
                ? 'bg-blue-600/20 text-blue-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            Satellite
          </button>
        </div>
      </div>

      {/* Liquid Glass Risk Legend */}
      <div className="absolute bottom-6 left-5 z-[500] p-3.5 rounded-xl border border-white/[0.08] bg-slate-950/85 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] min-w-[160px]">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 font-mono">
          Flood & Erosion Severity
        </div>
        <div className="space-y-1.5">
          {Object.entries(RISK_COLORS).map(([cls, color]) => (
            <div key={cls} className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  backgroundColor: color,
                  boxShadow: cls === 'immediate' ? `0 0 6px ${color}` : 'none',
                }}
              />
              <span className="text-xs font-medium text-slate-300 capitalize">
                {cls.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-2.5 border-t border-white/[0.08] flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-blue-500 rotate-45 shadow-[0_0_6px_rgba(59,130,246,0.6)]" />
          <span className="text-xs font-medium text-slate-300">High-Ground Safe Parcel</span>
        </div>
      </div>
    </div>
  )
}
