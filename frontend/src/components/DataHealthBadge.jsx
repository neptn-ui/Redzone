// src/components/DataHealthBadge.jsx
// ============================================================================
// CHANGES:
// - Expanded to show a breakdown popover on click showing signal-by-signal status
// - Shows feed name, staleness, value, and quality indicator
// - Preserved all existing compact badge logic
// ============================================================================

import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import { RainIcon, SeismicIcon } from './Icons'

function SignalRow({ icon: Icon, name, value, unit, status, ageMin, color }) {
  const statusColors = {
    ok:     { dot: 'bg-emerald-400', label: 'text-emerald-400', text: 'LIVE' },
    cached: { dot: 'bg-amber-400',   label: 'text-amber-400',   text: 'CACHED' },
    error:  { dot: 'bg-red-400',     label: 'text-red-400',     text: 'ERROR' },
    stale:  { dot: 'bg-orange-400',  label: 'text-orange-400',  text: 'STALE' },
  }
  const s = statusColors[status] || statusColors.error

  return (
    <div className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
      <div className="shrink-0">
        <Icon size={14} className={color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300">{name}</span>
          <span className={`text-[9px] font-bold uppercase tracking-widest ${s.label}`}>{s.text}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] font-mono text-white">
            {value != null ? `${value}${unit ? ` ${unit}` : ''}` : '—'}
          </span>
          {ageMin != null && (
            <span className="text-[9px] text-slate-600 font-mono">{ageMin}min ago</span>
          )}
        </div>
      </div>
      <div className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
    </div>
  )
}

export default function DataHealthBadge() {
  const [health, setHealth] = useState(null)
  const [err, setErr] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    const fetch = () =>
      api.dataHealth()
         .then(d => { setHealth(d); setErr(false) })
         .catch(() => setErr(true))
    fetch()
    const t = setInterval(fetch, 60_000)
    return () => clearInterval(t)
  }, [])

  // Close popover on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (err || !health) {
    return (
      <span
        id="data-health-badge"
        title="Live signal feeds unreachable"
        className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 border border-red-500/30 text-red-400"
      >
        <span className="w-2 h-2 rounded-full bg-red-500" />
        <span>No Feed</span>
      </span>
    )
  }

  const rain = health.rainfall || {}
  const seis = health.seismic || {}
  const bothLive = rain.status === 'ok' && seis.status === 'ok'
  const anyLive  = rain.status === 'ok' || seis.status === 'ok'

  const colorClass = bothLive
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    : anyLive
    ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
    : 'text-orange-400 bg-orange-500/10 border-orange-500/30'

  const dotClass = bothLive
    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
    : anyLive ? 'bg-amber-400' : 'bg-orange-400'

  const label = bothLive ? 'Telemetry Live' : anyLive ? 'Partial Feed' : 'Cached'

  // Overall health % (2 signals)
  const liveCount = [rain.status === 'ok', seis.status === 'ok'].filter(Boolean).length
  const healthPct = Math.round((liveCount / 2) * 100)

  return (
    <div ref={containerRef} className="relative">
      {/* Badge Button */}
      <button
        id="data-health-badge"
        onClick={() => setPopoverOpen(!popoverOpen)}
        className={`inline-flex items-center gap-2.5 px-3 py-1 rounded-full text-xs font-medium border backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all cursor-pointer hover:brightness-110 ${colorClass}`}
        aria-expanded={popoverOpen}
        aria-label={`Data health: ${healthPct}% — ${label}`}
      >
        <div className="relative flex items-center justify-center">
          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          {bothLive && (
            <span className="absolute w-3.5 h-3.5 rounded-full bg-emerald-400/40 animate-ping pointer-events-none" />
          )}
        </div>

        <span className="tracking-wide font-semibold text-[11px]">{label}</span>

        {rain.value_mm_per_hr != null && (
          <span className="inline-flex items-center gap-1 pl-1 border-l border-white/10 text-slate-300 font-mono text-[11px]">
            <RainIcon size={12} className="text-blue-400" />
            <span>{rain.value_mm_per_hr.toFixed(1)} <span className="text-[9px] text-slate-400 font-sans">mm/h</span></span>
          </span>
        )}

        {seis.value_magnitude != null && (
          <span className="inline-flex items-center gap-1 pl-1 border-l border-white/10 text-slate-300 font-mono text-[11px]">
            <SeismicIcon size={12} className="text-amber-400" />
            <span>M{seis.value_magnitude.toFixed(1)}</span>
          </span>
        )}

        {/* Chevron */}
        <svg
          className={`text-slate-500 transition-transform duration-200 ${popoverOpen ? 'rotate-180' : ''}`}
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Popover */}
      {popoverOpen && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-[#0c101d] border border-white/[0.15] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.95)] z-[9999] p-4 animate-in">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-3 font-mono">
            DATA SIGNAL STATUS
          </div>

          <SignalRow
            icon={RainIcon}
            name="Rainfall"
            value={rain.value_mm_per_hr?.toFixed(1)}
            unit="mm/hr"
            status={rain.status}
            ageMin={rain.age_minutes}
            color="text-blue-400"
          />
          <SignalRow
            icon={SeismicIcon}
            name="Seismic"
            value={seis.value_magnitude != null ? `M${seis.value_magnitude.toFixed(1)}` : null}
            status={seis.status}
            ageMin={seis.age_minutes}
            color="text-amber-400"
          />

          {/* Overall health bar */}
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <div className="flex justify-between items-center text-[10px] mb-1.5">
              <span className="text-slate-500 font-bold uppercase tracking-wider">Overall Signal Health</span>
              <span className={`font-mono font-bold ${healthPct === 100 ? 'text-emerald-400' : healthPct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                {healthPct}%
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/[0.04]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${healthPct === 100 ? 'bg-emerald-400' : healthPct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${healthPct}%` }}
              />
            </div>
            <div className="text-[9px] text-slate-600 mt-2 font-mono">
              {liveCount}/{2} live feeds active · Polling every 60s
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-white/[0.04] text-[9px] text-slate-600 leading-relaxed">
            Data from Open-Meteo (rainfall) and USGS Earthquake API (seismic). Cached values indicate the feed was temporarily unreachable at last poll.
          </div>
        </div>
      )}
    </div>
  )
}
