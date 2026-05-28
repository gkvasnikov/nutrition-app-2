/* Nutrition Admin — Main App
   View states: 'berlin' | 'district'  (drill-down)
   Detail panels: restaurant | script (overlay over the workspace)
*/

const { useState, useEffect, useMemo, useRef, useCallback } = React;
const { DISTRICTS, RESTAURANTS, MEALS_SAMPLE, SCRIPTS, ACTIVITY, COST_BREAKDOWN } = window.AdminData;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "green",
  "mapTheme": "light",
  "density": "comfortable"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = window.useTweaks
    ? window.useTweaks(TWEAK_DEFAULTS)
    : [TWEAK_DEFAULTS, () => {}];

  const [view, setView]                       = useState('berlin');    // 'berlin' | 'district'
  const [districtId, setDistrictId]           = useState(null);
  const [berlinTab, setBerlinTab]             = useState('neighbourhoods'); // 'neighbourhoods' | 'restaurants' | 'stats'
  const [districtTab, setDistrictTab]         = useState('restaurants');    // 'restaurants' | 'scripts'
  const [selectedRestaurantId, setRestaurantId] = useState(null);
  const [selectedScriptId, setScriptId]         = useState(null);
  const [hoverDistrict, setHoverDistrict]     = useState(null);
  const [feedOpen, setFeedOpen]               = useState(true);
  const [toast, setToast]                     = useState(null);
  const hoverTimerRef                         = useRef(null);

  const districts = DISTRICTS;
  const district  = districts.find(d => d.id === districtId);

  // Debounced hover handler — delays hiding by 180ms so moving mouse
  // from polygon onto the floating card doesn't cause flicker.
  const handleHover = useCallback((id) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (id) {
      setHoverDistrict(id);
    } else {
      hoverTimerRef.current = setTimeout(() => setHoverDistrict(null), 180);
    }
  }, []);

  // Sync map -> drill-down when a district polygon is clicked
  const onDistrictSelect = useCallback((id) => {
    const d = districts.find(x => x.id === id);
    if (!d) return;
    setDistrictId(id);
    setView('district');
    // Default to Restaurants tab for covered districts, Scripts for empty/active
    setDistrictTab(d.status === 'covered' ? 'restaurants' : 'scripts');
  }, [districts]);

  const { zoomTo, focusPin, zoomIn, zoomOut } = window.useBerlinMap({
    districts,
    restaurants: RESTAURANTS,
    selectedId: districtId,
    onSelect: onDistrictSelect,
    onHover: handleHover,
    onRestaurantPin: (id) => { setRestaurantId(id); focusPin(id); },
    accent: t.accent || 'green',
    theme: t.mapTheme || 'light',
  });

  // Animate map when view changes
  useEffect(() => {
    if (view === 'district' && districtId) zoomTo(districtId);
    if (view === 'berlin') zoomTo(null);
  }, [view, districtId, zoomTo]);

  // Floating tooltip on map = hovered district info
  const hoverData = hoverDistrict ? districts.find(d => d.id === hoverDistrict) : null;

  return (
    <div className="app">
      <Sidebar
        view={view} setView={setView}
        districtId={districtId} setDistrictId={setDistrictId}
        berlinTab={berlinTab} setBerlinTab={setBerlinTab}
        districtTab={districtTab} setDistrictTab={setDistrictTab}
        onDistrictSelect={onDistrictSelect}
        selectedRestaurantId={selectedRestaurantId}
        onRestaurantOpen={(id) => { setRestaurantId(id); focusPin(id); }}
        onScriptOpen={setScriptId}
        showToast={setToast}
      />
      <div className="workspace">
        <div id="map"/>

        {/* Map overlay top bar */}
        <div className="maptop">
          <div className="maptop__title">
            {view === 'berlin' ? (
              <>
                <Icon name="map-pin" size={14}/>
                <span>Berlin</span>
                <span className="muted" style={{ fontWeight: 500 }}>· 12 districts</span>
              </>
            ) : (
              <>
                <button className="breadcrumb__back" onClick={() => { setView('berlin'); setDistrictId(null); }} style={{ width: 22, height: 22, marginRight: 0 }}>
                  <Icon name="chevron-left" size={14}/>
                </button>
                <span className="muted" style={{ fontWeight: 500, cursor: 'pointer' }} onClick={() => { setView('berlin'); setDistrictId(null); }}>Berlin</span>
                <Icon name="chevron-right" size={12} style={{ color: 'var(--color-text-3)' }}/>
                <span>{district?.name}</span>
              </>
            )}
          </div>
          <div className="spacer"/>
          <div className="maptop__legend">
            <span className="legend__item"><span className="legend__swatch legend__swatch--covered"/>Covered</span>
            <span className="legend__item"><span className="legend__swatch legend__swatch--warn"/>Scraping</span>
            <span className="legend__item"><span className="legend__swatch legend__swatch--none"/>No data</span>
          </div>
        </div>

        {/* Map right controls */}
        <div className="mapright">
          <button className="mapbtn" title="Zoom in"  onClick={zoomIn}><Icon name="plus" size={16}/></button>
          <button className="mapbtn" title="Zoom out" onClick={zoomOut}><Icon name="minus" size={16}/></button>
          <div className="mapbtn-sep"/>
          <button className="mapbtn" title="Reset view" onClick={() => zoomTo(null)}><Icon name="refresh" size={14}/></button>
        </div>

        {/* Hovered district floating card */}
        <DistrictHoverCard
          data={hoverData}
          onOpen={() => onDistrictSelect(hoverDistrict)}
          onMouseEnter={() => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); }}
          onMouseLeave={() => { hoverTimerRef.current = setTimeout(() => setHoverDistrict(null), 180); }}
        />

        {/* Activity feed */}
        <ActivityFeed open={feedOpen} onToggle={() => setFeedOpen(v => !v)}/>

        {/* Detail panels */}
        <RestaurantDetail
          restaurantId={selectedRestaurantId}
          onClose={() => setRestaurantId(null)}
        />
        <ScriptDetail
          scriptId={selectedScriptId}
          district={district}
          onClose={() => setScriptId(null)}
          showToast={setToast}
        />

        {/* Toast */}
        {toast && (
          <div className={`toast toast--show`}>
            <span>{toast.text}</span>
            {toast.action && <button className="btn btn--ghost" style={{ color: 'white', height: 24, padding: '0 8px', fontSize: 12 }} onClick={() => setToast(null)}>{toast.action}</button>}
          </div>
        )}
      </div>

      {/* Tweaks (only renders when toolbar Tweaks is on) */}
      {window.TweaksPanel && (
        <window.TweaksPanel title="Tweaks">
          <window.TweakSection label="Map">
            <window.TweakRadio
              label="Tile theme"
              value={t.mapTheme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'clean', label: 'Clean' },
                { value: 'dark',  label: 'Dark'  },
              ]}
              onChange={v => setTweak('mapTheme', v)}
            />
          </window.TweakSection>
          <window.TweakSection label="Accent">
            <window.TweakRadio
              label="District color"
              value={t.accent}
              options={[
                { value: 'green', label: 'Emerald' },
                { value: 'blue',  label: 'Blue'    },
                { value: 'black', label: 'Black'   },
              ]}
              onChange={v => setTweak('accent', v)}
            />
          </window.TweakSection>
        </window.TweaksPanel>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sidebar — switches content depending on view
   ───────────────────────────────────────────────────────────── */
function Sidebar(props) {
  const { view } = props;
  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <div className="brand">
          <span className="brand__mark">N</span>
          <span style={{ flex: 1 }}>Nutrition <span className="brand__sub">/ Admin · v2.0</span></span>
          <form method="POST" action="/admin/logout" style={{ margin: 0 }}>
            <button type="submit" className="btn btn--ghost" style={{ height: 28, padding: '0 8px', fontSize: 12, color: 'var(--color-text-3)' }} title="Sign out">
              <Icon name="external" size={13}/>
            </button>
          </form>
        </div>
        {view === 'berlin' ? <BerlinHeader {...props}/> : <DistrictHeader {...props}/>}
      </div>

      {view === 'berlin'
        ? <BerlinBody {...props}/>
        : <DistrictBody {...props}/>}
    </aside>
  );
}

