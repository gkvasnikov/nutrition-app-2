import 'dotenv/config'
import express from 'express'
import compression from 'compression'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import Anthropic from '@anthropic-ai/sdk'
import pg from 'pg'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import { timingSafeEqual, createHash } from 'crypto'
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { chromium } from 'playwright'

const app = express()
app.set('trust proxy', 1)  // Railway/Heroku HTTPS proxy — required for secure session cookies
const PORT = process.env.PORT || 3001
const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.use(compression())   // gzip all responses — reduces JSON payload ~70%
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// Session store: PostgreSQL in production so sessions survive redeploys,
// in-memory fallback for local dev (no DATABASE_URL set).
const PgSession = connectPgSimple(session)
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000  // 30 days
app.use(session({
  store: process.env.DATABASE_URL
    ? new PgSession({
        conString: process.env.DATABASE_URL,
        tableName: 'admin_sessions',
        createTableIfMissing: true,
        pruneSessionInterval: 60 * 60,  // prune expired rows every hour
        ssl: { rejectUnauthorized: false },
      })
    : undefined,  // in-memory store for local dev
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,   // refresh cookie expiry on every request while active
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_MAX_AGE,
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
// R2_JURISDICTION=eu required for EU-jurisdiction buckets (shows EU badge in Cloudflare dashboard)
const _r2Jurisdiction = process.env.R2_JURISDICTION  // e.g. 'eu', leave unset for global
const _r2Endpoint = process.env.R2_ACCOUNT_ID
  ? _r2Jurisdiction
    ? `https://${process.env.R2_ACCOUNT_ID}.${_r2Jurisdiction}.r2.cloudflarestorage.com`
    : `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : null

const r2 = (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && _r2Endpoint)
  ? new S3Client({
      region: 'auto',
      endpoint: _r2Endpoint,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,  // R2 requires path-style URLs (not virtual-hosted)
    })
  : null
const R2_BUCKET = process.env.R2_BUCKET || 'nutrition-app-images'

if (r2) {
  const keyId = process.env.R2_ACCESS_KEY_ID || ''
  const keyPreview = keyId.length > 8 ? `${keyId.slice(0,4)}...${keyId.slice(-4)} (${keyId.length} chars)` : `[too short: ${keyId.length} chars]`
  console.log(`R2 client created → endpoint: ${_r2Endpoint}${_r2Jurisdiction ? ` [jurisdiction: ${_r2Jurisdiction}]` : ''}`)
  console.log(`R2 bucket: "${R2_BUCKET}" | access key: ${keyPreview}`)
  // Startup write test — confirms credentials + bucket are valid
  r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: '_ping', Body: Buffer.from('1'), ContentType: 'text/plain' }))
    .then(() => console.log(`R2 write test: ✓ OK`))
    .catch(e => {
      const code = e.$metadata?.httpStatusCode
      console.error(`R2 write test FAILED → HTTP ${code} | name: ${e.name} | msg: ${e.message}`)
      if (code === 404) console.error(`  → 404 = bucket "${R2_BUCKET}" not found. Check: (1) bucket name matches exactly, (2) R2 token was created in R2 section (not Account API Tokens)`)
      if (code === 403) console.error(`  → 403 = credentials valid but no permission. Check token has "Object Read & Write" for this bucket.`)
      if (code === 401) console.error(`  → 401 = invalid credentials. You may have used a Cloudflare Bearer API token instead of an R2 S3 token.`)
    })
} else {
  console.log('R2 not configured — image proxy uses memory cache only')
}

// Stable R2 key from URL: images/<md5>.<ext>
function r2Key(url) {
  const hash = createHash('md5').update(url).digest('hex')
  const ext  = url.match(/\.(jpe?g|png|webp|avif|gif)(\?|$)/i)?.[1]?.replace('jpeg','jpg') || 'jpg'
  return `images/${hash}.${ext}`
}

// Proactively cache a single image URL into R2 under its image-proxy key.
// Stores under r2Key(url) so a later /api/image-proxy?url=<url> request is an instant R2 hit.
// No-op if R2 is unconfigured or the object already exists.
async function cacheImageToR2(url) {
  if (!r2 || typeof url !== 'string' || !url) return  // skip non-string/empty defensively
  const key = r2Key(url)
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
    return  // already in R2
  } catch (e) {
    if (e.$metadata?.httpStatusCode !== 404 && e.name !== 'NotFound' && e.name !== 'NoSuchKey') return
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return
    const buf = Buffer.from(await res.arrayBuffer())
    const ct  = res.headers.get('content-type') || 'image/jpeg'
    await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: ct }))
  } catch (_) { /* best-effort — image-proxy will retry lazily on first view */ }
}

// Cache a list of image URLs into R2 with bounded concurrency.
async function cacheImagesToR2(urls, concurrency = 6) {
  if (!r2) return
  const list = [...new Set(urls.filter(Boolean))]
  for (let i = 0; i < list.length; i += concurrency) {
    await Promise.all(list.slice(i, i + concurrency).map(cacheImageToR2))
  }
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
      })).catch(e => console.error(`R2 put error → HTTP ${e.$metadata?.httpStatusCode} | ${e.name} | ${e.message} | bucket: ${R2_BUCKET}`))
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

const _cacheJob = {
  running: false, total: 0, done: 0,
  skipped: 0,   // files already in R2 (no download needed)
  newlyCached: 0, // files downloaded and saved this run
  errors: 0,
  startedAt: null, finishedAt: null, cancelled: false,
}

async function runImageCacheJob() {
  if (!r2 || !pool)  return
  if (_cacheJob.running) return  // already running

  _cacheJob.running     = true
  _cacheJob.cancelled   = false
  _cacheJob.done        = 0
  _cacheJob.skipped     = 0
  _cacheJob.newlyCached = 0
  _cacheJob.errors      = 0
  _cacheJob.startedAt   = new Date().toISOString()
  _cacheJob.finishedAt  = null

  try {
    // Collect all unique image URLs: meal photos + restaurant photos
    const [mealsRes, restaurantsRes] = await Promise.all([
      pool.query(`
        SELECT DISTINCT image_url AS url FROM menu_items
        WHERE image_url IS NOT NULL AND image_url <> ''
          AND source = 'wolt_menu'
          AND calories IS NOT NULL
          AND (category IS NULL OR category != 'drink')
      `),
      pool.query(`
        SELECT DISTINCT photo_url AS url FROM restaurants
        WHERE photo_url IS NOT NULL AND photo_url <> ''
      `),
    ])
    // Merge into one deduplicated list
    const allUrls = [...new Set([
      ...mealsRes.rows.map(r => r.url),
      ...restaurantsRes.rows.map(r => r.url),
    ])]
    const rows = allUrls.map(url => ({ image_url: url }))
    _cacheJob.total = rows.length
    console.log(`Image cache job started: ${rows.length} unique URLs (${mealsRes.rows.length} meal + ${restaurantsRes.rows.length} restaurant photos)`)

    const CONCURRENCY = 8  // parallel fetches — don't overwhelm Wolt or the server
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (!_cacheJob.running) { _cacheJob.cancelled = true; break }  // stopped by user
      await Promise.all(rows.slice(i, i + CONCURRENCY).map(async ({ image_url: url }) => {
        try {
          const key = r2Key(url)
          // Check if already in R2 — skip download if so
          try {
            await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
            _cacheJob.skipped++
            _cacheJob.done++
            return  // already cached — no download needed
          } catch (e) {
            if (e.$metadata?.httpStatusCode !== 404 && e.name !== 'NotFound' && e.name !== 'NoSuchKey') throw e
          }
          // Not in R2 yet — fetch from Wolt and upload
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          const ct  = res.headers.get('content-type') || 'image/jpeg'
          await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: ct }))
          _cacheJob.newlyCached++
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
    console.log(`Image cache job finished: ${_cacheJob.skipped} skipped, ${_cacheJob.newlyCached} new, ${_cacheJob.errors} errors`)
    // Only persist stats on natural completion (not user-cancelled) to avoid
    // overwriting a good previous sync record with partial data.
    if (!_cacheJob.cancelled) {
      saveR2SyncStats().catch(e => console.warn('Could not persist R2 sync stats:', e.message))
      logActivity(_cacheJob.errors > 0 ? 'error' : 'success', 'Photos resynced to R2',
        `${_cacheJob.newlyCached} new · ${_cacheJob.skipped} cached${_cacheJob.errors ? ` · ${_cacheJob.errors} errors` : ''}`)
    }
  }
}

// ── R2 sync stats persistence ─────────────────────────────────────────────────
const R2_SYNC_INTERVAL_DAYS = 7

async function saveR2SyncStats() {
  if (!pool) return
  const stats = {
    total: _cacheJob.total, done: _cacheJob.done,
    skipped: _cacheJob.skipped, newlyCached: _cacheJob.newlyCached,
    errors: _cacheJob.errors, finishedAt: _cacheJob.finishedAt,
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`
    INSERT INTO admin_settings (key, value, updated_at)
    VALUES ('r2_last_sync', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
  `, [JSON.stringify(stats)])
}

async function loadR2SyncStats() {
  if (!pool) return
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    const { rows } = await pool.query(`SELECT value FROM admin_settings WHERE key = 'r2_last_sync'`)
    if (rows.length) {
      const s = rows[0].value
      _cacheJob.total       = s.total       || 0
      _cacheJob.done        = s.done        || 0
      _cacheJob.skipped     = s.skipped     || 0
      _cacheJob.newlyCached = s.newlyCached || 0
      _cacheJob.errors      = s.errors      || 0
      _cacheJob.finishedAt  = s.finishedAt  || null
      console.log(`R2 sync stats loaded from DB: ${s.total} total, finished ${s.finishedAt}`)
    }
  } catch (e) {
    console.warn('Could not load R2 sync stats:', e.message)
  }
}
// Warm up on startup
loadR2SyncStats().catch(() => {})

// ── Admin panel ───────────────────────────────────────────────────────────────

// District id ↔ GeoJSON Gemeinde_name mapping (same as admin/map.jsx)
const GEO_NAME_MAP = {
  'Mitte':                      'mitte',
  'Friedrichshain-Kreuzberg':   'fhain',
  'Pankow':                     'pankow',
  'Charlottenburg-Wilmersdorf': 'cwilm',
  'Spandau':                    'spandau',
  'Steglitz-Zehlendorf':        'steglitz',
  'Tempelhof-Schöneberg':       'tempel',
  'Neukölln':                   'neuk',
  'Treptow-Köpenick':           'treptow',
  'Marzahn-Hellersdorf':        'marzahn',
  'Lichtenberg':                'lich',
  'Reinickendorf':              'rein',
}
const DISTRICT_NAMES = Object.fromEntries(Object.entries(GEO_NAME_MAP).map(([k,v]) => [v,k]))

// District polygon cache — loaded once from official Berlin GeoJSON.
// Falls back to simplified hardcoded polygons if fetch fails.
let _berlinPolygons = null  // Map<id, [[lat,lng][]]> — each value is array of rings

async function loadBerlinPolygons() {
  if (_berlinPolygons) return _berlinPolygons
  try {
    const res = await fetch('https://cdn.jsdelivr.net/gh/funkeinteraktiv/Berlin-Geodaten@master/berlin_bezirke.geojson')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const gj = await res.json()
    _berlinPolygons = new Map()
    for (const feature of gj.features) {
      const geoName = feature.properties.Gemeinde_name || feature.properties.name
      const id = GEO_NAME_MAP[geoName]
      if (!id) continue
      const geom = feature.geometry
      const rings = []
      if (geom.type === 'Polygon') {
        // GeoJSON: [[[lng,lat],...]] — use outer ring only, convert to [lat,lng]
        rings.push(geom.coordinates[0].map(([lng, lat]) => [lat, lng]))
      } else if (geom.type === 'MultiPolygon') {
        // GeoJSON: [[[[lng,lat],...],...]] — outer ring of each sub-polygon
        for (const poly of geom.coordinates) {
          rings.push(poly[0].map(([lng, lat]) => [lat, lng]))
        }
      }
      _berlinPolygons.set(id, rings)
    }
    console.log(`Berlin GeoJSON loaded: ${_berlinPolygons.size} district polygons`)
    return _berlinPolygons
  } catch (e) {
    console.error('Berlin GeoJSON fetch failed, using simplified fallback:', e.message)
    return null
  }
}

// Warm up polygon cache at startup
loadBerlinPolygons().catch(() => {})

// Ray-casting point-in-polygon (lat/lng, ring = [[lat,lng],...])
function pointInPolygon(lat, lng, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside
  }
  return inside
}

// Check if point is inside any of the district's polygon rings (handles MultiPolygon)
function pointInDistrict(lat, lng, rings) {
  return rings.some(ring => pointInPolygon(lat, lng, ring))
}

// Fallback simplified polygons used only when GeoJSON fetch fails
const BERLIN_DISTRICTS_FALLBACK = [
  { id: 'mitte',    name: 'Mitte',                      polygon: [[52.558,13.337],[52.563,13.372],[52.560,13.403],[52.542,13.432],[52.517,13.438],[52.499,13.418],[52.494,13.385],[52.502,13.352],[52.521,13.336]] },
  { id: 'fhain',    name: 'Friedrichshain-Kreuzberg',   polygon: [[52.517,13.438],[52.527,13.484],[52.512,13.494],[52.497,13.476],[52.487,13.447],[52.490,13.421],[52.499,13.418]] },
  { id: 'pankow',   name: 'Pankow',                     polygon: [[52.558,13.403],[52.563,13.370],[52.621,13.380],[52.638,13.423],[52.635,13.481],[52.590,13.485],[52.565,13.465],[52.542,13.432]] },
  { id: 'cwilm',    name: 'Charlottenburg-Wilmersdorf', polygon: [[52.521,13.336],[52.502,13.352],[52.494,13.320],[52.466,13.268],[52.472,13.252],[52.517,13.252],[52.537,13.300]] },
  { id: 'spandau',  name: 'Spandau',                    polygon: [[52.537,13.300],[52.517,13.252],[52.572,13.120],[52.583,13.186],[52.561,13.265],[52.554,13.297]] },
  { id: 'steglitz', name: 'Steglitz-Zehlendorf',        polygon: [[52.472,13.252],[52.466,13.268],[52.442,13.268],[52.384,13.206],[52.382,13.156],[52.410,13.152],[52.468,13.186],[52.481,13.232]] },
  { id: 'tempel',   name: 'Tempelhof-Schöneberg',       polygon: [[52.494,13.385],[52.490,13.421],[52.487,13.447],[52.461,13.442],[52.444,13.425],[52.440,13.374],[52.444,13.330],[52.462,13.315],[52.480,13.320],[52.494,13.352]] },
  { id: 'neuk',     name: 'Neukölln',                   polygon: [[52.490,13.421],[52.497,13.476],[52.487,13.490],[52.459,13.483],[52.444,13.468],[52.438,13.443],[52.444,13.425],[52.461,13.442]] },
  { id: 'treptow',  name: 'Treptow-Köpenick',           polygon: [[52.487,13.447],[52.497,13.476],[52.512,13.494],[52.517,13.560],[52.490,13.680],[52.416,13.708],[52.382,13.616],[52.384,13.490],[52.432,13.454],[52.444,13.468],[52.459,13.483]] },
  { id: 'marzahn',  name: 'Marzahn-Hellersdorf',        polygon: [[52.565,13.465],[52.590,13.485],[52.582,13.660],[52.519,13.658],[52.499,13.584],[52.510,13.527],[52.517,13.560],[52.512,13.494],[52.527,13.484],[52.542,13.432],[52.560,13.450]] },
  { id: 'lich',     name: 'Lichtenberg',                polygon: [[52.542,13.432],[52.560,13.450],[52.560,13.528],[52.519,13.570],[52.517,13.560],[52.512,13.494],[52.527,13.484]] },
  { id: 'rein',     name: 'Reinickendorf',              polygon: [[52.563,13.372],[52.558,13.337],[52.554,13.297],[52.561,13.265],[52.583,13.186],[52.641,13.210],[52.641,13.340],[52.638,13.423],[52.621,13.380]] },
]

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

// ── Script job tracker ────────────────────────────────────────────────────────
const _scriptJobs = {}  // id → job object

function getScriptJob(id) {
  if (!_scriptJobs[id]) {
    _scriptJobs[id] = {
      running: false, total: 0, done: 0, errors: 0, skipped: 0, newItems: 0,
      startedAt: null, finishedAt: null, cancelled: false, districtId: null,
      // Google Place Enricher specific
      nearbySearchCalls: 0, detailsCalls: 0, findPlaceCalls: 0, enabledFields: [],
      // Macros script specific
      inputTokens: 0, outputTokens: 0,
      // Wolt config (persisted separately)
      configLimit: null,
    }
  }
  return _scriptJobs[id]
}

async function saveScriptStats(id) {
  if (!pool) return
  const job = getScriptJob(id)
  try {
    await pool.query(`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    `, [`script_${id}_last_run`, JSON.stringify(job)])
  } catch (e) {
    console.warn(`Could not persist script stats for ${id}:`, e.message)
  }
}

async function loadScriptStats() {
  if (!pool) return
  try {
    const { rows } = await pool.query(`
      SELECT key, value FROM admin_settings
      WHERE key LIKE 'script_%_last_run' OR key = 'script_wolt_config_limit'
    `)
    for (const row of rows) {
      // Load wolt configLimit separately (it's a config, not a run stat)
      if (row.key === 'script_wolt_config_limit') {
        const job = getScriptJob('wolt')
        job.configLimit = row.value !== null && row.value !== 'null' ? Number(row.value) : null
        continue
      }
      const match = row.key.match(/^script_(.+)_last_run$/)
      if (!match) continue
      const id = match[1]
      const s = row.value
      const existing = _scriptJobs[id] || {}
      _scriptJobs[id] = {
        running:          false,
        total:            s.total           || 0,
        done:             s.done            || 0,
        errors:           s.errors          || 0,
        skipped:          s.skipped         || 0,
        newItems:         s.newItems        || 0,
        startedAt:        s.startedAt       || null,
        finishedAt:       s.finishedAt      || null,
        cancelled:        false,
        districtId:       s.districtId      || null,
        // Google enricher stats
        nearbySearchCalls: s.nearbySearchCalls || 0,
        detailsCalls:     s.detailsCalls    || 0,
        findPlaceCalls:   s.findPlaceCalls  || 0,
        enabledFields:    s.enabledFields   || [],
        // Macros stats
        inputTokens:      s.inputTokens     || 0,
        outputTokens:     s.outputTokens    || 0,
        // Preserve configLimit if already loaded
        configLimit:      existing.configLimit ?? null,
      }
    }
    console.log(`Script stats loaded from DB for: ${Object.keys(_scriptJobs).join(', ') || '(none)'}`)
  } catch (e) {
    console.warn('Could not load script stats:', e.message)
  }
}
// Warm up on startup
loadScriptStats().catch(() => {})

// ── Activity log ────────────────────────────────────────────────────────────────
// Persistent event feed shown in the admin "Activity · last 24h" panel.
async function ensureActivitySchema() {
  if (!pool) return
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_activity (
        id         SERIAL PRIMARY KEY,
        kind       TEXT NOT NULL,          -- 'success' | 'error' | 'info'
        text       TEXT NOT NULL,
        sub        TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS admin_activity_created_idx ON admin_activity (created_at DESC)`)
  } catch (e) {
    console.warn('ensureActivitySchema:', e.message)
  }
}
ensureActivitySchema().catch(() => {})

// Append an activity entry (best-effort — never throws into the caller)
async function logActivity(kind, text, sub = null) {
  if (!pool) return
  try {
    await pool.query(`INSERT INTO admin_activity (kind, text, sub) VALUES ($1, $2, $3)`, [kind, text, sub])
  } catch (e) {
    console.warn('logActivity:', e.message)
  }
}

// Display name for a district slug ('mitte' → 'Mitte'); null → 'Berlin'
function districtLabel(districtId) {
  return districtId ? (DISTRICT_NAMES[districtId] || districtId) : 'Berlin'
}

// Compact relative-time string for the activity feed ('2m', '8m', '1h', '3d')
function msToRelativeServer(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60)  return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// ── Macros + Meal Type script (real Claude-powered implementation) ─────────────
async function runMacrosScript(districtId) {
  const job = getScriptJob('macros')
  if (job.running) return

  job.running      = true
  job.cancelled    = false
  job.done         = 0
  job.errors       = 0
  job.skipped      = 0
  job.newItems     = 0
  job.total        = 0
  job.inputTokens  = 0
  job.outputTokens = 0
  job.startedAt    = new Date().toISOString()
  job.finishedAt   = null
  job.districtId   = districtId || null

  try {
    // Query meals needing processing
    const { rows: meals } = await pool.query(`
      SELECT m.id, m.name, r.lat, r.lon
      FROM menu_items m
      JOIN restaurants r ON r.id = m.restaurant_id
      WHERE m.source = 'wolt_menu'
        AND (m.calories IS NULL OR m.meal_times IS NULL OR array_length(m.meal_times, 1) IS NULL)
        AND r.lat IS NOT NULL AND r.lon IS NOT NULL
    `)

    // Filter by district if requested
    let filtered = meals
    if (districtId) {
      const polygons = await loadBerlinPolygons()
      if (polygons && polygons.has(districtId)) {
        const rings = polygons.get(districtId)
        filtered = meals.filter(m => pointInDistrict(parseFloat(m.lat), parseFloat(m.lon), rings))
      }
    }

    job.total = filtered.length
    console.log(`Macros script started: ${filtered.length} meals to process${districtId ? ` in ${districtId}` : ''}`)
    logActivity('info', 'Macros Estimator started', `${districtLabel(districtId)} · ${filtered.length} meals queued`)

    const BATCH_SIZE = 20
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      if (!job.running) { job.cancelled = true; break }

      const batch = filtered.slice(i, i + BATCH_SIZE)
      try {
        const prompt = `You are a nutrition expert. Estimate macros per serving and classify meal type for these dishes.
Return ONLY a valid JSON array, no markdown, no explanation. One object per dish in order:
[{"i":1,"cal":480,"pro":28.5,"fat":18.0,"carb":42.0,"conf":"high","mt":"lunch"}, ...]
Fields: i=1-based index, cal=calories(kcal integer), pro=protein(g,1dp), fat=fat(g,1dp), carb=carbs(g,1dp), conf="high"|"medium"|"low", mt="breakfast"|"lunch"|"dinner"|"snack"|"all_day"
Dishes:
${batch.map((r, idx) => `${idx + 1}. "${r.name}"`).join('\n')}`

        const message = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        })
        job.inputTokens  += message.usage?.input_tokens  || 0
        job.outputTokens += message.usage?.output_tokens || 0

        const raw = message.content[0].text.replace(/```json\n?|\n?```/g, '').trim()
        const results = JSON.parse(raw)

        for (const res of results) {
          if (!job.running) { job.cancelled = true; break }
          const idx = (res.i || 1) - 1
          if (idx < 0 || idx >= batch.length) continue
          const meal = batch[idx]

          const mealTimesArr = res.mt === 'all_day'
            ? ['breakfast', 'lunch', 'dinner', 'snack']
            : [res.mt]

          const { rowCount } = await pool.query(`
            UPDATE menu_items SET
              calories   = COALESCE(calories,   $2),
              protein    = COALESCE(protein,    $3),
              fat        = COALESCE(fat,        $4),
              carbs      = COALESCE(carbs,      $5),
              confidence = COALESCE(confidence, $6),
              meal_times = COALESCE(meal_times, $7)
            WHERE id = $1
          `, [meal.id, res.cal, res.pro, res.fat, res.carb, res.conf, mealTimesArr])

          if (rowCount > 0) job.newItems++
          job.done++
        }
      } catch (e) {
        console.error(`Macros script batch error (offset ${i}):`, e.message)
        job.errors += batch.length
        job.done   += batch.length
      }

      if (job.running && i + BATCH_SIZE < filtered.length) {
        await new Promise(r => setTimeout(r, 150))
      }
    }
  } catch (e) {
    console.error('Macros script error:', e.message)
  } finally {
    job.running    = false
    job.finishedAt = new Date().toISOString()
    console.log(`Macros script finished: ${job.done} processed, ${job.newItems} updated, ${job.errors} errors`)
    if (!job.cancelled) {
      saveScriptStats('macros').catch(e => console.warn('Could not persist macros stats:', e.message))
      logActivity(job.errors > 0 ? 'error' : 'success', 'Macros Estimator completed',
        `${districtLabel(job.districtId)} · ${job.newItems} meals scored${job.errors ? ` · ${job.errors} errors` : ''}`)
    }
  }
}

