import { useState, useRef, useEffect } from 'react'
import styles from './HeroCarousel.module.css'

const COUNT = 3

export default function HeroCarousel() {
  const [activeIndex, setActiveIndex] = useState(0)
  const trackRef = useRef(null)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return

    let rafId
    function onScroll() {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const children = Array.from(el.children)
        const containerCenter = el.scrollLeft + el.offsetWidth / 2
        let closestIdx = 0
        let minDist = Infinity
        children.forEach((child, i) => {
          const childCenter = child.offsetLeft + child.offsetWidth / 2
          const dist = Math.abs(containerCenter - childCenter)
          if (dist < minDist) { minDist = dist; closestIdx = i }
        })
        setActiveIndex(closestIdx)
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <div className={styles.wrap}>
      <div ref={trackRef} className={styles.track}>
        {Array.from({ length: COUNT }).map((_, i) => (
          <div key={i} className={styles.card} />
        ))}
      </div>
      <div className={styles.dots}>
        {Array.from({ length: COUNT }).map((_, i) => (
          <span
            key={i}
            className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ''}`}
          />
        ))}
      </div>
    </div>
  )
}
