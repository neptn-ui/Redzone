// src/pages/CommandCenter.jsx
// ============================================================================
// REDZONE — Command Center
// "What is happening now?"
//
// Layout:
//   TOP:   Single visible decision flow (§6.1)
//   LEFT:  Map (primary surface) with interactive zones & sites
//   RIGHT: Contextual intelligence panel + RED ZONE first-class card (§2.1) +
//          Permanent habitation status (§1.2) + SDMA decision capture (§6.3)
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

const PERM_META = {
  SUITABLE:    { label: 'HABITATION SUITABLE', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', text: 'text-emerald-300' },
  CONDITIONAL: { label: 'CONDITIONAL HABITATION', bg: 'bg-amber-500/15', border: 'border-amber-500/40', text: 'text-amber-300' },
  UNSUITABLE:  { label: 'UNSUITABLE FOR HABITATION', bg: 'bg-red-500/20', border: 'border-red-500/50', text: 'text-red-300' },
  UNKNOWN:     { label: 'STATUS UNKNOWN', bg: 'bg-slate-800', border: 'border-slate-700', text: 'text-slate-400' },
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
    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-2 font-mono px-4 pt-3">
      {children}
    </div>
  )
}

// ── Decision Flow Bar (§6.1) ──────────────────────────────────────────────────

