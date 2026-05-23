import TopBar from '../components/molecules/TopBar'
import MainNavigation from '../components/molecules/MainNavigation'
import { ProfileIcon } from '../components/atoms/icons'
import styles from './Profile.module.css'

const MENU_SECTIONS = [
  {
    id: 'account',
    title: 'Account',
    items: [
      { id: 'goals',    icon: '/Pie.svg',  label: 'Nutrition Goals' },
      { id: 'nearby',   icon: '/Map.svg',  label: 'Nearby Restaurants' },
    ],
  },
]

function MenuItem({ icon, label }) {
  return (
    <div className={styles.menuItem}>
      <div className={styles.menuLeft}>
        <div className={styles.menuIconWrap}>
          <img src={icon} width={24} height={24} alt="" />
        </div>
        <span className={styles.menuLabel}>{label}</span>
      </div>
      <img src="/Chevron-right.svg" width={24} height={24} alt="" className={styles.chevron} />
    </div>
  )
}

export default function Profile({ activeTab, onTabChange }) {
  return (
    <div className={styles.screen}>
      <TopBar
        title="Profile"
        icon={<ProfileIcon size={24} />}
      />

      <div className={styles.content}>

        {/* Avatar */}
        <div className={styles.avatarSection}>
          <div className={styles.avatarWrap}>
            <img src="/User.svg" width={40} height={40} alt="Avatar" />
          </div>
          <div className={styles.avatarInfo}>
            <span className={styles.userName}>George K.</span>
            <span className={styles.userSub}>george@gkvasnikov.com</span>
          </div>
        </div>

        {/* Menu sections */}
        {MENU_SECTIONS.map(section => (
          <div key={section.id} className={styles.section}>
            <span className={styles.sectionTitle}>{section.title}</span>
            <div className={styles.menuCard}>
              {section.items.map((item, i) => (
                <div key={item.id}>
                  {i > 0 && <div className={styles.divider} />}
                  <MenuItem {...item} />
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Sign out */}
        <div className={styles.menuCard}>
          <div className={styles.menuItem}>
            <div className={styles.menuLeft}>
              <div className={styles.menuIconWrap}>
                <img src="/Door.svg" width={24} height={24} alt="" />
              </div>
              <span className={`${styles.menuLabel} ${styles.menuLabelDanger}`}>Sign Out</span>
            </div>
          </div>
        </div>

      </div>

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
