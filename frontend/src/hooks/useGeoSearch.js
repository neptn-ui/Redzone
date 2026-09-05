// src/hooks/useGeoSearch.js
// Debounced Nominatim geocoding hook with result caching.
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { geocode } from '../api/geo'

export function useGeoSearch(query, { debounceMs = 350, enabled = true } = {}) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const timerRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!enabled || !query || query.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    // Clear previous debounce timer
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      try {
        const data = await geocode(query, {
          limit: 8,
          // Prioritize India but don't restrict
        })
        setResults(data)
        setError(null)
      } catch (err) {
        setError(err.message)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, debounceMs, enabled])

  const clear = useCallback(() => {
    setResults([])
    setError(null)
  }, [])

  return { results, loading, error, clear }
}
