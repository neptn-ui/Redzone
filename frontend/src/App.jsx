// src/App.jsx - Root application shell
// §2 Default Architecture & Conventions: Outfit typography, min-h-[100dvh], Liquid Glass Refraction (§4)
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import CommandCenter from './pages/CommandCenter'
import SafeSiteIntelligence from './pages/SafeSiteIntelligence'
import RelocationPlanner from './pages/RelocationPlanner'
import ScenarioLab from './pages/ScenarioLab'
import Reports from './pages/Reports'
import DataHealthBadge from './components/DataHealthBadge'
import { ShieldAlertIcon, LayersIcon, SlidersIcon, MapPinClusterIcon, LocationIcon, UsersIcon } from './components/Icons'

const NAV = [
  { to: '/',           label: 'Command Center',         icon: LayersIcon },
  { to: '/hazard',     label: 'Hazard Intelligence',    icon: ShieldAlertIcon },
  { to: '/safe-sites', label: 'Safe Site Intelligence', icon: LocationIcon },
  { to: '/planner',    label: 'Relocation Planner',     icon: UsersIcon },
  { to: '/scenario',   label: 'Scenario Lab',           icon: SlidersIcon },
  { to: '/reports',    label: 'Reports',                icon: MapPinClusterIcon },
]

export default function App() {
  return (
    <div className="h-screen w-full flex flex-col bg-[#090d16] text-slate-100 font-sans selection:bg-blue-600/30 selection:text-blue-200 overflow-hidden">
      {/* Liquid Glass Command Header */}
      <header className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-white/[0.08] bg-slate-950/70 backdrop-blur-xl z-50 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-3.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 shadow-[0_0_12px_rgba(239,68,68,0.25)]">
            <ShieldAlertIcon size={18} />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold tracking-tight text-white">REDZONE</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-500/10 border border-blue-500/25 text-blue-400 uppercase tracking-wider">
                SIH26191
              </span>
              <span className="ml-2 px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-orange-500/20 border border-orange-500/40 text-orange-400 tracking-widest uppercase flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
                Simulation Mode
              </span>
            </div>
            <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">
              Assam Flood & Erosion Relocation Engine · Majuli, Dhemaji & Cachar (ASDMA / NDRF)
            </span>
          </div>
        </div>

        {/* Tactile Nav Tabs */}
        <nav className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/80 border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" aria-label="Main navigation">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-tight transition-all duration-200 active:scale-[0.98]
                ${isActive
                  ? 'bg-blue-600 text-white shadow-[0_2px_10px_rgba(37,99,235,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] border border-blue-500/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent'
                }
              `}
            >
              <Icon size={14} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Live Signal Telemetry Badge */}
        <div className="flex items-center gap-3">
          <DataHealthBadge />
        </div>
      </header>

      {/* Main Viewport Container */}
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        <Routes>
          <Route path="/"            element={<CommandCenter />} />
          <Route path="/hazard"      element={<CommandCenter />} />
          <Route path="/safe-sites"  element={<SafeSiteIntelligence />} />
          <Route path="/planner"     element={<RelocationPlanner />} />
          <Route path="/scenario"    element={<ScenarioLab />}  />
          <Route path="/reports"     element={<Reports />}      />
          <Route path="*"            element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}