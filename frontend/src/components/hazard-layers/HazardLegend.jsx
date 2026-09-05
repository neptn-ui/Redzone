// src/components/hazard-layers/HazardLegend.jsx
// Dynamic legend that changes completely per hazard type.
// Also shows the data status banner (REAL / MODELLED / UNAVAILABLE).

export function HazardLegend({ legend, dataStatus, hazardType, loading }) {
  if (!legend || legend.length === 0) return null

  const HAZARD_TITLES = {
    flood:      'FLOOD INTELLIGENCE',
    erosion:    'EROSION INTELLIGENCE',
    landslide:  'LANDSLIDE SUSCEPTIBILITY',
    earthquake: 'SEISMIC INTELLIGENCE',
  }

  const HAZARD_COLORS = {
    flood:      'text-blue-400 border-blue-500/30',
    erosion:    'text-orange-400 border-orange-500/30',
    landslide:  'text-amber-400 border-amber-500/30',
    earthquake: 'text-red-400 border-red-500/30',
  }

  const STATUS_STYLE = {
    REAL:           'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
    MODELLED:       'text-blue-400 border-blue-500/30 bg-blue-500/5',
    UNAVAILABLE:    'text-slate-500 border-slate-700 bg-slate-800/40',
    'REAL+MODELLED':'text-cyan-400 border-cyan-500/30 bg-cyan-500/5',
    'NO USGS EVENT':'text-slate-500 border-slate-700 bg-slate-800/40',
  }

  return (
    <div className="absolute bottom-8 right-4 z-20 flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 280 }}>

      {/* Data status banner */}
      {dataStatus && dataStatus.length > 0 && (
        <div className="bg-[#0c101d] border border-white/[0.12] rounded-xl p-3 shadow-2xl pointer-events-auto">
          <div className="text-[8px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2">DATA PROVENANCE</div>
          <div className="space-y-1">
            {dataStatus.map((ds, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`shrink-0 text-[7px] font-bold uppercase tracking-wider font-mono px-1.5 py-0.5 rounded border mt-0.5 ${STATUS_STYLE[ds.status] ?? STATUS_STYLE.MODELLED}`}>
                  {ds.status}
                </span>
                <div>
                  <div className="text-[9px] font-semibold text-slate-300">{ds.source}</div>
                  <div className="text-[8px] text-slate-500 leading-tight">{ds.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="bg-[#0c101d] border border-white/[0.12] rounded-xl p-3 shadow-2xl pointer-events-auto">
        <div className={`text-[9px] font-bold uppercase tracking-widest font-mono mb-2.5 ${HAZARD_COLORS[hazardType] ?? 'text-slate-400'}`}>
          {HAZARD_TITLES[hazardType] ?? 'MAP LEGEND'}
        </div>
        {loading && (
          <div className="text-[9px] text-slate-600 font-mono flex items-center gap-1.5 mb-2">
            <div className="w-2.5 h-2.5 border border-slate-600 border-t-slate-300 rounded-full animate-spin" />
            Loading OSM data...
          </div>
        )}
        <div className="space-y-1.5">
          {legend.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              {/* Swatch */}
              {item.type === 'fill' && (
                <div
                  className="w-4 h-3 rounded shrink-0"
                  style={{ background: item.color, border: `1px solid ${item.border ?? item.color}` }}
                />
              )}
              {item.type === 'line' && (
                <div className="w-4 h-0.5 rounded-full shrink-0" style={{ background: item.color }} />
              )}
              {item.type === 'dashed' && (
                <div className="w-4 h-0.5 shrink-0" style={{ borderTop: `2px dashed ${item.color}` }} />
              )}
              {item.type === 'dot' && (
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: item.color, border: item.border ? `1px solid ${item.border}` : undefined }}
                />
              )}
              <span className="text-[10px] text-slate-400 flex-1">{item.label}</span>
              <span className={`text-[7px] font-bold font-mono px-1 py-0.5 rounded border shrink-0 ${STATUS_STYLE[item.status] ?? STATUS_STYLE.MODELLED}`}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
