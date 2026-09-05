// src/pages/SafeSiteIntelligence.jsx
// ============================================================================
// REDZONE — Safe Site Intelligence
// "Where can people go? How do they get there?"
//
// Site suitability explained factorially (backend capacity_engine output).
// Routing: real OSRM or honest "ROUTING UNAVAILABLE".
// No hardcoded origin (Bethukandi or otherwise).
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../context/AppStore'
import { api } from '../api/client'
import { getRoute } from '../api/geo'
import HazardMap from '../components/HazardMap'

// ── Capacity factor breakdown ────────────────────────────────────────────────

const CAP_FACTORS = [
  { key: 'land_availability',  label: 'Land Availability', weight: '30%', desc: 'Available land area (NBC 2016 min 9.5m²/person)' },
  { key: 'slope_safety',       label: 'Slope Safety',      weight: '25%', desc: 'Terrain gradient — safe habitation threshold <20°' },
  { key: 'infra_proximity',    label: 'Infrastructure',    weight: '20%', desc: 'Proximity to road network (<5km = full score)' },
  { key: 'water_access',       label: 'Water Access',      weight: '15%', desc: 'Distance to water source (<5km = full score)' },
  { key: 'load_headroom',      label: 'Load Headroom',     weight: '10%', desc: '1 − current occupancy ratio' },
]

function CapBar({ factor, value, contribution }) {
  const pct = value != null ? Math.round(value * 100) : null
  const contribPct = contribution != null ? (contribution * 100).toFixed(1) : null
  const color = pct == null ? '#334155'
    : pct >= 70 ? '#22c55e'
    : pct >= 45 ? '#f59e0b'
    : '#ef4444'

  return (
    <div className="py-2 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="text-[11px] font-semibold text-slate-300">{factor.label}</span>
          <span className="ml-2 text-[9px] text-slate-600 font-mono">w={factor.weight}</span>
        </div>
        <div className="flex items-center gap-2">
          {contribPct != null && (
            <span className="text-[10px] text-slate-500 font-mono">+{contribPct}%</span>
          )}
          <span className="font-mono text-sm font-bold" style={{ color }}>
            {pct != null ? `${pct}%` : (
              <span className="text-[9px] text-slate-600 font-normal">UNAVAIL</span>
            )}
          </span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
        {pct != null && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5 }}
            className="h-full rounded-full"
            style={{ background: color }}
          />
        )}
      </div>
      <div className="text-[9px] text-slate-600 mt-0.5">{factor.desc}</div>
    </div>
  )
}

// ── Site card ─────────────────────────────────────────────────────────────────

