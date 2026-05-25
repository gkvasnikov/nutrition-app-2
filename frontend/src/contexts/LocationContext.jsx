import { createContext, useContext, useEffect, useState } from 'react'

const LocationContext = createContext({ userLat: null, userLng: null })

export function LocationProvider({ children }) {
  const [coords, setCoords] = useState({ userLat: null, userLng: null })

  useEffect(() => {
    if (!navigator.geolocation) return

    let watchId = null

    // Try high-accuracy first, fall back to any accuracy
    const options = { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }

    watchId = navigator.geolocation.watchPosition(
      pos => {
        setCoords({ userLat: pos.coords.latitude, userLng: pos.coords.longitude })
      },
      () => {
        // Permission denied or unavailable — silently ignore, distance stays null
      },
      options,
    )

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  return (
    <LocationContext.Provider value={coords}>
      {children}
    </LocationContext.Provider>
  )
}

export function useLocation() {
  return useContext(LocationContext)
}
