import styles from './Icon.module.css'

export default function Icon({ name, size = 24, fill = 1, className = '' }) {
  return (
    <span
      className={`${styles.icon} ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}
