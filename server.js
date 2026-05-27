import 'dotenv/config'
import express from 'express'
import compression from 'compression'
import { fileURLToPath } from 'url'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import pg from 'pg'

const app = express()
const PORT = process.env.PORT || 3001
const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.use(compression())   // gzip all responses — reduces JSON payload ~70%
app.use(express.json())
app.use(express.static(path.join(__dirname, 'frontend/dist')))

// ── PostgreSQL pool ───────────────────────────────────────────────────────────
// DATABASE_URL is set automatically by Railway when PostgreSQL addon is added.
// For local dev: add DATABASE_URL to .env
const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },  // required for Railway
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  : null

if (pool) {
  pool.on('error', err => console.error('PG pool error:', err.message))
  console.log('PostgreSQL pool initialised')
} else {
  console.log('DATABASE_URL not set — PostgreSQL endpoints disabled')
}


// ── Price level helper ────────────────────────────────────────────────────────
const PRICE_LEVEL_MAP = { 1: '€', 2: '€€', 3: '€€€', 4: '€€€€' }

function buildPriceRange(meals, priceLevel) {
  const prices = [...new Set(
    meals.filter(m => m.price && m.price >= 3 && m.price <= 50).map(m => m.price)
  )].sort((a, b) => a - b)
  if (prices.length >= 2) return `€${prices[0].toFixed(0)}–${prices[prices.length - 1].toFixed(0)}`
  if (prices.length === 1) return `€${prices[0].toFixed(0)}`
  return PRICE_LEVEL_MAP[priceLevel] || ''
}

function getIsOpen(openingHours) {
  if (!openingHours?.periods) return null
  const now = new Date()
  const googleDay = (now.getDay())  // 0=Sun same as Google
  const currentTime = now.getHours() * 100 + now.getMinutes()
  for (const period of openingHours.periods) {
    const o = period.open || {}
    const c = period.close || {}
    if (o.day === googleDay) {
      const openT = parseInt(o.time || '0000')
      const closeDay = c.day ?? googleDay
      const closeT = parseInt(c.time || '2359')
      if (closeDay === googleDay) {
        if (openT <= currentTime && currentTime < closeT) return true
      } else {
        if (currentTime >= openT) return true
      }
    } else if (c.day === googleDay) {
      const closeT = parseInt(c.time || '0000')
      if (currentTime < closeT) return true
    }
  }
  return false
}

function getHoursString(openingHours) {
  if (!openingHours?.weekday_text) return null
  const pyDay = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
  const text = openingHours.weekday_text[pyDay] || ''
  if (text.includes(': ')) return text.split(': ')[1].replace(' Uhr', '')
  return text || null
}

const _MENU_NUM_RE = /^\d+\.\s*/

// ── /api/restaurant-summaries — macro ranges per restaurant for low-zoom filter ─
// ~1 700 rows × ~60 bytes = ~100 KB gzip. Used to show/hide dot-pins at zoom < 13
// without loading full meal data.
app.get('/api/restaurant-summaries', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { rows } = await pool.query(`
      SELECT
        r.id,
        MIN(m.calories) AS min_cal,  MAX(m.calories) AS max_cal,
        MIN(m.protein)  AS min_pro,  MAX(m.protein)  AS max_pro,
        MIN(m.fat)      AS min_fat,  MAX(m.fat)      AS max_fat,
        MIN(m.carbs)    AS min_carb, MAX(m.carbs)    AS max_carb
      FROM restaurants r
      JOIN menu_items m ON m.restaurant_id = r.id
      WHERE m.source = 'wolt_menu'
        AND m.calories IS NOT NULL
        AND (m.category IS NULL OR m.category != 'drink')
        AND r.lat IS NOT NULL AND r.lon IS NOT NULL
      GROUP BY r.id
    `)

    const summaries = rows.map(r => ({
      id:      r.id,
      minCal:  Math.round(r.min_cal  ?? 0), maxCal:  Math.round(r.max_cal  ?? 0),
      minPro:  Math.round(r.min_pro  ?? 0), maxPro:  Math.round(r.max_pro  ?? 0),
      minFat:  Math.round(r.min_fat  ?? 0), maxFat:  Math.round(r.max_fat  ?? 0),
      minCarb: Math.round(r.min_carb ?? 0), maxCarb: Math.round(r.max_carb ?? 0),
    }))

    res.set('Cache-Control', 'public, max-age=300')
    res.json(summaries)
  } catch (err) {
    console.error('/api/restaurant-summaries error:', err.message)
    res.status(500).json({ error: 'Database error' })
  }
})


