import styles from './PillTab.module.css'

export default function PillTab({ label, icon, selected = false, onClick }) {
  return (
    <button
      type="button"
      className={`${styles.pill} ${selected ? styles.selected : ''}`}
      onClick={onClick}
    >
      {icon && <img src={icon} width={16} height={16} alt="" aria-hidden="true" className={styles.pillIcon} />}
      {label}
    </button>
  )
}
