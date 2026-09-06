// src/context/AppStore.jsx
// ============================================================================
// REDZONE — Single Source of Truth
//
// Replaces AreaContext with a complete application state container.
// Uses useReducer for predictable state transitions.
//
// State shape covers every cross-page concern:
//   area, mode, hazard, incident, selectedFeature, activeLayers,
//   selectedRoute, selectedSite, selectedOrigin, currentPlan,
//   decisionState, historicalEvent, historicalTimestamp,
//   scenarioState, dataSources
// ============================================================================

import {
  createContext, useContext, useReducer, useCallback, useMemo,
} from 'react'

// ─── Constants ───────────────────────────────────────────────────────────────

export const MODES = {
  LIVE: 'LIVE',
  HISTORICAL: 'HISTORICAL',
  SIMULATION: 'SIMULATION',
}

export const MODE_META = {
  LIVE: {
    label: 'LIVE',
    description: 'Currently available data',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
  },
  HISTORICAL: {
    label: 'HISTORICAL',
    description: 'Reconstructed from records — not real-time',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
  },
  SIMULATION: {
    label: 'SIMULATION',
    description: 'Hypothetical scenario — not real data',
    dotClass: 'bg-blue-400',
    textClass: 'text-blue-400',
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/30',
  },
}

// Data status vocabulary — every data point must carry one of these
export const DATA_STATUS = {
  LIVE: { label: 'LIVE', color: 'text-emerald-400' },
  RECENT: { label: 'RECENT', color: 'text-emerald-300' },
  STATIC: { label: 'STATIC', color: 'text-slate-400' },
  HISTORICAL: { label: 'HISTORICAL', color: 'text-amber-400' },
  RECONSTRUCTED: { label: 'RECONSTRUCTED', color: 'text-amber-300' },
  MODELLED: { label: 'MODELLED', color: 'text-blue-400' },
  SIMULATED: { label: 'SIMULATED', color: 'text-blue-300' },
  SYNTHETIC: { label: 'SYNTHETIC', color: 'text-slate-500' },
  UNAVAILABLE: { label: 'UNAVAILABLE', color: 'text-red-400' },
}

export const HAZARD_TYPES = {
  flood: {
    id: 'flood', label: 'Flood', icon: 'flood',
    color: '#3b82f6', dimColor: 'rgba(59,130,246,0.15)',
    layers: ['flood_extent', 'flood_depth', 'river_network', 'erosion_corridor'],
    defaultScenarioParams: {
      river_level_m: 0, rainfall_mm_24h: 0, drainage_factor: 1.0,
    },
  },
  erosion: {
    id: 'erosion', label: 'River Erosion', icon: 'erosion',
    color: '#f97316', dimColor: 'rgba(249,115,22,0.15)',
    layers: ['erosion_corridor', 'river_channel', 'retreat_zone'],
    defaultScenarioParams: {
      river_level_m: 0, discharge_m3s: 0, erosion_rate_myr: 0,
    },
  },
  landslide: {
    id: 'landslide', label: 'Landslide', icon: 'landslide',
    color: '#d97706', dimColor: 'rgba(217,119,6,0.15)',
    layers: ['landslide_susceptibility', 'slope_map', 'blocked_roads'],
    defaultScenarioParams: {
      rainfall_mm_24h: 0, soil_saturation_pct: 0, slope_instability: 0,
    },
  },
  earthquake: {
    id: 'earthquake', label: 'Earthquake', icon: 'earthquake',
    color: '#ef4444', dimColor: 'rgba(239,68,68,0.15)',
    layers: ['intensity_contours', 'epicenter', 'damage_assessment'],
    defaultScenarioParams: {
      magnitude: 0, depth_km: 10, aftershock_probability: 0,
    },
  },
}

// ─── Initial State ────────────────────────────────────────────────────────────

