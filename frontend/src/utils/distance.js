/**
 * Haversine distance between two lat/lng points, returns a human-readable string.
 * e.g. "380 m" or "1.2 km"
 */
export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Format a distance in metres to a short string.
 * < 1000 m → "380 m"
 * ≥ 1000 m → "1.2 km"
 */
export function formatDistance(metres) {
  if (metres == null || isNaN(metres)) return null
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(1)} km`
}

/**
 * Convenience: compute + format distance between user and a restaurant.
 * Returns null if any coordinate is missing.
 */
export function distanceTo(userLat, userLng, targetLat, targetLng) {
  if (userLat == null || userLng == null || targetLat == null || targetLng == null) return null
  return formatDistance(haversineM(userLat, userLng, targetLat, targetLng))
}

/**
 * Google Maps direction URL.
 * Uses walking mode for distances ≤ 1 km, driving mode above that.
 * Falls back to walking when user location is unavailable.
 */
export function mapsDirectionUrl(userLat, userLng, destLat, destLng) {
  const mode =
    userLat != null && userLng != null && destLat != null && destLng != null &&
    haversineM(userLat, userLng, destLat, destLng) <= 1000
      ? 'walking'
      : 'driving'
  return `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&travelmode=${mode}`
}
