// src/pages/EventsPage.jsx
// ============================================================================
// REDZONE — Historical Events & Replay
//
// Two panels:
//   LEFT:  Catalog of real historical events, filtered by area
//   RIGHT: Map with timeline scrubber when event is selected
//
// DATA INTEGRITY:
//   - Events labeled HISTORICAL or RECONSTRUCTED — never LIVE
//   - Timeline uses coarse granularity (event-stage, daily) — not fake hourly
//   - AI analysis uses structured data — no invented facts
//   - "No hindsight leakage" principle: analysis applies to timestamp, not future
// ============================================================================

import { useEffect, useState } from 'react'
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
    HISTORICAL:    'text-amber-400 border-amber-500/30 bg-amber-500/5',
    RECONSTRUCTED: 'text-amber-300 border-amber-400/20 bg-amber-400/5',
    MODELLED:      'text-blue-400  border-blue-500/30  bg-blue-500/5',
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
    <div className="border-t border-white/[0.06] bg-[#0d1220]/90 backdrop-blur-xl">
      {/* Stage label */}
      <div className="px-4 py-3 border-b border-white/[0.04]">
        <div className="flex items-center justify-between mb-1">
          <DataLabel status={event.data_status} />
          <span className="text-[9px] text-slate-600 font-mono">{currentStage?.timestamp}</span>
        </div>
        <div className="text-xs font-bold text-slate-200">{currentStage?.label}</div>
        <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{currentStage?.description}</div>
      </div>

      {/* Stage buttons */}
      <div className="px-4 py-3">
        <div className="flex gap-1 mb-3 flex-wrap">
          {timeline.map((stage, i) => (
            <button
              key={stage.timestamp}
              onClick={() => onTimestampChange(stage.timestamp)}
              className={`px-2 py-1 rounded text-[9px] font-bold font-mono transition-all ${
                i === idx
                  ? 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
                  : 'bg-white/[0.03] border border-white/[0.06] text-slate-600 hover:text-slate-400'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => idx > 0 && onTimestampChange(timeline[idx - 1].timestamp)}
            disabled={idx === 0}
            className="p-1.5 rounded bg-white/[0.04] border border-white/[0.06] text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button
            onClick={() => setPlaying(p => !p)}
            className={`p-1.5 rounded border transition-all ${playing ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-white/[0.04] border-white/[0.06] text-slate-400 hover:text-slate-200'}`}
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
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6zm8.5-6L23 6v12z"/></svg>
          </button>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[9px] text-slate-600 font-mono">SPEED</span>
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

        <div className="text-[9px] text-slate-700 mt-2 font-mono">
          Stage {idx + 1} of {timeline.length} · Granularity: {event.timeline_granularity?.replace('_', ' ')}
        </div>
      </div>
    </div>
  )
}

// ── Event detail panel ────────────────────────────────────────────────────────

function EventDetail({ event, onClose }) {
  const { setHistoricalEvent, historicalTimestamp, setHistoricalTimestamp } = useAppStore()

  useEffect(() => {
    if (event) setHistoricalEvent(event)
    return () => { /* don't clear on unmount — user may navigate */ }
  }, [event, setHistoricalEvent])

  if (!event) return null

  const m = HAZARD_META[event.hazard_type] ?? HAZARD_META.flood

  return (
    <div className="flex flex-col h-full border-l border-white/[0.06]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center justify-between mb-2">
          <DataLabel status={event.data_status} />
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className={`text-[9px] font-bold uppercase tracking-wider font-mono mb-1 ${m.text}`}>{m.label}</div>
        <div className="text-sm font-bold text-slate-100 leading-tight">{event.name}</div>
        <div className="text-[10px] text-slate-500 mt-1">{event.region} · {event.date_start}</div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 border-b border-white/[0.06] shrink-0">
        <div className="p-3 border-r border-white/[0.04]">
          <div className="text-[9px] font-bold text-slate-600 uppercase tracking-wider font-mono mb-0.5">SEVERITY</div>
          <div className={`text-sm font-extrabold font-mono ${SEV_COLOR[event.severity]}`}>{event.severity?.toUpperCase()}</div>
        </div>
        <div className="p-3">
          <div className="text-[9px] font-bold text-slate-600 uppercase tracking-wider font-mono mb-0.5">AFFECTED</div>
          <div className="text-sm font-extrabold font-mono text-white">
            {event.affected_pop ? `${(event.affected_pop / 1000).toFixed(0)}K` : '—'}
          </div>
        </div>
      </div>

      {/* Causal chain */}
      {event.causal_chain?.length > 0 && (
        <div className="p-4 border-b border-white/[0.06] shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">EVENT PROGRESSION</div>
          <div className="space-y-1.5">
            {event.causal_chain.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex flex-col items-center mt-1 shrink-0">
                  <div className={`w-1.5 h-1.5 rounded-full ${m.text.replace('text-', 'bg-')}`} />
                  {i < event.causal_chain.length - 1 && (
                    <div className="w-px h-4 bg-white/[0.08] mt-0.5" />
                  )}
                </div>
                <div className="text-[11px] text-slate-400 leading-relaxed">{step}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source */}
      <div className="p-4 border-b border-white/[0.06] shrink-0">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-1">SOURCE</div>
        <div className="text-[11px] text-slate-400">{event.source}</div>
        {event.data_limitations && (
          <div className="mt-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/10 text-[10px] text-amber-400/80 leading-relaxed">
            <span className="font-bold">Limitations: </span>{event.data_limitations}
          </div>
        )}
      </div>

      {/* Timeline scrubber */}
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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const { area, setMode, clearHistorical, historicalEvent, mode } = useAppStore()

  const [events,      setEvents]      = useState([])
  const [loading,     setLoading]     = useState(false)
  const [selectedEv,  setSelectedEv]  = useState(null)
  const [hazardFilter,setHazardFilter]= useState(null)

  useEffect(() => {
    setLoading(true)
    const params = area
      ? { lat: area.lat, lon: area.lon, radius_km: 500 }
      : {}
    api.events(params)
      .then(data => setEvents(data ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [area])

  const handleSelectEvent = (ev) => {
    setSelectedEv(ev)
    setMode('HISTORICAL')
    // Load full event detail (with timeline, causal chain)
    api.event(ev.event_id)
      .then(detail => setSelectedEv(detail))
      .catch(() => {/* keep summary */})
  }

  const handleClose = () => {
    setSelectedEv(null)
    clearHistorical()
  }

  const filtered = hazardFilter
    ? events.filter(e => e.hazard_type === hazardFilter)
    : events

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">

      {/* ── Event catalog ─────────────────── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#0b0f1a]/95 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono mb-1">HISTORICAL EVENTS</div>
          {area ? (
            <div className="text-xs text-slate-400">Events near <span className="font-bold text-slate-200">{area.name}</span></div>
          ) : (
            <div className="text-xs text-slate-600 italic">All documented events</div>
          )}
        </div>

        {/* Hazard filter */}
        <div className="flex gap-1 p-3 border-b border-white/[0.04] shrink-0 overflow-x-auto">
          <button
            onClick={() => setHazardFilter(null)}
            className={`px-2 py-1 rounded text-[9px] font-bold font-mono uppercase shrink-0 transition-all border ${
              !hazardFilter ? 'bg-white/[0.08] border-white/[0.15] text-slate-300' : 'border-white/[0.06] text-slate-600 hover:text-slate-400'
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
            <div className="p-8 text-center text-sm text-slate-600">
              No events found
              {area && <div className="text-[11px] text-slate-700 mt-1">within 500 km of {area.name}</div>}
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
              className="w-full py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200 text-xs font-bold uppercase tracking-wider border border-white/[0.06] transition-all"
            >
              Return to LIVE
            </button>
          </div>
        )}
      </div>

      {/* ── Map + event detail ─────────────── */}
      <div className="flex-1 min-w-0 flex overflow-hidden">
        <div className="flex-1 relative">
          <HazardMap zones={[]} sites={[]} />

          {/* Historical mode overlay */}
          {mode === 'HISTORICAL' && selectedEv && (
            <div className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0c101d] border border-amber-500/40 shadow-xl">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 font-mono">HISTORICAL MODE — {selectedEv.data_status}</span>
            </div>
          )}
        </div>

        {/* Event detail sidebar */}
        <AnimatePresence>
          {selectedEv && (
            <motion.div
              key="event-detail"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 150, damping: 22 }}
              className="shrink-0 overflow-hidden bg-[#0b0f1a] border-l border-white/[0.12]"
            >
              <div className="w-80 h-full overflow-y-auto">
                <EventDetail event={selectedEv} onClose={handleClose} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
