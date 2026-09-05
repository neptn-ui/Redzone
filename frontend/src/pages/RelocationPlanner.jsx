// src/pages/RelocationPlanner.jsx
// ============================================================================
// REDZONE — Relocation Planner
// "What is the operational plan? Who decides?"
//
// 7-step map-visible workflow:
//   01 Select Origins → 02 Assess Impact → 03 Select Site → 04 Route
//   → 05 Resources → 06 Review → 07 Approve / Override
//
// Human-in-the-loop: REDZONE recommends, operator decides.
// Planning assumptions labeled. No invented resources.
// ============================================================================

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../context/AppStore'
import { api } from '../api/client'
import { getRoute } from '../api/geo'
import HazardMap from '../components/HazardMap'

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: '01  Origins',   desc: 'Select habitation zones to relocate' },
  { id: 2, label: '02  Impact',    desc: 'Review exposure and population' },
  { id: 3, label: '03  Safe Site', desc: 'Select relocation destination' },
  { id: 4, label: '04  Route',     desc: 'Compute road route' },
  { id: 5, label: '05  Resources', desc: 'Estimate required resources' },
  { id: 6, label: '06  Review',    desc: 'Final plan review' },
  { id: 7, label: '07  Approve',   desc: 'Human decision' },
]

// ── Resource estimation (planning assumptions — not validated data) ────────────

function estimateResources(population, distanceKm) {
  if (!population) return null
  // PLANNING ASSUMPTIONS — not validated conversion factors
  const buses       = Math.ceil(population / 45)
  const ambulances  = Math.ceil(population / 500)
  const trucks      = Math.ceil(population / 100)
  const medTeams    = Math.max(1, Math.ceil(population / 1000))
  const fieldTeams  = Math.max(2, Math.ceil(population / 500))
  const water_L     = population * 3  // 3L/person/day — WHO minimum
  const food_kits   = Math.ceil(population / 4)  // family of 4

  return {
    transport: {
      buses:      { qty: buses,      unit: 'buses',      note: '45 passengers/bus · PLANNING ASSUMPTION' },
      ambulances: { qty: ambulances, unit: 'ambulances', note: '1 per 500 pop · PLANNING ASSUMPTION' },
      trucks:     { qty: trucks,     unit: 'trucks',     note: 'Relief goods · PLANNING ASSUMPTION' },
    },
    personnel: {
      medical:    { qty: medTeams,  unit: 'teams', note: '1 per 1000 pop · PLANNING ASSUMPTION' },
      field:      { qty: fieldTeams,unit: 'teams', note: '1 per 500 pop · PLANNING ASSUMPTION' },
    },
    supplies: {
      water:      { qty: water_L,   unit: 'litres/day',  note: 'WHO minimum 3L/person/day · PLANNING ASSUMPTION' },
      food_kits:  { qty: food_kits, unit: 'kits',        note: '1 kit per 4 persons/day · PLANNING ASSUMPTION' },
    },
  }
}

// ── Resource row ──────────────────────────────────────────────────────────────

function ResourceRow({ label, qty, unit, note }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-0">
      <div className="flex-1">
        <div className="text-xs font-semibold text-slate-300">{label}</div>
        <div className="text-[9px] text-amber-400/70 font-mono mt-0.5">{note}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-extrabold font-mono text-white">{qty?.toLocaleString()}</div>
        <div className="text-[9px] text-slate-600 font-mono">{unit}</div>
      </div>
    </div>
  )
}

// ── Zone selector ─────────────────────────────────────────────────────────────

