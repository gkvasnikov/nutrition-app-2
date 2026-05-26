# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `frontend/`:

```bash
npm run dev       # dev server at localhost:5173
npm run build     # production build → dist/
npm run preview   # preview built dist/
npm run lint      # ESLint
```

Deployment is automatic: push to `main` on GitHub (`gkvasnikov/nutrition-app-2`) → Railway redeploys.

## Architecture

**Stack:** React 19 + Vite 8, CSS Modules, no routing library.

**Tab routing** lives in `App.jsx` — a single `activeTab` state string (`'home'` | `'discover'` | `'favourites'` | `'profile'`) selects which screen to render. `MainNavigation` calls `onTabChange` to switch tabs.

**Component hierarchy:**
```
src/
  components/
    atoms/
      icons.jsx          — all SVG icons as React components (fill="currentColor", size prop)
                           Exception: MapFloatIcon has fill="white" hardcoded
      PillMacro.jsx      — calorie/protein/fat/carbs pill with semantic background colors
      PillTab.jsx        — filter/tab pill; border 1px surface-2 (unselected) / text (selected); Body/regular 15px both states
                           accepts optional `icon` prop → renders 16×16 <img> before label with 4px gap
      PriceLevel.jsx     — €€€€ price indicator: `level` signs filled (color-text) + rest grey (opacity 0.2)
                           accepts `level` (1–4) and optional `className`
      ButtonSeeAll.jsx
    molecules/
      TopBar.jsx         — white pill with icon left + title/subtitle center + filter icon right
                           accepts `filterActive` prop → highlights filter icon (surface-2 bg)
                           z-index: 30 (above FiltersPanel)
      MainNavigation.jsx — frosted glass bottom nav (Home/Discover/Favourites/Profile)
      CardMeal.jsx       — meal card: photo + macros + dashed divider + restaurant row
                           accepts `hideRestaurant` prop to hide divider + restaurant row
                           (used inside RestaurantDescriptionOverlay)
                           accepts `restaurantId` → falls back to restaurantById (DataContext)
                           for restaurant name/rating/priceRange on compact meals
                           restaurant row: name + Open/Closed badge + rating + WalkIcon + distance
                           gap between dish/divider/restaurant row: var(--spacing-12)
      CardRestaurant.jsx — restaurant card: photo + rating + hours + distance
      HeroCarousel.jsx   — infinite-loop carousel, 3 slides, auto-advance 3s, swipe support
                           clone technique: 5 slots [clone_last, 0, 1, 2, clone_first]
                           DOM ref for transition control (avoids React batching issues)
      FiltersPanel.jsx   — "Второстепенные фильтры" (secondary filters). Slides down from top;
                           backdrop (z-index 20) + panel (z-index 21)
                           border-radius 0 0 --radius-xl --radius-xl on panel
                           sections: Macros confidence (multi-select), Measure (single), Sort by (single),
                           Open now + Top ranked (independent bool toggles)
                           pendingFilters pattern: edits isolated until Apply; opening resets pending to current
                           filter icon click toggles open/close without applying on close
                           animation: 0.55s cubic-bezier(0.25, 0.46, 0.45, 0.94)
                           wraps ButtonFilterActions in <div className={styles.actions}> with padding: 0 var(--spacing-16)
                           Available on both Home and Discover screens
      MealFilterOverlay.jsx — "Главные фильтры" (main filters). 3-card accordion overlay, z-index 35.
                           panelWrap horizontal padding: 8px (cards sit 8px from screen edges)
                           Cards: Meal Time (morphs from 59px pill to full card via max-height 0.55s),
                           Macros (slides in with stagger 0.1s), Profile (slides in with stagger 0.18s)
                           Accordion: CSS grid-template-rows 0fr→1fr for proportional simultaneous animation
                           Body structure: .body > .bodyInner (overflow:hidden, min-height:0) > .bodyContent (padding)
                           Opacity gating via CSS descendant selectors:
                             .cardMainExpanded .bodyOpen .bodyInner .bodyContent { opacity: 1 }
                             .cardVisible .bodyOpen .bodyInner .bodyContent { opacity: 1 }
                           toggleSection rule: cannot close without opening another (prev === key ? prev : key)
                           Animation state: isVisible (mounts component) + isExpanded (drives transitions)
                           panelWrapVisible keyed off isExpanded (NOT isVisible) — allows fade-out on close
                           Unmount timer: 520ms; panelWrap fade: 0.35s; actions row stagger: 0.25s delay
                           Meal Time pills have 16×16 icons: /icons/Breakfast.svg, /icons/Lunch.svg,
                             /icons/Dinner.svg, /icons/Snack.svg
                           Diet tag pills have 16×16 icons: /icons/Accordion/Pill/plant-based.svg,
                             /icons/Accordion/Pill/gluten-free.svg, /icons/Accordion/Pill/diabetes.svg
                           RangeSlider layout: label (52px fixed) left + sliderRight column (flex:1)
                             sliderRight: value text centered above (.sliderValue) + .sliderTrack (28px tall)
                             Track: 1px grey line via ::before pseudo-element; 2px black fill via .sliderFill div
                             Thumbs: 24×24px, border: 1px solid var(--color-text), box-shadow: var(--shadow-subtle)
                           Available on both Home and Discover screens
      ButtonFilterActions.jsx — Reset (no border, shadow-float) + Apply (shadow-float); NO padding on .wrap
                           (padding is provided by the parent context: FiltersPanel .actions or MealFilterOverlay bodyContent)
      MealDescriptionOverlay.jsx
                         — full-screen bottom sheet for a single meal
                           4 action buttons: Direction (Google Maps via mapsDirectionUrl), Wolt (restaurant page),
                           Heart (favourite toggle, red when active), Share (Web Share API / clipboard fallback)
                           Direction URL: walking if ≤1km, driving if >1km (mapsDirectionUrl from distance.js)
                           AI Advisor section: POST /api/advice → score + rating + advice text; skeleton while loading
                           Restaurant card: uses restaurantById.get(meal.restaurantId) from DataContext
                           (compact meals don't carry restaurantName/restaurantPhoto fields directly)
                           Tapping restaurant card → onRestaurantSelect(restaurantObj) with full pin data
                           Live GPS distance via LocationContext + restaurant lat/lng
      RestaurantDescriptionOverlay.jsx
                         — full-screen bottom sheet for a restaurant + its meals list
                           Fetches own meals: GET /api/restaurants/:id/meals on mount (restaurant.id required)
                           Shows loading state while meals fetch; no meals prop needed from parent
                           Meta row: rating · hours · distance · PriceLevel component (if priceLevel set)
                           3 action buttons: Direction (mapsDirectionUrl), Wolt, Share
                           Direction URL: walking if ≤1km, driving if >1km (mapsDirectionUrl from distance.js)
                           Meals rendered with <CardMeal hideRestaurant />
                           Live GPS distance via LocationContext + restaurant.lat/lng
                           z-index: backdrop 200, sheet 201
  contexts/
    DataContext.jsx      — loads /api/pins + /api/restaurant-summaries on mount (NOT /api/meals globally)
                           Exports: restaurants, summaries, summaryById (Map<id,summary>),
                           restaurantById (Map<id,restaurant>), restaurantByName (Map<name,restaurant>),
                           loading, error
                           Meals are NOT global — Discover loads them lazily per viewport
    LocationContext.jsx  — React Context providing { userLat, userLng } via navigator.geolocation.watchPosition
                           Wrap App with <LocationProvider>; useLocation() hook for consumers
                           Silent fail if permission denied — distance fields stay null
  screens/
    Home.jsx / Home.module.css
    Discover.jsx / Discover.module.css
    Favourites.jsx / Favourites.module.css
    Profile.jsx / Profile.module.css
  data/
    mockData.js          — LEGACY (no longer imported by app code). Static Berlin data used before
                           PostgreSQL migration. Do not use or regenerate.
    mockMeals.js         — LEGACY re-export shim, unused.
    restaurantLookup.js  — LEGACY static lookup maps, unused (DataContext provides these now).
  utils/
    distance.js          — haversine distance helpers:
                             haversineM(lat1,lon1,lat2,lon2) → metres
                             formatDistance(metres) → "380 m" | "1.2 km"
                             distanceTo(userLat,userLng,targetLat,targetLng) → string | null
                             mapsDirectionUrl(userLat,userLng,destLat,destLng) → Google Maps URL
                               walking mode if distance ≤1000m, driving mode otherwise
                               falls back to driving when user location unavailable
    filterPill.jsx       — getTimedMealTime(), buildMainSubtitle() for TopBar subtitle
    photoUrl.js          — withKey(url) injects VITE_GOOGLE_MAPS_API_KEY at render time
                           NEVER store API keys in data files or committed files
```