const initialState = {
  // --- Geographic context ---
  area: null,           // { name, lat, lon, zoom, bbox, state, country, osmId }
  areaStatus: 'idle',   // 'idle' | 'loading' | 'ready' | 'error'

  // --- Incident (may be null — no invented incidents) ---
  incident: null,       // { id, name, type, startTime, severity, source }

  // --- Hazard (may be null — no active hazard is valid) ---
  hazard: null,         // { type, severity, confidence, dataStatus, source }

  // --- Operational mode (global) ---
  mode: MODES.LIVE,

  // --- Map & layer state ---
  selectedFeature: null,  // currently inspected map object
  activeLayers: {
    flood_extent: true,
    flood_depth: false,
    river_network: true,
    erosion_corridor: false,
    settlements: true,
    safe_sites: true,
    routes: true,
    infrastructure: false,
    landslide_susceptibility: false,
    intensity_contours: false,
  },
  mapViewport: {
    lat: 20.5937,   // India center as truly neutral default
    lon: 78.9629,
    zoom: 5,
  },

  // --- Routing ---
  selectedOrigin: null,  // habitation or custom point
  selectedDestination: null,  // safe site or custom point
  selectedRoute: null,  // full OSRM response or null
  routeStatus: 'idle', // 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

  // --- Safe site selection ---
  selectedSite: null,

  // --- Relocation plan ---
  currentPlan: null,    // full plan object
  planStatus: 'draft', // 'draft' | 'review' | 'approved' | 'overridden' | 'deployed'

  // --- Decision audit ---
  decisionState: null,  // { recommendation, action, overrideReason, operator, timestamp }

  // --- Historical mode ---
  historicalEvent: null,  // selected event from catalog
  historicalTimestamp: null,  // current scrubber position (ISO string)
  historicalTimeline: [],    // available timestamps for event

  // --- Scenario mode ---
  scenarioPreset: 'normal',  // preset name
  scenarioParams: {},        // { river_level_m, rainfall_mm_24h, ... }
  scenarioBaseline: null,    // backend response for baseline
  scenarioProjection: null,   // backend response for current params

  // --- Data source health ---
  dataSources: {},     // { [sourceKey]: { status, lastUpdated, value, coverage } }

  // --- Recent searches ---
  recentSearches: [],
}

// ─── Canonical AreaContext (§0.1, §0.5) ──────────────────────────────────────

export function createAreaContext(raw) {
  if (!raw) return null
  const lat = parseFloat(raw.lat ?? raw.latitude ?? 0)
  const lng = parseFloat(raw.lng ?? raw.lon ?? raw.longitude ?? 0)
  const displayName = raw.display_name ?? raw.displayName ?? raw.name ?? 'Searched Location'
  const country = raw.country ?? null
  const state = raw.state ?? null
  const district = raw.district ?? raw.county ?? null

  return {
    display_name: displayName,
    name: raw.name ?? displayName.split(',')[0].trim(),
    lat,
    lng,
    lon: lng, // alias for leaflet compatibility
    bounding_box: raw.bounding_box ?? raw.bbox ?? null,
    bbox: raw.bbox ?? raw.bounding_box ?? null,
    country,
    state,
    district,
    resolution_source: raw.resolution_source ?? 'Nominatim / OpenStreetMap',
    matched_region_id: raw.matched_region_id ?? null,
    matched_region_name: raw.matched_region_name ?? null,
    is_seeded: Boolean(raw.is_seeded || raw.matched_region_id),
    zoom: raw.zoom ?? 11,
    osmId: raw.osmId ?? raw.osm_id ?? null,
    osmType: raw.osmType ?? raw.osm_type ?? null,
  }
}

