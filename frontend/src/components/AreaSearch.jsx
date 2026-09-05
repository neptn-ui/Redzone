// src/components/AreaSearch.jsx
// ============================================================================
// REDZONE — Global Area Search
//
// Fullscreen search overlay triggered by top-bar button or ⌘K.
// Uses Nominatim to geocode the query, then:
//   1. Dispatches area to AppStore
//   2. Queries /api/areas/context for data coverage
//   3. Flies map to the location
//   4. Clears all stale area-specific state
//
// After selection, shows coverage note so user knows if real data is available.
// ============================================================================

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { geocode } from '../api/geo'
import { api } from '../api/client'
import { useAppStore } from '../context/AppStore'

// Recent areas are stored as component state (also in store.recentSearches)

function PlaceResult({ result, onClick, isActive }) {
  return (
    <button
      onClick={() => onClick(result)}
      className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0 transition-all ${
        isActive ? 'bg-blue-600/10' : 'hover:bg-white/[0.04]'
      }`}
    >
      <div className="mt-0.5 w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-200 truncate">{result.name}</div>
        <div className="text-[11px] text-slate-500 mt-0.5 truncate">{result.displayName}</div>
      </div>
      {result.country && (
        <div className="text-[10px] text-slate-600 font-mono shrink-0 mt-0.5 uppercase tracking-wider">
          {result.state ?? result.country}
        </div>
      )}
    </button>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04]">
      <div className="w-7 h-7 rounded-lg shimmer bg-white/[0.04]" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-36 rounded shimmer bg-white/[0.04]" />
        <div className="h-2.5 w-52 rounded shimmer bg-white/[0.04]" />
      </div>
    </div>
  )
}

export default function AreaSearch({ onClose }) {
  const navigate = useNavigate()
  const { setArea, setAreaStatus, addRecentSearch, recentSearches } = useAppStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [coverageMsg, setCoverageMsg] = useState(null)
  const [selecting, setSelecting] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  // Debounced search
  useEffect(() => {
    setCoverageMsg(null)
    if (!query || query.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    setActiveIdx(-1)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        const data = await geocode(query, { limit: 8 })
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  const handleSelect = async (result) => {
    setSelecting(true)
    setCoverageMsg(null)

    // Always set area immediately so map flies regardless of backend coverage
    const area = {
      name:     result.name,
      lat:      result.lat,
      lon:      result.lon,
      zoom:     result.zoom ?? 11,
      bbox:     result.bbox,
      state:    result.state,
      country:  result.country,
      district: result.district,
      osmId:    result.osmId,
      osmType:  result.osmType,
    }

    setArea(area)
    addRecentSearch(area)
    setAreaStatus('ready')

    // Close immediately and navigate — coverage check is non-blocking
    onClose()
    navigate('/')

    // Check coverage in background (informational only — does NOT block)
    try {
      const ctx = await api.areaContext(result.lat, result.lon)
      if (ctx.data_status !== 'REAL') {
        // Coverage info stored but doesn't block navigation
        // The pages themselves will show DATA UNAVAILABLE where appropriate
        console.info('[AreaSearch] Coverage:', ctx.data_status, ctx.coverage_note)
      }
    } catch {
      // Backend unavailable — location is still valid, proceed normally
    }

    setSelecting(false)
  }

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return }
    const list = query.length >= 2 ? results : recentSearches
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, list.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && activeIdx >= 0 && list[activeIdx]) {
      handleSelect(list[activeIdx])
    }
  }

  const showRecent = query.length < 2 && recentSearches.length > 0
  const displayList = query.length >= 2 ? results : []

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9000] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[8vh]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -8, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
        className="w-full max-w-xl mx-4 bg-[#0d1220] border border-white/[0.08] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.8)] overflow-hidden"
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-slate-500 shrink-0">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search for a district, city, or region..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-600 outline-none font-medium"
            disabled={selecting}
            aria-label="Search for geographic area"
          />
          {(loading || selecting) && (
            <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin shrink-0" />
          )}
          <button
            onClick={onClose}
            className="text-slate-600 hover:text-slate-300 transition-colors text-[11px] font-mono border border-white/[0.06] px-2 py-0.5 rounded"
          >
            ESC
          </button>
        </div>

        {/* Coverage note */}
        <AnimatePresence>
          {coverageMsg && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className={`overflow-hidden`}
            >
              <div className={`px-4 py-3 text-[11px] leading-relaxed border-b border-white/[0.06] ${
                coverageMsg.type === 'NONE'
                  ? 'bg-amber-500/5 text-amber-400'
                  : 'bg-blue-500/5 text-blue-400'
              }`}>
                <div className="font-bold uppercase tracking-wider mb-1 text-[9px] font-mono">
                  DATA COVERAGE — {coverageMsg.type}
                </div>
                {coverageMsg.text}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => { onClose(); navigate('/') }}
                    className="px-3 py-1 rounded bg-white/[0.06] hover:bg-white/[0.10] text-slate-300 text-[11px] font-medium transition-all"
                  >
                    Continue anyway
                  </button>
                  <button
                    onClick={() => setCoverageMsg(null)}
                    className="px-3 py-1 text-slate-600 hover:text-slate-400 text-[11px] transition-all"
                  >
                    Search again
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div>
              <SkeletonRow /><SkeletonRow /><SkeletonRow />
            </div>
          )}

          {!loading && query.length >= 2 && displayList.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-600">
              No places found for "{query}"
            </div>
          )}

          {!loading && displayList.map((r, i) => (
            <PlaceResult
              key={r.osmId ?? i}
              result={r}
              onClick={handleSelect}
              isActive={i === activeIdx}
            />
          ))}

          {!loading && showRecent && (
            <>
              <div className="px-4 pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-600 font-mono">
                Recent Searches
              </div>
              {recentSearches.map((r, i) => (
                <PlaceResult
                  key={r.osmId ?? `recent-${i}`}
                  result={r}
                  onClick={handleSelect}
                  isActive={i === activeIdx}
                />
              ))}
            </>
          )}

          {!loading && !query && recentSearches.length === 0 && (
            <div className="px-4 py-8 text-center">
              <div className="text-sm text-slate-500 mb-2">Search for any location in India</div>
              <div className="text-[11px] text-slate-700">
                Examples: Majuli, Dhemaji, Jorhat, Cachar, Nainital, Chamoli
              </div>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-white/[0.04] flex items-center gap-4 text-[10px] text-slate-700 font-mono">
          <span><kbd className="text-slate-600">↑↓</kbd> navigate</span>
          <span><kbd className="text-slate-600">↵</kbd> select</span>
          <span><kbd className="text-slate-600">ESC</kbd> close</span>
          <div className="flex-1 text-right">Powered by Nominatim / OSM</div>
        </div>
      </motion.div>
    </motion.div>
  )
}
