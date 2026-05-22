import styles from './PillMacro.module.css'

const BG = {
  calories: 'var(--color-surface)',
  protein:  'var(--color-semantic-green)',
  fat:      'var(--color-semantic-yellow)',
  carbs:    'var(--color-semantic-blue)',
}

export default function PillMacro({ type = 'calories', value, unit = 'g' }) {
  const label = {
    calories: `${value ?? 0} kcal`,
    protein:  `P ${value ?? 0}${unit}`,
    fat:      `F ${value ?? 0}${unit}`,
    carbs:    `C ${value ?? 0}${unit}`,
  }[type]

  return (
    <span className={styles.pill} style={{ background: BG[type] }}>
      {label}
    </span>
  )
}