export function formatAreaBreadcrumb(area) {
  if (!area) return 'NO AREA SELECTED'
  const parts = []
  if (area.country) parts.push(area.country.trim())
  if (area.state && area.state.trim().toLowerCase() !== area.country?.trim().toLowerCase()) {
    parts.push(area.state.trim())
  }
  const local = (area.district || area.name || '').trim()
  if (local &&
      local.toLowerCase() !== area.country?.trim().toLowerCase() &&
      local.toLowerCase() !== area.state?.trim().toLowerCase()) {
    parts.push(local)
  }
  return parts.length > 0 ? parts.join(' / ').toUpperCase() : (area.display_name || '').toUpperCase()
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

function reducer(state, action) {
  switch (action.type) {

    case 'SET_AREA': {
      const canonicalArea = createAreaContext(action.payload)
      return {
        ...state,
        area: canonicalArea,
        areaStatus: 'ready',
        // Atomic context reset on every new search (§0.4):
        selectedFeature: null,
        incident: null,
        hazard: null,
        historicalEvent: null,
        historicalTimestamp: null,
        historicalTimeline: [],
        selectedOrigin: null,
        selectedDestination: null,
        selectedRoute: null,
        routeStatus: 'idle',
        selectedSite: null,
        currentPlan: null,
        planStatus: 'draft',
        decisionState: null,
        scenarioBaseline: null,
        scenarioProjection: null,
        scenarioParams: {},
        mapViewport: canonicalArea ? {
          lat: canonicalArea.lat,
          lon: canonicalArea.lon,
          zoom: canonicalArea.zoom,
        } : state.mapViewport,
      }
    }

    case 'SET_AREA_STATUS':
      return { ...state, areaStatus: action.payload }

    case 'SET_INCIDENT':
      return { ...state, incident: action.payload }

    case 'CLEAR_INCIDENT':
      return { ...state, incident: null }

    case 'SET_HAZARD':
      return { ...state, hazard: action.payload }

    case 'CLEAR_HAZARD':
      return { ...state, hazard: null }

    case 'SET_MODE':
      return {
        ...state,
        mode: action.payload,
        // Clearing historical context when leaving HISTORICAL mode
        ...(action.payload !== MODES.HISTORICAL
          ? { historicalEvent: null, historicalTimestamp: null, historicalTimeline: [] }
          : {}),
        // Clear scenario context when leaving SIMULATION mode
        ...(action.payload !== MODES.SIMULATION
          ? { scenarioBaseline: null, scenarioProjection: null }
          : {}),
      }

    case 'SET_SELECTED_FEATURE':
      return { ...state, selectedFeature: action.payload }

    case 'TOGGLE_LAYER':
      return {
        ...state,
        activeLayers: {
          ...state.activeLayers,
          [action.payload]: !state.activeLayers[action.payload],
        },
      }

    case 'SET_LAYERS':
      return { ...state, activeLayers: { ...state.activeLayers, ...action.payload } }

    case 'SET_MAP_VIEWPORT':
      return { ...state, mapViewport: action.payload }

    case 'SET_ORIGIN':
      return { ...state, selectedOrigin: action.payload, selectedRoute: null, routeStatus: 'idle' }

    case 'SET_DESTINATION':
      return { ...state, selectedDestination: action.payload, selectedRoute: null, routeStatus: 'idle' }

    case 'SET_ROUTE':
      return { ...state, selectedRoute: action.payload, routeStatus: 'ready' }

    case 'SET_ROUTE_STATUS':
      return { ...state, routeStatus: action.payload }

    case 'SET_SELECTED_SITE':
      return { ...state, selectedSite: action.payload }

    case 'SET_CURRENT_PLAN':
      return { ...state, currentPlan: action.payload, planStatus: 'draft' }

    case 'SET_PLAN_STATUS':
      return { ...state, planStatus: action.payload }

    case 'SET_DECISION':
      return { ...state, decisionState: action.payload }

    case 'SET_HISTORICAL_EVENT':
      return {
        ...state,
        historicalEvent: action.payload,
        historicalTimestamp: action.payload?.defaultTimestamp ?? null,
        historicalTimeline: action.payload?.timeline ?? [],
        mode: MODES.HISTORICAL,
        selectedFeature: null,
      }

    case 'CLEAR_HISTORICAL':
      return {
        ...state,
        historicalEvent: null,
        historicalTimestamp: null,
        historicalTimeline: [],
        mode: MODES.LIVE,
      }

    case 'SET_HISTORICAL_TIMESTAMP':
      return { ...state, historicalTimestamp: action.payload }

    case 'SET_SCENARIO_PRESET':
      return { ...state, scenarioPreset: action.payload }

    case 'SET_SCENARIO_PARAMS':
      return {
        ...state,
        scenarioParams: { ...state.scenarioParams, ...action.payload },
        mode: MODES.SIMULATION,
      }

    case 'RESET_SCENARIO':
      return {
        ...state,
        scenarioPreset: 'normal',
        scenarioParams: {},
        scenarioBaseline: null,
        scenarioProjection: null,
        mode: MODES.LIVE,
      }

    case 'SET_SCENARIO_BASELINE':
      return { ...state, scenarioBaseline: action.payload }

    case 'SET_SCENARIO_PROJECTION':
      return { ...state, scenarioProjection: action.payload }

    case 'UPDATE_DATA_SOURCE':
      return {
        ...state,
        dataSources: { ...state.dataSources, [action.payload.key]: action.payload.data },
      }

    case 'ADD_RECENT_SEARCH':
      return {
        ...state,
        recentSearches: [
          action.payload,
          ...state.recentSearches.filter(s => s.name !== action.payload.name),
        ].slice(0, 8),
      }

    default:
      return state
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AppStoreContext = createContext(null)

export function AppStoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Bound action creators
  const actions = useMemo(() => ({
    setArea: (area) => dispatch({ type: 'SET_AREA', payload: area }),
    setAreaStatus: (s) => dispatch({ type: 'SET_AREA_STATUS', payload: s }),
    setIncident: (inc) => dispatch({ type: 'SET_INCIDENT', payload: inc }),
    clearIncident: () => dispatch({ type: 'CLEAR_INCIDENT' }),
    setHazard: (hz) => dispatch({ type: 'SET_HAZARD', payload: hz }),
    clearHazard: () => dispatch({ type: 'CLEAR_HAZARD' }),
    setMode: (m) => dispatch({ type: 'SET_MODE', payload: m }),
    setSelectedFeature: (f) => dispatch({ type: 'SET_SELECTED_FEATURE', payload: f }),
    toggleLayer: (id) => dispatch({ type: 'TOGGLE_LAYER', payload: id }),
    setLayers: (layers) => dispatch({ type: 'SET_LAYERS', payload: layers }),
    setMapViewport: (vp) => dispatch({ type: 'SET_MAP_VIEWPORT', payload: vp }),
    setOrigin: (o) => dispatch({ type: 'SET_ORIGIN', payload: o }),
    setDestination: (d) => dispatch({ type: 'SET_DESTINATION', payload: d }),
    setRoute: (r) => dispatch({ type: 'SET_ROUTE', payload: r }),
    setRouteStatus: (s) => dispatch({ type: 'SET_ROUTE_STATUS', payload: s }),
    setSelectedSite: (s) => dispatch({ type: 'SET_SELECTED_SITE', payload: s }),
    setCurrentPlan: (p) => dispatch({ type: 'SET_CURRENT_PLAN', payload: p }),
    setPlanStatus: (s) => dispatch({ type: 'SET_PLAN_STATUS', payload: s }),
    setDecision: (d) => dispatch({ type: 'SET_DECISION', payload: d }),
    setHistoricalEvent: (e) => dispatch({ type: 'SET_HISTORICAL_EVENT', payload: e }),
    clearHistorical: () => dispatch({ type: 'CLEAR_HISTORICAL' }),
    setHistoricalTimestamp: (t) => dispatch({ type: 'SET_HISTORICAL_TIMESTAMP', payload: t }),
    setScenarioPreset: (p) => dispatch({ type: 'SET_SCENARIO_PRESET', payload: p }),
    setScenarioParams: (p) => dispatch({ type: 'SET_SCENARIO_PARAMS', payload: p }),
    resetScenario: () => dispatch({ type: 'RESET_SCENARIO' }),
    setScenarioBaseline: (b) => dispatch({ type: 'SET_SCENARIO_BASELINE', payload: b }),
    setScenarioProjection: (p) => dispatch({ type: 'SET_SCENARIO_PROJECTION', payload: p }),
    updateDataSource: (key, data) => dispatch({ type: 'UPDATE_DATA_SOURCE', payload: { key, data } }),
    addRecentSearch: (s) => dispatch({ type: 'ADD_RECENT_SEARCH', payload: s }),
  }), [])

  const value = useMemo(() => ({
    ...state,
    ...actions,
    // Computed
    modeMeta: MODE_META[state.mode],
    hazardMeta: state.hazard ? HAZARD_TYPES[state.hazard.type] : null,
    hasArea: !!state.area,
    hasHazard: !!state.hazard,
    hasIncident: !!state.incident,
    hasRoute: !!state.selectedRoute,
    hasPlan: !!state.currentPlan,
    isLive: state.mode === MODES.LIVE,
    isHistorical: state.mode === MODES.HISTORICAL,
    isSimulation: state.mode === MODES.SIMULATION,
  }), [state, actions])

  return (
    <AppStoreContext.Provider value={value}>
      {children}
    </AppStoreContext.Provider>
  )
}

export function useAppStore() {
  const ctx = useContext(AppStoreContext)
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider')
  return ctx
}

// Backwards-compatibility shim for old useAreaContext imports
// (will be removed once all pages are migrated)
export function useAreaContext() {
  return useAppStore()
}

export default AppStoreContext
