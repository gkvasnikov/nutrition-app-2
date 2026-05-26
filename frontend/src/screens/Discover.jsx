import { useState, useEffect, useRef, Fragment } from 'react'
import TopBar from '../components/molecules/TopBar'
import MainNavigation from '../components/molecules/MainNavigation'
import CardMeal from '../components/molecules/CardMeal'
import FiltersPanel from '../components/molecules/FiltersPanel'
import MealFilterOverlay from '../components/molecules/MealFilterOverlay'
import { LocateIcon, MapFloatIcon, DirectionIcon, CloseIcon } from '../components/atoms/icons'
import { buildPillTitle, buildPillIcon, buildPillSubtitle } from '../utils/filterPill'
import { withKey } from '../utils/photoUrl'
import { useAppData } from '../contexts/DataContext'
import styles from './Discover.module.css'


const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const CENTER = { lat: 52.5170, lng: 13.3889 } // Berlin center
const PEEK_SHOW = 200 // px visible from bottom in collapsed state

export default function Discover({
  activeTab, onTabChange, onMealSelect,
  activeMainFilters, onApplyMainFilters,
  secondaryFilters, onApplySecondaryFilters, defaultSecondaryFilters,
  isActive = true,
}) {
  // ── Data from PostgreSQL (via /api/pins + /api/meals) ────────────────────
  const { restaurants: apiRestaurants, meals: apiMeals, loading: dataLoading } = useAppData()

  // O(1) lookup for openNow filter — rebuilt when restaurants load
  const restaurantByIdRef = useRef(new Map())
  if (apiRestaurants.length && !restaurantByIdRef.current.size) {
    restaurantByIdRef.current = new Map(apiRestaurants.map(r => [r.id, r]))
  }

  // Map script + init guards
  const [mapsScriptReady, setMapsScriptReady] = useState(!!window.google?.maps)
  const mapInitialisedRef = useRef(false)

  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedPin, setSelectedPin] = useState(null) // null | { type, meals[] }
  const [pinExiting, setPinExiting] = useState(false)
  const [visibleMeals, setVisibleMeals] = useState([]) // meals from pins in current viewport
  const [showFilters, setShowFilters] = useState(false)
  const [pendingFilters, setPendingFilters] = useState(secondaryFilters)
  const [showMealFilter, setShowMealFilter] = useState(false)
  const lastSelectedPinRef = useRef(null) // keeps content visible during exit anim
  const pinDataRef = useRef([])           // all PIN_DATA, populated after image load
  const markersRef = useRef([])           // [{ marker, cfg }] for filter-driven updates
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const userMarkerRef = useRef(null)
  const sheetRef = useRef(null)
  const listRef = useRef(null)
  const activeMarkerRef = useRef(null) // currently selected map marker

  // Stable refs for filter state — safe to read inside map event handlers
  const activeMainFiltersRef = useRef(activeMainFilters)
  activeMainFiltersRef.current = activeMainFilters
  const secondaryFiltersRef = useRef(secondaryFilters)
  secondaryFiltersRef.current = secondaryFilters

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

  // Stable ref so map event handlers can call latest selectPin without stale closure
  const selectPinRef = useRef(null)

  // ── Filter helpers ────────────────────────────────────────────────
  function applyFiltersToMeals(meals) {
    const mf = activeMainFiltersRef.current
    const sf = secondaryFiltersRef.current
    const { kcal, protein, fat, carbs } = mf.macros ?? {}

    let result = meals.filter(meal => {
      if (kcal    && meal.calories != null && (meal.calories < kcal[0]    || meal.calories > kcal[1]))    return false
      if (protein && meal.protein  != null && (meal.protein  < protein[0] || meal.protein  > protein[1])) return false
      if (fat     && meal.fat      != null && (meal.fat      < fat[0]     || meal.fat      > fat[1]))     return false
      if (carbs   && meal.carbs    != null && (meal.carbs    < carbs[0]   || meal.carbs    > carbs[1]))   return false
      if (sf.openNow) {
        const r = restaurantByIdRef.current.get(meal.restaurantId)
        if (!r?.isOpen) return false
      }
      if (sf.topRanked && (meal.rating == null || meal.rating < 4.5)) return false
      return true
    })

    if (sf.sortBy === 'a_z') {
      result.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sf.sortBy === 'nearest') {
      // original extraction order — already sorted by distance, no-op
    } else {
      // best_match: score based on active diet
      const diet = mf.diet
      const score = meal => {
        if (diet === 'high_protein') return (meal.protein ?? 0) / (meal.calories || 1) * 100
        if (diet === 'keto')         return (meal.fat ?? 0) - (meal.carbs ?? 0)
        if (diet === 'high_carb')    return meal.carbs ?? 0
        if (diet === 'balanced')     return meal.rating ?? 0
        return meal.rating ?? 0
      }
      result.sort((a, b) => score(b) - score(a))
    }
    return result
  }

  function updatePinFilters() {
    for (const { marker, cfg } of markersRef.current) {
      const filtered = applyFiltersToMeals(cfg.allMeals)
      cfg.meals = filtered
      cfg.count = filtered.length
      cfg.type  = filtered.length <= 1 ? 'single' : 'group'

      if (filtered.length === 0) {
        marker.setVisible(false)
        continue
      }

      marker.setVisible(true)

      // Update pin photo to match the first meal in the current filtered results.
      // cfg.photoUrl tracks which meal photo is currently shown (null = initial restaurant thumbnail).
      const newPhotoUrl = filtered[0]?.photo || null
      if (newPhotoUrl === cfg.photoUrl) {
        // Same representative meal — just refresh count/type badge
        marker.setIcon(createPinIcon(cfg.img, 40, cfg.type, cfg.count))
      } else {
        // First filtered meal changed — load its photo asynchronously
        cfg.photoUrl = newPhotoUrl
        // Route through the backend proxy so canvas.toDataURL() isn't tainted by cross-origin CDN images
        cfg.photo    = newPhotoUrl ? `/api/image-proxy?url=${encodeURIComponent(newPhotoUrl)}` : null
        // Show immediately with the current image while the new one loads
        marker.setIcon(createPinIcon(cfg.img, 40, cfg.type, cfg.count))
        if (cfg.photo) {
          const img = new Image()
          img.onload  = () => { cfg.img = img;  marker.setIcon(createPinIcon(img,  40, cfg.type, cfg.count)) }
          img.onerror = () => { cfg.img = null; marker.setIcon(createPinIcon(null, 40, cfg.type, cfg.count)) }
          img.src = cfg.photo
        } else {
          cfg.img = null
          marker.setIcon(createPinIcon(null, 40, cfg.type, cfg.count))
        }
      }
    }
    updateVisibleMealsRef.current()
  }
  const updatePinFiltersRef = useRef(null)
  updatePinFiltersRef.current = updatePinFilters

  // ── Visible meals ─────────────────────────────────────────────────
  function updateVisibleMeals() {
    const map = mapInstanceRef.current
    if (!map || !pinDataRef.current.length) return
    const bounds = map.getBounds()
    if (!bounds) return

    // Trim the bottom PEEK_SHOW px — that area is hidden behind the sheet
    const mapH = map.getDiv().offsetHeight
    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    const latPerPx = (ne.lat() - sw.lat()) / mapH
    const visibleBounds = new window.google.maps.LatLngBounds(
      { lat: sw.lat() + PEEK_SHOW * latPerPx, lng: sw.lng() },
      { lat: ne.lat(), lng: ne.lng() },
    )

    const meals = []
    for (const cfg of pinDataRef.current) {
      if (visibleBounds.contains({ lat: cfg.lat, lng: cfg.lng })) {
        meals.push(...cfg.meals) // cfg.meals is always the filtered subset
      }
    }
    setVisibleMeals(meals)
  }
  const updateVisibleMealsRef = useRef(null)
  updateVisibleMealsRef.current = updateVisibleMeals

  // Re-filter pins whenever active filters change
  useEffect(() => {
    if (!markersRef.current.length) return
    updatePinFiltersRef.current()
  }, [activeMainFilters, secondaryFilters]) // eslint-disable-line

  // ── Pin selection ─────────────────────────────────────────────────
  function selectPin(cfg) {
    if (!cfg) {
      // Start sheet sliding back up immediately (parallel with card exit)
      setTransform(peekY(), true)
      // Play exit animation, then unmount
      setPinExiting(true)
      setTimeout(() => {
        setPinExiting(false)
        setSelectedPin(null)
      }, 300)
      return
    }
    // New pin selected — cancel any ongoing exit, show immediately
    setPinExiting(false)
    lastSelectedPinRef.current = cfg
    setSelectedPin(cfg)
    // Push sheet fully off screen
    const sheet = sheetRef.current
    if (sheet) {
      sheet.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      sheet.style.transform  = `translateY(${sheet.offsetHeight}px)`
    }
    setIsExpanded(false)
  }

  function selectPinByRestaurantId(restaurantId) {
    const entry = markersRef.current.find(({ cfg }) =>
      cfg.allMeals.some(m => m.restaurantId === restaurantId)
    )
    if (!entry) return
    const { marker, cfg } = entry

    const doSelect = () => {
      if (activeMarkerRef.current && activeMarkerRef.current !== marker) {
        animatePin(activeMarkerRef.current, activeMarkerRef.current._cfg, 48, 40)
      }
      activeMarkerRef.current = marker
      animatePin(marker, cfg, 40, 48)
      selectPin(cfg)
      mapInstanceRef.current?.panTo({ lat: cfg.lat, lng: cfg.lng })
    }

    if (isExpandedRef.current) {
      // Sheet slides fully off-screen via selectPin inside doSelect (0.35s),
      // wait for it to clear before map pan so the animation is visible
      setTimeout(doSelect, 350)
    } else {
      doSelect()
    }
  }

  function deselectPin() {
    // Animate active marker back to default size
    if (activeMarkerRef.current) {
      animatePin(activeMarkerRef.current, activeMarkerRef.current._cfg, 48, 40)
      activeMarkerRef.current = null
    }
    selectPin(null)
  }

  selectPinRef.current = selectPin

  // ── Filters ───────────────────────────────────────────────────────
  function openFilters() {
    setPendingFilters(secondaryFilters) // reset pending to current applied filters
    setShowFilters(true)
  }
  function closeFilters() { setShowFilters(false) }

  function handlePillClick() {
    if (showFilters) {
      closeFilters()
      setTimeout(() => setShowMealFilter(true), 550)
    } else {
      setShowMealFilter(true)
    }
  }
  function applyFilters() {
    onApplySecondaryFilters(pendingFilters)
    setShowFilters(false)
  }

  // ── Map ──────────────────────────────────────────────────────────
  // Step 1 — load Google Maps script (once)
  useEffect(() => {
    if (window.google?.maps) { setMapsScriptReady(true); return }
    if (document.getElementById('gmaps-script')) return
    const script = document.createElement('script')
    script.id = 'gmaps-script'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}`
    script.async = true
    script.onload = () => setMapsScriptReady(true)
    document.head.appendChild(script)
  }, [])

  // Step 2 — init map as soon as script is ready (don't wait for API data)
  useEffect(() => {
    if (!mapsScriptReady || mapInitialisedRef.current) return
    mapInitialisedRef.current = true
    initMap()
  }, [mapsScriptReady]) // eslint-disable-line

  // Step 3 — add pins once API data arrives (map must already exist)
  useEffect(() => {
    if (dataLoading || !apiMeals.length || !mapInstanceRef.current || markersRef.current.length > 0) return
    addMealPins(mapInstanceRef.current)
  }, [dataLoading, apiMeals.length]) // eslint-disable-line

  // When tab becomes visible again after display:none, the map needs a resize
  // signal to redraw correctly (its container had zero dimensions while hidden)
  useEffect(() => {
    if (isActive && mapInstanceRef.current && window.google?.maps) {
      const t = setTimeout(() => {
        window.google.maps.event.trigger(mapInstanceRef.current, 'resize')
      }, 0)
      return () => clearTimeout(t)
    }
  }, [isActive])

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

  // ── Pin canvas helpers ───────────────────────────────────
  const PIN_PAD  = 10
  const BADGE_R  = 11

  function createPinIcon(img, size, type, count) {
    const pad      = PIN_PAD
    const isGroup  = type === 'group'
    const cx       = pad + size / 2
    const cy       = pad + size / 2
    const r        = size / 2

    // Canvas: extra width for badge on group pins
    const badgeCx  = pad + (size - 1)          // from Figma exact coords
    const badgeCy  = pad + 9                   // constant regardless of circle size
    const canvasW  = isGroup ? Math.ceil(badgeCx + BADGE_R + pad) : Math.ceil(size + pad * 2)
    const canvasH  = Math.ceil(size + pad * 2)

    const canvas   = document.createElement('canvas')
    const dpr      = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width   = canvasW * dpr
    canvas.height  = canvasH * dpr
    const ctx      = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    // Drop shadow
    ctx.shadowColor   = 'rgba(0,0,0,0.22)'
    ctx.shadowBlur    = 6
    ctx.shadowOffsetY = 2

    // Circular clip for photo
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2)
    ctx.clip()
    if (img) {
      const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight)
      const dw = img.naturalWidth * scale
      const dh = img.naturalHeight * scale
      ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh)
    } else {
      ctx.fillStyle = '#D7E5C1'
      ctx.fill()
    }
    ctx.restore()

    // White border (no shadow)
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = 'white'
    ctx.lineWidth   = 2
    ctx.beginPath()
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2)
    ctx.stroke()

    // Group badge
    if (isGroup) {
      ctx.fillStyle = '#212121'
      ctx.beginPath()
      ctx.arc(badgeCx, badgeCy, BADGE_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle        = 'white'
      ctx.font             = `600 11px -apple-system, BlinkMacSystemFont, sans-serif`
      ctx.textAlign        = 'center'
      ctx.textBaseline     = 'middle'
      ctx.fillText(String(count), badgeCx, badgeCy + 0.5)
    }

    return {
      url: canvas.toDataURL(),
      scaledSize: new window.google.maps.Size(canvasW, canvasH),
      anchor:     new window.google.maps.Point(cx, cy),
    }
  }

  // Animate a marker's icon from fromSize → toSize over ~220ms (ease-out)
  function animatePin(marker, cfg, fromSize, toSize) {
    const DURATION = 220
    const t0 = performance.now()
    function step(now) {
      const p     = Math.min((now - t0) / DURATION, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      const size  = fromSize + (toSize - fromSize) * eased
      marker.setIcon(createPinIcon(cfg.img, size, cfg.type, cfg.count))
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function addMealPins(map) {
    // Group meals by restaurant using O(1) lookup (restaurantByIdRef is ready at this point)
    const restaurantMap = {}
    for (const meal of apiMeals) {
      if (!restaurantMap[meal.restaurantId]) {
        const r = restaurantByIdRef.current.get(meal.restaurantId)
        if (!r) continue
        restaurantMap[meal.restaurantId] = { lat: r.lat, lng: r.lng, meals: [] }
      }
      restaurantMap[meal.restaurantId].meals.push(meal)
    }
    const PIN_DATA = Object.values(restaurantMap).map(pin => ({
      lat:      pin.lat,
      lng:      pin.lng,
      type:     pin.meals.length === 1 ? 'single' : 'group',
      photo:    null,   // set by updatePinFilters on first run
      photoUrl: null,   // raw meal photo URL for change detection
      img:      null,   // images loaded lazily by updatePinFilters, not preloaded
      count:    pin.meals.length,
      meals:    pin.meals,
      allMeals: pin.meals, // immutable — meals is replaced by filter updates
    }))

    pinDataRef.current = PIN_DATA

    map.addListener('idle', () => updateVisibleMealsRef.current())

    map.addListener('click', () => {
      if (activeMarkerRef.current) {
        animatePin(activeMarkerRef.current, activeMarkerRef.current._cfg, 48, 40)
        activeMarkerRef.current = null
        selectPinRef.current(null)
      }
    })

    PIN_DATA.forEach(cfg => {
      const marker = new window.google.maps.Marker({
        position: { lat: cfg.lat, lng: cfg.lng },
        map,
        icon: createPinIcon(cfg.img, 40, cfg.type, cfg.count),
      })

      marker.addListener('click', () => {
        if (activeMarkerRef.current && activeMarkerRef.current !== marker) {
          animatePin(activeMarkerRef.current, activeMarkerRef.current._cfg, 48, 40)
        }
        const selecting = activeMarkerRef.current !== marker
        animatePin(marker, cfg, selecting ? 40 : 48, selecting ? 48 : 40)
        activeMarkerRef.current = selecting ? marker : null
        selectPinRef.current(selecting ? cfg : null)
      })

      marker._cfg = cfg
      markersRef.current.push({ marker, cfg })
    })

    // Apply initial filters (default filters are set at startup)
    updatePinFiltersRef.current()
  }

  async function initMap() {
    if (!mapRef.current || mapInstanceRef.current) return
    mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
      center: CENTER,
      zoom: 12,
      disableDefaultUI: true,
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    })
    // Pins are added by the dataLoading effect once API data arrives.
    // Center on user location immediately — no need to wait for pins.
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

      {/* TopBar — title/icon/subtitle driven by active main filters */}
      <TopBar
        title={buildPillTitle(activeMainFilters)}
        icon={buildPillIcon(activeMainFilters)}
        subtitle={buildPillSubtitle(activeMainFilters)}
        filterActive={showFilters}
        onPillClick={handlePillClick}
        onFilterClick={showFilters ? closeFilters : openFilters}
      />

      {/* Main filters overlay */}
      <MealFilterOverlay
        show={showMealFilter}
        onClose={() => setShowMealFilter(false)}
        onApply={onApplyMainFilters}
        initialFilters={activeMainFilters}
      />

      {/* Secondary filters panel + backdrop */}
      <FiltersPanel
        show={showFilters}
        pending={pendingFilters}
        onChange={setPendingFilters}
        onReset={() => setPendingFilters(defaultSecondaryFilters)}
        onApply={applyFilters}
        onClose={closeFilters}
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
              <p className={styles.mealCount}>{visibleMeals.length} Meals</p>
              <p className={styles.mealSubtitle}>
                {(() => {
                  const n = new Set(visibleMeals.map(m => m.restaurantId)).size
                  return `in ${n} restaurant${n !== 1 ? 's' : ''} around you`
                })()}
              </p>
            </div>
          )}
        </div>

        {/* Scrollable list */}
        <div
          ref={listRef}
          className={`${styles.list} ${isExpanded ? styles.listExpanded : ''}`}
        >
          {visibleMeals.map((meal, i) => (
            <Fragment key={`${meal.id}-${i}`}>
              {i > 0 && <div className={styles.separator} />}
              <CardMeal
                {...meal}
                onClick={() => onMealSelect?.(meal)}
                onRestaurantClick={() => selectPinByRestaurantId(meal.restaurantId)}
              />
            </Fragment>
          ))}
        </div>
      </div>

      {/* Map button (expanded only, hidden when pin selected) */}
      {isExpanded && !selectedPin && (
        <button className={styles.mapToggleBtn} onClick={() => snapTo(false)}>
          <MapFloatIcon />
          <span>Map</span>
        </button>
      )}

      {/* Gradient — visible when no pin selected, or during exit animation */}
      {(!selectedPin || pinExiting) && <div className={styles.gradient} />}

      {/* ── Pin selected: floating card(s) ── */}
      {(selectedPin || pinExiting) && (() => {
        const pin = selectedPin ?? lastSelectedPinRef.current
        if (!pin) return null
        return (
          <div className={`${styles.pinCardWrap} ${pinExiting ? styles.pinCardWrapExiting : ''}`}>
            {/* Direction + Close buttons */}
            <div className={styles.pinControls}>
              <button
                className={styles.mapBtn}
                aria-label="Directions"
                onClick={() => {
                  const pin = selectedPin ?? lastSelectedPinRef.current
                  if (pin?.lat && pin?.lng) {
                    window.open(`https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`, '_blank')
                  }
                }}
              >
                <DirectionIcon size={20} />
              </button>
              <button className={styles.mapBtn} aria-label="Close" onClick={deselectPin}>
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Single meal card */}
            {pin.type === 'single' && (
              <div className={styles.pinCardSingle}>
                <CardMeal
                  {...pin.meals[0]}
                  onClick={() => onMealSelect?.(pin.meals[0])}
                />
              </div>
            )}

            {/* Group carousel */}
            {pin.type === 'group' && (
              <div className={styles.pinCardCarousel}>
                {pin.meals.map(meal => (
                  <div key={meal.id} className={styles.pinCardSlide}>
                    <CardMeal {...meal} onClick={() => onMealSelect?.(meal)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
