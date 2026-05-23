import { useState } from 'react'
import Home from './screens/Home'
import Discover from './screens/Discover'
import Favourites from './screens/Favourites'
import Profile from './screens/Profile'
import MealDescriptionOverlay from './components/molecules/MealDescriptionOverlay'
import RestaurantDescriptionOverlay from './components/molecules/RestaurantDescriptionOverlay'
import { MOCK_MEALS } from './data/mockMeals'

export default function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [selectedMeal, setSelectedMeal] = useState(null)
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)

  function handleRestaurantSelect(restaurant) {
    setSelectedMeal(null)
    setSelectedRestaurant(restaurant)
  }

  function renderScreen() {
    const props = {
      activeTab,
      onTabChange: setActiveTab,
      onMealSelect: setSelectedMeal,
    }
    if (activeTab === 'discover')    return <Discover {...props} />
    if (activeTab === 'favourites')  return <Favourites {...props} />
    if (activeTab === 'profile')     return <Profile activeTab={activeTab} onTabChange={setActiveTab} />
    return <Home {...props} />
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
          onMealSelect={setSelectedMeal}
        />
      )}
    </>
  )
}
