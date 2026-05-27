/**
 * classify-meal-times.js
 *
 * One-time script: classifies all menu_items via Claude AI and stores results
 * in meal_times text[] column.
 *
 * Usage:
 *   DATABASE_URL=<url> ANTHROPIC_API_KEY=<key> node scripts/classify-meal-times.js
 *   DATABASE_URL=<url> ANTHROPIC_API_KEY=<key> node scripts/classify-meal-times.js --dry-run
 *
 * Resume-safe: only processes rows where meal_times IS NULL.
 */

import 'dotenv/config'
import pg from 'pg'
import Anthropic from '@anthropic-ai/sdk'

const DRY_RUN     = process.argv.includes('--dry-run')
const BATCH_SIZE  = 20   // dishes per Claude API call
const CONCURRENCY = 1    // sequential — safest under 50 RPM limit
const DELAY_MS    = 1500 // ms between batches (~40 RPM)
const LOG_EVERY   = 100  // log progress every N dishes

const VALID_TAGS = new Set(['breakfast', 'lunch_dinner', 'snack'])

// ── DB setup ──────────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
})

// ── Anthropic setup ───────────────────────────────────────────────────────────
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── DB migration: add column if missing ───────────────────────────────────────
async function ensureColumn() {
  await pool.query(`
    ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS meal_times text[] DEFAULT NULL
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_menu_items_meal_times
    ON menu_items USING GIN (meal_times)
  `)
  console.log('Column meal_times ensured.')
}

// ── Retry helper ─────────────────────────────────────────────────────────────
async function withRetry(fn, maxRetries = 5) {
  let delay = 15000  // start at 15s on first 429
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const is429 = err?.status === 429 || err?.message?.includes('429')
      if (!is429 || attempt === maxRetries) throw err
      console.log(`Rate limited — waiting ${delay / 1000}s before retry ${attempt + 1}/${maxRetries}...`)
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 1.5, 120000)  // exponential backoff, max 2 min
    }
  }
}

// ── Classify one batch of dishes via Claude ───────────────────────────────────
async function classifyBatch(dishes) {
  const prompt = `You are classifying restaurant menu items by meal time suitability.
For each dish, decide which of these categories apply (a dish can have multiple):

  breakfast   — genuinely morning foods: eggs, omelettes, oatmeal, porridge, pancakes,
                waffles, pastries, croissants, yogurt, granola, toast, bagels, muffins,
                fruit bowls, smoothie bowls, avocado toast, breakfast burritos
  lunch_dinner — any proper meal suitable for midday or evening: salads, soups,
                sandwiches, wraps, burgers, pizza, pasta, rice dishes, sushi, steaks,
                grilled meats, curries, bowls, tacos, noodles — the vast majority of dishes
  snack       — small bites, sides, desserts, sweets, drinks, anything clearly not a
                full meal (typically under 300 kcal but judge by type, not just calories)

Rules:
- Be strict about breakfast — only tag it if the dish name or composition clearly indicates
  it's a morning food. Soups, rice dishes, steaks, pasta are NEVER breakfast.
- Most dishes should get ["lunch_dinner"] only.
- Desserts and small sweets get ["snack"], not ["lunch_dinner"].
- Some dishes genuinely fit multiple: a yogurt parfait → ["breakfast","snack"]
- Use the dish name as primary signal; use macros as secondary confirmation.

Output a JSON array with one object per dish, in the same order as input:
[{"id": 123, "meal_times": ["lunch_dinner"]}, ...]

Dishes:
${JSON.stringify(dishes.map(d => ({
    id: d.id,
    name: d.name,
    calories: d.calories,
    protein: d.protein,
    fat: d.fat,
    carbs: d.carbs,
  })), null, 0)}`

  const message = await withRetry(() => client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  }))

  const raw = message.content[0].text.replace(/```json\n?|\n?```/g, '').trim()

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Try to extract JSON array from response
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) throw new Error(`Invalid JSON from Claude: ${raw.slice(0, 200)}`)
    parsed = JSON.parse(match[0])
  }

  return parsed.map(item => ({
    id: item.id,
    mealTimes: (item.meal_times || []).filter(t => VALID_TAGS.has(t)),
  }))
}

// ── Write results to DB ───────────────────────────────────────────────────────
async function saveResults(results) {
  for (const { id, mealTimes } of results) {
    if (!mealTimes.length) continue
    await pool.query(
      'UPDATE menu_items SET meal_times = $1 WHERE id = $2',
      [mealTimes, id]
    )
  }
}

// ── Semaphore for concurrency control ─────────────────────────────────────────
function makeSemaphore(limit) {
  let running = 0
  const queue = []
  return async function acquire(fn) {
    if (running >= limit) await new Promise(resolve => queue.push(resolve))
    running++
    try {
      return await fn()
    } finally {
      running--
      if (queue.length) queue.shift()()
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Starting meal-time classification${DRY_RUN ? ' (DRY RUN)' : ''}`)

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set')
    process.exit(1)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set')
    process.exit(1)
  }

  await ensureColumn()

  // Fetch all unclassified dishes
  const { rows } = await pool.query(`
    SELECT id, name, calories, protein, fat, carbs
    FROM menu_items
    WHERE source = 'wolt_menu'
      AND calories IS NOT NULL
      AND meal_times IS NULL
    ORDER BY id
  `)

  const total = rows.length
  console.log(`Found ${total} unclassified dishes`)

  if (total === 0) {
    console.log('Nothing to do.')
    await pool.end()
    return
  }

  // Split into batches
  const batches = []
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE))
  }
  console.log(`Processing ${batches.length} batches of ${BATCH_SIZE} (concurrency ${CONCURRENCY})`)

  const sem = makeSemaphore(CONCURRENCY)
  let processed = 0
  let errors = 0

  const tasks = batches.map((batch, batchIdx) =>
    sem(async () => {
      await new Promise(r => setTimeout(r, DELAY_MS))
      try {
        const results = await classifyBatch(batch)

        if (DRY_RUN) {
          console.log(`\n--- Batch ${batchIdx + 1} sample ---`)
          results.slice(0, 5).forEach(r => {
            const dish = batch.find(d => d.id === r.id)
            console.log(`  "${dish?.name}" → [${r.mealTimes.join(', ')}]`)
          })
        } else {
          await saveResults(results)
        }

        processed += batch.length
        if (processed % LOG_EVERY < BATCH_SIZE || processed >= total) {
          const pct = ((processed / total) * 100).toFixed(1)
          console.log(`Progress: ${processed}/${total} (${pct}%)`)
        }
      } catch (err) {
        errors++
        console.error(`Batch ${batchIdx + 1} failed: ${err.message}`)
      }
    })
  )

  await Promise.all(tasks)

  console.log(`\nDone. Processed: ${processed}, Errors: ${errors}`)
  if (errors > 0) {
    console.log(`Re-run the script to retry failed batches (they remain meal_times IS NULL)`)
  }

  await pool.end()
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
