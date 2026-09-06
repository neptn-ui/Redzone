// src/pages/PriorityQueue.jsx - Priority Queue page
// WHO SHOULD MOVE FIRST? Full ranked table with filters.
//
// §0 REGION-AGNOSTIC: District filter now loads from the regions API.
//   No hardcoded "Assam / Majuli / Dhemaji / Cachar" references.
//
// §2.2: Shows HorizonBadge (IMMEDIATE/SHORT_TERM/MEDIUM_TERM/MONITOR)
//   as the primary status column.
//
// §1.1: Shows TerrainStatusBadge per habitation row.

import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePriorityQueue } from '../hooks/useZones'
import { RiskBadge, HorizonBadge, TerrainStatusBadge } from '../components/RiskBadge'
import { FilterIcon, UsersIcon, ShieldAlertIcon } from '../components/Icons'
import { api } from '../api/client'

// Horizon filter buttons (§2.2)
const HORIZON_FILTERS = [
  { label: 'All',          value: '' },
  { label: 'Immediate',    value: 'IMMEDIATE' },
  { label: 'Short-Term',   value: 'SHORT_TERM' },
  { label: 'Medium-Term',  value: 'MEDIUM_TERM' },
  { label: 'Monitor',      value: 'MONITOR' },
]

function RankIndicator({ rank, horizon }) {
  const accent = {
    IMMEDIATE:   'text-red-400 bg-red-500/10 border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.2)]',
    SHORT_TERM:  'text-orange-400 bg-orange-500/10 border-orange-500/30',
    MEDIUM_TERM: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    MONITOR:     'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  }[(horizon || '').toUpperCase()] || 'text-slate-400 bg-slate-800 border-white/10'

  return (
    <div className={`w-7 h-7 mx-auto rounded-lg border flex items-center justify-center font-mono text-xs font-bold ${accent}`}>
      {rank}
    </div>
  )
}

function QueueRow({ item, rank, index }) {
  const barColor = {
    IMMEDIATE:   'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]',
    SHORT_TERM:  'bg-orange-500',
    MEDIUM_TERM: 'bg-amber-400',
    MONITOR:     'bg-emerald-500',
  }[(item.relocation_horizon || '').toUpperCase()] || 'bg-slate-400'

  return (
    <motion.tr
      id={`pq-row-${item.habitation_id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 120, damping: 20, delay: Math.min(index * 0.03, 0.4) }}
      className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors group"
    >
      <td className="py-3 px-4 text-center">
        <RankIndicator rank={rank} horizon={item.relocation_horizon} />
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-slate-100 group-hover:text-blue-400 transition-colors">
            {item.name}
          </span>
          {item.district && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 border border-white/[0.05]">
              {item.district}
            </span>
          )}
          {item.region_name && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {item.region_name}
            </span>
          )}
          {item.terrain_data_status && (
            <TerrainStatusBadge status={item.terrain_data_status} />
          )}
        </div>
        <div className="text-xs text-slate-400 mt-0.5 font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60" />
          <span>{item.matched_site ? `Relocates to: ${item.matched_site}` : 'Site pending allocation'}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-center">
        <HorizonBadge horizon={item.relocation_horizon} showSublabel={false} />
      </td>
      <td className="py-3 px-4 w-44">
        <div className="flex items-center justify-between text-xs mb-1.5 font-mono">
          <span className="text-slate-400">Urgency</span>
          <span className="font-bold text-slate-200">{(item.urgency_score * 100).toFixed(0)} <span className="text-[10px] text-slate-500">/100</span></span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden p-[1px]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.min(100, item.urgency_score * 100)}%` }}
          />
        </div>
      </td>
      <td className="py-3 px-4 text-right font-mono text-sm text-slate-300 font-semibold tabular-nums">
        {(item.population || 0).toLocaleString()}
      </td>
      <td className="py-3 px-4 text-right font-mono text-sm text-slate-300 font-semibold tabular-nums">
        {(item.hazard_score * 100).toFixed(0)}
      </td>
    </motion.tr>
  )
}

function TableSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      {[1, 2, 3, 4, 5, 6].map(i => (
        <div key={i} className="h-12 w-full rounded-xl bg-white/[0.03] border border-white/[0.04]" />
      ))}
    </div>
  )
}

