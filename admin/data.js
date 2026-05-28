/* Nutrition Admin — data initialisation
   DISTRICTS and RESTAURANTS come from window.__SERVER_DATA__ (injected server-side).
   SCRIPTS, ACTIVITY, and COST_BREAKDOWN remain static stubs here.
*/
(function() {

const MEALS_SAMPLE = [
  { name: 'Schnitzel mit Pommes', kcal: 920, p: 48, f: 52, c: 64, photo: '#E8C39F' },
  { name: 'Wiener Würstchen', kcal: 580, p: 24, f: 42, c: 28, photo: '#D4B58A' },
  { name: 'Käsespätzle', kcal: 740, p: 28, f: 36, c: 78, photo: '#E4B074' },
  { name: 'Sauerbraten', kcal: 680, p: 52, f: 28, c: 42, photo: '#A87850' },
];

const SCRIPTS = [
  { id: 'gplace', name: 'Google Place Scraper', icon: 'map-pin', desc: 'Hours, address, ratings, photos, coordinates.',
    lastRun: '2h ago', duration: '4m 12s', status: 'success', cost: '$12',
    coverage: 100, errors: 0,
    includes: ['Working hours', 'Rating & reviews', 'Price level', 'Address', 'Photo', 'Phone number', 'Website'] },
  { id: 'wolt', name: 'Wolt Menu Scraper', icon: 'utensils', desc: 'Menu items, prices, photos from Wolt CDN.',
    lastRun: '5h ago', duration: '11m 04s', status: 'success', cost: '$8',
    coverage: 92, errors: 2,
    includes: ['Venue discovery', 'Wolt slug', 'Menu items', 'Prices', 'Photos'] },
  { id: 'uber', name: 'Uber Eats Scraper', icon: 'utensils', desc: 'Cross-check menu vs Uber Eats.',
    lastRun: '3d ago', duration: '7m 38s', status: 'warning', cost: '$6',
    coverage: 64, errors: 18,
    includes: ['Menu items', 'Prices', 'Delivery fee'] },
  { id: 'web', name: 'Restaurant Website Scraper', icon: 'globe', desc: 'Fallback: scrape restaurant\'s own site.',
    lastRun: 'Failed yesterday', duration: '—', status: 'error', cost: '$0',
    coverage: 12, errors: 9,
    includes: ['HTML menu', 'PDF menu', 'Phone', 'Hours'] },
  { id: 'macros', name: 'Macros + Meal Type (Claude)', icon: 'brain', desc: 'Estimate kcal/protein/fat/carbs and classify meal type per dish.',
    lastRun: '2h ago', duration: '23m 12s', status: 'success', cost: '$28',
    coverage: 96, errors: 0,
    includes: ['Calories', 'Protein', 'Fat', 'Carbs', 'Confidence score', 'Meal type'] },
  { id: 'dedup', name: 'Detect Duplicate Meals', icon: 'copy', desc: 'Group near-identical dishes across menus.',
    lastRun: '1d ago', duration: '1m 56s', status: 'success', cost: '$0',
    coverage: 100, errors: 0,
    includes: ['Duplicate removal'] },
];

const ACTIVITY = [
  { kind: 'success', text: 'Macros Estimator completed', sub: 'Mitte · 2,763 meals scored', time: '2m' },
  { kind: 'success', text: 'Google Place Scraper completed', sub: 'Mitte · 12 restaurants updated', time: '8m' },
  { kind: 'info',    text: 'Scrape started: Pankow', sub: 'Google Place Scraper · running…', time: '14m' },
  { kind: 'error',   text: 'Restaurant Website Scraper failed', sub: 'mogg.de · 502 Bad Gateway · retry x3 exhausted', time: '32m' },
  { kind: 'info',    text: 'Cost threshold approaching', sub: 'Anthropic month-to-date $186 / $200', time: '1h' },
  { kind: 'success', text: 'Wolt Menu Scraper completed', sub: 'Mitte · 12/12 menus · 0 errors', time: '5h' },
  { kind: 'success', text: 'Photos resynced', sub: 'Mitte · 412 photos · cache primed', time: '6h' },
  { kind: 'error',   text: 'Image-proxy cache evicted oldest 200', sub: 'memory pressure (capacity 2000)', time: '8h' },
];

const COST_BREAKDOWN = {
  total: 186, budget: 200,
  parts: [
    { label: 'Anthropic Claude', value: 142, color: 'var(--color-text)' },
    { label: 'Google Places',    value: 28,  color: '#0080ff' },
    { label: 'Image proxy',      value: 12,  color: 'var(--color-accent)' },
    { label: 'Other',            value: 4,   color: 'var(--color-text-3)' },
  ],
};

const serverData = window.__SERVER_DATA__ || {};
window.AdminData = {
  DISTRICTS:    serverData.DISTRICTS    || [],
  RESTAURANTS:  serverData.RESTAURANTS  || [],
  MEALS_SAMPLE,
  SCRIPTS,
  ACTIVITY,
  COST_BREAKDOWN,
};
})();
