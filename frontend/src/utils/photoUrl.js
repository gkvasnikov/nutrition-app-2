const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// Append the API key to Google Places photo URLs.
// URLs for other sources (Wolt CDN, data URIs) are returned unchanged.
export function withKey(url) {
  if (!url || !url.includes('maps.googleapis.com')) return url
  return `${url}&key=${KEY}`
}
