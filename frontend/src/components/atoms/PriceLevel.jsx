import styles from './PriceLevel.module.css'

const MAX_LEVEL = 4

/**
 * Renders a price level indicator: filled € signs up to `level`, grey beyond.
 * Example: level=2 → "€€" dark + "€€" grey
 */
export default function PriceLevel({ level, className }) {
  if (!level || level < 1 || level > MAX_LEVEL) return null
  return (
    <span className={`${styles.wrap} ${className ?? ''}`}>
      {Array.from({ length: MAX_LEVEL }, (_, i) => (
        <span key={i} className={i < level ? styles.filled : styles.empty}>€</span>
      ))}
    </span>
  )
}