**Design tokens** are in `frontend/tokens.css` and imported globally via `src/index.css`. Always use token variables — never hard-code colors, spacing, radii, or font sizes. Key token categories: `--color-*`, `--spacing-*`, `--radius-*`, `--shadow-*`, `--font-size-*`, `--font-weight-*`.

Key radius values: `--radius-sm` 4px · `--radius-md` 8px · `--radius-lg` 16px · `--radius-xl` 32px · `--radius-full` 100px.

---

## Стек анимаций
- framer-motion установлен (`npm install framer-motion`)
- Использовать `motion.*` компоненты для анимаций входа/выхода
- Для list items — variants + staggerChildren
- Для модалок — AnimatePresence + exit анимации

---

## Data source — PostgreSQL (Railway)

All restaurant and meal data lives in a Railway PostgreSQL database. There is no local data file.

**Environment variables:**
- `DATABASE_URL` — set automatically by Railway addon; add to `.env` for local dev (use `DATABASE_PUBLIC_URL` from Railway dashboard)
- `ANTHROPIC_API_KEY` — backend only, set in Railway env vars

**Key tables:** `restaurants` (id, name, lat, lon, photo_url, rating, reviews_count, price_level, address, opening_hours, wolt_slug), `menu_items` (id, restaurant_id, name, calories, protein, fat, carbs, confidence, price, image_url, source)