export default function PriorityQueue() {
  const [horizonFilter, setHorizonFilter] = useState('')
  const [selectedRegion, setSelectedRegion] = useState('All Regions')
  const [regions, setRegions] = useState([])

  // Load active regions from API (§0: no hardcoded region list)
  useEffect(() => {
    api.get('/api/regions')
      .then(data => {
        setRegions(data || [])
      })
      .catch(() => setRegions([]))
  }, [])

  const { data, loading, error } = usePriorityQueue({ min_urgency: 0, limit: 500 }, 30000)

  const filtered = useMemo(() => {
    return (data || []).filter(item => {
      const matchHorizon = !horizonFilter || (item.relocation_horizon || '').toUpperCase() === horizonFilter
      const matchRegion  = selectedRegion === 'All Regions' || item.region_name === selectedRegion
      return matchHorizon && matchRegion
    })
  }, [data, horizonFilter, selectedRegion])

  // Summary counts from data
  const counts = useMemo(() => {
    const all = data || []
    return {
      IMMEDIATE:   all.filter(i => (i.relocation_horizon || '').toUpperCase() === 'IMMEDIATE').length,
      SHORT_TERM:  all.filter(i => (i.relocation_horizon || '').toUpperCase() === 'SHORT_TERM').length,
      MEDIUM_TERM: all.filter(i => (i.relocation_horizon || '').toUpperCase() === 'MEDIUM_TERM').length,
      MONITOR:     all.filter(i => (i.relocation_horizon || '').toUpperCase() === 'MONITOR').length,
    }
  }, [data])

  return (
    <div className="h-full flex flex-col bg-[#090d16] overflow-hidden">
      {/* Top Header Controls */}
      <div className="px-8 py-5 border-b border-white/[0.08] bg-slate-950/40 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">Priority Queue</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400">
              {regions.length > 0 ? `${regions.length} region${regions.length !== 1 ? 's' : ''}` : 'Multi-Region'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Habitations ranked by composite urgency score · {selectedRegion}
          </p>
        </div>

        {/* Horizon summary chips */}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          {[
            { key: 'IMMEDIATE',   label: 'IMM',   cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
            { key: 'SHORT_TERM',  label: 'S-T',   cls: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
            { key: 'MEDIUM_TERM', label: 'M-T',   cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
            { key: 'MONITOR',     label: 'MON',   cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
          ].map(({ key, label, cls }) => (
            <span key={key} className={`px-2 py-0.5 rounded-md border font-semibold ${cls}`}>
              {label} {counts[key]}
            </span>
          ))}
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Region Filter (from API) */}
          {regions.length > 0 && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-white/[0.08]">
              <button
                onClick={() => setSelectedRegion('All Regions')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold tracking-tight transition-all duration-150 active:scale-[0.98] ${
                  selectedRegion === 'All Regions'
                    ? 'bg-slate-700 text-white shadow-sm border border-slate-600'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] border border-transparent'
                }`}
              >
                All Regions
              </button>
              {regions.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRegion(r.name)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold tracking-tight transition-all duration-150 active:scale-[0.98] ${
                    selectedRegion === r.name
                      ? 'bg-slate-700 text-white shadow-sm border border-slate-600'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] border border-transparent'
                  }`}
                >
                  {r.name.split(' ')[0]}
                </button>
              ))}
            </div>
          )}

          {/* Horizon Filter */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-white/[0.08]">
            {HORIZON_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setHorizonFilter(f.value)}
                id={`filter-${f.value || 'all'}`}
                className={`px-3 py-1 rounded-lg text-xs font-semibold tracking-tight transition-all duration-150 active:scale-[0.98] ${
                  horizonFilter === f.value
                    ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)] border border-blue-500/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Table Area */}
      <div className="flex-1 overflow-y-auto min-h-0 px-8 py-4">
        {loading && <TableSkeleton />}

        {error && (
          <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-3">
            <ShieldAlertIcon size={18} />
            <span>Failed to load priority queue: {error}</span>
          </div>
        )}

        {!loading && !error && (
          <div className="rounded-2xl border border-white/[0.08] bg-slate-900/50 backdrop-blur-md overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] bg-slate-950/70 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4 text-center w-16">Rank</th>
                  <th className="py-3 px-4 text-left">Habitation · Region · Terrain</th>
                  <th className="py-3 px-4 text-center w-40">Horizon</th>
                  <th className="py-3 px-4 text-left w-44">Urgency Index</th>
                  <th className="py-3 px-4 text-right w-32">Population</th>
                  <th className="py-3 px-4 text-right w-28">Hazard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.map((item, i) => (
                  <QueueRow key={item.habitation_id} item={item} rank={i + 1} index={i} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-20 text-center text-slate-500 text-sm">
            No habitations match this region or horizon filter.
          </div>
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="px-8 py-3 border-t border-white/[0.08] bg-slate-950/60 backdrop-blur-md text-xs text-slate-400 flex items-center justify-between shrink-0 font-mono">
        <div>
          Showing <span className="text-slate-200 font-semibold">{filtered.length}</span> of{' '}
          <span className="text-slate-200 font-semibold">{(data || []).length}</span> habitations
          {selectedRegion !== 'All Regions' && ` · ${selectedRegion}`}
          {horizonFilter && ` · ${horizonFilter}`}
        </div>
        <div className="text-[11px] text-slate-500">
          REDZONE Multi-Hazard Decision Engine · ASDMA / NDRF / SDMA
        </div>
      </div>
    </div>
  )
}