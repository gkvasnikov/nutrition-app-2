import Icon from '../atoms/Icon'
import styles from './MainNavigation.module.css'

const TABS = [
  { id: 'home',       label: 'Home',       icon: 'home' },
  { id: 'discover',   label: 'Discover',   icon: 'map' },
  { id: 'favourites', label: 'Favourites', icon: 'favorite' },
  { id: 'profile',    label: 'Profile',    icon: 'person' },
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
            <Icon name={tab.icon} size={24} />
            <span className={styles.label}>{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