**Relevant rows:** only `menu_items` with `source = 'wolt_menu'` and non-null `calories` + `image_url` are used.

---

## App.jsx — global state

- `activeTab` — current screen
- `selectedMeal` / `selectedRestaurant` — open overlays (null = closed)
- `zIndexCounterRef` — monotonically increasing; incremented on each overlay open so the last-opened overlay is always on top
- `favourites` — array of meal objects, persisted to `localStorage('favourites')`; `toggleFavourite(meal)` adds/removes
- `filterProps` — `activeMainFilters`, `secondaryFilters` and their setters, shared across Home + Discover
- `<LocationProvider>` wraps the entire render tree (GPS context)
- **No global meals array** — meals are loaded lazily per viewport in Discover

---

## Discover screen

Full-screen Google Map with a draggable bottom sheet and MealPin markers.

### Zoom-based architecture

Two modes determined by `PHOTO_ZOOM_THRESHOLD = 15`:

| Zoom | Mode | Pins | Sheet | Data loaded |
|---|---|---|---|---|
| < 15 | Dot mode | 8px dark circles | "Zoom into a neighbourhood…" | None (summaries only) |
| ≥ 15 | Photo mode | Circular photo pins | Meal list | `/api/area-meals` per viewport |

**Zoom limits:**
- `MAP_MIN_ZOOM = 12` — passed as `minZoom` to Google Maps constructor (Berlin overview)
- `MIN_ZOOM = 15` — custom "-" button disabled at this zoom and below
- `MAX_ZOOM = 19` — custom "+" button disabled at this zoom and above (locateMe=16, +3)
- Both limits enforced by `disabled` prop on buttons AND `minZoom`/`maxZoom` in Maps constructor (covers pinch-zoom too)

### Google Maps setup
- Script tag loaded in `Discover.jsx` using `VITE_GOOGLE_MAPS_API_KEY`
- `CENTER = { lat: 52.5170, lng: 13.3889 }` — Berlin center
- Initial zoom: `12` (all Berlin visible as dot-pins)
- `locateMe()` sets zoom to `16` (one step above threshold → photo mode)
- Map controls (zoom ±, locate) are custom SVG buttons — Google's default UI is disabled
- Tab switch: resize triggered via double-rAF (not setTimeout) to wait for display:none removal; center is restored after resize to prevent blank map

### Bottom sheet
- Two snap states: peek (`PEEK_SHOW = 200px` visible) and expanded (full height)
- `sheetRef` transform is set entirely via JS (`setTransform()`); CSS only provides the initial fallback
- Touch events attached to the entire sheet; `isDraggingSheet` ref distinguishes sheet drag from list scroll
- Velocity-based snapping: threshold ±0.3 px/ms
- `isExpandedRef` mirrors `isExpanded` state for stable closure access in touch handlers
- `topBarFill` is always rendered and animates in/out via a CSS class toggle (`translateY(-100%)` → `translateY(0)`)
- Floating "Map" button uses `MapFloatIcon` (inlined SVG component, not `<img>`) to avoid render delay
- Dot mode: sheet shows `.zoomPrompt` placeholder instead of meal list
- Empty-match state: when zoom ≥ 15 but `visibleMeals.length === 0`, sheet shows `.zoomPrompt` with
  "No meals match your filters here. Pan the map or ease up on the filters…" instead of the list
  Sheet header subtitle changes to "No matches — try adjusting filters" in this case

