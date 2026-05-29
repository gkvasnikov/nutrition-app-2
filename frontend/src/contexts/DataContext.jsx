import { createContext, useContext, useEffect, useRef, useMemo, useState, useCallback } from 'react'

/**
 * Loads restaurants (pins) and restaurant macro-summaries from the API.
 *
 * On mount: waits up to 3s for GPS, then fetches only nearby pins (5km radius).
 * Falls back to loading all Berlin pins if GPS is unavailable.
 *
 * loadMorePins(swLat, swLng, neLat, neLng) — call when map pans to a new area
 * to incrementally load restaurants in that bbox (deduped by id).
 *
 * restaurants   → pin data (id, name, lat, lng, isOpen, rating, …)
 * summaries     → macro ranges per restaurant for low-zoom filter (minCal, maxPro, …)
 * summaryById   → Map<id, summary>  — O(1) lookup
 * restaurantById  → Map<id, restaurant>
 * restaurantByName → Map<name, restaurant>
 */
const DataContext = createContext({
  restaurants:     [],
  summaries:       [],
  summaryById:     new Map(),
  restaurantById:  new Map(),
  restaurantByName: new Map(),
  loading: true,
  error:   null,
  loadMorePins: async () => {},
})

// Rough bbox from GPS center + radius in km
function radiusToBbox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180))
  return {
    swLat: lat - latDelta, neLat: lat + latDelta,
    swLng: lng - lngDelta, neLng: lng + lngDelta,
  }
}

// Get current position with a timeout
function getPositionWithTimeout(timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(timer); resolve(pos.coords) },
      ()  => { clearTimeout(timer); resolve(null) },
      { enableHighAccuracy: false, timeout: timeoutMs },
    )
  })
}

function bboxParams({ swLat, swLng, neLat, neLng }) {
  return `swLat=${swLat}&swLng=${swLng}&neLat=${neLat}&neLng=${neLng}`
}

export function DataProvider({ children }) {
  const [restaurants, setRestaurants] = useState([])
  const [summaries,   setSummaries]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Track loaded IDs to avoid duplicates on incremental loads
  const loadedPinIdsRef = useRef(new Set())

  useEffect(() => {
    async function init() {
      try {
        // Wait up to 3s for GPS — if available, load only nearby pins first
        let qs = ''
        if (navigator.geolocation) {
          const coords = await getPositionWithTimeout(3000)
          if (coords) {
            const bbox = radiusToBbox(coords.latitude, coords.longitude, 5)
            qs = `?${bboxParams(bbox)}`
          }
        }

        const [pins, summaryList] = await Promise.all([
          fetch(`/api/pins${qs}`).then(r => {
            if (!r.ok) throw new Error(`/api/pins ${r.status}`)
            return r.json()
          }),
          fetch(`/api/restaurant-summaries${qs}`).then(r => {
            if (!r.ok) throw new Error(`/api/restaurant-summaries ${r.status}`)
            return r.json()
          }),
        ])

        pins.forEach(p => loadedPinIdsRef.current.add(p.id))
        setRestaurants(pins)
        setSummaries(summaryList)
      } catch (err) {
        console.error('[DataContext] Failed to load app data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const loadMorePins = useCallback(async (swLat, swLng, neLat, neLng) => {
    try {
      const qs = `?${bboxParams({ swLat, swLng, neLat, neLng })}`
      const [newPins, newSummaries] = await Promise.all([
        fetch(`/api/pins${qs}`).then(r => r.ok ? r.json() : []),
        fetch(`/api/restaurant-summaries${qs}`).then(r => r.ok ? r.json() : []),
      ])
      const freshPins = newPins.filter(p => !loadedPinIdsRef.current.has(p.id))
      const freshSums = newSummaries.filter(s => !loadedPinIdsRef.current.has(s.id))
      freshPins.forEach(p => loadedPinIdsRef.current.add(p.id))
      if (freshPins.length) setRestaurants(prev => [...prev, ...freshPins])
      if (freshSums.length) setSummaries(prev => [...prev, ...freshSums])
    } catch (err) {
      console.error('[DataContext] loadMorePins error:', err)
    }
  }, [])

  const restaurantById   = useMemo(() => new Map(restaurants.map(r => [r.id, r])),   [restaurants])
  const restaurantByName = useMemo(() => new Map(restaurants.map(r => [r.name, r])), [restaurants])
  const summaryById      = useMemo(() => new Map(summaries.map(s => [s.id, s])),      [summaries])

  return (
    <DataContext.Provider value={{
      restaurants, summaries, summaryById,
      restaurantById, restaurantByName,
      loading, error, loadMorePins,
    }}>
      {children}
    </DataContext.Provider>
  )
}

export const useAppData = () => useContext(DataContext)