// ── Dedup script (pure SQL — no external APIs) ────────────────────────────────
async function runDedupScript(districtId) {
  const job = getScriptJob('dedup')
  if (job.running) return
  job.running = true; job.cancelled = false; job.done = 0; job.errors = 0
  job.newItems = 0; job.total = 0; job.startedAt = new Date().toISOString()
  job.finishedAt = null; job.districtId = districtId || null

  try {
    // Find duplicate groups: same restaurant + same name (case-insensitive)
    // ids sorted: best confidence first, then highest id (most recent wins)
    const { rows: groups } = await pool.query(`
      SELECT restaurant_id,
             array_agg(id ORDER BY
               CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               id DESC
             ) AS ids
      FROM menu_items
      WHERE source = 'wolt_menu'
      GROUP BY restaurant_id, LOWER(name)
      HAVING COUNT(*) > 1
    `)

    let filteredGroups = groups
    if (districtId) {
      const polygons = await loadBerlinPolygons()
      if (polygons && polygons.has(districtId)) {
        const rings = polygons.get(districtId)
        const { rows: rests } = await pool.query(
          `SELECT id, lat, lon FROM restaurants WHERE lat IS NOT NULL AND lon IS NOT NULL`
        )
        const inDistrict = new Set(
          rests
            .filter(r => pointInDistrict(parseFloat(r.lat), parseFloat(r.lon), rings))
            .map(r => r.id)
        )
        filteredGroups = groups.filter(g => inDistrict.has(g.restaurant_id))
      }
    }

    // Collect ids to delete (keep ids[0] = best; delete the rest)
    const toDelete = []
    for (const g of filteredGroups) toDelete.push(...g.ids.slice(1))
    job.total = toDelete.length

    console.log(`Dedup script: ${toDelete.length} duplicates to remove${districtId ? ` in ${districtId}` : ''}`)

    const BATCH = 500
    for (let i = 0; i < toDelete.length; i += BATCH) {
      if (!job.running) { job.cancelled = true; break }
      const batch = toDelete.slice(i, i + BATCH)
      try {
        const { rowCount } = await pool.query(
          `DELETE FROM menu_items WHERE id = ANY($1::int[])`,
          [batch]
        )
        job.done += rowCount
        job.newItems += rowCount
      } catch (e) {
        console.error('Dedup batch error:', e.message)
        job.errors += batch.length
        job.done += batch.length
      }
    }
  } catch (e) {
    console.error('Dedup script error:', e.message)
    job.errors++
  } finally {
    job.running = false
    job.finishedAt = new Date().toISOString()
    console.log(`Dedup finished: ${job.newItems} duplicates removed, ${job.errors} errors`)
    if (!job.cancelled) {
      saveScriptStats('dedup').catch(() => {})
      logActivity(job.errors > 0 ? 'error' : 'success', 'Duplicate detection completed',
        `${districtLabel(job.districtId)} · ${job.newItems} duplicates removed`)
    }
  }
}

