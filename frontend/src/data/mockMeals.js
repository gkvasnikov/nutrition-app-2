// Restaurants (from Home screen)
const MARTIN = {
  restaurantName: "Martin's Crêperie",
  priceRange: '€10–20',
  distance: '30m',
  rating: 4.3,
  reviewCount: 1513,
  restaurantAddress: 'Eisenbahnstraße 42–43, 10997 Berlin',
  restaurantPhoto: '/restaurants/2025-12-04.png',
}

const MANI = {
  restaurantName: 'Mani in Pasta (Markthalle)',
  priceRange: '€10–20',
  distance: '120m',
  rating: 4.5,
  reviewCount: 2963,
  restaurantAddress: 'Eisenbahnstraße 42–43, 10997 Berlin',
  restaurantPhoto: '/restaurants/2020-11-07.jpg',
}

const CLASSIC = {
  restaurantName: 'Classic San Sebastian Kreuzberg',
  priceRange: '€10–20',
  distance: '80m',
  rating: 4.3,
  reviewCount: 1513,
  restaurantAddress: 'Skalitzer Str. 97, 10997 Berlin',
  restaurantPhoto: '/restaurants/unnamed (1).jpg',
}

const GREEN = {
  restaurantName: 'Green & Protein',
  priceRange: '€10–20',
  distance: '5m',
  rating: 4.6,
  reviewCount: 874,
  restaurantAddress: 'Skalitzer Str. 104, 10997 Berlin',
  restaurantPhoto: '/restaurants/aron-marinelli-k8P2074WvzM-unsplash.jpg',
}

export const MOCK_MEALS = [
  // Pin 1 — Martin's Crêperie
  {
    id: 1,
    photo: '/meals/bowl-pollo-asado.avif',
    name: 'Bowl Pollo Asado',
    price: '€6.00',
    description: 'Gurke, Knoblauch, Essig, Sojasauce, Sichuan-Pfeffer, Sesam und Chiliöl',
    calories: 85, protein: 2.5, fat: 6, carbs: 7,
    ...MARTIN,
  },

  // Pin 2 — Mani in Pasta
  {
    id: 2,
    photo: '/meals/karisik-izgara.avif',
    name: 'Karisik Izgara',
    price: '€29.90',
    description: 'gemischte Grillplatte (Köfte, Lammkotelett, Lammrippchen, Lammspieß)',
    calories: 520, protein: 28.5, fat: 18, carbs: 62,
    ...MANI,
  },

  // Pin 3 — Classic San Sebastian
  {
    id: 3,
    photo: '/meals/halbes-hahnchen.avif',
    name: 'Halbes Hähnchen',
    price: '€12.00',
    description: 'mit Auberginen, veganem Hackfleisch, Wencheng-Soße, Knoblauch, Chili',
    calories: 420, protein: 12.5, fat: 18.5, carbs: 52,
    ...CLASSIC,
  },

  // Pin 4 (group) — Green & Protein, 3 meals
  {
    id: 4,
    photo: '/meals/schnitzel-bowl.avif',
    name: 'Schnitzel Bowl',
    price: '€16.00',
    description: 'Doppelte Schnitzel mit paniertem Hähnchenbrustfilet und Beilagen nach Wahl',
    calories: 680, protein: 24, fat: 24, carbs: 38.5,
    ...GREEN,
  },
  {
    id: 5,
    photo: '/meals/bowl-pollo-asado.avif',
    name: 'Protein Bowl',
    price: '€13.50',
    description: 'Gegrilltes Hähnchenbrustfilet, Quinoa, Avocado, Cherry-Tomaten und Tahini-Dressing',
    calories: 480, protein: 38, fat: 14, carbs: 42,
    ...GREEN,
  },
  {
    id: 6,
    photo: '/meals/halbes-hahnchen.avif',
    name: 'Grüner Bowl',
    price: '€11.90',
    description: 'Spinat, Brokkoli, Edamame, Gurke, Sesam und Miso-Vinaigrette',
    calories: 310, protein: 18, fat: 9, carbs: 36,
    ...GREEN,
  },
]
