import { useState } from 'react'
import Home from './screens/Home'
import Discover from './screens/Discover'
import Favourites from './screens/Favourites'
import Profile from './screens/Profile'
import MealDescriptionOverlay from './components/molecules/MealDescriptionOverlay'
import RestaurantDescriptionOverlay from './components/molecules/RestaurantDescriptionOverlay'
import { getTimedMealTime } from './utils/filterPill'
import { MOCK_MEALS } from './data/mockMeals'

const DEFAULT_SECONDARY_FILTERS = {
  macrosConfidence: ['high', 'medium'],
  measure: 'per_meal',
  sortBy: 'nearest',
  openNow: false,
  topRanked: false,
}

function getInitialMainFilters() {
  const mealTime = getTimedMealTime()
  return {
    mealTime,
    diet: 'high_protein',
    macros: { kcal: [250, 1000], protein: [55, 200], fat: [0, 43], carbs: [0, 100] },
    dietTags: { plantBased: false, glutenFree: false, diabetesFriendly: false },
    search: '',
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState('discover') // 'home' temporarily hidden
  const [selectedMeal, setSelectedMeal] = useState(null)
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)

  // ── Global filters — shared across Home + Discover ────────────────────────
  const [activeMainFilters,  setActiveMainFilters]  = useState(getInitialMainFilters)
  const [secondaryFilters,   setSecondaryFilters]   = useState(DEFAULT_SECONDARY_FILTERS)

  function handleRestaurantSelect(restaurant) {
    setSelectedRestaurant(restaurant)
  }

  function handleMealSelect(meal) {
    setSelectedMeal(meal)
  }

  const filterProps = {
    activeMainFilters,
    onApplyMainFilters:      setActiveMainFilters,
    secondaryFilters,
    onApplySecondaryFilters: setSecondaryFilters,
    defaultSecondaryFilters: DEFAULT_SECONDARY_FILTERS,
  }

  const screenProps = {
    activeTab,
    onTabChange:        setActiveTab,
    onMealSelect:       handleMealSelect,
    onRestaurantSelect: handleRestaurantSelect,
    ...filterProps,
  }

  function renderScreen() {
    if (activeTab === 'discover')   return <Discover {...screenProps} />
    if (activeTab === 'favourites') return <Favourites {...screenProps} />
    if (activeTab === 'profile')    return <Profile activeTab={activeTab} onTabChange={setActiveTab} />
    return <Home {...screenProps} />
  }

  const restaurantMeals = selectedRestaurant
    ? MOCK_MEALS.filter(m => m.restaurantName === selectedRestaurant.name)
    : []

  return (
    <>
      {renderScreen()}

      {selectedMeal && (
        <MealDescriptionOverlay
          meal={selectedMeal}
          onClose={() => setSelectedMeal(null)}
          onRestaurantSelect={handleRestaurantSelect}
        />
      )}

      {selectedRestaurant && (
        <RestaurantDescriptionOverlay
          restaurant={selectedRestaurant}
          meals={restaurantMeals}
          onClose={() => setSelectedRestaurant(null)}
          onMealSelect={handleMealSelect}
        />
      )}
    </>
  )
}
