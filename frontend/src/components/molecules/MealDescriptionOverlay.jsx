import { useEffect, useRef } from 'react'
import { CloseIcon, HeartOutlineIcon, ShareUpIcon, DirectionIcon, WoltIcon } from '../atoms/icons'
import styles from './MealDescriptionOverlay.module.css'

const MACRO_BG = {
  calories: 'var(--color-surface)',
  protein:  'var(--color-semantic-green)',
  fat:      'var(--color-semantic-yellow)',
  carbs:    'var(--color-semantic-blue)',
}

export default function MealDescriptionOverlay({ meal, onClose }) {
  const backdropRef    = useRef(null)
  const sheetRef       = useRef(null)
  const onCloseRef     = useRef(onClose)
  const animatingRef   = useRef(false)
  const animateCloseRef = useRef(null)
  onCloseRef.current   = onClose

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // ── Animate close (JS-driven, no opacity change) ─────────────────
  function animateClose() {
    if (animatingRef.current) return
    animatingRef.current = true
    const sheet = sheetRef.current
    if (sheet) {
      sheet.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      sheet.style.transform  = 'translateY(100%)'
    }
    setTimeout(() => onCloseRef.current?.(), 340)
  }
  // Keep ref always fresh so touch handler can call it
  animateCloseRef.current = animateClose

  // ── Swipe-to-dismiss ─────────────────────────────────────────────
  // Listeners on backdrop (non-scrollable) so e.preventDefault() works
  // before iOS decides the touch belongs to the inner scroll container.
  useEffect(() => {
    const backdrop = backdropRef.current
    const sheet    = sheetRef.current
    if (!backdrop || !sheet) return

    let startY      = 0
    let startScroll = 0
    let couldDrag   = false
    let dragging    = false
    let lastY       = 0
    let lastT       = 0
    let vel         = 0

    function onTouchStart(e) {
      if (animatingRef.current) return
      const t   = e.touches[0]
      startY      = t.clientY
      startScroll = sheet.scrollTop
      couldDrag   = startScroll === 0   // arm drag only when at scroll top
      dragging    = false
      lastY       = t.clientY
      lastT       = Date.now()
      vel         = 0
    }

    function onTouchMove(e) {
      if (animatingRef.current) return
      const t     = e.touches[0]
      const delta = t.clientY - startY
      const now   = Date.now()
      const dt    = now - lastT
      if (dt > 0) vel = (t.clientY - lastY) / dt
      lastY = t.clientY
      lastT = now

      if (couldDrag && delta > 0) {
        // Call preventDefault EARLY — before iOS locks scroll mode
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
        sheet.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
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

        {/* ── Photo area — full rectangle, gradient overlay ── */}
        <div className={styles.photoArea}>
          <button className={styles.closeBtn} onClick={animateClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
          {meal.photo && (
            <img src={meal.photo} alt={meal.name} className={styles.photo} />
          )}
          {/* White gradient: bottom 40% of photo, bottom→top */}
          <div className={styles.photoGradient} />
        </div>

        {/* ── Scrollable content ──────────────────────────── */}
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

          {/* Action buttons */}
          <div className={styles.actions}>
            <button className={styles.actionBtn}>
              <DirectionIcon size={24} />
            </button>
            <button className={styles.actionBtn}>
              <WoltIcon />
            </button>
            <button className={styles.actionBtn}>
              <HeartOutlineIcon size={24} />
            </button>
            <button className={styles.actionBtn}>
              <ShareUpIcon size={24} />
            </button>
          </div>

          {/* Divider */}
          <div className={styles.divider} />

          {/* Restaurant */}
          <h3 className={styles.restaurantHeading}>Restaurant</h3>

          <div className={styles.restaurantCard}>
            <div className={styles.restaurantPhotoWrap}>
              {meal.restaurantPhoto
                ? <img src={meal.restaurantPhoto} alt={meal.restaurantName} className={styles.restaurantPhoto} />
                : <div className={styles.restaurantPhotoPlaceholder} />
              }
              {meal.priceRange && (
                <span className={styles.priceBadge}>{meal.priceRange}</span>
              )}
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
                {meal.priceRange && (
                  <>
                    <span className={styles.dot} />
                    <span className={styles.metaText}>{meal.priceRange}</span>
                  </>
                )}
                {meal.distance && (
                  <>
                    <span className={styles.dot} />
                    <span className={styles.metaText}>{meal.distance}</span>
                  </>
                )}
                {meal.rating != null && (
                  <>
                    <span className={styles.dot} />
                    <span className={styles.metaStar}>★{meal.rating}</span>
                    <span className={styles.metaText}>({meal.reviewCount?.toLocaleString('de-DE')})</span>
                  </>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
