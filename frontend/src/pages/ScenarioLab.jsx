// src/pages/ScenarioLab.jsx - What-if Scenario Lab
import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { SlidersIcon, RefreshIcon, ShieldAlertIcon } from '../components/Icons'

function Slider({ label, value, min, max, step = 0.1, unit = '', onChange, id }) {
  return (
    <div className="mb-5">
      <div className="flex justify-between items-center text-xs mb-2">
        <label htmlFor={id} className="text-slate-300 font-bold tracking-tight">{label}</label>
        <span className="font-mono text-sm font-extrabold text-white bg-white/5 px-2 py-0.5 rounded">
          {value > 0 ? '+' : ''}{value.toFixed(step < 0.1 ? 2 : 1)}
          <span className="text-slate-500 font-sans ml-1 text-[10px] uppercase">{unit}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full bg-white/[0.08] appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
      />
    </div>
  )
}

function StateCard({ title, isProjected, data }) {
  const isCritical = data.riskScore > 80
  return (
    <div className={`p-6 rounded-2xl border backdrop-blur-xl relative overflow-hidden ${
      isProjected ? 'bg-slate-900/60 border-blue-500/30 shadow-[0_20px_50px_rgba(37,99,235,0.15)]' : 'bg-slate-950/60 border-white/[0.08]'
    }`}>
      {isProjected && (
        <div className="absolute top-0 right-0 px-3 py-1 bg-blue-600/20 text-blue-400 text-[9px] font-bold tracking-widest uppercase rounded-bl-lg border-b border-l border-blue-500/30">
          Simulated
        </div>
      )}
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono mb-4">{title}</div>
      
      <div className="flex items-center gap-4 mb-6">
        <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-extrabold font-mono border ${
          isCritical ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
        }`}>
          {data.riskScore}
        </div>
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Risk Score</div>
          <div className={`text-sm font-extrabold uppercase tracking-widest ${isCritical ? 'text-red-400' : 'text-amber-400'}`}>
            {isCritical ? 'CRITICAL' : 'WARNING'}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span>Flood Probability</span>
            <span className="font-mono text-slate-300">{data.floodProb}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/5"><div className="h-full rounded-full bg-blue-500 transition-all" style={{width: `${data.floodProb}%`}}/></div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span>Erosion Risk</span>
            <span className="font-mono text-slate-300">{data.erosionRisk}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/5"><div className="h-full rounded-full bg-orange-500 transition-all" style={{width: `${data.erosionRisk}%`}}/></div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            <span>Road Access</span>
            <span className="font-mono text-slate-300">{data.roadAccess}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{width: `${data.roadAccess}%`}}/></div>
        </div>
      </div>
    </div>
  )
}

export default function ScenarioLab() {
  const [params, setParams] = useState({ river: 0, rain: 0, erosion: 0 })
  const [loading, setLoading] = useState(false)

  // Derived state based on sliders
  const currentData = { riskScore: 68, floodProb: 45, erosionRisk: 60, roadAccess: 92 }
  const projectedData = {
    riskScore: Math.min(100, 68 + params.river * 12 + params.rain * 0.15 + params.erosion * 5),
    floodProb: Math.min(100, 45 + params.river * 15 + params.rain * 0.2),
    erosionRisk: Math.min(100, 60 + params.erosion * 8 + params.river * 5),
    roadAccess: Math.max(0, 92 - params.river * 10 - params.rain * 0.2)
  }

  // Format to integer
  Object.keys(projectedData).forEach(k => projectedData[k] = Math.round(projectedData[k]))

  const handleParamChange = (key, val) => {
    setLoading(true)
    setParams(p => ({ ...p, [key]: val }))
    setTimeout(() => setLoading(false), 300)
  }

  return (
    <div className="h-full flex bg-[#090d16] overflow-hidden">
      {/* Controls Sidebar */}
      <div className="w-80 shrink-0 border-r border-white/[0.08] bg-slate-950/80 backdrop-blur-xl overflow-y-auto z-10 shadow-[10px_0_30px_rgba(0,0,0,0.5)]">
        <div className="p-6 border-b border-white/[0.08] bg-slate-900/30">
          <div className="flex items-center gap-2 mb-1">
            <SlidersIcon size={16} className="text-blue-400" />
            <h1 className="text-xl font-extrabold text-white tracking-tight uppercase">Scenario Lab</h1>
          </div>
          <p className="text-xs text-slate-400 font-medium">
            Test hypothetical environmental stress on habitations.
          </p>
        </div>

        <div className="p-6">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-5 font-mono">
            Environmental Stressors
          </div>
          <Slider 
            id="sl-river" 
            label="River Level Anomaly" 
            value={params.river} 
            min={0} max={3.5} step={0.1} unit="m" 
            onChange={v => handleParamChange('river', v)} 
          />
          <Slider 
            id="sl-rain" 
            label="Excess Rainfall" 
            value={params.rain} 
            min={0} max={200} step={5} unit="mm/24h" 
            onChange={v => handleParamChange('rain', v)} 
          />
          <Slider 
            id="sl-erosion" 
            label="Erosion Rate Shift" 
            value={params.erosion} 
            min={0} max={5} step={0.5} unit="m/yr" 
            onChange={v => handleParamChange('erosion', v)} 
          />

          <button 
            onClick={() => setParams({ river: 0, rain: 0, erosion: 0 })}
            className="w-full mt-6 py-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] text-xs font-bold text-slate-300 uppercase tracking-widest transition-all"
          >
            Reset Scenario
          </button>
        </div>
      </div>

      {/* Main Canvas: Split Layout */}
      <div className="flex-1 overflow-y-auto p-10 relative flex flex-col">
        {/* Background Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

        <div className="flex items-center justify-between mb-8 relative z-10">
          <div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight uppercase">Impact Projection</h2>
            <div className="text-sm font-mono text-slate-400 mt-1">Betkuchandi Dyke Colony</div>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs font-bold text-blue-400 font-mono tracking-widest uppercase">
              <RefreshIcon size={14} className="animate-spin" />
              <span>Simulating...</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-8 relative z-10 flex-1">
          <StateCard title="Current State (Baseline)" isProjected={false} data={currentData} />
          
          <div className="relative">
            {/* Visual connector between cards */}
            <div className="absolute top-1/2 -left-4 w-4 border-t-2 border-dashed border-white/20 -translate-y-1/2 z-0" />
            <div className="absolute top-1/2 left-0 w-2 h-2 rounded-full bg-blue-500 -translate-x-1/2 -translate-y-1/2 z-10 shadow-[0_0_10px_rgba(59,130,246,1)]" />
            
            <StateCard title="Projected State (+48h)" isProjected={true} data={projectedData} />
          </div>
        </div>
        
        {projectedData.riskScore > 80 && (
          <div className="mt-8 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 flex items-center justify-between shadow-[0_0_20px_rgba(239,68,68,0.15)] relative z-10">
            <div className="flex items-center gap-3">
              <ShieldAlertIcon size={24} className="text-red-400 animate-pulse" />
              <div>
                <strong className="text-sm font-extrabold text-white uppercase tracking-tight block">Threshold Exceeded</strong>
                <span className="text-xs font-medium">Scenario triggers immediate mandatory evacuation protocols.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}