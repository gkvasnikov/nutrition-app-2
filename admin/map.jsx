/* Leaflet map: tiles + Berlin district polygons + restaurant pins */

// Berlin name normalisation: GeoJSON property "Gemeinde_name" → our district id
const GEO_NAME_MAP = {
  'Mitte': 'mitte',
  'Friedrichshain-Kreuzberg': 'fhain',
  'Pankow': 'pankow',
  'Charlottenburg-Wilmersdorf': 'cwilm',
  'Spandau': 'spandau',
  'Steglitz-Zehlendorf': 'steglitz',
  'Tempelhof-Schöneberg': 'tempel',
  'Neukölln': 'neuk',
  'Treptow-Köpenick': 'treptow',
  'Marzahn-Hellersdorf': 'marzahn',
  'Lichtenberg': 'lich',
  'Reinickendorf': 'rein',
};

// Per-district accent colors (from Figma design)
const DISTRICT_COLORS = {
  mitte:    '#e63022',
  fhain:    '#a0181a',
  pankow:   '#3355aa',
  cwilm:    '#e8458c',
  spandau:  '#9933cc',
  steglitz: '#4a7c3f',
  tempel:   '#a0a020',
  neuk:     '#e07820',
  treptow:  '#4488cc',
  marzahn:  '#6688aa',
  lich:     '#cc3333',
  rein:     '#20a0a0',
};

const TILE_PRESETS = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap · © CARTO',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap · © CARTO',
  },
  clean: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap · © CARTO',
  },
};

// Zoom threshold: below → dot markers, above → photo circle markers
const PIN_PHOTO_ZOOM = 13;

function makeDotIcon() {
  const L = window.L;
  return L.divIcon({
    html: '<div style="width:7px;height:7px;border-radius:50%;background:#212121;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.35)"></div>',
    iconSize: [7, 7],
    iconAnchor: [3.5, 3.5],
    className: '',
  });
}

function makePhotoIcon(photoUrl, mealCount) {
  const L = window.L;
  const src = photoUrl || '';
  const badge = mealCount > 1
    ? `<div style="position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;background:#212121;color:#fff;font-size:10px;font-weight:700;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px;font-family:Inter,sans-serif;line-height:1;border:1.5px solid #fff;pointer-events:none">${mealCount > 99 ? '99+' : mealCount}</div>`
    : '';
  const img = src
    ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.parentNode.style.background='#ccc'"/>`
    : '';
  const html = `<div style="position:relative;width:32px;height:32px">
    <div style="width:32px;height:32px;border-radius:50%;overflow:hidden;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);background:#d0d0d0">${img}</div>
    ${badge}
  </div>`;
  return L.divIcon({
    html,
    iconSize: [42, 42],
    iconAnchor: [16, 16],
    className: '',
  });
}

