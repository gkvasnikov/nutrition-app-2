import { useState, useEffect, useRef } from 'react'
import PillTab from '../atoms/PillTab'
import ButtonFilterActions from './ButtonFilterActions'
import { getTimedMealTime } from '../../utils/filterPill'
import { MACRO_PRESETS, DEFAULT_MACROS, getPreset } from '../../utils/macroPresets'
import styles from './MealFilterOverlay.module.css'

const SLIDER_CONFIG = [
  { key: 'kcal',    label: 'Kcal',    min: 0, max: 1800, step: 10 },
  { key: 'protein', label: 'Protein', min: 0, max: 150,  step: 5  },
  { key: 'fat',     label: 'Fat',     min: 0, max: 100,  step: 5  },
  { key: 'carbs',   label: 'Carbs',   min: 0, max: 200,  step: 5  },
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

function RangeSlider({ label, min, max, step = 1, value, onChange }) {
  const loInputRef  = useRef(null)
  const hiInputRef  = useRef(null)
  const fillRef     = useRef(null)
  const labelRef    = useRef(null)
  const dragging    = useRef(false)
  const rafRef      = useRef(null)
  const dispRef     = useRef([value[0], value[1]])

  // Direct DOM update — no React re-render, no jank
  function paint(lo, hi) {
    const loP = ((lo - min) / (max - min)) * 100
    const hiP = ((hi - min) / (max - min)) * 100
    if (loInputRef.current)  loInputRef.current.value            = lo
    if (hiInputRef.current)  hiInputRef.current.value            = hi
    if (fillRef.current) {
      fillRef.current.style.left  = `${loP}%`
      fillRef.current.style.right = `${100 - hiP}%`
    }
    if (labelRef.current)    labelRef.current.textContent = `from ${lo} to ${hi}`
  }

  useEffect(() => {
    const [targetLo, targetHi] = value
    if (dragging.current) {
      dispRef.current = [targetLo, targetHi]
      paint(targetLo, targetHi)
      return
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const [fLo, fHi] = dispRef.current
    const t0  = performance.now()
    const dur = 380
    const tick = (t) => {
      const p   = Math.min((t - t0) / dur, 1)
      const e   = 1 - (1 - p) ** 3
      const cLo = Math.round(fLo + (targetLo - fLo) * e)
      const cHi = Math.round(fHi + (targetHi - fHi) * e)
      dispRef.current = [cLo, cHi]
      paint(cLo, cHi)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value[0], value[1]]) // eslint-disable-line

  // Use dispRef for JSX so fill never snaps on re-render — animation drives DOM directly
  const [curLo, curHi] = dispRef.current
  const curLoP = ((curLo - min) / (max - min)) * 100
  const curHiP = ((curHi - min) / (max - min)) * 100

  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <div className={styles.sliderRight}>
        <span ref={labelRef} className={styles.sliderValue}>from {curLo} to {curHi}</span>
        <div className={styles.sliderTrack}>
          <div
            ref={fillRef}
            className={styles.sliderFill}
            style={{ left: `${curLoP}%`, right: `${100 - curHiP}%` }}
          />
          <input
            ref={loInputRef}
            type="range"
            className={styles.sliderInput}
            min={min} max={max} step={step}
            defaultValue={curLo}
            onPointerDown={() => { dragging.current = true }}
            onPointerUp={()   => { dragging.current = false }}
            onChange={e => onChange([Math.min(Number(e.target.value), dispRef.current[1] - step), dispRef.current[1]])}
          />
          <input
            ref={hiInputRef}
            type="range"
            className={styles.sliderInput}
            min={min} max={max} step={step}
            defaultValue={curHi}
            onPointerDown={() => { dragging.current = true }}
            onPointerUp={()   => { dragging.current = false }}
            onChange={e => onChange([dispRef.current[0], Math.max(Number(e.target.value), dispRef.current[0] + step)])}
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
    return getPreset(dietVal, mealTimeVal)
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
    // Custom = keep current slider values unchanged
    if (next !== 'custom') {
      setMacros(computeMacros(mealTime, next))
    }
  }

  function toggleDietTag(key) {
    setDietTags(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function handleReset() {
    setMealTime(getTimedMealTime())
    setDiet('custom')
    setMacros(DEFAULT_MACROS)
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
          <div className={styles.cardHeader}>
            <button
              type="button"
              className={styles.cardHeaderBtn}
              onClick={() => toggleSection('mealtime')}
            >
              <span className={styles.cardTitle}>Meal Time</span>
            </button>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close filters"
            >
              <img src="/icons/Close filters.svg" width={24} height={24} alt="" />
            </button>
          </div>

          <div className={`${styles.body} ${openSection === 'mealtime' ? styles.bodyOpen : ''}`}>
            <div className={styles.bodyInner}>
              <div className={styles.bodyContent}>
                <div className={styles.pillScrollWrap}>
                  <div className={styles.pillRowScroll}>
                    {MEAL_TIMES.map(({ key, label, icon }) => (
                      <PillTab key={key} label={label} icon={icon} selected={mealTime === key} onClick={() => selectMealTime(key)} />
                    ))}
                  </div>
                </div>
                <div className={styles.divider} />
                <div className={styles.pillRow}>
                  {DIET_TYPES.map(({ key, label }) => (
                    <PillTab key={key} label={label} selected={diet === key} onClick={() => selectDiet(key)} />
                  ))}
                </div>
                <div className={styles.divider} />
                {SLIDER_CONFIG.map(cfg => (
                  <RangeSlider
                    key={cfg.key}
                    label={cfg.label}
                    min={cfg.min}
                    max={cfg.max}
                    step={cfg.step}
                    value={macros[cfg.key]}
                    onChange={v => {
                      setMacros(prev => ({ ...prev, [cfg.key]: v }))
                      if (diet !== 'custom') setDiet('custom')
                    }}
                  />
                ))}
                <div className={styles.divider} />
                <div className={styles.pillRow}>
                  <PillTab label="Plant-based"       icon="/icons/plant-based.svg" selected={dietTags.plantBased}        onClick={() => toggleDietTag('plantBased')} />
                  <PillTab label="Gluten-free"        icon="/icons/gluten-free.svg"  selected={dietTags.glutenFree}         onClick={() => toggleDietTag('glutenFree')} />
                  <PillTab label="Diabetes friendly"  icon="/icons/diabetes.svg"     selected={dietTags.diabetesFriendly}   onClick={() => toggleDietTag('diabetesFriendly')} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Card 2: Profile ─────────────────────────── (hidden) ─── */}
        {false && <div
          className={`${styles.card} ${isExpanded ? styles.cardVisible : ''}`}
          style={{ transitionDelay: isExpanded ? '0.1s' : '0s' }}
        >
          <button
            type="button"
            className={styles.cardHeader}
            onClick={() => toggleSection('profile')}
          >
            <span className={styles.cardTitle}>Profile</span>
            <span className={styles.cardOptional}>Optional</span>
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
        </div>}

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
