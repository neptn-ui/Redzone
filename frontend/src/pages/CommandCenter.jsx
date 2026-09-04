// src/pages/CommandCenter.jsx - Command Center page
// Three-column layout: KPI sidebar | Leaflet map | Decision Panel
// Multi-district support: Majuli, Dhemaji, and Cachar (Assam).
import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useZones } from '../hooks/useZones'
import { api } from '../api/client'
import HazardMap from '../components/HazardMap'
import DecisionPanel from '../components/DecisionPanel'
import { ShieldAlertIcon, UsersIcon, MapPinClusterIcon, LayersIcon } from '../components/Icons'

const DISTRICTS = ['All Assam', 'Majuli', 'Dhemaji', 'Cachar']

const RISK_COLOR = {
  immediate:   'text-red-400 bg-red-500/10 border-red-500/30',
  short_term:  'text-orange-400 bg-orange-500/10 border-orange-500/30',
  medium_term: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  stable:      'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
}

function KpiCard({ value, label, sub, accentColor = 'text-white', icon: Icon }) {
  return (
    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] mb-2 transition-all hover:bg-white/[0.05]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-slate-400">{label}</span>
        {Icon && <Icon size={14} className="text-slate-500" />}
      </div>
      <div className={`text-2xl font-extrabold font-mono tracking-tight ${accentColor}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5 font-medium">{sub}</div>}
    </div>
  )
}

function ZoneRow({ zone, selected, onSelect }) {
  const badgeClass = RISK_COLOR[zone.classification] || 'text-slate-400 bg-slate-800 border-white/10'

  return (
    <div
      id={`zone-row-${zone.habitation_id}`}
      onClick={() => onSelect(zone.habitation_id)}
      className={`px-4 py-2.5 cursor-pointer border-b border-white/[0.04] transition-all duration-150 active:scale-[0.99] ${
        selected
          ? 'bg-blue-600/15 border-l-4 border-l-blue-500 pl-3'
          : 'hover:bg-white/[0.03] border-l-4 border-l-transparent'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold text-slate-200 truncate pr-2">
          {zone.name}
        </div>
        <span className="text-[10px] font-mono text-slate-400 font-medium">
          {(zone.hazard_score * 100).toFixed(0)} <span className="text-slate-600">/100</span>
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border uppercase tracking-wider ${badgeClass}`}>
          {zone.classification.replace('_', ' ')}
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          {(zone.population || 0).toLocaleString()} ppl
        </span>
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="p-4 space-y-3 animate-pulse">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="h-10 rounded-lg bg-white/[0.03] border border-white/[0.04]" />
      ))}
    </div>
  )
}

function KpiMini({ label, value, colorClass }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-white/[0.03] last:border-0">
      <span className="text-xs font-semibold tracking-tight text-slate-300">{label}</span>
      <span className={`font-mono text-sm font-extrabold ${colorClass}`}>{value}</span>
    </div>
  )
}

export default function CommandCenter() {
  const { data: zones, loading } = useZones({}, 60000)
  const [selectedId, setSelectedId] = useState(null)
  const [selectedDistrict, setSelectedDistrict] = useState('All Assam')
  const [sites, setSites] = useState([])

  useEffect(() => {
    api.sites().then(setSites).catch(() => {})
  }, [])

  // Filter habitations & sites by selected district
  const filteredZones = useMemo(() => {
    if (!zones) return []
    if (selectedDistrict === 'All Assam') return zones
    return zones.filter(z => z.district?.toLowerCase() === selectedDistrict.toLowerCase())
  }, [zones, selectedDistrict])

  const filteredSites = useMemo(() => {
    if (!sites) return []
    if (selectedDistrict === 'All Assam') return sites
    return sites.filter(s => s.district?.toLowerCase() === selectedDistrict.toLowerCase())
  }, [sites, selectedDistrict])

  const immediate = filteredZones.filter(z => z.classification === 'immediate').sort((a, b) => b.urgency_score - a.urgency_score)
  const shortTerm = filteredZones.filter(z => z.classification === 'short_term').sort((a, b) => b.urgency_score - a.urgency_score)
  const mediumTerm = filteredZones.filter(z => z.classification === 'medium_term').sort((a, b) => b.urgency_score - a.urgency_score)
  const stable = filteredZones.filter(z => z.classification === 'stable').sort((a, b) => b.urgency_score - a.urgency_score)
  const totalAtRisk = [...immediate, ...shortTerm].reduce((s, z) => s + (z.population || 0), 0)

  const priorityGroups = [
    { id: 'p0', title: '🔴 P0 — ACT NOW', items: immediate },
    { id: 'p1', title: '🟠 P1 — RELOCATE', items: shortTerm },
    { id: 'p2', title: '🟡 P2 — PREPARE', items: mediumTerm },
    { id: 'monitor', title: '🟢 MONITOR', items: stable },
  ]

  return (
    <div className="flex w-full h-full flex-1 min-h-0 overflow-hidden bg-[#090d16]">
      {/* Situational Overview Sidebar */}
      <aside className="w-72 shrink-0 bg-slate-950/80 border-r border-white/[0.08] backdrop-blur-xl flex flex-col overflow-hidden">
        {/* District Selector Tabs */}
        <div className="p-3 border-b border-white/[0.08] bg-slate-950/60 shrink-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 font-mono">
            District Focus
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-900 border border-white/[0.06]">
            {DISTRICTS.map(d => (
              <button
                key={d}
                onClick={() => {
                  setSelectedDistrict(d)
                  setSelectedId(null)
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold tracking-tight transition-all duration-150 active:scale-[0.98] ${
                  selectedDistrict === d
                    ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.3)] border border-blue-500/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] border border-transparent'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* KPI Panel */}
        <div className="p-3.5 border-b border-white/[0.08] bg-slate-950/40 shrink-0">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 font-mono">
            <span>Situation Overview</span>
            <span className="px-1.5 py-0.5 bg-white/[0.05] rounded text-slate-500 text-[9px] border border-white/[0.05]">DEMO DATA</span>
          </div>
          
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] mb-3">
            <KpiMini label="CRITICAL / IMMEDIATE" value={immediate.length} colorClass="text-red-400" />
            <KpiMini label="SHORT-TERM RELOCATION" value={shortTerm.length} colorClass="text-orange-400" />
            <KpiMini label="PREPARE / MONITOR" value={mediumTerm.length} colorClass="text-amber-400" />
            <KpiMini label="STABLE" value={stable.length} colorClass="text-emerald-400" />
          </div>

          <KpiCard
            value={totalAtRisk.toLocaleString()}
            label="Vulnerable Population"
            sub="Immediate + Short-term flood zones"
            accentColor="text-blue-400"
            icon={UsersIcon}
          />
        </div>

        {/* Habitation Selector List */}
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono shrink-0">
          <span>Priority Queue</span>
          <span className="text-slate-500 font-mono">{filteredZones.length} shown</span>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.02] pb-10">
          {loading && <ListSkeleton />}
          
          {!loading && priorityGroups.map(group => group.items.length > 0 && (
            <div key={group.id}>
              <div className="sticky top-0 bg-slate-950/95 backdrop-blur-md px-4 py-1.5 text-[10px] font-bold text-slate-300 tracking-widest font-mono border-b border-white/[0.04] z-10 shadow-sm">
                {group.title}
              </div>
              <div>
                {group.items.map(z => (
                  <ZoneRow
                    key={z.habitation_id}
                    zone={z}
                    selected={z.habitation_id === selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            </div>
          ))}

          {!loading && filteredZones.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-500">
              No habitations found in this district.
            </div>
          )}
        </div>
      </aside>

      {/* Main Map Canvas */}
      <div className="flex-1 relative flex flex-col min-w-0 h-full overflow-hidden">
        <HazardMap
          zones={filteredZones}
          sites={filteredSites}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* Slide-in Decision Panel */}
      <DecisionPanel
        habitationId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}