function DecisionFlowBar({ activeStep = 0, onStepClick }) {
  const steps = [
    { label: 'SEARCH AREA', path: null },
    { label: 'CURRENT HAZARDS', path: '/hazard' },
    { label: 'RED ZONES', path: null },
    { label: 'WHO IS AT RISK', path: null },
    { label: 'WHEN SHOULD THEY MOVE', path: null },
    { label: 'WHERE CAN THEY GO', path: '/planner' },
    { label: 'IS THERE CAPACITY', path: '/planner' },
    { label: 'HOW DO THEY GET THERE', path: '/events' },
    { label: 'RESOURCES NEEDED', path: '/lab' },
    { label: 'SDMA DECISION', path: null },
  ]

  return (
    <div className="w-full bg-[#080c16] border-b border-white/[0.08] px-4 py-2 flex items-center gap-1.5 overflow-x-auto text-[9px] font-mono shrink-0 select-none">
      <span className="text-slate-500 font-bold tracking-wider shrink-0 mr-2">DECISION FLOW (§6.1):</span>
      {steps.map((s, i) => {
        const isCurrent = i === activeStep
        const isPast = i < activeStep
        return (
          <div key={i} className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onStepClick && onStepClick(s, i)}
              className={`px-2 py-0.5 rounded transition-all font-bold ${
                isCurrent
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isPast
                  ? 'bg-blue-900/30 text-blue-300 border border-blue-500/30'
                  : 'text-slate-500 hover:text-slate-300 bg-white/[0.02]'
              }`}
            >
              {i + 1}. {s.label}
            </button>
            {i < steps.length - 1 && (
              <span className="text-slate-700">→</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Zone row ─────────────────────────────────────────────────────────────────

function ZoneRow({ zone, selected, onClick }) {
  const m = CLF_META[zone.classification] ?? CLF_META.stable
  const pStatus = zone.permanent_habitation_status || 'UNKNOWN'
  const pMeta = PERM_META[pStatus] ?? PERM_META.UNKNOWN
  const score = zone.hazard_score != null ? Math.round(zone.hazard_score * 100) : null

  return (
    <button
      onClick={() => onClick(zone)}
      className={`w-full text-left px-4 py-3 border-b border-white/[0.04] last:border-0 transition-all ${
        selected ? 'bg-blue-600/15 border-l-2 border-l-blue-500' : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${m.dot}`} />
          <div className="text-xs font-bold text-slate-200 truncate">{zone.name}</div>
        </div>
        {score != null && (
          <span className={`font-mono text-xs font-extrabold ${m.text}`}>{score}</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
        <span>{zone.district}</span>
        <span>{zone.population?.toLocaleString() ?? '—'} pop</span>
      </div>

      {/* Permanent Habitation Status tag (§1.2) */}
      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        <span className={`text-[8px] font-bold font-mono px-1.5 py-0.2 rounded border ${pMeta.bg} ${pMeta.border} ${pMeta.text}`}>
          {pStatus}
        </span>
        <span className="text-[8px] font-mono px-1 rounded border border-white/[0.06] text-slate-400">
          {zone.current_conditions || 'LIVE'}
        </span>
      </div>
    </button>
  )
}

// ── Stat block ────────────────────────────────────────────────────────────────

function StatBlock({ label, value, sub, valueClass = 'text-white' }) {
  return (
    <div className="p-3 border-r border-white/[0.04] last:border-0 flex-1">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1 font-mono">{label}</div>
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
  const [activeStep,   setActiveStep]   = useState(2) // Defaults to RED ZONES stage
  const [decisionFeedback, setDecisionFeedback] = useState(null)
  const [decisionModal, setDecisionModal] = useState(null) // { type, zone, reason, operator }

  const loadData = useCallback(() => {
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
      if (zRes.status === 'fulfilled' && Array.isArray(zRes.value)) {
        setZones(zRes.value)
        setError(null)
      } else {
        const reason = zRes.reason?.message || 'Hazard data unavailable'
        setError(reason)
      }

      if (sRes.status === 'fulfilled' && Array.isArray(sRes.value)) {
        setSites(sRes.value)
      }
    }).finally(() => setLoading(false))
  }, [area])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleZoneSelect = useCallback((zone) => {
    setSelectedZone(zone)
    setSelectedFeature({ ...zone, featureType: 'habitation' })
    setActiveStep(3) // "WHO IS AT RISK"
  }, [setSelectedFeature])

  const handleDecisionClick = (decisionType, zone) => {
    if (decisionType === 'APPROVE') {
      executeDecision(decisionType, zone, 'Standard SOP relocation recommendation approved.', 'SDMA Duty Commander')
    } else {
      setDecisionModal({
        type: decisionType,
        zone: zone,
        reason: decisionType === 'MODIFY' ? 'Phased intake recommended: prioritize bedridden & elderly households first' : 'Evacuation deferred pending structural embankment reinforcement',
        operator: 'SDMA District Magistrate',
      })
    }
  }

  const executeDecision = async (decisionType, zone, reason, operator) => {
    try {
      await api.recordDecision({
        recommendation_id: `REC-LIVE-${zone.habitation_id}-${Date.now().toString().slice(-4)}`,
        habitation_id: zone.habitation_id,
        habitation_name: zone.name,
        decision: decisionType,
        reason: reason || `SDMA ${decisionType} directive executed for ${zone.name}`,
        operator_name: operator || 'SDMA Commander',
      })
      setDecisionFeedback({ type: decisionType, zoneId: zone.habitation_id, time: new Date().toLocaleTimeString() })
      setDecisionModal(null)
    } catch (e) {
      console.error(e)
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const immediate   = zones.filter(z => z.classification === 'immediate').length
  const short_term  = zones.filter(z => z.classification === 'short_term').length
  const unsuitable  = zones.filter(z => z.permanent_habitation_status === 'UNSUITABLE').length
  const totalPop    = zones.reduce((s, z) => s + (z.population ?? 0), 0)
  const siteCap     = sites.reduce((s, s2) => s + (s2.available_capacity ?? 0), 0)

  const priorityList = [...zones]
    .sort((a, b) => (b.urgency_score ?? 0) - (a.urgency_score ?? 0))
    .slice(0, 25)

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 overflow-hidden">

      {/* ── Single Visible Decision Flow Bar (§6.1) ─── */}
      <DecisionFlowBar
        activeStep={activeStep}
        onStepClick={(step, i) => {
          setActiveStep(i)
          if (step.path) navigate(step.path)
        }}
      />

      {/* Main body: Map + side intelligence panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

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
        <div className="w-80 shrink-0 flex flex-col border-l border-white/[0.10] bg-[#0b0f1a] overflow-hidden">

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

            {/* Area with no zone data (Tier 7.3 honest unseeded representation) */}
            {area && !loading && zones.length === 0 && !error && (
              <div className="p-4 m-3 rounded-xl bg-slate-900/80 border border-white/[0.08] space-y-2.5 font-mono shadow-xl">
                <div className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>LOCATION RESOLVED ✓</span>
                </div>
                <div className="text-xs font-bold text-amber-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  <span>REDZONE SEEDED DATA: NOT AVAILABLE</span>
                </div>
                <div className="text-xs text-slate-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                  <span>EVENT INTELLIGENCE: AVAILABLE (EXTERNAL)</span>
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-600"></span>
                  <span>PERMANENT RELOCATION ANALYSIS: DATA UNAVAILABLE</span>
                </div>
                <div className="text-[10px] text-slate-400 pt-2 border-t border-white/[0.06] font-sans leading-relaxed">
                  Coordinates for <strong className="text-slate-200">{area.display_name || area.name}</strong> resolved via real geocoder. REDZONE does not hold seeded habitation or safe-site records for this unseeded geography.
                </div>
                <button
                  onClick={() => navigate('/events')}
                  className="w-full mt-2 py-2 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 text-xs font-bold uppercase tracking-wider border border-blue-500/30 transition-all font-mono"
                >
                  Query Event Intelligence ({area.display_name || area.name}) →
                </button>
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
                <div className="text-sm text-red-400 mb-1 font-semibold">Data unavailable</div>
                <div className="text-[11px] text-slate-500 mb-3">{error}</div>
                <button
                  onClick={loadData}
                  className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-mono transition-all"
                >
                  Retry Request
                </button>
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
                      label="UNSUITABLE"
                      value={unsuitable}
                      valueClass={unsuitable > 0 ? 'text-red-400' : 'text-slate-400'}
                      sub="PERMANENT"
                    />
                  </div>
                  <div className="flex border-t border-white/[0.04]">
                    <StatBlock
                      label="EXPOSED POP"
                      value={totalPop > 0 ? `${(totalPop/1000).toFixed(1)}K` : '—'}
                      sub="STATIC"
                    />
                    <StatBlock
                      label="SITE CAPACITY"
                      value={siteCap > 0 ? `${(siteCap/1000).toFixed(1)}K` : '—'}
                      sub="AVAILABLE"
                    />
                  </div>
                </div>

                {/* Inspect Selected Zone / RED ZONE card (§2.1) */}
                {selectedZone && (
                  <div className="p-3.5 border-b border-white/[0.08] bg-red-950/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-red-400 font-mono">
                        RED ZONE CARD (§2.1)
                      </span>
                      <button
                        onClick={() => setSelectedZone(null)}
                        className="text-slate-500 hover:text-slate-300 text-xs"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="text-xs font-bold text-white mb-1">{selectedZone.name}</div>
                    <div className="text-[10px] font-mono text-red-300 font-bold mb-2">
                      {selectedZone.permanent_habitation_status} FOR PERMANENT HABITATION
                    </div>

                    <div className="p-2 rounded bg-black/40 border border-white/[0.06] text-[10px] font-mono space-y-1 mb-2">
                      <div className="flex justify-between text-slate-400">
                        <span>Hazard Score:</span>
                        <span className="text-red-400 font-bold">{(selectedZone.hazard_score * 100).toFixed(0)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Horizon:</span>
                        <span className="text-amber-400 font-bold">{selectedZone.relocation_horizon || 'SHORT_TERM'}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Population:</span>
                        <span className="text-white">{selectedZone.population?.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* §6.3 SDMA Decision inside inspector */}
                    <div className="pt-1">
                      <div className="text-[8px] font-bold uppercase font-mono text-slate-500 mb-1.5">
                        SDMA DIRECTIVE (§6.3)
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <button
                          onClick={() => handleDecisionClick('APPROVE', selectedZone)}
                          className="py-1 px-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[9px] font-bold font-mono uppercase"
                        >
                          [ APPROVE ]
                        </button>
                        <button
                          onClick={() => handleDecisionClick('MODIFY', selectedZone)}
                          className="py-1 px-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[9px] font-bold font-mono uppercase"
                        >
                          [ MODIFY ]
                        </button>
                        <button
                          onClick={() => handleDecisionClick('OVERRIDE', selectedZone)}
                          className="py-1 px-1.5 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-[9px] font-bold font-mono uppercase"
                        >
                          [ OVERRIDE ]
                        </button>
                      </div>

                      {decisionModal && decisionModal.zone.habitation_id === selectedZone.habitation_id && (
                        <div className="mt-2 p-2.5 rounded bg-black/60 border border-amber-500/40 space-y-2 text-[9px] font-mono">
                          <div className="font-bold text-amber-300 flex justify-between items-center">
                            <span>OPERATOR {decisionModal.type} SPECIFICATION</span>
                            <button onClick={() => setDecisionModal(null)} className="text-slate-500 hover:text-slate-200">✕</button>
                          </div>
                          <div>
                            <label className="text-slate-500 block mb-0.5">Operator Name</label>
                            <input
                              type="text"
                              value={decisionModal.operator}
                              onChange={e => setDecisionModal({ ...decisionModal, operator: e.target.value })}
                              className="w-full bg-[#141b2d] border border-white/[0.1] rounded px-1.5 py-1 text-slate-200"
                            />
                          </div>
                          <div>
                            <label className="text-slate-500 block mb-0.5">Directive Reason / Rationale</label>
                            <textarea
                              rows={2}
                              value={decisionModal.reason}
                              onChange={e => setDecisionModal({ ...decisionModal, reason: e.target.value })}
                              className="w-full bg-[#141b2d] border border-white/[0.1] rounded px-1.5 py-1 text-slate-200"
                            />
                          </div>
                          <button
                            onClick={() => executeDecision(decisionModal.type, decisionModal.zone, decisionModal.reason, decisionModal.operator)}
                            className="w-full py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 font-bold uppercase"
                          >
                            Commit {decisionModal.type} to Audit Log
                          </button>
                        </div>
                      )}

                      {decisionFeedback && decisionFeedback.zoneId === selectedZone.habitation_id && (
                        <div className="mt-1.5 text-[8px] text-emerald-400 font-mono">
                          ✓ {decisionFeedback.type} persisted at {decisionFeedback.time}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Data status note */}
                <div className="px-4 py-2 border-b border-white/[0.04]">
                  <div className="text-[9px] text-slate-600 font-mono leading-relaxed">
                    Risk scores: <span className="text-slate-500">MODELLED</span> · Population: <span className="text-slate-500">STATIC</span> · Signals: <span className="text-emerald-500">LIVE (OWM+USGS)</span>
                  </div>
                </div>

                {/* Priority queue */}
                <SectionLabel>PRIORITY QUEUE — {zones.length} ZONES</SectionLabel>

                {priorityList.map(zone => (
                  <ZoneRow
                    key={zone.habitation_id}
                    zone={zone}
                    selected={selectedZone?.habitation_id === zone.habitation_id}
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
                onClick={() => navigate('/events')}
                className="w-full py-2 rounded-lg bg-amber-600/15 hover:bg-amber-600/25 text-amber-300 text-xs font-bold uppercase tracking-wider border border-amber-500/30 transition-all"
              >
                Historical Replay Lab →
              </button>
              <button
                onClick={() => navigate('/planner')}
                className="w-full py-2 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/20 transition-all"
              >
                Plan Relocation Allocation →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}