### Visible meals count
`updateVisibleMeals()` computes "X Meals in Y restaurants around you" shown in the sheet header.

Returns empty array in dot mode (zoom < 15).

Uses **adjusted bounds** — not raw `map.getBounds()` — to exclude the area hidden behind the bottom sheet:
```js
const latPerPx = (ne.lat() - sw.lat()) / map.getDiv().offsetHeight
const visibleBounds = new google.maps.LatLngBounds(
  { lat: sw.lat() + PEEK_SHOW * latPerPx, lng: sw.lng() },
  { lat: ne.lat(), lng: ne.lng() },
)
```

### Pin types

**Dot-pin** (`createDotIcon()`): 8px dark circle (`#212121`), canvas-based, shown at zoom < 15.
- Clicking a dot zooms map to `PHOTO_ZOOM_THRESHOLD` and pans to the restaurant
- Filter in dot mode: uses `summaryById` (macro ranges per restaurant) — no meal data loaded

**Photo-pin** (`createPinIcon(img, size, type, count)`): circular photo crop + white border + drop shadow, shown at zoom ≥ 15.
- Rendered via `<canvas>` (not SVG)
- Default size 40px, selected size 48px; animated with rAF ease-out cubic over 220ms (`animatePin`)
- Group pins have a black badge (r=11) at top-right; badge position: `cx = PAD + (size-1)`, `cy = PAD + 9`
- `PIN_PAD = 10` — canvas breathing room so shadow never clips
- `activeMarkerRef` tracks the currently selected marker (stable ref, safe in map event handlers)

### Pin photos and filter sync

Each photo-pin shows a photo of the **first meal that matches the current filters**.

`cfg` object per pin:
- `id` — restaurant id
- `photo` — proxy URL of currently loaded image
- `photoUrl` — raw Wolt CDN URL (change detection)
- `img` — preloaded `Image` element drawn into canvas
- `allMeals` — all area-loaded meals for this restaurant
- `meals` — currently filtered subset
- `count`, `type` — badge count and pin type

`applyFiltersToMeals(meals)` — filters and sorts a per-restaurant meal array:
- Applies mealTime, diet, macros range, dietTags (plantBased/glutenFree/diabetesFriendly), search
- Applies macrosConfidence filter: if `sf.macrosConfidence.length < 2`, only keep meals matching that confidence level
- Sorts by the current `sortBy` value (best_match score, a_z, nearest — nearest is a no-op here, sorted globally later)
- Used for: pin representative photo selection AND as input to `updateVisibleMeals()`

`updatePinFilters()` branches on zoom mode:
- **Dot mode**: `summaryMatchesFilters(summary)` → show/hide dot, no image loading
- **Photo mode**: `applyFiltersToMeals(cfg.allMeals)` → update meals, lazy-load new representative photo via `/api/image-proxy` if changed

`updateVisibleMeals()` collects all `cfg.meals` arrays from visible restaurants, then applies a **global sort**:
- `nearest`: sort by Euclidean distance from `map.getCenter()` to restaurant coordinates
- `a_z`: `localeCompare` on meal name
- `best_match` (default): score function (protein, calories, confidence weight) descending
- Global sort ensures meals from different restaurants are interleaved by relevance, not grouped by restaurant

**Canvas CORS**: Meal photos are on `imageproxy.wolt.com` (cross-origin). All pin photos routed through `/api/image-proxy` (same-origin) to prevent canvas taint.

### Area meal loading

`loadAreaMeals()` fires on every map `idle` event when zoom ≥ 15:
- Finds restaurants in current viewport not yet in `loadedAreaIds` ref
- Fetches `GET /api/area-meals?swLat=&swLng=&neLat=&neLng=`
- Groups meals by `restaurantId`, populates `cfg.allMeals`, marks ids in `loadedAreaIds`
- Calls `updatePinFilters()` to update icons and meal list

**Memory**: only restaurants in visited viewports are loaded. Moving to a new area loads ~50-100 more restaurants. Total in memory stays proportional to area explored, not total DB size.

