// src/pages/CommandCenter.jsx
// ============================================================================
// REDZONE — Command Center
// "What is happening now?"
//
// Layout: Map (primary) + right panel with contextual intelligence.
// The panel is driven entirely by AppStore — no hardcoded locations.
//
// If no area: shows prompt to search.
// If area with no data: shows honest coverage note.
// If area with data: shows live risk summary, priority queue, data health.
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../context/AppStore'
import { api } from '../api/client'
import HazardMap from '../components/HazardMap'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CLF_META = {
  immediate:   { label: 'IMMEDIATE',   bg: 'bg-red-500/10',    border: 'border-red-500/30',    text: 'text-red-400',    dot: 'bg-red-400'    },
  short_term:  { label: 'SHORT TERM',  bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', dot: 'bg-orange-400' },
  medium_term: { label: 'MED TERM',    bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  text: 'text-amber-400',  dot: 'bg-amber-400'  },
  stable:      { label: 'STABLE',      bg: 'bg-emerald-500/10',border: 'border-emerald-500/30',text: 'text-emerald-400',dot: 'bg-emerald-400' },
}

function DataStatus({ label, className = '' }) {
  return (
    <span className={`inline-block text-[8px] font-bold uppercase tracking-widest font-mono px-1.5 py-0.5 rounded border ${className}`}>
      {label}
    </span>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2 font-mono px-4 pt-3">
      {children}
    </div>
  )
}

// ── Zone row ─────────────────────────────────────────────────────────────────

function ZoneRow({ zone, selected, onClick }) {
  const m = CLF_META[zone.classification] ?? CLF_META.stable
  const score = zone.hazard_score != null ? Math.round(zone.hazard_score * 100) : null
  return (
    <button
      onClick={() => onClick(zone)}
      className={`w-full text-left flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-0 transition-all ${
        selected ? 'bg-blue-600/10' : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${m.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-200 truncate">{zone.name}</div>
        {zone.district && (
          <div className="text-[10px] text-slate-600 truncate">{zone.district}</div>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        {score != null && (
          <span className={`font-mono text-sm font-extrabold ${m.text}`}>{score}</span>
        )}
        <span className={`text-[8px] font-bold font-mono ${m.text}`}>{m.label}</span>
      </div>
      <div className="text-[10px] text-slate-600 font-mono shrink-0 w-12 text-right">
        {zone.population?.toLocaleString() ?? '—'}
      </div>
    </button>
  )
}

// ── Stat block ────────────────────────────────────────────────────────────────

function StatBlock({ label, value, sub, valueClass = 'text-white' }) {
  return (
    <div className="p-3 border-r border-white/[0.04] last:border-0 flex-1">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1 font-mono">{label}</div>
      <div className={`text-xl font-extrabold font-mono tabular-nums leading-none ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Empty states ──────────────────────────────────────────────────────────────

function NoAreaState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <div className="w-10 h-10 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-600">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </div>
      <div className="text-sm font-semibold text-slate-400">No area selected</div>
      <div className="text-[11px] text-slate-600 max-w-xs leading-relaxed">
        Use the search bar (⌘K) to select a district or region. REDZONE will load available hazard intelligence and risk data.
      </div>
    </div>
  )
}

function NoCoverageState({ area }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <div className="text-sm font-semibold text-slate-400">No data for {area.name}</div>
      <div className="text-[11px] text-slate-600 max-w-xs leading-relaxed">
        REDZONE does not hold habitation or site records for this area.
        The platform currently covers select pilot districts.
      </div>
      <DataStatus label="DATA STATUS: UNAVAILABLE" className="border-amber-500/30 text-amber-500 bg-amber-500/5" />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CommandCenter() {
  const navigate = useNavigate()
  const {
    area, mode, modeMeta, selectedFeature, setSelectedFeature,
  } = useAppStore()

  const [zones,        setZones]        = useState([])
  const [sites,        setSites]        = useState([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [selectedZone, setSelectedZone] = useState(null)

  // Load data when area changes
  useEffect(() => {
    if (!area) { setZones([]); setSites([]); return }

    setLoading(true)
    setError(null)
    setZones([])
    setSites([])

    const params = {
      lat:       area.lat,
      lon:       area.lon,
      radius_km: 100,
    }

    Promise.allSettled([
      api.zones(params),
      api.sites(params),
    ]).then(([zRes, sRes]) => {
      if (zRes.status === 'fulfilled') setZones(zRes.value ?? [])
      else setError('Hazard data unavailable')

      if (sRes.status === 'fulfilled') setSites(sRes.value ?? [])
    }).finally(() => setLoading(false))
  }, [area])

  const handleZoneSelect = useCallback((zone) => {
    setSelectedZone(zone.habitation_id)
    setSelectedFeature({ ...zone, featureType: 'habitation' })
  }, [setSelectedFeature])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const immediate   = zones.filter(z => z.classification === 'immediate').length
  const short_term  = zones.filter(z => z.classification === 'short_term').length
  const totalPop    = zones.reduce((s, z) => s + (z.population ?? 0), 0)
  const siteCap     = sites.reduce((s, s2) => s + (s2.available_capacity ?? 0), 0)

  const priorityList = [...zones]
    .sort((a, b) => (b.urgency_score ?? 0) - (a.urgency_score ?? 0))
    .slice(0, 25)

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">

      {/* ── Map (primary surface) ─── */}
      <div className="flex-1 min-w-0 relative">
        <HazardMap
          zones={zones}
          sites={sites}
          onZoneSelect={id => {
            const z = zones.find(z => z.habitation_id === id)
            if (z) handleZoneSelect(z)
          }}
        />
      </div>

      {/* ── Right intelligence panel ─── */}
      <div className="w-72 shrink-0 flex flex-col border-l border-white/[0.10] bg-[#0b0f1a] overflow-hidden">

        {/* Panel header */}
        <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono">SITUATIONAL OVERVIEW</span>
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[8px] font-bold uppercase font-mono ${modeMeta.bgClass} ${modeMeta.borderClass} ${modeMeta.textClass}`}>
              <span className={`w-1 h-1 rounded-full ${modeMeta.dotClass} ${mode === 'LIVE' ? 'animate-pulse' : ''}`} />
              {modeMeta.label}
            </div>
          </div>
          {area && (
            <div className="text-xs font-bold text-slate-200 mt-1 truncate">{area.name}</div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* No area */}
          {!area && <NoAreaState />}

          {/* Area with no zone data — show informational note, don't block */}
          {area && !loading && zones.length === 0 && !error && (
            <div className="px-4 py-3 border-b border-white/[0.04]">
              <div className="text-[10px] text-amber-400/80 font-mono">
                No REDZONE zone data for {area.name}.
              </div>
              <div className="text-[9px] text-slate-600 mt-1">
                Location found — REDZONE coverage unavailable for this area.
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="p-4 space-y-3">
              {[1,2,3,4].map(i => (
                <div key={i} className="flex gap-3">
                  <div className="w-2 h-2 rounded-full mt-1 shimmer bg-white/[0.04]" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded shimmer bg-white/[0.04]" />
                    <div className="h-2 w-20 rounded shimmer bg-white/[0.04]" />
                  </div>
                  <div className="h-4 w-8 rounded shimmer bg-white/[0.04]" />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 text-center">
              <div className="text-sm text-red-400 mb-1">Data unavailable</div>
              <div className="text-[11px] text-slate-600">{error}</div>
            </div>
          )}

          {/* Data loaded */}
          {!loading && zones.length > 0 && (
            <>
              {/* Summary stats */}
              <div className="border-b border-white/[0.06] shrink-0">
                <div className="flex">
                  <StatBlock
                    label="IMMEDIATE"
                    value={immediate}
                    valueClass={immediate > 0 ? 'text-red-400' : 'text-emerald-400'}
                  />
                  <StatBlock
                    label="SHORT TERM"
                    value={short_term}
                    valueClass={short_term > 0 ? 'text-orange-400' : 'text-emerald-400'}
                  />
                </div>
                <div className="flex border-t border-white/[0.04]">
                  <StatBlock
                    label="EXPOSED POP"
                    value={totalPop > 0 ? `${(totalPop/1000).toFixed(1)}K` : '—'}
                    sub="MODELLED"
                  />
                  <StatBlock
                    label="SITE CAPACITY"
                    value={siteCap > 0 ? `${(siteCap/1000).toFixed(1)}K` : '—'}
                    sub="AVAILABLE"
                  />
                </div>
              </div>

              {/* Data status note */}
              <div className="px-4 py-2 border-b border-white/[0.04]">
                <div className="text-[9px] text-slate-600 font-mono leading-relaxed">
                  Risk scores: <span className="text-slate-500">MODELLED</span> · Population: <span className="text-slate-500">STATIC</span> · Live signals from Open-Meteo / USGS
                </div>
              </div>

              {/* Priority queue */}
              <SectionLabel>PRIORITY QUEUE — {zones.length} ZONES</SectionLabel>

              {priorityList.map(zone => (
                <ZoneRow
                  key={zone.habitation_id}
                  zone={zone}
                  selected={selectedZone === zone.habitation_id}
                  onClick={handleZoneSelect}
                />
              ))}

              {zones.length === 0 && (
                <div className="px-4 py-6 text-center text-[11px] text-slate-600">
                  No active priorities for this area
                </div>
              )}
            </>
          )}
        </div>

        {/* Action footer */}
        {zones.length > 0 && (
          <div className="shrink-0 p-3 border-t border-white/[0.06] space-y-2">
            <button
              onClick={() => navigate('/hazard')}
              className="w-full py-2 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/20 transition-all"
            >
              Hazard Intelligence →
            </button>
            <button
              onClick={() => navigate('/planner')}
              className="w-full py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 text-xs font-bold uppercase tracking-wider border border-white/[0.06] transition-all"
            >
              Plan Relocation →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}