/* ─── Berlin overview ─── */
function BerlinHeader({ berlinTab, setBerlinTab }) {
  const totalCovered = DISTRICTS.filter(d => d.status === 'covered').length;
  const totalActive  = DISTRICTS.filter(d => d.status === 'active').length;
  const totalMeals   = DISTRICTS.reduce((s,d) => s + (d.meals||0), 0);
  return (
    <>
      <div className="breadcrumb">
        <span className="breadcrumb__crumb">Berlin</span>
      </div>
      <Search placeholder="Search districts, restaurants, meals…"/>
      <div className="statsrow">
        <Cell label="Districts covered" value={`${totalCovered} / 12`} sub="2 active · 1 scraping" subClass="statsrow__sub--up"/>
        <Cell label="Total meals" value={totalMeals.toLocaleString('en-US')} sub="+312 this week" subClass="statsrow__sub--up"/>
        <Cell label="MTD spend" value="$186" sub="$200 budget · 93%" subClass="statsrow__sub--down"/>
      </div>
      <div className="tabs" style={{ marginLeft: -24, marginRight: -24, paddingLeft: 24, paddingRight: 24 }}>
        <button className={`tab ${berlinTab==='neighbourhoods'?'tab--active':''}`} onClick={() => setBerlinTab('neighbourhoods')}>
          Neighbourhoods <span className="tab__count">12</span>
        </button>
        <button className={`tab ${berlinTab==='restaurants'?'tab--active':''}`} onClick={() => setBerlinTab('restaurants')}>
          All Restaurants <span className="tab__count">{RESTAURANTS.length}</span>
        </button>
        <button className={`tab ${berlinTab==='stats'?'tab--active':''}`} onClick={() => setBerlinTab('stats')}>
          Stats
        </button>
      </div>
    </>
  );
}

function Cell({ label, value, sub, subClass }) {
  return (
    <div className="statsrow__cell">
      <span className="statsrow__label">{label}</span>
      <span className="statsrow__value num">{value}</span>
      {sub && <span className={`statsrow__sub ${subClass||''}`}>{sub}</span>}
    </div>
  );
}

function BerlinBody(props) {
  const { berlinTab, onDistrictSelect } = props;
  return (
    <div className="sidebar__body fade-in" key={berlinTab}>
      {berlinTab === 'neighbourhoods' && <NeighbourhoodsList onSelect={onDistrictSelect}/>}
      {berlinTab === 'restaurants' && <AllRestaurants onOpen={props.onRestaurantOpen} selectedId={props.selectedRestaurantId}/>}
      {berlinTab === 'stats' && <BerlinStats/>}
    </div>
  );
}

function NeighbourhoodsList({ onSelect }) {
  const covered = DISTRICTS.filter(d => d.status === 'covered');
  const active = DISTRICTS.filter(d => d.status === 'active');
  const none = DISTRICTS.filter(d => d.status === 'none');
  return (
    <>
      <div className="section">
        <div className="section__head">
          <span className="section__title">Covered</span>
          <span className="section__count">{covered.length}</span>
        </div>
        <div className="dlist">
          {covered.map(d => <DistrictRow key={d.id} d={d} onSelect={onSelect} variant="covered"/>)}
        </div>
      </div>
      {active.length > 0 && (
        <div className="section">
          <div className="section__head">
            <span className="section__title">Scraping</span>
            <span className="section__count">{active.length}</span>
          </div>
          <div className="dlist">
            {active.map(d => <DistrictRow key={d.id} d={d} onSelect={onSelect} variant="warn"/>)}
          </div>
        </div>
      )}
      <div className="section">
        <div className="section__head">
          <span className="section__title">Not covered</span>
          <span className="section__count">{none.length}</span>
        </div>
        <div className="dlist">
          {none.map(d => <DistrictRow key={d.id} d={d} onSelect={onSelect} variant="none"/>)}
        </div>
      </div>
    </>
  );
}

function DistrictRow({ d, onSelect, variant }) {
  return (
    <div className={`drow drow--${variant}`} onClick={() => onSelect(d.id)}>
      <span className="drow__dot"/>
      <span className="drow__name">{d.name}</span>
      {variant === 'covered' && (
        <span className="drow__meta">
          <span><strong className="num">{d.restaurants}</strong> rest.</span>
          <span><strong className="num">{(d.meals||0).toLocaleString('en-US')}</strong> meals</span>
        </span>
      )}
      {variant === 'warn' && (
        <span className="drow__meta">
          <Pill variant="warn" dot>scraping</Pill>
        </span>
      )}
      {variant === 'none' && (
        <span className="drow__meta muted" style={{ fontSize: 12 }}>—</span>
      )}
      <Icon name="chevron-right" size={14} className="drow__chev"/>
    </div>
  );
}

function AllRestaurants({ onOpen, selectedId }) {
  return <RestaurantList title="All restaurants · Berlin" restaurants={RESTAURANTS} onOpen={onOpen} selectedId={selectedId}/>;
}

/* Shared filterable restaurant list — used by Berlin overview "All Restaurants"
   tab AND district drill-down Restaurants tab */
function RestaurantList({ title, restaurants, onOpen, selectedId }) {
  const [filter, setFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(30);
  const sentinelRef = useRef(null);

  const filtered = useMemo(() => {
    if (filter === 'partners') return restaurants.filter(x => x.partner);
    return restaurants;
  }, [filter, restaurants]);

  // Reset visible count when filter or dataset changes
  useEffect(() => { setVisibleCount(30); }, [filter, restaurants]);

  // IntersectionObserver — auto-loads next 30 when sentinel scrolls into view
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setVisibleCount(v => v + 30);
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length, visibleCount]);

  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visibleCount;

  return (
    <>
      <div className="section">
        <div className="chips">
          <Chip active={filter==='all'}      onClick={() => setFilter('all')}>All <span className="num">{restaurants.length}</span></Chip>
          <Chip active={filter==='partners'} onClick={() => setFilter('partners')}>Partners</Chip>
        </div>
      </div>
      <div className="section">
        <div className="section__head">
          <span className="section__title">{title}</span>
          <button className="btn btn--ghost" style={{ height: 24, padding: '0 6px', fontSize: 12 }}>
            <Icon name="filter" size={12}/>Sort
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visible.map(r => <RestaurantRow key={r.id} r={r} onOpen={onOpen} active={r.id === selectedId}/>)}
        </div>
        {remaining > 0 && (
          <div ref={sentinelRef} style={{ textAlign: 'center', padding: '12px 0', fontSize: 12, color: 'var(--color-text-3)' }}>
            {remaining} more…
          </div>
        )}
      </div>
    </>
  );
}

