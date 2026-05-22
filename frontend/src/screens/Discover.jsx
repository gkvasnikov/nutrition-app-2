import { useState, useEffect, useRef, useCallback } from 'react'
import TopBar from '../components/molecules/TopBar'
import MainNavigation from '../components/molecules/MainNavigation'
import CardMeal from '../components/molecules/CardMeal'
import { MapIcon, LocateIcon } from '../components/atoms/icons'
import styles from './Discover.module.css'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const CENTER = { lat: 52.521, lng: 13.398 }
const PEEK_SHOW = 280 // px visible from bottom in collapsed state

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
  const userMarkerRef = useRef(null)
  const sheetRef = useRef(null)
  const listRef = useRef(null)

  // Drag state (all in refs to avoid re-renders during drag)
  const dragging = useRef(false)
  const dragStartClientY = useRef(0)
  const dragStartTranslateY = useRef(0)
  const lastClientY = useRef(0)
  const lastClientYTime = useRef(0)
  const velocityY = useRef(0) // px/ms

  // ── Map ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.google?.maps) { initMap(); return }
    if (document.getElementById('gmaps-script')) return
    const script = document.createElement('script')
    script.id = 'gmaps-script'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}`
    script.async = true
    script.onload = initMap
    document.head.appendChild(script)
  }, [])

  function locateMe() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords
      const latLng = { lat: latitude, lng: longitude }
      const map = mapInstanceRef.current
      if (!map) return

      map.panTo(latLng)
      map.setZoom(16)

      // Blue dot SVG — replicates native geolocation pin
      const pinSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" fill="rgba(66,133,244,0.15)"/>
          <circle cx="12" cy="12" r="6" fill="#4285F4" stroke="#fff" stroke-width="2"/>
        </svg>`

      const icon = {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(pinSvg),
        scaledSize: new window.google.maps.Size(24, 24),
        anchor: new window.google.maps.Point(12, 12),
      }

      if (userMarkerRef.current) {
        // Update existing marker position
        userMarkerRef.current.setPosition(latLng)
      } else {
        userMarkerRef.current = new window.google.maps.Marker({
          position: latLng,
          map,
          icon,
          title: 'You are here',
          zIndex: 999,
        })
      }
    })
  }

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

  // ── Sheet helpers ─────────────────────────────────────────────────
  function peekY() {
    const h = sheetRef.current?.offsetHeight ?? window.innerHeight
    return h - PEEK_SHOW
  }
  function expandedY() { return 0 }

  function setTransform(y, animated) {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.style.transition = animated
      ? 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)'
      : 'none'
    sheet.style.transform = `translateY(${y}px)`
  }

  function getCurrentY() {
    const sheet = sheetRef.current
    if (!sheet) return peekY()
    const matrix = new DOMMatrix(getComputedStyle(sheet).transform)
    return matrix.m42
  }

  function snapTo(expand) {
    setTransform(expand ? expandedY() : peekY(), true)
    setIsExpanded(expand)
  }

  // Initialise position without animation
  useEffect(() => {
    setTransform(peekY(), false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Touch on header (handle + summary) ───────────────────────────
  function onTouchStart(e) {
    // In expanded state, only start dragging if list is scrolled to top
    if (isExpanded && listRef.current && listRef.current.scrollTop > 0) return

    const touch = e.touches[0]
    dragging.current = true
    dragStartClientY.current = touch.clientY
    dragStartTranslateY.current = getCurrentY()
    lastClientY.current = touch.clientY
    lastClientYTime.current = Date.now()
    velocityY.current = 0

    const sheet = sheetRef.current
    if (sheet) sheet.style.transition = 'none'
  }

  function onTouchMove(e) {
    if (!dragging.current) return
    e.preventDefault() // prevent scroll bubbling

    const touch = e.touches[0]
    const delta = touch.clientY - dragStartClientY.current
    const newY = Math.max(expandedY(), Math.min(peekY(), dragStartTranslateY.current + delta))
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${newY}px)`

    // Track velocity
    const now = Date.now()
    const dt = now - lastClientYTime.current
    if (dt > 0) velocityY.current = (touch.clientY - lastClientY.current) / dt
    lastClientY.current = touch.clientY
    lastClientYTime.current = now
  }

  function onTouchEnd() {
    if (!dragging.current) return
    dragging.current = false

    const v = velocityY.current // px/ms  (positive = downward)
    const currentY = getCurrentY()
    const mid = peekY() / 2

    let expand
    if (v < -0.3)      expand = true  // fast swipe up
    else if (v > 0.3)  expand = false // fast swipe down
    else               expand = currentY < mid // snap to nearest

    snapTo(expand)
  }

  // Attach passive:false so preventDefault works on touch
  const headerRef = useCallback(node => {
    if (!node) return
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    node.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      node.removeEventListener('touchstart', onTouchStart)
      node.removeEventListener('touchmove', onTouchMove)
      node.removeEventListener('touchend', onTouchEnd)
    }
  }, [isExpanded]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className={styles.screen}>
      {/* Map */}
      <div ref={mapRef} className={styles.map} />

      {/* Map controls */}
      <div className={styles.mapControls}>
        <button className={styles.mapBtn} aria-label="Zoom in"
          onClick={() => mapInstanceRef.current?.setZoom((mapInstanceRef.current.getZoom() || 15) + 1)}>
          <span className={styles.mapBtnText}>+</span>
        </button>
        <button className={styles.mapBtn} aria-label="Zoom out"
          onClick={() => mapInstanceRef.current?.setZoom((mapInstanceRef.current.getZoom() || 15) - 1)}>
          <span className={styles.mapBtnText}>−</span>
        </button>
        <button className={`${styles.mapBtn} ${styles.mapBtnLocate}`} aria-label="My location"
          onClick={locateMe}>
          <LocateIcon size={20} />
        </button>
      </div>

      {/* TopBar */}
      <TopBar title="Lunch" />

      {/* White fill behind TopBar (visible when expanded) */}
      {isExpanded && <div className={styles.topBarFill} />}

      {/* Bottom sheet — transform managed entirely via JS */}
      <div ref={sheetRef} className={styles.sheet}>

        {/* Draggable header: handle pill + summary */}
        <div ref={headerRef} className={`${styles.header} ${isExpanded ? styles.headerExpanded : ''}`}>
          <div className={styles.handlePill} onClick={() => snapTo(!isExpanded)} />

          {!isExpanded && (
            <div className={styles.summary}>
              <p className={styles.mealCount}>{MOCK_MEALS.length * 8} Meals</p>
              <p className={styles.mealSubtitle}>in 34 restaurants around you</p>
            </div>
          )}
        </div>

        {/* Scrollable list */}
        <div
          ref={listRef}
          className={`${styles.list} ${isExpanded ? styles.listExpanded : ''}`}
        >
          {MOCK_MEALS.map(meal => (
            <CardMeal key={meal.id} {...meal} />
          ))}
        </div>
      </div>

      {/* Map button (expanded only) */}
      {isExpanded && (
        <button className={styles.mapToggleBtn} onClick={() => snapTo(false)}>
          <MapIcon size={20} className={styles.mapToggleIcon} />
          <span>Map</span>
        </button>
      )}

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
