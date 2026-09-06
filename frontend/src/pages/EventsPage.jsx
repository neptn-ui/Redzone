// src/pages/EventsPage.jsx
// ============================================================================
// REDZONE — Historical Events & Replay
//
// Complete Proactive Decision-Chain Demonstration (Tiers 1–6):
//   - Time-Safe Historical Replay (no hindsight leakage)
//   - First-Class RED ZONE structured outputs
//   - Proactive Warning Window & Action Timeline
//   - Multimodal Transport Intelligence (ROAD / HELICOPTER / BOAT / FOOT / HYBRID)
//   - Capacity-Gap Analysis & Vulnerability Prioritization
//   - Data Honesty Taxonomy & Provenance Panel
//   - Human-in-the-Loop SDMA Decision Capture (APPROVE / MODIFY / OVERRIDE)
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../context/AppStore'
import { api } from '../api/client'
import HazardMap from '../components/HazardMap'

// ── Utilities ─────────────────────────────────────────────────────────────────

const HAZARD_META = {
  flood:      { label: 'Flood',      color: '#3b82f6', bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   text: 'text-blue-400'   },
  erosion:    { label: 'Erosion',    color: '#f97316', bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
  landslide:  { label: 'Landslide',  color: '#d97706', bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  text: 'text-amber-400'  },
  earthquake: { label: 'Earthquake', color: '#ef4444', bg: 'bg-red-500/10',    border: 'border-red-500/30',    text: 'text-red-400'    },
}

const SEV_COLOR = {
  extreme:  'text-red-400',
  high:     'text-orange-400',
  moderate: 'text-amber-400',
  low:      'text-emerald-400',
}

function DataLabel({ status }) {
  const colors = {
    OBSERVED:      'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
    HISTORICAL:    'text-amber-400 border-amber-500/30 bg-amber-500/5',
    RECONSTRUCTED: 'text-amber-300 border-amber-400/20 bg-amber-400/5',
    DERIVED:       'text-blue-400  border-blue-500/30  bg-blue-500/5',
    MODELLED:      'text-indigo-400 border-indigo-500/30 bg-indigo-500/5',
    APPROXIMATED:  'text-purple-400 border-purple-500/30 bg-purple-500/5',
    COUNTERFACTUAL:'text-pink-400   border-pink-500/30   bg-pink-500/5',
    UNAVAILABLE:   'text-slate-500  border-slate-700     bg-slate-800',
  }
  return (
    <span className={`inline-block text-[8px] font-bold uppercase tracking-widest font-mono px-1.5 py-0.5 rounded border ${colors[status] ?? 'text-slate-500 border-slate-700 bg-slate-800'}`}>
      {status}
    </span>
  )
}

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({ event, selected, onClick }) {
  const m = HAZARD_META[event.hazard_type] ?? HAZARD_META.flood
  return (
    <button
      onClick={() => onClick(event)}
      className={`w-full text-left p-4 border-b border-white/[0.04] last:border-0 transition-all ${
        selected ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className={`text-[9px] font-bold uppercase tracking-wider font-mono px-2 py-0.5 rounded border ${m.bg} ${m.border} ${m.text}`}>
          {m.label}
        </div>
        <DataLabel status={event.data_status} />
      </div>
      <div className="text-sm font-bold text-slate-200 mb-1 leading-tight">{event.name}</div>
      <div className="text-[11px] text-slate-500 mb-2 leading-relaxed line-clamp-2">{event.description}</div>
      <div className="flex items-center gap-3 text-[10px] text-slate-600 font-mono">
        <span>{event.date_start}</span>
        <span className="text-slate-700">·</span>
        <span className={SEV_COLOR[event.severity] ?? 'text-slate-500'}>{event.severity?.toUpperCase()}</span>
        {event.affected_pop && (
          <>
            <span className="text-slate-700">·</span>
            <span>{(event.affected_pop / 1000).toFixed(0)}K affected</span>
          </>
        )}
      </div>
    </button>
  )
}

// ── Timeline scrubber ─────────────────────────────────────────────────────────

function TimelineScrubber({ event, currentTimestamp, onTimestampChange }) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const timeline = event?.timeline ?? []

  const currentIdx = timeline.findIndex(t => t.timestamp === currentTimestamp)
  const idx = currentIdx < 0 ? 0 : currentIdx

  useEffect(() => {
    if (!playing || timeline.length === 0) return
    if (idx >= timeline.length - 1) { setPlaying(false); return }
    const delay = 2500 / speed
    const timer = setTimeout(() => {
      onTimestampChange(timeline[idx + 1].timestamp)
    }, delay)
    return () => clearTimeout(timer)
  }, [playing, idx, timeline, speed, onTimestampChange])

  if (!event || timeline.length === 0) return null

  const currentStage = timeline[idx]

  return (
    <div className="border-t border-white/[0.06] bg-[#0d1220]/95 backdrop-blur-xl">
      {/* Stage label */}
      <div className="px-4 py-3 border-b border-white/[0.04]">
        <div className="flex items-center justify-between mb-1">
          <DataLabel status={event.data_status} />
          <span className="text-[9px] text-slate-400 font-mono font-bold">{currentStage?.timestamp}</span>
        </div>
        <div className="text-xs font-bold text-slate-200">{currentStage?.label}</div>
        <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{currentStage?.description}</div>
      </div>

      {/* Stage buttons */}
      <div className="px-4 py-3">
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {timeline.map((stage, i) => (
            <button
              key={stage.timestamp}
              onClick={() => onTimestampChange(stage.timestamp)}
              className={`px-2.5 py-1 rounded text-[10px] font-bold font-mono transition-all ${
                i === idx
                  ? 'bg-amber-500/25 border border-amber-500/50 text-amber-300 shadow-sm'
                  : 'bg-white/[0.03] border border-white/[0.06] text-slate-500 hover:text-slate-300'
              }`}
            >
              Stage {i + 1}
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => idx > 0 && onTimestampChange(timeline[idx - 1].timestamp)}
            disabled={idx === 0}
            className="p-1.5 rounded bg-white/[0.04] border border-white/[0.06] text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-all"
            title="Previous Stage"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button
            onClick={() => setPlaying(p => !p)}
            className={`p-1.5 rounded border transition-all ${playing ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-white/[0.04] border-white/[0.06] text-slate-400 hover:text-slate-200'}`}
            title={playing ? 'Pause' : 'Play Timeline'}
          >
            {playing
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            }
          </button>
          <button
            onClick={() => idx < timeline.length - 1 && onTimestampChange(timeline[idx + 1].timestamp)}
            disabled={idx === timeline.length - 1}
            className="p-1.5 rounded bg-white/[0.04] border border-white/[0.06] text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-all"
            title="Next Stage"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6zm8.5-6L23 6v12z"/></svg>
          </button>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[9px] text-slate-500 font-mono">SPEED</span>
            {[0.5, 1, 2].map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-all ${
                  speed === s ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <div className="text-[9px] text-slate-600 mt-2 font-mono">
          Stage {idx + 1} of {timeline.length} · Granularity: {event.timeline_granularity?.replace('_', ' ')}
        </div>
      </div>
    </div>
  )
}

// ── Decision Modal / Interface (§6.3) ─────────────────────────────────────────

function DecisionSection({ event, replayData, onDecisionRecorded }) {
  const [mode, setMode] = useState(null) // 'APPROVE' | 'MODIFY' | 'OVERRIDE'
  const [operator, setOperator] = useState('SDMA Field Commander')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [recordFeedback, setRecordFeedback] = useState(null)

  const handleDecision = async (decisionType) => {
    if (decisionType === 'APPROVE') {
      await submitDecision('APPROVE', 'Standard SOP Relocation Recommendation Approved.')
    } else {
      setMode(decisionType)
    }
  }

  const submitDecision = async (decisionType, explicitReason = null) => {
    setSubmitting(true)
    try {
      const topHab = replayData?.red_zones?.[0]
      const payload = {
        recommendation_id: `REC-${event.event_id}-${Date.now().toString().slice(-4)}`,
        habitation_id: topHab?.habitation_id || 1,
        habitation_name: topHab?.name || 'Affected Settlement',
        decision: decisionType,
        reason: explicitReason || reason || `SDMA ${decisionType} directive issued`,
        operator_name: operator || 'SDMA Commander',
        modified_site_id: null,
      }
      await api.recordDecision(payload)
      setRecordFeedback({ decision: decisionType, timestamp: new Date().toLocaleTimeString() })
      setMode(null)
      setReason('')
      if (onDecisionRecorded) onDecisionRecorded()
    } catch (err) {
      console.error('Failed to submit decision:', err)
      setRecordFeedback({ error: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 border-b border-white/[0.06] bg-[#0c111e]">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center justify-between">
        <span>SDMA HUMAN-IN-THE-LOOP APPROVAL</span>
        <span className="text-blue-400 text-[8px]">FINAL DECISION (§6.3)</span>
      </div>

      <div className="text-[11px] text-slate-300 font-medium mb-3">
        RECOMMENDATION: {replayData?.red_zones?.[0]?.recommendation || "Execute proactive life-safety evacuation & staging"}
      </div>

      {recordFeedback && !recordFeedback.error && (
        <div className="mb-3 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[10px] text-emerald-300 font-mono flex items-center justify-between">
          <span>✓ {recordFeedback.decision} RECORDED AT {recordFeedback.timestamp}</span>
          <span className="text-[8px] text-emerald-400 uppercase">AUDIT PERSISTED</span>
        </div>
      )}

      {recordFeedback?.error && (
        <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-[10px] text-red-400 font-mono">
          Error: {recordFeedback.error}
        </div>
      )}

      {/* Buttons */}
      {!mode ? (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => handleDecision('APPROVE')}
            disabled={submitting}
            className="py-2 px-3 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold font-mono uppercase tracking-wider transition-all disabled:opacity-50"
          >
            [ APPROVE ]
          </button>
          <button
            onClick={() => handleDecision('MODIFY')}
            disabled={submitting}
            className="py-2 px-3 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold font-mono uppercase tracking-wider transition-all disabled:opacity-50"
          >
            [ MODIFY ]
          </button>
          <button
            onClick={() => handleDecision('OVERRIDE')}
            disabled={submitting}
            className="py-2 px-3 rounded bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 text-xs font-bold font-mono uppercase tracking-wider transition-all disabled:opacity-50"
          >
            [ OVERRIDE ]
          </button>
        </div>
      ) : (
        <div className="space-y-2 p-3 rounded-lg bg-black/40 border border-white/[0.08]">
          <div className="text-[10px] font-bold text-amber-400 font-mono uppercase">
            {mode} SPECIFICATION
          </div>
          <div>
            <label className="text-[9px] text-slate-500 font-mono block mb-1">OPERATOR</label>
            <input
              type="text"
              value={operator}
              onChange={e => setOperator(e.target.value)}
              className="w-full bg-[#131929] border border-white/[0.1] rounded px-2 py-1 text-xs text-slate-200 font-mono"
            />
          </div>
          <div>
            <label className="text-[9px] text-slate-500 font-mono block mb-1">REASON / DIRECTIVE</label>
            <textarea
              rows={2}
              value={reason}
              placeholder={`Enter operational justification for ${mode}...`}
              onChange={e => setReason(e.target.value)}
              className="w-full bg-[#131929] border border-white/[0.1] rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-600 font-sans"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => submitDecision(mode)}
              disabled={submitting || !reason.trim()}
              className="flex-1 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-mono uppercase disabled:opacity-40"
            >
              Confirm {mode}
            </button>
            <button
              onClick={() => setMode(null)}
              className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-slate-400 text-xs font-mono"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Event detail panel ────────────────────────────────────────────────────────

function EventDetail({ event, replayData, onClose, onRefresh }) {
  const { setHistoricalEvent, historicalTimestamp, setHistoricalTimestamp } = useAppStore()

  useEffect(() => {
    if (event) setHistoricalEvent(event)
    return () => {}
  }, [event, setHistoricalEvent])

  if (!event) return null

  const m = HAZARD_META[event.hazard_type] ?? HAZARD_META.flood
  const pww = replayData?.proactive_warning_window
  const wat = replayData?.warning_action_timeline
  const cap = replayData?.capacity_analysis
  const vuln = replayData?.vulnerability_prioritization
  const trans = replayData?.transport_assessment
  const redZones = replayData?.red_zones || []
  const prov = replayData?.provenance_panel

  return (
    <div className="flex flex-col h-full border-l border-white/[0.08] bg-[#0b0f1a]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] shrink-0 bg-[#0d1222]">
        <div className="flex items-center justify-between mb-2">
          <DataLabel status={event.data_status} />
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className={`text-[9px] font-bold uppercase tracking-wider font-mono mb-1 ${m.text}`}>{m.label}</div>
        <div className="text-sm font-extrabold text-slate-100 leading-tight">{event.name}</div>
        <div className="text-[10px] text-slate-400 mt-1 font-mono">{event.region} · Event Date: {event.date_start}</div>
      </div>

      {/* §6.2 Replay reframed as live-system demonstration */}
      <div className="px-4 py-2 bg-gradient-to-r from-blue-950/40 via-amber-950/20 to-blue-950/40 border-b border-amber-500/20 shrink-0">
        <div className="text-[10px] text-amber-300/90 leading-relaxed font-sans">
          <span className="font-bold text-amber-400">REDZONE RETROSPECTIVE DECISION RECONSTRUCTION:</span> Time-isolated replay showing what REDZONE’s decision chain would have recommended with information available at that time — never claiming "REDZONE predicted the disaster".
        </div>
      </div>

      {/* Content scroll area */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-4 py-3">

        {/* §2.2 Proactive Warning Window */}
        {pww && (
          <div className="mx-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400 font-mono">
                PROACTIVE WARNING WINDOW (§2.2)
              </span>
              <span className="text-[9px] font-mono font-extrabold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                {pww.warning_window}
              </span>
            </div>
            <div className="space-y-1 text-[10px] font-mono">
              <div className="flex justify-between text-slate-400">
                <span>First detected:</span>
                <span className="text-slate-200 font-semibold">{pww.first_detected}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Escalated:</span>
                <span className="text-slate-200 font-semibold">{pww.escalated}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>IMMEDIATE:</span>
                <span className="text-red-400 font-semibold">{pww.immediate}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Event peak:</span>
                <span className="text-amber-400 font-semibold">{pww.event_peak}</span>
              </div>
            </div>
          </div>
        )}

        {/* §2.3 Warning -> Action Timeline */}
        {wat && wat.length > 0 && (
          <div className="mx-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2">
              WARNING → ACTION TIMELINE (§2.3)
            </div>
            <div className="space-y-2">
              {wat.map((step, i) => (
                <div key={i} className="flex items-start gap-2.5 text-[10px]">
                  <span className="font-mono font-bold text-amber-400 shrink-0 w-8">{step.t_mark}</span>
                  <span className={`font-mono text-[9px] font-bold px-1 py-0.2 rounded border shrink-0 ${
                    step.horizon === 'IMMEDIATE' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                    step.horizon === 'SHORT_TERM' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                    'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  }`}>
                    {step.horizon}
                  </span>
                  <span className="text-slate-300 leading-snug flex-1">{step.action}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* §2.1 RED ZONE as a first-class structured output */}
        {redZones.length > 0 && (
          <div className="mx-4 space-y-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-red-400 font-mono flex items-center justify-between">
              <span>RED ZONE EXPLICIT OUTPUT (§2.1)</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
                {redZones.length} IDENTIFIED
              </span>
            </div>

            {redZones.slice(0, 2).map((rz, idx) => (
              <div key={idx} className="p-3.5 rounded-lg bg-red-950/25 border border-red-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-100">{rz.name}</span>
                  <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded bg-red-500/30 text-red-300 border border-red-500/50">
                    {rz.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono py-1 border-y border-white/[0.04]">
                  <div>
                    <span className="text-slate-500 block">PRIMARY HAZARD</span>
                    <span className="text-red-400 font-bold uppercase">{rz.primary_hazard}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">AFFECTED POP</span>
                    <span className="text-slate-200 font-bold">{rz.affected_population?.toLocaleString()}</span>
                  </div>
                </div>

                <div className="text-[10px] font-mono">
                  <span className="text-slate-500">CONTRIBUTING: </span>
                  <span className="text-slate-300">{rz.contributing_hazards?.join(', ') || 'N/A'}</span>
                </div>

                <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-[10px] text-red-200 font-medium">
                  <span className="font-bold">RECOMMENDATION: </span>
                  {rz.recommendation}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* §3.3 Capacity-Gap Analysis */}
        {cap && (
          <div className="mx-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center justify-between">
              <span>CAPACITY-GAP ANALYSIS (§3.3)</span>
              <DataLabel status={cap.provenance} />
            </div>
            <div className="p-2.5 rounded bg-slate-900/60 font-mono text-[10px] leading-relaxed border border-white/[0.04] text-slate-200">
              {cap.display_text}
            </div>
          </div>
        )}

        {/* §3.4 Vulnerable Population Prioritization */}
        {vuln && (
          <div className="mx-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center justify-between">
              <span>VULNERABLE POPULATION PRIORITIZATION (§3.4)</span>
              <DataLabel status={vuln.provenance} />
            </div>
            <div className="text-[10px] font-mono text-slate-300 mb-2">
              TOTAL: <span className="font-bold text-white">{vuln.total_population?.toLocaleString()}</span> · HIGH VULNERABILITY: <span className="font-bold text-amber-400">{vuln.high_vulnerability_population?.toLocaleString()}</span>
            </div>
            <div className="space-y-1">
              {vuln.priority_order?.map((p, i) => (
                <div key={i} className="text-[10px] text-slate-400 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* §4.1 Multimodal Transport Intelligence */}
        {trans && (
          <div className="mx-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono">
                TRANSPORT-MODE FEASIBILITY (§4.1)
              </span>
              <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40">
                REC: {trans.recommended_mode}
              </span>
            </div>

            <div className="text-[10px] text-slate-300 font-sans leading-relaxed">
              {trans.rationale}
            </div>

            {/* Modes list */}
            <div className="space-y-1.5 pt-1">
              {Object.entries(trans.modes || {}).map(([mKey, mVal]) => (
                <div key={mKey} className="p-2 rounded bg-black/30 border border-white/[0.04] text-[10px] font-mono flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${mVal.feasible ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="font-bold text-slate-200">{mKey.toUpperCase()}</span>
                    <span className="text-slate-500">· {mVal.distance_km}km · {mVal.est_duration_minutes}m</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[8px] font-bold px-1 py-0.2 rounded border ${
                      mVal.risk_level === 'LOW' ? 'text-emerald-400 border-emerald-500/30' :
                      mVal.risk_level === 'MEDIUM' ? 'text-amber-400 border-amber-500/30' :
                      'text-red-400 border-red-500/30'
                    }`}>
                      {mVal.risk_level}
                    </span>
                    <DataLabel status={mVal.provenance} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* §3.5 Provenance Panel */}
        {prov && (
          <div className="mx-4 p-3 rounded-lg bg-slate-900/40 border border-white/[0.06] text-[9px] font-mono space-y-1 text-slate-400">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">
              PROVENANCE & AUDIT (§3.5)
            </div>
            <div><span className="text-slate-500">DATA STATUS: </span><span className="text-slate-300">{prov.data_status}</span></div>
            <div><span className="text-slate-500">SOURCE: </span><span className="text-slate-300">{prov.source}</span></div>
            <div><span className="text-slate-500">VINTAGE: </span><span className="text-slate-300">{prov.vintage}</span></div>
            <div><span className="text-slate-500">ISOLATION: </span><span className="text-emerald-400">{prov.replay_isolation}</span></div>
          </div>
        )}

        {/* Causal chain */}
        {event.causal_chain?.length > 0 && (
          <div className="mx-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono mb-2">EVENT PROGRESSION</div>
            <div className="space-y-1.5">
              {event.causal_chain.map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex flex-col items-center mt-1 shrink-0">
                    <div className={`w-1.5 h-1.5 rounded-full ${m.text.replace('text-', 'bg-')}`} />
                    {i < event.causal_chain.length - 1 && (
                      <div className="w-px h-3 bg-white/[0.08] mt-0.5" />
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 leading-relaxed">{step}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* §6.3 SDMA Final Decision Action Panel */}
      <div className="shrink-0 border-t border-white/[0.08]">
        <DecisionSection event={event} replayData={replayData} onDecisionRecorded={onRefresh} />
      </div>

      {/* Timeline scrubber at bottom */}
      <div className="shrink-0">
        <TimelineScrubber
          event={event}
          currentTimestamp={historicalTimestamp}
          onTimestampChange={setHistoricalTimestamp}
        />
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const { area, setMode, clearHistorical, historicalEvent, historicalTimestamp, mode } = useAppStore()

  const [events,       setEvents]       = useState([])
  const [currency,     setCurrency]     = useState(null)
  const [coverage,     setCoverage]     = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [selectedEv,   setSelectedEv]   = useState(null)
  const [hazardFilter, setHazardFilter] = useState(null)
  const [replayData,   setReplayData]   = useState(null)
  const [eventZones,   setEventZones]   = useState([])
  const [eventSites,   setEventSites]   = useState([])

  // Load currency and coverage
  useEffect(() => {
    api.eventsCurrency()
      .then(data => setCurrency(data))
      .catch(() => setCurrency(null))

    const covParams = area ? { region_id: area.id, district: area.name } : {}
    api.eventsCoverage(covParams)
      .then(data => setCoverage(data))
      .catch(() => setCoverage(null))
  }, [area])

  // Load events
  const loadEvents = useCallback(() => {
    setLoading(true)
    const params = area
      ? { lat: area.lat, lon: area.lon, radius_km: 120 }
      : {}
    api.events(params)
      .then(data => setEvents(data ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [area])

  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  // Select event and load replay
  const handleSelectEvent = async (ev) => {
    setSelectedEv(ev)
    setMode('HISTORICAL')

    // 1. Fetch full detail
    try {
      const detail = await api.event(ev.event_id)
      setSelectedEv(detail)
    } catch (e) {
      console.warn('Using summary event detail')
    }

    // 2. Fetch zones and sites around event epicenter
    const searchParams = { lat: ev.lat, lon: ev.lon, radius_km: 120 }
    api.zones(searchParams).then(z => setEventZones(z || [])).catch(() => setEventZones([]))
    api.sites(searchParams).then(s => setEventSites(s || [])).catch(() => setEventSites([]))

    // 3. Run time-safe replay
    loadReplay(ev.event_id, ev.date_start)
  }

  const loadReplay = (eventId, timestamp) => {
    api.replayEvent(eventId, { as_of: timestamp })
      .then(rep => setReplayData(rep))
      .catch(err => {
        console.error('Replay error:', err)
        setReplayData(null)
      })
  }

  // Re-run replay when scrubber timestamp changes
  useEffect(() => {
    if (selectedEv && historicalTimestamp) {
      loadReplay(selectedEv.event_id, historicalTimestamp)
    }
  }, [selectedEv?.event_id, historicalTimestamp])

  const handleClose = () => {
    setSelectedEv(null)
    setReplayData(null)
    setEventZones([])
    setEventSites([])
    clearHistorical()
  }

  const filtered = hazardFilter
    ? events.filter(e => e.hazard_type === hazardFilter)
    : events

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">

      {/* ── Event catalog ─────────────────── */}
      <div className="w-80 shrink-0 flex flex-col border-r border-white/[0.08] bg-[#0b0f1a]/98 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-1">HISTORICAL EVENTS</div>
          {area ? (
            <div className="text-xs text-slate-300">Events near <span className="font-bold text-slate-100">{area.name}</span></div>
          ) : (
            <div className="text-xs text-slate-500 italic">All documented national disaster events</div>
          )}
        </div>

        {/* §5.2 Event-Source Coverage Status */}
        {coverage && (
          <div className="px-4 py-2 border-b border-white/[0.06] bg-[#0d1322]/60">
            <div className="flex items-center justify-between text-[8px] font-mono text-slate-400 mb-1">
              <span className="font-bold">SOURCE COVERAGE (§5.2)</span>
              <span className="text-slate-300">{coverage.status}</span>
            </div>
            <div className="flex items-center gap-2 text-[9px] font-mono">
              <span className="text-emerald-400">SDMA ✓</span>
              <span className="text-emerald-400">GDACS ✓</span>
              <span className="text-emerald-400">ReliefWeb ✓</span>
              <span className="text-slate-500">NRSC —</span>
            </div>
          </div>
        )}

        {/* Currency Honesty Badge */}
        {currency && (
          <div className="px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[8px] font-bold uppercase tracking-wider text-slate-500 font-mono">
                DATA AS OF
              </span>
              <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                currency.currency_status === 'CURRENT'
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                  : currency.currency_status === 'RECENT'
                  ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                  : 'text-orange-400 bg-orange-500/10 border-orange-500/30'
              }`}>
                {currency.currency_status}
              </span>
            </div>
            <div className="text-[10px] text-slate-300 font-medium leading-tight">
              {currency.currency_label}
            </div>
            <div className="text-[9px] text-slate-500 font-mono mt-1 flex items-center justify-between">
              <span>Latest: {currency.latest_event_date}</span>
              <span>{currency.days_since_latest}d ago</span>
            </div>
          </div>
        )}

        {/* Hazard filter */}
        <div className="flex gap-1 p-3 border-b border-white/[0.04] shrink-0 overflow-x-auto">
          <button
            onClick={() => setHazardFilter(null)}
            className={`px-2 py-1 rounded text-[9px] font-bold font-mono uppercase shrink-0 transition-all border ${
              !hazardFilter ? 'bg-white/[0.08] border-white/[0.15] text-slate-200' : 'border-white/[0.06] text-slate-600 hover:text-slate-400'
            }`}
          >ALL</button>
          {Object.entries(HAZARD_META).map(([k, m]) => (
            <button
              key={k}
              onClick={() => setHazardFilter(hazardFilter === k ? null : k)}
              className={`px-2 py-1 rounded text-[9px] font-bold font-mono uppercase shrink-0 transition-all border ${
                hazardFilter === k ? `${m.bg} ${m.border} ${m.text}` : 'border-white/[0.06] text-slate-600 hover:text-slate-400'
              }`}
            >{m.label}</button>
          ))}
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="p-4 space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="p-3 rounded-lg border border-white/[0.04] space-y-2">
                  <div className="h-2.5 w-16 rounded shimmer bg-white/[0.04]" />
                  <div className="h-3.5 w-40 rounded shimmer bg-white/[0.04]" />
                  <div className="h-2.5 w-32 rounded shimmer bg-white/[0.04]" />
                </div>
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              No events found
              {area && <div className="text-[11px] text-slate-600 mt-1">within 500 km of {area.name}</div>}
            </div>
          )}

          {!loading && filtered.map(ev => (
            <EventCard
              key={ev.event_id}
              event={ev}
              selected={selectedEv?.event_id === ev.event_id}
              onClick={handleSelectEvent}
            />
          ))}
        </div>

        {/* Return to live */}
        {mode === 'HISTORICAL' && (
          <div className="p-3 border-t border-white/[0.06] shrink-0">
            <button
              onClick={handleClose}
              className="w-full py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white text-xs font-bold uppercase tracking-wider border border-white/[0.06] transition-all"
            >
              Return to LIVE Mode
            </button>
          </div>
        )}
      </div>

      {/* ── Map + event detail ─────────────── */}
      <div className="flex-1 min-w-0 flex overflow-hidden">
        <div className="flex-1 relative">
          <HazardMap
            zones={eventZones}
            sites={eventSites}
            event={selectedEv}
            activeTimestamp={historicalTimestamp}
          />

          {/* Historical mode badge */}
          {mode === 'HISTORICAL' && selectedEv && (
            <div className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0c101d]/90 backdrop-blur-md border border-amber-500/40 shadow-xl">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300 font-mono">
                HISTORICAL REPLAY MODE — {selectedEv.data_status}
              </span>
            </div>
          )}
        </div>

        {/* Event detail sidebar with complete proactive decision chain */}
        <AnimatePresence>
          {selectedEv && (
            <motion.div
              key="event-detail"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 440, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 150, damping: 22 }}
              className="shrink-0 overflow-hidden bg-[#0b0f1a] border-l border-white/[0.12]"
            >
              <div className="w-[440px] h-full overflow-hidden">
                <EventDetail
                  event={selectedEv}
                  replayData={replayData}
                  onClose={handleClose}
                  onRefresh={loadEvents}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
