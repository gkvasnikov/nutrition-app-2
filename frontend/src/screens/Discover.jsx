import { useState, useEffect, useRef, Fragment } from 'react'
import TopBar from '../components/molecules/TopBar'
import MainNavigation from '../components/molecules/MainNavigation'
import CardMeal from '../components/molecules/CardMeal'
import MealFilterOverlay from '../components/molecules/MealFilterOverlay'
import { LocateIcon, MapFloatIcon, DirectionIcon, CloseIcon } from '../components/atoms/icons'
import { buildPillTitle, buildPillIcon, buildPillSubtitle } from '../utils/filterPill'
import { withKey } from '../utils/photoUrl'
import { mapsDirectionUrl } from '../utils/distance'
import { useAppData } from '../contexts/DataContext'
import { useLocation } from '../contexts/LocationContext'
import styles from './Discover.module.css'


const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const CENTER  = { lat: 52.5170, lng: 13.3889 } // Berlin center
const PEEK_SHOW = 200  // px visible from bottom in collapsed state

// Below this zoom level: show simple dot-pins, no image loading, no meal list.
// At and above: show photo-pins, load meals for the visible area.
const PHOTO_ZOOM_THRESHOLD = 15
const MAP_MIN_ZOOM = 12  // Google Maps won't go below this (initial Berlin view)
const MIN_ZOOM = 15      // "-" button disabled at this level and below (dot mode)
const MAX_ZOOM = 19      // "+" button disabled at this level and above

