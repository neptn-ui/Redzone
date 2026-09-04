// src/hooks/useZones.js
// React hook — fetches and polls zone data with SWR-like auto-refresh.
import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'

export function useZones(params = {}, pollMs = 60_000) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const timer = useRef(null)

  const fetch = useCallback(async () => {
    try {
      const d = await api.zones(params)
      setData(d)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [JSON.stringify(params)])

  useEffect(() => {
    fetch()
    if (pollMs > 0) {
      timer.current = setInterval(fetch, pollMs)
    }
    return () => clearInterval(timer.current)
  }, [fetch, pollMs])

  return { data, loading, error, refetch: fetch }
}

export function usePriorityQueue(params = {}, pollMs = 30_000) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const timer = useRef(null)

  const fetch = useCallback(async () => {
    try {
      const d = await api.priorityQueue(params)
      setData(d)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [JSON.stringify(params)])

  useEffect(() => {
    fetch()
    if (pollMs > 0) {
      timer.current = setInterval(fetch, pollMs)
    }
    return () => clearInterval(timer.current)
  }, [fetch, pollMs])

  return { data, loading, error, refetch: fetch }
}

export function useZoneDetail(id) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api.zone(id)
       .then(d => { setData(d); setError(null) })
       .catch(e => setError(e.message))
       .finally(() => setLoading(false))
  }, [id])

  return { data, loading, error }
}
