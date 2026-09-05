// src/components/MapInspectorPanel.jsx
// ============================================================================
// REDZONE — Map Inspector Panel
//
// Slide-in panel rendered by HazardMap when a feature is clicked.
// Driven by AppStore.selectedFeature — no direct props.
//
// Feature types handled:
//   habitation  → hazard score, population, classification, actions
//   safe_site   → capacity score, available capacity, route CTA
//   (null)      → panel closed
// ============================================================================

import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../context/AppStore'

const RISK_COLORS = {
  immediate:   { text: 'text-red-400',     bg: 'bg-red-500/10',    border: 'border-red-500/30' },
  short_term:  { text: 'text-orange-400',  bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  medium_term: { text: 'text-amber-400',   bg: 'bg-amber-500/10',  border: 'border-amber-500/30' },
  stable:      { text: 'text-emerald-400', bg: 'bg-emerald-500/10',border: 'border-emerald-500/30' },
}

function DataLabel({ status }) {
  const styles = {
    MODELLED:    'text-blue-400 border-blue-500/30 bg-blue-500/5',
    STATIC:      'text-slate-500 border-slate-700 bg-slate-800',
    UNAVAILABLE: 'text-red-400 border-red-500/30 bg-red-500/5',
  }
  return (
    <span className={`inline-block text-[8px] font-bold uppercase tracking-widest font-mono px-1.5 py-0.5 rounded border ${styles[status] ?? styles.STATIC}`}>
      {status}
    </span>
  )
}

// ── Habitation inspector ──────────────────────────────────────────────────────

function HabitationInspector({ feature }) {
  const navigate = useNavigate()
  const { setOrigin } = useAppStore()
  const c = RISK_COLORS[feature.classification] ?? RISK_COLORS.stable
  const score = feature.hazard_score != null ? Math.round(feature.hazard_score * 100) : null

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Score block */}
      <div className="p-4 border-b border-white/[0.06]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">HAZARD PROFILE</div>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-extrabold font-mono border shrink-0 ${c.bg} ${c.border} ${c.text}`}>
            {score ?? '—'}
          </div>
          <div>
            <div className="text-sm font-extrabold text-white leading-tight">{feature.name}</div>
            <div className={`text-xs font-bold uppercase tracking-wider mt-0.5 ${c.text}`}>
              {feature.classification?.replace(/_/g, ' ')}
            </div>
            {feature.district && <div className="text-[10px] text-slate-600 mt-0.5">{feature.district}</div>}
          </div>
        </div>
        <DataLabel status="MODELLED" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 border-b border-white/[0.06]">
        <div className="p-3 border-r border-white/[0.04]">
          <div className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">Population</div>
          <div className="text-lg font-extrabold font-mono text-white tabular-nums">
            {feature.population?.toLocaleString() ?? '—'}
          </div>
          <DataLabel status="STATIC" />
        </div>
        <div className="p-3">
          <div className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">Urgency</div>
          <div className="text-lg font-extrabold font-mono text-white tabular-nums">
            {feature.urgency_score != null ? Math.round(feature.urgency_score * 100) : '—'}
          </div>
          <DataLabel status="MODELLED" />
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 space-y-2">
        <button
          onClick={() => navigate('/hazard')}
          className="w-full py-2 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/20 transition-all"
        >
          Full Intelligence →
        </button>
        <button
          onClick={() => {
            setOrigin(feature)
            navigate('/safe-sites')
          }}
          className="w-full py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 text-xs font-bold uppercase tracking-wider border border-white/[0.06] transition-all"
        >
          Find Safe Sites →
        </button>
        <button
          onClick={() => {
            setOrigin(feature)
            navigate('/planner')
          }}
          className="w-full py-1.5 text-slate-600 hover:text-slate-400 text-xs font-bold uppercase tracking-wider transition-all"
        >
          Plan Relocation →
        </button>
      </div>
    </div>
  )
}

// ── Safe site inspector ───────────────────────────────────────────────────────

function SafeSiteInspector({ feature }) {
  const navigate = useNavigate()
  const { setSelectedSite } = useAppStore()
  const score = feature.capacity_score != null ? Math.round(feature.capacity_score * 100) : null

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 border-b border-white/[0.06]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">SAFE SITE</div>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl font-extrabold font-mono border bg-blue-500/10 border-blue-500/30 text-blue-400 shrink-0">
            {score != null ? `${score}` : '—'}
          </div>
          <div>
            <div className="text-sm font-extrabold text-white leading-tight">{feature.name}</div>
            <div className="text-xs text-blue-400 font-bold uppercase tracking-wider mt-0.5">Suitability score</div>
            {feature.district && <div className="text-[10px] text-slate-600 mt-0.5">{feature.district}</div>}
          </div>
        </div>
        <DataLabel status="MODELLED" />
      </div>

      <div className="grid grid-cols-2 border-b border-white/[0.06]">
        <div className="p-3 border-r border-white/[0.04]">
          <div className="text-[9px] text-slate-600 font-mono uppercase">Available</div>
          <div className="text-lg font-extrabold font-mono text-white">{feature.available_capacity?.toLocaleString() ?? '—'}</div>
        </div>
        <div className="p-3">
          <div className="text-[9px] text-slate-600 font-mono uppercase">Slope</div>
          <div className="text-lg font-extrabold font-mono text-white">
            {feature.slope_degrees != null ? `${feature.slope_degrees}°` : '—'}
          </div>
        </div>
      </div>

      <div className="p-3 space-y-2">
        <button
          onClick={() => { setSelectedSite(feature); navigate('/safe-sites') }}
          className="w-full py-2 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/20 transition-all"
        >
          Site Intelligence →
        </button>
        <button
          onClick={() => navigate('/planner')}
          className="w-full py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 text-xs font-bold uppercase tracking-wider border border-white/[0.06] transition-all"
        >
          Use in Plan →
        </button>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function MapInspectorPanel() {
  const { selectedFeature, setSelectedFeature } = useAppStore()

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setSelectedFeature(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSelectedFeature])

  const close = useCallback(() => setSelectedFeature(null), [setSelectedFeature])

  const isVisible = !!selectedFeature

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="inspector"
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0,      opacity: 1 }}
          exit={{ x: '100%',    opacity: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 28 }}
          className="absolute right-0 top-0 bottom-0 z-30 w-72 flex flex-col bg-[#0c101d] border-l border-white/[0.15] shadow-[-16px_0_40px_rgba(0,0,0,0.9)]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono">
              {selectedFeature.featureType === 'habitation' ? 'ZONE INSPECTOR'
               : selectedFeature.featureType === 'safe_site' ? 'SITE INSPECTOR'
               : 'INSPECTOR'}
            </span>
            <button
              onClick={close}
              aria-label="Close inspector"
              className="text-slate-600 hover:text-slate-300 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Content */}
          {selectedFeature.featureType === 'habitation' && (
            <HabitationInspector feature={selectedFeature} />
          )}
          {selectedFeature.featureType === 'safe_site' && (
            <SafeSiteInspector feature={selectedFeature} />
          )}
          {!['habitation','safe_site'].includes(selectedFeature.featureType) && (
            <div className="p-4 text-[11px] text-slate-600">Unknown feature type</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
