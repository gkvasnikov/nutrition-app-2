import { SearchIcon, TuneIcon } from '../atoms/icons'
import styles from './TopBar.module.css'

export default function TopBar({ title = 'Meal Time', subtitle, icon, onSearchClick, onFilterClick, filterActive = false, onPillClick }) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.pill}>
        <button className={styles.iconBtn} onClick={onSearchClick} aria-label="Search">
          {icon ?? <SearchIcon size={15} />}
        </button>

        <button
          type="button"
          className={`${styles.center} ${onPillClick ? styles.centerClickable : ''}`}
          onClick={onPillClick}
          tabIndex={onPillClick ? 0 : -1}
        >
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </button>

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
