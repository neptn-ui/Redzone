// src/App.jsx
// ============================================================================
// REDZONE — Root application shell
//
// Design principles (design-taste-frontend-v1):
//   VISUAL_DENSITY: 8 (cockpit mode — data dense, 1px dividers)
//   MOTION_INTENSITY: 5 (functional motion only)
//   DESIGN_VARIANCE: 7 (asymmetric, operational)
//
// The nav is a thin left sidebar + persistent map canvas.
// Area and mode context shown in a compact top bar.
// ============================================================================

import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { AppStoreProvider, useAppStore } from './context/AppStore'

// Pages
import CommandCenter     from './pages/CommandCenter'
import HazardIntelligence from './pages/HazardIntelligence'
import SafeSiteIntelligence from './pages/SafeSiteIntelligence'
import RelocationPlanner from './pages/RelocationPlanner'
import EventsPage        from './pages/EventsPage'
import ScenarioLab       from './pages/ScenarioLab'
import Reports           from './pages/Reports'

// Components
import AreaSearch        from './components/AreaSearch'
import DataHealthBadge   from './components/DataHealthBadge'

// Icons
import {
  RadarIcon, ShieldAlertIcon, LocationIcon, LayersIcon,
  MapPinClusterIcon, SlidersIcon, FilterIcon,
} from './components/Icons'

// ── Nav definition ────────────────────────────────────────────────────────────

const NAV = [
  { to: '/',          label: 'Command',   Icon: RadarIcon,         title: 'Command Center — situational overview' },
  { to: '/hazard',    label: 'Hazards',   Icon: ShieldAlertIcon,   title: 'Hazard Intelligence' },
  { to: '/safe-sites',label: 'Safe Sites',Icon: LocationIcon,      title: 'Safe Site Intelligence' },
  { to: '/planner',   label: 'Relocate',  Icon: LayersIcon,        title: 'Relocation Planner' },
  { to: '/events',    label: 'Events',    Icon: MapPinClusterIcon, title: 'Historical Events' },
  { to: '/scenario',  label: 'Scenarios', Icon: SlidersIcon,       title: 'Scenario Lab — What-If Analysis' },
  { to: '/reports',   label: 'Reports',   Icon: FilterIcon,        title: 'Reports & Decision Audit' },
]

// ── Live clock ────────────────────────────────────────────────────────────────

function Clock() {
  const [t, setT] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
      {t.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}
      {' '}
      <span className="text-slate-600">IST</span>
    </span>
  )
}

// ── Mode indicator ────────────────────────────────────────────────────────────