function SiteCard({ site, selected, onClick }) {
  const score = site.capacity_score != null ? Math.round(site.capacity_score * 100) : null
  const cap   = site.available_capacity ?? null
  return (
    <button
      onClick={() => onClick(site)}
      className={`w-full text-left p-3 border-b border-white/[0.04] last:border-0 transition-all ${
        selected ? 'bg-blue-600/10' : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="text-xs font-semibold text-slate-200 truncate flex-1">{site.name}</div>
        <div className="shrink-0 font-mono text-sm font-bold text-blue-400">
          {score != null ? `${score}%` : '—'}
        </div>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-slate-600 font-mono">
        <span>Cap: {cap?.toLocaleString() ?? '—'}</span>
        {site.distance_to_road_km != null && <span>Road: {site.distance_to_road_km}km</span>}
        {site.slope_degrees != null && <span>Slope: {site.slope_degrees}°</span>}
      </div>
      <div className="text-[10px] text-slate-600 mt-0.5 truncate">{site.district}</div>
    </button>
  )
}

// ── Route panel ───────────────────────────────────────────────────────────────

function RoutePanel({ origin, destination, route, routeStatus }) {
  if (!origin) {
    return (
      <div className="p-4 text-center">
        <div className="text-[11px] text-slate-600">Select an origin (habitation zone) to compute route</div>
        <div className="text-[9px] text-slate-700 mt-1 font-mono">Click a zone on the map or set from the Planner</div>
      </div>
    )
  }

  if (routeStatus === 'loading') {
    return (
      <div className="p-4 text-center">
        <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin mx-auto mb-2" />
        <div className="text-[11px] text-slate-500">Computing road route via OSRM...</div>
      </div>
    )
  }

  if (routeStatus === 'unavailable' || (routeStatus === 'ready' && (!route || !route.routes?.length))) {
    return (
      <div className="p-4 text-center">
        <div className="text-xs font-bold text-amber-400 mb-1">ROUTING UNAVAILABLE</div>
        <div className="text-[11px] text-slate-600 leading-relaxed">
          OSRM road routing could not find a valid route between these points.
          No straight-line fallback is shown — that would be fabricated intelligence.
        </div>
      </div>
    )
  }

  if (!route || !route.routes?.length) return null

  const r = route.routes[0]
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono">ROAD ROUTE</span>
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded border text-blue-400 border-blue-500/30 bg-blue-500/5 font-mono">OSRM</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
          <div className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">Distance</div>
          <div className="text-sm font-extrabold font-mono text-white">{r.distanceKm} km</div>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
          <div className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">ETA</div>
          <div className="text-sm font-extrabold font-mono text-white">{r.durationFormatted}</div>
        </div>
      </div>
      <div className="text-[9px] text-slate-700 font-mono">
        Route via road network · OSRM routing engine · No hazard assessment applied
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SafeSiteIntelligence() {
  const { area, selectedOrigin, setSelectedSite, selectedSite, setRoute, route, routeStatus, setRouteStatus } = useAppStore()

  const [sites,        setSites]        = useState([])
  const [zones,        setZones]        = useState([])
  const [loading,      setLoading]      = useState(false)
  const [selectedLocal,setSelectedLocal]= useState(null)
  const [siteDetail,   setSiteDetail]   = useState(null)
  const [detailLoad,   setDetailLoad]   = useState(false)

  const handleSelectSite = useCallback(async (site) => {
    if (!site) return
    setSelectedLocal(site)
    setSelectedSite(site)
    setSiteDetail(null)
    setDetailLoad(true)

    // Load detail
    try {
      const siteId = site.site_id ?? site.id
      const detail = await api.site(siteId)
      setSiteDetail(detail)
    } catch {
      setSiteDetail(null)
    } finally {
      setDetailLoad(false)
    }

    // Compute route if origin is known
    if (selectedOrigin?.lat && selectedOrigin?.lon && site.lat && site.lon) {
      setRouteStatus('loading')
      const result = await getRoute(selectedOrigin, site)
      if (result.status === 'ok') {
        setRoute(result)
      } else {
        setRouteStatus('unavailable')
      }
    }
  }, [selectedOrigin, setSelectedSite, setRoute, setRouteStatus])

  useEffect(() => {
    if (!area) { setSites([]); setZones([]); return }
    setLoading(true)
    const params = { lat: area.lat, lon: area.lon, radius_km: 150 }
    Promise.allSettled([api.sites(params), api.zones(params)]).then(([s, z]) => {
      const siteList = s.status === 'fulfilled' ? (s.value ?? []) : []
      if (s.status === 'fulfilled') setSites(siteList)
      if (z.status === 'fulfilled') setZones(z.value ?? [])

      // Auto-select initial site if none selected
      if (siteList.length > 0) {
        const initial = siteList.find(x => (x.site_id ?? x.id) === (selectedSite?.site_id ?? selectedSite?.id)) || siteList[0]
        handleSelectSite(initial)
      }
    }).finally(() => setLoading(false))
  }, [area, handleSelectSite, selectedSite?.site_id, selectedSite?.id])

  const capacityObj = siteDetail?.capacity_breakdown ?? {}
  const breakdown = capacityObj?.breakdown ?? capacityObj
  const score = selectedLocal?.capacity_score != null ? Math.round(selectedLocal.capacity_score * 100) : null

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">

      {/* Site list */}
      <div className="w-60 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#0b0f1a]/95 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-white/[0.06] shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono">CANDIDATE SITES</div>
          {area && <div className="text-[10px] text-slate-600 mt-0.5 truncate">{area.name}</div>}
        </div>

        {/* Origin hint */}
        <div className="px-3 py-2 border-b border-white/[0.04] shrink-0">
          <div className="text-[9px] text-slate-600 font-mono">
            Origin: {selectedOrigin?.name
              ? <span className="text-slate-400 font-bold">{selectedOrigin.name}</span>
              : <span className="text-slate-700 italic">Not set — no routing</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {!area && (
            <div className="p-4 text-center text-[11px] text-slate-600 italic">Select an area to load sites</div>
          )}
          {loading && <div className="p-3 space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-14 rounded shimmer bg-white/[0.04]" />)}
          </div>}
          {!loading && sites.length === 0 && area && (
            <div className="p-4 text-center text-[11px] text-slate-600">
              No candidate sites in this area
            </div>
          )}
          {!loading && sites.map(site => (
            <SiteCard
              key={site.site_id}
              site={site}
              selected={selectedLocal?.site_id === site.site_id}
              onClick={handleSelectSite}
            />
          ))}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-w-0 relative">
        <HazardMap
          zones={zones}
          sites={sites}
          route={route?.routes?.[0] ?? null}
        />
      </div>

      {/* Site detail panel */}
      <AnimatePresence>
        {selectedLocal && (
          <motion.div
            key="site-detail"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 150, damping: 22 }}
            className="w-72 shrink-0 flex flex-col border-l border-white/[0.12] bg-[#0b0f1a] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono">SITE INTELLIGENCE</span>
              <button
                onClick={() => { setSelectedLocal(null); setSelectedSite(null) }}
                className="text-slate-600 hover:text-slate-300 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Score */}
              <div className="p-4 border-b border-white/[0.06]">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">SUITABILITY SCORE</div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="text-3xl font-extrabold font-mono text-blue-400 tabular-nums">
                    {score != null ? `${score}%` : '—'}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-200">{selectedLocal.name}</div>
                    <div className="text-[10px] text-slate-600">{selectedLocal.district}</div>
                  </div>
                </div>
                <div className="text-[8px] font-bold uppercase tracking-widest font-mono px-2 py-0.5 rounded border text-blue-400 border-blue-500/30 bg-blue-500/5 inline-block">
                  MODELLED — NBC 2016 capacity formula
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 border-b border-white/[0.06]">
                {[
                  { label: 'CAPACITY', value: selectedLocal.available_capacity?.toLocaleString() ?? '—' },
                  { label: 'SLOPE',    value: selectedLocal.slope_degrees != null ? `${selectedLocal.slope_degrees}°` : '—' },
                  { label: 'ROAD',     value: selectedLocal.distance_to_road_km != null ? `${selectedLocal.distance_to_road_km}km` : '—' },
                ].map(s => (
                  <div key={s.label} className="p-2 border-r border-white/[0.04] last:border-0 text-center">
                    <div className="text-[8px] text-slate-600 font-mono uppercase tracking-wider">{s.label}</div>
                    <div className="text-sm font-extrabold font-mono text-white">{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Capacity breakdown */}
              <div className="p-4 border-b border-white/[0.06]">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-3">CAPACITY BREAKDOWN</div>
                {detailLoad && <div className="space-y-3">
                  {CAP_FACTORS.map(f => <div key={f.key} className="h-8 rounded shimmer bg-white/[0.04]" />)}
                </div>}
                {!detailLoad && CAP_FACTORS.map(f => {
                  const factorData = breakdown[f.key]
                  const val = factorData?.value ?? factorData?.normalized ?? (typeof factorData === 'number' ? factorData : null)
                  const contrib = factorData?.contribution ?? null
                  return (
                    <CapBar
                      key={f.key}
                      factor={f}
                      value={val}
                      contribution={contrib}
                    />
                  )
                })}
                {!detailLoad && Object.keys(breakdown).length === 0 && (
                  <div className="text-[10px] text-slate-600 italic">
                    Breakdown unavailable — connect backend to load.
                  </div>
                )}
                {capacityObj.notes && capacityObj.notes.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-white/[0.04] space-y-1">
                    <div className="text-[8px] font-bold uppercase tracking-widest text-slate-500 font-mono">CALIBRATION AUDIT</div>
                    {capacityObj.notes.slice(0, 3).map((note, idx) => (
                      <div key={idx} className="text-[9px] text-slate-500 font-mono truncate">
                        • {note}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 text-[9px] text-slate-700 font-mono">
                  Calibration: pilot model assumptions — see capacity_engine.py
                </div>
              </div>

              {/* Route */}
              <div className="border-b border-white/[0.06]">
                <div className="px-4 pt-3 pb-0 text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono">ROUTE</div>
                <RoutePanel
                  origin={selectedOrigin}
                  destination={selectedLocal}
                  route={route}
                  routeStatus={routeStatus}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
