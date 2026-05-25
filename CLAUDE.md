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
      ButtonSeeAll.jsx
    molecules/
      TopBar.jsx         — white pill with icon left + title/subtitle center + filter icon right
                           accepts `filterActive` prop → highlights filter icon (surface-2 bg)
                           z-index: 30 (above FiltersPanel)
      MainNavigation.jsx — frosted glass bottom nav (Home/Discover/Favourites/Profile)
      CardMeal.jsx       — meal card: photo + macros + dashed divider + restaurant row
                           accepts `hideRestaurant` prop to hide divider + restaurant row
                           (used inside RestaurantDescriptionOverlay)
                           accepts `restaurantId` → looks up coords via RESTAURANT_BY_ID,
                           computes live GPS distance via LocationContext + distanceTo()
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
                           panelWrapVisible controlled by isVisible state (mount first, then expand)
                           Unmount timer: 520ms; actions row stagger: 0.25s delay
                           Available on both Home and Discover screens
      ButtonFilterActions.jsx — Reset (no border, shadow-float) + Apply (shadow-float); NO padding on .wrap
                           (padding is provided by the parent context: FiltersPanel .actions or MealFilterOverlay bodyContent)
      MealDescriptionOverlay.jsx
                         — full-screen bottom sheet for a single meal
                           4 action buttons: Direction (Google Maps), Wolt (restaurant page),
                           Heart (favourite toggle, red when active), Share (Web Share API / clipboard fallback)
                           AI Advisor section: POST /api/advice → score + rating + advice text; skeleton while loading
                           Restaurant card at bottom: tappable → opens RestaurantDescriptionOverlay
                           Live GPS distance shown in restaurant meta row via LocationContext
      RestaurantDescriptionOverlay.jsx
                         — full-screen bottom sheet for a restaurant + its meals list
                           3 action buttons: Direction, Wolt, Share
                           Meals rendered with <CardMeal hideRestaurant />
                           Live GPS distance via LocationContext + RESTAURANT_BY_NAME lookup
                           z-index: backdrop 200, sheet 201
  contexts/
    LocationContext.jsx  — React Context providing { userLat, userLng } via navigator.geolocation.watchPosition
                           Wrap App with <LocationProvider>; useLocation() hook for consumers
                           Silent fail if permission denied — distance fields stay null
  screens/
    Home.jsx / Home.module.css
    Discover.jsx / Discover.module.css
    Favourites.jsx / Favourites.module.css
    Profile.jsx / Profile.module.css
  data/
    mockData.js          — auto-generated by extract_frontend_data.py (old project)
                           520 restaurants, ~23 000 meals — all Berlin
                           NEVER edit by hand; regenerate with the Python script
                           exports: MOCK_RESTAURANTS, MOCK_MEALS
    mockMeals.js         — re-export shim: export { MOCK_MEALS } from './mockData'
    restaurantLookup.js  — RESTAURANT_BY_ID and RESTAURANT_BY_NAME maps (O(1) lookup)
                           built from MOCK_RESTAURANTS at import time
  utils/
    distance.js          — haversine distance helpers:
                             haversineM(lat1,lon1,lat2,lon2) → metres
                             formatDistance(metres) → "380 m" | "1.2 km"
                             distanceTo(userLat,userLng,targetLat,targetLng) → string | null
    filterPill.jsx       — getTimedMealTime(), buildMainSubtitle() for TopBar subtitle
    photoUrl.js          — withKey(url) injects VITE_GOOGLE_MAPS_API_KEY at render time
                           NEVER store API keys in data files or mockData.js
