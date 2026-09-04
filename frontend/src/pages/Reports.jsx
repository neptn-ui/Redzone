// src/pages/Reports.jsx - Reports export page
import { motion } from 'framer-motion'
import { MapPinClusterIcon, CheckCircleIcon, ShieldAlertIcon } from '../components/Icons'

const MOCK_REPORTS = [
  { id: 'INCIDENT-2026-09-01', title: 'Evacuation of Majuli South', date: '2026-09-01', status: 'Completed', pop: 11500 },
  { id: 'INCIDENT-2026-08-22', title: 'Preventative Relocation Cachar', date: '2026-08-22', status: 'Completed', pop: 4200 },
  { id: 'INCIDENT-2026-07-15', title: 'Dhemaji Flash Flood Response', date: '2026-07-15', status: 'Archived', pop: 8900 },
]

export default function Reports() {
  return (
    <div className="h-full overflow-y-auto bg-[#090d16] p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header and Actions */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-extrabold tracking-tight text-white uppercase">Incident Reports</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400">
                ASDMA Official Archive
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium max-w-lg">
              Historical repository of generated deployment manifests and post-action audit trails.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest bg-blue-600 hover:bg-blue-500 text-white shadow-[0_2px_12px_rgba(37,99,235,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] transition-all active:scale-[0.98]">
              Generate New Report
            </button>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-white/[0.08] bg-slate-900/50 backdrop-blur-md overflow-hidden shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
        >
          <div className="px-6 py-5 border-b border-white/[0.08] bg-slate-950/80 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-300 font-mono">
              Archived Manifests
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              {MOCK_REPORTS.length} Records Found
            </span>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] bg-slate-950/40 text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">
                <th className="py-4 px-6 text-left">Incident ID</th>
                <th className="py-4 px-6 text-left">Title</th>
                <th className="py-4 px-6 text-center">Date</th>
                <th className="py-4 px-6 text-right">Population Moved</th>
                <th className="py-4 px-6 text-center">Status</th>
                <th className="py-4 px-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-xs">
              {MOCK_REPORTS.map(row => (
                <tr key={row.id} className="hover:bg-white/[0.02] transition-colors cursor-pointer group">
                  <td className="py-4 px-6 font-mono font-bold text-blue-400">{row.id}</td>
                  <td className="py-4 px-6 font-bold text-slate-200">{row.title}</td>
                  <td className="py-4 px-6 text-center text-slate-400 font-mono">{row.date}</td>
                  <td className="py-4 px-6 text-right font-mono text-slate-300">
                    {row.pop.toLocaleString()} ppl
                  </td>
                  <td className="py-4 px-6 text-center">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircleIcon size={12} />
                      {row.status}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right">
                    <button className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-blue-400 transition-colors border border-transparent group-hover:border-blue-500/30 group-hover:bg-blue-500/10 px-3 py-1.5 rounded-lg">
                      Download PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </div>
  )
}