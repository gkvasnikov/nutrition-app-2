import 'dotenv/config'
import express from 'express'
import compression from 'compression'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import Anthropic from '@anthropic-ai/sdk'
import pg from 'pg'
import session from 'express-session'
import { timingSafeEqual, createHash } from 'crypto'
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const app = express()
app.set('trust proxy', 1)  // Railway/Heroku HTTPS proxy — required for secure session cookies
const PORT = process.env.PORT || 3001
const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.use(compression())   // gzip all responses — reduces JSON payload ~70%
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,  // 8 hours
  },
}))
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

// ── Cloudflare R2 (persistent image cache) ────────────────────────────────────
const r2 = (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_ACCOUNT_ID)
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,  // R2 requires path-style URLs (not virtual-hosted)
    })
  : null
const R2_BUCKET = process.env.R2_BUCKET || 'nutrition-app-images'

if (r2) console.log(`R2 connected → bucket: ${R2_BUCKET}`)
else    console.log('R2 not configured — image proxy uses memory cache only')

// Stable R2 key from URL: images/<md5>.<ext>
function r2Key(url) {
  const hash = createHash('md5').update(url).digest('hex')
  const ext  = url.match(/\.(jpe?g|png|webp|avif|gif)(\?|$)/i)?.[1]?.replace('jpeg','jpg') || 'jpg'
  return `images/${hash}.${ext}`
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
Carefully look at the photo and compare it with the listed macros. Add a "macroWarning" ONLY if you spot a specific, concrete reason the listed macros are likely wrong — for example: a visibly large amount of oil, sauce, or melted cheese clearly not reflected in the fat/calorie count; the cooking method is ambiguous and would materially change the macros (e.g. appears deep-fried but listed macros suggest grilled); or the portion looks dramatically larger or smaller than what the listed calories imply. Do NOT add a warning just because the dish is complex, contains multiple components, or because minor deviations are theoretically possible. If you have no specific concrete concern, omit "macroWarning" entirely. When you do add it, reduce the score by 5–15 points and keep the warning to one short, factual sentence.` : ''}

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


// ── Image proxy — canvas CORS fix + R2 persistent cache ──────────────────────
// Cache hierarchy:
//   L1 — in-memory Map (2000 entries, 24 h TTL) — zero-latency repeat requests
//   L2 — Cloudflare R2 (permanent)              — survives server restarts/redeploys
//   L3 — origin (Wolt CDN / Google Maps CDN)    — first-ever fetch only
const _proxyCache = new Map()  // url → { buf: Buffer, ct: string, ts: number }
const _PROXY_TTL  = 24 * 60 * 60 * 1000  // 24 h
const _PROXY_MAX  = 2000

app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('Missing url')

  const allowed = ['imageproxy.wolt.com', 'maps.googleapis.com']
  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).send('Invalid url') }
  if (!allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
    return res.status(403).send('Disallowed domain')
  }

  // L1 — memory cache
  const cached = _proxyCache.get(url)
  if (cached && Date.now() - cached.ts < _PROXY_TTL) {
    res.set('Content-Type', cached.ct)
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('X-Cache', 'MEM')
    return res.send(cached.buf)
  }

  // L2 — R2 cache
  if (r2) {
    try {
      const obj = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key(url) }))
      const chunks = []; for await (const c of obj.Body) chunks.push(c)
      const buf = Buffer.concat(chunks)
      const ct  = obj.ContentType || 'image/jpeg'
      // Warm L1 too
      if (_proxyCache.size >= _PROXY_MAX) {
        const oldest = [..._proxyCache.entries()].reduce((a, b) => a[1].ts < b[1].ts ? a : b)
        _proxyCache.delete(oldest[0])
      }
      _proxyCache.set(url, { buf, ct, ts: Date.now() })
      res.set('Content-Type', ct)
      res.set('Cache-Control', 'public, max-age=86400')
      res.set('X-Cache', 'R2')
      return res.send(buf)
    } catch (e) {
      if (e.name !== 'NoSuchKey' && e.$metadata?.httpStatusCode !== 404) {
        console.error('R2 get error:', e.message)
      }
      // fall through to origin fetch
    }
  }

  // L3 — origin fetch
  try {
    const response = await fetch(url)
    if (!response.ok) return res.status(response.status).send('Upstream error')
    const ct  = response.headers.get('content-type') || 'image/jpeg'
    const buf = Buffer.from(await response.arrayBuffer())

    // Save to R2 in background (don't block the response)
    if (r2) {
      r2.send(new PutObjectCommand({
        Bucket:      R2_BUCKET,
        Key:         r2Key(url),
        Body:        buf,
        ContentType: ct,
      })).catch(e => console.error('R2 put error:', e.message))
    }

    // Save to L1
    if (_proxyCache.size >= _PROXY_MAX) {
      const oldest = [..._proxyCache.entries()].reduce((a, b) => a[1].ts < b[1].ts ? a : b)
      _proxyCache.delete(oldest[0])
    }
    _proxyCache.set(url, { buf, ct, ts: Date.now() })

    res.set('Content-Type', ct)
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('X-Cache', 'ORIGIN')
    res.send(buf)
  } catch (e) {
    console.error('Image proxy error:', e.message)
    res.status(500).send('Error fetching image')
  }
})


// ── R2 bulk image cache job ───────────────────────────────────────────────────
// Downloads every Wolt meal photo to R2 so the app is fully independent of Wolt CDN.
// Runs in the background; progress tracked in _cacheJob.

const _cacheJob = { running: false, total: 0, done: 0, errors: 0, startedAt: null, finishedAt: null }

async function runImageCacheJob() {
  if (!r2 || !pool)  return
  if (_cacheJob.running) return  // already running

  _cacheJob.running   = true
  _cacheJob.done      = 0
  _cacheJob.errors    = 0
  _cacheJob.startedAt = new Date().toISOString()
  _cacheJob.finishedAt = null

  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT image_url FROM menu_items
      WHERE image_url IS NOT NULL AND image_url <> ''
        AND source = 'wolt_menu'
        AND calories IS NOT NULL
        AND (category IS NULL OR category != 'drink')
    `)
    _cacheJob.total = rows.length
    console.log(`Image cache job started: ${rows.length} unique URLs`)

    const CONCURRENCY = 8  // parallel fetches — don't overwhelm Wolt or the server
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (!_cacheJob.running) break  // allow cancellation
      await Promise.all(rows.slice(i, i + CONCURRENCY).map(async ({ image_url: url }) => {
        try {
          const key = r2Key(url)
          // Skip if already in R2
          try {
            await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
            _cacheJob.done++
            return  // already cached
          } catch (e) {
            if (e.$metadata?.httpStatusCode !== 404 && e.name !== 'NotFound' && e.name !== 'NoSuchKey') throw e
          }
          // Fetch from Wolt and save to R2
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          const ct  = res.headers.get('content-type') || 'image/jpeg'
          await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: ct }))
          _cacheJob.done++
        } catch {
          _cacheJob.errors++
          _cacheJob.done++
        }
      }))
    }
  } catch (e) {
    console.error('Image cache job error:', e.message)
  } finally {
    _cacheJob.running    = false
    _cacheJob.finishedAt = new Date().toISOString()
    console.log(`Image cache job finished: ${_cacheJob.done - _cacheJob.errors} saved, ${_cacheJob.errors} errors`)
  }
}

