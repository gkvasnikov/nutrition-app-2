const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// Append the API key to Google Places photo URLs.
// URLs for other sources (Wolt CDN, data URIs) are returned unchanged.
export function withKey(url) {
  if (!url || !url.includes('maps.googleapis.com')) return url
  return `${url}&key=${KEY}`
}

// Route any image URL through the server-side proxy so it gets cached in R2.
// Use for all Wolt CDN images (<img> tags, background images).
export function proxyImg(url) {
  if (!url) return url
  return `/api/image-proxy?url=${encodeURIComponent(url)}`
}
