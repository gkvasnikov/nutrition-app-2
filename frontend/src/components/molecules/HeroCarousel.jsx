import { useState, useEffect, useRef } from 'react'
import styles from './HeroCarousel.module.css'

const COUNT   = 3
const AUTO_MS = 3000

// Extended slide order: [clone_of_last, 0, 1, 2, clone_of_first]
// Positions 1..COUNT are the real slides; 0 and COUNT+1 are clones.
// dotIndex = pos - 1 (clamped to 0..COUNT-1)

export default function HeroCarousel() {
  const [pos, setPos]         = useState(1)      // start at first real slide
  const [animated, setAnimated] = useState(true)
  const timerRef    = useRef(null)
  const touchStartX = useRef(0)

  // dot to highlight — clones map to their real counterpart
  const dotIndex = pos === 0 ? COUNT - 1
                 : pos === COUNT + 1 ? 0
                 : pos - 1

  // ── auto-advance ────────────────────────────────────────
  function startTimer() {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setAnimated(true)
      setPos(p => p + 1)
    }, AUTO_MS)
  }

  useEffect(() => {
    startTimer()
    return () => clearInterval(timerRef.current)
  }, []) // eslint-disable-line

  // ── after clone animation → jump to real counterpart ───
  useEffect(() => {
    if (pos === 0) {
      // showed clone of last → jump to real last
      const t = setTimeout(() => { setAnimated(false); setPos(COUNT) }, 400)
      return () => clearTimeout(t)
    }
    if (pos === COUNT + 1) {
      // showed clone of first → jump to real first
      const t = setTimeout(() => { setAnimated(false); setPos(1) }, 400)
      return () => clearTimeout(t)
    }
  }, [pos])

  // ── swipe ────────────────────────────────────────────────
  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX }

  function onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) < 30) return
    setAnimated(true)
    setPos(p => p + (dx < 0 ? 1 : -1))
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
          className={styles.slider}
          style={{
            transform:  `translateX(${-pos * 100}%)`,
            transition: animated ? 'transform 0.4s cubic-bezier(0.32,0.72,0,1)' : 'none',
          }}
        >
          {/* Clone of last real card */}
          <div className={styles.card} />
          {/* Real cards 0..COUNT-1 */}
          {Array.from({ length: COUNT }).map((_, i) => (
            <div key={i} className={styles.card} />
          ))}
          {/* Clone of first real card */}
          <div className={styles.card} />
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
