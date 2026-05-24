import { SearchIcon, TuneIcon } from '../atoms/icons'
import styles from './TopBar.module.css'

export default function TopBar({ title = 'Meal Time', subtitle, icon, onSearchClick, onFilterClick, filterActive = false }) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.pill}>
        <button className={styles.iconBtn} onClick={onSearchClick} aria-label="Search">
          {icon ?? <SearchIcon size={15} />}
        </button>

        <div className={styles.center}>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>

        <button
          className={`${styles.iconBtn} ${filterActive ? styles.iconBtnActive : ''}`}
          onClick={onFilterClick}
          aria-label="Filters"
        >
          <TuneIcon size={15} />
        </button>
      </div>
    </div>
  )
}
