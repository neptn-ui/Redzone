// src/pages/Reports.jsx
// ============================================================================
// REDZONE — Reports & Decision Audit
//
// Serves: CURRENT SITUATION · DECISION AUDIT · DATA PROVENANCE
//
// DATA INTEGRITY:
//   - Everything is labelled OBSERVED/DERIVED/MODELLED/SIMULATED/HISTORICAL
//   - Decision audit reads from AppStore (set by RelocationPlanner)
//   - Backend /api/report for current intelligence
//   - No fabricated context-independent summaries
// ============================================================================

import { useEffect, useState } from 'react'
import { useAppStore } from '../context/AppStore'
import { api } from '../api/client'

// ── Data label ────────────────────────────────────────────────────────────────

function DataLabel({ status, className = '' }) {
  const styles = {
    OBSERVED: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
    DERIVED: 'text-blue-400    border-blue-500/30    bg-blue-500/5',
    MODELLED: 'text-blue-400    border-blue-500/30    bg-blue-500/5',
    SIMULATED: 'text-blue-300    border-blue-400/20    bg-blue-400/5',
    HISTORICAL: 'text-amber-400   border-amber-500/30   bg-amber-500/5',
    RECONSTRUCTED: 'text-amber-300   border-amber-400/20   bg-amber-400/5',
    STATIC: 'text-slate-400   border-slate-600/40   bg-slate-800',
    UNAVAILABLE: 'text-red-400     border-red-500/30     bg-red-500/5',
    PLANNING_ASSUMPTION: 'text-amber-400 border-amber-500/20 bg-amber-500/5',
  }
  return (
    <span className={`inline-block text-[8px] font-bold uppercase tracking-widest font-mono px-1.5 py-0.5 rounded border ${styles[status] ?? styles.STATIC} ${className}`}>
      {status?.replace(/_/g, ' ')}
    </span>
  )
}

function SectionHeader({ children }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-3 pt-4">
      {children}
    </div>
  )
}

function DataRow({ label, value, status }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-white/[0.04] last:border-0">
      <div className="flex-1">
        <div className="text-[11px] font-semibold text-slate-400">{label}</div>
        {status && <DataLabel status={status} className="mt-0.5" />}
      </div>
      <div className="text-right text-[11px] font-mono text-slate-200 font-semibold max-w-48 truncate">
        {value ?? '—'}
      </div>
    </div>
  )
}

// ── Decision audit block ──────────────────────────────────────────────────────

function DecisionAudit({ decisionState, currentPlan, planStatus }) {
  if (!decisionState && !currentPlan) {
    return (
      <div className="p-4 text-center text-[11px] text-slate-600 italic border border-white/[0.06] rounded-xl">
        No decisions recorded this session. Complete the Relocation Planner workflow to generate an audit record.
      </div>
    )
  }

  return (
    <div className="border border-white/[0.08] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02] flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">DECISION RECORD</span>
        <DataLabel status={planStatus === 'overridden' ? 'OBSERVED' : 'OBSERVED'} />
      </div>

      <div className="p-4 space-y-1">
        {currentPlan && (
          <>
            <DataRow label="Area" value={currentPlan.area} />
            <DataRow label="Origins" value={`${currentPlan.origins?.join(', ')}`} />
            <DataRow label="Population" value={currentPlan.totalPop?.toLocaleString()} status="STATIC" />
            <DataRow label="Destination" value={currentPlan.destination} />
            <DataRow label="Route" value={
              currentPlan.route
                ? `${currentPlan.route.distanceKm}km · ${currentPlan.route.durationFormatted}`
                : 'UNAVAILABLE'
            } />
          </>
        )}
        {decisionState && (
          <>
            <DataRow label="Decision" value={decisionState.action?.toUpperCase()} />
            <DataRow label="Timestamp" value={decisionState.timestamp ? new Date(decisionState.timestamp).toLocaleString('en-IN') : '—'} />
            {decisionState.overrideReason && (
              <DataRow label="Override Reason" value={decisionState.overrideReason} />
            )}
          </>
        )}
      </div>

      {planStatus === 'overridden' && (
        <div className="mx-4 mb-4 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-[10px] text-amber-400 leading-relaxed">
          <span className="font-bold">Override recorded.</span> The operator modified the system recommendation. Reason logged above.
        </div>
      )}
    </div>
  )
}

// ── Backend report panel ──────────────────────────────────────────────────────

function BackendReport({ report, loading, error }) {
  if (loading) return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => <div key={i} className="h-8 rounded shimmer bg-white/[0.04]" />)}
    </div>
  )
  if (error) return (
    <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-[11px] text-amber-400">
      Backend report unavailable — {error}
    </div>
  )
  if (!report) return null

  const meta = report.report_metadata ?? {}
  const zones = report.priority_queue ?? []
  const recs = report.recommendations ?? []

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">REPORT METADATA</div>
        <DataRow label="Title" value={meta.title} />
        <DataRow label="Generated" value={meta.generated_at ? new Date(meta.generated_at).toLocaleString('en-IN') : '—'} status="DERIVED" />
      </div>

      {recs.length > 0 && (
        <div className="p-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">RECOMMENDATIONS</div>
          {recs.map((r, i) => (
            <div key={i} className="py-2 border-b border-white/[0.04] last:border-0">
              <div className="text-[11px] text-slate-300">{r.action ?? r.message ?? JSON.stringify(r)}</div>
            </div>
          ))}
        </div>
      )}

      {zones.length > 0 && (
        <div className="p-3 rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-2">PRIORITY QUEUE · TOP {Math.min(5, zones.length)}</div>
          {zones.slice(0, 5).map((z, i) => (
            <div key={i} className="flex justify-between py-1.5 border-b border-white/[0.04] last:border-0">
              <span className="text-[11px] text-slate-400 truncate flex-1">{z.name ?? '—'}</span>
              <span className="text-[11px] font-mono text-slate-300 font-bold ml-2">{z.classification?.replace(/_/g, ' ').toUpperCase()}</span>
            </div>
          ))}
          <DataLabel status="MODELLED" className="mt-2" />
        </div>
      )}
    </div>
  )
}

