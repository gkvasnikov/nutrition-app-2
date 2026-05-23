import { Fragment } from 'react'
import MainNavigation from '../components/molecules/MainNavigation'
import CardMeal from '../components/molecules/CardMeal'
import { MOCK_MEALS } from '../data/mockMeals'
import styles from './Favourites.module.css'

const FAV_MEALS = MOCK_MEALS.slice(0, 3)

export default function Favourites({ activeTab, onTabChange, onMealSelect }) {
  return (
    <div className={styles.screen}>
      <div className={styles.titleBar}>
        <span className={styles.title}>Favourites</span>
      </div>

      <div className={styles.content}>
        {FAV_MEALS.map((meal, i) => (
          <Fragment key={meal.id}>
            {i > 0 && <div className={styles.separator} />}
            <CardMeal {...meal} onClick={() => onMealSelect?.(meal)} />
          </Fragment>
        ))}
      </div>

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
