import { MOCK_RESTAURANTS } from './mockData'

/** O(1) lookup by restaurant id */
export const RESTAURANT_BY_ID = Object.fromEntries(
  MOCK_RESTAURANTS.map(r => [r.id, r])
)

/** O(1) lookup by restaurant name */
export const RESTAURANT_BY_NAME = Object.fromEntries(
  MOCK_RESTAURANTS.map(r => [r.name, r])
)
