import styles from './ButtonFilterActions.module.css'

export default function ButtonFilterActions({ onReset, onApply }) {
  return (
    <div className={styles.wrap}>
      <button className={styles.reset} onClick={onReset} type="button">
        <img src="/Reset.svg" alt="" width={16} height={16} />
        Reset
      </button>
      <button className={styles.apply} onClick={onApply} type="button">
        Apply
      </button>
    </div>
  )
}
