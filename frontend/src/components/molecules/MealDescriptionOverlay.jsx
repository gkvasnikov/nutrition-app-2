import { useEffect } from 'react'
import { CloseIcon, HeartOutlineIcon, ShareUpIcon, OrderIcon } from '../atoms/icons'
import styles from './MealDescriptionOverlay.module.css'

const MACRO_BG = {
  calories: 'var(--color-surface)',
  protein:  'var(--color-semantic-green)',
  fat:      'var(--color-semantic-yellow)',
  carbs:    'var(--color-semantic-blue)',
}

export default function MealDescriptionOverlay({ meal, onClose }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  if (!meal) return null

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>

        {/* ── Photo area ─────────────────────────────── */}
        <div className={styles.photoArea}>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
          <div className={styles.photoCircle}>
            {meal.photo && <img src={meal.photo} alt={meal.name} className={styles.photo} />}
          </div>
        </div>

        {/* ── Scrollable content ─────────────────────── */}
        <div className={styles.content}>

          {/* Name */}
          <h2 className={styles.name}>{meal.name}</h2>

          {/* Description */}
          {meal.description && <p className={styles.description}>{meal.description}</p>}

          {/* Price */}
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
              <OrderIcon size={18} />
            </button>
            <button className={`${styles.actionBtn} ${styles.woltBtn}`}>
              Wolt
            </button>
            <button className={styles.actionBtn}>
              <HeartOutlineIcon size={20} />
            </button>
            <button className={styles.actionBtn}>
              <ShareUpIcon size={20} />
            </button>
          </div>

          {/* Divider */}
          <div className={styles.divider} />

          {/* Restaurant section */}
          <h3 className={styles.restaurantHeading}>Restaurant</h3>

          <div className={styles.restaurantCard}>
            {/* Left: photo + price badge */}
            <div className={styles.restaurantPhotoWrap}>
              {meal.restaurantPhoto
                ? <img src={meal.restaurantPhoto} alt={meal.restaurantName} className={styles.restaurantPhoto} />
                : <div className={styles.restaurantPhotoPlaceholder} />
              }
              {meal.priceRange && (
                <span className={styles.priceBadge}>{meal.priceRange}</span>
              )}
            </div>

            {/* Right: info */}
            <div className={styles.restaurantInfo}>
              <div className={styles.restaurantNameWrap}>
                <span className={styles.restaurantName}>{meal.restaurantName}</span>
                {meal.restaurantAddress && (
                  <span className={styles.restaurantAddress}>{meal.restaurantAddress}</span>
                )}
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
