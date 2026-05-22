import { useState } from 'react'
import Home from './screens/Home'
import Discover from './screens/Discover'

export default function App() {
  const [activeTab, setActiveTab] = useState('home')

  if (activeTab === 'discover') {
    return <Discover activeTab={activeTab} onTabChange={setActiveTab} />
  }

  return <Home activeTab={activeTab} onTabChange={setActiveTab} />
}
