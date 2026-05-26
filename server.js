import 'dotenv/config'
import express from 'express'
import { fileURLToPath } from 'url'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import pg from 'pg'

const app = express()
const PORT = process.env.PORT || 3001
const __dirname = path.dirname(fileURLToPath(import.meta.url))

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


// ── /api/meals — paginated + filtered meals ───────────────────────────────────
// Query params:
//   restaurantId  — filter by restaurant
//   minCalories / maxCalories
//   minProtein   / maxProtein
//   minFat       / maxFat
//   minCarbs     / maxCarbs
//   isVegan / isVegetarian / isGlutenFree / isDiabeticFriendly  — "true"
//   confidence   — "high" | "medium" | "low" (comma-separated)
//   limit        — default 200
//   offset       — default 0
app.get('/api/meals', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try {
    const {
      restaurantId,
      minCalories, maxCalories,
      minProtein,  maxProtein,
      minFat,      maxFat,
      minCarbs,    maxCarbs,
      isVegan, isVegetarian, isGlutenFree, isDiabeticFriendly,
      confidence,
      limit = '500',
      offset = '0',
    } = req.query

    const conditions = [
      "m.source = 'wolt_menu'",
      "m.calories IS NOT NULL",
      "m.image_url IS NOT NULL AND m.image_url <> ''",
      "r.lat IS NOT NULL AND r.lon IS NOT NULL",
    ]
    const params = []
    const p = () => `$${params.length}`

    if (restaurantId)    { params.push(restaurantId);      conditions.push(`m.restaurant_id = ${p()}`) }
    if (minCalories)     { params.push(+minCalories);      conditions.push(`m.calories >= ${p()}`) }
    if (maxCalories)     { params.push(+maxCalories);      conditions.push(`m.calories <= ${p()}`) }
    if (minProtein)      { params.push(+minProtein);       conditions.push(`m.protein >= ${p()}`) }
    if (maxProtein)      { params.push(+maxProtein);       conditions.push(`m.protein <= ${p()}`) }
    if (minFat)          { params.push(+minFat);           conditions.push(`m.fat >= ${p()}`) }
    if (maxFat)          { params.push(+maxFat);           conditions.push(`m.fat <= ${p()}`) }
    if (minCarbs)        { params.push(+minCarbs);         conditions.push(`m.carbs >= ${p()}`) }
    if (maxCarbs)        { params.push(+maxCarbs);         conditions.push(`m.carbs <= ${p()}`) }
    if (isVegan === 'true')             conditions.push("m.is_vegan = TRUE")
    if (isVegetarian === 'true')        conditions.push("m.is_vegetarian = TRUE")
    if (isGlutenFree === 'true')        conditions.push("m.is_gluten_free = TRUE")
    if (isDiabeticFriendly === 'true')  conditions.push("m.is_diabetic_friendly = TRUE")
    if (confidence) {
      const levels = confidence.split(',').map(s => s.trim()).filter(Boolean)
      params.push(levels)
      conditions.push(`m.confidence = ANY(${p()})`)
    }

    const lim = Math.min(parseInt(limit) || 500, 1000)
    const off = parseInt(offset) || 0
    params.push(lim, off)

    const sql = `
      SELECT
        m.id, m.name, m.description, m.calories, m.protein, m.fat, m.carbs,
        m.confidence, m.price, m.image_url,
        m.is_vegan, m.is_vegetarian, m.is_gluten_free, m.is_diabetic_friendly,
        r.id AS restaurant_id, r.name AS restaurant_name,
        r.photo_url AS restaurant_photo, r.rating, r.reviews_count,
        r.price_level, r.address
      FROM menu_items m
      JOIN restaurants r ON r.id = m.restaurant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE m.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        m.calories DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `

    const { rows } = await pool.query(sql, params)

    // Group by restaurant to compute priceRange
    const restPrices = {}
    for (const row of rows) {
      if (!restPrices[row.restaurant_id]) restPrices[row.restaurant_id] = []
      if (row.price) restPrices[row.restaurant_id].push(row.price)
    }

    const meals = rows.map((m, i) => {
      const prices = restPrices[m.restaurant_id] || []
      const sortedPrices = [...new Set(prices.filter(p => p >= 3 && p <= 50))].sort((a, b) => a - b)
      let priceRange = PRICE_LEVEL_MAP[m.price_level] || ''
      if (sortedPrices.length >= 2) priceRange = `€${sortedPrices[0].toFixed(0)}–${sortedPrices[sortedPrices.length - 1].toFixed(0)}`
      else if (sortedPrices.length === 1) priceRange = `€${sortedPrices[0].toFixed(0)}`

      return {
        id: off + i,
        name: m.name.replace(_MENU_NUM_RE, ''),
        photo: m.image_url,
        price: m.price ? `€${m.price.toFixed(2)}` : null,
        description: m.description || '',
        calories: m.calories,
        protein: m.protein,
        fat: m.fat,
        carbs: m.carbs,
        confidence: m.confidence,
        restaurantId: m.restaurant_id,
        restaurantName: m.restaurant_name,
        restaurantPhoto: (m.restaurant_photo || '').split('&key=')[0],
        rating: m.rating,
        reviewCount: m.reviews_count,
        priceRange,
        distance: null,
        restaurantAddress: m.address || '',
      }
    })

    res.set('Cache-Control', 'public, max-age=60')
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
      restaurantAddress: m.address || '',
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
  const { name, description, calories, protein, fat, carbs, diet, mealTime } = req.body

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

Respond ONLY with valid JSON (no markdown):
{
  "score": <integer 0–100 reflecting how well this meal fits the ${dietLabel} diet>,
  "rating": <"Poor" | "Fair" | "Good" | "Excellent">,
  "advice": "<2–3 sentences: what makes this meal suitable or not for the diet, and one practical tip>"
}`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
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
app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('Missing url')
  const allowed = ['imageproxy.wolt.com', 'maps.googleapis.com']
  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).send('Invalid url') }
  if (!allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
    return res.status(403).send('Disallowed domain')
  }
  try {
    const response = await fetch(url)
    if (!response.ok) return res.status(response.status).send('Upstream error')
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const buffer = await response.arrayBuffer()
    res.set('Content-Type', contentType)
    res.set('Cache-Control', 'public, max-age=86400')
    res.send(Buffer.from(buffer))
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
