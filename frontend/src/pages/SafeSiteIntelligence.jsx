import { useState } from 'react'
import { motion } from 'framer-motion'
import HazardMap from '../components/HazardMap'
import { LocationIcon, CheckCircleIcon, ShieldAlertIcon } from '../components/Icons'

const MOCK_SITES = [
  { id: 'b17', name: 'B-17 Highland Parcel', distance: '4.2 km', capacity: 2500, elevation: '114m', score: 94 },
  { id: 'c4', name: 'C-4 Community Hall', distance: '6.8 km', capacity: 800, elevation: '98m', score: 82 },
  { id: 'a1', name: 'A-1 Highway Ridge', distance: '12.1 km', capacity: 5000, elevation: '142m', score: 76 }
]

const ROUTE_DATA = {
  primary: {
    time: '24 mins',
    distance: '4.2 km',
    condition: 'Clear',
    bottleneck: 'None',
    color: '#3b82f6',
    coordinates: [[26.2, 93.8], [26.21, 93.82], [26.23, 93.85]]
  },
  alternate: {
    time: '42 mins',
    distance: '7.1 km',
    condition: 'Waterlogged',
    bottleneck: 'Narrow bridge',
    color: '#f97316',
    coordinates: [[26.2, 93.8], [26.18, 93.83], [26.23, 93.85]]
  }
}

export default function SafeSiteIntelligence() {
  const [selectedSite, setSelectedSite] = useState(MOCK_SITES[0].id)
  const [activeRoute, setActiveRoute] = useState('primary')

  return (
    <div className="flex w-full h-full flex-1 min-h-0 overflow-hidden bg-[#090d16]">
      {/* Left Sidebar: Safe Site Ranking */}
      <aside className="w-80 shrink-0 bg-slate-950/80 border-r border-white/[0.08] backdrop-blur-xl flex flex-col z-10 shadow-[10px_0_30px_rgba(0,0,0,0.5)]">
        <div className="p-5 border-b border-white/[0.08] bg-slate-950/50">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">
            Evacuation Target
          </div>
          <h2 className="text-lg font-extrabold text-white tracking-tight uppercase">Safe Site Ranking</h2>
          <div className="mt-4 flex gap-2">
            <select className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 outline-none">
              <option>Sort by: Capacity</option>
              <option>Sort by: Distance</option>
              <option>Sort by: Elevation</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.02] p-2 space-y-2">
          {MOCK_SITES.map(site => (
            <button
              key={site.id}
              onClick={() => setSelectedSite(site.id)}
              className={`w-full text-left p-4 rounded-xl transition-all border ${
                selectedSite === site.id
                  ? 'bg-blue-600/10 border-blue-500/30 shadow-[0_0_15px_rgba(37,99,235,0.1)]'
                  : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="font-bold text-sm text-slate-200">{site.name}</div>
                <div className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                  site.score > 90 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {site.score}% MATCH
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div>
                  <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">Dist</div>
                  <div className="text-xs font-mono text-slate-300">{site.distance}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">Cap</div>
                  <div className="text-xs font-mono text-slate-300">{site.capacity}</div>
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">Elev</div>
                  <div className="text-xs font-mono text-slate-300">{site.elevation}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Main Area: Map & Routing */}
      <div className="flex-1 relative flex flex-col min-w-0 h-full">
        <HazardMap route={ROUTE_DATA[activeRoute]} />
        
        {/* Route Details Panel over Map */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="absolute bottom-6 right-6 w-[420px] bg-slate-950/95 border border-white/[0.08] backdrop-blur-3xl rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.6)] z-[500] overflow-hidden flex flex-col max-h-[80vh]"
        >
          <div className="p-5 border-b border-white/[0.06] bg-slate-900/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-extrabold text-white uppercase tracking-wider">Route Intelligence</h3>
              <div className="flex gap-1 p-1 bg-black/40 rounded-lg border border-white/5">
                <button
                  onClick={() => setActiveRoute('primary')}
                  className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${
                    activeRoute === 'primary' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Primary
                </button>
                <button
                  onClick={() => setActiveRoute('alternate')}
                  className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${
                    activeRoute === 'alternate' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Alternate
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-2">
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wider mb-1">Est. Travel Time</div>
                <div className="text-xl font-extrabold font-mono text-white">{ROUTE_DATA[activeRoute].time}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{ROUTE_DATA[activeRoute].distance}</div>
              </div>
              <div className={`p-3 rounded-xl border ${
                activeRoute === 'primary' 
                  ? 'bg-emerald-500/10 border-emerald-500/20' 
                  : 'bg-orange-500/10 border-orange-500/20'
              }`}>
                <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wider mb-1">Road Condition</div>
                <div className={`text-sm font-extrabold uppercase ${
                  activeRoute === 'primary' ? 'text-emerald-400' : 'text-orange-400'
                }`}>{ROUTE_DATA[activeRoute].condition}</div>
                <div className="text-[10px] text-slate-300 mt-1 flex items-center gap-1">
                  <ShieldAlertIcon size={10} />
                  {ROUTE_DATA[activeRoute].bottleneck}
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 flex-1 overflow-y-auto">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3 font-mono">
              Site Preparation Checklist
            </div>
            <div className="space-y-3">
              {[
                'Deploy medical tent and triage unit (Priority 1)',
                'Ensure 10,000L drinking water supply via tanker',
                'Coordinate with Majuli local police for traffic diversion',
                'Activate temporary floodlights and generator',
                'Set up registration desk for incoming evacuees'
              ].map((task, i) => (
                <label key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] cursor-pointer hover:bg-white/[0.04] transition-all group">
                  <input type="checkbox" className="mt-0.5 rounded border-white/20 bg-black/20 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-0" />
                  <span className="text-xs text-slate-300 group-hover:text-slate-100 font-medium leading-relaxed">{task}</span>
                </label>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