function ModeIndicator() {
  const { mode, modeMeta } = useAppStore()
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-widest ${modeMeta.bgClass} ${modeMeta.borderClass} ${modeMeta.textClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${modeMeta.dotClass} ${mode === 'LIVE' ? 'animate-pulse' : ''}`} />
      {modeMeta.label}
    </div>
  )
}

// ── Area breadcrumb ───────────────────────────────────────────────────────────

function AreaBreadcrumb() {
  const { area, areaStatus } = useAppStore()
  if (areaStatus === 'loading') {
    return <span className="text-[11px] text-slate-500 font-mono animate-pulse">Locating...</span>
  }
  if (!area) {
    return <span className="text-[11px] text-slate-600 font-mono italic">No area selected — search to begin</span>
  }
  const parts = [area.country, area.state, area.name].filter(Boolean)
  return (
    <span className="text-[11px] text-slate-400 font-mono tracking-wider uppercase">
      {parts.map((p, i) => (
        <span key={p}>
          {i > 0 && <span className="text-slate-700 mx-1">/</span>}
          <span className={i === parts.length - 1 ? 'text-slate-200 font-bold' : ''}>{p}</span>
        </span>
      ))}
    </span>
  )
}

// ── No area empty state ───────────────────────────────────────────────────────

function NoCoverage() {
  const { area } = useAppStore()
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-12 text-center bg-[#090d16]">
      <div className="w-16 h-16 rounded-2xl border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
        <MapPinClusterIcon size={28} className="text-slate-600" />
      </div>
      <div>
        <div className="text-lg font-bold text-slate-300 mb-2">
          {area ? 'No data available for this area' : 'Search to begin'}
        </div>
        <div className="text-sm text-slate-500 max-w-md leading-relaxed">
          {area
            ? `REDZONE does not currently hold habitation or site records within 100 km of ${area.name}. The platform holds pilot data for select districts. Use the search bar above to try a supported area.`
            : 'Use the search bar to select a geographic area. The platform will load available hazard intelligence, risk zones, and safe sites for that location.'}
        </div>
      </div>
      {area && (
        <div className="px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5 text-[11px] text-amber-400 font-mono max-w-sm">
          DATA STATUS: UNAVAILABLE — Not a zero reading. Data simply not held for this geography.
        </div>
      )}
    </div>
  )
}

// ── Shell (inner — has access to store) ──────────────────────────────────────

function Shell() {
  const { area, areaStatus } = useAppStore()
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(!area)

  return (
    <div className="flex flex-col w-full h-full min-h-[100dvh] bg-[#090d16] text-slate-100 overflow-hidden">

      {/* ── Top bar ── */}
      <header className="shrink-0 h-10 flex items-center gap-0 border-b border-white/[0.06] bg-[#0b0f1a]/90 backdrop-blur-xl z-50">
        {/* Brand */}
        <div className="w-44 shrink-0 flex items-center gap-2 px-4 border-r border-white/[0.06] h-full">
          <div className="w-5 h-5 rounded bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
            <RadarIcon size={11} className="text-blue-400" />
          </div>
          <span className="text-xs font-extrabold tracking-widest uppercase text-slate-100">REDZONE</span>
        </div>

        {/* Area breadcrumb */}
        <div className="flex-1 flex items-center gap-3 px-4 min-w-0">
          <AreaBreadcrumb />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 px-4 border-l border-white/[0.06] h-full">
          <ModeIndicator />
          <Clock />
          <DataHealthBadge />
          <button
            id="global-search-btn"
            onClick={() => setSearchOpen(true)}
            aria-label="Search for area"
            className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-slate-400 hover:text-slate-200 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <span className="font-mono">{area ? area.name : 'Search area...'}</span>
            <span className="text-slate-600 text-[9px] font-mono">⌘K</span>
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left nav ── */}
        <nav className="w-44 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#0b0f1a]/60 z-40">
          <div className="flex-1 py-3 space-y-0.5 px-2">
            {NAV.map(({ to, label, Icon, title }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                title={title}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all group ${
                    isActive
                      ? 'bg-blue-600/15 text-blue-300 border border-blue-500/20'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={14} className={isActive ? 'text-blue-400' : 'text-slate-600 group-hover:text-slate-400'} />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>

          {/* Bottom area status */}
          <div className="p-3 border-t border-white/[0.04] shrink-0">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">Coverage</div>
            {area ? (
              <div className="text-[10px] text-slate-500 font-mono leading-tight">
                {area.name}<br />
                <span className={areaStatus === 'ready' ? 'text-emerald-500' : 'text-slate-600'}>
                  {areaStatus === 'ready' ? 'DATA LOADED' : areaStatus.toUpperCase()}
                </span>
              </div>
            ) : (
              <div className="text-[10px] text-slate-700 italic">No area selected</div>
            )}
          </div>
        </nav>

        {/* ── Page canvas ── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
          <Routes>
            <Route path="/"           element={<CommandCenter />} />
            <Route path="/hazard"     element={<HazardIntelligence />} />
            <Route path="/safe-sites" element={<SafeSiteIntelligence />} />
            <Route path="/planner"    element={<RelocationPlanner />} />
            <Route path="/events"     element={<EventsPage />} />
            <Route path="/scenario"   element={<ScenarioLab />} />
            <Route path="/reports"    element={<Reports />} />
            <Route path="*"           element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      {/* ── Global search overlay ── */}
      {searchOpen && (
        <AreaSearch onClose={() => setSearchOpen(false)} />
      )}

      {/* Keyboard shortcut */}
      <KeyboardListener onSearch={() => setSearchOpen(true)} />
    </div>
  )
}

function KeyboardListener({ onSearch }) {
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onSearch()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSearch])
  return null
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AppStoreProvider>
      <Shell />
    </AppStoreProvider>
  )
}