function OriginSelector({ zones, selected, onToggle }) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="p-3 text-[9px] text-slate-600 font-mono border-b border-white/[0.04]">
        Select one or more habitation zones to relocate
      </div>
      {zones.length === 0 && (
        <div className="p-4 text-center text-[11px] text-slate-600">No zones in this area</div>
      )}
      {zones.map(zone => {
        const isSelected = selected.some(z => z.habitation_id === zone.habitation_id)
        return (
          <button
            key={zone.habitation_id}
            onClick={() => onToggle(zone)}
            className={`w-full text-left flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.04] last:border-0 transition-all ${
              isSelected ? 'bg-blue-600/10' : 'hover:bg-white/[0.03]'
            }`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${
              isSelected ? 'bg-blue-600 border-blue-500' : 'border-white/20 bg-white/[0.03]'
            }`}>
              {isSelected && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-200 truncate">{zone.name}</div>
              <div className="text-[10px] text-slate-600 font-mono">
                {(zone.population ?? 0).toLocaleString()} people
              </div>
            </div>
            <div className={`text-[9px] font-bold font-mono ${
              zone.classification === 'immediate' ? 'text-red-400' :
              zone.classification === 'short_term' ? 'text-orange-400' :
              'text-amber-400'
            }`}>
              {zone.classification?.replace(/_/g, ' ').toUpperCase().slice(0, 3) ?? '—'}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function RelocationPlanner() {
  const navigate = useNavigate()
  const { area, setOrigin, setSelectedSite, setRoute, setCurrentPlan, setPlanStatus, setDecision } = useAppStore()

  const [step,          setStep]         = useState(1)
  const [zones,         setZones]        = useState([])
  const [sites,         setSites]        = useState([])
  const [selectedZones, setSelectedZones]= useState([])
  const [selectedSite,  setSelectedSiteL]= useState(null)
  const [routeResult,   setRouteResult]  = useState(null)
  const [routeStatus,   setRouteStatus]  = useState('idle')
  const [resources,     setResources]    = useState(null)
  const [loading,       setLoading]      = useState(false)
  const [overrideReason,setOverrideReason]= useState('')
  const [decision,      setDecisionL]    = useState(null) // 'approved' | 'overridden'

  useEffect(() => {
    if (!area) return
    setLoading(true)
    const params = { lat: area.lat, lon: area.lon, radius_km: 100 }
    Promise.allSettled([api.zones(params), api.sites(params)]).then(([z, s]) => {
      if (z.status === 'fulfilled') {
        const sorted = (z.value ?? []).sort((a, b) => (b.urgency_score ?? 0) - (a.urgency_score ?? 0))
        setZones(sorted)
      }
      if (s.status === 'fulfilled') setSites(s.value ?? [])
    }).finally(() => setLoading(false))
  }, [area])

  const totalPop = selectedZones.reduce((s, z) => s + (z.population ?? 0), 0)

  const toggleZone = (zone) => {
    setSelectedZones(prev =>
      prev.some(z => z.habitation_id === zone.habitation_id)
        ? prev.filter(z => z.habitation_id !== zone.habitation_id)
        : [...prev, zone]
    )
  }

  const handleSelectSite = async (site) => {
    setSelectedSiteL(site)
    setSelectedSite(site)
    setRouteStatus('loading')
    if (selectedZones.length > 0) {
      const origin = selectedZones[0]  // primary origin
      setOrigin(origin)
      try {
        const result = await getRoute(origin, site)
        setRouteResult(result)
        if (result.status === 'ok') {
          setRoute(result)
          setRouteStatus('ready')
        } else {
          setRouteStatus('unavailable')
        }
      } catch {
        setRouteStatus('unavailable')
      }
    } else {
      setRouteStatus('idle')
    }
    // Always advance to step 4 so user sees the result
    setStep(4)
  }

  const handleComputeResources = () => {
    const dist = routeResult?.routes?.[0]?.distanceKm
    const r = estimateResources(totalPop, dist ? parseFloat(dist) : null)
    setResources(r)
    setStep(6)
  }

  const handleApprove = () => {
    const plan = {
      area: area?.name,
      origins: selectedZones.map(z => z.name),
      totalPop,
      destination: selectedSite?.name,
      route: routeResult?.routes?.[0],
      resources,
      status: 'approved',
      timestamp: new Date().toISOString(),
      decisionBy: 'operator',
      overrideReason: null,
    }
    setCurrentPlan(plan)
    setPlanStatus('approved')
    setDecision({ recommendation: 'Relocation approved by operator', action: 'approve', timestamp: plan.timestamp })
    setDecisionL('approved')
    setStep(7)
  }

  const handleOverride = () => {
    if (!overrideReason.trim()) return
    const plan = {
      area: area?.name,
      origins: selectedZones.map(z => z.name),
      totalPop,
      destination: selectedSite?.name,
      route: routeResult?.routes?.[0],
      resources,
      status: 'overridden',
      timestamp: new Date().toISOString(),
      decisionBy: 'operator',
      overrideReason,
    }
    setCurrentPlan(plan)
    setPlanStatus('overridden')
    setDecision({ recommendation: 'Override recorded', action: 'override', overrideReason, timestamp: plan.timestamp })
    setDecisionL('overridden')
    setStep(7)
  }

  // Map zones to show
  const mapZones = step >= 1 ? zones : []
  const mapRoute = step >= 4 && routeResult?.routes?.[0] ? routeResult.routes[0] : null

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">

      {/* ── Left panel ── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#0b0f1a]/95 overflow-hidden">

        {/* Step nav */}
        <div className="border-b border-white/[0.06] shrink-0">
          <div className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono">RELOCATION PLANNER</div>
          <div className="px-2 pb-2 space-y-0.5">
            {STEPS.map(s => (
              <div
                key={s.id}
                onClick={() => s.id < step && setStep(s.id)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded transition-all ${
                  s.id === step
                    ? 'bg-blue-600/10 border border-blue-500/20'
                    : s.id < step
                    ? 'text-slate-600 cursor-pointer hover:bg-white/[0.03]'
                    : 'text-slate-700 opacity-50'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center text-[8px] font-bold shrink-0 ${
                  s.id < step
                    ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                    : s.id === step
                    ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                    : 'border-white/[0.10] text-slate-700'
                }`}>
                  {s.id < step ? '✓' : s.id}
                </div>
                <span className={`text-[10px] font-semibold ${s.id === step ? 'text-slate-200' : ''}`}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!area ? (
            <div className="p-4 text-center text-[11px] text-slate-600 italic">Search for an area to begin</div>
          ) : loading ? (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded shimmer bg-white/[0.04]" />)}</div>
          ) : (

            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col flex-1 min-h-0 overflow-hidden">

                {/* Step 1: Origins */}
                {step === 1 && (
                  <>
                    <OriginSelector zones={zones} selected={selectedZones} onToggle={toggleZone} />
                    <div className="p-3 border-t border-white/[0.06] shrink-0">
                      <div className="text-[10px] text-slate-600 font-mono mb-2">
                        {selectedZones.length} zones · {totalPop.toLocaleString()} people
                      </div>
                      <button
                        disabled={selectedZones.length === 0}
                        onClick={() => setStep(2)}
                        className="w-full py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/30 transition-all disabled:opacity-30"
                      >
                        Next: Assess Impact →
                      </button>
                    </div>
                  </>
                )}

                {/* Step 2: Impact */}
                {step === 2 && (
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-3">SELECTED ORIGINS</div>
                    {selectedZones.map(z => (
                      <div key={z.habitation_id} className="flex justify-between py-2 border-b border-white/[0.04]">
                        <span className="text-xs text-slate-300">{z.name}</span>
                        <span className="text-xs font-mono text-slate-400">{(z.population ?? 0).toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 border-t border-white/[0.10] mt-1">
                      <span className="text-xs font-bold text-slate-200">TOTAL</span>
                      <span className="text-sm font-extrabold font-mono text-white">{totalPop.toLocaleString()}</span>
                    </div>
                    <div className="mt-4 p-2 rounded-lg border border-blue-500/20 bg-blue-500/5 text-[10px] text-blue-400 font-mono">
                      DATA STATUS: STATIC — Population from habitation records, not a live census
                    </div>
                    <button onClick={() => setStep(3)} className="w-full mt-4 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/30 transition-all">
                      Select Safe Site →
                    </button>
                  </div>
                )}

                {/* Step 3: Site */}
                {step === 3 && (
                  <>
                    <div className="flex-1 overflow-y-auto min-h-0">
                      {sites.length === 0 && <div className="p-4 text-center text-[11px] text-slate-600">No sites in area</div>}
                      {sites.map(site => (
                        <div
                          key={site.site_id}
                          onClick={() => handleSelectSite(site)}
                          className={`flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.04] cursor-pointer transition-all ${
                            selectedSite?.site_id === site.site_id ? 'bg-blue-600/10' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-slate-200 truncate">{site.name}</div>
                            <div className="text-[10px] text-slate-600 font-mono">Cap: {site.available_capacity?.toLocaleString() ?? '—'}</div>
                          </div>
                          <div className="text-sm font-extrabold font-mono text-blue-400">
                            {site.capacity_score != null ? `${Math.round(site.capacity_score * 100)}%` : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                    {selectedSite && (
                      <div className="p-3 border-t border-white/[0.06] shrink-0">
                        <div className="text-[10px] text-slate-400 font-mono mb-2">Selected: <span className="text-slate-200 font-bold">{selectedSite.name}</span></div>
                        <button onClick={() => setStep(4)} className="w-full py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/30 transition-all">
                          Compute Route →
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Step 4: Route */}
                {step === 4 && (
                  <div className="flex-1 p-4 overflow-y-auto">
                    {routeStatus === 'loading' && (
                      <div className="text-center py-4">
                        <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin mx-auto mb-2" />
                        <div className="text-[11px] text-slate-500">Computing road route via OSRM...</div>
                      </div>
                    )}
                    {routeStatus === 'unavailable' && (
                      <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-[11px] text-amber-400">
                        <div className="font-bold mb-1">ROUTING UNAVAILABLE</div>
                        OSRM could not find a road route. No straight-line alternative is shown.
                      </div>
                    )}
                    {routeResult?.routes?.[0] && (
                      <div className="space-y-2 mb-4">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
                            <div className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">Distance</div>
                            <div className="text-lg font-extrabold font-mono text-white">{routeResult.routes[0].distanceKm} km</div>
                          </div>
                          <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
                            <div className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">ETA</div>
                            <div className="text-lg font-extrabold font-mono text-white">{routeResult.routes[0].durationFormatted}</div>
                          </div>
                        </div>
                        <div className="text-[9px] text-slate-700 font-mono">OSRM road network routing · Hazard assessment not applied</div>
                      </div>
                    )}
                    <button
                      onClick={() => { setStep(5); handleComputeResources() }}
                      className="w-full py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/30 transition-all"
                    >
                      Estimate Resources →
                    </button>
                  </div>
                )}

                {/* Step 5: Resources */}
                {step === 5 && resources && (
                  <div className="flex-1 p-4 overflow-y-auto">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-1">RESOURCE ESTIMATE</div>
                    <div className="text-[9px] text-amber-400/70 font-mono mb-3">PLANNING ASSUMPTIONS — Not validated operational data</div>
                    {Object.entries(resources).map(([cat, items]) => (
                      <div key={cat} className="mb-4">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-700 font-mono mb-1">{cat.toUpperCase()}</div>
                        {Object.entries(items).map(([k, v]) => (
                          <ResourceRow key={k} label={k.replace(/_/g, ' ').toUpperCase()} qty={v.qty} unit={v.unit} note={v.note} />
                        ))}
                      </div>
                    ))}
                    <button onClick={() => setStep(6)} className="w-full mt-2 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/30 transition-all">
                      Review Plan →
                    </button>
                  </div>
                )}

                {/* Step 6: Review */}
                {step === 6 && (
                  <div className="flex-1 p-4 overflow-y-auto">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-3">PLAN REVIEW</div>
                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-[11px] py-1.5 border-b border-white/[0.04]">
                        <span className="text-slate-500">Area</span>
                        <span className="text-slate-200 font-mono">{area?.name}</span>
                      </div>
                      <div className="flex justify-between text-[11px] py-1.5 border-b border-white/[0.04]">
                        <span className="text-slate-500">Origins</span>
                        <span className="text-slate-200 font-mono">{selectedZones.length} zones</span>
                      </div>
                      <div className="flex justify-between text-[11px] py-1.5 border-b border-white/[0.04]">
                        <span className="text-slate-500">Population</span>
                        <span className="text-slate-200 font-mono">{totalPop.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-[11px] py-1.5 border-b border-white/[0.04]">
                        <span className="text-slate-500">Destination</span>
                        <span className="text-slate-200 font-mono text-right max-w-32 truncate">{selectedSite?.name ?? '—'}</span>
                      </div>
                      <div className="flex justify-between text-[11px] py-1.5">
                        <span className="text-slate-500">Route</span>
                        <span className="text-slate-200 font-mono">
                          {routeResult?.routes?.[0]
                            ? `${routeResult.routes[0].distanceKm}km · ${routeResult.routes[0].durationFormatted}`
                            : 'UNAVAILABLE'}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 mb-4 text-[10px] text-blue-300/80 leading-relaxed">
                      <span className="font-bold text-blue-400">REDZONE RECOMMENDATION:</span>{' '}
                      Proceed with relocation of {totalPop.toLocaleString()} persons from {selectedZones.length} zone(s) to {selectedSite?.name ?? 'selected site'}. This is a system recommendation — human operator approval required.
                    </div>

                    <div className="space-y-2">
                      <button onClick={handleApprove} className="w-full py-2.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-bold uppercase tracking-wider border border-emerald-500/30 transition-all">
                        Approve &amp; Deploy
                      </button>
                      <div className="text-[9px] text-slate-600 font-mono">— or —</div>
                      <textarea
                        value={overrideReason}
                        onChange={e => setOverrideReason(e.target.value)}
                        placeholder="Override reason (required)..."
                        rows={2}
                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-[11px] text-slate-300 placeholder-slate-700 outline-none resize-none"
                      />
                      <button
                        onClick={handleOverride}
                        disabled={!overrideReason.trim()}
                        className="w-full py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-bold uppercase tracking-wider border border-amber-500/20 transition-all disabled:opacity-30"
                      >
                        Override with Reason
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 7: Decision */}
                {step === 7 && (
                  <div className="flex-1 p-4 flex flex-col gap-4">
                    <div className={`p-4 rounded-xl border text-center ${
                      decision === 'approved'
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-amber-500/10 border-amber-500/30'
                    }`}>
                      <div className={`text-sm font-extrabold mb-1 ${decision === 'approved' ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {decision === 'approved' ? 'APPROVED' : 'OVERRIDE RECORDED'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {new Date().toLocaleString('en-IN')} · Operator decision
                      </div>
                    </div>
                    <div className="text-[9px] text-slate-600 font-mono text-center leading-relaxed">
                      Decision logged in audit trail. See Reports page for full record.
                    </div>
                    <button onClick={() => navigate('/reports')} className="w-full py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/30 transition-all">
                      View Reports &amp; Audit →
                    </button>
                    <button onClick={() => { setStep(1); setSelectedZones([]); setSelectedSiteL(null); setRouteResult(null); setDecisionL(null); }} className="w-full py-1.5 text-slate-600 hover:text-slate-400 text-xs transition-all">
                      Start new plan
                    </button>
                  </div>
                )}

              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 min-w-0 relative">
        <HazardMap
          zones={mapZones}
          sites={step >= 3 ? sites : []}
          route={mapRoute}
        />

        {/* Step overlay hint */}
        {step <= 3 && (
          <div className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-lg bg-[#0c101d] border border-white/[0.15] shadow-xl">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">
              STEP {step} — {STEPS[step-1]?.desc}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
