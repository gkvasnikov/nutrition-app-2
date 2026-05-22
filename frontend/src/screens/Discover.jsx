import { useState, useEffect, useRef } from 'react'
import TopBar from '../components/molecules/TopBar'
import MainNavigation from '../components/molecules/MainNavigation'
import CardMeal from '../components/molecules/CardMeal'
import { MapIcon } from '../components/atoms/icons'
import styles from './Discover.module.css'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// Berlin Mitte center
const CENTER = { lat: 52.521, lng: 13.398 }

const MOCK_MEALS = [
  {
    id: 1,
    name: 'Bowl Pollo Asado',
    price: '€6.00',
    description: 'Gurke, Knoblauch, Essig, Sojasauce, Sichuan-Pfeffer, Sesam und Chiliöl',
    calories: 85, protein: 2.5, fat: 6, carbs: 7,
    restaurantName: 'Wen Cheng Görlitzer',
    priceRange: '€10–20', distance: '30m', rating: 4.7, reviewCount: 852,
  },
  {
    id: 2,
    name: 'Karisik Izgara',
    price: '€29.90',
    description: 'gemischte Grillplatte (Köfte, Lammkotelett, Lammrippchen, Lammspieß)',
    calories: 520, protein: 28.5, fat: 18, carbs: 62,
    restaurantName: 'Wen Cheng Görlitzer',
    priceRange: '€10–20', distance: '30m', rating: 4.7, reviewCount: 852,
  },
  {
    id: 3,
    name: 'Halbes Hähnchen',
    price: '€12.00',
    description: 'mit Auberginen, veganem Hackfleisch, Wencheng-Soße, Knoblauch, Chili',
    calories: 420, protein: 12.5, fat: 18.5, carbs: 52,
    restaurantName: 'Wen Cheng Görlitzer',
    priceRange: '€10–20', distance: '30m', rating: 4.7, reviewCount: 852,
  },
  {
    id: 4,
    name: 'Schnitzel Bowl',
    price: '€16.00',
    description: 'Doppelte Schnitzel mit paniertem Hähnchenbrustfilet und eine Auswahl mit Beilagen',
    calories: 680, protein: 24, fat: 24, carbs: 38.5,
    restaurantName: 'Green & Protein',
    priceRange: '€10–20', distance: '5m', rating: 4.6, reviewCount: 874,
  },
]

export default function Discover({ activeTab, onTabChange }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  useEffect(() => {
    if (window.google?.maps) {
      initMap()
      return
    }
    if (document.getElementById('gmaps-script')) return

    const script = document.createElement('script')
    script.id = 'gmaps-script'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}`
    script.async = true
    script.onload = initMap
    document.head.appendChild(script)
  }, [])

  function initMap() {
    if (!mapRef.current || mapInstanceRef.current) return
    mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
      center: CENTER,
      zoom: 15,
      disableDefaultUI: true,
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    })
  }

  return (
    <div className={styles.screen}>
      {/* Map */}
      <div ref={mapRef} className={styles.map} />

      {/* Map controls */}
      <div className={styles.mapControls}>
        <button className={styles.mapBtn} onClick={() => mapInstanceRef.current?.setZoom((mapInstanceRef.current.getZoom() || 15) + 1)}>
          <span className={styles.mapBtnText}>+</span>
        </button>
        <button className={styles.mapBtn} onClick={() => mapInstanceRef.current?.setZoom((mapInstanceRef.current.getZoom() || 15) - 1)}>
          <span className={styles.mapBtnText}>−</span>
        </button>
      </div>

      {/* TopBar */}
      <TopBar title="Lunch" />

      {/* Bottom sheet */}
      <div className={`${styles.sheet} ${isExpanded ? styles.sheetExpanded : ''}`}>
        <button className={styles.handle} onClick={() => setIsExpanded(v => !v)} aria-label="Toggle list" />

        {!isExpanded && (
          <div className={styles.summary}>
            <p className={styles.mealCount}>{MOCK_MEALS.length * 8} Meals</p>
            <p className={styles.mealSubtitle}>in 34 restaurants around you</p>
          </div>
        )}

        <div className={styles.list}>
          {MOCK_MEALS.map(meal => (
            <CardMeal key={meal.id} {...meal} />
          ))}
        </div>
      </div>

      {/* Map button (expanded only) */}
      {isExpanded && (
        <button className={styles.mapToggleBtn} onClick={() => setIsExpanded(false)}>
          <MapIcon size={20} className={styles.mapToggleIcon} />
          <span>Map</span>
        </button>
      )}

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