// ── Admin panel ───────────────────────────────────────────────────────────────

// Berlin borough boundaries — simplified polygons, each ring is [[lat, lng], ...]
// Derived from official Berliner Senatsverwaltung Bezirksgrenzen (open data).
// Replace with the full-resolution GeoJSON from https://daten.berlin.de if needed.
const BERLIN_DISTRICTS = [
  { id: 'mitte', name: 'Mitte', polygon: [
    [52.558,13.337],[52.563,13.372],[52.560,13.403],[52.542,13.432],
    [52.517,13.438],[52.499,13.418],[52.494,13.385],[52.502,13.352],[52.521,13.336],
  ]},
  { id: 'fhain', name: 'Friedrichshain-Kreuzberg', polygon: [
    [52.517,13.438],[52.527,13.484],[52.512,13.494],[52.497,13.476],
    [52.487,13.447],[52.490,13.421],[52.499,13.418],
  ]},
  { id: 'pankow', name: 'Pankow', polygon: [
    [52.558,13.403],[52.563,13.370],[52.621,13.380],[52.638,13.423],
    [52.635,13.481],[52.590,13.485],[52.565,13.465],[52.542,13.432],
  ]},
  { id: 'cwilm', name: 'Charlottenburg-Wilmersdorf', polygon: [
    [52.521,13.336],[52.502,13.352],[52.494,13.320],[52.466,13.268],
    [52.472,13.252],[52.517,13.252],[52.537,13.300],
  ]},
  { id: 'spandau', name: 'Spandau', polygon: [
    [52.537,13.300],[52.517,13.252],[52.572,13.120],[52.583,13.186],
    [52.561,13.265],[52.554,13.297],
  ]},
  { id: 'steglitz', name: 'Steglitz-Zehlendorf', polygon: [
    [52.472,13.252],[52.466,13.268],[52.442,13.268],[52.384,13.206],
    [52.382,13.156],[52.410,13.152],[52.468,13.186],[52.481,13.232],
  ]},
  { id: 'tempel', name: 'Tempelhof-Schöneberg', polygon: [
    [52.494,13.385],[52.490,13.421],[52.487,13.447],[52.461,13.442],
    [52.444,13.425],[52.440,13.374],[52.444,13.330],[52.462,13.315],
    [52.480,13.320],[52.494,13.352],
  ]},
  { id: 'neuk', name: 'Neukölln', polygon: [
    [52.490,13.421],[52.497,13.476],[52.487,13.490],[52.459,13.483],
    [52.444,13.468],[52.438,13.443],[52.444,13.425],[52.461,13.442],
  ]},
  { id: 'treptow', name: 'Treptow-Köpenick', polygon: [
    [52.487,13.447],[52.497,13.476],[52.512,13.494],[52.517,13.560],
    [52.490,13.680],[52.416,13.708],[52.382,13.616],[52.384,13.490],
    [52.432,13.454],[52.444,13.468],[52.459,13.483],
  ]},
  { id: 'marzahn', name: 'Marzahn-Hellersdorf', polygon: [
    [52.565,13.465],[52.590,13.485],[52.582,13.660],[52.519,13.658],
    [52.499,13.584],[52.510,13.527],[52.517,13.560],[52.512,13.494],
    [52.527,13.484],[52.542,13.432],[52.560,13.450],
  ]},
  { id: 'lich', name: 'Lichtenberg', polygon: [
    [52.542,13.432],[52.560,13.450],[52.560,13.528],[52.519,13.570],
    [52.517,13.560],[52.512,13.494],[52.527,13.484],
  ]},
  { id: 'rein', name: 'Reinickendorf', polygon: [
    [52.563,13.372],[52.558,13.337],[52.554,13.297],[52.561,13.265],
    [52.583,13.186],[52.641,13.210],[52.641,13.340],[52.638,13.423],
    [52.621,13.380],
  ]},
]