### Pin selection mechanic (MealPin → floating card)
- Clicking a photo-pin hides the bottom sheet and shows a floating `pinCardWrap` at the bottom
- `selectedPin` state: `null | { type: 'single'|'group', meals: Meal[], img, ... }`
- `selectPin(cfg)` — selects (hides sheet) or deselects (restores sheet to peek)
- `deselectPin()` — animates active marker back to 40px, then calls `selectPin(null)`
- `selectPinRef` — stable ref so map event handlers always call the latest `selectPin`
- Clicking empty map area triggers deselect (map `'click'` listener)

**Enter animation:** `pinCardSlideUp` — translateY(20px)→0, opacity 0→1, 350ms  
**Exit animation:** `pinCardSlideDown` — translateY(0)→20px, opacity 1→0, 300ms
- `pinExiting` state gates exit: card stays mounted during animation, unmounts after 300ms
- `lastSelectedPinRef` keeps card content visible during exit animation
- Gradient and "Map" button hidden while pin is selected

**Single pin:** one `CardMeal` in `.pinCardSingle` (margin 16px, `radius-lg` 16px, `shadow-float`)  
**Group pin:** horizontal CSS scroll-snap carousel (`.pinCardCarousel`); card width `calc(100% - 48px)` → 32px peek of next card; `scroll-padding-left: 8px`; direction + close buttons above in `.pinControls`

---

## Overlay components