// ── /api/area-meals — meals for restaurants within a map bounding box ─────────
// Called when user zooms in to zoom ≥ 13. Only loads meals for visible area.
// Replaces the need to load all ~23K meals at app start.
app.get('/api/area-meals', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { swLat, swLng, neLat, neLng } = req.query
    if (!swLat || !swLng || !neLat || !neLng) {
      return res.status(400).json({ error: 'swLat, swLng, neLat, neLng required' })
    }

    const { rows } = await pool.query(`
      SELECT
        m.id, m.name, m.description, m.calories, m.protein, m.fat, m.carbs,
        m.confidence, m.price, m.image_url, m.restaurant_id, m.meal_times,
        m.is_vegan, m.is_gluten_free, m.is_diabetic_friendly
      FROM menu_items m
      JOIN restaurants r ON r.id = m.restaurant_id
      WHERE m.source = 'wolt_menu'
        AND m.calories IS NOT NULL
        AND m.image_url IS NOT NULL AND m.image_url <> ''
        AND (m.category IS NULL OR m.category != 'drink')
        AND r.lat IS NOT NULL AND r.lon IS NOT NULL
        AND r.lat BETWEEN $1 AND $3
        AND r.lon BETWEEN $2 AND $4
      ORDER BY
        CASE m.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        m.calories DESC NULLS LAST
    `, [+swLat, +swLng, +neLat, +neLng])

    const meals = rows.map((m, i) => ({
      id:                 i,
      name:               m.name.replace(_MENU_NUM_RE, ''),
      photo:              m.image_url,
      price:              m.price ? `€${parseFloat(m.price).toFixed(2)}` : null,
      description:        m.description || '',
      calories:           m.calories,
      protein:            m.protein,
      fat:                m.fat,
      carbs:              m.carbs,
      confidence:         m.confidence,
      restaurantId:       m.restaurant_id,
      mealTimes:          m.meal_times || null,
      isVegan:            m.is_vegan ?? null,
      isGlutenFree:       m.is_gluten_free ?? null,
      isDiabeticFriendly: m.is_diabetic_friendly ?? null,
    }))

    res.set('Cache-Control', 'public, max-age=60')
    res.json(meals)
  } catch (err) {
    console.error('/api/area-meals error:', err.message)
    res.status(500).json({ error: 'Database error' })
  }
})


// ── /api/pins — lightweight map data (restaurants with meal counts) ───────────
// Used by Discover.jsx to show pins immediately; ~200-400 KB for full Berlin
app.get('/api/pins', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { rows } = await pool.query(`
      SELECT
        r.id, r.name, r.lat, r.lon AS lng, r.wolt_slug,
        r.photo_url, r.rating, r.reviews_count, r.price_level,
        r.address, r.opening_hours,
        COUNT(m.id)                                     AS meal_count,
        MIN(m.image_url) FILTER (
          WHERE m.image_url IS NOT NULL AND m.image_url <> ''
        )                                               AS first_meal_photo
      FROM restaurants r
      JOIN menu_items m ON m.restaurant_id = r.id
        AND m.source = 'wolt_menu'
        AND m.calories IS NOT NULL
        AND m.image_url IS NOT NULL AND m.image_url <> ''
        AND (m.category IS NULL OR m.category != 'drink')
      WHERE r.lat IS NOT NULL AND r.lon IS NOT NULL
      GROUP BY r.id
      HAVING COUNT(m.id) > 0
      ORDER BY r.reviews_count DESC NULLS LAST
    `)

    const pins = rows.map(r => ({
      id: r.id,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      woltSlug: r.wolt_slug || null,
      photo: (r.photo_url || '').split('&key=')[0],
      rating: r.rating,
      reviewCount: r.reviews_count,
      priceLevel: r.price_level || null,
      address: r.address || '',
      mealCount: parseInt(r.meal_count),
      firstMealPhoto: r.first_meal_photo || null,
      isOpen: getIsOpen(r.opening_hours),
      hours: getHoursString(r.opening_hours),
    }))

    res.set('Cache-Control', 'public, max-age=300')  // 5 min cache
    res.json(pins)
  } catch (err) {
    console.error('/api/pins error:', err.message)
    res.status(500).json({ error: 'Database error' })
  }
})


