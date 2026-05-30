# Admin Panel — CLAUDE.md

Context for the Nutrition App 2.0 **admin panel** and its **data-scraping pipeline**.
The backend for everything here lives in `../server.js` (single Express app). This file captures the
architecture and the hard-won gotchas (most discovered the hard way) so the work can be reconstructed.

---

## 0. Run the admin LOCALLY (important operating model)

**All admin/data work is done from a locally-run instance, not the Railway admin.** Railway only
serves the public app + API.

**Why:** Wolt serves the server-rendered menu HTML **only to a residential (German) IP**. From
Railway's datacenter IP the restaurant page returns `200` + full-size HTML but **without** the
`horizontal-item-card` markup → menus scrape empty (verified: 23/27 empty on Railway, ~0 locally).
The same code from the Mac's home IP returns full menus. So the Wolt scrape **must** run from a
residential IP. To avoid a confusing split, run the *whole* admin locally.

**How:** `server.js` already connects to the **prod** DB via `.env DATABASE_URL`. So:
1. `node server.js` in the project root (on the Mac).
2. Open `http://localhost:3001/admin`, log in (same `ADMIN_USER`/`ADMIN_PASS`).
3. Every button (Wolt, Google, Macros, Dedup, image-cache) runs from the Mac's IP and writes to the
   **prod DB** — the live app reflects it immediately. Keep the terminal running during jobs.

**Local `.env`** (copy secret values from Railway):
- Required (mostly already present): `DATABASE_URL`, `GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY`,
  `ADMIN_USER`, `ADMIN_PASS`, `SESSION_SECRET`.