```

**Design tokens** are in `frontend/tokens.css` and imported globally via `src/index.css`. Always use token variables — never hard-code colors, spacing, radii, or font sizes. Key token categories: `--color-*`, `--spacing-*`, `--radius-*`, `--shadow-*`, `--font-size-*`, `--font-weight-*`.

Key radius values: `--radius-sm` 4px · `--radius-md` 8px · `--radius-lg` 16px · `--radius-xl` 32px · `--radius-full` 100px.

---

## Data pipeline

Source of truth: `/Users/george/Claude/Nutrition App/data/all_restaurants.json` (old project).

Regeneration script: `/Users/george/Claude/Nutrition App/data/extract_frontend_data.py`  
Run from the old project root: `python3 data/extract_frontend_data.py`  
Writes output to `../../Nutrition App 2.0/frontend/src/data/mockData.js` (relative to script).

**What the script does:**
- Reads all Berlin restaurants with `wolt_menu` + `image_url` + `calories`
- Downloads pin thumbnails (80×80 JPEG, base64) in parallel (10 workers) → `pinPhoto` field
- Strips leading menu-order numbers from meal names (`"11. Pho Bo Chin"` → `"Pho Bo Chin"`; quantity numbers like `"6 Chicken Wings"` are preserved — they have no dot)
- Outputs `MOCK_RESTAURANTS` + `MOCK_MEALS` as a JS module

**Restaurant fields:** `id, name, photo, pinPhoto, rating, reviewCount, address, priceRange, isOpen, hours, distance (null), lat, lng, woltSlug`  
**Meal fields:** `id, name, photo, price, description, calories, protein, fat, carbs, restaurantId, restaurantName, restaurantPhoto, rating, reviewCount, priceRange, distance (null), restaurantAddress`

---

## App.jsx — global state

- `activeTab` — current screen
- `selectedMeal` / `selectedRestaurant` — open overlays (null = closed)
- `zIndexCounterRef` — monotonically increasing; incremented on each overlay open so the last-opened overlay is always on top
- `favourites` — array of meal objects, persisted to `localStorage('favourites')`; `toggleFavourite(meal)` adds/removes
- `filterProps` — `activeMainFilters`, `secondaryFilters` and their setters, shared across Home + Discover
- `<LocationProvider>` wraps the entire render tree (GPS context)

---

## Discover screen

Full-screen Google Map with a draggable bottom sheet and MealPin markers.

### Google Maps setup
- Script tag loaded in `Discover.jsx` using `VITE_GOOGLE_MAPS_API_KEY`
- `CENTER = { lat: 52.5170, lng: 13.3889 }` — Berlin center
- Initial zoom: `12` (all Berlin visible)
- Map auto-centers on user geolocation with `map.panBy(0, 50)` (50px offset so pin clears bottom sheet)
- Map controls (zoom ±, locate) are custom SVG buttons — Google's default UI is disabled
- `addMealPins` is async (pre-loads all images before creating markers)

### Bottom sheet
- Two snap states: peek (`PEEK_SHOW = 200px` visible) and expanded (full height)
- `sheetRef` transform is set entirely via JS (`setTransform()`); CSS only provides the initial fallback
- Touch events attached to the entire sheet; `isDraggingSheet` ref distinguishes sheet drag from list scroll
- Velocity-based snapping: threshold ±0.3 px/ms
- `isExpandedRef` mirrors `isExpanded` state for stable closure access in touch handlers
- `topBarFill` is always rendered and animates in/out via a CSS class toggle (`translateY(-100%)` → `translateY(0)`)
- Floating "Map" button uses `MapFloatIcon` (inlined SVG component, not `<img>`) to avoid render delay

### Visible meals count
`updateVisibleMeals()` computes "X Meals in Y restaurants around you" shown in the sheet header.

Uses **adjusted bounds** — not raw `map.getBounds()` — to exclude the area hidden behind the bottom sheet:
```js
const latPerPx = (ne.lat() - sw.lat()) / map.getDiv().offsetHeight
const visibleBounds = new google.maps.LatLngBounds(
  { lat: sw.lat() + PEEK_SHOW * latPerPx, lng: sw.lng() },
  { lat: ne.lat(), lng: ne.lng() },
)
```
Only pins inside `visibleBounds` contribute to the count.

### MealPin markers (Google Maps)
- Rendered via `<canvas>` (not SVG): circular photo crop + white border + drop shadow
- `createPinIcon(img, size, type, count)` → returns Google Maps icon object (url, scaledSize, anchor)
- Default size 40px, selected size 48px; animated with rAF ease-out cubic over 220ms (`animatePin`)
- Group pins have a black badge (r=11) at top-right; badge position from Figma: `cx = PAD + (size-1)`, `cy = PAD + 9` (constant y)
- `PIN_PAD = 10` — canvas breathing room so shadow never clips
- `activeMarkerRef` tracks the currently selected marker (stable ref, safe in map event handlers)

### Pin selection mechanic (MealPin → floating card)
- Clicking a pin hides the bottom sheet (slides fully off-screen) and shows a floating `pinCardWrap` at the bottom
- `selectedPin` state: `null | { type: 'single'|'group', meals: Meal[], img, ... }`
- `selectPin(cfg)` — selects (hides sheet) or deselects (restores sheet to peek) based on `cfg` being truthy/null
- `deselectPin()` — animates active marker back to 40px, then calls `selectPin(null)`
- `selectPinRef` — stable ref so map event handlers always call the latest `selectPin`
- Clicking empty map area triggers deselect (map `'click'` listener in `addMealPins`)

**Enter animation:** `pinCardSlideUp` — translateY(20px)→0, opacity 0→1, 350ms  
**Exit animation:** `pinCardSlideDown` — translateY(0)→20px, opacity 1→0, 300ms
- `pinExiting` state gates exit: card stays mounted during animation, unmounts after 300ms
- `lastSelectedPinRef` keeps card content visible during exit animation (selectedPin is still set)
- Gradient and "Map" button hidden while pin is selected; gradient reappears immediately on exit start (`!selectedPin || pinExiting`)

**Single pin:** one `CardMeal` in `.pinCardSingle` (margin 16px, `radius-lg` 16px, `shadow-float`)  
**Group pin:** horizontal CSS scroll-snap carousel (`.pinCardCarousel`); card width `calc(100% - 48px)` → 32px peek of next card; `scroll-padding-left: 8px`; direction + close buttons above in `.pinControls`

---

## Overlay components

### MealDescriptionOverlay
- Close button: `position: absolute` on `.sheet` (never scrolls)
- Photo scrolls inside `scrollContentRef`
- 4 action buttons: Direction (Google Maps URL), Wolt (woltSlug URL), Heart (isFavourite prop + onToggleFavourite), Share
- AI Advisor: `POST /api/advice` with meal macros → `{ score, rating, advice }`; skeleton shown while loading
- Restaurant card: taps open RestaurantDescriptionOverlay; live GPS distance from `LocationContext` + `MOCK_RESTAURANTS` lookup by `meal.restaurantId`
- `ratingGroup` wraps star + count tightly (gap: 2px)

### RestaurantDescriptionOverlay
- Same swipe-to-dismiss scroll structure as MealDescriptionOverlay
- Meals list uses `<CardMeal hideRestaurant />` — hides dashed divider + restaurant row
- 3 action buttons: Direction, Wolt, Share
- Live GPS distance via `useLocation()` + `RESTAURANT_BY_NAME[restaurant.name]`
- z-index: backdrop 200, sheet 201

---

## Backend

Express server (`server.js` at project root), proxied via Vite at `/api`.

`POST /api/advice` — calls Anthropic API (`claude-haiku-4-5-20251001`) with meal name + macros, returns `{ score: number, rating: 'Poor'|'Fair'|'Good'|'Excellent', advice: string }`.

API key: `ANTHROPIC_API_KEY` env var (Railway). Never hardcode.

---

## Static assets
- `public/meals/` — dish photos (avif): `bowl-pollo-asado`, `karisik-izgara`, `halbes-hahnchen`, `schnitzel-bowl`
- `public/restaurants/` — restaurant photos (jpg/png)
- `public/` root — SVG icons used as `<img>` tags: `Map.svg`, `User.svg`, `Pie.svg`, `Door.svg`, `Chevron-right.svg`
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
- `CardMeal` restaurant row gap: `var(--spacing-16)`
- `MainNavigation` background: `rgba(229, 229, 229, 0.3)` + `backdrop-filter: blur(6px)`
- All icons in `icons.jsx` use `fill="currentColor"` and accept `size` + `className` props
- Exception: `MapFloatIcon` has `fill="white"` hardcoded (white icon on dark button)
- WalkIcon (14×14) appears before distance values in CardMeal, CardRestaurant, and both overlays
- Figma file: `bfjUFyA4zVJVp0JaMrGoC7` (accessible via Figma MCP)

---

## Security rules

- `VITE_GOOGLE_MAPS_API_KEY` — injected at render time via `withKey(url)` (`src/utils/photoUrl.js`). **Never** store in `mockData.js` or any committed file.
- `ANTHROPIC_API_KEY` — backend only (`server.js`), set in Railway env vars.
- `mockData.js` contains no API keys — photo URLs are stored without the key parameter; `withKey()` appends it at runtime.
