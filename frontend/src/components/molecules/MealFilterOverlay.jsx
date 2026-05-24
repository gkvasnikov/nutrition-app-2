import { useState, useEffect } from 'react'
import PillTab from '../atoms/PillTab'
import ButtonFilterActions from './ButtonFilterActions'
import { ChevronIcon, SearchIcon } from '../atoms/icons'
import styles from './MealFilterOverlay.module.css'

// ─── Presets ─────────────────────────────────────────────────────────────────

const MEAL_PRESETS = {
  breakfast: { kcal: [250, 600],  protein: [15, 50], fat: [5,  25], carbs: [30,  80] },
  lunch:     { kcal: [400, 900],  protein: [25, 65], fat: [10, 35], carbs: [50, 120] },
  dinner:    { kcal: [350, 850],  protein: [25, 65], fat: [8,  35], carbs: [40, 100] },
  snack:     { kcal: [100, 300],  protein: [5,  25], fat: [2,  15], carbs: [10,  50] },
}

const DIET_PRESETS = {
  high_protein: { kcal: [400, 1000], protein: [50, 150], fat: [10,  40], carbs: [20,  80] },
  high_carb:    { kcal: [400, 1000], protein: [20,  60], fat: [5,   25], carbs: [80, 200] },
  balanced:     { kcal: [300,  900], protein: [25,  75], fat: [10,  35], carbs: [40, 120] },
  keto:         { kcal: [300,  900], protein: [30,  80], fat: [40, 100], carbs: [0,   25] },
  custom:       null,
}

const DEFAULT_MACROS = { kcal: [250, 1000], protein: [55, 200], fat: [0, 43], carbs: [0, 100] }

const SLIDER_CONFIG = [
  { key: 'kcal',    label: 'Kcal',    min: 0, max: 2000 },
  { key: 'protein', label: 'Protein', min: 0, max: 300  },
  { key: 'fat',     label: 'Fat',     min: 0, max: 150  },
  { key: 'carbs',   label: 'Carbs',   min: 0, max: 400  },
]

const MEAL_TIMES = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snack',     label: 'Snack' },
]

const DIET_TYPES = [
  { key: 'high_protein', label: 'High Protein' },
  { key: 'high_carb',    label: 'High Carb' },
  { key: 'balanced',     label: 'Balanced' },
  { key: 'keto',         label: 'Keto' },
  { key: 'custom',       label: 'Custom' },
]

// ─── RangeSlider ─────────────────────────────────────────────────────────────

function RangeSlider({ label, min, max, value, onChange }) {
  const [lo, hi] = value
  const loPercent = ((lo - min) / (max - min)) * 100
  const hiPercent = ((hi - min) / (max - min)) * 100

  return (
    <div className={styles.sliderRow}>
      <div className={styles.sliderMeta}>
        <span className={styles.sliderLabel}>{label}</span>
        <span className={styles.sliderValue}>from {lo} to {hi}</span>
      </div>
      <div className={styles.sliderTrack}>
        <div
          className={styles.sliderFill}
          style={{ left: `${loPercent}%`, right: `${100 - hiPercent}%` }}
        />
        <input
          type="range"
          className={styles.sliderInput}
          min={min}
          max={max}
          value={lo}
          onChange={e => onChange([Math.min(Number(e.target.value), hi - 1), hi])}
        />
        <input
          type="range"
          className={styles.sliderInput}
          min={min}
          max={max}
          value={hi}
          onChange={e => onChange([lo, Math.max(Number(e.target.value), lo + 1)])}
        />
      </div>
    </div>
  )
}

// ─── MealFilterOverlay ───────────────────────────────────────────────────────

