import PillTab from '../atoms/PillTab'
import ButtonFilterActions from './ButtonFilterActions'
import styles from './FiltersPanel.module.css'

export default function FiltersPanel({ show, pending, onChange, onReset, onApply, onClose }) {

  function toggle(key, value) {
    onChange({ ...pending, [key]: value })
  }

  // Multi-select: must keep at least one selected
  function toggleMulti(key, value) {
    const arr = pending[key]
    if (arr.includes(value)) {
      if (arr.length === 1) return
      onChange({ ...pending, [key]: arr.filter(v => v !== value) })
    } else {
      onChange({ ...pending, [key]: [...arr, value] })
    }
  }

  function toggleBool(key) {
    onChange({ ...pending, [key]: !pending[key] })
  }

  return (
    <>
      {/* Dark backdrop — click to dismiss */}
      <div
        className={`${styles.backdrop} ${show ? styles.backdropVisible : ''}`}
        onClick={onClose}
      />

      {/* Filter panel — slides down from top */}
      <div className={`${styles.panel} ${show ? styles.panelVisible : ''}`}>
      <div className={styles.panelContent}>

        {/* Macros confidence — multi-select */}
        <div className={styles.section}>
          <span className={styles.label}>Macros confidence</span>
          <div className={styles.pills}>
            <PillTab
              label="High"
              selected={pending.macrosConfidence.includes('high')}
              onClick={() => toggleMulti('macrosConfidence', 'high')}
            />
            <PillTab
              label="Medium"
              selected={pending.macrosConfidence.includes('medium')}
              onClick={() => toggleMulti('macrosConfidence', 'medium')}
            />
          </div>
        </div>

        {/* Measure — single-select */}
        <div className={styles.section}>
          <span className={styles.label}>Measure</span>
          <div className={styles.pills}>
            <PillTab
              label="per meal"
              selected={pending.measure === 'per_meal'}
              onClick={() => toggle('measure', 'per_meal')}
            />
            <PillTab
              label="per 100 g"
              selected={pending.measure === 'per_100g'}
              onClick={() => toggle('measure', 'per_100g')}
            />
          </div>
        </div>

        {/* Sort by — single-select */}
        <div className={styles.section}>
          <span className={styles.label}>Sort by</span>
          <div className={styles.pills}>
            <PillTab
              label="Nearest"
              selected={pending.sortBy === 'nearest'}
              onClick={() => toggle('sortBy', 'nearest')}
            />
            <PillTab
              label="Best match"
              selected={pending.sortBy === 'best_match'}
              onClick={() => toggle('sortBy', 'best_match')}
            />
            <PillTab
              label="A-Z"
              selected={pending.sortBy === 'a_z'}
              onClick={() => toggle('sortBy', 'a_z')}
            />
          </div>
        </div>

        <div className={styles.divider} />

        {/* Open now + Top ranked — independent toggles */}
        <div className={styles.section}>
          <div className={styles.pills}>
            <PillTab
              label="Open now"
              selected={pending.openNow}
              onClick={() => toggleBool('openNow')}
            />
            <PillTab
              label="Top ranked"
              selected={pending.topRanked}
              onClick={() => toggleBool('topRanked')}
            />
          </div>
        </div>

        {/* Reset + Apply */}
        <div className={styles.actions}>
          <ButtonFilterActions onReset={onReset} onApply={onApply} />
        </div>

      </div>
      </div>
    </>
  )
}
