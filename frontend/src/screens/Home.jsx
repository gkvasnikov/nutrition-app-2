import { useState } from 'react'
import TopBar from '../components/molecules/TopBar'
import MainNavigation from '../components/molecules/MainNavigation'
import CardRestaurant from '../components/molecules/CardRestaurant'
import HeroCarousel from '../components/molecules/HeroCarousel'
import ButtonSeeAll from '../components/atoms/ButtonSeeAll'
import MealFilterOverlay from '../components/molecules/MealFilterOverlay'
import styles from './Home.module.css'

const SECTIONS = [
  {
    id: 'macros',
    title: 'Official macros',
    restaurants: [
      {
        id: 1,
        name: "Martin's Crêperie",
        photo: '/restaurants/2025-12-04.png',
        rating: 4.3,
        reviewCount: 1513,
        address: 'Eisenbahnstraße 42–43, 10997 Berlin, Deutschland',
        priceRange: '€10–20',
        isOpen: true,
        hours: '12:00–18:00',
        distance: '30m',
      },
      {
        id: 2,
        name: 'Mani in Pasta (Markthalle)',
        photo: '/restaurants/2020-11-07.jpg',
        rating: 4.5,
        reviewCount: 2963,
        address: 'Eisenbahnstraße 42–43, 10997 Berlin, Deutschland',
        priceRange: '€10–20',
        isOpen: true,
        hours: '12:00–18:00',
        distance: '30m',
      },
      {
        id: 3,
        name: 'Green & Protein',
        photo: '/restaurants/aron-marinelli-k8P2074WvzM-unsplash.jpg',
        rating: 4.6,
        reviewCount: 874,
        address: 'Skalitzer Str. 104, 10997 Berlin, Deutschland',
        priceRange: '€10–20',
        isOpen: false,
        hours: '11:00–22:00',
        distance: '5m',
      },
    ],
  },
  {
    id: 'cafes',
    title: 'Cafes',
    restaurants: [
      {
        id: 4,
        name: 'Classic San Sebastian Kreuzberg',
        photo: '/restaurants/unnamed (1).jpg',
        rating: 4.3,
        reviewCount: 1513,
        address: 'Skalitzer Str. 97, 10997 Berlin, Deutschland',
        priceRange: '€10–20',
        isOpen: true,
        hours: '12:00–18:00',
        distance: '30m',
      },
      {
        id: 5,
        name: 'Cafe Frida',
        photo: '/restaurants/2024-08-06.jpg',
        rating: 4.5,
        reviewCount: 2963,
        address: 'Schlesische Str. 28, 10997 Berlin, Deutschland',
        priceRange: '€10–20',
        isOpen: true,
        hours: '10:00–20:00',
        distance: '12m',
      },
      {
        id: 6,
        name: 'Five Elephant',
        photo: '/restaurants/2025-09-08.jpg',
        rating: 4.7,
        reviewCount: 3210,
        address: 'Reichenberger Str. 101, 10999 Berlin, Deutschland',
        priceRange: '€5–10',
        isOpen: true,
        hours: '08:00–18:00',
        distance: '8m',
      },
    ],
  },
]

function buildSubtitle(filters) {
  if (!filters) return null
  const parts = []
  if (filters.mealTime) {
    parts.push(filters.mealTime.charAt(0).toUpperCase() + filters.mealTime.slice(1))
  }
  if (filters.diet) {
    const labels = {
      high_protein: 'High Protein',
      high_carb:    'High Carb',
      balanced:     'Balanced',
      keto:         'Keto',
      custom:       'Custom',
    }
    parts.push(labels[filters.diet] ?? filters.diet)
  }
  return parts.length ? parts.join(' · ') : null
}

export default function Home({ activeTab = 'home', onTabChange, onRestaurantSelect }) {
  const [showMealFilter, setShowMealFilter]   = useState(false)
  const [activeFilters,  setActiveFilters]    = useState(null)

  function handleApplyFilters(filters) {
    setActiveFilters(filters)
  }

  const subtitle = buildSubtitle(activeFilters)

  return (
    <div className={styles.screen}>
      <TopBar
        title="Meal Time"
        subtitle={subtitle}
        onPillClick={() => setShowMealFilter(true)}
      />

      <div className={styles.content}>
        <HeroCarousel />

        {SECTIONS.map(section => (
          <div key={section.id} className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
              <ButtonSeeAll />
            </div>
            <div className={styles.scrollRow}>
              {section.restaurants.map(r => (
                <CardRestaurant
                  key={r.id}
                  {...r}
                  onClick={() => onRestaurantSelect?.({
                    name:        r.name,
                    photo:       r.photo,
                    address:     r.address,
                    priceRange:  r.priceRange,
                    distance:    r.distance,
                    rating:      r.rating,
                    reviewCount: r.reviewCount,
                  })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={onTabChange} />

      <MealFilterOverlay
        show={showMealFilter}
        onClose={() => setShowMealFilter(false)}
        onApply={handleApplyFilters}
      />
    </div>
  )
}
