import { useState, useEffect } from 'react'
import PillTab from '../atoms/PillTab'
import ButtonFilterActions from './ButtonFilterActions'
import { getTimedMealTime } from '../../utils/filterPill'
import styles from './MealFilterOverlay.module.css'

// ─── Presets ─────────────────────────────────────────────────────────────────

const MEAL_PRESETS = {
  breakfast: { kcal: [250, 700],  protein: [10, 50], fat: [5,  30], carbs: [20, 100] },
  lunch:     { kcal: [350, 850],  protein: [20, 65], fat: [8,  45], carbs: [20, 120] },
  dinner:    { kcal: [350, 900],  protein: [20, 65], fat: [8,  45], carbs: [10, 120] },
  snack:     { kcal: [100, 500],  protein: [5,  35], fat: [2,  25], carbs: [5,   80] },
}

const DIET_PRESETS = {
  high_protein: { kcal: [300,  900], protein: [25, 150], fat: [5,   55], carbs: [0,  150] },
  high_carb:    { kcal: [350, 1000], protein: [10,  60], fat: [5,   30], carbs: [60, 250] },
  balanced:     { kcal: [300,  800], protein: [15,  60], fat: [8,   40], carbs: [30, 120] },
  keto:         { kcal: [300,  900], protein: [20,  80], fat: [30, 100], carbs: [0,   25] },
  custom:       null,
}

const DEFAULT_MACROS = { kcal: [100, 1200], protein: [0, 200], fat: [0, 100], carbs: [0, 250] }

const SLIDER_CONFIG = [
  { key: 'kcal',    label: 'Kcal',    min: 0, max: 2000 },
  { key: 'protein', label: 'Protein', min: 0, max: 300  },
  { key: 'fat',     label: 'Fat',     min: 0, max: 150  },
  { key: 'carbs',   label: 'Carbs',   min: 0, max: 400  },
]

const MEAL_TIMES = [
  { key: 'breakfast', label: 'Breakfast', icon: '/icons/Breakfast.svg' },
  { key: 'lunch',     label: 'Lunch',     icon: '/icons/Lunch.svg' },
  { key: 'dinner',    label: 'Dinner',    icon: '/icons/Dinner.svg' },
  { key: 'snack',     label: 'Snack',     icon: '/icons/Snack.svg' },
]

const DIET_TYPES = [
  { key: 'high_protein', label: 'High Protein' },
  { key: 'high_carb',    label: 'High Carb' },
  { key: 'balanced',     label: 'Balanced' },
  { key: 'keto',         label: 'Keto' },
  { key: 'custom',       label: 'Custom' },
]

const DIET_CELL_BG = {
  Kcal:    'transparent',
  Protein: '#e3fbe8',
  Fat:     '#fefbed',
  Carbs:   '#f1f6fe',
}

// ─── RangeSlider ─────────────────────────────────────────────────────────────

function RangeSlider({ label, min, max, value, onChange }) {
  const [lo, hi] = value
  const loPercent = ((lo - min) / (max - min)) * 100
  const hiPercent = ((hi - min) / (max - min)) * 100

  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <div className={styles.sliderRight}>
        <span className={styles.sliderValue}>from {lo} to {hi}</span>
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
    </div>
  )
}

// ─── MealFilterOverlay ───────────────────────────────────────────────────────

