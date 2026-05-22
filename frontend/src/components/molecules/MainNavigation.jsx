import { HomeIcon, MapIcon, FavouriteIcon, ProfileIcon } from '../atoms/icons'
import styles from './MainNavigation.module.css'

const TABS = [
  { id: 'home',       label: 'Home',       Icon: HomeIcon },
  { id: 'discover',   label: 'Discover',   Icon: MapIcon },
  { id: 'favourites', label: 'Favourites', Icon: FavouriteIcon },
  { id: 'profile',    label: 'Profile',    Icon: ProfileIcon },
]

export default function MainNavigation({ active = 'home', onChange }) {
  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`${styles.tab} ${active === tab.id ? styles.active : ''}`}
            onClick={() => onChange?.(tab.id)}
            aria-label={tab.label}
          >
            <tab.Icon size={24} />
            <span className={styles.label}>{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
