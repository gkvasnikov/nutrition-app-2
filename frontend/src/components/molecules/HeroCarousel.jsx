import styles from './HeroCarousel.module.css'

export default function HeroCarousel({ slides = [], activeIndex = 0 }) {
  const count = Math.max(slides.length, 6)

  return (
    <div className={styles.wrap}>
      <div className={styles.frame}>
        {slides.length > 0
          ? <img src={slides[activeIndex]} alt="" className={styles.img} />
          : null}
      </div>
      <div className={styles.dots}>
        {Array.from({ length: count }).map((_, i) => (
          <span key={i} className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ''}`} />
        ))}
      </div>
    </div>
  )
}