// ── Google Place enricher (HTTP-only, no Playwright) ──────────────────────────
// Enriches existing restaurants with Google Place data: hours, rating, etc.
// ── Google Places schema migration (runs once at startup) ────────────────────
async function ensureGooglePlacesColumns() {
  if (!pool) return
  try {
    await pool.query(`
      ALTER TABLE restaurants
        ADD COLUMN IF NOT EXISTS google_place_id    TEXT,
        ADD COLUMN IF NOT EXISTS website            TEXT,
        ADD COLUMN IF NOT EXISTS phone              TEXT,
        ADD COLUMN IF NOT EXISTS google_enriched_at TIMESTAMPTZ
    `)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS restaurants_google_place_id_idx
        ON restaurants (google_place_id) WHERE google_place_id IS NOT NULL
    `)
  } catch (e) {
    console.warn('ensureGooglePlacesColumns:', e.message)
  }
}
ensureGooglePlacesColumns().catch(() => {})

// Maps UI checkbox labels → Google Place Details API field names (enricher only)
const GPLACE_FIELD_MAP = {
  'Phone number':            'formatted_phone_number',
  'Website':                 'website',
  'Opening hours (dine-in)': 'opening_hours',
  'Google photo → R2':       'photos',
}
// Always requested: identity + coordinates + address + rating (always useful, small Atmosphere tier cost)
const GPLACE_FIELDS_BASE = 'place_id,name,geometry,formatted_address,rating,user_ratings_total'

// ── Google Place Enricher ──────────────────────────────────────────────────────
// Enriches existing Wolt restaurants with Google data. Google data is PRIORITY:
//   - photo (downloaded → R2 → stored as permanent URL, overwrites Wolt)
//   - phone, website: always set to Google value
//   - opening_hours, address, rating, reviews: Google if found, else keep Wolt
// Never inserts new restaurants (Wolt is the discovery source).
// enabledFields: array of UI label strings (from checkboxes). If empty → fetch all.
async function runGooglePlaceScript(districtId, enabledFields = [], limit = null) {
  const job = getScriptJob('gplace')
  if (job.running) return
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    console.error('Google Place enricher: GOOGLE_PLACES_API_KEY not set')
    job.errors = 1; job.finishedAt = new Date().toISOString(); return
  }

  job.running = true; job.cancelled = false; job.done = 0; job.errors = 0
  job.newItems = 0; job.total = 0; job.startedAt = new Date().toISOString()
  job.finishedAt = null; job.districtId = districtId || null
  job.nearbySearchCalls = 0; job.detailsCalls = 0; job.findPlaceCalls = 0
  job.enabledFields = enabledFields.length > 0 ? enabledFields : Object.keys(GPLACE_FIELD_MAP)

  // Build Place Details fields string from enabled checkboxes
  const requestedApiFields = job.enabledFields.flatMap(label => (GPLACE_FIELD_MAP[label] || '').split(',').filter(Boolean))
  const detailFields = [GPLACE_FIELDS_BASE, ...new Set(requestedApiFields)].join(',')
  console.log(`Google Place enricher: requesting fields: ${detailFields}`)

  try {
    await ensureGooglePlacesColumns()

    // ── Step 1: Find all Wolt restaurants in this district ──────────────────
    let rings = null
    let bbox = null
    if (districtId) {
      const polygons = await loadBerlinPolygons()
      if (polygons?.has(districtId)) {
        rings = polygons.get(districtId)
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
        for (const ring of rings) for (const [lat, lng] of ring) {
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
          if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng
        }
        bbox = { minLat, maxLat, minLng, maxLng }
      }
    }

    let restaurants
    // Only enrich restaurants NOT yet processed by Google (google_enriched_at IS NULL).
    // Existing/already-enriched restaurants are skipped — their Google data is kept as-is.
    // ORDER BY id DESC → most recently added restaurants first (so a limited run
    // enriches the freshly-discovered ones, e.g. the batch Wolt just added).
    if (districtId && bbox) {
      const { rows } = await pool.query(`
        SELECT id, name, lat, lon AS lng, address, google_place_id
        FROM restaurants
        WHERE wolt_slug IS NOT NULL
          AND google_enriched_at IS NULL
          AND lat IS NOT NULL AND lon IS NOT NULL
          AND lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4
        ORDER BY id DESC
      `, [bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng])
      restaurants = rings
        ? rows.filter(r => pointInDistrict(parseFloat(r.lat), parseFloat(r.lng), rings))
        : rows
    } else {
      const { rows } = await pool.query(`
        SELECT id, name, lat, lon AS lng, address, google_place_id
        FROM restaurants
        WHERE wolt_slug IS NOT NULL AND google_enriched_at IS NULL
          AND lat IS NOT NULL AND lon IS NOT NULL
        ORDER BY id DESC
      `)
      restaurants = rows
    }

    // Apply limit AFTER the polygon filter so we get exactly N in-district restaurants
    if (limit && restaurants.length > limit) restaurants = restaurants.slice(0, limit)

    job.total = restaurants.length
    console.log(`Google Place enricher: ${restaurants.length} Wolt restaurants to enrich${districtId ? ` in ${districtId}` : ''}${limit ? ` (limit ${limit})` : ''}`)
    logActivity('info', 'Google Place Enricher started', `${districtLabel(districtId)} · ${restaurants.length} restaurants to enrich`)

    for (const r of restaurants) {
      if (!job.running) { job.cancelled = true; break }

      try {
        let placeId = r.google_place_id

        // ── Step 2: FindPlace by name + address (skip if place_id already known) ──
        if (!placeId) {
          const query = r.address
            ? `${r.name}, ${r.address}`
            : `${r.name}, Berlin`
          const fpUrl =
            `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
            `?input=${encodeURIComponent(query)}&inputtype=textquery` +
            `&locationbias=circle:200@${r.lat},${r.lng}` +
            `&fields=place_id&key=${apiKey}`
          const fpRes = await fetch(fpUrl)
          job.findPlaceCalls++
          const fpData = await fpRes.json()

          if (fpData.status === 'REQUEST_DENIED') {
            console.error('Google Places API denied:', fpData.error_message)
            job.errors++
            break
          }

          placeId = fpData.candidates?.[0]?.place_id || null
          if (!placeId) {
            // Not found on Google — stamp as processed so we don't retry, keep Wolt data
            await pool.query(`UPDATE restaurants SET google_enriched_at = NOW() WHERE id = $1`, [r.id])
            job.done++; continue
          }
        }

        // ── Step 3: Place Details ────────────────────────────────────────────
        const detailUrl =
          `https://maps.googleapis.com/maps/api/place/details/json` +
          `?place_id=${placeId}` +
          `&fields=${detailFields}` +
          `&key=${apiKey}`
        const detailRes = await fetch(detailUrl)
        job.detailsCalls++
        const d = (await detailRes.json()).result
        if (!d) {
          await pool.query(`UPDATE restaurants SET google_enriched_at = NOW() WHERE id = $1`, [r.id])
          job.done++; continue
        }

        // ── Step 4: Download photo → upload to R2 → get permanent URL ────────
        let photoUrl = null
        const photoRef = d.photos?.[0]?.photo_reference
        if (photoRef && job.enabledFields.includes('Google photo → R2')) {
          const googlePhotoUrl =
            `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${apiKey}`
          try {
            if (r2 && process.env.R2_PUBLIC_URL) {
              // R2 configured with public URL — download + upload, store permanent URL
              const imgRes = await fetch(googlePhotoUrl)
              if (imgRes.ok) {
                const imgBuf = Buffer.from(await imgRes.arrayBuffer())
                const r2PhotoKey = `restaurants/${r.id}/photo.jpg`
                await r2.send(new PutObjectCommand({
                  Bucket: R2_BUCKET,
                  Key: r2PhotoKey,
                  Body: imgBuf,
                  ContentType: 'image/jpeg',
                }))
                photoUrl = `${process.env.R2_PUBLIC_URL}/${r2PhotoKey}`
              }
            } else {
              // R2 not configured or no public URL — store Google CDN URL without key
              // (frontend strips &key= before storing; withKey() re-adds it at render time)
              photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}`
            }
          } catch (photoErr) {
            console.warn(`gplace photo upload error for restaurant ${r.id}:`, photoErr.message)
            // photoUrl stays null → COALESCE keeps Wolt's photo
          }
        }

        // ── Step 5: UPDATE restaurant — Google data OVERWRITES Wolt ──────────
        await pool.query(`
          UPDATE restaurants SET
            google_place_id    = COALESCE(google_place_id, $2),
            phone              = COALESCE($3, phone),
            website            = COALESCE($4, website),
            opening_hours      = COALESCE($5::jsonb, opening_hours),
            photo_url          = COALESCE($6, photo_url),
            address            = COALESCE($7, address),
            rating             = COALESCE($8::numeric, rating),
            reviews_count      = COALESCE($9::int, reviews_count),
            google_enriched_at = NOW()
          WHERE id = $1
        `, [
          r.id,
          placeId,
          d.formatted_phone_number || null,
          d.website                || null,
          d.opening_hours          ? JSON.stringify(d.opening_hours) : null,
          photoUrl,
          d.formatted_address      || null,
          d.rating                 || null,
          d.user_ratings_total     || null,
        ])
        job.newItems++
        job.done++
      } catch (e) {
        console.error(`gplace enricher error for restaurant ${r.id} (${r.name}):`, e.message)
        job.errors++
        job.done++
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } catch (e) {
    console.error('Google Place enricher error:', e.message)
    job.errors++
  } finally {
    job.running = false
    job.finishedAt = new Date().toISOString()
    console.log(`Google Place enricher finished: ${job.newItems} enriched, ${job.findPlaceCalls} FindPlace, ${job.detailsCalls} Details calls, ${job.errors} errors`)
    if (!job.cancelled) {
      saveScriptStats('gplace').catch(() => {})
      logActivity(job.errors > 0 ? 'error' : 'success', 'Google Place Enricher completed',
        `${districtLabel(job.districtId)} · ${job.newItems} restaurants enriched${job.errors ? ` · ${job.errors} errors` : ''}`)
    }
  }
}

// ── Wolt schema migrations ────────────────────────────────────────────────────
// Note on identity: restaurants.id is a TEXT primary key that historically held the
// Google Place ID (the original data was Google-first). Wolt-discovered restaurants
// have no Google id, so runWoltScript supplies a synthetic text id ('wolt:' + slug).
// menu_items.id already has its own integer sequence default — nothing to migrate.
async function ensureWoltSchema() {
  if (!pool) return
  try {
    // 1. Remove any duplicate wolt_slug rows (keep highest id = most recent)
    await pool.query(`
      DELETE FROM restaurants a
      USING restaurants b
      WHERE a.wolt_slug IS NOT NULL
        AND a.wolt_slug = b.wolt_slug
        AND a.id < b.id
    `)
    // 2. Unique index on wolt_slug so ON CONFLICT works correctly
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS restaurants_wolt_slug_idx
        ON restaurants (wolt_slug) WHERE wolt_slug IS NOT NULL
    `)
    // Note: we deliberately do NOT create a unique index on menu_items
    // (restaurant_id, LOWER(name)) — existing imported data contains duplicate
    // dishes, so the index can't be built. The menu insert uses an idempotent
    // INSERT ... WHERE NOT EXISTS guard instead (see runWoltScript).
  } catch (e) {
    console.warn('ensureWoltSchema:', e.message)
  }
}
ensureWoltSchema().catch(() => {})

