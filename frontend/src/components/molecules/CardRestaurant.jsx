import styles from './CardRestaurant.module.css'

export default function CardRestaurant({
  photo,
  name,
  rating,
  reviewCount,
  address,
  priceRange,
  isOpen,
  hours,
  distance,
  onClick,
}) {
  return (
    <div className={styles.card} onClick={onClick}>

      {/* Photo */}
      <div className={styles.photoWrap}>
        {photo
          ? <img src={photo} alt={name} className={styles.photo} />
          : null
        }
        {priceRange && (
          <span className={styles.priceBadge}>{priceRange}</span>
        )}
      </div>

      {/* Info */}
      <div className={styles.info}>

        {/* Name + rating */}
        <div className={styles.infoTop}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{name}</span>
            {rating != null && (
              <span className={styles.rating}>
                <span className={styles.star}>★</span>
                {rating}{' '}
                <span className={styles.reviewCount}>
                  ({reviewCount?.toLocaleString('de-DE')})
                </span>
              </span>
            )}
          </div>
          <p className={styles.address}>{address}</p>
        </div>

        {/* Meta row */}
        <div className={styles.meta}>
          {isOpen != null && (
            <span className={isOpen ? styles.openBadge : styles.closedBadge}>
              {isOpen ? 'Open now' : 'Closed'}
            </span>
          )}
          {hours && (
            <>
              <span className={styles.dot} />
              <span className={styles.metaText}>{hours}</span>
            </>
          )}
          {distance && (
            <>
              <span className={styles.dot} />
              <span className={styles.metaText}>{distance}</span>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