export default function Discover({
  activeTab, onTabChange, onMealSelect,
  activeMainFilters, onApplyMainFilters,
  secondaryFilters, onApplySecondaryFilters,
  isActive = true,
}) {
  // ── Data ─────────────────────────────────────────────────────────────────────
  const { userLat, userLng } = useLocation()
  const {
    restaurants: apiRestaurants,
    summaryById,
    restaurantById,
    loading: dataLoading,
    loadMorePins,
  } = useAppData()

  // O(1) restaurant lookup — updated incrementally as new pins load
  const restaurantByIdRef = useRef(new Map())
  for (const r of apiRestaurants) {
    if (!restaurantByIdRef.current.has(r.id)) restaurantByIdRef.current.set(r.id, r)
  }

  // ── Map / pin state ───────────────────────────────────────────────────────────
  const [mapsScriptReady, setMapsScriptReady] = useState(!!window.google?.maps)
  const mapInitialisedRef = useRef(false)

  const [zoomLevel, setZoomLevel] = useState(12)
  const zoomLevelRef = useRef(12) // stable ref for use inside map event callbacks

  // Area meal loading: tracks which restaurant IDs have had meals loaded
  const loadedAreaIds  = useRef(new Set())
  const loadAreaMealsRef = useRef(null)

  // Pin loading: tracks the union bbox of all loaded pin areas
  const loadedPinBoundsRef  = useRef(null)  // { swLat, swLng, neLat, neLng } | null
  const loadingMorePinsRef  = useRef(false)
  const loadMorePinsForViewportRef = useRef(null)

  // ── Sheet / UI state ──────────────────────────────────────────────────────────
  const [isExpanded,    setIsExpanded]    = useState(false)
  const [selectedPin,   setSelectedPin]   = useState(null)
  const [pinExiting,    setPinExiting]    = useState(false)
  const [visibleMeals,  setVisibleMeals]  = useState([])
  const [showMealFilter, setShowMealFilter] = useState(false)

  const lastSelectedPinRef = useRef(null)
  const pinDataRef    = useRef([])
  const markersRef    = useRef([])
  const mapRef        = useRef(null)
  const mapInstanceRef = useRef(null)
  const userMarkerRef  = useRef(null)
  const sheetRef      = useRef(null)
  const listRef       = useRef(null)
  const activeMarkerRef = useRef(null)

  // Stable filter refs for use inside map event handlers
  const activeMainFiltersRef = useRef(activeMainFilters)
  activeMainFiltersRef.current = activeMainFilters
  const secondaryFiltersRef = useRef(secondaryFilters)
  secondaryFiltersRef.current = secondaryFilters
  const summaryByIdRef = useRef(summaryById)
  summaryByIdRef.current = summaryById

  // Drag state
  const dragging            = useRef(false)
  const isDraggingSheet     = useRef(false)
  const dragStartClientY    = useRef(0)
  const dragStartTranslateY = useRef(0)
  const dragStartScrollTop  = useRef(0)
  const lastClientY         = useRef(0)
  const lastClientYTime     = useRef(0)
  const velocityY           = useRef(0)

  const isExpandedRef = useRef(false)
  isExpandedRef.current = isExpanded

  const selectPinRef = useRef(null)

  // ── Dot-pin icon (zoom < PHOTO_ZOOM_THRESHOLD) ───────────────────────────────
  function createDotIcon() {
    const pad    = 4
    const r      = 5
    const total  = (r + pad) * 2
    const dpr    = Math.min(window.devicePixelRatio || 1, 2)
    const canvas = document.createElement('canvas')
    canvas.width  = total * dpr
    canvas.height = total * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.shadowColor   = 'rgba(0,0,0,0.25)'
    ctx.shadowBlur    = 3
    ctx.shadowOffsetY = 1
    ctx.fillStyle = '#212121'
    ctx.beginPath()
    ctx.arc(pad + r, pad + r, r, 0, Math.PI * 2)
    ctx.fill()
    return {
      url:        canvas.toDataURL(),
      scaledSize: new window.google.maps.Size(total, total),
      anchor:     new window.google.maps.Point(pad + r, pad + r),
    }
  }

  // ── Filter helpers ────────────────────────────────────────────────────────────
  function applyFiltersToMeals(meals) {
    const mf = activeMainFiltersRef.current
    const sf = secondaryFiltersRef.current
    const { kcal, protein, fat, carbs } = mf.macros ?? {}

    let result = meals.filter(meal => {
      if (kcal    && meal.calories != null && (meal.calories < kcal[0]    || meal.calories > kcal[1]))    return false
      if (protein && meal.protein  != null && (meal.protein  < protein[0] || meal.protein  > protein[1])) return false
      if (fat     && meal.fat      != null && (meal.fat      < fat[0]     || meal.fat      > fat[1]))     return false
      if (carbs   && meal.carbs    != null && (meal.carbs    < carbs[0]   || meal.carbs    > carbs[1]))   return false
      if (mf.mealTime) {
        if (mf.mealTime === 'lunch' || mf.mealTime === 'dinner') {
          if (!meal.mealTimes?.includes('lunch_dinner') && !meal.mealTimes?.includes('snack')) return false
        } else {
          if (!meal.mealTimes?.includes(mf.mealTime)) return false
        }
      }
      if (mf.dietTags?.plantBased      && meal.isVegan            !== true) return false
      if (mf.dietTags?.glutenFree      && meal.isGlutenFree        !== true) return false
      if (mf.dietTags?.diabetesFriendly && meal.isDiabeticFriendly !== true) return false
      if (sf.macrosConfidence?.length && sf.macrosConfidence.length < 2) {
        if (!sf.macrosConfidence.includes(meal.confidence)) return false
      }
      if (sf.openNow) {
        const r = restaurantByIdRef.current.get(meal.restaurantId)
        if (!r?.isOpen) return false
      }
      if (sf.topRanked) {
        const r = restaurantByIdRef.current.get(meal.restaurantId)
        if (!r?.rating || r.rating < 4.5) return false
      }
      return true
    })

    if (sf.sortBy === 'a_z') {
      result.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sf.sortBy === 'nearest') {
      // Nearest: preserve natural API order (already grouped by restaurant proximity)
    } else {
      // best_match: score based on active diet
      const diet = mf.diet
      const score = meal => {
        if (diet === 'high_protein') return (meal.protein ?? 0) / (meal.calories || 1) * 100
        if (diet === 'keto')         return (meal.fat ?? 0) - (meal.carbs ?? 0)
        if (diet === 'high_carb')    return meal.carbs ?? 0
        return restaurantByIdRef.current.get(meal.restaurantId)?.rating ?? 0
      }
      result.sort((a, b) => score(b) - score(a))
    }
    return result
  }

  // Check if restaurant macro summary could contain a meal matching current filters.
  // Used at low zoom to show/hide dot-pins without loading meal data.
  function summaryMatchesFilters(summary) {
    const mf = activeMainFiltersRef.current
    const sf = secondaryFiltersRef.current
    const { kcal, protein, fat, carbs } = mf.macros ?? {}

    if (kcal    && (summary.maxCal  < kcal[0]    || summary.minCal  > kcal[1]))    return false
    if (protein && summary.maxPro  < protein[0])                                    return false
    if (fat     && (summary.maxFat  < fat[0]     || summary.minFat  > fat[1]))     return false
    if (carbs   && (summary.maxCarb < carbs[0]   || summary.minCarb > carbs[1]))   return false
    if (sf.openNow) {
      const r = restaurantByIdRef.current.get(summary.id)
      if (!r?.isOpen) return false
    }
    if (sf.topRanked) {
      const r = restaurantByIdRef.current.get(summary.id)
      if (!r?.rating || r.rating < 4.5) return false
    }
    return true
  }

  // ── updatePinFilters ──────────────────────────────────────────────────────────
  function updatePinFilters() {
    const isPhotoMode = zoomLevelRef.current >= PHOTO_ZOOM_THRESHOLD

    for (const { marker, cfg } of markersRef.current) {
      if (!isPhotoMode) {
        // ── Dot mode: use macro summary for filter, no image loading ──────────
        const summary = summaryByIdRef.current.get(cfg.id)
        const visible = summary ? summaryMatchesFilters(summary) : cfg.count > 0
        marker.setVisible(visible)
        if (visible) marker.setIcon(createDotIcon())
        continue
      }

      // ── Photo mode: filter against loaded meals ───────────────────────────
      const filtered = applyFiltersToMeals(cfg.allMeals)
      cfg.meals = filtered
      cfg.count = filtered.length
      cfg.type  = filtered.length <= 1 ? 'single' : 'group'

      // Hide only if meals are loaded for this restaurant and none match
      if (filtered.length === 0) {
        if (loadedAreaIds.current.has(cfg.id)) marker.setVisible(false)
        // If not loaded yet: keep visible as placeholder
        continue
      }

      marker.setVisible(true)

      const newPhotoUrl = filtered[0]?.photo || null
      if (newPhotoUrl === cfg.photoUrl) {
        marker.setIcon(createPinIcon(cfg.img, 40, cfg.type, cfg.count))
      } else {
        cfg.photoUrl = newPhotoUrl
        cfg.photo    = newPhotoUrl ? `/api/image-proxy?url=${encodeURIComponent(newPhotoUrl)}` : null
        marker.setIcon(createPinIcon(cfg.img, 40, cfg.type, cfg.count))
        if (cfg.photo) {
          const img = new Image()
          img.onload  = () => { cfg.img = img;  marker.setIcon(createPinIcon(img,  40, cfg.type, cfg.count)) }
          img.onerror = () => { cfg.img = null; marker.setIcon(createPinIcon(null, 40, cfg.type, cfg.count)) }
          img.src = cfg.photo
        }
      }
    }
    updateVisibleMealsRef.current()
  }
  const updatePinFiltersRef = useRef(null)
  updatePinFiltersRef.current = updatePinFilters

  // ── Visible meals ─────────────────────────────────────────────────────────────
  function updateVisibleMeals() {
    const map = mapInstanceRef.current
    if (!map || !pinDataRef.current.length) return

    // Dot mode: no meal list
    if (zoomLevelRef.current < PHOTO_ZOOM_THRESHOLD) {
      setVisibleMeals([])
      return
    }

    const bounds = map.getBounds()
    if (!bounds) return

    const mapH  = map.getDiv().offsetHeight
    const ne    = bounds.getNorthEast()
    const sw    = bounds.getSouthWest()
    const latPerPx = (ne.lat() - sw.lat()) / mapH
    const visibleBounds = new window.google.maps.LatLngBounds(
      { lat: sw.lat() + PEEK_SHOW * latPerPx, lng: sw.lng() },
      { lat: ne.lat(), lng: ne.lng() },
    )

    const meals = []
    for (const cfg of pinDataRef.current) {
      if (visibleBounds.contains({ lat: cfg.lat, lng: cfg.lng })) {
        meals.push(...cfg.meals)
      }
    }

    // Global sort across all restaurants
    const sf   = secondaryFiltersRef.current
    const mf   = activeMainFiltersRef.current
    const diet = mf.diet

    if (sf.sortBy === 'nearest') {
      const center = map.getCenter()
      if (center) {
        const clat = center.lat(), clng = center.lng()
        // Attach restaurant coords for sorting, then discard
        meals.sort((a, b) => {
          const ra = restaurantByIdRef.current.get(a.restaurantId)
          const rb = restaurantByIdRef.current.get(b.restaurantId)
          const da = ra ? Math.hypot(ra.lat - clat, ra.lng - clng) : Infinity
          const db = rb ? Math.hypot(rb.lat - clat, rb.lng - clng) : Infinity
          return da - db
        })
      }
    } else if (sf.sortBy === 'a_z') {
      meals.sort((a, b) => a.name.localeCompare(b.name))
    } else {
      // best_match: score by active diet
      const score = meal => {
        if (diet === 'high_protein') return (meal.protein ?? 0) / (meal.calories || 1) * 100
        if (diet === 'keto')         return (meal.fat ?? 0) - (meal.carbs ?? 0)
        if (diet === 'high_carb')    return meal.carbs ?? 0
        return restaurantByIdRef.current.get(meal.restaurantId)?.rating ?? 0
      }
      meals.sort((a, b) => score(b) - score(a))
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

  // ── Area meal loading (zoom ≥ PHOTO_ZOOM_THRESHOLD) ───────────────────────────
  async function loadAreaMeals() {
    const map = mapInstanceRef.current
    if (!map) return
    const bounds = map.getBounds()
    if (!bounds) return

    // Only fetch for restaurants in viewport that haven't been loaded yet
    const toLoad = pinDataRef.current.filter(cfg =>
      bounds.contains({ lat: cfg.lat, lng: cfg.lng }) &&
      !loadedAreaIds.current.has(cfg.id)
    )
    if (!toLoad.length) return

    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    const params = new URLSearchParams({
      swLat: sw.lat().toFixed(6), swLng: sw.lng().toFixed(6),
      neLat: ne.lat().toFixed(6), neLng: ne.lng().toFixed(6),
    })

    try {
      const newMeals = await fetch(`/api/area-meals?${params}`).then(r => r.json())

      // Group by restaurant
      const byRestaurant = new Map()
      for (const meal of newMeals) {
        if (!byRestaurant.has(meal.restaurantId)) byRestaurant.set(meal.restaurantId, [])
        byRestaurant.get(meal.restaurantId).push(meal)
      }

      // Assign meals to pin configs and mark as loaded
      for (const cfg of toLoad) {
        const meals = byRestaurant.get(cfg.id) || []
        cfg.allMeals = meals
        cfg.meals    = meals
        cfg.type     = meals.length <= 1 ? 'single' : 'group'
        cfg.count    = meals.length
        loadedAreaIds.current.add(cfg.id)
      }

      updatePinFiltersRef.current()
    } catch (e) {
      console.error('loadAreaMeals error:', e)
    }
  }
  loadAreaMealsRef.current = loadAreaMeals

  // ── Pin selection ─────────────────────────────────────────────────────────────
  function selectPin(cfg) {
    if (!cfg) {
      setTransform(peekY(), true)
      setPinExiting(true)
      setTimeout(() => { setPinExiting(false); setSelectedPin(null) }, 300)
      return
    }
    setPinExiting(false)
    lastSelectedPinRef.current = cfg
    setSelectedPin(cfg)
    const sheet = sheetRef.current
    if (sheet) {
      sheet.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      sheet.style.transform  = `translateY(${sheet.offsetHeight}px)`
    }
    setIsExpanded(false)
  }

  function selectPinByRestaurantId(restaurantId) {
    const entry = markersRef.current.find(({ cfg }) => cfg.id === restaurantId)
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
      setTimeout(doSelect, 350)
    } else {
      doSelect()
    }
  }

  function deselectPin() {
    if (activeMarkerRef.current) {
      animatePin(activeMarkerRef.current, activeMarkerRef.current._cfg, 48, 40)
      activeMarkerRef.current = null
    }
    selectPin(null)
  }

  selectPinRef.current = selectPin

  // ── Filters ───────────────────────────────────────────────────────────────────
  function handlePillClick() { setShowMealFilter(true) }

  function haptic() { navigator.vibrate?.(10) }

  const SORT_CYCLE  = ['nearest', 'best_match', 'a_z']
  const SORT_LABELS = { nearest: 'Nearest', best_match: 'Best match', a_z: 'A-Z' }

  // ── Map setup ─────────────────────────────────────────────────────────────────
  // Step 1 — load Google Maps script
  useEffect(() => {
    if (window.google?.maps) { setMapsScriptReady(true); return }
    if (document.getElementById('gmaps-script')) return
    const script = document.createElement('script')
    script.id    = 'gmaps-script'
    script.src   = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}`
    script.async = true
    script.onload = () => setMapsScriptReady(true)
    document.head.appendChild(script)
  }, [])

  // Step 2 — init map as soon as script is ready
  useEffect(() => {
    if (!mapsScriptReady || mapInitialisedRef.current) return
    mapInitialisedRef.current = true
    initMap()
  }, [mapsScriptReady]) // eslint-disable-line

  // Step 3 — add pins once restaurant data arrives; handle incremental additions
  useEffect(() => {
    if (dataLoading || !apiRestaurants.length || !mapInstanceRef.current) return
    if (markersRef.current.length === 0) {
      // Initial load
      addMealPins(mapInstanceRef.current)
    } else {
      // Incremental: add only genuinely new restaurants
      const existingIds = new Set(markersRef.current.map(({ cfg }) => cfg.id))
      const newRests = apiRestaurants.filter(
        r => !existingIds.has(r.id) && r.mealCount > 0 && r.lat != null && r.lng != null
      )
      if (newRests.length > 0) addNewPins(mapInstanceRef.current, newRests)
    }
  }, [dataLoading, apiRestaurants.length]) // eslint-disable-line

  // Resize map after tab becomes visible.
  // Must wait two animation frames so the browser finishes removing display:none
  // before calling resize — otherwise the map measures 0×0 and goes blank.
  useEffect(() => {
    if (!isActive || !mapInstanceRef.current || !window.google?.maps) return
    let raf1, raf2
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const map = mapInstanceRef.current
        if (!map) return
        const center = map.getCenter()
        window.google.maps.event.trigger(map, 'resize')
        // Restore center after resize — map resets to (0,0) if it had 0 size
        if (center) map.setCenter(center)
      })
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
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
      map.panBy(0, 50)
      const pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="rgba(66,133,244,0.15)"/>
        <circle cx="12" cy="12" r="6" fill="#4285F4" stroke="#fff" stroke-width="2"/>
      </svg>`
      const icon = {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(pinSvg),
        scaledSize: new window.google.maps.Size(24, 24),
        anchor:     new window.google.maps.Point(12, 12),
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

  // ── Photo-pin canvas helpers ──────────────────────────────────────────────────
  const PIN_PAD = 10
  const BADGE_R = 11

  function createPinIcon(img, size, type, count) {
    const pad     = PIN_PAD
    const isGroup = type === 'group'
    const cx      = pad + size / 2
    const cy      = pad + size / 2
    const r       = size / 2
    const badgeCx = pad + (size - 1)
    const badgeCy = pad + 9
    const canvasW = isGroup ? Math.ceil(badgeCx + BADGE_R + pad) : Math.ceil(size + pad * 2)
    const canvasH = Math.ceil(size + pad * 2)

    const canvas = document.createElement('canvas')
    const dpr    = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width  = canvasW * dpr
    canvas.height = canvasH * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    ctx.shadowColor   = 'rgba(0,0,0,0.22)'
    ctx.shadowBlur    = 6
    ctx.shadowOffsetY = 2

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

    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = 'white'
    ctx.lineWidth   = 2
    ctx.beginPath()
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2)
    ctx.stroke()

    if (isGroup) {
      ctx.fillStyle = '#212121'
      ctx.beginPath()
      ctx.arc(badgeCx, badgeCy, BADGE_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle    = 'white'
      ctx.font         = `600 11px -apple-system, BlinkMacSystemFont, sans-serif`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(count), badgeCx, badgeCy + 0.5)
    }

    return {
      url:        canvas.toDataURL(),
      scaledSize: new window.google.maps.Size(canvasW, canvasH),
      anchor:     new window.google.maps.Point(cx, cy),
    }
  }

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

  // ── createMarker — shared marker factory used by addMealPins + addNewPins ─────
  function createMarker(map, cfg) {
    const isPhoto = zoomLevelRef.current >= PHOTO_ZOOM_THRESHOLD
    const marker  = new window.google.maps.Marker({
      position: { lat: cfg.lat, lng: cfg.lng },
      map,
      icon: isPhoto
        ? createPinIcon(null, 40, 'single', cfg.count)
        : createDotIcon(),
    })
    marker.addListener('click', () => {
      if (zoomLevelRef.current < PHOTO_ZOOM_THRESHOLD) {
        mapInstanceRef.current?.setZoom(PHOTO_ZOOM_THRESHOLD)
        mapInstanceRef.current?.panTo({ lat: cfg.lat, lng: cfg.lng })
        return
      }
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
    return marker
  }

  // ── addNewPins — incremental: add markers for restaurants not yet on the map ─
  function addNewPins(map, newRests) {
    const newPinData = newRests.map(r => ({
      id: r.id, lat: r.lat, lng: r.lng,
      type: 'group', photo: null, photoUrl: null, img: null,
      count: r.mealCount, meals: [], allMeals: [],
    }))
    pinDataRef.current = [...pinDataRef.current, ...newPinData]
    newPinData.forEach(cfg => createMarker(map, cfg))
    updatePinFiltersRef.current?.()
  }

  // ── loadMorePinsForViewport — called from idle to fetch pins for new areas ───
  async function loadMorePinsForViewport() {
    if (!mapInstanceRef.current || loadingMorePinsRef.current) return
    const bounds = mapInstanceRef.current.getBounds()
    if (!bounds) return
    const sw = bounds.getSouthWest(), ne = bounds.getNorthEast()
    const swLat = sw.lat(), swLng = sw.lng(), neLat = ne.lat(), neLng = ne.lng()

    // Skip if viewport is fully within already-loaded bounds (with small margin)
    if (loadedPinBoundsRef.current) {
      const lb = loadedPinBoundsRef.current
      const margin = 0.02  // ~2 km buffer
      if (swLat >= lb.swLat - margin && swLng >= lb.swLng - margin &&
          neLat <= lb.neLat + margin && neLng <= lb.neLng + margin) return
    }

    loadingMorePinsRef.current = true
    await loadMorePins(swLat, swLng, neLat, neLng)

    // Expand stored bounds to union of all loaded areas
    if (!loadedPinBoundsRef.current) {
      loadedPinBoundsRef.current = { swLat, swLng, neLat, neLng }
    } else {
      const lb = loadedPinBoundsRef.current
      loadedPinBoundsRef.current = {
        swLat: Math.min(lb.swLat, swLat), swLng: Math.min(lb.swLng, swLng),
        neLat: Math.max(lb.neLat, neLat), neLng: Math.max(lb.neLng, neLng),
      }
    }
    loadingMorePinsRef.current = false
  }
  loadMorePinsForViewportRef.current = loadMorePinsForViewport

  // ── addMealPins ───────────────────────────────────────────────────────────────
  function addMealPins(map) {
    const initialZoom = map.getZoom() ?? 12
    // Sync both the ref AND React state — locateMe may have changed zoom
    // before data arrived, so zoom_changed listener never caught it.
    zoomLevelRef.current = initialZoom
    setZoomLevel(initialZoom)

    // One pin per restaurant, using data from /api/pins
    const PIN_DATA = apiRestaurants
      .filter(r => r.mealCount > 0 && r.lat != null && r.lng != null)
      .map(r => ({
        id:       r.id,
        lat:      r.lat,
        lng:      r.lng,
        type:     'group',
        photo:    null,
        photoUrl: null,
        img:      null,
        count:    r.mealCount,
        meals:    [],    // populated lazily when user zooms in
        allMeals: [],
      }))

    pinDataRef.current = PIN_DATA

    // ── Zoom change: switch between dot-mode and photo-mode ───────────────────
    map.addListener('zoom_changed', () => {
      const newZoom  = map.getZoom()
      const prevZoom = zoomLevelRef.current
      zoomLevelRef.current = newZoom
      setZoomLevel(newZoom)

      const wasPhoto = prevZoom  >= PHOTO_ZOOM_THRESHOLD
      const isPhoto  = newZoom   >= PHOTO_ZOOM_THRESHOLD

      if (wasPhoto !== isPhoto) {
        // Mode changed — redraw all visible markers
        for (const { marker, cfg } of markersRef.current) {
          if (!marker.getVisible()) continue
          marker.setIcon(isPhoto
            ? createPinIcon(cfg.img, 40, cfg.type || 'single', Math.max(cfg.count, 1))
            : createDotIcon()
          )
        }
      }
    })

    // ── Map idle: update visible meals, load area meals, load new pins ──────────
    map.addListener('idle', () => {
      updateVisibleMealsRef.current()
      if (zoomLevelRef.current >= PHOTO_ZOOM_THRESHOLD) {
        loadAreaMealsRef.current?.()
      }
      loadMorePinsForViewportRef.current?.()
    })

    // ── Click on empty map: deselect ──────────────────────────────────────────
    map.addListener('click', () => {
      if (activeMarkerRef.current) {
        animatePin(activeMarkerRef.current, activeMarkerRef.current._cfg, 48, 40)
        activeMarkerRef.current = null
        selectPinRef.current(null)
      }
    })

    // ── Create markers ────────────────────────────────────────────────────────
    PIN_DATA.forEach(cfg => createMarker(map, cfg))

    // Initial filter sync
    updatePinFiltersRef.current()

    // Record initial loaded bounds from the current map viewport so the idle
    // handler knows whether to fetch more pins when the user pans.
    const initBounds = map.getBounds()
    if (initBounds) {
      const sw = initBounds.getSouthWest(), ne = initBounds.getNorthEast()
      loadedPinBoundsRef.current = {
        swLat: sw.lat(), swLng: sw.lng(),
        neLat: ne.lat(), neLng: ne.lng(),
      }
    }

    // If already in photo mode (locateMe ran before data arrived and the map
    // settled at zoom ≥ 15 before the idle listener was added), load area meals
    // now — the idle event won't fire again until the user moves the map.
    if (zoomLevelRef.current >= PHOTO_ZOOM_THRESHOLD) {
      loadAreaMealsRef.current?.()
    }
  }

  function initMap() {
    if (!mapRef.current || mapInstanceRef.current) return
    mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
      center:   CENTER,
      zoom:     12,
      minZoom:  MAP_MIN_ZOOM,
      maxZoom:  MAX_ZOOM,
      disableDefaultUI: true,
      styles: [
        { featureType: 'poi',     stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    })
    locateMe()
  }

  // ── Sheet helpers ─────────────────────────────────────────────────────────────
  function peekY()     { return (sheetRef.current?.offsetHeight ?? window.innerHeight) - PEEK_SHOW }
  function expandedY() { return 0 }

  function getCurrentY() {
    const sheet = sheetRef.current
    if (!sheet) return peekY()
    return new DOMMatrix(getComputedStyle(sheet).transform).m42
  }

  function setTransform(y, animated) {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.style.transition = animated ? 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)' : 'none'
    sheet.style.transform  = `translateY(${y}px)`
  }

  function snapTo(expand) {
    setTransform(expand ? expandedY() : peekY(), true)
    setIsExpanded(expand)
  }

  useEffect(() => { setTransform(peekY(), false) }, []) // eslint-disable-line

  // ── Touch handlers ────────────────────────────────────────────────────────────
  function onTouchStart(e) {
    const touch = e.touches[0]
    dragging.current            = true
    isDraggingSheet.current     = false
    dragStartClientY.current    = touch.clientY
    dragStartScrollTop.current  = listRef.current?.scrollTop ?? 0
    lastClientY.current         = touch.clientY
    lastClientYTime.current     = Date.now()
    velocityY.current           = 0

    if (!isExpandedRef.current) {
      isDraggingSheet.current      = true
      dragStartTranslateY.current  = getCurrentY()
      const sheet = sheetRef.current
      if (sheet) sheet.style.transition = 'none'
    }
  }

  function onTouchMove(e) {
    if (!dragging.current) return
    const touch = e.touches[0]
    const delta = touch.clientY - dragStartClientY.current

    if (isExpandedRef.current && !isDraggingSheet.current) {
      if (dragStartScrollTop.current === 0 && delta > 8) {
        isDraggingSheet.current     = true
        dragStartTranslateY.current = getCurrentY()
        const sheet = sheetRef.current
        if (sheet) sheet.style.transition = 'none'
      } else {
        return
      }
    }

    if (isDraggingSheet.current) {
      e.preventDefault()
      const newY = Math.max(expandedY(), Math.min(peekY(), dragStartTranslateY.current + delta))
      if (sheetRef.current) sheetRef.current.style.transform = `translateY(${newY}px)`
    }

    const now = Date.now()
    const dt  = now - lastClientYTime.current
    if (dt > 0) velocityY.current = (touch.clientY - lastClientY.current) / dt
    lastClientY.current     = touch.clientY
    lastClientYTime.current = now
  }

  function onTouchEnd() {
    if (!dragging.current) return
    dragging.current = false
    if (!isDraggingSheet.current) return

    const v    = velocityY.current
    const curY = getCurrentY()
    const mid  = peekY() / 2

    let expand
    if (v < -0.3)     expand = true
    else if (v > 0.3) expand = false
    else              expand = curY < mid

    snapTo(expand)
  }

  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.addEventListener('touchstart', onTouchStart, { passive: true })
    sheet.addEventListener('touchmove',  onTouchMove,  { passive: false })
    sheet.addEventListener('touchend',   onTouchEnd,   { passive: true })
    return () => {
      sheet.removeEventListener('touchstart', onTouchStart)
      sheet.removeEventListener('touchmove',  onTouchMove)
      sheet.removeEventListener('touchend',   onTouchEnd)
    }
  }, []) // eslint-disable-line

  // ── Render ────────────────────────────────────────────────────────────────────
  const isPhotoMode = zoomLevel >= PHOTO_ZOOM_THRESHOLD

  return (
    <div className={styles.screen}>
      <div ref={mapRef} className={styles.map} />

      {/* Map controls */}
      <div className={styles.mapControls}>
        <button
          className={`${styles.mapBtn} ${zoomLevel >= MAX_ZOOM ? styles.mapBtnDisabled : ''}`}
          aria-label="Zoom in"
          disabled={zoomLevel >= MAX_ZOOM}
          onClick={() => {
            const z = mapInstanceRef.current?.getZoom() ?? 15
            if (z < MAX_ZOOM) mapInstanceRef.current?.setZoom(z + 1)
          }}
        >
          <span className={styles.mapBtnText}>+</span>
        </button>
        <button
          className={`${styles.mapBtn} ${zoomLevel <= MIN_ZOOM ? styles.mapBtnDisabled : ''}`}
          aria-label="Zoom out"
          disabled={zoomLevel <= MIN_ZOOM}
          onClick={() => {
            const z = mapInstanceRef.current?.getZoom() ?? 15
            if (z > MIN_ZOOM) mapInstanceRef.current?.setZoom(z - 1)
          }}
        >
          <span className={styles.mapBtnText}>−</span>
        </button>
        <button className={`${styles.mapBtn} ${styles.mapBtnLocate}`} aria-label="My location"
          onClick={locateMe}>
          <LocateIcon size={20} />
        </button>
      </div>

      <TopBar
        title={buildPillTitle(activeMainFilters)}
        icon={buildPillIcon(activeMainFilters)}
        subtitle={buildPillSubtitle(activeMainFilters)}
        filterActive={showMealFilter}
        onPillClick={handlePillClick}
        onFilterClick={() => setShowMealFilter(v => !v)}
      />

      <MealFilterOverlay
        show={showMealFilter}
        onClose={() => setShowMealFilter(false)}
        onApply={onApplyMainFilters}
        initialFilters={activeMainFilters}
      />

      {/* ── Map filter pills ──────────────────────────────────────────── */}
      <div className={styles.mapFilters}>
        <button
          className={styles.mapFilterPill}
          onClick={() => {
            haptic()
            const idx  = SORT_CYCLE.indexOf(secondaryFilters.sortBy)
            const next = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]
            onApplySecondaryFilters({ ...secondaryFilters, sortBy: next })
          }}
        >
          <span>{SORT_LABELS[secondaryFilters.sortBy] ?? 'Nearest'}</span>
          <img src="/icons/Switch.svg" width={16} height={16} alt="" />
        </button>

        <button
          className={`${styles.mapFilterPill} ${secondaryFilters.openNow ? styles.mapFilterPillActive : ''}`}
          onClick={() => {
            haptic()
            onApplySecondaryFilters({ ...secondaryFilters, openNow: !secondaryFilters.openNow })
          }}
        >
          {secondaryFilters.openNow && (
            <img src="/icons/Check.svg" width={16} height={16} alt="" />
          )}
          <span>Open now</span>
        </button>
      </div>

      <div className={`${styles.topBarFill} ${isExpanded ? styles.topBarFillVisible : ''}`} />

      {/* Bottom sheet */}
      <div ref={sheetRef} className={styles.sheet}>
        <div className={`${styles.header} ${isExpanded ? styles.headerExpanded : ''}`}>
          <div
            className={`${styles.handlePill} ${isExpanded ? styles.handlePillExpanded : ''}`}
            onClick={() => snapTo(!isExpanded)}
          />

          {!isExpanded && (
            <div className={styles.summary}>
              {isPhotoMode ? (
                <>
                  <p className={styles.mealCount}>{visibleMeals.length} Meals</p>
                  <p className={styles.mealSubtitle}>
                    {visibleMeals.length === 0
                      ? 'No matches — try adjusting filters'
                      : (() => {
                          const n = new Set(visibleMeals.map(m => m.restaurantId)).size
                          return `in ${n} restaurant${n !== 1 ? 's' : ''} around you`
                        })()
                    }
                  </p>
                </>
              ) : (
                <>
                  <p className={styles.mealCount}>
                    {markersRef.current.filter(({ marker }) => marker.getVisible?.()).length || pinDataRef.current.length} Restaurants
                  </p>
                  <p className={styles.mealSubtitle}>in Berlin</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Scrollable list */}
        <div
          ref={listRef}
          className={`${styles.list} ${isExpanded ? styles.listExpanded : ''}`}
        >
          {!isPhotoMode ? (
            <div className={styles.zoomPrompt}>
              <p className={styles.zoomPromptText}>Zoom into a neighbourhood to explore meals</p>
            </div>
          ) : visibleMeals.length === 0 ? (
            <div className={styles.zoomPrompt}>
              <p className={styles.zoomPromptText}>No meals match your filters here.<br />Pan the map or ease up on the filters to find something nearby.</p>
            </div>
          ) : (
            visibleMeals.map((meal, i) => (
              <Fragment key={`${meal.restaurantId}-${meal.id}-${i}`}>
                {i > 0 && <div className={styles.separator} />}
                <CardMeal
                  {...meal}
                  onClick={() => onMealSelect?.(meal)}
                  onRestaurantClick={() => selectPinByRestaurantId(meal.restaurantId)}
                />
              </Fragment>
            ))
          )}
        </div>
      </div>

      {isExpanded && !selectedPin && (
        <button className={styles.mapToggleBtn} onClick={() => snapTo(false)}>
          <MapFloatIcon />
          <span>Map</span>
        </button>
      )}

      {(!selectedPin || pinExiting) && <div className={styles.gradient} />}

      {(selectedPin || pinExiting) && (() => {
        const pin = selectedPin ?? lastSelectedPinRef.current
        if (!pin) return null
        return (
          <div className={`${styles.pinCardWrap} ${pinExiting ? styles.pinCardWrapExiting : ''}`}>
            <div className={styles.pinControls}>
              <button
                className={styles.mapBtn}
                aria-label="Directions"
                onClick={() => {
                  const p = selectedPin ?? lastSelectedPinRef.current
                  if (p?.lat && p?.lng) {
                    window.open(mapsDirectionUrl(userLat, userLng, p.lat, p.lng), '_blank')
                  }
                }}
              >
                <DirectionIcon size={20} />
              </button>
              <button className={styles.mapBtn} aria-label="Close" onClick={deselectPin}>
                <CloseIcon size={16} />
              </button>
            </div>

            {pin.type === 'single' && (
              <div className={styles.pinCardSingle}>
                <CardMeal
                  {...pin.meals[0]}
                  onClick={() => onMealSelect?.(pin.meals[0])}
                />
              </div>
            )}

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
