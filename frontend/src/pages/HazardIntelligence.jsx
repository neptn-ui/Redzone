// src/pages/HazardIntelligence.jsx
// ============================================================================
// REDZONE — Hazard Intelligence
// "What is happening? Where? Why? Who is exposed? What is getting worse?"
//
// Map-left + intelligence panel right.
// Reads explanation_json from backend for each zone.
// Shows risk factor breakdown — no duplicate scoring in frontend.
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../context/AppStore'
import { api } from '../api/client'
import HazardMap from '../components/HazardMap'

// ── Component factor breakdown ────────────────────────────────────────────────

const FACTOR_META = [
  { key: 'hazard_intensity',      label: 'Hazard Intensity',    weight: '30%', desc: 'Direct intensity of the hazard source'   },
  { key: 'frequency_history',     label: 'Historical Frequency',weight: '20%', desc: 'Event frequency in historical records'   },
  { key: 'terrain_vulnerability', label: 'Terrain Vulnerability',weight: '15%', desc: 'Slope, geomorphology, soil type'         },
  { key: 'proximity',             label: 'Hazard Proximity',    weight: '15%', desc: 'Distance from hazard source'             },
  { key: 'sar_deformation',       label: 'SAR Deformation',     weight: '10%', desc: 'Ground deformation signal (SAR data)'    },
  { key: 'ndvi_change',           label: 'Vegetation Change',   weight: '10%', desc: 'NDVI change signal (satellite)'          },
]

function RiskBar({ value, label, weight, desc }) {
  const pct = value != null ? Math.round(value * 100) : null
  const color = pct == null ? '#334155'
    : pct >= 75 ? '#ef4444'
    : pct >= 55 ? '#f97316'
    : pct >= 35 ? '#f59e0b'
    : '#22c55e'

  return (
    <div className="py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <span className="text-xs font-semibold text-slate-300">{label}</span>
          <span className="ml-2 text-[9px] text-slate-600 font-mono">w={weight}</span>
        </div>
        <span className="font-mono text-sm font-bold" style={{ color }}>
          {pct != null ? pct : '—'}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
        {pct != null && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="h-full rounded-full"
            style={{ background: color }}
          />
        )}
      </div>
      <div className="text-[9px] text-slate-600 mt-0.5">{desc}</div>
    </div>
  )
}

// ── Zone explanation panel ────────────────────────────────────────────────────

