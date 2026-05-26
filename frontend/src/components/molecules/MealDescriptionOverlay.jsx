import { useEffect, useRef, useState } from 'react'
import { CloseIcon, HeartOutlineIcon, HeartFilledIcon, ShareUpIcon, DirectionIcon, WoltIcon, WalkIcon } from '../atoms/icons'
import { useAppData } from '../../contexts/DataContext'
import { withKey } from '../../utils/photoUrl'
import { useLocation } from '../../contexts/LocationContext'
import { distanceTo } from '../../utils/distance'
import styles from './MealDescriptionOverlay.module.css'

const PRICE_LEVEL_MAP = { 1: '€', 2: '€€', 3: '€€€', 4: '€€€€' }

const MACRO_BG = {
  calories: 'var(--color-surface)',
  protein:  'var(--color-semantic-green)',
  fat:      'var(--color-semantic-yellow)',
  carbs:    'var(--color-semantic-blue)',
}

const RATING_COLOR = {
  Poor:      '#ef4444',
  Fair:      '#f97316',
  Good:      '#34a853',
  Excellent: '#16a34a',
}

export default function MealDescriptionOverlay({ meal, zIndex = 300, onClose, onRestaurantSelect, isFavourite = false, onToggleFavourite }) {
  const { userLat, userLng } = useLocation()
  const { restaurantById } = useAppData()
  const mealRestaurant = meal ? restaurantById.get(meal.restaurantId) : null
  const liveDistance = distanceTo(userLat, userLng, mealRestaurant?.lat, mealRestaurant?.lng)

  function handleDirection() {
    const r = restaurantById.get(meal.restaurantId)
    if (r) window.open(`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`, '_blank')
  }

  function handleWolt() {
    const r = restaurantById.get(meal.restaurantId)
    if (r?.woltSlug) window.open(`https://wolt.com/de/deu/berlin/restaurant/${r.woltSlug}`, '_blank')
  }

  function handleShare() {
    const url = window.location.href
    if (navigator.share) {
      navigator.share({ title: meal.name, url }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(`${meal.name} — ${url}`)
    }
  }
  const [advice, setAdvice] = useState(null)   // { score, rating, advice }
  const [adviceLoading, setAdviceLoading] = useState(true)
  const backdropRef      = useRef(null)
  const sheetRef         = useRef(null)
  const scrollContentRef = useRef(null)
  const onCloseRef       = useRef(onClose)
  const animatingRef     = useRef(false)
  const animateCloseRef  = useRef(null)
  onCloseRef.current     = onClose

  // Lock body scroll + open animation
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const sheet    = sheetRef.current
    const backdrop = backdropRef.current
    if (sheet && backdrop) {
      sheet.style.transform     = 'translateY(100%)'
      backdrop.style.background = 'rgba(0,0,0,0)'
      requestAnimationFrame(() => requestAnimationFrame(() => {
        sheet.style.transition    = 'transform 0.35s cubic-bezier(0.32,0.72,0,1)'
        sheet.style.transform     = 'translateY(0)'
        backdrop.style.transition = 'background 0.35s ease'
        backdrop.style.background = 'rgba(0,0,0,0.45)'
      }))
    }

    return () => { document.body.style.overflow = prev }
  }, [])

  function animateClose() {
    if (animatingRef.current) return
    animatingRef.current = true
    const sheet    = sheetRef.current
    const backdrop = backdropRef.current
    if (sheet) {
      sheet.style.transition = 'transform 0.4s cubic-bezier(0.4,0,1,1)'
      sheet.style.transform  = 'translateY(100%)'
    }
    if (backdrop) {
      backdrop.style.transition = 'background 0.35s ease'
      backdrop.style.background = 'rgba(0,0,0,0)'
    }
    setTimeout(() => onCloseRef.current?.(), 400)
  }
  animateCloseRef.current = animateClose

  // Swipe-to-dismiss — listeners on backdrop
  useEffect(() => {
    const backdrop      = backdropRef.current
    const sheet         = sheetRef.current
    const scrollContent = scrollContentRef.current
    if (!backdrop || !sheet) return

    let startY = 0, startScroll = 0, couldDrag = false
    let dragging = false, lastY = 0, lastT = 0, vel = 0

    function onTouchStart(e) {
      if (animatingRef.current) return
      const t     = e.touches[0]
      startY      = t.clientY
      startScroll = scrollContent?.scrollTop ?? 0
      couldDrag   = startScroll === 0
      dragging    = false
      lastY = t.clientY; lastT = Date.now(); vel = 0
    }

    function onTouchMove(e) {
      if (animatingRef.current) return
      const t     = e.touches[0]
      const delta = t.clientY - startY
      const now   = Date.now(); const dt = now - lastT
      if (dt > 0) vel = (t.clientY - lastY) / dt
      lastY = t.clientY; lastT = now
      if (couldDrag && delta > 0) {
        e.preventDefault()
        dragging = true
        sheet.style.transition = 'none'
        sheet.style.transform  = `translateY(${delta}px)`
      }
    }

    function onTouchEnd() {
      if (!dragging || animatingRef.current) return
      const ty = new DOMMatrix(getComputedStyle(sheet).transform).m42
      if (ty > 100 || vel > 0.5) {
        animateCloseRef.current?.()
      } else {
        sheet.style.transition = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)'
        sheet.style.transform  = 'translateY(0)'
      }
      dragging = false
    }

    backdrop.addEventListener('touchstart', onTouchStart, { passive: true })
    backdrop.addEventListener('touchmove',  onTouchMove,  { passive: false })
    backdrop.addEventListener('touchend',   onTouchEnd,   { passive: true })
    return () => {
      backdrop.removeEventListener('touchstart', onTouchStart)
      backdrop.removeEventListener('touchmove',  onTouchMove)
      backdrop.removeEventListener('touchend',   onTouchEnd)
    }
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!meal) return
    setAdviceLoading(true)
    setAdvice(null)
    fetch('/api/advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:        meal.name,
        description: meal.description,
        calories:    meal.calories,
        protein:     meal.protein,
        fat:         meal.fat,
        carbs:       meal.carbs,
      }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setAdvice(data))
      .catch(() => setAdvice(null))
      .finally(() => setAdviceLoading(false))
  }, [meal])

  if (!meal) return null

  return (
    <div ref={backdropRef} className={styles.backdrop} style={{ zIndex }} onClick={animateClose}>
      <div ref={sheetRef} className={styles.sheet} style={{ zIndex: zIndex + 1 }} onClick={e => e.stopPropagation()}>

        {/* ── Close button — sits above scrollContent, never scrolls ── */}
        <button className={styles.closeBtn} onClick={animateClose} aria-label="Close">
          <CloseIcon size={16} />
        </button>

        {/* ── Scrollable content — photo scrolls too ── */}
        <div ref={scrollContentRef} className={styles.scrollContent}>

          {/* Photo area — scrolls with content */}
          <div className={styles.photoArea}>
            {meal.photo && (
              <img src={meal.photo} alt={meal.name} className={styles.photo} />
            )}
            <div className={styles.photoGradient} />
          </div>

          <div className={styles.content}>

            <h2 className={styles.name}>{meal.name}</h2>
            {meal.description && <p className={styles.description}>{meal.description}</p>}
            {meal.price && <p className={styles.price}>{meal.price}</p>}

            {/* Macros */}
            <div className={styles.macros}>
              <div className={styles.macroCell} style={{ background: MACRO_BG.calories }}>
                <span className={styles.macroValue}>{meal.calories}</span>
                <span className={styles.macroLabel}>Kcal</span>
              </div>
              <div className={styles.macroCell} style={{ background: MACRO_BG.protein }}>
                <span className={styles.macroValue}>{meal.protein}g</span>
                <span className={styles.macroLabel}>Protein</span>
              </div>
              <div className={styles.macroCell} style={{ background: MACRO_BG.fat }}>
                <span className={styles.macroValue}>{meal.fat}g</span>
                <span className={styles.macroLabel}>Fat</span>
              </div>
              <div className={styles.macroCell} style={{ background: MACRO_BG.carbs }}>
                <span className={styles.macroValue}>{meal.carbs}g</span>
                <span className={styles.macroLabel}>Carbs</span>
              </div>
            </div>

            {/* Actions */}
            <div className={styles.actions}>
              <button className={styles.actionBtn} onClick={handleDirection}><DirectionIcon size={24} /></button>
              <button className={styles.actionBtn} onClick={handleWolt}><WoltIcon /></button>
              <button
                className={`${styles.actionBtn} ${isFavourite ? styles.actionBtnActive : ''}`}
                onClick={() => onToggleFavourite?.(meal)}
              >
                {isFavourite ? <HeartFilledIcon size={24} /> : <HeartOutlineIcon size={24} />}
              </button>
              <button className={styles.actionBtn} onClick={handleShare}><ShareUpIcon size={24} /></button>
            </div>

            {/* ── AI Advisor ─────────────────────────── */}
            {(adviceLoading || advice) && (
              <>
                <div className={styles.divider} />
                <h3 className={styles.advisorHeading}>AI Advisor</h3>

                {adviceLoading ? (
                  <div className={styles.advisorSkeleton}>
                    <div className={styles.skeletonLine} style={{ width: '60%' }} />
                    <div className={styles.skeletonBar} />
                    <div className={styles.skeletonLine} />
                    <div className={styles.skeletonLine} style={{ width: '80%' }} />
                  </div>
                ) : (
                  <div className={styles.advisorContent}>
                    <div className={styles.advisorScoreRow}>
                      <span className={styles.advisorScoreLabel}>Nutritional value</span>
                      <span
                        className={styles.advisorScoreValue}
                        style={{ color: RATING_COLOR[advice.rating] ?? '#34a853' }}
                      >
                        {advice.score}% ({advice.rating})
                      </span>
                    </div>
                    <div className={styles.advisorTrack}>
                      <div
                        className={styles.advisorFill}
                        style={{
                          width: `${advice.score}%`,
                          background: RATING_COLOR[advice.rating] ?? '#34a853',
                        }}
                      />
                    </div>
                    <p className={styles.advisorText}>{advice.advice}</p>
                  </div>
                )}
              </>
            )}

            <div className={styles.divider} />

            <h3 className={styles.restaurantHeading}>Restaurant</h3>

            <div
              className={styles.restaurantCard}
              style={{ cursor: 'pointer' }}
              onClick={() => mealRestaurant && onRestaurantSelect?.(mealRestaurant)}
            >
              <div className={styles.restaurantPhotoWrap}>
                {mealRestaurant?.photo
                  ? <img src={withKey(mealRestaurant.photo)} alt={mealRestaurant.name} className={styles.restaurantPhoto} />
                  : <div className={styles.restaurantPhotoPlaceholder} />
                }
                {mealRestaurant?.priceLevel && (
                  <span className={styles.priceBadge}>{PRICE_LEVEL_MAP[mealRestaurant.priceLevel]}</span>
                )}
              </div>
              <div className={styles.restaurantInfo}>
                <div className={styles.restaurantNameWrap}>
                  <span className={styles.restaurantName}>{mealRestaurant?.name}</span>
                  <span className={styles.restaurantAddress}>
                    {mealRestaurant?.address || 'Berlin, Deutschland'}
                  </span>
                </div>
                <div className={styles.restaurantMeta}>
                  <span className={styles.openNow}>Open now</span>
                  {liveDistance && (
                    <>
                      <span className={styles.dot} />
                      <span className={styles.distanceGroup}>
                        <WalkIcon size={14} />
                        <span className={styles.metaText}>{liveDistance}</span>
                      </span>
                    </>
                  )}
                  {mealRestaurant?.rating != null && (
                    <>
                      <span className={styles.dot} />
                      <span className={styles.ratingGroup}>
                        <span className={styles.metaStar}>★{mealRestaurant.rating}</span>
                        <span className={styles.metaText}>({mealRestaurant.reviewCount?.toLocaleString('de-DE')})</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
