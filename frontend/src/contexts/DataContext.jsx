import { createContext, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Loads restaurants (pins) and restaurant macro-summaries from the API.
 *
 * Meal data is NO LONGER loaded globally — Discover.jsx loads meals
 * lazily per viewport via /api/area-meals when the user zooms in.
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
})

export function DataProvider({ children }) {
  const [restaurants, setRestaurants] = useState([])
  const [summaries,   setSummaries]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/pins').then(r => {
        if (!r.ok) throw new Error(`/api/pins ${r.status}`)
        return r.json()
      }),
      fetch('/api/restaurant-summaries').then(r => {
        if (!r.ok) throw new Error(`/api/restaurant-summaries ${r.status}`)
        return r.json()
      }),
    ])
      .then(([pins, summaryList]) => {
        setRestaurants(pins)
        setSummaries(summaryList)
      })
      .catch(err => {
        console.error('[DataContext] Failed to load app data:', err)
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [])

  const restaurantById   = useMemo(() => new Map(restaurants.map(r => [r.id, r])),   [restaurants])
  const restaurantByName = useMemo(() => new Map(restaurants.map(r => [r.name, r])), [restaurants])
  const summaryById      = useMemo(() => new Map(summaries.map(s => [s.id, s])),      [summaries])

  return (
    <DataContext.Provider value={{
      restaurants, summaries, summaryById,
      restaurantById, restaurantByName,
      loading, error,
    }}>
      {children}
    </DataContext.Provider>
  )
}

export const useAppData = () => useContext(DataContext)
