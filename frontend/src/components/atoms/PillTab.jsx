import styles from './PillTab.module.css'

export default function PillTab({ label, selected = false, onClick }) {
  return (
    <button
      type="button"
      className={`${styles.pill} ${selected ? styles.selected : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
