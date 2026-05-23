import { useEffect, useRef } from 'react'
import { CloseIcon, HeartOutlineIcon, ShareUpIcon, DirectionIcon } from '../atoms/icons'
import styles from './MealDescriptionOverlay.module.css'

const MACRO_BG = {
  calories: 'var(--color-surface)',
  protein:  'var(--color-semantic-green)',
  fat:      'var(--color-semantic-yellow)',
  carbs:    'var(--color-semantic-blue)',
}

export default function MealDescriptionOverlay({ meal, onClose }) {
  const backdropRef = useRef(null)
  const sheetRef    = useRef(null)
  const onCloseRef  = useRef(onClose)
  onCloseRef.current = onClose

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // ── Animate close (JS-driven so it works for both X and swipe) ──────
  function animateClose() {
    const sheet   = sheetRef.current
    const backdrop = backdropRef.current
    if (sheet) {
      sheet.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      sheet.style.transform  = 'translateY(100%)'
    }
    if (backdrop) {
      backdrop.style.transition = 'opacity 0.3s ease'
      backdrop.style.opacity    = '0'
    }
    setTimeout(() => onCloseRef.current?.(), 340)
  }

  // ── Swipe-to-dismiss touch handler ──────────────────────────────────
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return

    const startY        = { current: 0 }
    const startScroll   = { current: 0 }
    const lastY         = { current: 0 }
    const lastT         = { current: 0 }
    const vel           = { current: 0 }
    const dragging      = { current: false }
    const animating     = { current: false }

    function onTouchStart(e) {
      if (animating.current) return
      startY.current      = e.touches[0].clientY
      startScroll.current = sheet.scrollTop
      lastY.current       = e.touches[0].clientY
      lastT.current       = Date.now()
      vel.current         = 0
      dragging.current    = false
    }

    function onTouchMove(e) {
      if (animating.current) return
      const y     = e.touches[0].clientY
      const delta = y - startY.current
      const now   = Date.now()
      const dt    = now - lastT.current
      if (dt > 0) vel.current = (y - lastY.current) / dt
      lastY.current = y
      lastT.current = now

      if (!dragging.current) {
        // Only hijack if at top and clearly pulling down
        if (startScroll.current === 0 && delta > 6) {
          dragging.current    = true
          sheet.style.transition = 'none'
        } else {
          return
        }
      }

      e.preventDefault()
      const clamped = Math.max(0, delta)
      sheet.style.transform = `translateY(${clamped}px)`
    }

    function onTouchEnd() {
      if (!dragging.current || animating.current) return
      dragging.current = false

      const matrix     = new DOMMatrix(getComputedStyle(sheet).transform)
      const translateY = matrix.m42

      if (translateY > 100 || vel.current > 0.5) {
        animating.current = true
        animateClose()
      } else {
        sheet.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
        sheet.style.transform  = 'translateY(0)'
      }
    }

    sheet.addEventListener('touchstart', onTouchStart, { passive: true })
    sheet.addEventListener('touchmove',  onTouchMove,  { passive: false })
    sheet.addEventListener('touchend',   onTouchEnd,   { passive: true })
    return () => {
      sheet.removeEventListener('touchstart', onTouchStart)
      sheet.removeEventListener('touchmove',  onTouchMove)
      sheet.removeEventListener('touchend',   onTouchEnd)
    }
  }, []) // eslint-disable-line

  if (!meal) return null

  return (
    <div ref={backdropRef} className={styles.backdrop} onClick={animateClose}>
      <div ref={sheetRef} className={styles.sheet} onClick={e => e.stopPropagation()}>

        {/* ── Photo area ──────────────────────────────── */}
        <div className={styles.photoArea}>
          <button className={styles.closeBtn} onClick={animateClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
          <div className={styles.photoCircle}>
            {meal.photo && <img src={meal.photo} alt={meal.name} className={styles.photo} />}
            <div className={styles.photoGradient} />
          </div>
        </div>

        {/* ── Scrollable content ───────────────────────── */}
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
              <DirectionIcon size={22} />
            </button>
            <button className={styles.actionBtn}>
              <img src="/Wolt.svg" height={17} alt="Wolt" style={{ display: 'block' }} />
            </button>
            <button className={styles.actionBtn}>
              <HeartOutlineIcon size={22} />
            </button>
            <button className={styles.actionBtn}>
              <ShareUpIcon size={22} />
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
