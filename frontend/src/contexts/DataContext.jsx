import { createContext, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Loads restaurants (pins) and meals from the Express API.
 * Replaces the static mockData.js import — data now comes from Railway PostgreSQL.
 *
 * Shape mirrors what extract_frontend_data.py used to produce:
 *   restaurants    → same as MOCK_RESTAURANTS (id, name, lat, lng, isOpen, …)
 *   meals          → same as MOCK_MEALS       (id, name, photo, calories, …)
 *   restaurantById → Map<id, restaurant>  — O(1) lookup (replaces RESTAURANT_BY_ID)
 *   restaurantByName → Map<name, restaurant> — O(1) lookup (replaces RESTAURANT_BY_NAME)
 */
const DataContext = createContext({
  restaurants: [],
  meals: [],
  restaurantById: new Map(),
  restaurantByName: new Map(),
  loading: true,
  error: null,
})

export function DataProvider({ children }) {
  const [restaurants, setRestaurants] = useState([])
  const [meals, setMeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/pins').then(r => {
        if (!r.ok) throw new Error(`/api/pins ${r.status}`)
        return r.json()
      }),
      fetch('/api/meals?limit=25000').then(r => {
        if (!r.ok) throw new Error(`/api/meals ${r.status}`)
        return r.json()
      }),
    ])
      .then(([pins, mealData]) => {
        setRestaurants(pins)
        setMeals(mealData)
      })
      .catch(err => {
        console.error('[DataContext] Failed to load app data:', err)
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [])

  const restaurantById = useMemo(
    () => new Map(restaurants.map(r => [r.id, r])),
    [restaurants]
  )

  const restaurantByName = useMemo(
    () => new Map(restaurants.map(r => [r.name, r])),
    [restaurants]
  )

  return (
    <DataContext.Provider value={{ restaurants, meals, restaurantById, restaurantByName, loading, error }}>
      {children}
    </DataContext.Provider>
  )
}

export const useAppData = () => useContext(DataContext)
