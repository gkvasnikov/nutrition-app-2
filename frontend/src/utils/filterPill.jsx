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

/** TopBar pill title: selected meal time, or default "Meal Time" */
export function buildPillTitle(filters) {
  return MEAL_TIME_LABELS[filters?.mealTime] ?? 'Meal Time'
}

/** TopBar pill icon: meal-time SVG <img>, or null (TopBar shows SearchIcon) */
export function buildPillIcon(filters) {
  const src = MEAL_TIME_ICONS[filters?.mealTime]
  if (!src) return null
  return <img src={src} width={32} height={32} alt={MEAL_TIME_LABELS[filters.mealTime]} />
}

/** TopBar pill subtitle: selected diet label, or null */
export function buildPillSubtitle(filters) {
  return DIET_LABELS[filters?.diet] ?? null
}
