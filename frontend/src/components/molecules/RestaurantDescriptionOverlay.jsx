import { useEffect, useRef, Fragment } from 'react'
import { CloseIcon, DirectionIcon, WoltIcon, ShareUpIcon, WalkIcon } from '../atoms/icons'
import CardMeal from './CardMeal'
import { MOCK_RESTAURANTS } from '../../data/mockData'
import { withKey } from '../../utils/photoUrl'
import styles from './RestaurantDescriptionOverlay.module.css'

export default function RestaurantDescriptionOverlay({ restaurant, meals = [], zIndex = 200, onClose, onMealSelect }) {
  function handleDirection() {
    const r = MOCK_RESTAURANTS.find(r => r.name === restaurant.name)
    if (r) window.open(`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`, '_blank')
  }

  function handleWolt() {
    const r = MOCK_RESTAURANTS.find(r => r.name === restaurant.name)
    if (r?.woltSlug) window.open(`https://wolt.com/de/deu/berlin/restaurant/${r.woltSlug}`, '_blank')
  }

  function handleShare() {
    const url = window.location.href
    if (navigator.share) {
      navigator.share({ title: restaurant.name, url }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(`${restaurant.name} — ${url}`)
    }
  }
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

  // ── Animate close ────────────────────────────────────
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

  // ── Swipe-to-dismiss ─────────────────────────────────
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
      const matrix = new DOMMatrix(getComputedStyle(sheet).transform)
      const ty     = matrix.m42
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

  if (!restaurant) return null

  return (
    <div ref={backdropRef} className={styles.backdrop} style={{ zIndex }} onClick={animateClose}>
      <div ref={sheetRef} className={styles.sheet} style={{ zIndex: zIndex + 1 }} onClick={e => e.stopPropagation()}>

        {/* ── Close button — absolute on sheet, never scrolls ── */}
        <button className={styles.closeBtn} onClick={animateClose} aria-label="Close">
          <CloseIcon size={16} />
        </button>

        {/* ── Scrollable content — photo scrolls too ── */}
        <div ref={scrollContentRef} className={styles.scrollContent}>

          {/* Photo area — scrolls with content */}
          <div className={styles.photoArea}>
            {restaurant.photo && (
              <img src={withKey(restaurant.photo)} alt={restaurant.name} className={styles.photo} />
            )}
          </div>
          <div className={styles.content}>

            <div className={styles.infoGroup}>
              <h2 className={styles.name}>{restaurant.name}</h2>

              {restaurant.address && (
                <p className={styles.address}>{restaurant.address}</p>
              )}

              {/* Meta row */}
              <div className={styles.meta}>
                <span className={styles.openNow}>Open now</span>
                {restaurant.priceRange && (
                  <>
                    <span className={styles.dot} />
                    <span className={styles.metaText}>{restaurant.priceRange}</span>
                  </>
                )}
                {restaurant.distance && (
                  <>
                    <span className={styles.dot} />
                    <span className={styles.distanceGroup}>
                      <WalkIcon size={14} />
                      <span className={styles.metaText}>{restaurant.distance}</span>
                    </span>
                  </>
                )}
                {restaurant.rating != null && (
                  <>
                    <span className={styles.dot} />
                    <span className={styles.ratingGroup}>
                      <span className={styles.metaStar}>★{restaurant.rating}</span>
                      <span className={styles.metaText}>({restaurant.reviewCount?.toLocaleString('de-DE')})</span>
                    </span>
                  </>
                )}
              </div>

              {/* 3 action buttons */}
              <div className={styles.actions}>
                <button className={styles.actionBtn} onClick={handleDirection}><DirectionIcon size={24} /></button>
                <button className={styles.actionBtn} onClick={handleWolt}><WoltIcon /></button>
                <button className={styles.actionBtn} onClick={handleShare}><ShareUpIcon size={24} /></button>
              </div>
            </div>

            <div className={styles.divider} />

            <div className={styles.mealsSection}>
              <h3 className={styles.mealsHeading}>Meals</h3>
              <div className={styles.mealsList}>
                {meals.map((meal, i) => (
                  <Fragment key={meal.id}>
                    {i > 0 && <div className={styles.separator} />}
                    <CardMeal {...meal} hideRestaurant onClick={() => onMealSelect?.(meal)} />
                  </Fragment>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
