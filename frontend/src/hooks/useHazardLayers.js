// src/hooks/useHazardLayers.js
// Generates hazard extent GeoJSON layers for the current area context.
// In production, these would come from satellite-derived data.
// Currently generates modeled/synthetic extents based on geography.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAreaContext } from '../context/AppStore'

// Generate a synthetic flood extent polygon around river areas
// These are clearly labeled as SYNTHETIC / MODELED
function generateFloodExtent(center, zoom) {
  const { lat, lon } = center
  const spread = zoom > 12 ? 0.02 : zoom > 10 ? 0.05 : 0.15

  // Generate irregular polygon simulating flood inundation
  const points = []
  const numPoints = 24
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI
    // Elongated along potential river axis (roughly east-west for Brahmaputra)
    const rx = spread * (0.6 + 0.4 * Math.random()) * 1.8
    const ry = spread * (0.4 + 0.3 * Math.random())
    points.push([
      lon + rx * Math.cos(angle) + (Math.random() - 0.5) * spread * 0.3,
      lat + ry * Math.sin(angle) + (Math.random() - 0.5) * spread * 0.2,
    ])
  }
  points.push(points[0]) // Close the ring

  return {
    type: 'Feature',
    properties: {
      layerType: 'flood_extent',
      severity: 'high',
      label: 'Modeled Flood Extent',
      dataSource: 'SYNTHETIC',
      confidence: null,
      description: 'Synthetic flood extent generated from terrain model. Not satellite-derived.',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [points],
    },
  }
}

// Generate erosion corridors along river banks
function generateErosionCorridor(center) {
  const { lat, lon } = center
  const corridors = []
  const numCorridors = 3

  for (let c = 0; c < numCorridors; c++) {
    const offsetLat = (Math.random() - 0.5) * 0.08
    const offsetLon = (Math.random() - 0.5) * 0.12
    const baseLat = lat + offsetLat
    const baseLon = lon + offsetLon
    const length = 0.02 + Math.random() * 0.03
    const width = 0.003 + Math.random() * 0.005

    const points = [
      [baseLon - length, baseLat - width],
      [baseLon + length, baseLat - width * 0.5],
      [baseLon + length + 0.005, baseLat + width * 0.5],
      [baseLon - length + 0.005, baseLat + width],
      [baseLon - length, baseLat - width],
    ]

    corridors.push({
      type: 'Feature',
      properties: {
        layerType: 'erosion_corridor',
        severity: ['high', 'medium', 'critical'][c % 3],
        label: `Erosion Corridor ${c + 1}`,
        dataSource: 'SYNTHETIC',
        description: 'Synthetic erosion corridor. Not satellite-derived.',
      },
      geometry: { type: 'Polygon', coordinates: [points] },
    })
  }
  return corridors
}

// Generate landslide susceptibility zones
function generateLandslideSusceptibility(center) {
  const { lat, lon } = center
  const zones = []
  const severities = ['high', 'medium', 'low']

  for (let i = 0; i < 5; i++) {
    const cLat = lat + (Math.random() - 0.5) * 0.1
    const cLon = lon + (Math.random() - 0.5) * 0.1
    const size = 0.005 + Math.random() * 0.015
    const numPts = 8
    const points = []
    for (let j = 0; j < numPts; j++) {
      const a = (j / numPts) * 2 * Math.PI
      const r = size * (0.7 + Math.random() * 0.3)
      points.push([cLon + r * Math.cos(a), cLat + r * Math.sin(a)])
    }
    points.push(points[0])

    zones.push({
      type: 'Feature',
      properties: {
        layerType: 'landslide_susceptibility',
        severity: severities[i % 3],
        label: `Landslide Zone ${i + 1}`,
        dataSource: 'SYNTHETIC',
      },
      geometry: { type: 'Polygon', coordinates: [points] },
    })
  }
  return zones
}

// Generate earthquake intensity contours
function generateEarthquakeIntensity(center) {
  const { lat, lon } = center
  const rings = []
  const intensities = ['IX', 'VIII', 'VII', 'VI', 'V']

  for (let i = 0; i < 5; i++) {
    const radius = 0.02 + i * 0.025
    const numPts = 20
    const points = []
    for (let j = 0; j < numPts; j++) {
      const a = (j / numPts) * 2 * Math.PI
      const r = radius * (0.9 + Math.random() * 0.2)
      points.push([lon + r * Math.cos(a), lat + r * Math.sin(a)])
    }
    points.push(points[0])

    rings.push({
      type: 'Feature',
      properties: {
        layerType: 'earthquake_intensity',
        intensity: intensities[i],
        severity: i < 2 ? 'critical' : i < 3 ? 'high' : 'medium',
        label: `MMI ${intensities[i]}`,
        dataSource: 'SYNTHETIC',
      },
      geometry: { type: 'Polygon', coordinates: [points] },
    })
  }
  return rings
}

export function useHazardLayers() {
  const { area, hazard } = useAreaContext()
  const [layers, setLayers] = useState({
    floodExtent: null,
    erosionCorridors: [],
    landslideSusceptibility: [],
    earthquakeIntensity: [],
  })
  const [loading, setLoading] = useState(false)
  const prevKeyRef = useRef('')

  // Regenerate layers when area or hazard type changes
  useEffect(() => {
    const key = `${area.lat}-${area.lon}-${hazard.type}`
    if (key === prevKeyRef.current) return
    prevKeyRef.current = key

    setLoading(true)

    // Small delay to prevent blocking map render
    const timer = setTimeout(() => {
      const center = { lat: area.lat, lon: area.lon }

      const newLayers = {
        floodExtent: null,
        erosionCorridors: [],
        landslideSusceptibility: [],
        earthquakeIntensity: [],
      }

      if (hazard.type === 'flood') {
        newLayers.floodExtent = generateFloodExtent(center, area.zoom || 10)
        newLayers.erosionCorridors = generateErosionCorridor(center)
      } else if (hazard.type === 'landslide') {
        newLayers.landslideSusceptibility = generateLandslideSusceptibility(center)
      } else if (hazard.type === 'earthquake') {
        newLayers.earthquakeIntensity = generateEarthquakeIntensity(center)
      }

      setLayers(newLayers)
      setLoading(false)
    }, 100)

    return () => clearTimeout(timer)
  }, [area.lat, area.lon, area.zoom, hazard.type])

  return { layers, loading }
}
