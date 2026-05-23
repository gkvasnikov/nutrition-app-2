import { useState, useEffect, useRef, Fragment } from 'react'
import TopBar from '../components/molecules/TopBar'
import MainNavigation from '../components/molecules/MainNavigation'
import CardMeal from '../components/molecules/CardMeal'
import { LocateIcon, LunchIcon, MapFloatIcon } from '../components/atoms/icons'
import { MOCK_MEALS } from '../data/mockMeals'
import styles from './Discover.module.css'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const CENTER = { lat: 52.521, lng: 13.398 }
const PEEK_SHOW = 200 // px visible from bottom in collapsed state

export default function Discover({ activeTab, onTabChange, onMealSelect }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const userMarkerRef = useRef(null)
  const sheetRef = useRef(null)
  const listRef = useRef(null)

  // Drag state
  const dragging = useRef(false)
  const isDraggingSheet = useRef(false) // vs scrolling the list
  const dragStartClientY = useRef(0)
  const dragStartTranslateY = useRef(0)
  const dragStartScrollTop = useRef(0)
  const lastClientY = useRef(0)
  const lastClientYTime = useRef(0)
  const velocityY = useRef(0) // px/ms

  // Keep a stable ref to isExpanded for use inside event handlers
  const isExpandedRef = useRef(false)
  isExpandedRef.current = isExpanded

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
      // Shift center 50px upward so the pin clears the bottom sheet
      map.panBy(0, 50)
      const pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="rgba(66,133,244,0.15)"/>
        <circle cx="12" cy="12" r="6" fill="#4285F4" stroke="#fff" stroke-width="2"/>
      </svg>`
      const icon = {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(pinSvg),
        scaledSize: new window.google.maps.Size(24, 24),
        anchor: new window.google.maps.Point(12, 12),
      }
      if (userMarkerRef.current) {
        userMarkerRef.current.setPosition(latLng)
      } else {
        userMarkerRef.current = new window.google.maps.Marker({
          position: latLng, map, icon, title: 'You are here', zIndex: 999,
        })
      }
    })
  }

  // ── Pin SVG helpers ──────────────────────────────────────
  // PAD = extra canvas space so shadow + badge never clip at viewBox edges
  const PIN_PAD = 10

  function makePinSvg(type, count, size) {
    // size = current diameter of the main circle (animates between 40–48)
    const pad = PIN_PAD
    const r   = size / 2 - 0.5          // radius (1px stroke on edge)
    const cc  = pad + size / 2           // circle center in padded canvas

    const shadow =
      `<defs><filter id="sh" x="-60%" y="-60%" width="220%" height="220%">` +
      `<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.15"/>` +
      `</filter></defs>`

    const circle =
      `<circle cx="${cc}" cy="${cc}" r="${r}" fill="#D7E5C1" stroke="white" stroke-width="1" filter="url(#sh)"/>`

    if (type === 'group') {
      // Badge: r=11, overlaps top-right of main circle
      // From Figma: badge center at (size-1, 9) in component space
      const BR      = 11
      const badgeCx = pad + (size - 1)    // from Figma exact coords
      const badgeCy = pad + 9             // constant regardless of circle size
      const svgW    = Math.ceil(badgeCx + BR + pad)
      const svgH    = Math.ceil(cc + r + pad)
      return (
        `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" fill="none" xmlns="http://www.w3.org/2000/svg">` +
        shadow + circle +
        `<circle cx="${badgeCx}" cy="${badgeCy}" r="${BR}" fill="#212121"/>` +
        `<text x="${badgeCx}" y="${badgeCy + 4.5}" text-anchor="middle" fill="white" font-size="11"` +
        ` font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="600">${count}</text>` +
        `</svg>`
      )
    }

    const svgS = Math.ceil(size + 2 * pad)
    return (
      `<svg width="${svgS}" height="${svgS}" viewBox="0 0 ${svgS} ${svgS}" fill="none" xmlns="http://www.w3.org/2000/svg">` +
      shadow + circle +
      `</svg>`
    )
  }

  function pinIcon(type, count, size) {
    const pad  = PIN_PAD
    const svg  = makePinSvg(type, count, size)
    const cc   = pad + size / 2   // circle center in canvas
    const r    = size / 2 - 0.5

    let svgW, svgH
    if (type === 'group') {
      const BR      = 11
      const badgeCx = pad + (size - 1)
      svgW = Math.ceil(badgeCx + BR + pad)
      svgH = Math.ceil(cc + r + pad)
    } else {
      svgW = Math.ceil(size + 2 * pad)
      svgH = svgW
    }
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new window.google.maps.Size(svgW, svgH),
      anchor: new window.google.maps.Point(cc, cc),
    }
  }

  // Animate a marker's icon from fromSize → toSize over ~220ms (ease-out)
  function animatePin(marker, cfg, fromSize, toSize) {
    const DURATION = 220
    const t0 = performance.now()
    function step(now) {
      const p      = Math.min((now - t0) / DURATION, 1)
      const eased  = 1 - Math.pow(1 - p, 3)  // ease-out cubic
      const size   = fromSize + (toSize - fromSize) * eased
      marker.setIcon(pinIcon(cfg.type, cfg.count, size))
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function addMealPins(map) {
    const PIN_DATA = [
      { lat: 52.5000, lng: 13.4390, type: 'single' },
      { lat: 52.4985, lng: 13.4415, type: 'single' },
      { lat: 52.5012, lng: 13.4375, type: 'single' },
      { lat: 52.4972, lng: 13.4400, type: 'group', count: 3 },
    ]

    let activeMarker = null

    PIN_DATA.forEach(cfg => {
      const marker = new window.google.maps.Marker({
        position: { lat: cfg.lat, lng: cfg.lng },
        map,
        icon: pinIcon(cfg.type, cfg.count, 40),
      })

      marker.addListener('click', () => {
        if (activeMarker && activeMarker !== marker) {
          animatePin(activeMarker, activeMarker._cfg, 48, 40)
        }
        const selecting = activeMarker !== marker
        animatePin(marker, cfg, selecting ? 40 : 48, selecting ? 48 : 40)
        activeMarker = selecting ? marker : null
      })

      marker._cfg = cfg
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
    addMealPins(mapInstanceRef.current)
    // Center on user location immediately on load
    locateMe()
  }

  // ── Sheet helpers ─────────────────────────────────────────────────
  function peekY() {
    return (sheetRef.current?.offsetHeight ?? window.innerHeight) - PEEK_SHOW
  }
  function expandedY() { return 0 }

  function getCurrentY() {
    const sheet = sheetRef.current
    if (!sheet) return peekY()
    const matrix = new DOMMatrix(getComputedStyle(sheet).transform)
    return matrix.m42
  }

  function setTransform(y, animated) {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.style.transition = animated
      ? 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)'
      : 'none'
    sheet.style.transform = `translateY(${y}px)`
  }

  function snapTo(expand) {
    setTransform(expand ? expandedY() : peekY(), true)
    setIsExpanded(expand)
  }

  useEffect(() => { setTransform(peekY(), false) }, []) // eslint-disable-line

  // ── Touch handlers (attached to entire sheet) ─────────────────────
  function onTouchStart(e) {
    const touch = e.touches[0]
    dragging.current = true
    isDraggingSheet.current = false
    dragStartClientY.current = touch.clientY
    dragStartScrollTop.current = listRef.current?.scrollTop ?? 0
    lastClientY.current = touch.clientY
    lastClientYTime.current = Date.now()
    velocityY.current = 0

    if (!isExpandedRef.current) {
      // Collapsed: always drag sheet
      isDraggingSheet.current = true
      dragStartTranslateY.current = getCurrentY()
      const sheet = sheetRef.current
      if (sheet) sheet.style.transition = 'none'
    }
    // Expanded: wait for touchmove to decide (sheet drag vs list scroll)
  }

  function onTouchMove(e) {
    if (!dragging.current) return

    const touch = e.touches[0]
    const delta = touch.clientY - dragStartClientY.current

    if (isExpandedRef.current && !isDraggingSheet.current) {
      // Expanded state: decide whether to drag sheet
      if (dragStartScrollTop.current === 0 && delta > 8) {
        // List was at top and user is pulling down → drag sheet
        isDraggingSheet.current = true
        dragStartTranslateY.current = getCurrentY()
        const sheet = sheetRef.current
        if (sheet) sheet.style.transition = 'none'
      } else {
        // Let list scroll naturally
        return
      }
    }

    if (isDraggingSheet.current) {
      e.preventDefault() // prevent list scroll while dragging sheet
      const newY = Math.max(expandedY(), Math.min(peekY(), dragStartTranslateY.current + delta))
      if (sheetRef.current) sheetRef.current.style.transform = `translateY(${newY}px)`
    }

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
    if (!isDraggingSheet.current) return

    const v = velocityY.current
    const currentY = getCurrentY()
    const mid = peekY() / 2

    let expand
    if (v < -0.3)      expand = true
    else if (v > 0.3)  expand = false
    else               expand = currentY < mid

    snapTo(expand)
  }

  // Attach touch events to the entire sheet
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.addEventListener('touchstart', onTouchStart, { passive: true })
    sheet.addEventListener('touchmove', onTouchMove, { passive: false })
    sheet.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      sheet.removeEventListener('touchstart', onTouchStart)
      sheet.removeEventListener('touchmove', onTouchMove)
      sheet.removeEventListener('touchend', onTouchEnd)
    }
  }, []) // eslint-disable-line

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className={styles.screen}>
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

      {/* TopBar with lunch icon + subtitle */}
      <TopBar
        title="Lunch"
        subtitle="High Protein"
        icon={<LunchIcon size={32} />}
      />

      {/* White fill behind TopBar — always rendered, animates in/out */}
      <div className={`${styles.topBarFill} ${isExpanded ? styles.topBarFillVisible : ''}`} />

      {/* Bottom sheet */}
      <div ref={sheetRef} className={styles.sheet}>
        {/* Handle + summary */}
        <div className={`${styles.header} ${isExpanded ? styles.headerExpanded : ''}`}>
          <div
            className={`${styles.handlePill} ${isExpanded ? styles.handlePillExpanded : ''}`}
            onClick={() => snapTo(!isExpanded)}
          />

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
          {MOCK_MEALS.map((meal, i) => (
            <Fragment key={meal.id}>
              {i > 0 && <div className={styles.separator} />}
              <CardMeal {...meal} onClick={() => onMealSelect?.(meal)} />
            </Fragment>
          ))}
        </div>
      </div>

      {/* Map button (expanded only) */}
      {isExpanded && (
        <button className={styles.mapToggleBtn} onClick={() => snapTo(false)}>
          <MapFloatIcon />
          <span>Map</span>
        </button>
      )}

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
