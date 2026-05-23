import MainNavigation from '../components/molecules/MainNavigation'
import styles from './Profile.module.css'

const MACROS = [
  { type: 'calories', value: '2500', label: 'Kcal' },
  { type: 'protein',  value: '156g', label: 'Protein' },
  { type: 'fat',      value: '83g',  label: 'Fat' },
  { type: 'carbs',    value: '281g', label: 'Carbs' },
]

const MACRO_BG = {
  calories: 'var(--color-surface)',
  protein:  'var(--color-semantic-green)',
  fat:      'var(--color-semantic-yellow)',
  carbs:    'var(--color-semantic-blue)',
}

export default function Profile({ activeTab, onTabChange }) {
  return (
    <div className={styles.screen}>
      <div className={styles.titleBar}>
        <span className={styles.title}>Profile</span>
      </div>

      <div className={styles.content}>

        {/* Avatar + Name */}
        <div className={styles.hero}>
          <div className={styles.avatarWrap}>
            <img src="/User.svg" width={40} height={40} alt="Avatar" />
          </div>
          <span className={styles.userName}>George Kvasnikov</span>
        </div>

        {/* Macros settings card */}
        <div className={styles.card}>
          <div className={styles.macrosHeader}>
            <div className={styles.macrosLeft}>
              <img src="/Pie.svg" width={24} height={24} alt="" />
              <span className={styles.macrosLabel}>Macros settings</span>
            </div>
            <div className={styles.macrosRight}>
              <span className={styles.macrosGoal}>Muscle gain</span>
              <img src="/Chevron-right.svg" width={24} height={24} alt="" />
            </div>
          </div>
          <div className={styles.macrosRow}>
            {MACROS.map(m => (
              <div key={m.type} className={styles.macroCell} style={{ background: MACRO_BG[m.type] }}>
                <span className={styles.macroCellValue}>{m.value}</span>
                <span className={styles.macroCellLabel}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className={styles.divider} />

        {/* Log out */}
        <div className={styles.row}>
          <div className={styles.rowLeft}>
            <img src="/Door.svg" width={24} height={24} alt="" />
            <span className={styles.rowLabel}>Log out</span>
          </div>
          <img src="/Chevron-right.svg" width={24} height={24} alt="" className={styles.chevron} />
        </div>

      </div>

      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
