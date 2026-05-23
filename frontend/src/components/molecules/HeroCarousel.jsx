import { useState, useEffect, useRef } from 'react'
import styles from './HeroCarousel.module.css'

const COUNT   = 3
const AUTO_MS = 3000

// Extended order: [clone_last, real_0, real_1, real_2, clone_first]
// pos=1 → real_0, pos=2 → real_1, pos=3 → real_2
// pos=0 → clone_last (jumps to pos=COUNT after animation)
// pos=4 → clone_first (jumps to pos=1 after animation)

const SLIDE_INDICES = [COUNT - 1, 0, 1, 2, 0] // content index for each slot

export default function HeroCarousel() {
  const [pos, setPos]     = useState(1)
  const sliderRef         = useRef(null)
  const timerRef          = useRef(null)
  const touchStartX       = useRef(0)
  const jumping           = useRef(false)

  const dotIndex = pos === 0 ? COUNT - 1
                 : pos === COUNT + 1 ? 0
                 : pos - 1

  // ── disable / re-enable transition via DOM ref ──────────
  function disableTransition() {
    if (sliderRef.current) sliderRef.current.style.transition = 'none'
  }
  function enableTransition() {
    // double rAF ensures the browser commits the no-transition frame first
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (sliderRef.current) sliderRef.current.style.transition = ''
      jumping.current = false
    }))
  }

  // ── navigation ───────────────────────────────────────────
  function moveTo(newPos) {
    if (jumping.current) return
    setPos(newPos)
  }

  function advance() { moveTo(pos + 1) }  // captured at call time via closure
  function retreat() { moveTo(pos - 1) }

  // ── auto-advance ─────────────────────────────────────────
  function startTimer() {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      if (!jumping.current) setPos(p => p + 1)
    }, AUTO_MS)
  }

  useEffect(() => {
    startTimer()
    return () => clearInterval(timerRef.current)
  }, []) // eslint-disable-line

  // ── clone jump: after animation lands on a clone → instant jump to real ──
  useEffect(() => {
    if (pos !== 0 && pos !== COUNT + 1) return
    jumping.current = true
    const realPos = pos === 0 ? COUNT : 1
    const t = setTimeout(() => {
      disableTransition()
      setPos(realPos)
      enableTransition()
    }, 420) // just after 0.4s transition ends
    return () => clearTimeout(t)
  }, [pos]) // eslint-disable-line

  // ── swipe ────────────────────────────────────────────────
  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX }
  function onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) < 30) return
    if (dx < 0) advance(); else retreat()
    startTimer()
  }

  return (
    <div className={styles.wrap}>
      <div
        className={styles.track}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          ref={sliderRef}
          className={styles.slider}
          style={{ transform: `translateX(${-pos * 100}%)` }}
        >
          {SLIDE_INDICES.map((slideIdx, slot) => (
            <div key={slot} className={styles.card}>
              <span className={styles.cardNum}>{slideIdx + 1}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.dots}>
        {Array.from({ length: COUNT }).map((_, i) => (
          <span
            key={i}
            className={`${styles.dot} ${i === dotIndex ? styles.dotActive : ''}`}
          />
        ))}
      </div>
    </div>
  )
}
