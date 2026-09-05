// src/components/GlobalSearch.jsx
// Prominent location search bar with Nominatim-powered results dropdown.
// Selecting a result updates AreaContext and flies the map to the location.
// ============================================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { useGeoSearch } from '../hooks/useGeoSearch'
import { useAreaContext, HAZARD_TYPES } from '../context/AppStore'

const LOCATION_TYPE_LABELS = {
  administrative: 'District',
  city: 'City',
  town: 'Town',
  village: 'Village',
  hamlet: 'Settlement',
  suburb: 'Suburb',
  county: 'District',
  state: 'State',
  country: 'Country',
  island: 'Island',
  river: 'River',
}

function getLocationLabel(result) {
  return LOCATION_TYPE_LABELS[result.type] || result.category || 'Location'
}

export default function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  const { results, loading } = useGeoSearch(query, { enabled: isOpen && query.length >= 2 })
  const { setArea, setIncident, addRecentSearch, recentSearches } = useAreaContext()
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = useCallback((result) => {
    setArea({
      name: result.name,
      country: result.country,
      state: result.state,
      district: result.district || result.name,
      lat: result.lat,
      lon: result.lon,
      zoom: result.type === 'state' ? 7 : result.type === 'city' ? 11 : 12,
      osmId: result.osmId,
      osmType: result.osmType,
    })

    addRecentSearch(result)
    setQuery('')
    setIsOpen(false)
    setFocusIndex(-1)
  }, [setArea, addRecentSearch])

  const handleKeyDown = useCallback((e) => {
    const items = results.length > 0 ? results : recentSearches
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIndex(prev => Math.min(prev + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIndex(prev => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter' && focusIndex >= 0 && items[focusIndex]) {
      e.preventDefault()
      handleSelect(items[focusIndex])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      inputRef.current?.blur()
    }
  }, [results, recentSearches, focusIndex, handleSelect])

  const showDropdown = isOpen && (query.length >= 2 || recentSearches.length > 0)
  const displayItems = query.length >= 2 ? results : recentSearches

  return (
    <div ref={containerRef} className="relative" style={{ width: 320 }}>
      {/* Search Input */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setFocusIndex(-1)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search location, district, city, village..."
          className="w-full pl-9 pr-8 py-2 rounded-lg bg-slate-900/80 border border-white/[0.08] text-xs text-slate-200 placeholder-slate-500 font-medium outline-none focus:border-blue-500/50 focus:bg-slate-900 focus:shadow-[0_0_0_1px_rgba(59,130,246,0.2)] transition-all"
          aria-label="Search geographic location"
          autoComplete="off"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-3.5 h-3.5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        )}
        {query && !loading && (
          <button
            onClick={() => { setQuery(''); setIsOpen(false) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-slate-950/98 border border-white/[0.08] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.7)] backdrop-blur-2xl z-[9999] overflow-hidden max-h-[360px] overflow-y-auto">
          {/* Section label */}
          {displayItems.length > 0 && (
            <div className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-slate-500 font-mono border-b border-white/[0.04]">
              {query.length >= 2 ? 'SEARCH RESULTS' : 'RECENT SEARCHES'}
            </div>
          )}

          {displayItems.map((result, i) => (
            <button
              key={result.id || `${result.lat}-${result.lon}`}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setFocusIndex(i)}
              className={`w-full text-left px-3.5 py-2.5 flex items-start gap-3 transition-all border-b border-white/[0.03] last:border-0 ${
                focusIndex === i
                  ? 'bg-blue-600/15'
                  : 'hover:bg-white/[0.03]'
              }`}
            >
              {/* Location pin icon */}
              <div className="mt-0.5 shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={focusIndex === i ? '#60a5fa' : '#64748b'} strokeWidth="2" strokeLinecap="round">
                  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-bold text-slate-200 truncate">{result.name}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded shrink-0">
                    {getLocationLabel(result)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {result.state && result.country
                    ? `${result.district ? result.district + ', ' : ''}${result.state}, ${result.country}`
                    : result.displayName
                  }
                </div>
              </div>
            </button>
          ))}

          {query.length >= 2 && !loading && results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              No locations found for "<span className="text-slate-300">{query}</span>"
            </div>
          )}

          {query.length < 2 && recentSearches.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              Type to search any geographic location
            </div>
          )}
        </div>
      )}
    </div>
  )
}
