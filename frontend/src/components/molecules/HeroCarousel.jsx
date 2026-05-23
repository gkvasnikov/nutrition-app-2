import { useState, useEffect, useRef, useCallback } from 'react'
import styles from './HeroCarousel.module.css'

const COUNT = 3
const AUTO_MS = 3000

export default function HeroCarousel() {
  const [active, setActive] = useState(0)
  const timerRef   = useRef(null)
  const startXRef  = useRef(0)
  const draggingRef = useRef(false)

  const goTo = useCallback((idx) => {
    setActive(((idx % COUNT) + COUNT) % COUNT)
  }, [])

  // Auto-advance
  function startTimer() {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setActive(i => (i + 1) % COUNT), AUTO_MS)
  }

  useEffect(() => {
    startTimer()
    return () => clearInterval(timerRef.current)
  }, []) // eslint-disable-line

  // Touch swipe
  function onTouchStart(e) {
    startXRef.current  = e.touches[0].clientX
    draggingRef.current = true
  }

  function onTouchEnd(e) {
    if (!draggingRef.current) return
    draggingRef.current = false
    const dx = e.changedTouches[0].clientX - startXRef.current
    if (Math.abs(dx) < 30) return
    goTo(active + (dx < 0 ? 1 : -1))
    startTimer() // reset auto-advance after manual swipe
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
          style={{ transform: `translateX(${-active * 100}%)` }}
        >
          {Array.from({ length: COUNT }).map((_, i) => (
            <div key={i} className={styles.card} />
          ))}
        </div>
      </div>

      <div className={styles.dots}>
        {Array.from({ length: COUNT }).map((_, i) => (
          <span
            key={i}
            className={`${styles.dot} ${i === active ? styles.dotActive : ''}`}
          />
        ))}
      </div>
    </div>
  )
}
