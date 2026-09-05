// src/pages/ScenarioLab.jsx (was: EventsPage/ScenarioLab)
// ============================================================================
// REDZONE — Scenario Lab
// "What if conditions change? What happens to the map?"
//
// Map-first: scenario parameters directly change what appears on the map.
// No simulation smoke — the map responds to sliders, not a card.
//
// Presets: Normal / Heavy Rain / River Surge / Extreme / Custom
// View: Map shows projected zone classifications vs baseline
// Backend: calls /api/scenario/what-if with geographic context
//
// DATA INTEGRITY:
//   - All outputs labeled SIMULATED
//   - No actual historical data fetched in SIMULATION mode
//   - Projected scores compared against BASELINE (current), not invented delta
//   - AI analysis is structural — uses real scoring formula with modified inputs
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore, MODES } from '../context/AppStore'
import { api } from '../api/client'
import HazardMap from '../components/HazardMap'

// ── Scenario presets ──────────────────────────────────────────────────────────

const PRESETS = [
  {
    id: 'normal',
    label: 'Normal',
    desc: 'Baseline — current observed conditions',
    params: { rainfall_mm_24h: 0, river_level_delta_m: 0, soil_saturation_pct: 0 },
    color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  },
  {
    id: 'heavy_rain',
    label: 'Heavy Rain',
    desc: '80mm / 24h — moderate monsoon event',
    params: { rainfall_mm_24h: 80, river_level_delta_m: 0.5, soil_saturation_pct: 60 },
    color: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  },
  {
    id: 'river_surge',
    label: 'River Surge',
    desc: 'River level +2m, rainfall 120mm/24h',
    params: { rainfall_mm_24h: 120, river_level_delta_m: 2.0, soil_saturation_pct: 80 },
    color: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  },
  {
    id: 'extreme',
    label: 'Extreme Flood',
    desc: 'River level +4m, rainfall 200mm/24h',
    params: { rainfall_mm_24h: 200, river_level_delta_m: 4.0, soil_saturation_pct: 100 },
    color: 'text-red-400 border-red-500/30 bg-red-500/10',
  },
]

// ── Slider component ──────────────────────────────────────────────────────────

