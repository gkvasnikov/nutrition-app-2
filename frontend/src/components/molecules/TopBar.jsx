import { SearchIcon, TuneIcon } from '../atoms/icons'
import styles from './TopBar.module.css'

export default function TopBar({ title = 'Meal Time', onSearchClick, onFilterClick }) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.pill}>
        <button className={styles.iconBtn} onClick={onSearchClick} aria-label="Search">
          <SearchIcon size={15} />
        </button>

        <div className={styles.center}>
          <span className={styles.title}>{title}</span>
        </div>

        <button className={styles.iconBtn} onClick={onFilterClick} aria-label="Filters">
          <TuneIcon size={15} />
        </button>
      </div>
    </div>
  )
}
