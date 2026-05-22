import { useState } from 'react'
import TopBar from '../components/molecules/TopBar'
import MainNavigation from '../components/molecules/MainNavigation'
import CardRestaurant from '../components/molecules/CardRestaurant'
import HeroCarousel from '../components/molecules/HeroCarousel'
import ButtonSeeAll from '../components/atoms/ButtonSeeAll'
import styles from './Home.module.css'

const SECTIONS = [
  {
    id: 'macros',
    title: 'Official macros',
    restaurants: [
      {
        id: 1,
        name: "Martin's Crêperie",
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
        name: 'Mani in Pasta (Markthalle)',
        rating: 4.5,
        reviewCount: 2963,
        address: 'Eisenbahnstraße 42–43, 10997 Berlin',
        priceRange: '€10–20',
        isOpen: true,
        hours: '12:00–18:00',
        distance: '30m',
      },
      {
        id: 3,
        name: 'Green & Protein',
        rating: 4.6,
        reviewCount: 874,
        address: 'Skalitzer Str. 104, 10997 Berlin',
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
        rating: 4.3,
        reviewCount: 1513,
        address: 'Skalitzer Str. 97, 10997 Berlin',
        priceRange: '€10–20',
        isOpen: true,
        hours: '12:00–18:00',
        distance: '30m',
      },
      {
        id: 5,
        name: 'Cafe Frida',
        rating: 4.5,
        reviewCount: 2963,
        address: 'Schlesische Str. 28, 10997 Berlin',
        priceRange: '€10–20',
        isOpen: true,
        hours: '10:00–20:00',
        distance: '12m',
      },
      {
        id: 6,
        name: 'Five Elephant',
        rating: 4.7,
        reviewCount: 3210,
        address: 'Reichenberger Str. 101, 10999 Berlin',
        priceRange: '€5–10',
        isOpen: true,
        hours: '08:00–18:00',
        distance: '8m',
      },
    ],
  },
]

export default function Home() {
  const [activeTab, setActiveTab] = useState('home')

  return (
    <div className={styles.screen}>
      <TopBar title="Meal Time" />

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
                <CardRestaurant key={r.id} {...r} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.gradient} />
      <MainNavigation active={activeTab} onChange={setActiveTab} />
    </div>
  )
}
