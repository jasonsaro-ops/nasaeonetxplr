/**
 * EONETXPLR — NASA-focused Natural Event Tracker
 * EONET · FIRMS wildfires · USGS · GIBS · APOD/DONKI/NeoWs
 */
(() => {
  'use strict';

  const NASA_KEY = 'dUEnTbPROirnCVoOQEudw3qy7R4xTMCPTkKTiHId';

  const CFG = {
    EONET: 'https://eonet.gsfc.nasa.gov/api/v3',
    USGS_FEEDS: {
      '2.5_day': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
      '4.5_day': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
      'significant_week': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson',
      '2.5_week': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
    },
    FIRMS_VIIRS: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv',
    FIRMS_MODIS: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv',
    GIBS_TMPL: (layer, date) =>
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    APOD: `https://api.nasa.gov/planetary/apod?api_key=${NASA_KEY}`,
    DONKI: `https://api.nasa.gov/DONKI/notifications?type=all&api_key=${NASA_KEY}`,
    NEO: (start, end) => `https://api.nasa.gov/neo/rest/v1/feed?start_date=${start}&end_date=${end}&api_key=${NASA_KEY}`,
    UA: 'EONETXPLR/3.0 (nasa-eonet-focused)',
    MAX_RETRIES: 3,
    RETRY_BASE_MS: 1200,
  };

  const CAT_COLORS = {
    'Wildfires': '#f97316', 'Severe Storms': '#3b82f6', 'Volcanoes': '#ef4444',
    'Floods': '#06b6d4', 'Earthquakes': '#a855f7', 'Drought': '#eab308',
    'Dust and Haze': '#94a3b8', 'Snow': '#e2e8f0', 'Temp. Extremes': '#f43f5e',
    'Sea and Lake Ice': '#22d3ee', 'Landslides': '#78716c', 'Manmade': '#64748b',
    'Water Color': '#0ea5e9',
  };

  const state = {
    events: [], filtered: [], categories: new Map(), selectedId: null,
    status: 'open', days: 30, search: '', enabledCats: new Set(),
    layers: { eonet: true, firms: true, usgs: true, gibs: false },
    usgs: { features: [], feed: '2.5_day' },
    firms: { points: [] },
    map: null, basemaps: {}, gibsLayer: null,
    layersGroup: { eonet: null, firms: null, usgs: null },
    markers: new Map(),
    autoRefreshMs: 120000, autoTimer: null,
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toast-stack').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  async function fetchJson(url, retries = CFG.MAX_RETRIES) {
    let last;
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': CFG.UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        last = e;
        if (i < retries) await sleep(CFG.RETRY_BASE_MS * (i + 1));
      }
    }
    throw last;
  }

  async function fetchText(url) {
    const res = await fetch(url, { headers: { 'User-Agent': CFG.UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function fmtZulu(d = new Date()) { return d.toISOString().slice(11, 19); }
  function setApiStatus(s, t) { $('#api-status').dataset.state = s; $('#api-status-text').textContent = t; }
  function updateClock() { $('#clock-zulu').innerHTML = `${fmtZulu()}<span>Z</span>`; }
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function catColor(t) { return CAT_COLORS[t] || '#f59e0b'; }

  async function boot() {
    const steps = [
      { p: 20, msg: 'CONNECTING TO NASA EONET…' },
      { p: 40, msg: 'LOADING CATEGORIES…' },
      { p: 55, msg: 'ACQUIRING FIRMS HOTSPOTS…' },
      { p: 70, msg: 'SYNCING USGS…' },
      { p: 85, msg: 'NASA API KEY ACTIVE…' },
      { p: 100, msg: 'SYSTEMS ONLINE' },
    ];
    for (const s of steps) {
      $('#boot-progress').style.width = s.p + '%';
      $('#boot-status').textContent = s.msg;
      await sleep(220 + Math.random() * 140);
    }
    await sleep(250);
    $('#boot-screen').classList.add('fade-out');
    $('#app').classList.remove('hidden');
    initApp();
  }

  function initMap() {
    state.map = L.map('map', {
      center: [20, 0], zoom: 2, minZoom: 2, maxZoom: 18, worldCopyJump: true,
    });

    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri, Maxar', maxZoom: 19,
    });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'OpenTopoMap', maxZoom: 17,
    });

    state.basemaps = { dark: osm, sat, topo };
    osm.addTo(state.map);
    const pane = state.map.getPane('tilePane');
    if (pane) pane.style.filter = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)';

    state.layersGroup.eonet = L.layerGroup().addTo(state.map);
    state.layersGroup.firms = L.layerGroup().addTo(state.map);
    state.layersGroup.usgs = L.layerGroup().addTo(state.map);

    $$('#basemap-switcher button').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#basemap-switcher button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        Object.values(state.basemaps).forEach((l) => { if (state.map.hasLayer(l)) state.map.removeLayer(l); });
        const key = btn.dataset.base;
        (state.basemaps[key] || osm).addTo(state.map);
        const p = state.map.getPane('tilePane');
        if (p) p.style.filter = key === 'dark' ? 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)' : '';
      });
    });

    $('#btn-fit').addEventListener('click', fitToEvents);
    $('#btn-home').addEventListener('click', () => state.map.setView([20, 0], 2));
  }

  function makeIcon(color, size = 12) {
    return L.divIcon({
      className: '',
      html: `<div class="eonet-marker" style="background:${color};width:${size}px;height:${size}px"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  // ── DATA ──
  async function loadCategories() {
    try {
      const data = await fetchJson(`${CFG.EONET}/categories`);
      state.categories.clear();
      (data.categories || []).forEach((c) => {
        state.categories.set(c.id, c);
        state.enabledCats.add(c.id);
      });
      renderCategoryList();
    } catch (e) {
      console.warn(e);
      toast('EONET categories failed', 'error');
    }
  }

  async function loadEvents() {
    setApiStatus('connecting', 'SYNCING');
    const params = new URLSearchParams({
      status: state.status === 'all' ? 'all' : state.status,
      days: String(state.days),
      limit: '500',
    });
    try {
      const data = await fetchJson(`${CFG.EONET}/events?${params}`);
      state.events = data.events || [];
      applyFilters();
      setApiStatus('ok', 'ONLINE');
      $('#stat-open').textContent = state.events.filter((e) => !e.closed).length;
    } catch (e) {
      setApiStatus('error', 'DEGRADED');
      toast('EONET unreachable', 'error');
    }
  }

  async function loadFirms() {
    if (!state.layers.firms) return;
    try {
      // Prefer VIIRS 24h public CSV (no key)
      let csv;
      try {
        csv = await fetchText(CFG.FIRMS_VIIRS);
      } catch {
        csv = await fetchText(CFG.FIRMS_MODIS);
      }
      const lines = csv.trim().split('\n');
      if (lines.length < 2) throw new Error('Empty FIRMS');
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const latI = headers.indexOf('latitude');
      const lonI = headers.indexOf('longitude');
      const brightI = headers.findIndex((h) => h.includes('bright'));
      const confI = headers.indexOf('confidence');
      const frpI = headers.indexOf('frp');
      const acqI = headers.indexOf('acq_date');
      const points = [];
      // Cap points for performance
      const step = Math.max(1, Math.floor((lines.length - 1) / 4000));
      for (let i = 1; i < lines.length; i += step) {
        const cols = lines[i].split(',');
        const lat = parseFloat(cols[latI]);
        const lon = parseFloat(cols[lonI]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          points.push({
            lat, lon,
            bright: brightI >= 0 ? cols[brightI] : '',
            conf: confI >= 0 ? cols[confI] : '',
            frp: frpI >= 0 ? cols[frpI] : '',
            date: acqI >= 0 ? cols[acqI] : '',
          });
        }
      }
      state.firms.points = points;
      renderFirms();
      $('#count-firms').textContent = points.length;
      $('#stat-fires').textContent = points.length;
    } catch (e) {
      console.warn('FIRMS', e);
      toast('FIRMS wildfire feed unavailable', 'error');
    }
  }

  async function loadUsgs() {
    if (!state.layers.usgs) return;
    try {
      const url = CFG.USGS_FEEDS[state.usgs.feed] || CFG.USGS_FEEDS['2.5_day'];
      const data = await fetchJson(url);
      state.usgs.features = data.features || [];
      renderUsgs();
      $('#count-usgs').textContent = state.usgs.features.length;
      $('#stat-quakes').textContent = state.usgs.features.length;
    } catch (e) {
      console.warn('USGS', e);
    }
  }

  function setGibs(on) {
    if (state.gibsLayer) {
      state.map.removeLayer(state.gibsLayer);
      state.gibsLayer = null;
    }
    if (!on) return;
    const layer = $('#gibs-layer').value;
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const dateStr = date.toISOString().slice(0, 10);
    // GIBS WebMercator template
    const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${dateStr}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
    state.gibsLayer = L.tileLayer(url, {
      attribution: 'NASA GIBS',
      maxZoom: 9,
      opacity: 0.75,
      bounds: [[-85, -180], [85, 180]],
    }).addTo(state.map);
  }

  async function loadApod() {
    try {
      const d = await fetchJson(CFG.APOD);
      const media = d.media_type === 'image'
        ? `<img src="${escapeHtml(d.url)}" alt="APOD" style="width:100%;border-radius:4px;margin-bottom:8px" />`
        : (d.thumbnail_url ? `<img src="${escapeHtml(d.thumbnail_url)}" style="width:100%;border-radius:4px;margin-bottom:8px" />` : '');
      $('#apod-card').innerHTML = `
        ${media}
        <strong style="color:var(--text-hi)">${escapeHtml(d.title || 'APOD')}</strong>
        <p style="font-size:11px;color:var(--text-mid);margin-top:6px;line-height:1.4">${escapeHtml((d.explanation || '').slice(0, 280))}…</p>
        <a href="${escapeHtml(d.hdurl || d.url || '#')}" target="_blank" rel="noopener" style="font-size:11px;color:var(--cyan)">Open →</a>
      `;
    } catch (e) {
      $('#apod-card').innerHTML = '<p class="hint">APOD unavailable</p>';
    }
  }

  async function loadDonki() {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 7 * 864e5);
      const url = `https://api.nasa.gov/DONKI/notifications?startDate=${start.toISOString().slice(0, 10)}&endDate=${end.toISOString().slice(0, 10)}&type=all&api_key=${NASA_KEY}`;
      const data = await fetchJson(url);
      const list = Array.isArray(data) ? data.slice(0, 12) : [];
      $('#donki-list').innerHTML = list.length
        ? list.map((n) => `<li><span>${escapeHtml(n.messageType || n.messageID || 'Notice')}</span><span class="craft">${escapeHtml((n.messageIssueTime || '').slice(0, 10))}</span></li>`).join('')
        : '<li>No recent notifications</li>';
    } catch (e) {
      $('#donki-list').innerHTML = '<li>DONKI unavailable</li>';
    }
  }

  async function loadNeo() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const data = await fetchJson(CFG.NEO(today, today));
      const neos = data.near_earth_objects?.[today] || [];
      $('#neo-list').innerHTML = neos.length
        ? neos.slice(0, 10).map((n) => {
            const dist = n.close_approach_data?.[0]?.miss_distance?.kilometers;
            const haz = n.is_potentially_hazardous_asteroid ? ' · HAZ' : '';
            return `<li><span>${escapeHtml(n.name)}${haz}</span><span class="craft">${dist ? Math.round(Number(dist)).toLocaleString() + ' km' : ''}</span></li>`;
          }).join('')
        : '<li>No NEOs today</li>';
    } catch (e) {
      $('#neo-list').innerHTML = '<li>NeoWs unavailable</li>';
    }
  }

  // ── RENDER ──
  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    state.filtered = state.events.filter((ev) => {
      if (state.status === 'open' && ev.closed) return false;
      if (state.status === 'closed' && !ev.closed) return false;
      if (state.enabledCats.size && !(ev.categories || []).some((c) => state.enabledCats.has(c.id))) return false;
      if (q && !(ev.title || '').toLowerCase().includes(q)) return false;
      return true;
    });
    renderEventList();
    renderEonetLayer();
    updateStats();
    updateLegend();
  }

  function updateStats() {
    $('#stat-shown').textContent = state.filtered.length;
    $('#count-eonet').textContent = state.filtered.length;
    $('#chip-status').textContent = state.status.toUpperCase();
    $('#chip-days').textContent = state.days + 'd';
    $('#chip-count').textContent = state.filtered.length + ' events';
  }

  function updateLegend() {
    const rows = [];
    if (state.layers.eonet) {
      const used = new Set();
      state.filtered.forEach((ev) => (ev.categories || []).forEach((c) => {
        if (!used.has(c.title)) { used.add(c.title); rows.push({ label: c.title, color: catColor(c.title) }); }
      }));
    }
    if (state.layers.firms) rows.push({ label: 'FIRMS hotspot', color: '#ef4444' });
    if (state.layers.usgs) rows.push({ label: 'USGS quake', color: '#f97316' });
    if (state.layers.gibs) rows.push({ label: 'GIBS imagery', color: '#22c55e' });
    $('#legend-rows').innerHTML = rows.slice(0, 14).map((r) =>
      `<div class="legend-row"><span class="legend-swatch" style="background:${r.color}"></span>${r.label}</div>`).join('');
  }

  function renderCategoryList() {
    const list = $('#category-list');
    list.innerHTML = '';
    [...state.categories.values()].sort((a, b) => a.title.localeCompare(b.title)).forEach((c) => {
      const lab = document.createElement('label');
      lab.innerHTML = `<input type="checkbox" data-cat="${c.id}" ${state.enabledCats.has(c.id) ? 'checked' : ''}/> ${c.title}`;
      list.appendChild(lab);
    });
  }

  function renderEventList() {
    const list = $('#event-list');
    if (!state.filtered.length) {
      list.innerHTML = '<div class="empty-state">No events match.</div>';
      return;
    }
    list.innerHTML = state.filtered.map((ev) => {
      const cat = (ev.categories && ev.categories[0]) || { title: '—' };
      const date = (ev.geometry && ev.geometry[0] && ev.geometry[0].date) || '';
      return `<div class="event-card ${ev.id === state.selectedId ? 'active' : ''}" data-id="${ev.id}">
        <div class="etitle">${escapeHtml(ev.title)}</div>
        <div class="emeta">
          <span class="cat-pill">${escapeHtml(cat.title)}</span>
          <span>${date ? date.slice(0, 10) : ''}</span>
          ${ev.closed ? '<span>CLOSED</span>' : ''}
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.event-card').forEach((card) => {
      card.addEventListener('click', () => selectEvent(card.dataset.id));
    });
  }

  async function selectEvent(id) {
    state.selectedId = id;
    renderEventList();
    const ev = state.events.find((e) => e.id === id);
    if (!ev) return;

    // Focus map
    const geom = ev.geometry && ev.geometry[ev.geometry.length - 1];
    if (geom && geom.coordinates) {
      let lat, lon;
      if (geom.type === 'Point') [lon, lat] = geom.coordinates;
      else if (geom.type === 'Polygon' && geom.coordinates[0]) {
        const ring = geom.coordinates[0];
        lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
        lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      }
      if (lat != null) {
        state.map.flyTo([lat, lon], Math.max(state.map.getZoom(), 5), { duration: 0.7 });
        const m = state.markers.get(id);
        if (m) m.openPopup();
      }
    }

    await showDetail(ev);
    switchTab('detail');
  }

  async function showDetail(ev) {
    $('#detail-empty').classList.add('hidden');
    const box = $('#detail-content');
    box.classList.remove('hidden');
    box.innerHTML = '<p class="hint">Loading full metadata…</p>';

    // Fetch single-event endpoint for complete data + related layers
    let full = ev;
    try {
      full = await fetchJson(`${CFG.EONET}/events/${ev.id}`);
    } catch (_) {}

    const cats = (full.categories || []).map((c) => `<span class="pill">${escapeHtml(c.title)}</span>`).join('');
    const sources = (full.sources || []).map((s) =>
      `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.id)}</a></li>`).join('');
    const geoms = (full.geometry || []).map((g, i) => {
      let coords = '';
      if (g.type === 'Point' && g.coordinates) coords = `${g.coordinates[1].toFixed(3)}, ${g.coordinates[0].toFixed(3)}`;
      else if (g.type === 'Polygon') coords = 'Polygon';
      return `<li><strong>#${i + 1}</strong> ${g.date ? g.date.slice(0, 16) : '—'}Z · ${g.type}${g.magnitudeValue != null ? ` · mag ${g.magnitudeValue} ${g.magnitudeUnit || ''}` : ''} · ${coords}</li>`;
    }).join('');

    // Related EONET layers for category
    let layersHtml = '<p class="hint">No related layers</p>';
    try {
      const catId = full.categories?.[0]?.id;
      if (catId) {
        const layerData = await fetchJson(`${CFG.EONET}/layers/${catId}`);
        const layers = layerData.categories?.[0]?.layers || [];
        if (layers.length) {
          layersHtml = '<ul class="source-list">' + layers.slice(0, 12).map((l) =>
            `<li><strong>${escapeHtml(l.name)}</strong><br><span style="color:var(--text-dim);font-size:10px">${escapeHtml(l.serviceTypeId || '')} · ${escapeHtml((l.serviceUrl || '').slice(0, 60))}…</span></li>`
          ).join('') + '</ul>';
        }
      }
    } catch (_) {}

    const mag = full.geometry?.find((g) => g.magnitudeValue != null);

    box.innerHTML = `
      <h3>${escapeHtml(full.title)}</h3>
      <div class="meta-row">${cats}
        ${full.closed ? `<span class="pill">CLOSED ${escapeHtml(String(full.closed).slice(0, 10))}</span>` : '<span class="pill">OPEN</span>'}
        ${mag ? `<span class="pill">Mag ${mag.magnitudeValue} ${mag.magnitudeUnit || ''}</span>` : ''}
      </div>
      ${full.description ? `<p style="margin-bottom:12px;color:var(--text-mid);line-height:1.45">${escapeHtml(full.description)}</p>` : ''}

      <div class="section">
        <h4>Sources</h4>
        <ul class="source-list">${sources || '<li>—</li>'}</ul>
      </div>

      <div class="section">
        <h4>Geometry timeline (${(full.geometry || []).length})</h4>
        <ul class="source-list" style="font-size:11px">${geoms || '<li>—</li>'}</ul>
      </div>

      <div class="section">
        <h4>Related NASA imagery layers (EONET)</h4>
        ${layersHtml}
      </div>

      <div class="section">
        <h4>API</h4>
        <ul class="source-list">
          <li><a href="${escapeHtml(full.link || CFG.EONET + '/events/' + full.id)}" target="_blank" rel="noopener">EONET event JSON →</a></li>
          <li><a href="https://worldview.earthdata.nasa.gov/" target="_blank" rel="noopener">Open NASA Worldview →</a></li>
        </ul>
      </div>
    `;
  }

  function renderEonetLayer() {
    state.layersGroup.eonet.clearLayers();
    state.markers.clear();
    if (!state.layers.eonet) return;

    state.filtered.forEach((ev) => {
      const geoms = ev.geometry || [];
      if (!geoms.length) return;
      const color = catColor((ev.categories && ev.categories[0] && ev.categories[0].title) || '');
      const pts = [];
      geoms.forEach((g) => {
        if (g.type === 'Point' && g.coordinates) pts.push([g.coordinates[1], g.coordinates[0]]);
      });
      if (pts.length > 1) {
        L.polyline(pts, { color, weight: 2, opacity: 0.55, dashArray: '4 4' }).addTo(state.layersGroup.eonet);
      }
      const last = geoms[geoms.length - 1];
      if (last.type === 'Point' && last.coordinates) {
        const [lon, lat] = last.coordinates;
        const marker = L.marker([lat, lon], { icon: makeIcon(color) })
          .bindPopup(`<div class="popup-title">${escapeHtml(ev.title)}</div>
            <div class="popup-meta">${escapeHtml((ev.categories?.[0] || {}).title || '')} · ${last.date ? last.date.slice(0, 10) : ''}</div>
            <div style="font-size:10px;color:var(--cyan);margin-top:4px">Click for full metadata</div>`)
          .on('click', () => selectEvent(ev.id));
        marker.addTo(state.layersGroup.eonet);
        state.markers.set(ev.id, marker);
      } else if (last.type === 'Polygon' && last.coordinates?.[0]) {
        const latlngs = last.coordinates[0].map((c) => [c[1], c[0]]);
        L.polygon(latlngs, { color, weight: 1.5, fillOpacity: 0.15 })
          .on('click', () => selectEvent(ev.id))
          .addTo(state.layersGroup.eonet);
      }
    });
  }

  function renderFirms() {
    state.layersGroup.firms.clearLayers();
    if (!state.layers.firms) return;
    state.firms.points.forEach((p) => {
      L.circleMarker([p.lat, p.lon], {
        radius: 3,
        color: '#ef4444',
        fillColor: '#f97316',
        fillOpacity: 0.7,
        weight: 0.5,
      }).bindPopup(
        `<div class="popup-title">FIRMS Hotspot</div>
         <div class="popup-meta">${p.date || ''} · conf ${p.conf || '—'} · FRP ${p.frp || '—'} · bright ${p.bright || '—'}</div>`
      ).addTo(state.layersGroup.firms);
    });
  }

  function renderUsgs() {
    state.layersGroup.usgs.clearLayers();
    if (!state.layers.usgs) return;
    state.usgs.features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const mag = f.properties.mag;
      L.circleMarker([lat, lon], {
        radius: Math.max(4, Math.min(16, mag * 3)),
        color: '#f97316',
        fillColor: '#f97316',
        fillOpacity: 0.45,
        weight: 1,
      }).bindPopup(
        `<div class="popup-title">M${mag} — ${escapeHtml(f.properties.place || '')}</div>
         <div class="popup-meta">${new Date(f.properties.time).toISOString().slice(0, 16)}Z</div>`
      ).addTo(state.layersGroup.usgs);
    });
  }

  function fitToEvents() {
    const pts = [];
    state.filtered.forEach((ev) => {
      const g = ev.geometry?.[ev.geometry.length - 1];
      if (g?.type === 'Point' && g.coordinates) pts.push([g.coordinates[1], g.coordinates[0]]);
    });
    if (pts.length) state.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 6 });
  }

  function switchTab(name) {
    $$('#right-panel .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('#right-panel .tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
  }

  function bindUi() {
    $$('#status-seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#status-seg button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.status = btn.dataset.status;
      });
    });
    $('#days-select').addEventListener('change', (e) => { state.days = Number(e.target.value); });
    $('#search-input').addEventListener('input', (e) => { state.search = e.target.value; applyFilters(); });
    $('#cat-toggle-all').addEventListener('click', () => {
      const allOn = state.enabledCats.size === state.categories.size;
      state.enabledCats.clear();
      if (!allOn) state.categories.forEach((_, id) => state.enabledCats.add(id));
      renderCategoryList();
    });
    $('#category-list').addEventListener('change', (e) => {
      if (e.target.matches('input[data-cat]')) {
        const id = e.target.dataset.cat;
        if (e.target.checked) state.enabledCats.add(Number(id) || id);
        else state.enabledCats.delete(Number(id) || id);
      }
    });

    $('#layer-eonet').addEventListener('change', (e) => {
      state.layers.eonet = e.target.checked;
      renderEonetLayer();
      updateLegend();
    });
    $('#layer-firms').addEventListener('change', (e) => {
      state.layers.firms = e.target.checked;
      if (e.target.checked && !state.firms.points.length) loadFirms();
      else renderFirms();
      updateLegend();
    });
    $('#layer-usgs').addEventListener('change', (e) => {
      state.layers.usgs = e.target.checked;
      if (e.target.checked && !state.usgs.features.length) loadUsgs();
      else renderUsgs();
      updateLegend();
    });
    $('#layer-gibs').addEventListener('change', (e) => {
      state.layers.gibs = e.target.checked;
      setGibs(e.target.checked);
      updateLegend();
    });
    $('#gibs-layer').addEventListener('change', () => {
      if (state.layers.gibs) setGibs(true);
    });
    $('#usgs-feed').addEventListener('change', (e) => {
      state.usgs.feed = e.target.value;
      if (state.layers.usgs) loadUsgs();
    });

    $('#btn-apply').addEventListener('click', async () => {
      await loadEvents();
      toast('Filters applied', 'success');
    });
    $('#btn-reset').addEventListener('click', () => {
      state.status = 'open';
      state.days = 30;
      state.search = '';
      state.enabledCats = new Set(state.categories.keys());
      $('#search-input').value = '';
      $('#days-select').value = '30';
      $$('#status-seg button').forEach((b) => b.classList.toggle('active', b.dataset.status === 'open'));
      renderCategoryList();
      loadEvents();
    });
    $('#btn-refresh').addEventListener('click', () => {
      loadEvents();
      loadFirms();
      loadUsgs();
      if (state.layers.gibs) setGibs(true);
      toast('Refreshed');
    });
    $('#btn-fullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });

    $$('#right-panel .tab').forEach((t) => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    $('#autorefresh-select').addEventListener('change', (e) => {
      state.autoRefreshMs = Number(e.target.value) * 1000;
      scheduleAutoRefresh();
    });
  }

  function scheduleAutoRefresh() {
    if (state.autoTimer) clearInterval(state.autoTimer);
    if (state.autoRefreshMs > 0) {
      state.autoTimer = setInterval(() => {
        loadEvents();
        loadFirms();
        loadUsgs();
      }, state.autoRefreshMs);
    }
  }

  async function initApp() {
    initMap();
    bindUi();
    updateClock();
    setInterval(updateClock, 1000);

    await loadCategories();
    await Promise.all([loadEvents(), loadFirms(), loadUsgs()]);
    loadApod();
    loadDonki();
    loadNeo();
    scheduleAutoRefresh();
    toast('EONETXPLR online — NASA APIs active', 'success');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
