// Helpers for deriving TopBar pill content from main filter state

const MEAL_TIME_LABELS = {
  breakfast: 'Breakfast',
  lunch:     'Lunch',
  dinner:    'Dinner',
  snack:     'Snack',
}

const MEAL_TIME_ICONS = {
  breakfast: '/icons/Breakfast.svg',
  lunch:     '/icons/Lunch.svg',
  dinner:    '/icons/Dinner.svg',
  snack:     '/icons/Snack.svg',
}

const DIET_LABELS = {
  high_protein: 'High Protein',
  high_carb:    'High Carb',
  balanced:     'Balanced',
  keto:         'Keto',
  custom:       'Custom',
}

/** Meal time based on current hour (Snack is never auto-selected by time) */
export function getTimedMealTime() {
  const h = new Date().getHours()
  if (h >= 5  && h < 11) return 'breakfast'
  if (h >= 11 && h < 16) return 'lunch'
  if (h >= 16 && h < 23) return 'dinner'
  return 'breakfast' // very late / early morning → next breakfast
}

/** TopBar pill title: selected meal time, or time-based default (never "Meal Time") */
export function buildPillTitle(filters) {
  return MEAL_TIME_LABELS[filters?.mealTime] ?? MEAL_TIME_LABELS[getTimedMealTime()]
}

/** TopBar pill icon: meal-time SVG <img>, always shown (falls back to time-based) */
export function buildPillIcon(filters) {
  const key = filters?.mealTime ?? getTimedMealTime()
  const src = MEAL_TIME_ICONS[key]
  if (!src) return null
  return <img src={src} width={32} height={32} alt={MEAL_TIME_LABELS[key]} />
}

/** TopBar pill subtitle: selected diet label, or null */
export function buildPillSubtitle(filters) {
  return DIET_LABELS[filters?.diet] ?? null
}
