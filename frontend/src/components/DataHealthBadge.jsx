// src/components/DataHealthBadge.jsx
// §11 — Data Health Badge shown in the top-right of the header.
// Polls /api/data-health every 60 seconds.
// Clean SVG primitives (Anti-Emoji §2) with perpetual breathing pulse (§4, §9).
import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { RainIcon, SeismicIcon, RadarIcon } from './Icons'

export default function DataHealthBadge() {
  const [health, setHealth] = useState(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    const fetch = () =>
      api.dataHealth()
         .then(d => { setHealth(d); setErr(false) })
         .catch(() => setErr(true))
    fetch()
    const t = setInterval(fetch, 60_000)
    return () => clearInterval(t)
  }, [])

  if (err || !health) {
    return (
      <span
        id="data-health-badge"
        title="Live signal feeds unreachable"
        className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 border border-red-500/30 text-red-400 shadow-[inset_0_1px_0_rgba(239,68,68,0.1)]"
      >
        <span className="w-2 h-2 rounded-full bg-red-500" />
        <span>No Live Signal</span>
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
    : anyLive
    ? 'bg-amber-400'
    : 'bg-orange-400'

  const label = bothLive ? 'Telemetry Live' : anyLive ? 'Partial Feed' : 'Cached'
  const title = [
    `Rainfall: ${rain.value_mm_per_hr ?? '—'} mm/hr (${rain.status ?? '?'}, ${rain.age_minutes ?? '?'} min ago)`,
    `Seismic: M${seis.value_magnitude ?? '—'} (${seis.status ?? '?'}, ${seis.age_minutes ?? '?'} min ago)`,
  ].join('\n')

  return (
    <div
      id="data-health-badge"
      title={title}
      className={`inline-flex items-center gap-2.5 px-3 py-1 rounded-full text-xs font-medium border backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all cursor-default ${colorClass}`}
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
    </div>
  )
}
