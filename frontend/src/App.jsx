import { useState } from 'react'
import Home from './screens/Home'
import Discover from './screens/Discover'
import Favourites from './screens/Favourites'
import Profile from './screens/Profile'
import MealDescriptionOverlay from './components/molecules/MealDescriptionOverlay'

export default function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [selectedMeal, setSelectedMeal] = useState(null)

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

  return (
    <>
      {renderScreen()}
      {selectedMeal && (
        <MealDescriptionOverlay
          meal={selectedMeal}
          onClose={() => setSelectedMeal(null)}
        />
      )}
    </>
  )
}
