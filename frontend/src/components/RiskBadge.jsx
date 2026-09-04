// src/components/RiskBadge.jsx
// Consistent risk classification badge across the entire UI.
// Reflects §10 color coding: Red / Orange / Yellow / Green.
// Materiality (§3, §4): Refraction border, inner shadow, and pulse physics.

const CONFIG = {
  immediate: {
    label: 'Immediate',
    dot: 'bg-red-500',
    glow: 'shadow-[0_0_8px_rgba(239,68,68,0.6)]',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
  },
  short_term: {
    label: 'Short-Term',
    dot: 'bg-orange-500',
    glow: 'shadow-[0_0_6px_rgba(249,115,22,0.5)]',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    text: 'text-orange-400',
  },
  medium_term: {
    label: 'Medium-Term',
    dot: 'bg-amber-400',
    glow: '',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-300',
  },
  stable: {
    label: 'Stable',
    dot: 'bg-emerald-500',
    glow: '',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
  },
}

export function RiskBadge({ classification, size = 'sm' }) {
  const c = CONFIG[classification] || CONFIG.stable
  const pad = size === 'lg' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-semibold tracking-wide border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${pad} ${c.bg} ${c.border} ${c.text}`}
    >
      <span className="relative flex items-center justify-center">
        <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${c.glow}`} />
        {classification === 'immediate' && (
          <span className="absolute w-3 h-3 rounded-full bg-red-500/40 animate-ping pointer-events-none" />
        )}
      </span>
      <span>{c.label}</span>
    </span>
  )
}

export function ScoreBar({ value, classification, height = 6 }) {
  const c = CONFIG[classification] || CONFIG.stable
  const pct = Math.min(100, Math.max(0, (value || 0) * 100))

  return (
    <div
      style={{ height }}
      className="w-full rounded-full bg-white/[0.06] border border-white/[0.04] overflow-hidden p-[1px]"
    >
      <div
        style={{ width: `${pct}%` }}
        className={`h-full rounded-full transition-all duration-500 ease-out ${c.dot} ${c.glow}`}
      />
    </div>
  )
}
