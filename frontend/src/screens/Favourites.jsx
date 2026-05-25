import { Fragment } from 'react'
import MainNavigation from '../components/molecules/MainNavigation'
import CardMeal from '../components/molecules/CardMeal'
import styles from './Favourites.module.css'

export default function Favourites({ activeTab, onTabChange, onMealSelect, favourites = [] }) {
  return (
    <div className={styles.screen}>
      <div className={styles.titleBar}>
        <span className={styles.title}>Favourites</span>
      </div>

      <div className={styles.content}>
        {favourites.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>🤍</span>
            <p className={styles.emptyTitle}>No favourites saved yet</p>
            <p className={styles.emptySubtitle}>Tap the heart on any meal to save it here</p>
          </div>
        ) : (
          favourites.map((meal, i) => (
            <Fragment key={meal.id}>
              {i > 0 && <div className={styles.separator} />}
              <CardMeal {...meal} onClick={() => onMealSelect?.(meal)} />
            </Fragment>
          ))
        )}
      </div>

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
