// src/hooks/useRoute.js
// OSRM road-network routing hook.
// Returns real road geometry, distance, duration, and alternatives.
// ============================================================================

import { useState, useCallback, useRef } from 'react'
import { getRoute } from '../api/geo'

export function useRoute() {
  const [routeData, setRouteData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const calculateRoute = useCallback(async (origin, destination, options = {}) => {
    if (!origin || !destination) return

    const reqId = ++requestRef.current
    setLoading(true)
    setError(null)

    try {
      const result = await getRoute(origin, destination, options)

      // Ignore stale responses
      if (reqId !== requestRef.current) return

      if (result.error) {
        setError(result.error)
        setRouteData(null)
      } else {
        setRouteData(result)
      }
    } catch (err) {
      if (reqId === requestRef.current) {
        setError(err.message)
        setRouteData(null)
      }
    } finally {
      if (reqId === requestRef.current) {
        setLoading(false)
      }
    }
  }, [])

  const clearRoute = useCallback(() => {
    setRouteData(null)
    setError(null)
  }, [])

  return {
    routeData,
    primaryRoute: routeData?.routes?.[0] || null,
    alternateRoute: routeData?.routes?.[1] || null,
    allRoutes: routeData?.routes || [],
    loading,
    error,
    calculateRoute,
    clearRoute,
  }
}