function useBerlinMap({ districts, restaurants, selectedId, onSelect, onHover, onRestaurantPin, accent = 'green', theme = 'light' }) {
  const mapRef = React.useRef(null);
  const tileRef = React.useRef(null);
  const layersRef = React.useRef({}); // id -> polygon layer
  const pinLayerRef = React.useRef(null); // Leaflet LayerGroup for restaurant markers
  const markersRef = React.useRef({}); // restaurantId -> marker
  const photoModeRef = React.useRef(false);

  // Initialise map once
  React.useEffect(() => {
    if (mapRef.current) return;
    const L = window.L;
    const map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: false,
      minZoom: 9,
      maxZoom: 16,
    }).setView([52.520, 13.405], 10);
    mapRef.current = map;
    tileRef.current = L.tileLayer(TILE_PRESETS[theme].url, {
      attribution: TILE_PRESETS[theme].attribution,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Layer group for restaurant pins (sits above tiles, below district polygons label-wise)
    pinLayerRef.current = L.layerGroup().addTo(map);

    // load geojson
    fetch('https://cdn.jsdelivr.net/gh/funkeinteraktiv/Berlin-Geodaten@master/berlin_bezirke.geojson')
      .then(r => r.json())
      .then(gj => {
        gj.features.forEach(f => {
          const name = f.properties.Gemeinde_name || f.properties.name;
          const id = GEO_NAME_MAP[name];
          if (!id) return;
          const layer = L.geoJSON(f, {
            style: () => ({ ...computeStyle(id, districts, selectedId, accent), className: 'district' }),
          }).addTo(map);
          layer.eachLayer(l => {
            l.on('mouseover', () => {
              onHover?.(id);
              l.setStyle({ weight: 2, fillOpacity: 0.55 });
            });
            l.on('mouseout', () => {
              onHover?.(null);
              l.setStyle(computeStyle(id, districts, selectedId, accent));
            });
            l.on('click', () => onSelect?.(id));
          });
          layersRef.current[id] = layer;
        });
        // fit bounds to all districts
        const all = L.featureGroup(Object.values(layersRef.current));
        map.fitBounds(all.getBounds().pad(0.04), { animate: false });
      })
      .catch(err => console.warn('Berlin GeoJSON failed:', err));

    // Zoom listener — switch between dot and photo markers
    map.on('zoomend', () => {
      const z = map.getZoom();
      const wantPhoto = z >= PIN_PHOTO_ZOOM;
      if (wantPhoto !== photoModeRef.current) {
        photoModeRef.current = wantPhoto;
        Object.entries(markersRef.current).forEach(([, m]) => {
          m.setIcon(wantPhoto ? m._adminPhotoIcon : m._adminDotIcon);
        });
      }
    });
  }, []);

  // Restyle district polygons when state changes
  React.useEffect(() => {
    Object.entries(layersRef.current).forEach(([id, layer]) => {
      layer.setStyle(computeStyle(id, districts, selectedId, accent));
    });
  }, [districts, selectedId, accent]);

  // Swap tile theme
  React.useEffect(() => {
    if (!mapRef.current || !tileRef.current) return;
    tileRef.current.setUrl(TILE_PRESETS[theme].url);
  }, [theme]);

  // Build / rebuild restaurant markers when restaurants list changes
  React.useEffect(() => {
    const map = mapRef.current;
    const group = pinLayerRef.current;
    if (!map || !group || !restaurants?.length) return;

    // Clear old markers
    group.clearLayers();
    markersRef.current = {};

    const L = window.L;
    const zoom = map.getZoom();
    const photoMode = zoom >= PIN_PHOTO_ZOOM;
    photoModeRef.current = photoMode;

    restaurants.forEach(r => {
      if (!r.lat || !r.lng) return;

      const dotIcon   = makeDotIcon();
      const photoIcon = makePhotoIcon(r.photo, r.meals);

      const marker = L.marker([r.lat, r.lng], {
        icon: photoMode ? photoIcon : dotIcon,
        title: r.name,
        zIndexOffset: 10,
      });

      // Store both icons on the marker for fast toggling
      marker._adminDotIcon   = dotIcon;
      marker._adminPhotoIcon = photoIcon;

      marker.bindTooltip(
        `<strong>${r.name}</strong><br><span style="color:#888;font-size:11px">${r.meals} meals</span>`,
        { direction: 'top', offset: [0, -6], className: 'admin-pin-tooltip' }
      );

      marker.on('click', (e) => {
        e.originalEvent.stopPropagation();
        onRestaurantPin?.(r.id);
      });

      marker.addTo(group);
      markersRef.current[r.id] = marker;
    });
  }, [restaurants]);

  // Zoom-to handler exposed
  const zoomTo = React.useCallback((id) => {
    const map = mapRef.current; if (!map) return;
    if (!id) {
      const all = window.L.featureGroup(Object.values(layersRef.current));
      if (all.getLayers().length) map.flyToBounds(all.getBounds().pad(0.04), { duration: 0.8 });
      return;
    }
    const layer = layersRef.current[id]; if (!layer) return;
    map.flyToBounds(layer.getBounds().pad(0.15), { duration: 0.8 });
  }, []);

  // Highlight / pan to a specific restaurant pin
  const focusPin = React.useCallback((restaurantId) => {
    const map = mapRef.current; if (!map) return;
    const marker = markersRef.current[restaurantId]; if (!marker) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, []);

  return { mapRef, zoomTo, focusPin };
}

function computeStyle(id, districts, selectedId, accent) {
  const d = districts.find(x => x.id === id);
  const status = d?.status || 'none';

  // Per-district color for covered/active; fallback to accent for unknown ids
  const districtColor = DISTRICT_COLORS[id] || '#52eb00';
  const isSelected = selectedId === id;

  const base = {
    color: districtColor,
    weight: 1,
    opacity: 0.7,
    fillColor: districtColor,
    fillOpacity: 0,
  };

  if (status === 'covered') {
    return { ...base, weight: isSelected ? 3 : 1.5, fillOpacity: isSelected ? 0.55 : 0.40, opacity: 0.95 };
  }
  if (status === 'active') {
    // dashed gold border while scraping is in progress
    return { ...base, color: districtColor, fillColor: districtColor, weight: isSelected ? 3 : 1.5, fillOpacity: 0.32, opacity: 0.9, dashArray: '4,4' };
  }
  // none — covered districts not yet scraped
  return { ...base, color: '#9A9A9A', fillColor: '#000000', fillOpacity: isSelected ? 0.08 : 0.04, opacity: 0.4, dashArray: '2,3' };
}

Object.assign(window, { useBerlinMap });