// ── Wolt Scraper ──────────────────────────────────────────────────────────────
// 1. Discovers venues in the district via Wolt API (paginated from centre outward)
// ── Wolt menu scraper (Playwright) ────────────────────────────────────────────
// Mirrors the original Python wolt_scanner.py approach:
//   open wolt.com/de/deu/berlin/restaurant/{slug} in headless Chromium,
//   wait for page to settle, then query DOM card elements.
async function scrapeWoltMenuPlaywright(page, slug) {
  const url = `https://wolt.com/de/deu/berlin/restaurant/${slug}`

  // Extract all menu cards: name, description (the <p>, e.g. ingredients), price, image.
  const extract = () => page.$$eval("[data-test-id='horizontal-item-card']", cards =>
    cards.map(card => {
      const nameEl  = card.querySelector("[data-test-id='horizontal-item-card-header']")
      const priceEl = card.querySelector("[data-test-id='horizontal-item-card-price']")
      const descEl  = card.querySelector('p')
      const imgEl   = card.querySelector('img')

      const name        = nameEl?.innerText?.trim() || ''
      const description = descEl?.innerText?.trim() || ''
      const priceRaw    = (priceEl?.getAttribute('aria-label') || priceEl?.innerText || '').replace(',', '.')
      const imageUrl    = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || ''

      const m = priceRaw.match(/\d+[.,]?\d*/)
      const price = m ? parseFloat(m[0]) : null

      return { name, description, price, imageUrl }
    }).filter(i => i.name)
  ).catch(() => [])

  // Up to 2 attempts — Wolt occasionally serves a slow/empty page to datacenter IPs,
  // leaving a restaurant with 0 menu items. Reload once before giving up.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    } catch {
      await page.waitForTimeout(3000)
    }
    // Dismiss cookie / consent banner if present
    await page.evaluate(() => {
      document.querySelectorAll("[data-test-id='consents-banner-overlay']").forEach(el => el.remove())
    }).catch(() => {})
    // Wait for the menu cards to actually render (loaded via XHR; networkidle is unreliable here)
    await page.waitForSelector("[data-test-id='horizontal-item-card']", { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(500)

    const items = await extract()
    if (items.length > 0 || attempt === 2) return items
    await page.waitForTimeout(2000)  // brief backoff, then one retry
  }
  return []
}

