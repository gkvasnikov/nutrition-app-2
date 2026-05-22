import { LocationIcon } from '../atoms/icons'
import PillMacro from '../atoms/PillMacro'
import styles from './CardMeal.module.css'

export default function CardMeal({
  photo,
  name,
  price,
  description,
  calories,
  protein,
  fat,
  carbs,
  restaurantName,
  priceRange,
  distance,
  rating,
  reviewCount,
  onClick,
}) {
  return (
    <div className={styles.card} onClick={onClick}>

      {/* Dish row */}
      <div className={styles.dish}>
        <div className={styles.photoWrap}>
          {photo && <img src={photo} alt={name} className={styles.photo} />}
        </div>
        <div className={styles.content}>
          <div className={styles.info}>
            <div className={styles.nameRow}>
              <span className={styles.name}>{name}</span>
              {price && <span className={styles.price}>{price}</span>}
            </div>
            {description && (
              <p className={styles.description}>{description}</p>
            )}
          </div>
          <div className={styles.macros}>
            <PillMacro type="calories" value={calories ?? '–'} />
            <PillMacro type="protein"  value={protein  ?? '–'} />
            <PillMacro type="fat"      value={fat      ?? '–'} />
            <PillMacro type="carbs"    value={carbs    ?? '–'} />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className={styles.divider} />

      {/* Restaurant row */}
      <div className={styles.restaurantRow}>
        <div className={styles.restaurant}>
          <LocationIcon size={16} className={styles.locationIcon} />
          <span className={styles.restaurantName}>{restaurantName}</span>
        </div>
        {priceRange && (
          <>
            <span className={styles.dot} />
            <span className={styles.meta}>{priceRange}</span>
          </>
        )}
        {distance && (
          <>
            <span className={styles.dot} />
            <span className={styles.meta}>{distance}</span>
          </>
        )}
        {rating != null && (
          <>
            <span className={styles.dot} />
            <span className={styles.rating}>
              <span className={styles.star}>★</span>
              <span className={styles.ratingNum}>{rating}</span>{' '}
              <span className={styles.reviewCount}>({reviewCount?.toLocaleString('de-DE')})</span>
            </span>
          </>
        )}
      </div>

    </div>
  )
}
