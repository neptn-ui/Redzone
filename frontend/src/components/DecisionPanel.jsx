// src/components/DecisionPanel.jsx
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useZoneDetail } from '../hooks/useZones'
import { ShieldAlertIcon, CloseIcon, LocationIcon, RefreshIcon } from './Icons'

function TrajectoryChart() {
  // A simple simulated SVG line chart for Risk Trajectory
  return (
    <div className="relative h-24 w-full bg-slate-950/50 rounded-xl border border-white/[0.04] p-3 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-t from-red-500/10 to-transparent pointer-events-none" />
      <svg className="w-full h-full overflow-visible" viewBox="0 0 100 40" preserveAspectRatio="none">
        <path
          d="M0 35 Q 20 30, 40 25 T 80 10 L 100 5"
          fill="none"
          stroke="#ef4444"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]"
        />
        <line x1="0" y1="15" x2="100" y2="15" stroke="#f97316" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
        <text x="2" y="13" fill="#f97316" fontSize="4" fontFamily="monospace" opacity="0.7">Critical Threshold</text>
      </svg>
      <div className="absolute bottom-1.5 left-3 right-3 flex justify-between text-[8px] font-mono text-slate-500 font-bold tracking-wider">
        <span>NOW</span>
        <span>+2h</span>
        <span>+4h</span>
        <span>+6h</span>
        <span>+12h</span>
      </div>
    </div>
  )
}

function BreakdownBar({ label, value }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between items-center text-[11px] mb-1">
        <span className="text-slate-300 font-medium">{label}</span>
        <span className="font-mono text-slate-200">{value}</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-white/[0.04] overflow-hidden p-[0.5px]">
        <div
          className="h-full rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)]"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  )
}

