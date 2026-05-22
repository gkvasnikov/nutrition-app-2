import Icon from '../atoms/Icon'
import styles from './TopBar.module.css'

export default function TopBar({ title = 'Meal Time', subtitle, onSearchClick, onFilterClick }) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.pill}>
        <button className={styles.iconBtn} onClick={onSearchClick} aria-label="Search">
          <Icon name="search" size={20} fill={0} />
        </button>

        <div className={styles.center}>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>

        <button className={styles.iconBtn} onClick={onFilterClick} aria-label="Filters">
          <Icon name="tune" size={20} fill={0} />
        </button>
      </div>
    </div>
  )
}