// ── Wolt scraper ──────────────────────────────────────────────────────────────
// Primary discovery source: discovers venues + extracts full venue data from Wolt API.
// 1. Discovers venues via consumer-api.wolt.com (district centroid + 4 bbox corners,
//    deduped by slug, filtered to the district polygon). Extracts: address, brand photo,
//    rating, reviews count, price range.
// 2. Skips venues that already have a Wolt menu — processes only new / menu-less ones.
// 3. Upserts each venue into restaurants by wolt_slug (COALESCE — Google enricher overwrites later)
//    Uses xmax = 0 to count genuinely new inserts (for limit tracking)
// 4. For restaurants without menus: scrapes menu via Playwright (headless Chromium)
// enabledFields: reserved for future per-field toggling (currently all fields always extracted)
// limit: stop after this many genuinely new restaurant inserts
async function runWoltScript(districtId, enabledFields = [], limit = null) {
  const job = getScriptJob('wolt')
  if (job.running) return
  job.running = true; job.cancelled = false; job.done = 0; job.errors = 0
  job.newItems = 0; job.total = 0; job.startedAt = new Date().toISOString()
  job.finishedAt = null; job.districtId = districtId || null
  job.lastError = null

  try {
    await ensureWoltSchema()

    // District polygon + bounding box
    let rings = null
    let bbox = { minLat: 52.338, maxLat: 52.675, minLng: 13.088, maxLng: 13.761 }  // all Berlin fallback
    if (districtId) {
      const polygons = await loadBerlinPolygons()
      if (polygons?.has(districtId)) {
        rings = polygons.get(districtId)
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
        for (const ring of rings) for (const [lat, lng] of ring) {
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
          if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng
        }
        bbox = { minLat, maxLat, minLng, maxLng }
      }
    }

    // ── Phase 1: discover venues ────────────────────────────────────────────
    // Wolt's API takes a POINT (lat/lon), not a region, and returns ~2000 venues
    // across a wide radius — a single query from the district centroid already
    // covers a compact district. We query the centroid + the 4 bbox corners
    // (insurance for geographically large districts), dedupe by slug, then keep
    // only venues whose coordinates fall inside the district polygon.
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'de-DE,de;q=0.9',
      'Referer': 'https://wolt.com/',
    }
    const cLat = (bbox.minLat + bbox.maxLat) / 2
    const cLng = (bbox.minLng + bbox.maxLng) / 2
    const queryPoints = [
      { lat: cLat, lng: cLng },               // centroid
      { lat: bbox.minLat, lng: bbox.minLng }, // SW corner
      { lat: bbox.minLat, lng: bbox.maxLng }, // SE corner
      { lat: bbox.maxLat, lng: bbox.minLng }, // NW corner
      { lat: bbox.maxLat, lng: bbox.maxLng }, // NE corner
    ]

    const venuesMap = new Map()  // slug → venue data (dedup across query points)
    for (const pt of queryPoints) {
      if (!job.running) { job.cancelled = true; break }
      try {
        const url = `https://consumer-api.wolt.com/v1/pages/restaurants?lat=${pt.lat}&lon=${pt.lng}`
        const res = await fetch(url, { headers })
        if (!res.ok) { await new Promise(r => setTimeout(r, 300)); continue }
        const data = await res.json()
        for (const section of (data.sections || [])) {
          for (const item of (section.items || [])) {
            const v    = item.venue || item
            const slug = v.slug || v.wolt_slug
            if (!slug || venuesMap.has(slug)) continue
            // Wolt returns location as plain [lng, lat] array (GeoJSON order)
            const vLat = Array.isArray(v.location) ? v.location[1] : (v.location?.coordinates?.[1] ?? v.lat)
            const vLng = Array.isArray(v.location) ? v.location[0] : (v.location?.coordinates?.[0] ?? v.lon)
            // Keep only venues inside the selected district polygon
            if (rings && vLat && vLng && !pointInDistrict(parseFloat(vLat), parseFloat(vLng), rings)) continue
            // Extract full venue data from API response
            const address = typeof v.address === 'string' ? v.address
              : v.address?.street_address
                ? `${v.address.street_address}, ${v.address.city || 'Berlin'}`
                : null
            // Note: restaurant photo is intentionally NOT taken from Wolt — Google enricher
            // supplies it (priority). Only meal photos come from Wolt (scraped per dish).
            // Defensive type coercion — Wolt fields vary in type; DB columns are numeric.
            // rating: numeric column. Wolt uses a 0–10 scale → normalise to 0–5 to match Google.
            let rating = (typeof v.rating?.score === 'number' && isFinite(v.rating.score)) ? v.rating.score : null
            if (rating != null && rating > 5) rating = Math.round((rating / 2) * 10) / 10
            const reviewsCount = Number.isInteger(v.rating?.volume) ? v.rating.volume : (parseInt(v.rating?.volume, 10) || null)
            // price_level: integer column 1–4. Wolt price_range may be a string ("€€") or int → keep only valid ints.
            const priceLevel = (Number.isInteger(v.price_range) && v.price_range >= 1 && v.price_range <= 4) ? v.price_range : null
            venuesMap.set(slug, { slug, name: v.name, lat: vLat, lng: vLng, address, rating, reviewsCount, priceLevel })
          }
        }
      } catch (e) {
        console.error(`Wolt discovery point (${pt.lat.toFixed(3)},${pt.lng.toFixed(3)}) error:`, e.message)
      }
      await new Promise(r => setTimeout(r, 350))  // gentle throttle between query points
    }

    const allVenues = [...venuesMap.values()]
    console.log(`Wolt discovery: ${allVenues.length} unique venues inside ${districtLabel(districtId)}`)

    // Skip restaurants that already have a Wolt menu — focus only on NEW / incomplete
    // ones, so the run doesn't churn through everything already in the DB.
    const { rows: completeRows } = await pool.query(`
      SELECT DISTINCT r.wolt_slug AS slug
      FROM restaurants r
      JOIN menu_items m ON m.restaurant_id = r.id AND m.source = 'wolt_menu'
      WHERE r.wolt_slug IS NOT NULL
    `)
    const completeSlugs = new Set(completeRows.map(r => r.slug))
    const venues = allVenues.filter(v => !completeSlugs.has(v.slug))

    // Finish restaurants that already have a row but no menu BEFORE discovering new ones,
    // so the new-restaurant limit can't starve them (they don't count toward the limit).
    const { rows: existingRows } = await pool.query(
      `SELECT wolt_slug AS slug FROM restaurants WHERE wolt_slug IS NOT NULL`
    )
    const existingSlugs = new Set(existingRows.map(r => r.slug))
    venues.sort((a, b) => (existingSlugs.has(b.slug) ? 1 : 0) - (existingSlugs.has(a.slug) ? 1 : 0))

    job.total = venues.length
    console.log(`Wolt script: ${allVenues.length} venues found, ${venues.length} new/incomplete to process${districtId ? ` in ${districtId}` : ''}`)
    logActivity('info', 'Wolt Menu Scraper started', `${districtLabel(districtId)} · ${venues.length} venues${limit ? ` · limit ${limit}` : ''}`)

    // ── Phase 2: upsert restaurants + scrape menus with Playwright ──────────────
    // One browser for the entire run (same pattern as original Python script)
    let browser, page
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      })
      // Real Chrome UA (matches the original working Python scraper) — headless
      // default UA can make Wolt serve a different/empty layout.
      page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      })
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' })
      await page.setViewportSize({ width: 1280, height: 800 })
    } catch (browserErr) {
      console.error('Wolt: could not launch Playwright browser:', browserErr.message)
      job.errors++
      job.lastError = `Chromium launch failed: ${browserErr.message}`
      logActivity('error', 'Wolt scraper failed to start', `Chromium launch failed: ${(browserErr.message || '').slice(0, 160)}`)
      return
    }

    try {
      let limitReached = false
      for (const v of venues) {
        if (!job.running) { job.cancelled = true; break }
        if (limitReached) break  // limit hit on previous iteration — stop (not cancelled, stats persist)
        try {
          // Upsert by wolt_slug — Wolt data as baseline (Google enricher overwrites later).
          // restaurants.id is a TEXT primary key (historically the Google Place ID); a new
          // Wolt restaurant has no Google id, so we supply a synthetic 'wolt:'+slug id.
          // On conflict (existing wolt_slug) the row's original id is kept and returned.
          const woltId = `wolt:${v.slug}`
          const { rows: [restRow] } = await pool.query(`
            INSERT INTO restaurants (id, name, lat, lon, wolt_slug, address, rating, reviews_count, price_level)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (wolt_slug) WHERE wolt_slug IS NOT NULL DO UPDATE SET
              name          = EXCLUDED.name,
              lat           = COALESCE(restaurants.lat,           EXCLUDED.lat),
              lon           = COALESCE(restaurants.lon,           EXCLUDED.lon),
              address       = COALESCE(restaurants.address,       EXCLUDED.address),
              rating        = EXCLUDED.rating,
              reviews_count = EXCLUDED.reviews_count,
              price_level   = COALESCE(restaurants.price_level,   EXCLUDED.price_level)
            RETURNING id, (xmax = 0) AS is_new
          `, [woltId, v.name, v.lat, v.lng, v.slug, v.address || null, v.rating || null, v.reviewsCount || null, v.priceLevel || null])

          if (!restRow) { job.done++; continue }
          const restId = restRow.id

          // Track new restaurant inserts (for limit)
          if (restRow.is_new) job.newItems++

          // Skip menu fetch if restaurant already has menu items
          const { rows: [countRow] } = await pool.query(
            `SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = $1 AND source = 'wolt_menu'`,
            [restId]
          )
          let didScrape = false
          if (parseInt(countRow.n) > 0) {
            job.done++
          } else {
            // Scrape menu via Playwright (headless browser, same as original Python script)
            didScrape = true
            console.log(`Wolt: scraping menu for ${v.slug}`)
            const items = await scrapeWoltMenuPlaywright(page, v.slug)

            if (items.length === 0) {
              console.log(`  — no items found for ${v.slug}`)
            } else {
              let menuAdded = 0
              for (const item of items) {
                try {
                  // Idempotent insert without a unique-index dependency: the partial
                  // unique index can't be built over the existing duplicate dishes, so
                  // we guard with NOT EXISTS instead of ON CONFLICT.
                  const { rowCount } = await pool.query(`
                    INSERT INTO menu_items (restaurant_id, name, description, price, image_url, source)
                    SELECT $1, $2, $3, $4, $5, 'wolt_menu'
                    WHERE NOT EXISTS (
                      SELECT 1 FROM menu_items
                      WHERE restaurant_id = $1 AND LOWER(name) = LOWER($2) AND source = 'wolt_menu'
                    )
                  `, [restId, item.name, item.description || null, item.price, item.imageUrl || null])
                  if (rowCount > 0) menuAdded++
                } catch (e) {
                  // Surface the first menu-insert error instead of swallowing it silently
                  if (!job.lastError) job.lastError = `Menu insert (${v.slug} / "${item.name}"): ${e.message}`
                }
              }
              console.log(`  ${menuAdded} items → ${v.slug}`)

              // Push Wolt meal photos to R2 immediately so they're permanently hosted,
              // not dependent on lazy image-proxy caching. (Restaurant photo comes from Google.)
              await cacheImagesToR2(items.map(it => it.imageUrl))
            }
            job.done++
          }

          // Limit check AFTER the current restaurant is fully processed (menu scraped),
          // so the Nth new restaurant lands on the map with its menu.
          if (limit && job.newItems >= limit) {
            console.log(`Wolt script: limit of ${limit} new restaurants reached`)
            limitReached = true
          }

          // Only pause when we actually hit Wolt (Playwright scrape). Existing
          // restaurants (already have a menu) are DB-only no-ops → no need to throttle,
          // so re-runs of already-populated districts finish in seconds, not minutes.
          if (didScrape && !limitReached) await new Promise(r => setTimeout(r, 1500))
        } catch (e) {
          console.error(`Wolt script venue ${v.slug}:`, e.message)
          job.errors++
          job.done++
          // Surface the first venue error so the real cause is visible in the admin
          if (!job.lastError) job.lastError = `Venue ${v.slug}: ${e.message}`
        }
      }
    } finally {
      await browser.close().catch(() => {})
    }

  } catch (e) {
    console.error('Wolt script error:', e.message)
    job.errors++
  } finally {
    job.running = false
    job.finishedAt = new Date().toISOString()
    console.log(`Wolt finished: ${job.done} venues processed, ${job.newItems} new restaurants, ${job.errors} errors`)
    if (!job.cancelled) {
      saveScriptStats('wolt').catch(() => {})
      logActivity(job.errors > 0 ? 'error' : 'success', 'Wolt Menu Scraper completed',
        `${districtLabel(job.districtId)} · ${job.newItems} new restaurants${job.errors ? ` · ${job.errors} errors` : ''}`)
    }
  }
}

