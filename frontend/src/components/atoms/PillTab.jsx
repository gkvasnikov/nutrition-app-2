import styles from './PillTab.module.css'

export default function PillTab({ label, icon, iconSize = 24, selected = false, onClick }) {
  return (
    <button
      type="button"
      className={`${styles.pill} ${selected ? styles.selected : ''}`}
      onClick={onClick}
    >
      {icon && <img src={icon} width={iconSize} height={iconSize} alt="" aria-hidden="true" className={styles.pillIcon} />}
      {label}
    </button>
  )
}