export default function DecisionPanel({ habitationId, onClose }) {
  const { data, loading, error } = useZoneDetail(habitationId)
  const navigate = useNavigate()

  if (!habitationId) {
    return (
      <aside className="w-[420px] shrink-0 bg-slate-950/70 border-l border-white/[0.08] backdrop-blur-xl flex flex-col items-center justify-center p-10 text-center text-slate-500">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-slate-400 mb-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <ShieldAlertIcon size={26} />
        </div>
        <div className="font-bold text-slate-300 text-sm mb-2 tracking-tight">Priority Actions Overview</div>
        <div className="text-xs text-slate-500 max-w-[240px] leading-relaxed">
          Select a habitation from the priority queue or map to access hazard intelligence and generate relocation plans.
        </div>
      </aside>
    )
  }

  if (loading) {
    return (
      <aside className="w-[420px] shrink-0 bg-slate-950/90 border-l border-white/[0.08] backdrop-blur-2xl flex flex-col p-6 space-y-5 animate-pulse">
        <div className="h-8 w-3/4 rounded-lg bg-white/[0.05]" />
        <div className="h-32 w-full rounded-xl bg-white/[0.03] border border-white/[0.04]" />
        <div className="h-40 w-full rounded-xl bg-white/[0.03] border border-white/[0.04]" />
      </aside>
    )
  }

  if (error || !data) return null

  const isCritical = data.classification === 'immediate' || data.classification === 'short_term'
  
  return (
    <motion.aside
      id="decision-panel"
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      className="w-[420px] shrink-0 bg-slate-950/95 border-l border-white/[0.08] backdrop-blur-3xl flex flex-col h-full overflow-hidden shadow-[-20px_0_50px_rgba(0,0,0,0.5)]"
    >
      {/* Header */}
      <div className="p-6 border-b border-white/[0.06] bg-slate-900/30 flex items-start justify-between shrink-0 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-3">
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 transition-all">
            <CloseIcon size={16} />
          </button>
        </div>
        
        <div className="z-10 pr-6 w-full">
          <h2 className="text-xl font-extrabold text-white tracking-tight leading-tight mb-2 uppercase">{data.name}</h2>
          <div className="flex items-center gap-4 mb-4">
            <div className="text-sm font-semibold text-slate-300">
              <span className="font-mono text-white">{(data.population || 0).toLocaleString()}</span> residents
            </div>
          </div>
          
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono mb-0.5">Risk Score</div>
              <div className="flex items-baseline gap-1">
                <span className={`text-3xl font-extrabold font-mono tracking-tighter ${isCritical ? 'text-red-400' : 'text-amber-400'}`}>
                  {(data.hazard_score * 100).toFixed(0)}
                </span>
                <span className="text-xs font-mono text-slate-500">/ 100</span>
              </div>
            </div>
            <div className={`px-3 py-1 rounded border text-xs font-bold uppercase tracking-widest ${
              isCritical ? 'bg-red-500/10 border-red-500/30 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}>
              {isCritical ? 'CRITICAL' : 'WARNING'}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
        
        {/* Risk Trajectory */}
        <div className="p-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 font-mono">Risk Trajectory</div>
          <TrajectoryChart />
        </div>

        {/* Explainable Breakdown */}
        <div className="p-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4 font-mono">Why is this high?</div>
          <div className="space-y-3">
            <BreakdownBar label="Flood probability" value={31} />
            <BreakdownBar label="Riverbank erosion" value={24} />
            <BreakdownBar label="Population exposure" value={18} />
            <BreakdownBar label="Road accessibility" value={8} />
            <BreakdownBar label="Historical exposure" value={6} />
          </div>
        </div>

        {/* Evidence */}
        <div className="p-6 bg-slate-900/20">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 font-mono">Evidence</div>
          <ul className="space-y-2 text-xs text-slate-300 font-medium">
            <li className="flex items-start gap-2">
              <span className="text-red-400 mt-0.5">•</span> River level rising rapidly
            </li>
            <li className="flex items-start gap-2">
              <span className="text-orange-400 mt-0.5">•</span> Active erosion front detected
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 mt-0.5">•</span> High population exposure
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">•</span> Primary access road vulnerable
            </li>
          </ul>
        </div>

        {/* Recommended Action */}
        <div className="p-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 font-mono">Recommended Action</div>
          
          {isCritical ? (
            <div className="mb-5 flex items-center gap-3 p-3.5 rounded-xl border border-red-500/40 bg-red-500/10 shadow-[0_0_20px_rgba(239,68,68,0.15)]">
              <ShieldAlertIcon size={24} className="text-red-400 shrink-0 animate-pulse" />
              <div className="text-sm font-extrabold tracking-tight text-white uppercase">
                🚨 Relocate Within 12 Hours
              </div>
            </div>
          ) : (
            <div className="mb-5 flex items-center gap-3 p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10">
              <ShieldAlertIcon size={24} className="text-amber-400 shrink-0" />
              <div className="text-sm font-extrabold tracking-tight text-white uppercase">
                Prepare Evacuation Route
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">Priority</div>
              <div className={`text-sm font-bold mt-0.5 ${isCritical ? 'text-red-400' : 'text-amber-400'}`}>
                {isCritical ? 'P1 / CRITICAL' : 'P2 / WARNING'}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">Confidence</div>
              <div className="text-sm font-bold mt-0.5 text-blue-400">91%</div>
            </div>
          </div>

          <div className="space-y-2.5">
            <button 
              onClick={() => navigate('/planner')}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold tracking-wide uppercase transition-all shadow-[0_4px_12px_rgba(37,99,235,0.4),inset_0_1px_0_rgba(255,255,255,0.2)] active:scale-[0.98]"
            >
              Generate Relocation Plan
            </button>
            <button 
              onClick={() => navigate('/safe-sites')}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold tracking-wide uppercase transition-all border border-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] active:scale-[0.98]"
            >
              View Safe Sites
            </button>
          </div>
        </div>

        {/* Explainable AI & Audit Trail */}
        <div className="p-6 bg-slate-900/50">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4 font-mono">AI-Assisted Prioritization</div>
          
          <div className="text-xs text-slate-400 leading-relaxed mb-5">
            Risk score is calculated from flood probability, river proximity, elevation, erosion trend, population density, road accessibility, and historical flood exposure.
          </div>

          <div className="flex items-center gap-4 text-[10px] font-mono text-slate-500 mb-6 border-b border-white/[0.04] pb-5">
            <div>Model: <strong className="text-slate-300">REDZONE Risk Model v1.4</strong></div>
            <div>Updated: <strong className="text-slate-300">22:41</strong></div>
          </div>

          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 font-mono">Decision Audit Trail</div>
          <div className="space-y-3 relative before:absolute before:inset-y-1 before:left-1.5 before:w-px before:bg-white/10">
            {[
              { time: '22:41', text: 'Risk model updated' },
              { time: '22:42', text: 'Betkuchandi priority increased' },
              { time: '22:43', text: 'B-17 selected as optimal site' },
              { time: '22:44', text: 'Primary route validated' }
            ].map((event, i) => (
              <div key={i} className="flex items-start gap-3 relative z-10">
                <div className="w-3 h-3 rounded-full bg-slate-900 border-2 border-blue-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-bold font-mono text-blue-400">{event.time}</div>
                  <div className="text-xs text-slate-300 font-medium">{event.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.aside>
  )
}
