import { Fragment } from 'react'
import MainNavigation from '../components/molecules/MainNavigation'
import CardMeal from '../components/molecules/CardMeal'
import styles from './Favourites.module.css'

const FAV_MEALS = [
  {
    id: 1,
    photo: '/meals/bowl-pollo-asado.avif',
    name: 'Bowl Pollo Asado',
    price: '€6.00',
    description: 'Gurke, Knoblauch, Essig, Sojasauce, Sichuan-Pfeffer, Sesam und Chiliöl',
    calories: 85, protein: 2.5, fat: 6, carbs: 7,
    restaurantName: 'Wen Cheng Görlitzer',
    priceRange: '€10–20', distance: '30m', rating: 4.7, reviewCount: 852,
  },
  {
    id: 2,
    photo: '/meals/karisik-izgara.avif',
    name: 'Karisik Izgara',
    price: '€29.90',
    description: 'gemischte Grillplatte (Köfte, Lammkotelett, Lammrippchen, Lammspieß und',
    calories: 520, protein: 28.5, fat: 18, carbs: 62,
    restaurantName: 'Wen Cheng Görlitzer',
    priceRange: '€10–20', distance: '30m', rating: 4.7, reviewCount: 852,
  },
  {
    id: 3,
    photo: '/meals/halbes-hahnchen.avif',
    name: 'Halbes Hähnchen',
    price: '€12.00',
    description: 'mit Auberginen, veganem Hackfleisch, Wencheng-Soße, Knoblauch, Chili,',
    calories: 420, protein: 12.5, fat: 18.5, carbs: 52,
    restaurantName: 'Wen Cheng Görlitzer',
    priceRange: '€10–20', distance: '30m', rating: 4.7, reviewCount: 852,
  },
]

export default function Favourites({ activeTab, onTabChange }) {
  return (
    <div className={styles.screen}>
      <div className={styles.titleBar}>
        <span className={styles.title}>Favourites</span>
      </div>

      <div className={styles.content}>
        {FAV_MEALS.map((meal, i) => (
          <Fragment key={meal.id}>
            {i > 0 && <div className={styles.separator} />}
            <CardMeal {...meal} />
          </Fragment>
        ))}
      </div>

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