export default function MealFilterOverlay({ show, onClose, onApply, initialFilters }) {
  // Filter state — initialized from current applied filters (or time-based defaults)
  const [mealTime, setMealTime] = useState(() => initialFilters?.mealTime ?? getTimedMealTime())
  const [diet,     setDiet]     = useState(() => initialFilters?.diet     ?? 'high_protein')
  const [macros,   setMacros]   = useState(() => initialFilters?.macros   ?? DEFAULT_MACROS)
  const [dietTags, setDietTags] = useState(() => initialFilters?.dietTags ?? { plantBased: false, glutenFree: false, diabetesFriendly: false })

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
    setOpenSection(prev => prev === key ? prev : key)
  }

  function computeMacros(mealTimeVal, dietVal) {
    const mealPreset = mealTimeVal ? MEAL_PRESETS[mealTimeVal] : DEFAULT_MACROS
    const dietPreset = dietVal && DIET_PRESETS[dietVal] ? DIET_PRESETS[dietVal] : null
    return dietPreset ?? mealPreset
  }

  function selectMealTime(t) {
    const next = mealTime === t ? null : t
    setMealTime(next)
    // Auto-select High Protein when choosing a meal time (if no diet set yet)
    if (next && !diet) {
      setDiet('high_protein')
      setMacros(computeMacros(next, 'high_protein'))
    } else {
      setMacros(computeMacros(next, diet))
    }
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
    const defaultMeal = getTimedMealTime()
    setMealTime(defaultMeal)
    setDiet('high_protein')
    setMacros(computeMacros(defaultMeal, 'high_protein'))
    setDietTags({ plantBased: false, glutenFree: false, diabetesFriendly: false })
  }

  function handleApply() {
    onApply?.({ mealTime, diet, macros, dietTags })
    onClose()
  }

  if (!isVisible) return null

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.overlay}>

      {/* Backdrop — click to dismiss */}
      <div
        className={`${styles.backdrop} ${isExpanded ? styles.backdropVisible : ''}`}
        onClick={onClose}
      />

      {/* Cards stack */}
      <div className={`${styles.panelWrap} ${isExpanded ? styles.panelWrapVisible : ''}`}>

        {/* ── Card 1: Meal Time — morphs from pill ───────────────────── */}
        <div className={`${styles.cardMain} ${isExpanded ? styles.cardMainExpanded : ''}`}>
          <button
            type="button"
            className={styles.cardHeader}
            onClick={() => toggleSection('mealtime')}
          >
            <span className={styles.cardTitle}>Meal Time</span>
          </button>

          <div className={`${styles.body} ${openSection === 'mealtime' ? styles.bodyOpen : ''}`}>
            <div className={styles.bodyInner}>
              <div className={styles.bodyContent}>
                <div className={styles.pillRow}>
                  {MEAL_TIMES.map(({ key, label, icon }) => (
                    <PillTab key={key} label={label} icon={icon} selected={mealTime === key} onClick={() => selectMealTime(key)} />
                  ))}
                </div>
                <div className={styles.divider} />
                <div className={styles.pillRow}>
                  {DIET_TYPES.map(({ key, label }) => (
                    <PillTab key={key} label={label} selected={diet === key} onClick={() => selectDiet(key)} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Card 2: Adjust macros ──────────────────────────────────── */}
        <div
          className={`${styles.card} ${isExpanded ? styles.cardVisible : ''}`}
          style={{ transitionDelay: isExpanded ? '0.1s' : '0s' }}
        >
          <button
            type="button"
            className={styles.cardHeader}
            onClick={() => toggleSection('macros')}
          >
            <span className={styles.cardTitle}>Adjust macros</span>
          </button>

          <div className={`${styles.body} ${openSection === 'macros' ? styles.bodyOpen : ''}`}>
            <div className={styles.bodyInner}>
              <div className={styles.bodyContent}>
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
                <div className={styles.pillRow}>
                  <PillTab label="Plant-based"       icon="/icons/Accordion/Pill/plant-based.svg" selected={dietTags.plantBased}        onClick={() => toggleDietTag('plantBased')} />
                  <PillTab label="Gluten-free"        icon="/icons/Accordion/Pill/gluten-free.svg"  selected={dietTags.glutenFree}         onClick={() => toggleDietTag('glutenFree')} />
                  <PillTab label="Diabetes friendly"  icon="/icons/Accordion/Pill/diabetes.svg"     selected={dietTags.diabetesFriendly}   onClick={() => toggleDietTag('diabetesFriendly')} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Card 3: Profile ───────────────────────────────────────── */}
        <div
          className={`${styles.card} ${isExpanded ? styles.cardVisible : ''}`}
          style={{ transitionDelay: isExpanded ? '0.18s' : '0s' }}
        >
          <button
            type="button"
            className={styles.cardHeader}
            onClick={() => toggleSection('profile')}
          >
            <span className={styles.cardTitle}>Profile</span>
          </button>

          <div className={`${styles.body} ${openSection === 'profile' ? styles.bodyOpen : ''}`}>
            <div className={styles.bodyInner}>
              <div className={styles.bodyContent}>
              <div className={styles.profileRow}>
                <div className={styles.avatar}>M</div>
                <div className={styles.profileInfo}>
                  <span className={styles.profileName}>Male, 38</span>
                  <span className={styles.profileGoal}>Goal: Muscle gain</span>
                </div>
                <button type="button" className={styles.editBtn}>✎ Edit Profile</button>
              </div>

              <div className={styles.dietSection}>
                <span className={styles.dietLabel}>Your diet</span>
                <div className={styles.dietCells}>
                  {[
                    { value: '2500', unit: 'Kcal'    },
                    { value: '156g', unit: 'Protein' },
                    { value: '83g',  unit: 'Fat'     },
                    { value: '281g', unit: 'Carbs'   },
                  ].map(({ value, unit }) => (
                    <div
                      key={unit}
                      className={styles.dietCell}
                      style={{ background: DIET_CELL_BG[unit] }}
                    >
                      <span className={styles.dietCellValue}>{value}</span>
                      <span className={styles.dietCellUnit}>{unit}</span>
                    </div>
                  ))}
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Reset + Apply ─────────────────────────────────────────── */}
        <div
          className={`${styles.actions} ${isExpanded ? styles.actionsVisible : ''}`}
          style={{ transitionDelay: isExpanded ? '0.25s' : '0s' }}
        >
          <ButtonFilterActions onReset={handleReset} onApply={handleApply} />
        </div>

      </div>
    </div>
  )
}