- Add for full admin: `VITE_GOOGLE_MAPS_API_KEY` (else restaurant photos won't render in the admin)
  and the R2 client keys `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  (else meal-photo R2 caching is skipped — photos still serve lazily via the prod image-proxy).
- **Optional**: `R2_PUBLIC_URL`, `R2_JURISDICTION` — not set on Railway either. `R2_PUBLIC_URL` only
  changes whether the Google enricher stores a public R2 URL vs the Google CDN URL (current prod
  behavior = CDN URL); skipping keeps parity with prod.

Railway's `/admin` is still reachable (auth-gated) but should be ignored for data tasks. (Optional
future hardening: gate the `/admin` routes behind an `ADMIN_ENABLED` env flag so the public deploy
doesn't expose them.)

---

## 1. What the admin is

- Served at **`/admin`** (session-gated). Login at `/admin/login`; creds from env `ADMIN_USER` /
  `ADMIN_PASS`; session in PostgreSQL (`admin_sessions`), 30-day rolling cookie.
- **No build step.** `admin/Admin Panel.html` loads `@babel/standalone` and runs the JSX files
  in-browser as `type="text/babel"`: `data.js` → `tweaks-panel.jsx` → `components.jsx` → `map.jsx`
  → `app.jsx`. Editing these files is enough; Railway serves them statically (auth-gated).
- `/admin` route injects real DB data as `window.__SERVER_DATA__` (`{ DISTRICTS, RESTAURANTS }`),
  read by `data.js`. Other arrays in `data.js` (`SCRIPTS`, `COST_BREAKDOWN`) are static; `ACTIVITY`
  is legacy/unused (the feed now fetches live — see §7).
- `fetchAdminRestaurants` returns **all** qualifying restaurants (the old `LIMIT 500` was removed — it
  truncated the global list by reviews, so a district showed e.g. 76 instead of its real 172). The
  full list is embedded in the page; fine at the current scale (~700), revisit (lazy/per-district
  loading) only if it grows to many thousands.

### Frontend files
- `app.jsx` — root app: tabs, district view, **`ScriptDetail`** (run/stop a script, checklist,
  limit input, cost, `Last error` banner), **`DistrictScripts`** (pipeline "re-run all" + step
  progress), **`ActivityFeed`** (live, polls `/admin/api/activity`), `RestaurantDetail`,
  **`RestaurantList`** (shared by city "All Restaurants" + district view; **Sort** dropdown:
  `Recently added` (by `addedAt`, default) / `Alphabetical`).
- `data.js` — `SCRIPTS` metadata (order: **Wolt → Google → Macros → Dedup**; Uber/Web removed).
- `components.jsx`, `map.jsx`, `tweaks-panel.jsx`, `styles.css` — UI building blocks + district map.

---

## 2. The scraping pipeline (heart of the system)

Order: **`wolt → gplace → macros → dedup`** (`PIPELINE_STEPS` in server.js). Wolt is the **primary
discovery source**; Google is an **enricher** (its data has priority for photo/phone/website/hours).

Run individually via `POST /admin/api/scripts/:id/run` (body: `districtId`, optional `limit` for
wolt), or all via `POST /admin/api/scripts/pipeline/run` (reads the persisted Wolt limit). Status:
`GET /admin/api/scripts/status` (the admin polls this; each job carries `lastError`, `configLimit`).

### wolt — `runWoltScript(districtId, enabledFields=[], limit=null)`
1. **Discovery** = a **~2.5 km grid** of query points over the district bbox (in-polygon points +
   centroid) to `consumer-api.wolt.com/v1/pages/restaurants?lat&lon`, deduped by slug, filtered to the
   district **polygon**. Real Chrome UA + headers, 300 ms throttle. Calibrated: 2.5 km (~10–15 pts)
   reaches ~full coverage (Reinickendorf 175 vs 168 for the old 5-point method); denser grids both
   add little and trigger Wolt throttling after ~45 rapid calls.
2. **Work set** = discovered venues **minus** slugs that already have a `wolt_menu` (so re-runs don't
   re-scrape complete restaurants). Existing-but-menu-less rows sorted **first** so the limit can't
   starve them. `job.skipped` = how many were already complete.
3. Per venue: **type-safe upsert** into `restaurants` (see §3 for the id) → **menu scrape** → idempotent
   `menu_items` insert (name, **description**, price, image_url) → push meal photos to R2. 1.5 s pause
   only when a scrape happened. After each actual scrape the row is stamped
   `wolt_scraped_at = NOW()` (per-restaurant scrape time; see §3).
3a. **Field gating (`enabledFields`)**: mandatory fields (name/slug, coordinates, menu items, prices)
   are always captured; the checkboxes only gate **Address**, **Rating & reviews**, **Price range**,
   **Menu photos**. Empty selection → all on (`WOLT_ALL_FIELDS`). `Menu photos` gates only the R2
   push — `image_url` is always stored (the app needs it for pins). Disabled rating/reviews use
   `COALESCE(EXCLUDED, existing)` so they don't wipe data.
4. **Menu scrape = plain `fetch` of the page HTML + `page.setContent()` + `$$eval`** — NOT SPA
   rendering. The menu (`horizontal-item-card` markup) is **server-rendered into the HTML**, so we
   fetch it directly and parse it; no waiting for hydration/XHR. Captures name, description (`<p>`),
   price, image. (This is why scraping must run from a residential IP — see §0/§4.)
5. **Limit** = stop after N genuinely *new* restaurant inserts (`xmax = 0`). Persisted via
   `PATCH /admin/api/scripts/wolt/config` (`admin_settings.script_wolt_config_limit`).
6. Restaurant photo is **NOT** taken from Wolt (Google supplies it). Only meal photos come from Wolt.
   ⚠️ Consequence: a restaurant Google can't photo ends up with **no** restaurant photo (no fallback).
   A discussed-but-unimplemented option: fall back to Wolt `brand_image` / first meal photo.

### gplace — `runGooglePlaceScript(districtId, enabledFields=[], limit=null)` → **enricher**
- Selects Wolt restaurants in the district **`WHERE google_enriched_at IS NULL`** (skips already-done
  ones), `ORDER BY id DESC` (newest first), optional limit (pipeline passes the Wolt limit).
- Per restaurant: **FindPlace** by `name + address` (+ locationbias), then **Place Details**, then
  photo → R2 (only if `R2_PUBLIC_URL` set; else stores the Google CDN photo URL) → `UPDATE`. Google
  wins for photo/phone/website/hours; `COALESCE` keeps existing where Google has none. Stamps
  `google_enriched_at = NOW()` (processed once).
- **FindPlace error handling** (fixed — was the cause of ~75 restaurants with no hours): a transient
  `OVER_QUERY_LIMIT`/`REQUEST_DENIED` **stops the run WITHOUT stamping** (rows stay
  `google_enriched_at NULL` → retried next run); other transient statuses skip the single row without
  stamping. Only `ZERO_RESULTS` (genuinely not found) is stamped. **Fallback**: if the
  `name + address` query returns `ZERO_RESULTS`, it retries once with `name + Berlin` (rescues
  malformed/virtual addresses). Previously any non-OK status was mis-read as "not found" and the row
  was permanently stamped → never got Google hours/photo. To re-enrich falsely-failed rows, reset
  their `google_enriched_at` to NULL and re-run.
- Cost: FindPlace $0.017 + Details (base $0.017 + atmosphere $0.005 for rating, + contact $0.003).
- **Cost-saving stamp**: the ~1629 old Google-imported restaurants (id `ChIJ…`, already had Google
  data) were bulk-stamped `google_enriched_at = NOW()` so the enricher skips them. Only new `wolt:%`
  rows + ~60 old data-less rows remain enrichable. To re-enrich something, reset its stamp to NULL.
- **Photo gaps**: some restaurants get no photo because (a) not yet enriched, (b) FindPlace found no
  Google match, or (c) matched but the **Places API returns no `photos`** for that place_id (Google
  *Maps* user-photos are NOT all exposed via the API — a Google limitation, not a bug).

### macros — `runMacrosScript(districtId, reimprove=false, enabledFields=[])`
- Claude Haiku batches over `menu_items` needing work (`calories`/`meal_times` NULL **OR `category`
  NULL**) → fills cal/pro/fat/carb + confidence + meal_times, AND **classifies each item as a drink**
  from name + description → sets `category` = `'drink'` or `'food'` (`'food'` doubles as the
  "already drink-checked" marker so items aren't reprocessed forever). ~$0.11 / 1000 meals.
- **Field gating (`enabledFields`)**: the 5 macro fields are estimated jointly (one Claude call) so
  they move as a group; **Meal type** and **Drink detection** gate independently. The work-set
  NULL-check and the `UPDATE` SET clause are both built from enabled groups only (so a disabled
  column never keeps an item perpetually "incomplete"). Empty selection → all on. **Claude cost is
  identical regardless of checkboxes** — the prompt always returns every field; the boxes only
  control which columns are written back.
- **Completion stats** (shown in ScriptDetail + activity feed, fields on the job): `statMacros`
  (newly scored), `statDrinks` (newly tagged), `statMeals` {breakfast/lunch/dinner/snack/all_day}.
- **Pins require `calories IS NOT NULL`**, so Macros is mandatory before anything appears on the map.

### dedup — `runDedupScript(districtId)`
- Pure SQL: deletes duplicate **same dish name within the same restaurant** (`restaurant_id,
  LOWER(name)`, count>1), keeping best confidence. **Does NOT** dedupe near-identical dishes *across*
  restaurants or fuzzy-match names (the UI description now states this accurately). New Wolt data has
  ~0 (the menu insert's NOT EXISTS guard prevents intra-restaurant dupes), so for freshly-scraped
  districts dedup always reports 0 **by design** — it only cleans legacy/old-import dupes. ScriptDetail
  shows "Removed" (not "Added") for this script.

---

## 3. CRITICAL schema facts & gotchas (learned the hard way)

**`restaurants.id` is `TEXT`, not integer.** It historically holds the **Google Place ID**
(`ChIJ…`) from the original Google-first import (~1725 rows). There is **no sequence/default** on it.
- New **Wolt** restaurants have no Google id → we generate **`id = 'wolt:' + slug`** in the upsert.
  Never collides with `ChIJ…` ids. The app treats `restaurant.id` as an opaque string everywhere.
- Do **not** try to attach an integer sequence to `restaurants.id` (it's text — `ALTER … SET DEFAULT
  nextval` fails). A stray unused `restaurants_id_seq` may exist from a past mistake — harmless.

**`menu_items.id`** is `integer` with a working `menu_items_id_seq` default. `menu_items.restaurant_id`
is `TEXT`, FK → `restaurants.id`.

**`restaurants.wolt_scraped_at`** (`TIMESTAMPTZ`) = per-restaurant Wolt scrape time, stamped `NOW()`
on each actual menu scrape (mirrors `google_enriched_at`). Added + backfilled in `ensureWoltSchema`:
the backfill sets it from `updated_at` (which has `DEFAULT now()` and isn't touched by the upsert, so
for a `wolt:`-row it ≈ the original scrape). Re-scrape skipping is still keyed off **menu presence**,
not this timestamp — so menu-less rows are retried regardless. Surfaced to the admin as `addedAt`
(drives the restaurant-list "Recently added" sort).

**Partial unique index `restaurants_wolt_slug_idx`** = `(wolt_slug) WHERE wolt_slug IS NOT NULL`.
Postgres only infers a partial index when the conflict target repeats the predicate, so the upsert
**must** use `ON CONFLICT (wolt_slug) WHERE wolt_slug IS NOT NULL DO UPDATE …`.

**No unique index on `menu_items (restaurant_id, LOWER(name))`** — existing imported data has
duplicate dishes, so it can't be built. The menu insert therefore uses
`INSERT … SELECT … WHERE NOT EXISTS (…)` instead of `ON CONFLICT DO NOTHING`. Don't reintroduce that
index/ON CONFLICT.

**`/api/pins` only returns a restaurant if it has ≥1 `menu_items` with `source='wolt_menu'`,
`calories IS NOT NULL`, non-empty `image_url`, `category != 'drink'`, and the restaurant has lat/lon.**
So: scrape (menus) **and** macros (calories) **both** must run before pins appear. Cached 5 min.

---

## 4. Wolt API behavior (verified live)

- `consumer-api.wolt.com/v1/pages/restaurants?lat&lon` **ignores `limit`** and returns ~2000 venues
  **nearest** the point. A single point misses zone-bound venues in far corners (5-point method missed
  ~4%), so discovery uses a **~2.5 km grid** (calibrated sweet spot — see §2). Distant points return
  disjoint sets (Mitte vs Köpenick = 0 overlap). Too many rapid calls → Wolt **throttles** (returns
  fewer/empty) — keep the grid modest + 300 ms throttle.
- `venue.location` = **plain `[lng, lat]`** array (GeoJSON order): `location[1]`=lat, `[0]`=lng.
- `venue.price_range` = integer (1–4). `venue.rating = { rating, score (0–10), volume }` — we
  normalise `score` to 0–5 (÷2) and use `volume` as reviews_count. `venue.address` = string.
- `venue.brand_image` = **object `{ url, blurhash }`**, not a string (this once crashed
  `createHash().update()`). We don't use the Wolt restaurant photo at all anymore.
- **The menu page is served as IP/geo-gated server-rendered HTML.** A residential (German) IP gets the
  full page **with** the `horizontal-item-card` markup; Railway's datacenter IP gets `200` + full-size
  HTML **without** the menu markup → empty scrapes. THIS is why all scraping runs locally (§0).
- **Menu scrape = plain `fetch(wolt.com/de/deu/berlin/restaurant/{slug})` → `page.setContent(html)` →
  `$$eval`** (no SPA render needed; the cards are in the HTML). Per card: `…-header` (name), `<p>`
  (description), `…-price` (aria-label/text), `img` src/data-src. Retries once if 0 cards.

---

## 5. Deployment (Railway)

- **Builds via `Dockerfile`** (`railway.toml` → `builder = "DOCKERFILE"`). Base image
  **`mcr.microsoft.com/playwright:v1.60.0-jammy`** — ships Chromium + all system libs. This is
  required: under nixpacks Chromium failed with `error while loading shared libraries: libglib-2.0.so.0`.
- Deploy = **push to `main`** (`gkvasnikov/nutrition-app-2`) → Railway rebuilds. If a build fails,
  the previous deploy keeps running (the live app won't go down).
- Schema migrations run at startup AND at the top of `runWoltScript`: `ensureWoltSchema()`,
  `ensureGooglePlacesColumns()` (adds google_place_id/website/phone/google_enriched_at),
  `ensureActivitySchema()`.
- **`server.js` loads env via `dotenv.config({ override: true })`** — needed because the shell may
  export an **empty `ANTHROPIC_API_KEY`** that would otherwise shadow the `.env` value (plain dotenv
  doesn't override existing vars → Macros failed with "Could not resolve authentication method"). On
  Railway there's no `.env` (gitignored + `.dockerignore`), so override is a no-op there.
- **Global `process.on('unhandledRejection'|'uncaughtException')`** handlers log but don't exit, so a
  transient fault (e.g. a brief DNS blip dropping the DB connection) doesn't kill a long-running job.

---

## 6. Admin API endpoints (all require auth)

`/admin/api/stats`, `/districts`, `/restaurants`, `/restaurants/:id`,
`/scripts/status`, `/scripts/:id/run`, `/scripts/:id/stop`, `/scripts/:id/enabled` (PATCH),
`/scripts/wolt/config` (PATCH — persisted limit), `/scripts/pipeline/run|stop`,
`/scripts/macros/coverage`, `/activity`, `/cache-images/start|stop|status`, `/r2-recount`.

---

## 7. Activity feed & R2

- **Activity**: persistent `admin_activity` table (kind/text/sub/created_at). `logActivity()` writes
  start/finish events from each script + R2 sync; `GET /admin/api/activity` returns last 24 h (≤25);
  `ActivityFeed` polls every 15 s. Status colors: success/info/error.
- **R2** (Cloudflare): meal/restaurant images cached under `images/<md5>.<ext>` via `/api/image-proxy`
  (L1 memory → L2 R2 → L3 origin). Wolt meal photos are pushed to R2 during scraping
  (`cacheImagesToR2`). Google restaurant photos upload to `restaurants/<id>/photo.jpg` (needs
  `R2_PUBLIC_URL`). Bulk sync: `/admin/api/cache-images/*`. Helpers guard against non-string URLs.

---

## 8. Debugging playbook

- **Per-run errors** surface in the admin: each job's `lastError` shows in `ScriptDetail` + the
  activity feed. Don't swallow errors silently.
- **Inspect prod DB read-only** (local `.env` has `DATABASE_URL` = Railway public URL):
  ```
  node --input-type=commonjs <<'EOF'
  require("dotenv").config(); const {Pool}=require("pg");
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  pool.query("SELECT … ").then(r=>console.log(r.rows)).finally(()=>pool.end());
  EOF
  ```
  Use only SELECTs against prod. Single quotes inside `node -e '…'` collide with the shell — use a
  quoted heredoc instead.
- **Test the Wolt scrape locally** (Chromium is installed locally): launch `playwright` headless and
  scrape one slug — confirms selectors/menus without touching the DB. (A working venue returns
  100–300 cards.)
- **`/api/pins` debugging**: replicate its exact query filtered to `id LIKE 'wolt:%'` to see which
  new restaurants qualify. If a restaurant has menus+calories but isn't on screen, it's likely the
  **viewport** (app opens on Mitte; pan to the district) or the 5-min pin cache (reload).

---

## 9. Today's fix timeline (the stack of bugs, in order they surfaced)

The Wolt scraper broke as a **stack** of independent issues; each surfaced only after the prior fix.
Root architectural cause: we inverted **Google-first → Wolt-first**, but the schema's identity was
the Google Place ID.

1. **Chromium wouldn't launch** on nixpacks (missing `libglib`) → switched to the Playwright Docker image.
2. **Field type mismatches** (Wolt `price_range`/`rating` into numeric cols) → coerce to number/null.
3. **Headless UA** served a thin Wolt feed → set a real Chrome UA.
4. **Discovery** was single-centroid+`skip` → centroid + 4 corners (then learned one query already
   covers a district; corners are insurance).
5. **`ON CONFLICT (wolt_slug)`** didn't match the partial index → added `WHERE wolt_slug IS NOT NULL`.
6. **`restaurants.id` NULL** (text Google-Place-ID PK, no default) → generate `'wolt:'+slug`.
7. **`brand_image` is an object** → crashed hashing → dropped the Wolt restaurant photo entirely.
8. **menu insert** depended on a non-existent unique index → `INSERT … WHERE NOT EXISTS`.
9. **Intermittent 0-item scrapes** (networkidle) → `waitForSelector` for the menu cards.
10. **Menu-less existing rows starved by the limit** → process existing-but-menu-less venues first.
11. **Railway datacenter IP gets menu-less HTML** (the real root of the empty scrapes) → run all
    scraping **locally** (§0) and switch the scrape to **plain `fetch` + `setContent`** (the menu is in
    the server-rendered HTML).
12. **Empty `ANTHROPIC_API_KEY` in the shell shadowed `.env`** → `dotenv.config({ override: true })`.
13. **Transient DB/network blips crashed the server** → global `unhandledRejection`/`uncaughtException`.
14. **Discovery missed ~4%** (5-point method) → **~2.5 km grid** (calibrated).
15. **Admin showed 76 vs real 172** → removed `LIMIT 500` in `fetchAdminRestaurants`.
16. **Drink tagging + Macros stats** → Macros now classifies `category` food/drink (context-aware) and
    emits completion stats.
17. **Google cost** → bulk-stamped ~1629 old Google-imported restaurants `google_enriched_at = NOW()`
    so the enricher skips them.

**Verification of a healthy run**: Wolt on a district (limit N) → `ADDED N`, `ERRORS 0`, no
`Last error`; then Macros → calories filled + drinks tagged + stats; reload the app and pan to the
district → pins with dish photos. Google enricher then fills restaurant photo/phone/website/hours
(restaurants Google can't photo stay without a restaurant photo — no Wolt fallback yet).
