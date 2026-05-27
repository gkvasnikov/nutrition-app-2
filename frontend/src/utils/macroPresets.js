export const MACRO_PRESETS = {
  high_protein: {
    breakfast: { kcal: [550,  750], protein: [45, 65], fat: [15, 25], carbs: [45,  65] },
    lunch:     { kcal: [650,  950], protein: [55, 80], fat: [20, 35], carbs: [50,  75] },
    dinner:    { kcal: [550,  850], protein: [50, 75], fat: [20, 35], carbs: [35,  60] },
    snack:     { kcal: [150,  300], protein: [20, 35], fat: [5,  12], carbs: [10,  25] },
  },
  high_carb: {
    breakfast: { kcal: [550,  800], protein: [25, 40], fat: [10, 20], carbs: [75,  110] },
    lunch:     { kcal: [700, 1000], protein: [30, 50], fat: [15, 25], carbs: [100, 150] },
    dinner:    { kcal: [550,  800], protein: [25, 40], fat: [12, 22], carbs: [75,  110] },
    snack:     { kcal: [150,  300], protein: [5,  15], fat: [3,  10], carbs: [40,   60] },
  },
  balanced: {
    breakfast: { kcal: [500,  750], protein: [25, 40], fat: [15, 25], carbs: [55,  80] },
    lunch:     { kcal: [650,  900], protein: [35, 55], fat: [20, 30], carbs: [70, 100] },
    dinner:    { kcal: [550,  800], protein: [30, 50], fat: [18, 28], carbs: [60,  90] },
    snack:     { kcal: [150,  300], protein: [10, 20], fat: [5,  12], carbs: [25,  45] },
  },
  keto: {
    breakfast: { kcal: [500,  750], protein: [30, 50], fat: [35, 55], carbs: [3,  10] },
    lunch:     { kcal: [600,  900], protein: [35, 60], fat: [45, 70], carbs: [5,  15] },
    dinner:    { kcal: [500,  800], protein: [30, 55], fat: [40, 65], carbs: [5,  12] },
    snack:     { kcal: [100,  300], protein: [10, 25], fat: [15, 25], carbs: [1,   6] },
  },
}

export const DEFAULT_MACROS = { kcal: [0, 1800], protein: [0, 150], fat: [0, 100], carbs: [0, 200] }

export function getPreset(diet, mealTime) {
  if (!diet || diet === 'custom') return DEFAULT_MACROS
  const dietGroup = MACRO_PRESETS[diet]
  if (!dietGroup) return DEFAULT_MACROS
  return (mealTime && dietGroup[mealTime]) || DEFAULT_MACROS
}