### MealDescriptionOverlay
- Close button: `position: absolute` on `.sheet` (never scrolls)
- Photo scrolls inside `scrollContentRef`
- 4 action buttons: Direction (Google Maps via `mapsDirectionUrl`), Wolt (woltSlug URL), Heart (isFavourite prop + onToggleFavourite), Share
- Direction URL: `mapsDirectionUrl(userLat, userLng, r.lat, r.lng)` — walking ≤1km, driving >1km
- AI Advisor: `POST /api/advice` with meal macros → `{ score, rating, advice }`; skeleton shown while loading
- Restaurant card: looks up restaurant via `restaurantById.get(meal.restaurantId)` from DataContext
  (compact meals from `/api/area-meals` don't carry restaurantName/restaurantPhoto)
  Tapping → `onRestaurantSelect(mealRestaurant)` passes full restaurant object with `id`

### RestaurantDescriptionOverlay
- Fetches own meals via `GET /api/restaurants/:id/meals` on mount; shows loading state
- No `meals` prop — parent just passes `restaurant` object (must include `id`)
- `restaurant` object fields used: `id`, `name`, `photo`, `address`, `lat`, `lng`, `woltSlug`, `priceLevel`, `rating`, `reviewCount`
- Meta row shows: rating · hours · WalkIcon+distance · `<PriceLevel level={restaurant.priceLevel} />` (if set)
- Meals rendered with `<CardMeal hideRestaurant />`
- 3 action buttons: Direction (`mapsDirectionUrl`), Wolt, Share — uses `restaurant.lat`/`lng`/`woltSlug` directly
- z-index: backdrop 200, sheet 201

---

## Backend

Express server (`server.js` at project root), proxied via Vite at `/api`.
All responses gzip-compressed via `compression` middleware (~70% size reduction).

### Endpoints

`GET /api/pins` — restaurant list for map markers. ~500 rows, cached 5 min.  
Fields: `id, name, lat, lng, woltSlug, photo, rating, reviewCount, priceLevel, address, mealCount, firstMealPhoto, isOpen, hours`

`GET /api/restaurant-summaries` — macro ranges per restaurant for dot-pin filtering.  
~500 rows × 8 fields = ~100 KB gzip. Cached 5 min.  
Fields: `id, minCal, maxCal, minPro, maxPro, minFat, maxFat, minCarb, maxCarb`

`GET /api/area-meals?swLat=&swLng=&neLat=&neLng=` — meals for restaurants in bounding box.  
Called at zoom ≥ 15 when user pans/zooms. Cached 60 s.  
Returns compact meal objects (no restaurant fields — look up via `restaurantById`).

`GET /api/restaurants/:id/meals` — all meals for one restaurant.  
Called by RestaurantDescriptionOverlay on open. Cached 60 s.  
Returns full meal objects (includes restaurantName, restaurantPhoto, priceRange, etc.).

`GET /api/meals` — all ~23K meals (kept for backward compat, not used by current UI).

`GET /api/image-proxy?url=<encoded>` — fetches Wolt CDN image server-side, streams back.  
Prevents canvas CORS taint in `createPinIcon`. Whitelisted: `imageproxy.wolt.com`, `maps.googleapis.com`.  
Server-side in-memory cache: `_proxyCache` Map, 24h TTL, max 2000 entries (evicts oldest).  
HTTP cache: `Cache-Control: public, max-age=86400`.

`POST /api/advice` — calls Anthropic API (`claude-haiku-4-5-20251001`) with meal name + macros.  
Returns `{ score: number, rating: 'Poor'|'Fair'|'Good'|'Excellent', advice: string }`.

API key: `ANTHROPIC_API_KEY` env var (Railway). Never hardcode.

---

## Static assets
- `public/meals/` — dish photos (avif): `bowl-pollo-asado`, `karisik-izgara`, `halbes-hahnchen`, `schnitzel-bowl`
- `public/restaurants/` — restaurant photos (jpg/png)
- `public/` root — SVG icons used as `<img>` tags: `Map.svg`, `User.svg`, `Pie.svg`, `Door.svg`, `Chevron-right.svg`
- `public/icons/` — meal time icons: `Breakfast.svg`, `Lunch.svg`, `Dinner.svg`, `Snack.svg`
- `public/icons/Accordion/Pill/` — diet tag icons: `plant-based.svg`, `gluten-free.svg`, `diabetes.svg`
  **These must be committed to git** — Railway builds from the repo; missing icons won't be served in production
- All files in `public/` are served at the root path (`/filename`)
- SVGs that need to render instantly (e.g. inside buttons) → add to `icons.jsx` as inlined React components instead of `<img>`

**iOS safe areas:** All screens use `env(safe-area-inset-top, 0px)` and `env(safe-area-inset-bottom, 0px)` for TopBar padding and bottom navigation positioning. The viewport meta has `viewport-fit=cover`.

---

## Screen-specific notes

**Home** — TopBar pill + HeroCarousel + horizontal-scroll restaurant sections (`CardRestaurant`).  
TopBar `onPillClick` → opens главные фильтры (MealFilterOverlay); `onFilterClick` → toggles второстепенные фильтры (FiltersPanel).

**Discover** — Full-screen Google Map with draggable bottom sheet (peek/expanded) + MealPin markers with floating card mechanic on selection. See full details above.  
TopBar `onPillClick` → opens главные фильтры (MealFilterOverlay); `onFilterClick` → toggles второстепенные фильтры (FiltersPanel).  
TopBar title: "Discover"; subtitle built from `buildMainSubtitle(activeMainFilters)` (mealTime + diet label).

**Favourites** — Simple centered plain title (not TopBar pill) + vertical `CardMeal` list with solid separators. Receives `favourites` prop from App.jsx. Shows empty state ("No favourites saved yet") when list is empty.

**Profile** — Simple centered plain title + avatar + name + macros card (4 cells, no border-radius) + divider + Log out row. Uses `public/` SVG assets as `<img>` tags.

---

## Design conventions

- **TopBar pill** (Home, Discover): `TopBar` component — white pill, shadow-float, 59px height.
- **Plain title** (Favourites, Profile): simple centered `<span>`, 17px bold, positioned same height as TopBar pill.
- `CardMeal` internal divider: **dashed** (`border-top: 1px dashed var(--color-surface-2)`)
- Separator **between** `CardMeal` cards: **solid** `1px` line, `margin: var(--spacing-16) 0`
- `CardMeal` gap between dish/divider/restaurant row: `var(--spacing-12)`
- `CardMeal` restaurant row gap: `var(--spacing-12)`
- `MainNavigation` background: `rgba(229, 229, 229, 0.3)` + `backdrop-filter: blur(6px)`
- All icons in `icons.jsx` use `fill="currentColor"` and accept `size` + `className` props
- Exception: `MapFloatIcon` has `fill="white"` hardcoded (white icon on dark button)
- WalkIcon (14×14) appears before distance values in CardMeal, CardRestaurant, and both overlays
- Figma file: `bfjUFyA4zVJVp0JaMrGoC7` (accessible via Figma MCP)

---

## Security rules

- `VITE_GOOGLE_MAPS_API_KEY` — injected at render time via `withKey(url)` (`src/utils/photoUrl.js`). **Never** store in any committed file.
- `ANTHROPIC_API_KEY` — backend only (`server.js`), set in Railway env vars.
- `DATABASE_URL` — backend only, set in Railway env vars / local `.env`. Never commit.
- Photo URLs in API responses are stored without the key parameter; `withKey()` appends it at runtime.
