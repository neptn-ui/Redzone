import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircleIcon, ShieldAlertIcon, RefreshIcon, UsersIcon, LocationIcon } from '../components/Icons'

const STEPS = [
  { id: 1, title: 'Select Habitations', desc: 'Identify vulnerable zones for evacuation.' },
  { id: 2, title: 'Select Safe Site', desc: 'Assign destination high-ground parcel.' },
  { id: 3, title: 'Allocate Resources', desc: 'Deploy NDRF, transport, and medical.' },
  { id: 4, title: 'Generate Plan', desc: 'Review manifest and issue orders.' },
]

export default function RelocationPlanner() {
  const [activeStep, setActiveStep] = useState(1)
  const [habitations, setHabitations] = useState(['betkuchandi'])
  const [site, setSite] = useState('b17')
  const [resources, setResources] = useState({ ndrf: 2, buses: 5, medical: 50 })
  const [deployed, setDeployed] = useState(false)

  const toggleHabitation = (id) => {
    setHabitations(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleDeploy = () => {
    setDeployed(true)
    setTimeout(() => {
      alert('Deployment Manifest sent to field teams successfully!')
    }, 500)
  }

  return (
    <div className="flex w-full h-full flex-1 min-h-0 bg-[#090d16]">
      {/* Left Vertical Wizard */}
      <aside className="w-[420px] shrink-0 bg-slate-950/80 border-r border-white/[0.08] backdrop-blur-xl flex flex-col z-10 shadow-[10px_0_30px_rgba(0,0,0,0.5)] h-full overflow-y-auto">
        <div className="p-6 border-b border-white/[0.08] bg-slate-900/30">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">
            Operational Workflow
          </div>
          <h2 className="text-xl font-extrabold text-white tracking-tight uppercase">Relocation Planner</h2>
        </div>

        <div className="p-6 space-y-8">
          {STEPS.map(step => (
            <div key={step.id} className="relative">
              {/* Connector Line */}
              {step.id !== STEPS.length && (
                <div className={`absolute left-4 top-10 w-0.5 h-16 ${
                  activeStep > step.id ? 'bg-blue-500' : 'bg-white/[0.05]'
                }`} />
              )}
              
              <div className="flex items-start gap-4">
                <button 
                  onClick={() => setActiveStep(step.id)}
                  className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full font-bold text-xs font-mono transition-all ${
                    activeStep === step.id 
                      ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]'
                      : activeStep > step.id
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-white/[0.03] text-slate-500 border border-white/[0.06]'
                  }`}
                >
                  {activeStep > step.id ? <CheckCircleIcon size={14} /> : step.id}
                </button>
                <div className="pt-1.5 flex-1 cursor-pointer" onClick={() => setActiveStep(step.id)}>
                  <div className={`text-sm font-bold tracking-tight uppercase ${
                    activeStep === step.id ? 'text-white' : 'text-slate-400'
                  }`}>
                    {step.title}
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium mt-1">{step.desc}</div>
                  
                  {/* Step 1 Content */}
                  <AnimatePresence>
                    {activeStep === 1 && step.id === 1 && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-4 space-y-2 overflow-hidden">
                        {[
                          { id: 'betkuchandi', name: 'Betkuchandi Dyke Colony', pop: 5800 },
                          { id: 'bhuragaon', name: 'Bhuragaon Lowlands', pop: 3200 },
                          { id: 'majuli_south', name: 'Majuli South Bank', pop: 11500 }
                        ].map(hab => (
                          <label key={hab.id} className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                            habitations.includes(hab.id) ? 'bg-blue-600/10 border-blue-500/30' : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.06]'
                          }`}>
                            <div className="flex items-center gap-3">
                              <input 
                                type="checkbox" 
                                checked={habitations.includes(hab.id)} 
                                onChange={() => toggleHabitation(hab.id)}
                                className="rounded border-white/20 bg-black/20 text-blue-500 focus:ring-0" 
                              />
                              <span className="text-xs font-bold text-slate-200">{hab.name}</span>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500">{hab.pop} ppl</span>
                          </label>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Step 2 Content */}
                  <AnimatePresence>
                    {activeStep === 2 && step.id === 2 && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-4 space-y-2 overflow-hidden">
                        {[
                          { id: 'b17', name: 'B-17 Highland Parcel', cap: 2500, match: 94 },
                          { id: 'c4', name: 'C-4 Community Hall', cap: 800, match: 82 },
                        ].map(s => (
                          <label key={s.id} className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                            site === s.id ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.06]'
                          }`}>
                            <div className="flex items-center gap-3">
                              <input 
                                type="radio" 
                                checked={site === s.id} 
                                onChange={() => setSite(s.id)}
                                className="rounded-full border-white/20 bg-black/20 text-emerald-500 focus:ring-0" 
                              />
                              <div>
                                <div className="text-xs font-bold text-slate-200">{s.name}</div>
                                <div className="text-[9px] text-slate-500 mt-0.5 uppercase tracking-wider">{s.cap} capacity</div>
                              </div>
                            </div>
                            <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">{s.match}% Match</span>
                          </label>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Step 3 Content */}
                  <AnimatePresence>
                    {activeStep === 3 && step.id === 3 && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-4 space-y-3 overflow-hidden">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2">NDRF Teams</div>
                            <input 
                              type="number" 
                              value={resources.ndrf} 
                              onChange={e => setResources({...resources, ndrf: e.target.value})}
                              className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white font-mono outline-none" 
                            />
                          </div>
                          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2">Transport Buses</div>
                            <input 
                              type="number" 
                              value={resources.buses} 
                              onChange={e => setResources({...resources, buses: e.target.value})}
                              className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white font-mono outline-none" 
                            />
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2">Medical Kits & Tents</div>
                          <input 
                            type="number" 
                            value={resources.medical} 
                            onChange={e => setResources({...resources, medical: e.target.value})}
                            className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm text-white font-mono outline-none" 
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Step 4 Content */}
                  <AnimatePresence>
                    {activeStep === 4 && step.id === 4 && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-4 overflow-hidden">
                        <div className="text-xs text-slate-400 mb-4 leading-relaxed">
                          All parameters set. Review the Deployment Manifest on the right and issue field orders.
                        </div>
                        <button 
                          onClick={() => setActiveStep(3)}
                          className="px-4 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-bold text-slate-300 transition-all uppercase tracking-wider border border-white/10"
                        >
                          Back to Edit
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto p-6 border-t border-white/[0.08] bg-slate-900/30">
          <button 
            onClick={() => setActiveStep(prev => Math.min(prev + 1, 4))}
            disabled={activeStep === 4}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border-slate-700 text-white text-xs font-bold tracking-widest uppercase transition-all shadow-[0_4px_12px_rgba(37,99,235,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]"
          >
            {activeStep === 4 ? 'Ready for Deployment' : 'Continue to Next Step'}
          </button>
        </div>
      </aside>

      {/* Right Canvas: Deployment Manifest */}
      <main className="flex-1 p-10 flex justify-center items-start overflow-y-auto relative">
        {/* Background Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

        <AnimatePresence>
          {activeStep === 4 && (
            <motion.div 
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="w-full max-w-2xl bg-slate-950/95 border border-white/[0.08] backdrop-blur-xl rounded-2xl shadow-[0_30px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden relative z-10 mt-10"
            >
              <div className="p-8 border-b border-white/[0.06] bg-[url('/noise.png')]">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h1 className="text-2xl font-extrabold text-white tracking-tight uppercase mb-2">Deployment Manifest</h1>
                    <div className="text-sm font-mono text-slate-400">ORDER REF: AS-2026-F91A</div>
                  </div>
                  <div className="w-16 h-16 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                    <ShieldAlertIcon size={32} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6 mt-8">
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono mb-2">Target Habitations</div>
                    <div className="space-y-1 text-sm font-semibold text-slate-200">
                      {habitations.includes('betkuchandi') && <div>Betkuchandi Dyke Colony</div>}
                      {habitations.includes('bhuragaon') && <div>Bhuragaon Lowlands</div>}
                      {habitations.includes('majuli_south') && <div>Majuli South Bank</div>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono mb-2">Destination</div>
                    <div className="text-sm font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg inline-block">
                      {site === 'b17' ? 'B-17 Highland Parcel' : 'C-4 Community Hall'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-8 bg-slate-900/30">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono mb-4">Resource Allocation</div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04] flex flex-col items-center justify-center text-center">
                    <UsersIcon size={24} className="text-blue-400 mb-2" />
                    <div className="text-2xl font-extrabold font-mono text-white mb-1">{resources.ndrf}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">NDRF Teams</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04] flex flex-col items-center justify-center text-center">
                    <LocationIcon size={24} className="text-orange-400 mb-2" />
                    <div className="text-2xl font-extrabold font-mono text-white mb-1">{resources.buses}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Buses</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04] flex flex-col items-center justify-center text-center">
                    <ShieldAlertIcon size={24} className="text-red-400 mb-2" />
                    <div className="text-2xl font-extrabold font-mono text-white mb-1">{resources.medical}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Med Kits</div>
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-white/[0.06] bg-slate-950 flex items-center justify-between">
                <div className="text-xs font-mono text-slate-500">
                  Authorized by: <strong className="text-slate-300">ASDMA Command Center</strong>
                </div>
                <button
                  onClick={handleDeploy}
                  disabled={deployed}
                  className={`px-8 py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-[0_4px_20px_rgba(37,99,235,0.4),inset_0_1px_0_rgba(255,255,255,0.2)] ${
                    deployed 
                      ? 'bg-emerald-600 text-white shadow-[0_4px_20px_rgba(5,150,105,0.4)]'
                      : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-[0.98]'
                  }`}
                >
                  {deployed ? 'Orders Sent ✓' : 'Send to Field Teams'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {activeStep < 4 && (
          <div className="mt-40 text-center text-slate-600 font-mono text-sm max-w-sm">
            Complete the wizard on the left to generate the Deployment Manifest.
          </div>
        )}
      </main>
    </div>
  )
}
