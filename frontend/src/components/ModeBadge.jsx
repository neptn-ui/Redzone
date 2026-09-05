// src/components/ModeBadge.jsx
// Persistent operational mode indicator.
// Shows LIVE / HISTORICAL REPLAY / SIMULATION with distinct visuals.
// ============================================================================

import { useAppStore } from '../context/AppStore'

export default function ModeBadge({ compact = false }) {
  const { mode, modeMeta } = useAppStore()

  if (!modeMeta) return null

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-widest ${modeMeta.bgClass} ${modeMeta.borderClass} ${modeMeta.textClass}`}
      title={modeMeta.description}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${modeMeta.dotClass} ${mode === 'LIVE' ? 'animate-pulse' : ''}`} />
      {!compact && <span>{modeMeta.label}</span>}
    </div>
  )
}
