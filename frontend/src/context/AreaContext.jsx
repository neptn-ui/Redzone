// src/context/AreaContext.jsx
// Global area + incident + mode context for the entire application.
// Replaces hardcoded Assam/Majuli references with a dynamic geographic model.
// ============================================================================

import { createContext, useContext, useState, useCallback, useMemo } from 'react'

const AreaContext = createContext(null)

// Default area: Assam (Majuli) — the pilot region
const DEFAULT_AREA = {
  name: 'Majuli',
  country: 'India',
  state: 'Assam',
  district: 'Majuli',
  lat: 26.95,
  lon: 94.17,
  zoom: 10,
  geometry: null,     // GeoJSON boundary when available
  osmId: null,
}

const DEFAULT_INCIDENT = {
  id: 'INC-2026-ASM-FLOOD',
  name: 'Assam Flood Event 2026',
  type: 'flood',
  hazards: ['flood', 'erosion'],
  startTime: '2026-06-15T00:00:00Z',
  mode: 'LIVE',
}

const DEFAULT_HAZARD = {
  type: 'flood',
  severity: 'high',
  layers: ['flood_extent', 'erosion'],
  confidence: null,
  source: null,
}

// Operational modes
export const MODES = {
  LIVE: 'LIVE',
  HISTORICAL: 'HISTORICAL',
  SIMULATION: 'SIMULATION',
}

// Mode display configuration
export const MODE_CONFIG = {
  LIVE: {
    label: 'LIVE DATA',
    icon: '●',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    description: 'Showing currently available real/current data',
  },
  HISTORICAL: {
    label: 'HISTORICAL REPLAY',
    icon: '◉',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    description: 'Reconstructing historical disaster conditions',
  },
  SIMULATION: {
    label: 'SIMULATION',
    icon: '◇',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    description: 'Hypothetical scenario — not real data',
  },
}

// Hazard type configurations
export const HAZARD_TYPES = {
  flood: {
    label: 'Flood',
    icon: '🌊',
    color: '#3b82f6',
    layers: ['flood_extent', 'flood_depth', 'erosion', 'river_network'],
    stressors: ['river_level', 'rainfall', 'erosion_rate'],
  },
  landslide: {
    label: 'Landslide',
    icon: '⛰️',
    color: '#f97316',
    layers: ['landslide_susceptibility', 'slope', 'blocked_roads'],
    stressors: ['rainfall', 'slope_saturation', 'seismic'],
  },
  earthquake: {
    label: 'Earthquake',
    icon: '🔴',
    color: '#ef4444',
    layers: ['seismic_intensity', 'damage_assessment', 'aftershock_zones'],
    stressors: ['magnitude', 'depth', 'aftershock_probability'],
  },
}

export function AreaContextProvider({ children }) {
  const [area, setAreaState] = useState(DEFAULT_AREA)
  const [incident, setIncidentState] = useState(DEFAULT_INCIDENT)
  const [hazard, setHazardState] = useState(DEFAULT_HAZARD)
  const [mode, setModeState] = useState(MODES.LIVE)
  const [selectedFeature, setSelectedFeature] = useState(null) // Currently clicked map feature
  const [recentSearches, setRecentSearches] = useState([])

  const setArea = useCallback((newArea) => {
    setAreaState(prev => ({ ...prev, ...newArea }))
    // When area changes, clear selected feature
    setSelectedFeature(null)
  }, [])

  const setIncident = useCallback((newIncident) => {
    setIncidentState(prev => ({ ...prev, ...newIncident }))
  }, [])

  const setHazard = useCallback((newHazard) => {
    setHazardState(prev => ({ ...prev, ...newHazard }))
  }, [])

  const setMode = useCallback((newMode) => {
    if (MODES[newMode]) {
      setModeState(newMode)
    }
  }, [])

  const addRecentSearch = useCallback((search) => {
    setRecentSearches(prev => {
      const filtered = prev.filter(s => s.name !== search.name)
      return [search, ...filtered].slice(0, 8)
    })
  }, [])

  // Area breadcrumb string
  const areaBreadcrumb = useMemo(() => {
    const parts = [area.country, area.state, area.district || area.name].filter(Boolean)
    return parts.join(' / ').toUpperCase()
  }, [area])

  const value = useMemo(() => ({
    area,
    incident,
    hazard,
    mode,
    selectedFeature,
    recentSearches,
    areaBreadcrumb,
    modeConfig: MODE_CONFIG[mode],
    hazardConfig: HAZARD_TYPES[hazard.type] || HAZARD_TYPES.flood,
    setArea,
    setIncident,
    setHazard,
    setMode,
    setSelectedFeature,
    addRecentSearch,
  }), [area, incident, hazard, mode, selectedFeature, recentSearches, areaBreadcrumb, setArea, setIncident, setHazard, setMode, setSelectedFeature, addRecentSearch])

  return (
    <AreaContext.Provider value={value}>
      {children}
    </AreaContext.Provider>
  )
}

export function useAreaContext() {
  const ctx = useContext(AreaContext)
  if (!ctx) throw new Error('useAreaContext must be used within AreaContextProvider')
  return ctx
}

export default AreaContext