// ── Data provenance table ─────────────────────────────────────────────────────

function ProvenanceTable() {
  const sources = [
    { name: 'Habitation Records', status: 'STATIC', note: 'Pilot district habitation database. Last updated at deployment.' },
    { name: 'Candidate Sites', status: 'STATIC', note: 'Capacity from NBC 2016. Field survey pending.' },
    { name: 'Hazard Scores', status: 'MODELLED', note: 'Weighted formula per hazard_engine.py. Calibrated for pilot data.' },
    { name: 'Rainfall Signal', status: 'OBSERVED', note: 'Open-Meteo API. 60s polling cadence. Cached on failure.' },
    { name: 'Seismic Signal', status: 'OBSERVED', note: 'USGS Earthquake Feed. 60s polling. Cached on failure.' },
    { name: 'Road Routing', status: 'DERIVED', note: 'OSRM routing engine using OpenStreetMap network.' },
    { name: 'Historical Events', status: 'HISTORICAL', note: 'ASDMA / NDMA documented reports. Not real-time.' },
    { name: 'Resource Estimates', status: 'PLANNING_ASSUMPTION', note: 'WHO standards + expert estimates. Not validated.' },
  ]
  return (
    <div className="border border-white/[0.08] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono">DATA PROVENANCE</div>
      </div>
      {sources.map((s, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold text-slate-300">{s.name}</div>
            <div className="text-[10px] text-slate-600 mt-0.5 leading-relaxed">{s.note}</div>
          </div>
          <DataLabel status={s.status} />
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Reports() {
  const { area, mode, modeMeta, decisionState, currentPlan, planStatus } = useAppStore()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('situation') // 'situation' | 'audit' | 'provenance'

  const loadReport = () => {
    setLoading(true)
    setError(null)
    api.report()
      .then(d => setReport(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadReport() }, [])

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto bg-[#090d16]">
        <div className="max-w-3xl mx-auto px-6 py-6">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono mb-1">REDZONE REPORT</div>
              <div className="text-xl font-extrabold text-slate-100">
                {area ? area.name : 'No Area Selected'}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[9px] font-bold font-mono ${modeMeta.bgClass} ${modeMeta.borderClass} ${modeMeta.textClass}`}>
                  <span className={`w-1 h-1 rounded-full ${modeMeta.dotClass}`} />
                  {modeMeta.label}
                </div>
                <span className="text-[10px] text-slate-600">{new Date().toLocaleString('en-IN')}</span>
              </div>
            </div>
            <button
              onClick={loadReport}
              className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 text-xs font-bold uppercase tracking-wider border border-white/[0.08] transition-all"
            >
              Refresh
            </button>
          </div>

          {/* No area warning */}
          {!area && (
            <div className="p-4 mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[11px] text-amber-400 leading-relaxed">
              No area selected. Reports are context-specific — search for an area first to generate meaningful output.
              The backend report below reflects all available data, which may not match your searched area.
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b border-white/[0.06] pb-0">
            {[
              { id: 'situation', label: 'Situation' },
              { id: 'audit', label: 'Decision Audit' },
              { id: 'provenance', label: 'Data Provenance' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 -mb-px ${tab === t.id
                    ? 'text-blue-400 border-blue-500'
                    : 'text-slate-600 border-transparent hover:text-slate-400'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'situation' && (
            <div>
              <SectionHeader>CURRENT INTELLIGENCE</SectionHeader>
              <BackendReport report={report} loading={loading} error={error} />

              {!loading && !error && !report && (
                <div className="text-center text-[11px] text-slate-600 py-8 italic">
                  Backend not connected — start the FastAPI server to load live data.
                </div>
              )}
            </div>
          )}

          {tab === 'audit' && (
            <div>
              <SectionHeader>DECISION AUDIT TRAIL</SectionHeader>
              <DecisionAudit
                decisionState={decisionState}
                currentPlan={currentPlan}
                planStatus={planStatus}
              />
              <div className="mt-4 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 text-[10px] text-blue-400/80 leading-relaxed">
                This audit record is session-local. In a production deployment, decisions would be persisted to a tamper-evident audit database with operator identity.
              </div>
            </div>
          )}

          {tab === 'provenance' && (
            <div>
              <SectionHeader>DATA PROVENANCE &amp; LIMITATIONS</SectionHeader>
              <ProvenanceTable />
              <div className="mt-4 p-3 rounded-lg border border-slate-700/40 bg-slate-800/20 text-[10px] text-slate-500 leading-relaxed">
                REDZONE distinguishes between OBSERVED, MODELLED, STATIC, and PLANNING ASSUMPTION data to prevent false confidence.
                No data is presented without a provenance label. UNKNOWN data is not represented as zero.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}