// ── Pipeline (sequential run: wolt → gplace → macros → dedup) ─────────────────
// Wolt discovers restaurants first (free, rich venue data).
// Google enriches existing Wolt restaurants (not new discovery), data is priority.

const PIPELINE_STEPS = ['wolt', 'gplace', 'macros', 'dedup']

const _pipeline = {
  running:    false,
  districtId: null,
  step:       null,   // id of currently running step
  stepsDone:  [],     // ids of completed steps
  cancelled:  false,
  startedAt:  null,
  finishedAt: null,
}

async function runPipeline(districtId, woltLimit = null) {
  if (_pipeline.running) return
  _pipeline.running    = true
  _pipeline.cancelled  = false
  _pipeline.districtId = districtId
  _pipeline.stepsDone  = []
  _pipeline.step       = null
  _pipeline.startedAt  = new Date().toISOString()
  _pipeline.finishedAt = null

  // Load enabled flags from DB
  let enabledMap = {}
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT key, value FROM admin_settings WHERE key LIKE 'script_%_enabled'`)
      for (const row of rows) {
        const m = row.key.match(/^script_(.+)_enabled$/)
        if (m) enabledMap[m[1]] = row.value !== false && row.value !== 'false'
      }
    } catch (e) { /* ignore, run all */ }
  }

  try {
    for (const id of PIPELINE_STEPS) {
      if (_pipeline.cancelled) break
      if (enabledMap[id] === false) continue  // skip disabled scripts

      _pipeline.step = id
      console.log(`[pipeline] Starting step: ${id}`)
      try {
        if (id === 'wolt')        await runWoltScript(districtId, [], woltLimit)
        else if (id === 'gplace') await runGooglePlaceScript(districtId, [], woltLimit)
        else if (id === 'macros') await runMacrosScript(districtId)
        else if (id === 'dedup')  await runDedupScript(districtId)
      } catch (e) {
        console.error(`[pipeline] Step ${id} threw:`, e.message)
        // Continue to next step even if one fails
      }
      _pipeline.stepsDone.push(id)
      _pipeline.step = null
    }
  } finally {
    _pipeline.running    = false
    _pipeline.step       = null
    _pipeline.finishedAt = new Date().toISOString()
    console.log(`[pipeline] Done. Steps completed: ${_pipeline.stepsDone.join(' → ')}`)
  }
}

// ── Script API endpoints ───────────────────────────────────────────────────────

// Pipeline routes MUST be registered before /:id routes to avoid being swallowed
app.post('/admin/api/scripts/pipeline/run', requireAdminAuth, (req, res) => {
  if (_pipeline.running) return res.json({ status: 'already_running', pipeline: _pipeline })
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  const districtId = req.body?.districtId || null
  const woltLimit  = req.body?.woltLimit  ? parseInt(req.body.woltLimit, 10) : null
  runPipeline(districtId, woltLimit)
  res.json({ status: 'started', pipeline: _pipeline })
})

app.post('/admin/api/scripts/pipeline/stop', requireAdminAuth, (req, res) => {
  if (!_pipeline.running) return res.json({ status: 'not_running' })
  _pipeline.cancelled = true
  // Also stop whichever individual script is currently running
  if (_pipeline.step) {
    const job = getScriptJob(_pipeline.step)
    job.running   = false
    job.cancelled = true
  }
  res.json({ status: 'stopping', pipeline: _pipeline })
})

app.post('/admin/api/scripts/:id/run', requireAdminAuth, (req, res) => {
  const { id } = req.params
  const job = getScriptJob(id)
  console.log(`[admin] Script run requested: ${id}`)

  if (job.running) {
    return res.json({ status: 'already_running', job })
  }

  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  if (id === 'macros') {
    runMacrosScript(req.body?.districtId || null)
  } else if (id === 'dedup') {
    runDedupScript(req.body?.districtId || null)
  } else if (id === 'gplace') {
    runGooglePlaceScript(req.body?.districtId || null, req.body?.fields || [])
  } else if (id === 'wolt') {
    const woltLimit = req.body?.limit ? parseInt(req.body.limit, 10) : null
    runWoltScript(req.body?.districtId || null, req.body?.fields || [], woltLimit)
  }

  res.json({ status: 'started', job: getScriptJob(id) })
})

app.post('/admin/api/scripts/:id/stop', requireAdminAuth, (req, res) => {
  const job = getScriptJob(req.params.id)
  job.running = false
  res.json({ status: 'stopping', job })
})

let _scriptCoverageCache = null
let _scriptCoverageTs    = 0
const SCRIPT_COVERAGE_TTL = 60_000

app.get('/admin/api/scripts/macros/coverage', requireAdminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' })
  if (_scriptCoverageCache && Date.now() - _scriptCoverageTs < SCRIPT_COVERAGE_TTL) {
    return res.json(_scriptCoverageCache)
  }
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE source='wolt_menu') AS total,
        COUNT(*) FILTER (WHERE source='wolt_menu' AND calories IS NOT NULL) AS with_macros,
        COUNT(*) FILTER (WHERE source='wolt_menu' AND meal_times IS NOT NULL AND array_length(meal_times,1) > 0) AS with_meal_type
      FROM menu_items
    `)
    const r = rows[0]
    _scriptCoverageCache = {
      total:         parseInt(r.total)         || 0,
      withMacros:    parseInt(r.with_macros)   || 0,
      withMealType:  parseInt(r.with_meal_type)|| 0,
    }
    _scriptCoverageTs = Date.now()
    res.json(_scriptCoverageCache)
  } catch (e) {
    console.error('/admin/api/scripts/macros/coverage error:', e.message)
    res.status(500).json({ error: 'Database error' })
  }
})

