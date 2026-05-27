/**
 * deduplicate-meals.js
 *
 * Removes duplicate menu_items rows (same restaurant_id + name).
 * Keeps the row with highest confidence; ties broken by highest id.
 *
 * Usage:
 *   DATABASE_URL=<url> node scripts/deduplicate-meals.js
 *   DATABASE_URL=<url> node scripts/deduplicate-meals.js --dry-run
 */

import 'dotenv/config'
import pg from 'pg'

const DRY_RUN = process.argv.includes('--dry-run')

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
})

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 }

async function main() {
  console.log(`Deduplicating menu_items${DRY_RUN ? ' (DRY RUN)' : ''}`)

  // Find all (restaurant_id, name) groups with more than one row
  const { rows: dupeGroups } = await pool.query(`
    SELECT restaurant_id, name, array_agg(id ORDER BY
      CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      id DESC
    ) AS ids
    FROM menu_items
    WHERE source = 'wolt_menu'
      AND calories IS NOT NULL
      AND image_url IS NOT NULL AND image_url <> ''
    GROUP BY restaurant_id, name
    HAVING COUNT(*) > 1
  `)

  console.log(`Found ${dupeGroups.length} name+restaurant groups with duplicates`)

  // For each group: ids[0] is the keeper (best confidence, latest id), rest are deleted
  const toDelete = []
  for (const group of dupeGroups) {
    const [_keep, ...extras] = group.ids
    toDelete.push(...extras)
  }

  console.log(`Rows to delete: ${toDelete.length}`)

  if (DRY_RUN) {
    // Show a sample
    const sample = dupeGroups.slice(0, 8)
    for (const g of sample) {
      const [keep, ...del] = g.ids
      console.log(`  keep id:${keep}  delete [${del.join(', ')}]  — "${g.name}"`)
    }
    console.log('Dry run complete — no changes made.')
    await pool.end()
    return
  }

  // Delete in batches of 500
  let deleted = 0
  for (let i = 0; i < toDelete.length; i += 500) {
    const batch = toDelete.slice(i, i + 500)
    const { rowCount } = await pool.query(
      `DELETE FROM menu_items WHERE id = ANY($1)`,
      [batch]
    )
    deleted += rowCount
    console.log(`Deleted ${deleted}/${toDelete.length}`)
  }

  console.log(`\nDone. Removed ${deleted} duplicate rows.`)
  await pool.end()
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
