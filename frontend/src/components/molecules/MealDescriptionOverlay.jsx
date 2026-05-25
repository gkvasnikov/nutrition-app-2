import { useEffect, useRef } from 'react'
import { CloseIcon, HeartOutlineIcon, ShareUpIcon, DirectionIcon, WoltIcon, WalkIcon } from '../atoms/icons'
import { withKey } from '../../utils/photoUrl'
import styles from './MealDescriptionOverlay.module.css'

const MACRO_BG = {
  calories: 'var(--color-surface)',
  protein:  'var(--color-semantic-green)',
  fat:      'var(--color-semantic-yellow)',
  carbs:    'var(--color-semantic-blue)',
}

export default function MealDescriptionOverlay({ meal, onClose, onRestaurantSelect }) {
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

  if (!meal) return null

  return (
    <div ref={backdropRef} className={styles.backdrop} onClick={animateClose}>
      <div ref={sheetRef} className={styles.sheet} onClick={e => e.stopPropagation()}>

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
              <button className={styles.actionBtn}><DirectionIcon size={24} /></button>
              <button className={styles.actionBtn}><WoltIcon /></button>
              <button className={styles.actionBtn}><HeartOutlineIcon size={24} /></button>
              <button className={styles.actionBtn}><ShareUpIcon size={24} /></button>
            </div>

            <div className={styles.divider} />

            <h3 className={styles.restaurantHeading}>Restaurant</h3>

            <div
              className={styles.restaurantCard}
              style={{ cursor: 'pointer' }}
              onClick={() => onRestaurantSelect?.({
                name:        meal.restaurantName,
                photo:       meal.restaurantPhoto,
                address:     meal.restaurantAddress,
                priceRange:  meal.priceRange,
                distance:    meal.distance,
                rating:      meal.rating,
                reviewCount: meal.reviewCount,
              })}
            >
              <div className={styles.restaurantPhotoWrap}>
                {meal.restaurantPhoto
                  ? <img src={withKey(meal.restaurantPhoto)} alt={meal.restaurantName} className={styles.restaurantPhoto} />
                  : <div className={styles.restaurantPhotoPlaceholder} />
                }
                {meal.priceRange && <span className={styles.priceBadge}>{meal.priceRange}</span>}
              </div>
              <div className={styles.restaurantInfo}>
                <div className={styles.restaurantNameWrap}>
                  <span className={styles.restaurantName}>{meal.restaurantName}</span>
                  <span className={styles.restaurantAddress}>
                    {meal.restaurantAddress ?? 'Eisenbahnstraße 42-43, 10997 Berlin, Deutschland'}
                  </span>
                </div>
                <div className={styles.restaurantMeta}>
                  <span className={styles.openNow}>Open now</span>
                  {meal.distance && (
                    <>
                      <span className={styles.dot} />
                      <span className={styles.distanceGroup}>
                        <WalkIcon size={14} />
                        <span className={styles.metaText}>{meal.distance}</span>
                      </span>
                    </>
                  )}
                  {meal.rating != null && (
                    <>
                      <span className={styles.dot} />
                      <span className={styles.ratingGroup}>
                        <span className={styles.metaStar}>★{meal.rating}</span>
                        <span className={styles.metaText}>({meal.reviewCount?.toLocaleString('de-DE')})</span>
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
