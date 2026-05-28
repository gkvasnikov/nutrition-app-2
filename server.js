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
      // Google Place Scraper specific
      nearbySearchCalls: 0, detailsCalls: 0, enabledFields: [],
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
    const { rows } = await pool.query(`SELECT key, value FROM admin_settings WHERE key LIKE 'script_%_last_run'`)
    for (const row of rows) {
      const match = row.key.match(/^script_(.+)_last_run$/)
      if (!match) continue
      const id = match[1]
      const s = row.value
      _scriptJobs[id] = {
        running:     false,
        total:       s.total       || 0,
        done:        s.done        || 0,
        errors:      s.errors      || 0,
        skipped:     s.skipped     || 0,
        newItems:    s.newItems    || 0,
        startedAt:   s.startedAt   || null,
        finishedAt:  s.finishedAt  || null,
        cancelled:   false,
        districtId:  s.districtId  || null,
      }
    }
    console.log(`Script stats loaded from DB for: ${Object.keys(_scriptJobs).join(', ') || '(none)'}`)
  } catch (e) {
    console.warn('Could not load script stats:', e.message)
  }
}
// Warm up on startup
loadScriptStats().catch(() => {})

// ── Macros + Meal Type script (real Claude-powered implementation) ─────────────
async function runMacrosScript(districtId) {
  const job = getScriptJob('macros')
  if (job.running) return

  job.running    = true
  job.cancelled  = false
  job.done       = 0
  job.errors     = 0
  job.skipped    = 0
  job.newItems   = 0
  job.total      = 0
  job.startedAt  = new Date().toISOString()
  job.finishedAt = null
  job.districtId = districtId || null

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
    if (!job.cancelled) saveScriptStats('dedup').catch(() => {})
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

// Maps UI checkbox labels → Google Place Details API field names
const GPLACE_FIELD_MAP = {
  'Working hours':    'opening_hours',
  'Rating & reviews': 'rating,user_ratings_total',
  'Price level':      'price_level',
  'Address':          'formatted_address',
  'Photo':            'photos',
  'Phone number':     'formatted_phone_number',
  'Website':          'website',
}
// These are always requested — needed to identify and locate the place
const GPLACE_FIELDS_BASE = 'place_id,name,geometry'

// ── Google Place Scraper (grid-based discovery — new restaurants only) ────────
// Scans district with a grid of Nearby Search requests.
// Skips any place already in the DB (matched by google_place_id or name+proximity).
// Only inserts genuinely new restaurants.
// After the run, stamps google_enriched_at = NOW() for every restaurant in the district
// so future runs can implement a freshness check (e.g. skip if < 30 days old).
// enabledFields: array of UI label strings (from checkboxes). If empty → fetch all.
async function runGooglePlaceScript(districtId, enabledFields = []) {
  const job = getScriptJob('gplace')
  if (job.running) return
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    console.error('Google Place script: GOOGLE_PLACES_API_KEY not set')
    job.errors = 1; job.finishedAt = new Date().toISOString(); return
  }

  job.running = true; job.cancelled = false; job.done = 0; job.errors = 0
  job.newItems = 0; job.total = 0; job.startedAt = new Date().toISOString()
  job.finishedAt = null; job.districtId = districtId || null
  job.nearbySearchCalls = 0; job.detailsCalls = 0
  job.enabledFields = enabledFields.length > 0 ? enabledFields : Object.keys(GPLACE_FIELD_MAP)

  // Build Place Details fields string from enabled checkboxes
  // If nothing specified → fetch everything
  const requestedApiFields = enabledFields.length > 0
    ? enabledFields.flatMap(label => (GPLACE_FIELD_MAP[label] || '').split(',').filter(Boolean))
    : Object.values(GPLACE_FIELD_MAP).flatMap(f => f.split(','))
  const detailFields = [GPLACE_FIELDS_BASE, ...new Set(requestedApiFields)].join(',')
  console.log(`Google Place script: requesting fields: ${detailFields}`)

  try {
    await ensureGooglePlacesColumns()

    // Determine district bounding box and polygon
    let rings = null
    let bbox = { minLat: 52.338, maxLat: 52.675, minLng: 13.088, maxLng: 13.761 }
    if (districtId) {
      const polygons = await loadBerlinPolygons()
      if (polygons?.has(districtId)) {
        rings = polygons.get(districtId)
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
        for (const ring of rings) for (const [lat, lng] of ring) {
          if (lat < minLat) minLat = lat;  if (lat > maxLat) maxLat = lat
          if (lng < minLng) minLng = lng;  if (lng > maxLng) maxLng = lng
        }
        bbox = { minLat, maxLat, minLng, maxLng }
      }
    }

    // Build search grid — 400 m step, 400 m radius
    const LAT_STEP = 400 / 111_000
    const LNG_STEP = 400 /  72_000
    const gridPoints = []
    for (let lat = bbox.minLat; lat <= bbox.maxLat + LAT_STEP * 0.5; lat += LAT_STEP)
      for (let lng = bbox.minLng; lng <= bbox.maxLng + LNG_STEP * 0.5; lng += LNG_STEP)
        if (!rings || pointInDistrict(lat, lng, rings)) gridPoints.push({ lat, lng })

    job.total = gridPoints.length
    console.log(`Google Place script: ${gridPoints.length} grid points${districtId ? ` in ${districtId}` : ''}`)

    const seenPlaceIds = new Set()

    for (let gi = 0; gi < gridPoints.length; gi++) {
      if (!job.running) { job.cancelled = true; break }
      const pt = gridPoints[gi]

      try {
        const nearbyUrl =
          `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
          `?location=${pt.lat},${pt.lng}&radius=400&type=restaurant&key=${apiKey}`
        const nearbyRes  = await fetch(nearbyUrl)
        job.nearbySearchCalls++
        const nearbyData = await nearbyRes.json()

        if (nearbyData.status === 'REQUEST_DENIED') {
          console.error('Google Places API denied:', nearbyData.error_message)
          job.errors++
          break
        }

        for (const place of (nearbyData.results || [])) {
          if (!job.running) { job.cancelled = true; break }
          if (seenPlaceIds.has(place.place_id)) continue
          seenPlaceIds.add(place.place_id)

          const pLat = place.geometry?.location?.lat
          const pLng = place.geometry?.location?.lng
          if (!pLat || !pLng) continue
          if (rings && !pointInDistrict(pLat, pLng, rings)) continue

          // ── Check if already in DB (skip if so — no Details call = no cost) ──
          const { rows: existing } = await pool.query(`
            SELECT id FROM restaurants
            WHERE google_place_id = $1
               OR (LOWER(name) = LOWER($2)
                   AND lat BETWEEN $3 - 0.00135 AND $3 + 0.00135
                   AND lon BETWEEN $4 - 0.00208 AND $4 + 0.00208)
            LIMIT 1
          `, [place.place_id, place.name, pLat, pLng])

          if (existing.length > 0) continue  // already have it — skip, no API call

          // ── New restaurant: fetch full details and insert ──────────────────
          try {
            const detailUrl =
              `https://maps.googleapis.com/maps/api/place/details/json` +
              `?place_id=${place.place_id}` +
              `&fields=${detailFields}` +
              `&key=${apiKey}`
            const detailRes  = await fetch(detailUrl)
            job.detailsCalls++
            const detailData = await detailRes.json()
            const r = detailData.result
            if (!r) continue

            const lat      = r.geometry?.location?.lat ?? pLat
            const lng      = r.geometry?.location?.lng ?? pLng
            const photoRef = r.photos?.[0]?.photo_reference
            const photoUrl = photoRef
              ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${apiKey}`
              : null

            await pool.query(`
              INSERT INTO restaurants
                (name, lat, lon, address, rating, reviews_count, price_level,
                 opening_hours, photo_url, website, phone, google_place_id)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
              ON CONFLICT (google_place_id) DO NOTHING
            `, [
              r.name, lat, lng,
              r.formatted_address    || null,
              r.rating               || null,
              r.user_ratings_total   || null,
              r.price_level          || null,
              r.opening_hours        ? JSON.stringify(r.opening_hours) : null,
              photoUrl,
              r.website              || null,
              r.formatted_phone_number || null,
              r.place_id,
            ])
            job.newItems++

            await new Promise(resolve => setTimeout(resolve, 100))
          } catch (e) {
            console.error(`gplace details error (${place.place_id}):`, e.message)
            job.errors++
          }
        }
      } catch (e) {
        console.error('gplace grid point error:', e.message)
        job.errors++
      }

      job.done = gi + 1
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    // ── Stamp google_enriched_at = NOW() for all restaurants in this district ──
    // This marks them as "checked today" so future runs can skip fresh ones.
    if (!job.cancelled) {
      if (districtId && rings) {
        // Use bbox as fast pre-filter, then verify with polygon
        const { rows: distRests } = await pool.query(`
          SELECT id, lat, lon FROM restaurants
          WHERE lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4
        `, [bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng])
        const ids = distRests
          .filter(r => pointInDistrict(parseFloat(r.lat), parseFloat(r.lon), rings))
          .map(r => r.id)
        if (ids.length > 0) {
          await pool.query(
            `UPDATE restaurants SET google_enriched_at = NOW() WHERE id = ANY($1::int[])`,
            [ids]
          )
          console.log(`gplace: stamped google_enriched_at for ${ids.length} restaurants in ${districtId}`)
        }
      } else {
        await pool.query(`UPDATE restaurants SET google_enriched_at = NOW()`)
        console.log('gplace: stamped google_enriched_at for all restaurants')
      }
    }
  } catch (e) {
    console.error('Google Place script error:', e.message)
    job.errors++
  } finally {
    job.running = false
    job.finishedAt = new Date().toISOString()
    console.log(`Google Place finished: ${job.newItems} new restaurants added, ${job.errors} errors`)
    if (!job.cancelled) saveScriptStats('gplace').catch(() => {})
  }
}

// ── Wolt schema migration ─────────────────────────────────────────────────────
async function ensureWoltMenuIndex() {
  if (!pool) return
  try {
    // Unique index prevents duplicate menu items from repeated scrapes
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS menu_items_rest_name_wolt_idx
        ON menu_items (restaurant_id, LOWER(name))
        WHERE source = 'wolt_menu'
    `)
  } catch (e) {
    console.warn('ensureWoltMenuIndex:', e.message)
  }
}
ensureWoltMenuIndex().catch(() => {})

// ── Wolt Scraper ──────────────────────────────────────────────────────────────
// 1. Discovers venues in the district via Wolt API (paginated from centre outward)
// 2. Upserts each venue into restaurants by wolt_slug
// 3. Skips menu fetch entirely if the restaurant already has menu items in the DB
// 4. For restaurants without menus: fetches via Wolt v4 menu API and inserts items
async function runWoltScript(districtId) {
  const job = getScriptJob('wolt')
  if (job.running) return
  job.running = true; job.cancelled = false; job.done = 0; job.errors = 0
  job.newItems = 0; job.total = 0; job.startedAt = new Date().toISOString()
  job.finishedAt = null; job.districtId = districtId || null

  try {
    await ensureWoltMenuIndex()

    // District polygon + centroid
    let rings = null
    let centerLat = 52.520, centerLng = 13.405
    if (districtId) {
      const polygons = await loadBerlinPolygons()
      if (polygons?.has(districtId)) {
        rings = polygons.get(districtId)
        const allPts = rings.flat()
        centerLat = allPts.reduce((s, p) => s + p[0], 0) / allPts.length
        centerLng = allPts.reduce((s, p) => s + p[1], 0) / allPts.length
      }
    }

    // ── Phase 1: discover venues (paginate until no more in-district results) ──
    const venues = []
    const seen   = new Set()
    let skip = 0
    let emptyPages = 0
    const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; NutritionAdmin/1.0)', 'Accept': 'application/json' }

    while (emptyPages < 2) {
      if (!job.running) { job.cancelled = true; break }
      try {
        const url = `https://consumer-api.wolt.com/v1/pages/restaurants?lat=${centerLat}&lon=${centerLng}&limit=50&skip=${skip}`
        const res  = await fetch(url, { headers })
        if (!res.ok) break
        const data = await res.json()
        let inDistrictFound = 0
        for (const section of (data.sections || [])) {
          for (const item of (section.items || [])) {
            const v    = item.venue || item
            const slug = v.slug || v.wolt_slug
            const vLat = v.location?.coordinates?.[1] ?? v.lat
            const vLng = v.location?.coordinates?.[0] ?? v.lon
            if (!slug || seen.has(slug)) continue
            seen.add(slug)
            if (rings && vLat && vLng && !pointInDistrict(parseFloat(vLat), parseFloat(vLng), rings)) continue
            venues.push({ slug, name: v.name, lat: vLat, lng: vLng })
            inDistrictFound++
          }
        }
        // Stop if we got an empty page twice in a row (API exhausted or moved far from district)
        emptyPages = inDistrictFound === 0 ? emptyPages + 1 : 0
        skip += 50
        await new Promise(r => setTimeout(r, 300))
      } catch (e) {
        console.error('Wolt discovery page error:', e.message)
        break
      }
    }

    job.total = venues.length
    console.log(`Wolt script: ${venues.length} venues in district${districtId ? ` ${districtId}` : ''}`)

    // ── Phase 2: upsert restaurants + fetch menus only for those without items ──
    for (const v of venues) {
      if (!job.running) { job.cancelled = true; break }
      try {
        // Upsert restaurant, get its DB id in one query
        const { rows: [restRow] } = await pool.query(`
          INSERT INTO restaurants (name, lat, lon, wolt_slug)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (wolt_slug) DO UPDATE SET
            name = EXCLUDED.name,
            lat  = COALESCE(restaurants.lat, EXCLUDED.lat),
            lon  = COALESCE(restaurants.lon, EXCLUDED.lon)
          RETURNING id
        `, [v.name, v.lat, v.lng, v.slug])

        if (!restRow) { job.done++; continue }
        const restId = restRow.id

        // Check if this restaurant already has menu items → skip if so
        const { rows: [countRow] } = await pool.query(
          `SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = $1 AND source = 'wolt_menu'`,
          [restId]
        )
        if (parseInt(countRow.n) > 0) {
          job.done++
          continue  // already has a menu — skip, no Wolt API call
        }

        // No menu yet — fetch from Wolt
        try {
          const menuUrl = `https://consumer-api.wolt.com/v4/venue/slug/${v.slug}/menu`
          const menuRes = await fetch(menuUrl, { headers })
          if (menuRes.ok) {
            const menuData  = await menuRes.json()
            const categories = menuData.categories || menuData.menu?.items || []
            for (const cat of categories) {
              for (const item of (cat.items || [])) {
                const name = item.name || item.baseName
                if (!name) continue
                const price  = item.unitPriceWithDiscount != null
                  ? item.unitPriceWithDiscount / 100 : null
                const imgUrl = item.imageUrl || item.image || null
                try {
                  await pool.query(`
                    INSERT INTO menu_items (restaurant_id, name, price, image_url, source)
                    VALUES ($1, $2, $3, $4, 'wolt_menu')
                    ON CONFLICT (restaurant_id, LOWER(name))
                      WHERE source = 'wolt_menu'
                    DO NOTHING
                  `, [restId, name, price, imgUrl])
                  job.newItems++
                } catch (_) {}
              }
            }
          }
        } catch (menuErr) {
          // Wolt menu API unavailable for this venue — not a hard error
          console.warn(`Wolt menu unavailable for ${v.slug}:`, menuErr.message)
        }

        job.done++
      } catch (e) {
        console.error(`Wolt script venue ${v.slug}:`, e.message)
        job.errors++
        job.done++
      }
      await new Promise(r => setTimeout(r, 150))
    }
  } catch (e) {
    console.error('Wolt script error:', e.message)
    job.errors++
  } finally {
    job.running = false
    job.finishedAt = new Date().toISOString()
    console.log(`Wolt finished: ${job.done} venues, ${job.newItems} menu items added, ${job.errors} errors`)
    if (!job.cancelled) saveScriptStats('wolt').catch(() => {})
  }
}

// ── Script API endpoints ───────────────────────────────────────────────────────

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
    runWoltScript(req.body?.districtId || null)
  }
  // uber, web remain stubs for now

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
  res.json({ jobs: _scriptJobs, enabled })
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