// ── /api/meals — all meals for client-side filtering ─────────────────────────
// Returns compact meal objects (no restaurant fields — look those up via restaurantById).
// ~23K meals × compact format → ~4.5MB raw → ~700KB gzipped (safe for iOS Safari).
// All filtering is done client-side so sliders/filters remain instantaneous.
app.get('/api/meals', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { rows } = await pool.query(`
      SELECT
        m.id, m.name, m.description, m.calories, m.protein, m.fat, m.carbs,
        m.confidence, m.price, m.image_url, m.restaurant_id
      FROM menu_items m
      JOIN restaurants r ON r.id = m.restaurant_id
      WHERE m.source = 'wolt_menu'
        AND m.calories IS NOT NULL
        AND m.image_url IS NOT NULL AND m.image_url <> ''
        AND (m.category IS NULL OR m.category != 'drink')
        AND r.lat IS NOT NULL AND r.lon IS NOT NULL
      ORDER BY
        CASE m.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        m.calories DESC NULLS LAST
    `)

    const meals = rows.map((m, i) => ({
      id: i,
      name: m.name.replace(_MENU_NUM_RE, ''),
      photo: m.image_url,
      price: m.price ? `€${parseFloat(m.price).toFixed(2)}` : null,
      description: m.description || '',
      calories: m.calories,
      protein: m.protein,
      fat: m.fat,
      carbs: m.carbs,
      confidence: m.confidence,
      restaurantId: m.restaurant_id,
      // Restaurant fields are looked up client-side via restaurantById (from /api/pins)
      // to avoid duplicating restaurant data across every meal object.
    }))

    res.set('Cache-Control', 'public, max-age=300')
    res.json(meals)
  } catch (err) {
    console.error('/api/meals error:', err.message)
    res.status(500).json({ error: 'Database error' })
  }
})


// ── /api/restaurants/:id/meals — all meals for one restaurant ─────────────────
app.get('/api/restaurants/:id/meals', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { id } = req.params
    const { rows } = await pool.query(`
      SELECT m.*, r.name AS restaurant_name, r.photo_url, r.rating,
             r.reviews_count, r.price_level, r.address, r.wolt_slug
      FROM menu_items m
      JOIN restaurants r ON r.id = m.restaurant_id
      WHERE m.restaurant_id = $1 AND m.source = 'wolt_menu'
        AND (m.category IS NULL OR m.category != 'drink')
      ORDER BY
        CASE m.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        m.calories DESC NULLS LAST
    `, [id])

    if (!rows.length) return res.status(404).json({ error: 'Restaurant not found' })

    const priceRange = buildPriceRange(rows, rows[0].price_level)
    const meals = rows.map((m, i) => ({
      id: i,
      name: m.name.replace(_MENU_NUM_RE, ''),
      photo: m.image_url || '',
      price: m.price ? `€${m.price.toFixed(2)}` : null,
      description: m.description || '',
      calories: m.calories,
      protein: m.protein,
      fat: m.fat,
      carbs: m.carbs,
      confidence: m.confidence,
      restaurantId: id,
      restaurantName: m.restaurant_name,
      restaurantPhoto: (m.photo_url || '').split('&key=')[0],
      rating: m.rating,
      reviewCount: m.reviews_count,
      priceRange,
      distance: null,
      restaurantAddress:   m.address || '',
      mealTimes:           m.meal_times || null,
      isVegan:             m.is_vegan ?? null,
      isGlutenFree:        m.is_gluten_free ?? null,
      isDiabeticFriendly:  m.is_diabetic_friendly ?? null,
    }))

    res.set('Cache-Control', 'public, max-age=60')
    res.json(meals)
  } catch (err) {
    console.error('/api/restaurants/:id/meals error:', err.message)
    res.status(500).json({ error: 'Database error' })
  }
})