function ZoneExplanation({ zone, explain, loading }) {
  const score = zone?.hazard_score != null ? Math.round(zone.hazard_score * 100) : null
  const clf   = zone?.classification ?? 'unknown'

  const CLF_COLOR = {
    immediate:   'text-red-400',
    short_term:  'text-orange-400',
    medium_term: 'text-amber-400',
    stable:      'text-emerald-400',
  }

  // Backend explanation_json structure:
  // { hazard: { breakdown: { hazard_intensity: { value, weight, contribution }, ... } },
  //   live_trigger_multiplier: number, urgency: {...} }
  const breakdown = explain?.hazard?.breakdown ?? {}

  // Map FACTOR_META keys to breakdown keys
  const KEY_MAP = {
    hazard_intensity:      'hazard_intensity',
    frequency_history:     'frequency_history',
    terrain_vulnerability: 'terrain_vulnerability',
    proximity:             'proximity_to_hazard_source',
    sar_deformation:       'sar_deformation',
    ndvi_change:           'ndvi_change',
  }

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Score header */}
      <div className="p-4 border-b border-white/[0.06]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">HAZARD ANALYSIS</div>
        <div className="flex items-start gap-4">
          <div className="relative">
            <div className={`text-4xl font-extrabold font-mono tabular-nums leading-none ${CLF_COLOR[clf] ?? 'text-slate-400'}`}>
              {score ?? '—'}
            </div>
            <div className="text-[9px] text-slate-600 font-mono mt-1">/ 100</div>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">{zone?.name}</div>
            <div className={`text-xs font-bold uppercase tracking-wider mt-0.5 ${CLF_COLOR[clf]}`}>
              {clf.replace(/_/g, ' ')}
            </div>
            {zone?.district && <div className="text-[10px] text-slate-600 mt-0.5">{zone.district}</div>}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[8px] font-bold uppercase tracking-widest font-mono px-2 py-0.5 rounded border text-blue-400 border-blue-500/30 bg-blue-500/5">MODELLED</span>
        {explain?.hazard?.live_trigger_multiplier > 1 && (
            <span className="text-[8px] font-bold uppercase tracking-widest font-mono px-2 py-0.5 rounded border text-amber-400 border-amber-500/30 bg-amber-500/5">
              LIVE SIGNAL ×{explain.hazard.live_trigger_multiplier?.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Factor breakdown */}
      <div className="p-4 border-b border-white/[0.06] overflow-y-auto">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-3">CONTRIBUTING FACTORS</div>

        {loading && (
          <div className="space-y-3">
            {FACTOR_META.map(f => (
              <div key={f.key} className="space-y-1.5">
                <div className="h-3 w-32 rounded shimmer bg-white/[0.04]" />
                <div className="h-1.5 w-full rounded shimmer bg-white/[0.04]" />
              </div>
            ))}
          </div>
        )}

        {!loading && FACTOR_META.map(f => (
          <RiskBar
            key={f.key}
            value={breakdown[KEY_MAP[f.key]]?.value ?? null}
            label={f.label}
            weight={f.weight}
            desc={f.desc}
          />
        ))}

        {!loading && Object.keys(breakdown).length === 0 && (
          <div className="text-[11px] text-slate-600 italic">
            {explain === null
              ? 'Select a zone to load its analysis.'
              : 'Detailed breakdown unavailable — backend explanation not returned.'}
          </div>
        )}
      </div>

      {/* Recommendation */}
      {explain?.recommendation && (
        <div className="p-4 border-b border-white/[0.06]">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">RECOMMENDED ACTION</div>
          <div className="text-xs text-slate-300 leading-relaxed">{explain.recommendation}</div>
        </div>
      )}

      {/* Population */}
      <div className="p-4">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">EXPOSURE</div>
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xl font-extrabold font-mono text-white tabular-nums">
              {zone?.population?.toLocaleString() ?? '—'}
            </div>
            <div className="text-[9px] text-slate-600 font-mono">ESTIMATED POPULATION · STATIC</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Zone list row ─────────────────────────────────────────────────────────────

function ZoneListRow({ zone, selected, onClick }) {
  const score = zone.hazard_score != null ? Math.round(zone.hazard_score * 100) : null
  const colors = {
    immediate:   'bg-red-500/10 text-red-400 border-red-500/20',
    short_term:  'bg-orange-500/10 text-orange-400 border-orange-500/20',
    medium_term: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    stable:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  }
  return (
    <button
      onClick={() => onClick(zone)}
      className={`w-full text-left flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.04] last:border-0 transition-all ${
        selected ? 'bg-blue-600/10' : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-200 truncate">{zone.name}</div>
        {zone.district && <div className="text-[10px] text-slate-600 truncate">{zone.district}</div>}
      </div>
      <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded border font-mono ${colors[zone.classification] ?? colors.stable}`}>
        {score ?? '—'}
      </div>
    </button>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function HazardIntelligence() {
  const navigate    = useNavigate()
  const { area, setSelectedFeature } = useAppStore()

  const [zones,       setZones]       = useState([])
  const [sites,       setSites]       = useState([])
  const [loading,     setLoading]     = useState(false)
  const [selectedZone,setSelectedZone]= useState(null)
  const [explain,     setExplain]     = useState(null)
  const [explainLoad, setExplainLoad] = useState(false)
  const [classFilter, setClassFilter] = useState(null)

  useEffect(() => {
    if (!area) { setZones([]); setSites([]); return }
    setLoading(true)
    const params = { lat: area.lat, lon: area.lon, radius_km: 100 }
    Promise.allSettled([api.zones(params), api.sites(params)]).then(([z, s]) => {
      if (z.status === 'fulfilled') setZones(z.value ?? [])
      if (s.status === 'fulfilled') setSites(s.value ?? [])
    }).finally(() => setLoading(false))
  }, [area])

  const handleSelectZone = useCallback(async (zone) => {
    setSelectedZone(zone)
    setSelectedFeature({ ...zone, featureType: 'habitation' })
    setExplain(null)
    setExplainLoad(true)
    try {
      const data = await api.zoneExplain(zone.habitation_id)
      setExplain(data)
    } catch {
      setExplain(null)
    } finally {
      setExplainLoad(false)
    }
  }, [setSelectedFeature])

  const filtered = classFilter
    ? zones.filter(z => z.classification === classFilter)
    : zones

  const sorted = [...filtered].sort((a, b) => (b.hazard_score ?? 0) - (a.hazard_score ?? 0))

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">

      {/* Zone list */}
      <div className="w-60 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#0b0f1a]/95 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-white/[0.06] shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono">RISK ZONES</div>
          {area && <div className="text-[10px] text-slate-600 mt-0.5 truncate">{area.name}</div>}
        </div>

        {/* Filter */}
        <div className="flex gap-1 p-2 border-b border-white/[0.04] shrink-0 flex-wrap">
          {[null, 'immediate', 'short_term', 'stable'].map(f => (
            <button
              key={String(f)}
              onClick={() => setClassFilter(f)}
              className={`px-2 py-0.5 rounded text-[8px] font-bold font-mono uppercase transition-all border ${
                classFilter === f ? 'bg-white/[0.08] border-white/[0.15] text-slate-200' : 'border-white/[0.06] text-slate-600 hover:text-slate-400'
              }`}
            >
              {f?.replace(/_/g, ' ') ?? 'ALL'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {!area && (
            <div className="p-4 text-center text-[11px] text-slate-600 italic">Select an area to load zones</div>
          )}
          {loading && <div className="p-3 space-y-2">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex gap-2">
                <div className="flex-1 h-3 rounded shimmer bg-white/[0.04]" />
                <div className="w-8 h-3 rounded shimmer bg-white/[0.04]" />
              </div>
            ))}
          </div>}
          {!loading && sorted.map(z => (
            <ZoneListRow
              key={z.habitation_id}
              zone={z}
              selected={selectedZone?.habitation_id === z.habitation_id}
              onClick={handleSelectZone}
            />
          ))}
          {!loading && !area && null}
          {!loading && area && zones.length === 0 && (
            <div className="p-4 text-center text-[11px] text-slate-600">No zones in this area</div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-w-0 relative">
        <HazardMap
          zones={zones}
          sites={sites}
          onZoneSelect={id => {
            const z = zones.find(z => z.habitation_id === id)
            if (z) handleSelectZone(z)
          }}
        />
      </div>

      {/* Explanation panel */}
      <AnimatePresence>
        {selectedZone && (
          <motion.div
            key="hazard-explain"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 150, damping: 22 }}
            className="w-72 shrink-0 flex flex-col border-l border-white/[0.10] bg-[#0b0f1a] overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono">ZONE INTELLIGENCE</span>
              <button
                onClick={() => { setSelectedZone(null); setExplain(null) }}
                className="text-slate-600 hover:text-slate-300 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              <ZoneExplanation zone={selectedZone} explain={explain} loading={explainLoad} />
            </div>
            <div className="p-3 border-t border-white/[0.06] shrink-0">
              <button
                onClick={() => navigate('/planner')}
                className="w-full py-2 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/20 transition-all"
              >
                Plan Relocation →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