function ScenarioSlider({ label, value, min, max, step, unit, onChange, note }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-semibold text-slate-300">{label}</div>
        <div className="font-mono text-sm font-bold text-white tabular-nums">{value} <span className="text-slate-600 text-[10px]">{unit}</span></div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1 rounded-full appearance-none bg-white/[0.08] cursor-pointer"
        style={{
          background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${pct}%, rgba(255,255,255,0.08) ${pct}%)`,
        }}
      />
      {note && <div className="text-[9px] text-slate-600 mt-0.5 font-mono">{note}</div>}
    </div>
  )
}

// ── Comparison row ────────────────────────────────────────────────────────────

function ComparisonRow({ zone, baseline, projected }) {
  const bScore = baseline?.hazard_score ?? null
  const pScore = projected?.hazard_score ?? null
  const bClf   = baseline?.classification
  const pClf   = projected?.classification

  const clfColors = {
    immediate:   'text-red-400',
    short_term:  'text-orange-400',
    medium_term: 'text-amber-400',
    stable:      'text-emerald-400',
  }

  const isWorse = pScore != null && bScore != null && pScore > bScore
  const delta   = pScore != null && bScore != null ? Math.round((pScore - bScore) * 100) : null

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-slate-300 truncate">{zone.name}</div>
        <div className="text-[9px] text-slate-600 truncate">{zone.district}</div>
      </div>
      {/* Baseline */}
      <div className="text-right w-10">
        <div className={`text-xs font-extrabold font-mono ${clfColors[bClf] ?? 'text-slate-600'}`}>
          {bScore != null ? Math.round(bScore * 100) : '—'}
        </div>
      </div>
      {/* Arrow */}
      <div className={`text-[9px] font-mono ${isWorse ? 'text-red-400' : delta != null && delta < 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
        {delta != null ? (isWorse ? `+${delta}` : `${delta}`) : '→'}
      </div>
      {/* Projected */}
      <div className="text-right w-10">
        <div className={`text-xs font-extrabold font-mono ${clfColors[pClf] ?? 'text-slate-600'}`}>
          {pScore != null ? Math.round(pScore * 100) : '—'}
        </div>
        <div className="text-[8px] text-blue-400 font-mono uppercase">SIM</div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ScenarioLab() {
  const {
    area, mode, setMode, setScenarioParams, setScenarioPreset,
    setScenarioBaseline, setScenarioProjection, scenarioBaseline, scenarioProjection,
    resetScenario,
  } = useAppStore()

  const [zones,          setZones]          = useState([])
  const [activePreset,   setActivePreset]   = useState('normal')
  const [params,         setParams]         = useState({
    rainfall_mm_24h:       0,
    river_level_delta_m:   0,
    soil_saturation_pct:   0,
  })
  const [running,        setRunning]        = useState(false)
  const [runError,       setRunError]       = useState(null)
  const [projectedZones, setProjectedZones] = useState([])
  const debounceRef = useRef(null)

  // Load baseline zones
  useEffect(() => {
    if (!area) { setZones([]); setProjectedZones([]); return }
    api.zones({ lat: area.lat, lon: area.lon, radius_km: 100 })
      .then(data => {
        setZones(data ?? [])
        setScenarioBaseline(data ?? [])
      })
      .catch(() => setZones([]))
  }, [area, setScenarioBaseline])

  const runScenario = useCallback(async (currentParams) => {
    if (!area) return
    setRunning(true)
    setRunError(null)

    // Enter simulation mode
    setMode(MODES.SIMULATION)
    setScenarioParams(currentParams)

    try {
      const result = await api.whatIf({
        lat:       area.lat,
        lon:       area.lon,
        radius_km: 100,
        ...currentParams,
      })

      const projected = result?.zones ?? result ?? []
      setProjectedZones(projected)
      setScenarioProjection(projected)
    } catch (err) {
      setRunError('Scenario engine unavailable — backend not running')
      // Show baseline as projected when backend unavailable
      setProjectedZones([])
    } finally {
      setRunning(false)
    }
  }, [area, setMode, setScenarioParams, setScenarioProjection])

  const handlePreset = (preset) => {
    setActivePreset(preset.id)
    setScenarioPreset(preset.id)
    const newParams = { ...params, ...preset.params }
    setParams(newParams)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runScenario(newParams), 400)
  }

  const handleParamChange = (key, value) => {
    setActivePreset('custom')
    const newParams = { ...params, [key]: value }
    setParams(newParams)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runScenario(newParams), 800)
  }

  const handleReset = () => {
    setActivePreset('normal')
    setParams({ rainfall_mm_24h: 0, river_level_delta_m: 0, soil_saturation_pct: 0 })
    setProjectedZones([])
    resetScenario()
  }

  // Map shows projected zones if available, else baseline
  const mapZones = projectedZones.length > 0 ? projectedZones : zones

  const immediateProjected = projectedZones.filter(z => z.classification === 'immediate').length
  const immediateBaseline  = zones.filter(z => z.classification === 'immediate').length
  const delta              = immediateProjected - immediateBaseline

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">

      {/* ── Control panel ── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#0b0f1a]/95 overflow-hidden">

        {/* Header */}
        <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono">SCENARIO LAB</span>
            {mode === 'SIMULATION' && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border text-[8px] font-bold font-mono bg-blue-500/10 border-blue-500/30 text-blue-400">
                <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />SIMULATION
              </div>
            )}
          </div>
          {area ? (
            <div className="text-xs text-slate-400">Scenarios for <span className="font-bold text-slate-200">{area.name}</span></div>
          ) : (
            <div className="text-xs text-slate-600 italic">Search for an area first</div>
          )}
        </div>

        {/* Presets */}
        <div className="p-3 border-b border-white/[0.06] shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">PRESET SCENARIOS</div>
          <div className="space-y-1.5">
            {PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => handlePreset(preset)}
                disabled={!area}
                className={`w-full text-left px-3 py-2 rounded-lg border transition-all disabled:opacity-30 ${
                  activePreset === preset.id ? preset.color : 'border-white/[0.06] text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
                }`}
              >
                <div className="text-xs font-bold">{preset.label}</div>
                <div className="text-[9px] opacity-70 mt-0.5">{preset.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Custom sliders */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-4">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-3">CUSTOM PARAMETERS</div>
            <ScenarioSlider
              label="Rainfall"
              value={params.rainfall_mm_24h}
              min={0} max={300} step={5}
              unit="mm/24h"
              onChange={v => handleParamChange('rainfall_mm_24h', v)}
              note="Affects live trigger multiplier (>15mm/hr activates)"
            />
            <ScenarioSlider
              label="River Level Rise"
              value={params.river_level_delta_m}
              min={0} max={6} step={0.1}
              unit="m above normal"
              onChange={v => handleParamChange('river_level_delta_m', v)}
              note="Delta from current gauge reading"
            />
            <ScenarioSlider
              label="Soil Saturation"
              value={params.soil_saturation_pct}
              min={0} max={100} step={5}
              unit="%"
              onChange={v => handleParamChange('soil_saturation_pct', v)}
              note="Increases terrain vulnerability score"
            />

            {/* Labels */}
            <div className="mt-3 p-2 rounded-lg border border-blue-500/20 bg-blue-500/5 text-[9px] text-blue-400/80 leading-relaxed font-mono">
              All outputs labeled SIMULATED. Parameters modify the live trigger multiplier and terrain vulnerability components of the hazard formula. Backend applies the real scoring engine to modified inputs.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-white/[0.06] shrink-0 space-y-2">
          {running && (
            <div className="flex items-center gap-2 text-[10px] text-blue-400 font-mono">
              <div className="w-3 h-3 border border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
              Running scenario...
            </div>
          )}
          {runError && (
            <div className="text-[10px] text-amber-400 font-mono">{runError}</div>
          )}
          <button
            onClick={handleReset}
            disabled={!area || mode !== 'SIMULATION'}
            className="w-full py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 text-xs font-bold uppercase tracking-wider border border-white/[0.06] transition-all disabled:opacity-30"
          >
            Reset to Baseline
          </button>
        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 min-w-0 relative">
        <HazardMap zones={mapZones} sites={[]} />

        {/* Simulation overlay */}
        <AnimatePresence>
          {mode === 'SIMULATION' && projectedZones.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute top-4 left-4 z-20 bg-[#0c101d] border border-blue-500/40 rounded-xl p-3 shadow-2xl"
            >
              <div className="text-[9px] font-bold uppercase tracking-widest text-blue-400 font-mono mb-2">SIMULATION RESULTS</div>
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-[9px] text-slate-600 font-mono">BASELINE</div>
                  <div className="text-lg font-extrabold font-mono text-slate-300">{immediateBaseline}</div>
                  <div className="text-[9px] text-slate-600">immediate</div>
                </div>
                <div className="text-slate-600">→</div>
                <div>
                  <div className="text-[9px] text-blue-400 font-mono">SIMULATED</div>
                  <div className={`text-lg font-extrabold font-mono ${delta > 0 ? 'text-red-400' : delta < 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {immediateProjected}
                  </div>
                  <div className="text-[9px] text-slate-600">immediate</div>
                </div>
                {delta !== 0 && (
                  <div className={`text-sm font-extrabold font-mono ${delta > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {delta > 0 ? `+${delta}` : `${delta}`}
                  </div>
                )}
              </div>
              <div className="mt-2 text-[8px] text-blue-400/60 font-mono">DATA STATUS: SIMULATED</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* No area prompt */}
        {!area && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="text-center">
              <div className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-1">SCENARIO LAB</div>
              <div className="text-[11px] text-slate-700">Search for an area, then run scenario presets or adjust parameters</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Comparison panel (visible when simulation ran) ── */}
      <AnimatePresence>
        {projectedZones.length > 0 && zones.length > 0 && (
          <motion.div
            key="comparison"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 150, damping: 22 }}
            className="w-64 shrink-0 flex flex-col border-l border-white/[0.06] bg-[#0b0f1a]/95 overflow-hidden"
          >
            {/* Header */}
            <div className="px-3 py-2.5 border-b border-white/[0.06] shrink-0">
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono">BASELINE vs SIMULATED</div>
            </div>

            {/* Column labels */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.04] shrink-0 bg-white/[0.01]">
              <div className="flex-1 text-[9px] text-slate-600 font-mono">ZONE</div>
              <div className="w-10 text-right text-[9px] text-slate-600 font-mono">BASE</div>
              <div className="w-4" />
              <div className="w-10 text-right text-[9px] text-blue-400 font-mono">SIM</div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {zones.slice(0, 20).map(z => {
                const proj = projectedZones.find(p => p.habitation_id === z.habitation_id)
                return (
                  <ComparisonRow
                    key={z.habitation_id}
                    zone={z}
                    baseline={z}
                    projected={proj ?? null}
                  />
                )
              })}
            </div>

            <div className="p-3 border-t border-white/[0.04] shrink-0 text-[9px] text-slate-700 font-mono">
              All projected values: SIMULATED — Formula: hazard_engine.py with modified inputs
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}