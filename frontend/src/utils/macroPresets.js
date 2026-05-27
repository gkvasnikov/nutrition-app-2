export const MACRO_PRESETS = {
  high_protein: {
    breakfast: { kcal: [495,  825], protein: [40, 72], fat: [14, 28], carbs: [40,  72] },
    lunch:     { kcal: [585, 1045], protein: [40, 88], fat: [18, 39], carbs: [45,  83] },
    dinner:    { kcal: [495,  935], protein: [40, 83], fat: [18, 39], carbs: [32,  66] },
    snack:     { kcal: [135,  330], protein: [18, 39], fat: [5,  13], carbs: [9,   28] },
  },
  high_carb: {
    breakfast: { kcal: [495,  880], protein: [23, 44], fat: [9,  22], carbs: [68,  121] },
    lunch:     { kcal: [630, 1100], protein: [27, 55], fat: [14, 28], carbs: [90,  165] },
    dinner:    { kcal: [495,  880], protein: [23, 44], fat: [11, 24], carbs: [68,  121] },
    snack:     { kcal: [135,  330], protein: [5,  17], fat: [3,  11], carbs: [36,   66] },
  },
  balanced: {
    breakfast: { kcal: [450,  825], protein: [23, 44], fat: [14, 28], carbs: [50,  88] },
    lunch:     { kcal: [585,  990], protein: [32, 61], fat: [18, 33], carbs: [63, 110] },
    dinner:    { kcal: [495,  880], protein: [27, 55], fat: [16, 31], carbs: [54,  99] },
    snack:     { kcal: [135,  330], protein: [9,  22], fat: [5,  13], carbs: [23,  50] },
  },
  keto: {
    breakfast: { kcal: [450,  825], protein: [27, 55], fat: [32, 61], carbs: [3,  11] },
    lunch:     { kcal: [540,  990], protein: [32, 66], fat: [41, 77], carbs: [5,  17] },
    dinner:    { kcal: [450,  880], protein: [27, 61], fat: [36, 72], carbs: [5,  13] },
    snack:     { kcal: [90,   330], protein: [9,  28], fat: [14, 28], carbs: [1,   7] },
  },
}

export const DEFAULT_MACROS = { kcal: [0, 1800], protein: [0, 150], fat: [0, 100], carbs: [0, 200] }

export function getPreset(diet, mealTime) {
  if (!diet || diet === 'custom') return DEFAULT_MACROS
  const dietGroup = MACRO_PRESETS[diet]
  if (!dietGroup) return DEFAULT_MACROS
  return (mealTime && dietGroup[mealTime]) || DEFAULT_MACROS
}
