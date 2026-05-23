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
      PillMacro.jsx      — calorie/protein/fat/carbs pill with semantic background colors
      ButtonSeeAll.jsx
    molecules/
      TopBar.jsx         — white pill with icon left + title/subtitle center + filter icon right
      MainNavigation.jsx — frosted glass bottom nav (Home/Discover/Favourites/Profile)
      CardMeal.jsx       — meal card: photo + macros + dashed divider + restaurant row
      CardRestaurant.jsx — restaurant card: photo + rating + hours + distance
      HeroCarousel.jsx
  screens/
    Home.jsx / Home.module.css
    Discover.jsx / Discover.module.css
    Favourites.jsx / Favourites.module.css
    Profile.jsx / Profile.module.css
```

**Design tokens** are in `frontend/tokens.css` and imported globally via `src/index.css`. Always use token variables — never hard-code colors, spacing, radii, or font sizes. Key token categories: `--color-*`, `--spacing-*`, `--radius-*`, `--shadow-*`, `--font-size-*`, `--font-weight-*`.

**Discover screen** has a JS-driven bottom sheet:
- Two snap states: peek (`PEEK_SHOW = 200px` visible) and expanded (full height)
- `sheetRef` transform is set entirely via JS (`setTransform()`); CSS only provides the initial fallback
- Touch events attached to the entire sheet; `isDraggingSheet` ref distinguishes sheet drag from list scroll
- Velocity-based snapping: threshold ±0.3 px/ms
- `isExpandedRef` mirrors `isExpanded` state for stable closure access in touch handlers
- `topBarFill` is always rendered and animates in/out via a CSS class toggle (`translateY(-100%)` → `translateY(0)`)
- Floating "Map" button uses `MapFloatIcon` (inlined SVG component, not `<img>`) to avoid render delay

**Google Maps** loads via script tag in `Discover.jsx` using `VITE_GOOGLE_MAPS_API_KEY`. Map auto-centers on user geolocation with `map.panBy(0, 50)` (50px downward offset so pin clears bottom sheet). Map controls (zoom ±, locate) are custom SVG buttons — Google's default UI is disabled.

**Static assets:**
- `public/meals/` — dish photos (avif)
- `public/restaurants/` — restaurant photos (jpg/png)
- `public/` root — SVG icons used as `<img>` tags: `Map.svg`, `User.svg`, `Pie.svg`, `Door.svg`, `Chevron-right.svg`
- All files in `public/` are served at the root path (`/filename`)
- SVGs that need to render instantly (e.g. inside buttons) → add to `icons.jsx` as inlined React components instead of `<img>`

**iOS safe areas:** All screens use `env(safe-area-inset-top, 0px)` and `env(safe-area-inset-bottom, 0px)` for TopBar padding and bottom navigation positioning. The viewport meta has `viewport-fit=cover`.

## Screen-specific notes

**Home** — TopBar pill + HeroCarousel + horizontal-scroll restaurant sections (`CardRestaurant`).

**Discover** — Full-screen Google Map with draggable bottom sheet containing vertical `CardMeal` list. Sheet has peek (200px) and expanded states.

**Favourites** — Simple centered plain title (not TopBar pill) + vertical `CardMeal` list with solid separators.

**Profile** — Simple centered plain title + avatar + name + macros card (4 semantic cells) + divider + Log out row. Uses `public/` SVG assets as `<img>` tags.

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
- Figma file: `bfjUFyA4zVJVp0JaMrGoC7` (accessible via Figma MCP)
