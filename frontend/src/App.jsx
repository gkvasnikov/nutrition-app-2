import { useState, useRef, useCallback } from 'react'
import Home from './screens/Home'
import Discover from './screens/Discover'
import Favourites from './screens/Favourites'
import Profile from './screens/Profile'
import MealDescriptionOverlay from './components/molecules/MealDescriptionOverlay'
import RestaurantDescriptionOverlay from './components/molecules/RestaurantDescriptionOverlay'
import { getTimedMealTime } from './utils/filterPill'
import { DataProvider } from './contexts/DataContext'
import { LocationProvider } from './contexts/LocationContext'

function loadFavourites() {
  try { return JSON.parse(localStorage.getItem('favourites') ?? '[]') }
  catch { return [] }
}

const DEFAULT_SECONDARY_FILTERS = {
  macrosConfidence: ['high', 'medium'],
  measure: 'per_meal',
  sortBy: 'best_match',
  openNow: false,
  topRanked: false,
}

function getInitialMainFilters() {
  const mealTime = getTimedMealTime()
  return {
    mealTime,
    diet: 'high_protein',
    macros: { kcal: [300, 900], protein: [25, 150], fat: [5, 55], carbs: [0, 150] },
    dietTags: { plantBased: false, glutenFree: false, diabetesFriendly: false },
    search: '',
  }
}

// ── Inner component — has access to DataContext ───────────────────────────────
function AppInner() {
  const [activeTab, setActiveTab] = useState('discover') // 'home' temporarily hidden
  const [mountedTabs, setMountedTabs] = useState(() => new Set(['discover']))
  const [selectedMeal, setSelectedMeal] = useState(null)
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)
  const [selectedMealZIndex,       setSelectedMealZIndex]       = useState(200)
  const [selectedRestaurantZIndex, setSelectedRestaurantZIndex] = useState(200)
  const zIndexCounterRef = useRef(200)
  const [favourites, setFavourites] = useState(loadFavourites)

  function toggleFavourite(meal) {
    setFavourites(prev => {
      const next = prev.some(f => f.id === meal.id)
        ? prev.filter(f => f.id !== meal.id)
        : [...prev, meal]
      localStorage.setItem('favourites', JSON.stringify(next))
      return next
    })
  }

  // ── Global filters — shared across Home + Discover ────────────────────────
  const [activeMainFilters,  setActiveMainFilters]  = useState(getInitialMainFilters)
  const [secondaryFilters,   setSecondaryFilters]   = useState(DEFAULT_SECONDARY_FILTERS)

  function handleRestaurantSelect(restaurant) {
    zIndexCounterRef.current += 10
    setSelectedRestaurantZIndex(zIndexCounterRef.current)
    setSelectedRestaurant(restaurant)
  }

  function handleMealSelect(meal) {
    zIndexCounterRef.current += 10
    setSelectedMealZIndex(zIndexCounterRef.current)
    setSelectedMeal(meal)
  }

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab)
    setMountedTabs(prev => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
  }, [])

  const filterProps = {
    activeMainFilters,
    onApplyMainFilters:      setActiveMainFilters,
    secondaryFilters,
    onApplySecondaryFilters: setSecondaryFilters,
    defaultSecondaryFilters: DEFAULT_SECONDARY_FILTERS,
  }

  const screenProps = {
    activeTab,
    onTabChange:        handleTabChange,
    onMealSelect:       handleMealSelect,
    onRestaurantSelect: handleRestaurantSelect,
    favourites,
    onToggleFavourite:  toggleFavourite,
    ...filterProps,
  }

  return (
    <>
      {/* Lazy-mount: each screen mounts on first visit and stays alive.
          Hidden screens get display:none — preserves all state & map instances. */}

      {mountedTabs.has('discover') && (
        <div style={activeTab !== 'discover' ? { display: 'none' } : undefined}>
          <Discover
            {...screenProps}
            isActive={activeTab === 'discover'}
          />
        </div>
      )}

      {mountedTabs.has('favourites') && (
        <div style={activeTab !== 'favourites' ? { display: 'none' } : undefined}>
          <Favourites {...screenProps} />
        </div>
      )}

      {/* Profile is lightweight — remount on visit is fine */}
      {activeTab === 'profile' && (
        <Profile activeTab={activeTab} onTabChange={handleTabChange} />
      )}

      {selectedMeal && (
        <MealDescriptionOverlay
          key={selectedMealZIndex}
          meal={selectedMeal}
          zIndex={selectedMealZIndex}
          onClose={() => setSelectedMeal(null)}
          onRestaurantSelect={handleRestaurantSelect}
          isFavourite={favourites.some(f => f.id === selectedMeal?.id)}
          onToggleFavourite={toggleFavourite}
        />
      )}

      {selectedRestaurant && (
        <RestaurantDescriptionOverlay
          key={selectedRestaurantZIndex}
          restaurant={selectedRestaurant}
          zIndex={selectedRestaurantZIndex}
          onClose={() => setSelectedRestaurant(null)}
          onMealSelect={handleMealSelect}
        />
      )}
    </>
  )
}

// ── Root — provides DataContext + LocationContext ─────────────────────────────
export default function App() {
  return (
    <DataProvider>
      <LocationProvider>
        <AppInner />
      </LocationProvider>
    </DataProvider>
  )
}