app.get('/admin/api/scripts/status', requireAdminAuth, async (req, res) => {
  // Load enabled flags from admin_settings
  let enabled = {}
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT key, value FROM admin_settings WHERE key LIKE 'script_%_enabled'`)
      for (const row of rows) {
        const match = row.key.match(/^script_(.+)_enabled$/)
        if (match) enabled[match[1]] = row.value !== false && row.value !== 'false'
      }
    } catch (e) { /* ignore */ }
  }
  res.json({ jobs: _scriptJobs, enabled, pipeline: _pipeline })
})

// Activity feed — recent events from the last 24h (script runs, R2 syncs, etc.)
app.get('/admin/api/activity', requireAdminAuth, async (req, res) => {
  if (!pool) return res.json([])
  try {
    const { rows } = await pool.query(`
      SELECT kind, text, sub, created_at
      FROM admin_activity
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 25
    `)
    res.json(rows.map(r => ({
      kind: r.kind,
      text: r.text,
      sub:  r.sub || '',
      time: msToRelativeServer(Date.now() - new Date(r.created_at).getTime()),
    })))
  } catch (e) {
    console.error('/admin/api/activity error:', e.message)
    res.json([])
  }
})

// Save Wolt limit config (persisted to admin_settings so it survives restarts)
// Must be registered before /:id/enabled to avoid being absorbed by the wildcard
app.patch('/admin/api/scripts/wolt/config', requireAdminAuth, async (req, res) => {
  const { limit } = req.body
  const job = getScriptJob('wolt')
  job.configLimit = (limit != null && limit !== '') ? (parseInt(limit, 10) || null) : null
  if (pool) {
    try {
      await pool.query(`
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES ('script_wolt_config_limit', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
      `, [job.configLimit !== null ? JSON.stringify(job.configLimit) : JSON.stringify(null)])
    } catch (e) {
      console.warn('Could not persist wolt config limit:', e.message)
    }
  }
  res.json({ configLimit: job.configLimit })
})

app.patch('/admin/api/scripts/:id/enabled', requireAdminAuth, async (req, res) => {
  const { id } = req.params
  const { enabled } = req.body
  if (pool) {
    try {
      await pool.query(`
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      `, [`script_${id}_enabled`, JSON.stringify(enabled)])
    } catch (e) {
      console.warn(`Could not persist enabled flag for ${id}:`, e.message)
    }
  }
  res.json({ id, enabled })
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
  const cachedCount = Math.max(0, _cacheJob.done - _cacheJob.errors)
  // coveragePct: 0.0–100.0 (one decimal place percentage)
  const coveragePct = _cacheJob.total > 0
    ? Math.round(cachedCount / _cacheJob.total * 1000) / 10
    : null
  const nextSyncAt  = _cacheJob.finishedAt && !_cacheJob.cancelled
    ? new Date(new Date(_cacheJob.finishedAt).getTime() + R2_SYNC_INTERVAL_DAYS * 86400_000).toISOString()
    : null
  res.json({
    job: _cacheJob,
    r2Enabled: !!r2,
    stats: {
      cachedCount,
      totalCount:      _cacheJob.total,
      errorCount:      _cacheJob.errors,
      skippedCount:    _cacheJob.skipped    || 0,
      newlyCachedCount: _cacheJob.newlyCached || 0,
      coveragePct,
      lastSyncAt:      _cacheJob.cancelled ? null : _cacheJob.finishedAt,
      nextSyncAt,
      syncIntervalDays: R2_SYNC_INTERVAL_DAYS,
    },
  })
})

// Counts actual objects in R2 (paginated ListObjectsV2) and updates persisted stats.
// Fast — ~1s per 1000 objects. With 18K objects takes ~18 pages ≈ 3-5s total.
app.post('/admin/api/r2-recount', requireAdminAuth, async (req, res) => {
  if (!r2) return res.status(503).json({ error: 'R2 not configured' })
  if (_cacheJob.running) return res.status(409).json({ error: 'Sync job is running — wait for it to finish' })
  try {
    // Page through R2 to count all objects
    let objectCount = 0
    let continuationToken = undefined
    do {
      const cmd = new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      })
      const page = await r2.send(cmd)
      objectCount += page.KeyCount || 0
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)

    // Get total URL count from DB for coverage %
    let totalCount = _cacheJob.total
    if (pool && totalCount === 0) {
      const [mealsRes, restaurantsRes] = await Promise.all([
        pool.query(`SELECT COUNT(DISTINCT image_url) AS n FROM menu_items WHERE image_url IS NOT NULL AND image_url <> '' AND source='wolt_menu' AND calories IS NOT NULL AND (category IS NULL OR category != 'drink')`),
        pool.query(`SELECT COUNT(DISTINCT photo_url)  AS n FROM restaurants WHERE photo_url IS NOT NULL AND photo_url <> ''`),
      ])
      // rough upper bound (some URLs may appear in both tables, so deduplicated count is slightly lower)
      totalCount = parseInt(mealsRes.rows[0].n) + parseInt(restaurantsRes.rows[0].n)
    }

    // Update in-memory job state with verified counts
    _cacheJob.total       = totalCount
    _cacheJob.done        = objectCount
    _cacheJob.skipped     = objectCount
    _cacheJob.newlyCached = 0
    _cacheJob.errors      = Math.max(0, totalCount - objectCount)
    _cacheJob.finishedAt  = _cacheJob.finishedAt || new Date().toISOString()
    _cacheJob.cancelled   = false

    await saveR2SyncStats()

    const coveragePct = totalCount > 0 ? Math.round(objectCount / totalCount * 1000) / 10 : null
    console.log(`R2 recount complete: ${objectCount} objects in R2 / ${totalCount} total = ${coveragePct}%`)
    res.json({ objectCount, totalCount, coveragePct })
  } catch (e) {
    console.error('R2 recount error:', e.message)
    res.status(500).json({ error: e.message })
  }
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

  // Use official GeoJSON polygons; fall back to simplified hardcoded ones if unavailable
  const geoPolygons = await loadBerlinPolygons()

  const districts = geoPolygons
    ? [...geoPolygons.entries()].map(([id, rings]) => ({ id, name: DISTRICT_NAMES[id] || id, rings }))
    : BERLIN_DISTRICTS_FALLBACK.map(d => ({ id: d.id, name: d.name, rings: [d.polygon] }))

  return districts.map(d => {
    const inDistrict = rows.filter(r => pointInDistrict(parseFloat(r.lat), parseFloat(r.lon), d.rings))
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

  // Assign each restaurant to its district using the same GeoJSON polygons
  const geoPolygons = await loadBerlinPolygons()
  const districtList = geoPolygons
    ? [...geoPolygons.entries()].map(([id, rings]) => ({ id, rings }))
    : BERLIN_DISTRICTS_FALLBACK.map(d => ({ id: d.id, rings: [d.polygon] }))

  return rows.map(r => {
    const lat = r.lat ? parseFloat(r.lat) : null
    const lng = r.lon ? parseFloat(r.lon) : null
    const districtId = (lat && lng)
      ? (districtList.find(d => pointInDistrict(lat, lng, d.rings))?.id || null)
      : null

    const rawPhoto = (r.photo_url || '').split('&key=')[0]
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
      priceLevel: r.price_level ? parseInt(r.price_level) : null,
      address:    r.address || '',
      hours:      getHoursString(r.opening_hours) || '—',
      updated:    null,
      woltSlug:   r.wolt_slug || null,
      lat,
      lng,
      photo,
      districtId,
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