// ── /api/advice ───────────────────────────────────────────────────────────────
app.post('/api/advice', async (req, res) => {
  const { name, description, calories, protein, fat, carbs, diet, mealTime, imageUrl } = req.body

  if (!name || calories == null) {
    return res.status(400).json({ error: 'name and calories are required' })
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const dietLabel = {
      high_protein: 'high-protein',
      high_carb: 'high-carb',
      balanced: 'balanced',
      keto: 'keto',
    }[diet] || 'balanced'

    const prompt = `You are a concise nutrition advisor. Evaluate this meal for someone following a ${dietLabel} diet.

Meal: ${name}
${description ? `Description: ${description}` : ''}
Nutrition per serving: ${calories} kcal, protein ${protein ?? '?'}g, fat ${fat ?? '?'}g, carbs ${carbs ?? '?'}g
${imageUrl ? `
Carefully look at the photo of the dish and compare what you see with the listed macros. If anything looks off — whether it's fat (sauces, oil, cheese), carbs (large bread/rice/pasta portions, sugary glazes), overall calorie density, or portion size — add a gentle "macroWarning" field with one short, softly phrased sentence describing the concern. Also reduce the score by 5–15 points to reflect the uncertainty. If the macros look plausible from the photo, omit "macroWarning".` : ''}

Respond ONLY with valid JSON (no markdown):
{
  "score": <integer 0–100 reflecting how well this meal fits the ${dietLabel} diet>,
  "rating": <"Poor" | "Fair" | "Good" | "Excellent">,
  "advice": "<2–3 sentences: what makes this meal suitable or not for the diet, and one practical tip>",
  "macroWarning": "<optional: one short sentence if photo suggests macros may be underestimated, otherwise omit this field>"
}`

    const messageContent = imageUrl
      ? [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: prompt },
        ]
      : prompt

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: messageContent }],
    })

    const raw = message.content[0].text.replace(/```json\n?|\n?```/g, '').trim()
    const data = JSON.parse(raw)
    res.json(data)
  } catch (err) {
    console.error('/api/advice error:', err)
    res.status(500).json({ error: 'Failed to get advice' })
  }
})


// ── Image proxy — prevents canvas CORS taint ──────────────────────────────────
// Server-side cache: each unique URL is fetched from Wolt CDN at most once per 24 h.
// This prevents Railway's IP from hammering Wolt on every page load.
const _proxyCache = new Map()  // url → { buf: Buffer, ct: string, ts: number }
const _PROXY_TTL  = 24 * 60 * 60 * 1000  // 24 h in ms
const _PROXY_MAX  = 2000                   // evict oldest when cache exceeds this many entries

app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('Missing url')
  const allowed = ['imageproxy.wolt.com', 'maps.googleapis.com']
  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).send('Invalid url') }
  if (!allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
    return res.status(403).send('Disallowed domain')
  }

  // Serve from cache if still fresh
  const cached = _proxyCache.get(url)
  if (cached && Date.now() - cached.ts < _PROXY_TTL) {
    res.set('Content-Type', cached.ct)
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('X-Cache', 'HIT')
    return res.send(cached.buf)
  }

  try {
    const response = await fetch(url)
    if (!response.ok) return res.status(response.status).send('Upstream error')
    const ct  = response.headers.get('content-type') || 'image/jpeg'
    const buf = Buffer.from(await response.arrayBuffer())

    // Evict oldest entry if cache is full
    if (_proxyCache.size >= _PROXY_MAX) {
      const oldest = [..._proxyCache.entries()].reduce((a, b) => a[1].ts < b[1].ts ? a : b)
      _proxyCache.delete(oldest[0])
    }
    _proxyCache.set(url, { buf, ct, ts: Date.now() })

    res.set('Content-Type', ct)
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('X-Cache', 'MISS')
    res.send(buf)
  } catch (e) {
    console.error('Image proxy error:', e.message)
    res.status(500).send('Error fetching image')
  }
})


// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
