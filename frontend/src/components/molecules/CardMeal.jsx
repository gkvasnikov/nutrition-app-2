import { LocationIcon, WalkIcon } from '../atoms/icons'
import PillMacro from '../atoms/PillMacro'
import { useLocation } from '../../contexts/LocationContext'
import { useAppData } from '../../contexts/DataContext'
import { distanceTo } from '../../utils/distance'
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
  restaurantId,
  restaurantName,
  priceRange,
  distance,
  rating,
  reviewCount,
  hideRestaurant = false,
  onClick,
  onRestaurantClick,
}) {
  const { userLat, userLng } = useLocation()
  const { restaurantById } = useAppData()
  const restaurant = restaurantId ? restaurantById.get(restaurantId) : null

  // Compact meal objects from /api/meals don't carry restaurant fields —
  // fall back to the restaurant lookup from DataContext.
  const displayName    = restaurantName ?? restaurant?.name
  const displayRating  = rating         ?? restaurant?.rating
  const displayReviews = reviewCount    ?? restaurant?.reviewCount
  const displayIsOpen  = restaurant?.isOpen ?? null  // true | false | null

  const computedDistance = distance ?? (
    restaurant ? distanceTo(userLat, userLng, restaurant.lat, restaurant.lng) : null
  )
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

      {/* Divider + Restaurant row — hidden when inside restaurant overlay */}
      {!hideRestaurant && <div className={styles.divider} />}

      {!hideRestaurant && <div className={styles.restaurantRow} onClick={onRestaurantClick ? e => { e.stopPropagation(); onRestaurantClick() } : undefined}>
        <div className={styles.restaurant}>
          <LocationIcon size={16} className={styles.locationIcon} />
          <span className={styles.restaurantName}>{displayName}</span>
        </div>
        {displayIsOpen != null && (
          <>
            <span className={styles.dot} />
            <span className={displayIsOpen ? styles.openNow : styles.meta}>
              {displayIsOpen ? 'Open now' : 'Closed'}
            </span>
          </>
        )}
        {computedDistance && (
          <>
            <span className={styles.dot} />
            <span className={styles.distanceGroup}>
              <WalkIcon size={14} />
              <span className={styles.meta}>{computedDistance}</span>
            </span>
          </>
        )}
        {displayRating != null && (
          <>
            <span className={styles.dot} />
            <span className={styles.rating}>
              <span className={styles.star}>★</span>
              <span className={styles.ratingNum}>{displayRating}</span>{' '}
              <span className={styles.reviewCount}>({displayReviews?.toLocaleString('de-DE')})</span>
            </span>
          </>
        )}
      </div>}

    </div>
  )
}