// Ray-casting point-in-polygon (lat/lng, polygon = [[lat,lng],...])
function pointInPolygon(lat, lng, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i]
    const [yj, xj] = polygon[j]
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside
  }
  return inside
}

// ── Admin auth helpers ────────────────────────────────────────────────────────

function safeCompare(a, b) {
  // Hash both to equalise length before timingSafeEqual
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

// Simple in-memory rate limiter for login endpoint
const _loginAttempts = new Map()  // ip → { count, resetAt }
const RATE_LIMIT_MAX    = 10
const RATE_LIMIT_WINDOW = 15 * 60 * 1000  // 15 min

function checkLoginRateLimit(ip) {
  const now = Date.now()
  let rec = _loginAttempts.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW }
  if (now > rec.resetAt) rec = { count: 0, resetAt: now + RATE_LIMIT_WINDOW }
  rec.count++
  _loginAttempts.set(ip, rec)
  return rec.count <= RATE_LIMIT_MAX
}

function requireAdminAuth(req, res, next) {
  if (req.session?.adminAuthenticated) return next()
  if (req.path.startsWith('/admin/api')) return res.status(401).json({ error: 'Unauthorized' })
  res.redirect('/admin/login')
}

// ── Admin login ───────────────────────────────────────────────────────────────

const ADMIN_LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Nutrition Admin · Login</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#f8f8f8;color:#212121;display:grid;place-items:center;min-height:100vh;font-size:14px}
.card{background:#fff;border:1px solid #ebebeb;border-radius:16px;padding:40px;width:100%;max-width:380px;box-shadow:0 8px 24px -4px rgba(0,0,0,.08)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:32px}
.brand__mark{width:32px;height:32px;background:#212121;border-radius:8px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:15px;flex-shrink:0}
.brand__name{font-weight:700;font-size:15px}
.brand__sub{color:#9a9a9a;font-weight:500}
h1{font-size:20px;font-weight:700;letter-spacing:-.02em;margin-bottom:6px}
p{color:#717171;font-size:13px;margin-bottom:28px}
label{display:block;font-size:12px;font-weight:600;color:#717171;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
input{width:100%;height:40px;border:1px solid #ebebeb;border-radius:8px;padding:0 12px;font-family:inherit;font-size:14px;color:#212121;background:#f8f8f8;outline:none;transition:border-color .15s}
input:focus{border-color:#212121;background:#fff}
.field{margin-bottom:16px}
.error{background:#fff4eb;border:1px solid #fde8cc;color:#b04a00;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:16px;display:none}
.error.show{display:block}
button{width:100%;height:40px;background:#212121;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;margin-top:8px;transition:opacity .15s}
button:hover{opacity:.85}
button:active{opacity:.7}
button:disabled{opacity:.5;cursor:not-allowed}
</style>
</head>
<body>
<div class="card">
  <div class="brand">
    <div class="brand__mark">N</div>
    <span class="brand__name">Nutrition <span class="brand__sub">/ Admin</span></span>
  </div>
  <h1>Sign in</h1>
  <p>Admin access only.</p>
  <form method="POST" action="/admin/login" id="form">
    <div class="error" id="err">{{ERROR}}</div>
    <div class="field"><label>Username</label><input type="text" name="username" autocomplete="username" required autofocus/></div>
    <div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required/></div>
    <button type="submit" id="btn">Sign in</button>
  </form>
  <script>
    const err = document.getElementById('err');
    if (err.textContent.trim()) err.classList.add('show');
    document.getElementById('form').addEventListener('submit', () => {
      document.getElementById('btn').disabled = true;
      document.getElementById('btn').textContent = 'Signing in…';
    });
  </script>
</div>
</body>
</html>`

app.get('/admin/login', (req, res) => {
  if (req.session?.adminAuthenticated) return res.redirect('/admin')
  res.send(ADMIN_LOGIN_HTML.replace('{{ERROR}}', ''))
})

app.post('/admin/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).send(ADMIN_LOGIN_HTML.replace('{{ERROR}}', 'Too many attempts. Try again in 15 minutes.'))
  }

  const { username, password } = req.body
  const adminUser = process.env.ADMIN_USER || ''
  const adminPass = process.env.ADMIN_PASS || ''

  if (!adminUser || !adminPass) {
    return res.status(500).send(ADMIN_LOGIN_HTML.replace('{{ERROR}}', 'Admin credentials not configured on server.'))
  }

  const userMatch = safeCompare(username || '', adminUser)
  const passMatch = safeCompare(password || '', adminPass)

  if (!userMatch || !passMatch) {
    return res.status(401).send(ADMIN_LOGIN_HTML.replace('{{ERROR}}', 'Invalid username or password.'))
  }

  req.session.adminAuthenticated = true
  req.session.save(() => res.redirect('/admin'))
})

app.post('/admin/logout', requireAdminAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'))
})

// ── Admin API endpoints (all require auth) ────────────────────────────────────

app.get('/admin/api/stats', requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(DISTINCT r.id)  AS total_restaurants,
        COUNT(m.id)           AS total_meals,
        COUNT(m.id) FILTER (WHERE m.confidence = 'high')   AS high_conf,
        COUNT(m.id) FILTER (WHERE m.confidence = 'medium') AS med_conf,
        COUNT(m.id) FILTER (WHERE m.confidence = 'low' OR m.confidence IS NULL OR m.confidence NOT IN ('high','medium')) AS low_conf
      FROM restaurants r
      JOIN menu_items m ON m.restaurant_id = r.id
        AND m.source = 'wolt_menu'
        AND m.calories IS NOT NULL
        AND (m.category IS NULL OR m.category != 'drink')
    `)
    res.json(rows[0])
  } catch (err) {
    console.error('/admin/api/stats error:', err.message)
    res.status(500).json({ error: 'Database error' })
  }
})

app.get('/admin/api/districts', requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try { res.json(await fetchAdminDistricts()) }
  catch (err) { console.error('/admin/api/districts error:', err.message); res.status(500).json({ error: 'Database error' }) }
})

app.get('/admin/api/restaurants', requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try { res.json(await fetchAdminRestaurants()) }
  catch (err) { console.error('/admin/api/restaurants error:', err.message); res.status(500).json({ error: 'Database error' }) }
})

app.get('/admin/api/restaurants/:id', requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  try {
    const [rRes, mRes] = await Promise.all([
      pool.query('SELECT * FROM restaurants WHERE id = $1', [req.params.id]),
      pool.query(`
        SELECT id, name, calories, protein, fat, carbs, price, image_url, confidence
        FROM menu_items
        WHERE restaurant_id = $1
          AND source = 'wolt_menu'
          AND calories IS NOT NULL
          AND (category IS NULL OR category != 'drink')
        ORDER BY
          CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
          calories DESC NULLS LAST
        LIMIT 20
      `, [req.params.id]),
    ])

    if (!rRes.rows.length) return res.status(404).json({ error: 'Not found' })
    const r = rRes.rows[0]
    const PRICE_MAP = { 1: '€', 2: '€€', 3: '€€€', 4: '€€€€' }
    res.json({
      restaurant: {
        id:       r.id,
        name:     r.name,
        address:  r.address || '',
        lat:      r.lat,
        lng:      r.lon,
        rating:   r.rating,
        reviews:  r.reviews_count,
        price:    PRICE_MAP[r.price_level] || '—',
        hours:    getHoursString(r.opening_hours) || '—',
        open:     getIsOpen(r.opening_hours),
        woltSlug: r.wolt_slug || null,
      },
      meals: mRes.rows.map(m => ({
        name:   m.name,
        kcal:   m.calories,
        p:      m.protein,
        f:      m.fat,
        c:      m.carbs,
        price:  m.price ? `€${parseFloat(m.price).toFixed(2)}` : null,
        photo:  m.image_url || null,
      })),
    })
  } catch (err) {
    console.error('/admin/api/restaurants/:id error:', err.message)
    res.status(500).json({ error: 'Database error' })
  }
})

// Stub: run a scraping script — real scripts can be wired here later
app.post('/admin/api/scripts/:id/run', requireAdminAuth, (req, res) => {
  console.log(`[admin] Script run requested: ${req.params.id}`)
  res.json({ status: 'started', scriptId: req.params.id, message: 'Script stub — not yet connected to a real process.' })
})

// Image cache job endpoints
app.post('/admin/api/cache-images/start', requireAdminAuth, (req, res) => {
  if (!r2)   return res.status(503).json({ error: 'R2 not configured' })
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  if (_cacheJob.running) return res.json({ status: 'already_running', job: _cacheJob })
  runImageCacheJob()  // fire and forget
  res.json({ status: 'started', job: _cacheJob })
})

app.post('/admin/api/cache-images/stop', requireAdminAuth, (req, res) => {
  _cacheJob.running = false
  res.json({ status: 'stopping', job: _cacheJob })
})

app.get('/admin/api/cache-images/status', requireAdminAuth, (req, res) => {
  res.json({ job: _cacheJob, r2Enabled: !!r2 })
})

// ── Admin main page (dynamic — injects real DB data) ─────────────────────────

const _adminPanelPath = path.join(__dirname, 'admin', 'Admin Panel.html')

async function fetchAdminDistricts() {
  // Single query — only restaurants that have at least one scraped meal
  const { rows } = await pool.query(`
    SELECT
      r.id, r.lat, r.lon,
      COUNT(m.id)                                          AS meals,
      COUNT(m.id) FILTER (WHERE m.confidence = 'high')    AS high_conf
    FROM restaurants r
    JOIN menu_items m ON m.restaurant_id = r.id
      AND m.source = 'wolt_menu'
      AND m.calories IS NOT NULL
      AND m.image_url IS NOT NULL AND m.image_url <> ''
      AND (m.category IS NULL OR m.category != 'drink')
    WHERE r.lat IS NOT NULL AND r.lon IS NOT NULL
    GROUP BY r.id, r.lat, r.lon
  `)

  return BERLIN_DISTRICTS.map(d => {
    const inDistrict = rows.filter(r => pointInPolygon(parseFloat(r.lat), parseFloat(r.lon), d.polygon))
    const totalMeals = inDistrict.reduce((s, r) => s + parseInt(r.meals), 0)
    const highConf   = inDistrict.reduce((s, r) => s + parseInt(r.high_conf), 0)
    return {
      id: d.id, name: d.name,
      status:      inDistrict.length > 0 ? 'covered' : 'none',
      restaurants: inDistrict.length,
      meals:       totalMeals,
      coverage:    totalMeals > 0 ? Math.round((highConf / totalMeals) * 100) : 0,
      lastSync:    null, cost: null,
    }
  })
}

async function fetchAdminRestaurants() {
  const PRICE_MAP = { 1: '€', 2: '€€', 3: '€€€', 4: '€€€€' }
  // Exact same filter as /api/pins: only restaurants that have ≥1 meal
  // with wolt_menu source + calories + image_url (= what the app shows).
  const { rows } = await pool.query(`
    SELECT
      r.id, r.name, r.address, r.rating, r.reviews_count,
      r.price_level, r.opening_hours, r.wolt_slug,
      r.lat, r.lon, r.photo_url,
      COUNT(m.id) AS meals,
      AVG(CASE m.confidence WHEN 'high' THEN 1.0 WHEN 'medium' THEN 0.75 ELSE 0.5 END) AS avg_confidence
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
    LIMIT 500
  `)
  const mapsKey = process.env.VITE_GOOGLE_MAPS_API_KEY || ''
  return rows.map(r => {
    const rawPhoto = (r.photo_url || '').split('&key=')[0]
    // Route through image-proxy so: (a) API key never reaches the browser,
    // (b) image gets cached in R2 on first load.
    const fullUrl = rawPhoto
      ? (rawPhoto.includes('googleapis.com') && mapsKey
          ? rawPhoto + '&key=' + mapsKey
          : rawPhoto)
      : null
    const photo = fullUrl
      ? `/api/image-proxy?url=${encodeURIComponent(fullUrl)}`
      : null
    return {
      id:         String(r.id),
      name:       r.name,
      cuisine:    null,
      meals:      parseInt(r.meals) || 0,
      confidence: r.avg_confidence ? parseFloat(parseFloat(r.avg_confidence).toFixed(2)) : 0,
      open:       getIsOpen(r.opening_hours),
      photos:     parseInt(r.meals) > 0,
      partner:    false,
      rating:     r.rating,
      reviews:    r.reviews_count,
      price:      PRICE_MAP[r.price_level] || '—',
      address:    r.address || '',
      hours:      getHoursString(r.opening_hours) || '—',
      updated:    null,
      woltSlug:   r.wolt_slug || null,
      lat:        r.lat  ? parseFloat(r.lat)  : null,
      lng:        r.lon  ? parseFloat(r.lon)  : null,
      photo,
    }
  })
}

app.get('/admin', requireAdminAuth, async (req, res) => {
  if (!pool) {
    return res.status(503).send('<h1>Database not configured</h1>')
  }
  try {
    const [districts, restaurants] = await Promise.all([
      fetchAdminDistricts(),
      fetchAdminRestaurants(),
    ])

    const serverData = JSON.stringify({ DISTRICTS: districts, RESTAURANTS: restaurants })
      .replace(/<\/script>/gi, '<\\/script>')

    const html = fs.readFileSync(_adminPanelPath, 'utf-8')
      .replace('<!-- __SERVER_DATA__ -->', `<script>window.__SERVER_DATA__ = ${serverData};</script>`)

    res.send(html)
  } catch (err) {
    console.error('/admin error:', err.message)
    res.status(500).send('<h1>Error loading admin panel</h1><p>' + err.message + '</p>')
  }
})

// Admin static assets (data.js, app.jsx, styles.css, etc.) — auth-gated
app.use('/admin', requireAdminAuth, express.static(path.join(__dirname, 'admin')))


// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