export default function MealFilterOverlay({ show, onClose, onApply }) {
  // Filter state
  const [mealTime, setMealTime] = useState(null)
  const [diet,     setDiet]     = useState(null)
  const [macros,   setMacros]   = useState(DEFAULT_MACROS)
  const [search,   setSearch]   = useState('')
  const [dietTags, setDietTags] = useState({ plantBased: false, glutenFree: false, diabetesFriendly: false })

  // Which accordion is open (only one at a time)
  const [openSection, setOpenSection] = useState('mealtime')

  // Animation state
  const [isVisible,  setIsVisible]  = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    let raf1, raf2, timer
    if (show) {
      setOpenSection('mealtime')
      setIsVisible(true)
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setIsExpanded(true))
      })
    } else {
      setIsExpanded(false)
      timer = setTimeout(() => setIsVisible(false), 520)
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      if (timer) clearTimeout(timer)
    }
  }, [show])

  // ── Helpers ──────────────────────────────────────────────────────────────

  function toggleSection(key) {
    setOpenSection(prev => prev === key ? null : key)
  }

  function computeMacros(mealTimeVal, dietVal) {
    const mealPreset = mealTimeVal ? MEAL_PRESETS[mealTimeVal] : DEFAULT_MACROS
    const dietPreset = dietVal && DIET_PRESETS[dietVal] ? DIET_PRESETS[dietVal] : null
    return dietPreset ?? mealPreset
  }

  function selectMealTime(t) {
    const next = mealTime === t ? null : t
    setMealTime(next)
    setMacros(computeMacros(next, diet))
  }

  function selectDiet(d) {
    const next = diet === d ? null : d
    setDiet(next)
    setMacros(computeMacros(mealTime, next))
  }

  function toggleDietTag(key) {
    setDietTags(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function handleReset() {
    setMealTime(null)
    setDiet(null)
    setMacros(DEFAULT_MACROS)
    setDietTags({ plantBased: false, glutenFree: false, diabetesFriendly: false })
    setSearch('')
    onClose()
  }

  function handleApply() {
    onApply?.({ mealTime, diet, macros, dietTags, search })
    onClose()
  }

  if (!isVisible) return null

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.overlay}>

      {/* Backdrop — click to dismiss without applying */}
      <div
        className={`${styles.backdrop} ${isExpanded ? styles.backdropVisible : ''}`}
        onClick={onClose}
      />

      {/* Panel wrapper — same position as TopBar */}
      <div className={`${styles.panelWrap} ${isVisible ? styles.panelWrapVisible : ''}`}>
        <div className={`${styles.panel} ${isExpanded ? styles.panelExpanded : ''}`}>

          {/* ── 1. Meal Time accordion ────────────────────────────── */}
          <button
            type="button"
            className={styles.firstHeader}
            onClick={() => toggleSection('mealtime')}
          >
            <SearchIcon size={15} className={styles.firstHeaderIcon} />
            <span className={styles.firstHeaderTitle}>Meal Time</span>
            <div className={`${styles.chevronBtn} ${openSection === 'mealtime' ? styles.chevronOpen : ''}`}>
              <ChevronIcon size={16} />
            </div>
          </button>

          <div className={`${styles.body} ${openSection === 'mealtime' ? styles.bodyOpen : ''}`}>
            <div className={styles.bodyInner}>
              {/* Meal time pills */}
              <div className={styles.pillRow}>
                {MEAL_TIMES.map(({ key, label }) => (
                  <PillTab key={key} label={label} selected={mealTime === key} onClick={() => selectMealTime(key)} />
                ))}
              </div>
              {/* Diet type pills */}
              <div className={styles.pillRow}>
                {DIET_TYPES.map(({ key, label }) => (
                  <PillTab key={key} label={label} selected={diet === key} onClick={() => selectDiet(key)} />
                ))}
              </div>
              {/* Search */}
              <div className={styles.searchWrap}>
                <SearchIcon size={14} className={styles.searchIcon} />
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* ── Divider ───────────────────────────────────────────── */}
          <div className={styles.divider} />

          {/* ── 2. Adjust macros accordion ────────────────────────── */}
          <button
            type="button"
            className={styles.accordionHeader}
            onClick={() => toggleSection('macros')}
          >
            <span className={styles.accordionTitle}>Adjust macros</span>
            <div className={`${styles.chevronBtn} ${openSection === 'macros' ? styles.chevronOpen : ''}`}>
              <ChevronIcon size={16} />
            </div>
          </button>

          <div className={`${styles.body} ${openSection === 'macros' ? styles.bodyOpen : ''}`}>
            <div className={styles.bodyInner}>
              {SLIDER_CONFIG.map(cfg => (
                <RangeSlider
                  key={cfg.key}
                  label={cfg.label}
                  min={cfg.min}
                  max={cfg.max}
                  value={macros[cfg.key]}
                  onChange={v => setMacros(prev => ({ ...prev, [cfg.key]: v }))}
                />
              ))}
              {/* Dietary restriction tags */}
              <div className={styles.pillRow}>
                <PillTab label="Plant-based"      selected={dietTags.plantBased}        onClick={() => toggleDietTag('plantBased')} />
                <PillTab label="Gluten-free"       selected={dietTags.glutenFree}         onClick={() => toggleDietTag('glutenFree')} />
                <PillTab label="Diabetes friendly" selected={dietTags.diabetesFriendly}   onClick={() => toggleDietTag('diabetesFriendly')} />
              </div>
            </div>
          </div>

          {/* ── Divider ───────────────────────────────────────────── */}
          <div className={styles.divider} />

          {/* ── 3. Profile accordion ──────────────────────────────── */}
          <button
            type="button"
            className={styles.accordionHeader}
            onClick={() => toggleSection('profile')}
          >
            <span className={styles.accordionTitle}>Profile</span>
            <div className={`${styles.chevronBtn} ${openSection === 'profile' ? styles.chevronOpen : ''}`}>
              <ChevronIcon size={16} />
            </div>
          </button>

          <div className={`${styles.body} ${openSection === 'profile' ? styles.bodyOpen : ''}`}>
            <div className={styles.bodyInner}>
              {/* User info row */}
              <div className={styles.profileRow}>
                <div className={styles.avatar}>M</div>
                <div className={styles.profileInfo}>
                  <span className={styles.profileName}>Male, 38</span>
                  <span className={styles.profileGoal}>Goal: Muscle gain</span>
                </div>
                <button type="button" className={styles.editBtn}>✎ Edit Profile</button>
              </div>

              {/* Your diet row */}
              <div className={styles.dietSection}>
                <span className={styles.dietLabel}>Your diet</span>
                <div className={styles.dietCells}>
                  {[
                    { value: '2500', unit: 'Kcal' },
                    { value: '156g', unit: 'Protein' },
                    { value: '83g',  unit: 'Fat' },
                    { value: '281g', unit: 'Carbs' },
                  ].map(({ value, unit }) => (
                    <div key={unit} className={styles.dietCell}>
                      <span className={styles.dietCellValue}>{value}</span>
                      <span className={styles.dietCellUnit}>{unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Reset + Apply ─────────────────────────────────────── */}
          <div className={`${styles.actions} ${isExpanded ? styles.actionsVisible : ''}`}>
            <ButtonFilterActions onReset={handleReset} onApply={handleApply} />
          </div>

        </div>
      </div>

    </div>
  )
}
