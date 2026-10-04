/**
 * EONETXPLR V2.0
 * Mission-critical NASA EONET + multi-source intelligence platform
 * Inspired by OSIRIS aesthetics + Hamchron ISS tracking
 * Static site — ready for GitHub Pages
 */
(() => {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────────────────
  const CFG = {
    EONET: 'https://eonet.gsfc.nasa.gov/api/v3',
    USGS_DAY: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    GDACS: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP',
    ISS: 'https://api.wheretheiss.at/v1/satellites/25544',
    ASTROS: 'http://api.open-notify.org/astros.json',
    // Fallback via allorigins / corsproxy if needed for mixed content
    PROXY: 'https://api.allorigins.win/raw?url=',
    POLL_ISS_MS: 6000,
    MAX_RETRIES: 3,
    RETRY_BASE_MS: 1200,
  };

  // Category colors (EONET titles → hex)
  const CAT_COLORS = {
    'Wildfires': '#f97316',
    'Severe Storms': '#3b82f6',
    'Volcanoes': '#ef4444',
    'Floods': '#06b6d4',
    'Earthquakes': '#a855f7',
    'Drought': '#eab308',
    'Dust and Haze': '#94a3b8',
    'Snow': '#e2e8f0',
    'Temp. Extremes': '#f43f5e',
    'Sea and Lake Ice': '#22d3ee',
    'Landslides': '#78716c',
    'Manmade': '#64748b',
    'Water Color': '#0ea5e9',
  };

  // ── STATE ───────────────────────────────────────────────────────────────
  const state = {
    events: [],
    filtered: [],
    categories: new Map(),
    selectedId: null,
    status: 'open',
    days: 30,
    search: '',
    enabledCats: new Set(),
    layers: {
      eonet: true,
      usgs: true,
      gdacs: false,
      iss: true,
      issTrail: true,
    },
    usgs: { features: [] },
    gdacs: { features: [] },
    iss: { lat: null, lon: null, alt: null, vel: null, vis: null, footprint: null },
    crew: [],
    trail: [],
    map: null,
    layersGroup: {
      eonet: null,
      usgs: null,
      gdacs: null,
      iss: null,
      trail: null,
    },
    markers: new Map(),
    autoRefreshMs: 180000,
    autoTimer: null,
    alertsEnabled: false,
    lastEventIds: new Set(),
    bootDone: false,
  };

  // ── DOM ─────────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── UTIL ────────────────────────────────────────────────────────────────
  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toast-stack').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function fetchJson(url, opts = {}, retries = CFG.MAX_RETRIES) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, {
          ...opts,
          headers: { Accept: 'application/json', ...(opts.headers || {}) },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (i < retries) await sleep(CFG.RETRY_BASE_MS * (i + 1));
      }
    }
    throw lastErr;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function fmtZulu(d = new Date()) {
    return d.toISOString().slice(11, 19);
  }

  function setApiStatus(stateName, text) {
    const el = $('#api-status');
    el.dataset.state = stateName;
    $('#api-status-text').textContent = text;
  }

  function updateClock() {
    $('#clock-zulu').innerHTML = `${fmtZulu()}<span>Z</span>`;
  }

  // ── BOOT SEQUENCE ───────────────────────────────────────────────────────
  async function boot() {
    const steps = [
      { p: 12, msg: 'ESTABLISHING SECURE CONNECTION…' },
      { p: 28, msg: 'LOADING EONET CATALOG…' },
      { p: 45, msg: 'INITIALIZING MAP ENGINE…' },
      { p: 62, msg: 'ACQUIRING ISS TELEMETRY…' },
      { p: 78, msg: 'SYNCING HAZARD FEEDS…' },
      { p: 92, msg: 'CALIBRATING SENSORS…' },
      { p: 100, msg: 'SYSTEMS ONLINE' },
    ];
    for (const s of steps) {
      $('#boot-progress').style.width = s.p + '%';
      $('#boot-status').textContent = s.msg;
      await sleep(280 + Math.random() * 180);
    }
    await sleep(350);
    $('#boot-screen').classList.add('fade-out');
    $('#app').classList.remove('hidden');
    state.bootDone = true;
    initApp();
  }

  // ── MAP ─────────────────────────────────────────────────────────────────
  function initMap() {
    state.map = L.map('map', {
      center: [20, 10],
      zoom: 2,
      minZoom: 2,
      maxZoom: 12,
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
    });

    // Dark basemap (Carto)
    const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri, Maxar',
      maxZoom: 19,
    });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'OpenTopoMap',
      maxZoom: 17,
    });

    dark.addTo(state.map);
    state.basemaps = { dark, sat, topo };

    state.layersGroup.eonet = L.layerGroup().addTo(state.map);
    state.layersGroup.usgs = L.layerGroup().addTo(state.map);
    state.layersGroup.gdacs = L.layerGroup();
    state.layersGroup.iss = L.layerGroup().addTo(state.map);
    state.layersGroup.trail = L.layerGroup().addTo(state.map);

    // Basemap switcher
    $$('#basemap-switcher button').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#basemap-switcher button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        Object.values(state.basemaps).forEach((l) => state.map.removeLayer(l));
        state.basemaps[btn.dataset.base].addTo(state.map);
      });
    });

    $('#btn-fit').addEventListener('click', fitToEvents);
    $('#btn-home').addEventListener('click', () => state.map.setView([20, 10], 2));
  }

  function catColor(title) {
    return CAT_COLORS[title] || '#f59e0b';
  }

  function makeEonetIcon(color) {
    return L.divIcon({
      className: '',
      html: `<div class="eonet-marker" style="background:${color}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function makeIssIcon() {
    return L.divIcon({
      className: '',
      html: `<div class="iss-marker"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  // ── DATA LOADERS ────────────────────────────────────────────────────────
  async function loadCategories() {
    try {
      const data = await fetchJson(`${CFG.EONET}/categories`);
      state.categories.clear();
      (data.categories || data || []).forEach((c) => {
        state.categories.set(c.id, c);
        state.enabledCats.add(c.id);
      });
      renderCategoryList();
    } catch (e) {
      console.warn('Categories failed', e);
      toast('Could not load EONET categories', 'error');
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
      // Detect new events for alerts
      if (state.alertsEnabled && state.lastEventIds.size) {
        const newOnes = state.events.filter((e) => !state.lastEventIds.has(e.id));
        if (newOnes.length) {
          toast(`${newOnes.length} new event(s) detected`);
          playAlert();
        }
      }
      state.lastEventIds = new Set(state.events.map((e) => e.id));
      applyFilters();
      setApiStatus('ok', 'ONLINE');
      $('#stat-open').textContent = state.events.filter((e) => !e.closed).length;
    } catch (e) {
      console.error(e);
      setApiStatus('error', 'DEGRADED');
      toast('EONET feed unreachable — retrying…', 'error');
    }
  }

  async function loadUsgs() {
    if (!state.layers.usgs) return;
    try {
      const data = await fetchJson(CFG.USGS_DAY);
      state.usgs.features = data.features || [];
      renderUsgs();
      $('#count-usgs').textContent = state.usgs.features.length;
    } catch (e) {
      console.warn('USGS failed', e);
    }
  }

  async function loadGdacs() {
    if (!state.layers.gdacs) return;
    try {
      // GDACS can be CORS-hostile; try direct then proxy
      let data;
      try {
        data = await fetchJson(CFG.GDACS, {}, 1);
      } catch {
        data = await fetchJson(CFG.PROXY + encodeURIComponent(CFG.GDACS));
      }
      // Normalize loosely
      const feats = Array.isArray(data) ? data : (data.features || data.events || []);
      state.gdacs.features = feats.slice(0, 80);
      renderGdacs();
      $('#count-gdacs').textContent = state.gdacs.features.length;
    } catch (e) {
      console.warn('GDACS failed', e);
      toast('GDACS layer unavailable (CORS)', 'error');
    }
  }

  async function loadIss() {
    if (!state.layers.iss && !state.layers.issTrail) return;
    try {
      const data = await fetchJson(CFG.ISS);
      const lat = parseFloat(data.latitude);
      const lon = parseFloat(data.longitude);
      state.iss = {
        lat,
        lon,
        alt: data.altitude != null ? Number(data.altitude).toFixed(1) : '—',
        vel: data.velocity != null ? Math.round(data.velocity) : '—',
        vis: data.visibility || '—',
        footprint: data.footprint != null ? Math.round(data.footprint) : '—',
      };
      // Trail
      if (state.layers.issTrail) {
        state.trail.push([lat, lon]);
        if (state.trail.length > 90) state.trail.shift();
      }
      renderIss();
      updateIssHud();
    } catch (e) {
      console.warn('ISS failed', e);
      $('#iss-status').textContent = 'NO SIGNAL';
      $('#iss-status').style.color = 'var(--red)';
    }
  }

  async function loadCrew() {
    try {
      // Open Notify is HTTP-only — use proxy for HTTPS pages
      let data;
      try {
        data = await fetchJson(CFG.ASTROS, {}, 0);
      } catch {
        data = await fetchJson(CFG.PROXY + encodeURIComponent(CFG.ASTROS));
      }
      state.crew = data.people || [];
      renderCrew();
      $('#iss-crew').textContent = `Crew: ${data.number || state.crew.length} in space`;
    } catch (e) {
      console.warn('Crew list failed', e);
      $('#iss-crew').textContent = 'Crew: —';
    }
  }

  // ── FILTERS & RENDER ────────────────────────────────────────────────────
  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    state.filtered = state.events.filter((ev) => {
      if (state.status === 'open' && ev.closed) return false;
      if (state.status === 'closed' && !ev.closed) return false;
      if (state.enabledCats.size && !ev.categories.some((c) => state.enabledCats.has(c.id))) return false;
      if (q && !(ev.title || '').toLowerCase().includes(q)) return false;
      return true;
    });
    renderEventList();
    renderEonetLayer();
    updateStats();
    updateChips();
    updateLegend();
  }

  function updateStats() {
    $('#stat-shown').textContent = state.filtered.length;
    $('#count-eonet').textContent = state.filtered.length;
    const layerCount = Object.values(state.layers).filter(Boolean).length;
    $('#stat-layers').textContent = layerCount;
    const entities =
      (state.layers.eonet ? state.filtered.length : 0) +
      (state.layers.usgs ? state.usgs.features.length : 0) +
      (state.layers.gdacs ? state.gdacs.features.length : 0) +
      (state.layers.iss ? 1 : 0);
    $('#stat-entities').textContent = entities;
  }

  function updateChips() {
    $('#chip-status').textContent = state.status.toUpperCase();
    $('#chip-days').textContent = state.days + 'd';
    $('#chip-count').textContent = state.filtered.length + ' events';
  }

  function updateLegend() {
    const rows = [];
    if (state.layers.eonet) {
      const used = new Set();
      state.filtered.forEach((ev) => {
        (ev.categories || []).forEach((c) => {
          if (!used.has(c.title)) {
            used.add(c.title);
            rows.push({ label: c.title, color: catColor(c.title) });
          }
        });
      });
    }
    if (state.layers.usgs) rows.push({ label: 'USGS Quake ≥2.5', color: '#f97316' });
    if (state.layers.gdacs) rows.push({ label: 'GDACS Hazard', color: '#ef4444' });
    if (state.layers.iss) rows.push({ label: 'ISS', color: '#06b6d4' });
    $('#legend-rows').innerHTML = rows
      .slice(0, 12)
      .map((r) => `<div class="legend-row"><span class="legend-swatch" style="background:${r.color}"></span>${r.label}</div>`)
      .join('');
  }

  function renderCategoryList() {
    const list = $('#category-list');
    list.innerHTML = '';
    [...state.categories.values()]
      .sort((a, b) => a.title.localeCompare(b.title))
      .forEach((c) => {
        const lab = document.createElement('label');
        lab.innerHTML = `<input type="checkbox" data-cat="${c.id}" ${state.enabledCats.has(c.id) ? 'checked' : ''}/> ${c.title}`;
        list.appendChild(lab);
      });
  }

  function renderEventList() {
    const list = $('#event-list');
    if (!state.filtered.length) {
      list.innerHTML = `<div class="empty-state">No events match current filters.</div>`;
      return;
    }
    list.innerHTML = state.filtered
      .map((ev) => {
        const cat = (ev.categories && ev.categories[0]) || { title: '—' };
        const date = (ev.geometry && ev.geometry[0] && ev.geometry[0].date) || '';
        const active = ev.id === state.selectedId ? 'active' : '';
        return `<div class="event-card ${active}" data-id="${ev.id}">
          <div class="etitle">${escapeHtml(ev.title)}</div>
          <div class="emeta">
            <span class="cat-pill">${escapeHtml(cat.title)}</span>
            <span>${date ? date.slice(0, 10) : ''}</span>
            ${ev.closed ? '<span>CLOSED</span>' : ''}
          </div>
        </div>`;
      })
      .join('');
    list.querySelectorAll('.event-card').forEach((card) => {
      card.addEventListener('click', () => selectEvent(card.dataset.id));
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function selectEvent(id) {
    state.selectedId = id;
    renderEventList();
    const ev = state.events.find((e) => e.id === id);
    if (!ev) return;
    showDetail(ev);
    // Focus map
    const geom = ev.geometry && ev.geometry[ev.geometry.length - 1];
    if (geom && geom.coordinates) {
      let lat, lon;
      if (geom.type === 'Point') {
        [lon, lat] = geom.coordinates;
      } else if (geom.type === 'Polygon' && geom.coordinates[0]) {
        // centroid-ish
        const ring = geom.coordinates[0];
        lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
        lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      }
      if (lat != null) {
        state.map.flyTo([lat, lon], Math.max(state.map.getZoom(), 5), { duration: 0.8 });
        const marker = state.markers.get(id);
        if (marker) marker.openPopup();
      }
    }
    // Switch to detail tab
    switchTab('detail');
  }

  function showDetail(ev) {
    $('#detail-empty').classList.add('hidden');
    const box = $('#detail-content');
    box.classList.remove('hidden');
    const cats = (ev.categories || []).map((c) => `<span class="pill">${escapeHtml(c.title)}</span>`).join('');
    const sources = (ev.sources || [])
      .map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.id)}</a></li>`)
      .join('');
    const geoms = (ev.geometry || [])
      .map((g) => `<li>${g.date ? g.date.slice(0, 16) : '—'} · ${g.type}</li>`)
      .join('');
    box.innerHTML = `
      <h3>${escapeHtml(ev.title)}</h3>
      <div class="meta-row">${cats}
        ${ev.closed ? '<span class="pill">CLOSED ' + (ev.closed || '').slice(0, 10) + '</span>' : '<span class="pill">OPEN</span>'}
      </div>
      ${ev.description ? `<p style="margin-bottom:12px;color:var(--text-mid)">${escapeHtml(ev.description)}</p>` : ''}
      <div class="section">
        <h4>Sources</h4>
        <ul class="source-list">${sources || '<li>—</li>'}</ul>
      </div>
      <div class="section">
        <h4>Geometry timeline</h4>
        <ul class="source-list">${geoms || '<li>—</li>'}</ul>
      </div>
      <div class="section">
        <h4>API</h4>
        <a href="${ev.link || CFG.EONET + '/events/' + ev.id}" target="_blank" rel="noopener">Open in EONET →</a>
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
      // Draw track if multiple points
      const pts = [];
      geoms.forEach((g) => {
        if (g.type === 'Point' && g.coordinates) {
          const [lon, lat] = g.coordinates;
          pts.push([lat, lon]);
        }
      });
      if (pts.length > 1) {
        L.polyline(pts, { color, weight: 2, opacity: 0.55, dashArray: '4 4' }).addTo(state.layersGroup.eonet);
      }
      // Latest position marker
      const last = geoms[geoms.length - 1];
      if (last.type === 'Point' && last.coordinates) {
        const [lon, lat] = last.coordinates;
        const marker = L.marker([lat, lon], { icon: makeEonetIcon(color) })
          .bindPopup(
            `<div class="popup-title">${escapeHtml(ev.title)}</div>
             <div class="popup-meta">${escapeHtml((ev.categories[0] || {}).title || '')} · ${last.date ? last.date.slice(0, 10) : ''}</div>`
          )
          .on('click', () => selectEvent(ev.id));
        marker.addTo(state.layersGroup.eonet);
        state.markers.set(ev.id, marker);
      } else if (last.type === 'Polygon' && last.coordinates && last.coordinates[0]) {
        const latlngs = last.coordinates[0].map((c) => [c[1], c[0]]);
        L.polygon(latlngs, { color, weight: 1.5, fillOpacity: 0.15 }).addTo(state.layersGroup.eonet);
      }
    });
  }

  function renderUsgs() {
    state.layersGroup.usgs.clearLayers();
    if (!state.layers.usgs) return;
    state.usgs.features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const mag = f.properties.mag;
      const r = Math.max(4, Math.min(14, mag * 3));
      L.circleMarker([lat, lon], {
        radius: r,
        color: '#f97316',
        fillColor: '#f97316',
        fillOpacity: 0.45,
        weight: 1,
      })
        .bindPopup(
          `<div class="popup-title">M${mag} — ${escapeHtml(f.properties.place || '')}</div>
           <div class="popup-meta">${new Date(f.properties.time).toISOString().slice(0, 16)}Z</div>`
        )
        .addTo(state.layersGroup.usgs);
    });
  }

  function renderGdacs() {
    state.layersGroup.gdacs.clearLayers();
    if (!state.layers.gdacs) return;
    state.gdacs.features.forEach((f) => {
      // Flexible parsing
      let lat, lon, title = 'GDACS event';
      if (f.geometry && f.geometry.coordinates) {
        [lon, lat] = f.geometry.coordinates;
      } else if (f.lat != null) {
        lat = f.lat;
        lon = f.lon || f.longitude;
      }
      if (lat == null) return;
      title = f.name || f.title || f.eventname || (f.properties && f.properties.name) || title;
      L.circleMarker([lat, lon], {
        radius: 7,
        color: '#ef4444',
        fillColor: '#ef4444',
        fillOpacity: 0.5,
        weight: 1,
      })
        .bindPopup(`<div class="popup-title">${escapeHtml(String(title))}</div>`)
        .addTo(state.layersGroup.gdacs);
    });
  }

  function renderIss() {
    state.layersGroup.iss.clearLayers();
    state.layersGroup.trail.clearLayers();
    if (!state.iss.lat) return;
    if (state.layers.iss) {
      L.marker([state.iss.lat, state.iss.lon], { icon: makeIssIcon(), zIndexOffset: 1000 })
        .bindPopup(
          `<div class="popup-title">International Space Station</div>
           <div class="popup-meta">${state.iss.lat.toFixed(2)}°, ${state.iss.lon.toFixed(2)}° · ${state.iss.alt} km</div>`
        )
        .addTo(state.layersGroup.iss);
    }
    if (state.layers.issTrail && state.trail.length > 1) {
      L.polyline(state.trail, {
        color: '#06b6d4',
        weight: 2,
        opacity: 0.65,
        dashArray: '6 4',
      }).addTo(state.layersGroup.trail);
    }
  }

  function updateIssHud() {
    const i = state.iss;
    if (i.lat == null) return;
    $('#iss-lat').textContent = i.lat.toFixed(2) + '°';
    $('#iss-lon').textContent = i.lon.toFixed(2) + '°';
    $('#iss-alt').textContent = i.alt;
    $('#iss-vel').textContent = i.vel;
    $('#iss-lat2').textContent = i.lat.toFixed(4) + '°';
    $('#iss-lon2').textContent = i.lon.toFixed(4) + '°';
    $('#iss-alt2').textContent = i.alt + ' km';
    $('#iss-vel2').textContent = i.vel + ' km/h';
    $('#iss-vis').textContent = i.vis;
    $('#iss-foot').textContent = i.footprint + ' km';
    $('#iss-status').textContent = 'TRACKING';
    $('#iss-status').style.color = 'var(--green)';
  }

  function renderCrew() {
    const ul = $('#crew-list');
    if (!state.crew.length) {
      ul.innerHTML = '<li>No data</li>';
      return;
    }
    ul.innerHTML = state.crew
      .map((p) => `<li><span>${escapeHtml(p.name)}</span><span class="craft">${escapeHtml(p.craft || '')}</span></li>`)
      .join('');
  }

  function fitToEvents() {
    const pts = [];
    state.filtered.forEach((ev) => {
      const g = ev.geometry && ev.geometry[ev.geometry.length - 1];
      if (g && g.type === 'Point' && g.coordinates) {
        pts.push([g.coordinates[1], g.coordinates[0]]);
      }
    });
    if (state.layers.iss && state.iss.lat != null) pts.push([state.iss.lat, state.iss.lon]);
    if (pts.length) {
      state.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 6 });
    }
  }

  // ── UI BINDINGS ─────────────────────────────────────────────────────────
  function switchTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
  }

  function playAlert() {
    if (!state.alertsEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 180);
    } catch (_) {}
  }

  function bindUi() {
    // Status seg
    $$('#status-seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#status-seg button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.status = btn.dataset.status;
      });
    });

    $('#days-select').addEventListener('change', (e) => {
      state.days = Number(e.target.value);
    });

    $('#search-input').addEventListener('input', (e) => {
      state.search = e.target.value;
      applyFilters();
    });

    $('#cat-toggle-all').addEventListener('click', () => {
      const allOn = state.enabledCats.size === state.categories.size;
      state.enabledCats.clear();
      if (!allOn) state.categories.forEach((_, id) => state.enabledCats.add(id));
      renderCategoryList();
    });

    $('#category-list').addEventListener('change', (e) => {
      if (e.target.matches('input[data-cat]')) {
        const id = Number(e.target.dataset.cat) || e.target.dataset.cat;
        if (e.target.checked) state.enabledCats.add(id);
        else state.enabledCats.delete(id);
      }
    });

    // Layers
    const layerMap = {
      'layer-eonet': 'eonet',
      'layer-usgs': 'usgs',
      'layer-gdacs': 'gdacs',
      'layer-iss': 'iss',
      'layer-iss-trail': 'issTrail',
    };
    Object.entries(layerMap).forEach(([domId, key]) => {
      const el = $('#' + domId);
      if (!el) return;
      el.addEventListener('change', () => {
        state.layers[key] = el.checked;
        if (key === 'eonet') renderEonetLayer();
        if (key === 'usgs') {
          if (el.checked && !state.usgs.features.length) loadUsgs();
          else renderUsgs();
        }
        if (key === 'gdacs') {
          if (el.checked) {
            state.layersGroup.gdacs.addTo(state.map);
            if (!state.gdacs.features.length) loadGdacs();
            else renderGdacs();
          } else {
            state.map.removeLayer(state.layersGroup.gdacs);
          }
        }
        if (key === 'iss' || key === 'issTrail') renderIss();
        updateStats();
        updateLegend();
      });
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
      loadUsgs();
      if (state.layers.gdacs) loadGdacs();
      loadIss();
      toast('Soft refresh complete');
    });

    $('#btn-alerts').addEventListener('click', () => {
      state.alertsEnabled = !state.alertsEnabled;
      $('#btn-alerts').setAttribute('aria-pressed', state.alertsEnabled);
      toast(state.alertsEnabled ? 'Audio alerts ON' : 'Audio alerts OFF');
    });

    $('#btn-fullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });

    $$('.tab').forEach((t) => {
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
        loadUsgs();
        if (state.layers.gdacs) loadGdacs();
      }, state.autoRefreshMs);
    }
  }

  // ── INIT ────────────────────────────────────────────────────────────────
  async function initApp() {
    initMap();
    bindUi();
    updateClock();
    setInterval(updateClock, 1000);

    await loadCategories();
    await Promise.all([loadEvents(), loadUsgs(), loadIss(), loadCrew()]);
    scheduleAutoRefresh();

    // Continuous ISS track
    setInterval(loadIss, CFG.POLL_ISS_MS);
    // Refresh crew occasionally
    setInterval(loadCrew, 5 * 60 * 1000);

    toast('EONETXPLR online — all systems nominal', 'success');
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
