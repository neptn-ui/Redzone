// src/components/RiskBadge.jsx
// Consistent risk classification and relocation-horizon badges across the UI.
// Reflects §10 color coding: Red / Orange / Yellow / Green.
// Materiality (§3, §4): Refraction border, inner shadow, and pulse physics.
//
// §2.2: HorizonBadge renders the primary user-facing relocation horizon.
// RiskBadge retains the legacy hazard classification color for score bars.

// ── Legacy hazard classification badge (used on score bars / audit panels) ──
const RISK_CONFIG = {
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
  const c = RISK_CONFIG[classification] || RISK_CONFIG.stable
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

// ── §2.2 Relocation Horizon Badge ────────────────────────────────────────────
// Primary user-facing status. Maps RelocationHorizon enum values to colors.

const HORIZON_CONFIG = {
  IMMEDIATE: {
    label: 'IMMEDIATE',
    dot: 'bg-red-500',
    glow: 'shadow-[0_0_10px_rgba(239,68,68,0.7)]',
    bg: 'bg-red-500/15',
    border: 'border-red-500/40',
    text: 'text-red-400',
    pulse: true,
    sublabel: 'Evacuate now',
  },
  SHORT_TERM: {
    label: 'SHORT-TERM',
    dot: 'bg-orange-500',
    glow: 'shadow-[0_0_6px_rgba(249,115,22,0.5)]',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    text: 'text-orange-400',
    pulse: false,
    sublabel: 'Weeks–1 yr',
  },
  MEDIUM_TERM: {
    label: 'MEDIUM-TERM',
    dot: 'bg-amber-400',
    glow: '',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-300',
    pulse: false,
    sublabel: '1–3 years',
  },
  MONITOR: {
    label: 'MONITOR',
    dot: 'bg-emerald-500',
    glow: '',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    pulse: false,
    sublabel: 'Observe',
  },
}

export function HorizonBadge({ horizon, size = 'sm', showSublabel = false }) {
  const h = (horizon || 'MONITOR').toUpperCase()
  const c = HORIZON_CONFIG[h] || HORIZON_CONFIG.MONITOR
  const pad = size === 'lg' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-semibold tracking-wide border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${pad} ${c.bg} ${c.border} ${c.text}`}
      title={`Relocation Horizon: ${c.label}${showSublabel ? ' · ' + c.sublabel : ''}`}
    >
      <span className="relative flex items-center justify-center">
        <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${c.glow}`} />
        {c.pulse && (
          <span className="absolute w-3 h-3 rounded-full bg-red-500/40 animate-ping pointer-events-none" />
        )}
      </span>
      <span>{c.label}</span>
      {showSublabel && (
        <span className="opacity-60 text-[10px]">· {c.sublabel}</span>
      )}
    </span>
  )
}

// ── Terrain Data Status Badge ─────────────────────────────────────────────────
// §1.1: Surfaces terrain_data_status (REAL / SYNTH / MISSING) per habitation.

const TERRAIN_CONFIG = {
  REAL:    { label: 'DEM-REAL',  bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', title: 'Terrain data derived from real DEM (Bhuvan/SRTM)' },
  SYNTH:   { label: 'SYNTH',     bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-300',   title: 'Terrain data is a calibrated SYNTH estimate — not measured' },
  MISSING: { label: '⚠ MISSING', bg: 'bg-red-500/10',     border: 'border-red-500/30',     text: 'text-red-400',     title: 'Terrain data missing — slope/proximity not in scoring' },
}

export function TerrainStatusBadge({ status }) {
  const s = (status || 'MISSING').toUpperCase()
  const c = TERRAIN_CONFIG[s] || TERRAIN_CONFIG.MISSING
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold border ${c.bg} ${c.border} ${c.text}`}
      title={c.title}
    >
      {c.label}
    </span>
  )
}

// ── Hazard-Free Site Badge ────────────────────────────────────────────────────
// §2.3: Surfaces hazard_free flag on candidate sites.

export function HazardFreeBadge({ hazardFree }) {
  if (hazardFree === null || hazardFree === undefined) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold border bg-slate-800 border-slate-700 text-slate-400" title="Hazard-free status not yet verified">
        NOT CHECKED
      </span>
    )
  }
  return hazardFree ? (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold border bg-emerald-500/10 border-emerald-500/30 text-emerald-400" title="Site verified as outside all hazard zones">
      ✓ HAZARD-FREE
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold border bg-red-500/10 border-red-500/30 text-red-400" title="Site overlaps a hazard zone — not recommended">
      ✕ HAZARD RISK
    </span>
  )
}

// ── Score bar (unchanged) ─────────────────────────────────────────────────────
export function ScoreBar({ value, classification, height = 6 }) {
  const c = RISK_CONFIG[classification] || RISK_CONFIG.stable
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