function RestaurantRow({ r, onOpen, active }) {
  const priceEl = r.priceLevel
    ? Array.from({ length: 4 }, (_, i) => (
        <span key={i} style={{ opacity: i < r.priceLevel ? 1 : 0.2 }}>€</span>
      ))
    : null;

  return (
    <div className={`irow ${active ? 'irow--active' : ''}`} onClick={() => onOpen?.(r.id)}>
      <div className="irow__img" style={r.photo ? {} : { background: `linear-gradient(135deg, oklch(0.85 0.06 ${(r.id.charCodeAt(1)*7)%360}), oklch(0.75 0.10 ${(r.id.charCodeAt(1)*11)%360}))` }}>
        {r.photo && <img src={r.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-md)', display: 'block' }} loading="lazy"/>}
      </div>
      <div className="irow__main">
        <div className="irow__name">{r.name}</div>
        {r.address && <div className="irow__addr">{r.address}</div>}
        <div className="irow__status">
          {r.open != null && (
            <span style={{ color: r.open ? 'var(--color-rating-green)' : 'var(--color-text-3)', fontWeight: 600 }}>
              {r.open ? 'Open' : 'Closed'}
            </span>
          )}
          {r.hours && <><span className="irow__meta__dot"/><span>{r.hours}</span></>}
          {priceEl && <><span className="irow__meta__dot"/><span>{priceEl}</span></>}
          {r.rating != null && (
            <><span className="irow__meta__dot"/><span><span style={{ color: 'var(--color-rating-star)' }}>★</span><span className="num"> {r.rating}</span>{r.reviews ? <span className="muted"> ({r.reviews})</span> : null}</span></>
          )}
        </div>
      </div>
      <Icon name="chevron-right" size={14} className="irow__chev"/>
    </div>
  );
}

function R2CachePanel() {
  const [job, setJob]             = useState(null);
  const [stats, setStats]         = useState(null);
  const [r2Enabled, setR2Enabled] = useState(false);
  const [recounting, setRecounting] = useState(false);
  const pollRef = useRef(null);

  const fetchStatus = useCallback(() => {
    fetch('/admin/api/cache-images/status')
      .then(r => r.json())
      .then(d => { setJob(d.job); setR2Enabled(d.r2Enabled); setStats(d.stats); })
      .catch(() => {});
  }, []);

  const recount = useCallback(() => {
    setRecounting(true);
    fetch('/admin/api/r2-recount', { method: 'POST' })
      .then(r => r.json())
      .then(() => fetchStatus())
      .catch(() => {})
      .finally(() => setRecounting(false));
  }, [fetchStatus]);

  useEffect(() => { fetchStatus(); }, []);

  useEffect(() => {
    if (job?.running) { pollRef.current = setInterval(fetchStatus, 2000); }
    else { clearInterval(pollRef.current); }
    return () => clearInterval(pollRef.current);
  }, [job?.running]);

  const start = () => fetch('/admin/api/cache-images/start', { method: 'POST' })
    .then(r => r.json()).then(d => { setJob(d.job); setStats(d.stats); }).catch(() => {});
  const stop  = () => fetch('/admin/api/cache-images/stop',  { method: 'POST' })
    .then(r => r.json()).then(d => { setJob(d.job); setStats(d.stats); }).catch(() => {});

  // While a job is running show live progress %; otherwise show persisted coverage %
  // Formula: * 1000 / 10 gives one decimal place percentage (0.0–100.0)
  const activePct = job?.running && job?.total > 0
    ? Math.round(job.done / job.total * 1000) / 10
    : null;
  const coveragePct = activePct ?? stats?.coveragePct ?? null;
  const pctDisplay  = coveragePct !== null ? coveragePct.toFixed(1) : '—';

  const now           = Date.now();
  const lastSyncAgo   = stats?.lastSyncAt  ? msToRelative(now - new Date(stats.lastSyncAt).getTime())  : null;
  const nextSyncDate  = stats?.nextSyncAt  ? new Date(stats.nextSyncAt)  : null;
  const nextSyncAgo   = nextSyncDate       ? msToRelative(now - nextSyncDate.getTime())                : null;
  const syncOverdue   = nextSyncDate && nextSyncDate.getTime() < now;

  // Status pill
  const statusPill = !r2Enabled
    ? <Pill variant="warn"    dot>R2 not configured</Pill>
    : job?.running
      ? <Pill variant="warn"  dot>syncing…</Pill>
      : syncOverdue
        ? <Pill variant="warn" dot>sync overdue</Pill>
        : stats?.lastSyncAt
          ? <Pill variant="success" dot>up to date</Pill>
          : <Pill dot>never synced</Pill>;

  return (
    <div className="section">
      <div className="section__head">
        <span className="section__title">R2 Image Cache</span>
        {statusPill}
      </div>
      <div style={{ border: '1px solid var(--color-stroke)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', overflow: 'hidden' }}>

        {/* Coverage hero */}
        <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          <span className="num" style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>{pctDisplay}%</span>
          <span style={{ fontSize: 13, color: 'var(--color-text-2)', paddingBottom: 3, flex: 1 }}>photos cached in R2</span>
          {r2Enabled && !job?.running && (
            <button
              onClick={recount}
              disabled={recounting}
              title="Count actual objects in R2 to verify coverage"
              style={{ height: 28, padding: '0 10px', fontSize: 12, borderRadius: 'var(--radius-full)', border: '1px solid var(--color-stroke)', background: 'var(--color-surface-2)', color: 'var(--color-text-2)', cursor: recounting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginBottom: 3 }}
            >
              <Icon name="refresh" size={11} style={{ animation: recounting ? 'spin 1s linear infinite' : 'none' }}/>
              {recounting ? 'Counting…' : 'Verify'}
            </button>
          )}
        </div>

        {/* Progress bar */}
        {coveragePct !== null && (
          <div style={{ margin: '0 16px 12px' }}>
            <div className="progress">
              <div className="progress__fill" style={{
                width: `${Math.min(coveragePct, 100)}%`,
                background: coveragePct >= 95 ? 'var(--color-accent)' : coveragePct >= 80 ? 'var(--color-rating-star)' : '#e53',
                transition: 'width 0.4s ease',
              }}/>
            </div>
          </div>
        )}

        {/* Counts */}
        {stats?.totalCount > 0 && (
          <div style={{ padding: '0 16px 12px', display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-text-2)', flexWrap: 'wrap' }}>
            <span><span className="num" style={{ color: 'var(--color-text)', fontWeight: 700 }}>{stats.cachedCount.toLocaleString()}</span> cached</span>
            <span><span className="num" style={{ color: 'var(--color-text)', fontWeight: 700 }}>{stats.totalCount.toLocaleString()}</span> total</span>
            {stats.errorCount > 0 && <span style={{ color: 'var(--color-text-3)' }}><span className="num">{stats.errorCount.toLocaleString()}</span> dead links</span>}
            {stats.newlyCachedCount > 0 && <span style={{ color: 'var(--color-accent)' }}><span className="num">+{stats.newlyCachedCount.toLocaleString()}</span> last run</span>}
          </div>
        )}

        {/* Sync dates */}
        {(stats?.lastSyncAt || stats?.nextSyncAt) && (
          <div style={{ margin: '0 16px 12px', padding: '10px 12px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.lastSyncAt && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-2)' }}>Last sync</span>
                <span style={{ color: 'var(--color-text)' }}>
                  {new Date(stats.lastSyncAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  <span className="muted"> · {lastSyncAgo}</span>
                </span>
              </div>
            )}
            {nextSyncDate && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-2)' }}>Next sync</span>
                <span style={{ color: syncOverdue ? '#e53' : 'var(--color-text)' }}>
                  {nextSyncDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  <span className="muted"> · {syncOverdue ? `${nextSyncAgo} overdue` : `in ${nextSyncAgo}`}</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Run button */}
        <div style={{ padding: '0 12px 12px' }}>
          {job?.running
            ? <Btn variant="secondary" block icon="pause" onClick={stop}>Stop sync</Btn>
            : <Btn variant="primary" block icon="zap" onClick={start} disabled={!r2Enabled}>
                {stats?.lastSyncAt ? (syncOverdue ? 'Sync now (overdue)' : 'Re-sync') : 'Download all photos to R2'}
              </Btn>}
        </div>

        {/* Live progress while running */}
        {job?.running && job?.total > 0 && (
          <div style={{ padding: '0 16px 12px', fontSize: 12, color: 'var(--color-text-3)', textAlign: 'center' }}>
            {job.done.toLocaleString()} / {job.total.toLocaleString()}
            {job.skipped > 0 && <span style={{ color: 'var(--color-accent)' }}> · {job.skipped.toLocaleString()} already in R2</span>}
            {job.newlyCached > 0 && <span> · {job.newlyCached.toLocaleString()} new</span>}
            {job.errors > 0 && <span> · {job.errors} errors</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// Converts milliseconds to a human-readable relative string ("2 days", "3 hours", etc.)
function msToRelative(ms) {
  const abs = Math.abs(ms);
  if (abs < 60_000)              return 'just now';
  if (abs < 3_600_000)           return `${Math.round(abs / 60_000)}m`;
  if (abs < 86_400_000)          return `${Math.round(abs / 3_600_000)}h`;
  if (abs < 7 * 86_400_000)      return `${Math.round(abs / 86_400_000)}d`;
  return `${Math.round(abs / (7 * 86_400_000))}w`;
}

function BerlinStats() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun'];
  const mapsUsage = [120, 165, 190, 142, 178, 210];
  const claudeUsage = [620, 840, 990, 1120, 1180, 1320];
  const maxA = Math.max(...mapsUsage), maxB = Math.max(...claudeUsage);
  return (
    <>
      <R2CachePanel/>
      <div className="section">
        <div className="section__head">
          <span className="section__title">Cost-to-date · This month</span>
          <Pill variant="info" dot>day 27</Pill>
        </div>
        <div style={{ padding: '14px 16px', border: '1px solid var(--color-stroke)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>${COST_BREAKDOWN.total}</span>
            <span className="muted">of ${COST_BREAKDOWN.budget} budget</span>
          </div>
          <div style={{ marginTop: 10, display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--color-surface-3)' }}>
            {COST_BREAKDOWN.parts.map((p, i) => (
              <div key={i} style={{ width: `${(p.value/COST_BREAKDOWN.budget)*100}%`, background: p.color }}/>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {COST_BREAKDOWN.parts.map((p,i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }}/>
                <span style={{ flex: 1 }} className="muted">{p.label}</span>
                <span className="num" style={{ fontWeight: 600 }}>${p.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <span className="section__title">Anthropic Tokens</span>
          <span className="section__count num">1.32M this month</span>
        </div>
        <div className="chart">
          {claudeUsage.map((v,i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="chart__bar" style={{ height: `${(v/maxB)*100}%` }}/>
              <div className="chart__label">{months[i]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <span className="section__title">Google Maps Calls</span>
          <span className="section__count num">210K this month</span>
        </div>
        <div className="chart">
          {mapsUsage.map((v,i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="chart__bar" style={{ height: `${(v/maxA)*100}%`, background: '#0080ff' }}/>
              <div className="chart__label">{months[i]}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─── District drill-down ─── */
function DistrictHeader({ districtId, setDistrictId, setView, districtTab, setDistrictTab }) {
  const d = DISTRICTS.find(x => x.id === districtId);
  if (!d) return null;
  return (
    <>
      <div className="breadcrumb">
        <button className="breadcrumb__back" onClick={() => { setView('berlin'); setDistrictId(null); }}>
          <Icon name="chevron-left" size={18}/>
        </button>
        <span className="breadcrumb__crumb breadcrumb__crumb--muted" onClick={() => { setView('berlin'); setDistrictId(null); }}>Berlin</span>
        <span className="breadcrumb__sep">/</span>
        <span className="breadcrumb__crumb">{d.name}</span>
      </div>
      <Search placeholder={`Search restaurants in ${d.name}…`}/>
      <div className="statsrow">
        <Cell label="Restaurants" value={d.restaurants || 0} sub={d.restaurants ? 'partners' : '—'}/>
        <Cell label="Meals indexed" value={(d.meals || 0).toLocaleString('en-US')} sub={d.meals ? `${Math.round(d.meals/d.restaurants)} avg/rest.` : '—'}/>
        <Cell label="Coverage" value={`${d.coverage || 0}%`} sub={d.cost ? `${d.cost} spent` : '—'}/>
      </div>
      <div className="tabs" style={{ marginLeft: -24, marginRight: -24, paddingLeft: 24, paddingRight: 24 }}>
        <button className={`tab ${districtTab==='restaurants'?'tab--active':''}`} onClick={() => setDistrictTab('restaurants')}>
          Restaurants <span className="tab__count">{d.restaurants||0}</span>
        </button>
        <button className={`tab ${districtTab==='scripts'?'tab--active':''}`} onClick={() => setDistrictTab('scripts')}>
          Scripts <span className="tab__count">{SCRIPTS.length}</span>
        </button>
        <button className={`tab ${districtTab==='stats'?'tab--active':''}`} onClick={() => setDistrictTab('stats')}>
          Stats
        </button>
      </div>
    </>
  );
}

function DistrictBody({ districtId, districtTab, setDistrictTab, onRestaurantOpen, onScriptOpen, showToast, selectedRestaurantId }) {
  const d = DISTRICTS.find(x => x.id === districtId);
  if (!d) return null;
  return (
    <div className="sidebar__body" key={districtTab}>
      {districtTab === 'restaurants' && (
        d.restaurants > 0
          ? <DistrictRestaurants d={d} onOpen={onRestaurantOpen} selectedId={selectedRestaurantId}/>
          : <RestaurantsEmpty d={d} onJumpToScripts={() => setDistrictTab('scripts')}/>
      )}
      {districtTab === 'scripts' && <DistrictScripts d={d} onOpen={onScriptOpen} showToast={showToast}/>}
      {districtTab === 'stats' && (
        d.meals > 0
          ? <DistrictMiniStats d={d}/>
          : <StatsEmpty d={d} onJumpToScripts={() => setDistrictTab('scripts')}/>
      )}
    </div>
  );
}

function EmptyState({ icon = 'database', title, body, primary, primaryIcon, onPrimary, secondary, onSecondary, footer }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 8px 24px' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--color-surface-3)', display: 'grid', placeItems: 'center' }}>
        <Icon name={icon} size={28} style={{ color: 'var(--color-text-3)' }}/>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 16, letterSpacing: '-0.01em' }}>{title}</div>
      <div className="muted" style={{ marginTop: 6, maxWidth: 320, fontSize: 13, fontWeight: 400 }}>{body}</div>
      {(primary || secondary) && (
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          {primary && <Btn variant="primary" icon={primaryIcon} onClick={onPrimary}>{primary}</Btn>}
          {secondary && <Btn variant="secondary" onClick={onSecondary}>{secondary}</Btn>}
        </div>
      )}
      {footer && <div style={{ marginTop: 20, width: '100%' }}>{footer}</div>}
    </div>
  );
}

function RestaurantsEmpty({ d, onJumpToScripts }) {
  return (
    <EmptyState
      icon="utensils"
      title="No restaurants yet"
      body={`${d.name} hasn't been scraped. Run the scrapers to populate the restaurant list.`}
      primary="Open scripts"
      primaryIcon="play"
      onPrimary={onJumpToScripts}
    />
  );
}

function StatsEmpty({ d, onJumpToScripts }) {
  return (
    <EmptyState
      icon="brain"
      title="No data to chart"
      body={`Run the macros estimator and other scripts to populate confidence stats for ${d.name}.`}
      primary="Open scripts"
      primaryIcon="play"
      onPrimary={onJumpToScripts}
    />
  );
}

function DistrictRestaurants({ d, onOpen, selectedId }) {
  const filtered = RESTAURANTS.filter(r => r.districtId === d.id);
  return <RestaurantList title={`${d.name} · restaurants`} restaurants={filtered} onOpen={onOpen} selectedId={selectedId}/>;
}

function Chip({ active, onClick, children }) {
  return (
    <button className={`chip ${active?'chip--active':''}`} onClick={onClick}>{children}</button>
  );
}

function DistrictScripts({ d, onOpen, showToast }) {
  // Derive per-district script state — covered districts use the canned SCRIPTS;
  // empty/active districts show idle scripts with optional running first step.
  const scripts = useMemo(() => {
    if (d.status === 'covered') return SCRIPTS;
    if (d.status === 'active') {
      return SCRIPTS.map((s, i) => ({
        ...s,
        status: i === 0 ? 'running' : 'idle',
        lastRun: i === 0 ? 'running now' : 'never',
        duration: i === 0 ? '~ 4 min' : '—',
        coverage: i === 0 ? 42 : 0,
      }));
    }
    // status === 'none'
    return SCRIPTS.map(s => ({ ...s, status: 'idle', lastRun: 'never', duration: '—', coverage: 0 }));
  }, [d.status]);

  // Real job status from server
  const [jobs, setJobs]         = useState({});
  const [enabled, setEnabled]   = useState({});
  const [pipeline, setPipeline] = useState({});
  const pollRef                 = useRef(null);

  const fetchStatus = useCallback(() => {
    fetch('/admin/api/scripts/status')
      .then(r => r.json())
      .then(data => {
        setJobs(data.jobs || {});
        setEnabled(data.enabled || {});
        setPipeline(data.pipeline || {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Poll every 2s while any script or pipeline is running
  useEffect(() => {
    const anyRunning = Object.values(jobs).some(j => j.running) || pipeline.running;
    if (anyRunning) {
      pollRef.current = setInterval(fetchStatus, 2000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [jobs, pipeline, fetchStatus]);

  const runOne = (s) => {
    fetch(`/admin/api/scripts/${s.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ districtId: d.id }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.job) setJobs(prev => ({ ...prev, [s.id]: data.job }));
        showToast({ text: `${s.name} started for ${d.name}` });
      })
      .catch(() => showToast({ text: `Failed to start ${s.name}` }));
  };

  const toggleEnabled = (id) => {
    const newVal = enabled[id] !== false ? false : true;
    fetch(`/admin/api/scripts/${id}/enabled`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newVal }),
    })
      .then(r => r.json())
      .then(data => setEnabled(prev => ({ ...prev, [id]: data.enabled })))
      .catch(() => {});
  };

  const PIPELINE_STEPS = ['wolt', 'gplace', 'macros', 'dedup'];

  const runPipeline = () => {
    // Read wolt limit from already-polled job state (persisted configLimit)
    const woltLimit = jobs.wolt?.configLimit || null;
    fetch('/admin/api/scripts/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ districtId: d.id, ...(woltLimit ? { woltLimit } : {}) }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.pipeline) setPipeline(data.pipeline);
        showToast({ text: `Pipeline started for ${d.name}${woltLimit ? ` (Wolt limit: ${woltLimit})` : ''}` });
        fetchStatus();
      })
      .catch(() => showToast({ text: `Failed to start pipeline` }));
  };

  const stopPipeline = () => {
    fetch('/admin/api/scripts/pipeline/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(r => r.json())
      .then(() => {
        showToast({ text: `Pipeline cancelled for ${d.name}` });
        fetchStatus();
      })
      .catch(() => {});
  };

  const pipelineRunning = pipeline.running;
  const headerStatus = pipelineRunning
    ? <Pill variant="warn" dot>pipeline running</Pill>
    : d.status === 'covered'
      ? <Pill variant="success" dot>last sync {d.lastSync}</Pill>
      : <Pill dot>never run</Pill>;

  const runAllLabel   = pipelineRunning ? 'Cancel pipeline' : (d.status === 'covered' ? 'Re-run all scripts' : 'Start full pipeline');
  const runAllIcon    = pipelineRunning ? 'pause' : 'refresh';
  const runAllVariant = pipelineRunning ? 'secondary' : 'primary';

  // Pipeline step progress row
  const pipelineStepNames = { wolt: 'Wolt', gplace: 'Google', macros: 'Macros', dedup: 'Dedup' };
  const showPipelineProgress = pipelineRunning || (pipeline.finishedAt && pipeline.stepsDone?.length > 0);

  return (
    <>
      <div className="section">
        <div className="section__head">
          <span className="section__title">Pipeline · {d.name}</span>
          {headerStatus}
        </div>
        {showPipelineProgress && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 0 12px', flexWrap: 'wrap' }}>
            {PIPELINE_STEPS.filter(id => enabled[id] !== false).map((id, i, arr) => {
              const isDone    = pipeline.stepsDone?.includes(id);
              const isCurrent = pipeline.step === id;
              const isPending = !isDone && !isCurrent;
              return (
                <React.Fragment key={id}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 100,
                    background: isDone ? 'var(--color-success-bg, #e6f9e6)' : isCurrent ? 'var(--color-warn-bg, #fff3cd)' : 'var(--color-surface-2)',
                    color: isDone ? 'var(--color-success, #1a7a1a)' : isCurrent ? 'var(--color-warn, #856404)' : 'var(--color-text-3)',
                    opacity: isPending && !pipelineRunning ? 0.5 : 1,
                  }}>
                    {isDone ? '✓ ' : isCurrent ? '⟳ ' : ''}{pipelineStepNames[id]}
                  </span>
                  {i < arr.length - 1 && <span style={{ fontSize: 10, color: 'var(--color-text-3)' }}>→</span>}
                </React.Fragment>
              );
            })}
          </div>
        )}
        <div className="scards">
          {scripts.map(s => (
            <ScriptCard
              key={s.id}
              s={s}
              job={jobs[s.id]}
              enabled={enabled[s.id] !== false}
              onToggle={() => toggleEnabled(s.id)}
              onOpen={() => onOpen(s.id)}
              running={jobs[s.id]?.running || (pipeline.running && pipeline.step === s.id)}
              onRun={(e) => { e.stopPropagation(); runOne(s); }}
            />
          ))}
        </div>
      </div>
      <div className="section">
        {!pipelineRunning && jobs.wolt?.configLimit && (
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-2)' }}>
            Wolt limit: <strong className="num">{jobs.wolt.configLimit}</strong> new restaurants
          </div>
        )}
        <Btn variant={runAllVariant} size="lg" block icon={runAllIcon}
          onClick={pipelineRunning ? stopPipeline : runPipeline}
        >{runAllLabel}</Btn>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: 'var(--color-text-2)' }}>
          <span>Estimated cost: <strong className="num" style={{ color: 'var(--color-text)' }}>$48 — $62</strong></span>
          <span>~ 45 min</span>
        </div>
      </div>
    </>
  );
}

function ScriptCard({ s, job, enabled, onToggle, onOpen, running, onRun }) {
  const statusMap = {
    success: { v: 'success', label: 'OK' },
    warning: { v: 'warn',    label: 'partial' },
    error:   { v: 'danger',  label: 'failed' },
    running: { v: 'warn',    label: 'running' },
    idle:    { v: 'default', label: 'never run' },
  };
  const st = statusMap[s.status] || statusMap.success;

  // Derive meta text: show live status when running, or format finishedAt
  let metaTime = s.lastRun;
  if (job?.running) {
    metaTime = 'running…';
  } else if (job?.finishedAt) {
    metaTime = 'just now';
  }

  return (
    <div className={`scard ${!enabled ? 'scard--disabled' : ''}`} onClick={onOpen}>
      {/* Checkbox — left column, uses project's .check/.check--off design */}
      <label className="scard__check" onClick={e => e.stopPropagation()} title={enabled ? 'Disable script' : 'Enable script'}>
        <input type="checkbox" checked={enabled} onChange={onToggle} className="checklist__input"/>
        <span className={`check ${enabled ? '' : 'check--off'}`} style={{ width: 22, height: 22, borderRadius: 7 }}>
          {enabled && <Icon name="check" size={11}/>}
        </span>
      </label>

      {/* Icon */}
      <div className="scard__icon"><Icon name={s.icon} size={18}/></div>

      {/* Name + meta + progress bar */}
      <div style={{ minWidth: 0 }}>
        <div className="scard__name">{s.name}</div>
        <div className="scard__meta">
          <span>{metaTime}</span>
          {s.coverage > 0 && <><span>·</span><span className="num">{s.coverage}% cov.</span></>}
          {s.duration && s.duration !== '—' && <><span>·</span><span className="num">{s.duration}</span></>}
        </div>
        {job?.running && job?.total > 0 && (
          <div className="scard__progress">
            <div className="scard__progress__bar">
              <div className="scard__progress__fill" style={{ width: `${Math.min(job.done / job.total * 100, 100)}%` }}/>
            </div>
            <div className="scard__progress__label">
              {job.done.toLocaleString()} / {job.total.toLocaleString()}
              {job.newItems > 0 && <span style={{ color: 'var(--color-accent)' }}> · {job.newItems} updated</span>}
              {job.errors > 0 && <span style={{ color: '#e53' }}> · {job.errors} errors</span>}
            </div>
          </div>
        )}
      </div>

      {/* Status pill + run button */}
      <div className="scard__right">
        {st.v === 'default'
          ? <Pill dot>{st.label}</Pill>
          : <Pill variant={st.v} dot>{running ? 'running' : st.label}</Pill>}
        <button className="scard__run" onClick={onRun} title={running ? 'Running…' : 'Run this script'}>
          <Icon name={running ? 'pause' : 'play'} size={14}/>
        </button>
      </div>
    </div>
  );
}

function DistrictMiniStats({ d }) {
  return (
    <>
      <div className="section">
        <div className="section__title">Confidence distribution</div>
        <div style={{ padding: 14, border: '1px solid var(--color-stroke)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
          {[
            { label: 'High (>0.85)', count: 1820, color: 'var(--color-accent)' },
            { label: 'Medium (0.7–0.85)', count: 614, color: '#0080ff' },
            { label: 'Low (<0.7)', count: 329, color: 'var(--color-rating-star)' },
          ].map((row, i) => (
            <div key={i} style={{ marginBottom: i < 2 ? 10 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span>{row.label}</span>
                <span className="num" style={{ fontWeight: 600 }}>{row.count.toLocaleString('en-US')}</span>
              </div>
              <div className="progress"><div className="progress__fill" style={{ width: `${(row.count/2763)*100}%`, background: row.color }}/></div>
            </div>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="section__title">Latest runs</div>
        <div>
          {[
            { name: 'Macros Estimator', when: '2h ago', dur: '23m 12s', ok: true },
            { name: 'Google Place', when: '5h ago', dur: '4m 12s', ok: true },
            { name: 'Wolt Menu', when: '5h ago', dur: '11m 04s', ok: true },
            { name: 'Restaurant Website', when: '1d ago', dur: 'failed', ok: false },
          ].map((r,i) => (
            <div key={i} className="runrow">
              <span style={{ color: r.ok ? 'var(--color-accent)' : 'var(--color-rating-star)' }}>
                <Icon name={r.ok ? 'check-circle' : 'x-circle'} size={14}/>
              </span>
              <span style={{ fontWeight: 500 }}>{r.name}</span>
              <span className="runrow__time">{r.when}</span>
              <span className="runrow__dur">{r.dur}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─── Floating district hover card on map ─── */
function DistrictHoverCard({ data, onOpen, onMouseEnter, onMouseLeave }) {
  const show = !!data;
  return (
    <div className={`mapcard ${show?'mapcard--show':''}`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {data && (
        <>
          <div className="mapcard__head">
            <div>
              <div className="mapcard__name">{data.name}</div>
              <div style={{ marginTop: 4 }}>
                {data.status === 'covered' && <Pill variant="success" dot>covered</Pill>}
                {data.status === 'active' && <Pill variant="warn" dot>scraping…</Pill>}
                {data.status === 'none' && <Pill dot>no data</Pill>}
              </div>
            </div>
          </div>
          {data.status === 'covered' ? (
            <>
              <div className="mapcard__stats">
                <div>
                  <div className="mapcard__stat__v num">{data.restaurants}</div>
                  <div className="mapcard__stat__l">Restaurants</div>
                </div>
                <div>
                  <div className="mapcard__stat__v num">{data.meals.toLocaleString('en-US')}</div>
                  <div className="mapcard__stat__l">Meals</div>
                </div>
                <div>
                  <div className="mapcard__stat__v num">{data.coverage}%</div>
                  <div className="mapcard__stat__l">Coverage</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="primary" block icon="arrow-up-right" onClick={onOpen}>Open</Btn>
                <Btn variant="secondary" icon="refresh">Re-sync</Btn>
              </div>
            </>
          ) : data.status === 'active' ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--color-text-2)', margin: '4px 0 10px' }}>
                Initial scrape running. ETA ~38 min.
              </div>
              <div className="progress" style={{ marginBottom: 10 }}><div className="progress__fill" style={{ width: '42%', background: 'var(--color-rating-star)' }}/></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-3)', marginBottom: 12 }}>
                <span>Google Place Scraper · step 2/6</span>
                <span className="num">42%</span>
              </div>
              <Btn variant="secondary" block icon="eye" onClick={onOpen}>View progress</Btn>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--color-text-2)', margin: '4px 0 12px' }}>
                Not yet covered. Start the scraping pipeline to add it.
              </div>
              <Btn variant="primary" block icon="play" onClick={onOpen}>Start scraping</Btn>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Activity feed (floating, collapsible) ─── */
function ActivityFeed({ open, onToggle }) {
  const [items, setItems] = useState(null);  // null = not loaded yet

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/admin/api/activity')
        .then(r => r.json())
        .then(list => { if (alive) setItems(Array.isArray(list) ? list : []); })
        .catch(() => { if (alive) setItems([]); });
    };
    load();
    const iv = setInterval(load, 15000);  // refresh every 15s
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return (
    <div className={`feed ${!open?'feed--collapsed':''}`}>
      <div className="feed__head" onClick={onToggle}>
        <span className="feed__title">
          <span className="feed__dot"/>
          Activity
          <span className="muted" style={{ fontWeight: 500 }}>· last 24h</span>
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-down'} size={14} style={{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 200ms ease', color: 'var(--color-text-3)' }}/>
      </div>
      <div className="feed__list">
        {items === null ? (
          <div className="feed__empty muted" style={{ padding: '16px', fontSize: 13, textAlign: 'center' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div className="feed__empty muted" style={{ padding: '16px', fontSize: 13, textAlign: 'center' }}>No activity in the last 24h</div>
        ) : items.map((it, i) => (
          <div key={i} className="feed__item">
            <span className={`feed__item__dot feed__item__dot--${it.kind}`}/>
            <div>
              <div className="feed__item__text">{it.text}</div>
              <div className="feed__item__sub">{it.sub}</div>
            </div>
            <span className="feed__item__time">{it.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Restaurant detail overlay ─── */
function RestaurantDetail({ restaurantId, onClose }) {
  const r = RESTAURANTS.find(x => x.id === restaurantId);
  const open = !!r;
  // Keep last r alive during exit anim
  const [cache, setCache] = useState(r);
  useEffect(() => { if (r) setCache(r); }, [r]);
  const data = r || cache;

  // Fetch real meals for this restaurant
  const [meals, setMeals] = useState([]);
  const [mealsLoading, setMealsLoading] = useState(false);
  useEffect(() => {
    if (!restaurantId) return;
    setMeals([]);
    setMealsLoading(true);
    fetch(`/api/restaurants/${restaurantId}/meals`)
      .then(res => res.json())
      .then(list => setMeals(Array.isArray(list) ? list.slice(0, 12) : []))
      .catch(() => setMeals([]))
      .finally(() => setMealsLoading(false));
  }, [restaurantId]);

  if (!data) return <div className="detail detail--narrow"></div>;

  const fallbackBg = `linear-gradient(135deg, oklch(0.85 0.06 ${(data.id.charCodeAt(1)*7)%360}), oklch(0.65 0.10 ${(data.id.charCodeAt(1)*11)%360}))`;

  return (
    <div className={`detail detail--narrow ${open?'detail--open':''}`}>
      <div className="detail__head">
        <span className="detail__title">
          <Icon name="utensils" size={18}/>
          Restaurant
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {data.woltSlug && (
            <a href={`https://wolt.com/en/deu/berlin/restaurant/${data.woltSlug}`} target="_blank" rel="noopener noreferrer" className="btn btn--secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontSize: 13 }}>
              <Icon name="external" size={13}/>Wolt
            </a>
          )}
          <button className="detail__close" onClick={onClose}><Icon name="x" size={18}/></button>
        </div>
      </div>
      <div className="detail__body">
        <div className="rdetail__hero">
          <div className="rdetail__hero__img" style={{ background: data.photo ? 'var(--color-surface-3)' : fallbackBg }}>
            {data.photo && <img src={data.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-md)', display: 'block' }} loading="lazy"/>}
          </div>
          <div>
            <div className="rdetail__hero__name">{data.name}</div>
            <div className="rdetail__hero__sub">{data.address}</div>
            <div className="rdetail__hero__meta">
              {data.open != null && (
                <span style={{ color: data.open ? 'var(--color-rating-green, #34a853)' : 'var(--color-text-2)', fontWeight: 500 }}>
                  {data.open ? 'Open now' : 'Closed'}
                </span>
              )}
              {data.priceLevel && (
                <><span className="meta-dot">·</span>
                <span>{Array.from({length:4},(_,i) => <span key={i} style={{opacity: i < data.priceLevel ? 1 : 0.2}}>€</span>)}</span></>
              )}
              {data.rating != null && (
                <><span className="meta-dot">·</span>
                <span style={{ display:'inline-flex', alignItems:'center', gap: 3 }}>
                  <span style={{ color:'#e8502c' }}>★</span>
                  <span className="num">{data.rating}</span>
                  <span className="num" style={{ opacity: 0.5 }}>({Number(data.reviews).toLocaleString('de-DE')})</span>
                </span></>
              )}
            </div>
          </div>
        </div>

        <div>
          <h3 className="h-section">Data sources</h3>
          <div className="kvgrid">
            <div className="kv"><span className="kv__l">Working hours</span><span className="kv__v">{data.hours}</span></div>
            <div className="kv"><span className="kv__l">Address</span><span className="kv__v">{data.address}</span></div>
            <div className="kv"><span className="kv__l">Price range</span><span className="kv__v">{data.priceLevel ? Array.from({length:4},(_,i)=><span key={i} style={{opacity: i < data.priceLevel ? 1 : 0.2}}>€</span>) : data.price}</span></div>
            <div className="kv"><span className="kv__l">Rating</span><span className="kv__v">{data.rating} ({data.reviews} reviews)</span></div>
            {data.lat && <div className="kv"><span className="kv__l">Coordinates</span><span className="kv__v mono">{data.lat.toFixed(4)}, {data.lng.toFixed(4)}</span></div>}
            <div className="kv"><span className="kv__l">Wolt slug</span><span className="kv__v mono">{data.woltSlug || '—'}</span></div>
            <div className="kv"><span className="kv__l">Last refresh</span><span className="kv__v">{data.updated || '—'}</span></div>
          </div>
        </div>

        <div>
          <h3 className="h-section">
            <span>Meals · {data.meals}</span>
          </h3>
          {mealsLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[1,2,3,4].map(i => (
                <div key={i} className="meal" style={{ opacity: 0.5 }}>
                  <div className="meal__img" style={{ background: 'var(--color-surface-3)' }}/>
                  <div>
                    <div style={{ height: 12, borderRadius: 4, background: 'var(--color-surface-3)', marginBottom: 6, width: '80%' }}/>
                    <div style={{ height: 10, borderRadius: 4, background: 'var(--color-surface-3)', width: '60%' }}/>
                  </div>
                </div>
              ))}
            </div>
          ) : meals.length > 0 ? (
            <div className="mealgrid">
              {meals.map((m, i) => (
                <div key={m.id || i} className="meal">
                  <div className="meal__img" style={{ background: 'var(--color-surface-3)' }}>
                    {m.photo && <img src={`/api/image-proxy?url=${encodeURIComponent(m.photo)}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-md)', display: 'block' }} loading="lazy"/>}
                  </div>
                  <div>
                    <div className="meal__name">{m.name}</div>
                    <div className="meal__macros">
                      {m.calories && <span className="macro macro--cal">{m.calories} kcal</span>}
                      {m.protein  && <span className="macro macro--p">P {m.protein}g</span>}
                      {m.fat      && <span className="macro macro--f">F {m.fat}g</span>}
                      {m.carbs    && <span className="macro macro--c">C {m.carbs}g</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13, padding: '12px 0' }}>No meal data available.</div>
          )}
        </div>

      </div>
    </div>
  );
}

// Google Places API pricing (per request, legacy Places API)
// Details cost is additive: Basic always + Contact if any contact field + Atmosphere if any atmosphere field
// Base fields always include rating (Atmosphere tier) + formatted_address (Basic tier)
const GPLACE_FIELD_TIER = {
  'Phone number':            'contact',    // formatted_phone_number
  'Website':                 'contact',    // website
  'Opening hours (dine-in)': 'contact',    // opening_hours
  'Google photo → R2':       'basic',      // photos (Basic tier)
};
const GPLACE_COST = { FIND_PLACE: 0.017, BASE: 0.017, CONTACT: 0.003, ATMOSPHERE: 0.005 };

function calcDetailCost(fields) {
  // Base always requests rating (Atmosphere tier) + formatted_address (Basic tier)
  let cost = GPLACE_COST.BASE + GPLACE_COST.ATMOSPHERE;
  const tiers = new Set(fields.map(f => GPLACE_FIELD_TIER[f]).filter(Boolean));
  if (tiers.has('contact')) cost += GPLACE_COST.CONTACT;
  return cost;
}

/* ─── Script detail overlay ─── */
function ScriptDetail({ scriptId, district, onClose, showToast }) {
  const s = SCRIPTS.find(x => x.id === scriptId);
  const open = !!s;
  const [cache, setCache] = useState(s);
  useEffect(() => { if (s) setCache(s); }, [s]);
  const data = s || cache;

  // Real job state from server polling
  const [job, setJob] = useState(null);
  const pollRef = useRef(null);

  const fetchJob = useCallback(() => {
    if (!data?.id) return;
    fetch('/admin/api/scripts/status')
      .then(r => r.json())
      .then(d => setJob(d.jobs?.[data.id] || null))
      .catch(() => {});
  }, [data?.id]);

  useEffect(() => {
    if (!open) return;
    fetchJob();
  }, [open, fetchJob]);

  // Poll every 2s while running
  useEffect(() => {
    if (job?.running) {
      pollRef.current = setInterval(fetchJob, 2000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [job?.running, fetchJob]);

  const isRunning = !!job?.running;
  const progress = job?.total > 0 ? Math.round(job.done / job.total * 100) : 0;

  // Per-script interactive checklist state
  const [checked, setChecked] = useState({});
  const items = data?.includes || [];
  const itemsChecked = checked[data?.id] || items.map(() => true);
  const toggleItem = (i) => {
    if (!data) return;
    setChecked(prev => {
      const arr = prev[data.id] ? [...prev[data.id]] : items.map(() => true);
      arr[i] = !arr[i];
      return { ...prev, [data.id]: arr };
    });
  };
  const enabledCount = itemsChecked.filter(Boolean).length;

  // Limit field (wolt only — persisted to server)
  const [limitInput, setLimitInput] = useState('');

  // Sync wolt limitInput from job.configLimit when script opens or configLimit changes
  useEffect(() => {
    if (data?.id === 'wolt') {
      setLimitInput(job?.configLimit != null ? String(job.configLimit) : '');
    } else {
      setLimitInput('');
    }
  }, [data?.id, job?.configLimit]);

  const saveLimitConfig = () => {
    if (data?.id !== 'wolt') return;
    const limitVal = limitInput.trim() ? parseInt(limitInput, 10) : null;
    fetch('/admin/api/scripts/wolt/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: limitVal }),
    })
      .then(r => r.json())
      .then(res => { if (res.configLimit !== undefined) setJob(prev => prev ? { ...prev, configLimit: res.configLimit } : prev); })
      .catch(() => {});
  };

  const runIt = () => {
    if (!data || isRunning) return;
    // Send enabled field names so server can build a targeted API request
    const enabledFields = items.filter((_, i) => itemsChecked[i]);
    const isWoltRun = data.id === 'wolt';
    const limitVal = isWoltRun && limitInput.trim() ? parseInt(limitInput, 10) : null;
    fetch(`/admin/api/scripts/${data.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        districtId: district?.id || null,
        fields: enabledFields,
        ...(limitVal ? { limit: limitVal } : {}),
      }),
    })
      .then(r => r.json())
      .then(res => {
        if (res.job) setJob(res.job);
        showToast({ text: res.message || `${data.name} started for ${district?.name || 'Berlin'}` });
        fetchJob();
      })
      .catch(() => showToast({ text: `Failed to start ${data.name}` }));
  };

  const stopIt = () => {
    if (!data || !isRunning) return;
    fetch(`/admin/api/scripts/${data.id}/stop`, { method: 'POST' })
      .then(r => r.json())
      .then(res => { if (res.job) setJob(res.job); })
      .catch(() => {});
  };

  if (!data) return <div className="detail detail--narrow"></div>;

  const lastRun = job?.finishedAt
    ? msToRelative(Date.now() - new Date(job.finishedAt).getTime()) + ' ago'
    : job?.startedAt && !job?.finishedAt
      ? 'running now'
      : data.lastRun;

  // Cost calculations (Google Place Enricher)
  const isGplace  = data.id === 'gplace';
  const isWolt    = data.id === 'wolt';
  const isMacros  = data.id === 'macros';
  const enabledFieldNames = items.filter((_, i) => itemsChecked[i]);
  const detailCostPer = isGplace ? calcDetailCost(enabledFieldNames) : 0;
  // Per 100 enrichments: FindPlace + Details (both called per restaurant)
  const estPer100 = isGplace ? `~$${(100 * (GPLACE_COST.FIND_PLACE + detailCostPer)).toFixed(2)}` : null;
  const tierLabel = isGplace
    ? enabledFieldNames.some(f => GPLACE_FIELD_TIER[f] === 'contact') ? 'Contact tier'
      : 'Basic tier'
    : null;
  // Actual cost after gplace run
  const actualCost = isGplace && (job?.detailsCalls > 0 || job?.findPlaceCalls > 0)
    ? `~$${((job.findPlaceCalls || 0) * GPLACE_COST.FIND_PLACE + (job.detailsCalls || 0) * calcDetailCost(job.enabledFields || enabledFieldNames)).toFixed(2)}`
    : null;

  // Macros cost (Claude Haiku 4.5: $0.80/MTok input, $4.00/MTok output)
  const HAIKU_IN  = 0.0000008;  // $ per token
  const HAIKU_OUT = 0.000004;
  const macrosActualCost = isMacros && (job?.inputTokens > 0 || job?.outputTokens > 0)
    ? `$${((job.inputTokens * HAIKU_IN) + (job.outputTokens * HAIKU_OUT)).toFixed(3)}`
    : null;
  // ~$0.11 per 1000 meals (estimate: 9k input + 25k output tokens per 1000 meals)
  const macrosEstPer1k = `~$${(9000 * HAIKU_IN + 25000 * HAIKU_OUT).toFixed(2)}`;

  return (
    <div className={`detail detail--narrow ${open?'detail--open':''}`}>
      <div className="detail__head">
        <span className="detail__title">
          <Icon name={data.icon} size={18}/>
          Script
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="detail__close" onClick={onClose}><Icon name="x" size={18}/></button>
        </div>
      </div>
      <div className="detail__body">
        <div className="sdetail__hero">
          <div className="sdetail__icon"><Icon name={data.icon} size={26}/></div>
          <div>
            <div className="sdetail__name">{data.name}</div>
            <div className="sdetail__desc">{data.desc}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <Pill variant={isRunning ? 'warn' : job?.errors > 0 ? 'danger' : job?.done > 0 ? 'success' : 'default'} dot>
                {isRunning ? 'running' : job?.errors > 0 ? 'errors' : job?.done > 0 ? 'healthy' : 'idle'}
              </Pill>
              <Pill>scope: {district?.name || 'Berlin'}</Pill>
            </div>
          </div>
        </div>

        <div className="sdetail__bigrow">
          <div className="sdetail__cell">
            <span className="sdetail__cell__l">Last run</span>
            <span className="sdetail__cell__v">{lastRun}</span>
          </div>
          <div className="sdetail__cell">
            <span className="sdetail__cell__l">Processed</span>
            <span className="sdetail__cell__v num">{job ? `${job.done} / ${job.total}` : '—'}</span>
          </div>
          <div className="sdetail__cell">
            <span className="sdetail__cell__l">Added</span>
            <span className="sdetail__cell__v num">{job?.newItems ?? '—'}</span>
          </div>
          <div className="sdetail__cell">
            <span className="sdetail__cell__l">{actualCost ? 'Actual cost' : 'Errors'}</span>
            <span className="sdetail__cell__v num" style={!actualCost && job?.errors > 0 ? { color: 'var(--color-error, #e53)' } : {}}>
              {actualCost ?? (job?.errors ?? '—')}
            </span>
          </div>
        </div>

        {isRunning && (
          <div style={{ marginBottom: 16 }}>
            <div className="progress"><div className="progress__fill" style={{ width: `${progress}%` }}/></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4, color: 'var(--color-text-2)' }}>
              <span>Running… {job.done} / {job.total}</span>
              <span className="num">{progress}%</span>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div>
            <h3 className="h-section">
              <span>What it collects</span>
              <span className="muted" style={{ fontWeight: 500, fontSize: 'var(--fs-secondary)' }}>{enabledCount} / {items.length}</span>
            </h3>
            <div className="checklist">
              {items.map((it, i) => {
                const on = itemsChecked[i];
                return (
                  <label key={i} className={`checklist__item ${on ? '' : 'checklist__item--off'}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleItem(i)} className="checklist__input"/>
                    <span className={`check ${on ? '' : 'check--off'}`}>
                      {on && <Icon name="check" size={11}/>}
                    </span>
                    <span style={{ flex: 1 }}>{it}</span>
                  </label>
                );
              })}
            </div>
            {isGplace && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-2)' }}>
                  Est. per 100 enrichments
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-text-3)', fontStyle: 'italic' }}>({tierLabel})</span>
                </span>
                <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>{estPer100}</span>
              </div>
            )}
            {isMacros && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-2)' }}>
                  {macrosActualCost ? 'Actual cost (last run)' : 'Est. per 1,000 meals'}
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-text-3)', fontStyle: 'italic' }}>(Haiku)</span>
                </span>
                <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>
                  {macrosActualCost || macrosEstPer1k}
                </span>
              </div>
            )}
            {isWolt && (
              <div style={{ marginTop: 12 }}>
                <h3 className="h-section" style={{ marginBottom: 8 }}>
                  <span>Limit</span>
                  <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>optional · saved</span>
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number"
                    min="1"
                    placeholder="No limit"
                    value={limitInput}
                    onChange={e => setLimitInput(e.target.value)}
                    onBlur={saveLimitConfig}
                    disabled={isRunning}
                    style={{
                      width: 120, padding: '6px 10px', fontSize: 13,
                      border: '1px solid var(--color-surface-2)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-text)',
                      fontFamily: 'inherit',
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--color-text-2)' }}>
                    {limitInput ? `Stop after ${limitInput} new restaurants` : 'Run until all discovered'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky bottom action bar */}
      <div className="drawer">
        {isRunning ? (
          <Btn variant="secondary" size="lg" block icon="pause" onClick={stopIt}>
            Stop script
          </Btn>
        ) : (
          <Btn variant="primary" size="lg" block icon="refresh" onClick={runIt}>
            Run {data.name}
          </Btn>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
