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

**Tab routing** lives in `App.jsx` — a single `activeTab` state string (`'home'` | `'discover'` | …) selects which screen to render. `MainNavigation` calls `onTabChange` to switch tabs.

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
```

**Design tokens** are in `frontend/tokens.css` and imported globally via `src/index.css`. Always use token variables — never hard-code colors, spacing, radii, or font sizes. Key token categories: `--color-*`, `--spacing-*`, `--radius-*`, `--shadow-*`, `--font-size-*`, `--font-weight-*`.

**Discover screen** has a JS-driven bottom sheet:
- Two snap states: peek (`PEEK_SHOW = 200px` visible) and expanded (full height)
- `sheetRef` transform is set entirely via JS (`setTransform()`); CSS only provides the initial fallback
- Touch events attached to the entire sheet; `isDraggingSheet` ref distinguishes sheet drag from list scroll
- Velocity-based snapping: threshold ±0.3 px/ms
- `isExpandedRef` mirrors `isExpanded` state for stable closure access in touch handlers
- `topBarFill` is always rendered and animates in/out via a CSS class toggle (`translateY(-100%)` → `translateY(0)`)

**Google Maps** loads via script tag in `Discover.jsx` using `VITE_GOOGLE_MAPS_API_KEY`. Map auto-centers on user geolocation with a 50px downward pan offset (`map.panBy(0, 50)`). Map controls (zoom ±, locate) are custom SVG buttons — Google's default UI is disabled.

**Static assets:**
- `public/meals/` — dish photos (avif)
- `public/restaurants/` — restaurant photos (jpg/png)
- `public/Map.svg` — map icon used in the floating "Map" button on Discover (white fill, 16×16)
- All files in `public/` are served at the root path (`/filename`)

**iOS safe areas:** All screens use `env(safe-area-inset-top, 0px)` and `env(safe-area-inset-bottom, 0px)` for TopBar padding and bottom navigation positioning. The viewport meta has `viewport-fit=cover`.

## Design conventions

- `CardMeal` internal divider: **dashed** (`border-top: 1px dashed`)
- Separator **between** CardMeal cards on Discover: **solid** (`1px solid`) with `margin: 16px 0`
- `MainNavigation` background: `rgba(241, 241, 241, 0.3)` + `backdrop-filter: blur(6px)`
- All icons in `icons.jsx` use `fill="currentColor"` and accept `size` + `className` props
- SVG icons from Figma go into `icons.jsx` as named exports; external SVGs used as `<img>` go in `public/`
