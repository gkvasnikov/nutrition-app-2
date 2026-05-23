import { Fragment } from 'react'
import TopBar from '../components/molecules/TopBar'
import MainNavigation from '../components/molecules/MainNavigation'
import CardMeal from '../components/molecules/CardMeal'
import CardRestaurant from '../components/molecules/CardRestaurant'
import ButtonSeeAll from '../components/atoms/ButtonSeeAll'
import { FavouriteIcon } from '../components/atoms/icons'
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
    photo: '/meals/schnitzel-bowl.avif',
    name: 'Schnitzel Bowl',
    price: '€16.00',
    description: 'Doppelte Schnitzel mit paniertem Hähnchenbrustfilet und eine Auswahl mit Beilagen',
    calories: 680, protein: 24, fat: 24, carbs: 38.5,
    restaurantName: 'Green & Protein',
    priceRange: '€10–20', distance: '5m', rating: 4.6, reviewCount: 874,
  },
  {
    id: 3,
    photo: '/meals/halbes-hahnchen.avif',
    name: 'Halbes Hähnchen',
    price: '€12.00',
    description: 'mit Auberginen, veganem Hackfleisch, Wencheng-Soße, Knoblauch, Chili',
    calories: 420, protein: 12.5, fat: 18.5, carbs: 52,
    restaurantName: 'Wen Cheng Görlitzer',
    priceRange: '€10–20', distance: '30m', rating: 4.7, reviewCount: 852,
  },
]

const FAV_RESTAURANTS = [
  {
    id: 1,
    name: "Martin's Crêperie",
    photo: '/restaurants/2025-12-04.png',
    rating: 4.3,
    reviewCount: 1513,
    address: 'Eisenbahnstraße 42–43, 10997 Berlin',
    priceRange: '€10–20',
    isOpen: true,
    hours: '12:00–18:00',
    distance: '30m',
  },
  {
    id: 2,
    name: 'Green & Protein',
    photo: '/restaurants/aron-marinelli-k8P2074WvzM-unsplash.jpg',
    rating: 4.6,
    reviewCount: 874,
    address: 'Skalitzer Str. 104, 10997 Berlin',
    priceRange: '€10–20',
    isOpen: false,
    hours: '11:00–22:00',
    distance: '5m',
  },
  {
    id: 3,
    name: 'Five Elephant',
    photo: '/restaurants/2025-09-08.jpg',
    rating: 4.7,
    reviewCount: 3210,
    address: 'Reichenberger Str. 101, 10999 Berlin',
    priceRange: '€5–10',
    isOpen: true,
    hours: '08:00–18:00',
    distance: '8m',
  },
]

export default function Favourites({ activeTab, onTabChange }) {
  return (
    <div className={styles.screen}>
      <TopBar
        title="Favourites"
        icon={<FavouriteIcon size={24} />}
      />

      <div className={styles.content}>

        {/* Meals section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Meals</h2>
            <ButtonSeeAll />
          </div>
          <div className={styles.mealList}>
            {FAV_MEALS.map((meal, i) => (
              <Fragment key={meal.id}>
                {i > 0 && <div className={styles.separator} />}
                <CardMeal {...meal} />
              </Fragment>
            ))}
          </div>
        </div>

        {/* Restaurants section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Restaurants</h2>
            <ButtonSeeAll />
          </div>
          <div className={styles.scrollRow}>
            {FAV_RESTAURANTS.map(r => (
              <CardRestaurant key={r.id} {...r} />
            ))}
          </div>
        </div>

      </div>

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={onTabChange} />
    </div>
  )
}
