/**
 * EONETXPLR V2.1
 * Free basemaps · NEXRAD · NWS alerts & WFOs · 3-tone alerts · ISS Cesium 3D
 * Static · GitHub Pages ready
 */
(() => {
  'use strict';

  const CFG = {
    EONET: 'https://eonet.gsfc.nasa.gov/api/v3',
    // USGS feeds that power https://earthquake.usgs.gov/earthquakes/map/
    USGS_FEEDS: {
      '2.5_day': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
      'all_day': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      '1.0_day': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/1.0_day.geojson',
      'significant_week': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson',
      '4.5_week': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
      '2.5_week': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
    },
    USGS_DEFAULT: '2.5_day',
    GDACS: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP',
    ISS: 'https://api.wheretheiss.at/v1/satellites/25544',
    ASTROS: 'http://api.open-notify.org/astros.json',
    NWS_ALERTS: 'https://api.weather.gov/alerts/active?status=actual&message_type=alert',
    NWS_OFFICE: (code) => `https://api.weather.gov/offices/${code}`,
    NWS_PRODUCTS: (code) => `https://api.weather.gov/products/types/AFD/locations/${code}`,
    NWS_PRODUCTS_ALL: (code) => `https://api.weather.gov/products?location=${code}&limit=20`,
    NEXRAD_WMS: 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi',
    NWS_POINTS: (lat, lon) => `https://api.weather.gov/points/${lat},${lon}`,
    PROXY: 'https://api.allorigins.win/raw?url=',
    UA: 'EONETXPLR/2.1 (github-pages; educational)',
    POLL_ISS_MS: 6000,
    MAX_RETRIES: 3,
    RETRY_BASE_MS: 1400,
  };

  const CAT_COLORS = {
    'Wildfires':'#f97316','Severe Storms':'#3b82f6','Volcanoes':'#ef4444',
    'Floods':'#06b6d4','Earthquakes':'#a855f7','Drought':'#eab308',
    'Dust and Haze':'#94a3b8','Snow':'#e2e8f0','Temp. Extremes':'#f43f5e',
    'Sea and Lake Ice':'#22d3ee','Landslides':'#78716c','Manmade':'#64748b',
    'Water Color':'#0ea5e9'
  };

  const state = {
    events: [], filtered: [], categories: new Map(), selectedId: null,
    status: 'open', days: 30, search: '', enabledCats: new Set(),
    layers: { eonet:true, nws:true, nexrad:false, usgs:true, gdacs:false, iss:true, issTrail:true },
    usgs: { features: [], feed: '2.5_day' }, gdacs: { features: [] },
    nwsAlerts: [], nwsFiltered: [], nwsSev: 'all', nwsSearch: '',
    iss: { lat:null, lon:null, alt:null, vel:null, vis:null, footprint:null },
    crew: [], trail: [],
    map: null, basemaps: {}, nexradLayer: null,
    layersGroup: { eonet:null, nws:null, usgs:null, gdacs:null, iss:null, trail:null },
    markers: new Map(),
    autoRefreshMs: 120000, autoTimer: null,
    alertsEnabled: true, lastEventIds: new Set(), lastAlertIds: new Set(),
    selectedWfo: null, cesiumViewer: null,
    gridpoint: null, gridpointLoading: false,
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function toast(msg, type='') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toast-stack').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function fetchJson(url, opts={}, retries=CFG.MAX_RETRIES) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        const headers = { Accept: 'application/json', 'User-Agent': CFG.UA, ...(opts.headers||{}) };
        const res = await fetch(url, { ...opts, headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (i < retries) await sleep(CFG.RETRY_BASE_MS * (i + 1));
      }
    }
    throw lastErr;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function fmtZulu(d=new Date()) { return d.toISOString().slice(11,19); }
  function setApiStatus(s, t) { $('#api-status').dataset.state = s; $('#api-status-text').textContent = t; }
  function updateClock() { $('#clock-zulu').innerHTML = `${fmtZulu()}<span>Z</span>`; }
  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function catColor(t) { return CAT_COLORS[t] || '#f59e0b'; }

  function severityColor(sev) {
    const s = (sev || '').toLowerCase();
    if (s === 'extreme') return '#ef4444';
    if (s === 'severe') return '#f97316';
    if (s === 'moderate') return '#eab308';
    if (s === 'minor') return '#22c55e';
    return '#94a3b8';
  }

  function severityBadge(sev) {
    const c = severityColor(sev);
    return `<span class="sev-badge" style="background:${c}22;color:${c};border:1px solid ${c}55">${escapeHtml(sev || 'Unknown')}</span>`;
  }



  // Three-tone EAS-style alert (853 Hz / 960 Hz pattern simplified)
  function playThreeTone() {
    if (!state.alertsEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const tones = [853, 960, 853];
      let t = ctx.currentTime;
      tones.forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.55);
        o.start(t); o.stop(t + 0.55);
        t += 0.6;
      });
      setTimeout(() => ctx.close(), 2500);
    } catch (_) {}
  }

  // ── BOOT ──
  async function boot() {
    const steps = [
      {p:15,msg:'ESTABLISHING SECURE CONNECTION…'},
      {p:30,msg:'LOADING EONET CATALOG…'},
      {p:45,msg:'INITIALIZING MAP ENGINE…'},
      {p:60,msg:'ACQUIRING NWS ALERTS…'},
      {p:75,msg:'SYNCING ISS TELEMETRY…'},
      {p:90,msg:'CALIBRATING SENSORS…'},
      {p:100,msg:'SYSTEMS ONLINE'},
    ];
    for (const s of steps) {
      $('#boot-progress').style.width = s.p + '%';
      $('#boot-status').textContent = s.msg;
      await sleep(260 + Math.random()*160);
    }
    await sleep(300);
    $('#boot-screen').classList.add('fade-out');
    $('#app').classList.remove('hidden');
    initApp();
  }

  // ── MAP (free no-key tiles) ──
  function initMap() {
    state.map = L.map('map', {
      center: [28, -40], zoom: 3, minZoom: 2, maxZoom: 18,
      zoomControl: true, worldCopyJump: true,
    });

    // Guaranteed free, no API key tiles
    // DARK = OSM tiles + CSS invert filter (no key, no watermark)
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
    // Apply dark filter to tile pane for DARK mode
    const tilePane = state.map.getPane('tilePane');
    if (tilePane) tilePane.style.filter = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)';

    state.layersGroup.eonet = L.layerGroup().addTo(state.map);
    state.layersGroup.nws = L.layerGroup().addTo(state.map);
    state.layersGroup.usgs = L.layerGroup().addTo(state.map);
    state.layersGroup.gdacs = L.layerGroup();
    state.layersGroup.iss = L.layerGroup().addTo(state.map);
    state.layersGroup.trail = L.layerGroup().addTo(state.map);

    $$('#basemap-switcher button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#basemap-switcher button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Object.values(state.basemaps).forEach(l => { if (state.map.hasLayer(l)) state.map.removeLayer(l); });
        const key = btn.dataset.base;
        const layer = state.basemaps[key] || state.basemaps.dark;
        layer.addTo(state.map);
        // Dark filter only for dark mode
        const pane = state.map.getPane('tilePane');
        if (pane) {
          if (key === 'dark') pane.style.filter = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)';
          else pane.style.filter = '';
        }
      });
    });

    $('#btn-fit').addEventListener('click', fitToEvents);
    $('#btn-home').addEventListener('click', () => state.map.setView([28, -40], 3));

    // Click map → load NWS gridpoint layers for that location
    state.map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      toast(`Sampling gridpoint ${lat.toFixed(3)}, ${lng.toFixed(3)}…`);
      loadGridpoint(lat, lng);
    });
  }

  function makeEonetIcon(color) {
    return L.divIcon({ className:'', html:`<div class="eonet-marker" style="background:${color}"></div>`, iconSize:[14,14], iconAnchor:[7,7] });
  }
  function makeIssIcon() {
    return L.divIcon({ className:'', html:`<div class="iss-marker"></div>`, iconSize:[18,18], iconAnchor:[9,9] });
  }

  // ── DATA LOADERS ──
  async function loadCategories() {
    try {
      const data = await fetchJson(`${CFG.EONET}/categories`);
      state.categories.clear();
      (data.categories || data || []).forEach(c => {
        state.categories.set(c.id, c);
        state.enabledCats.add(c.id);
      });
      renderCategoryList();
    } catch (e) { console.warn(e); toast('EONET categories failed', 'error'); }
  }

  async function loadEvents() {
    setApiStatus('connecting', 'SYNCING');
    const params = new URLSearchParams({ status: state.status === 'all' ? 'all' : state.status, days: String(state.days), limit: '500' });
    try {
      const data = await fetchJson(`${CFG.EONET}/events?${params}`);
      state.events = data.events || [];
      if (state.alertsEnabled && state.lastEventIds.size) {
        const neu = state.events.filter(e => !state.lastEventIds.has(e.id));
        if (neu.length) { toast(`${neu.length} new EONET event(s)`); playThreeTone(); }
      }
      state.lastEventIds = new Set(state.events.map(e => e.id));
      applyFilters();
      setApiStatus('ok', 'ONLINE');
      $('#stat-open').textContent = state.events.filter(e => !e.closed).length;
    } catch (e) {
      setApiStatus('error', 'DEGRADED');
      toast('EONET unreachable', 'error');
    }
  }

  async function loadNwsAlerts() {
    if (!state.layers.nws && !$('#panel-alerts').classList.contains('active')) return;
    try {
      const data = await fetchJson(CFG.NWS_ALERTS);
      const feats = data.features || [];
      // Detect new severe
      if (state.alertsEnabled && state.lastAlertIds.size) {
        const newSevere = feats.filter(f => {
          const id = f.id || f.properties?.id;
          const sev = f.properties?.severity;
          return id && !state.lastAlertIds.has(id) && (sev === 'Extreme' || sev === 'Severe');
        });
        if (newSevere.length) {
          toast(`${newSevere.length} new severe NWS alert(s)`);
          playThreeTone();
        }
      }
      state.lastAlertIds = new Set(feats.map(f => f.id || f.properties?.id).filter(Boolean));
      state.nwsAlerts = feats;
      applyNwsFilter();
      renderNwsLayer();
      $('#count-nws').textContent = feats.length;
      $('#stat-nws').textContent = feats.length;
    } catch (e) {
      console.warn('NWS alerts', e);
      toast('NWS alerts feed issue', 'error');
    }
  }

  function applyNwsFilter() {
    const q = state.nwsSearch.trim().toLowerCase();
    state.nwsFiltered = state.nwsAlerts.filter(f => {
      const p = f.properties || {};
      if (state.nwsSev !== 'all' && p.severity !== state.nwsSev) return false;
      if (q) {
        const hay = `${p.event||''} ${p.headline||''} ${p.areaDesc||''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    renderNwsAlertList();
  }

  function renderNwsAlertList() {
    const list = $('#nws-alert-list');
    if (!state.nwsFiltered.length) {
      list.innerHTML = '<div class="empty-state">No alerts match.</div>';
      return;
    }
    list.innerHTML = state.nwsFiltered.slice(0, 200).map(f => {
      const p = f.properties || {};
      const sev = p.severity || '';
      const color = severityColor(sev);
      return `<div class="event-card alert-list-card" data-alert="${escapeHtml(f.id || '')}" style="border-left:3px solid ${color}">
        <div class="etitle">${escapeHtml(p.event || p.headline || 'Alert')} ${severityBadge(sev)}</div>
        <div class="emeta"><span>${escapeHtml((p.areaDesc || '').slice(0,55))}</span></div>
      </div>`;
    }).join('');
    list.querySelectorAll('.alert-list-card').forEach(card => {
      card.addEventListener('click', () => {
        const f = state.nwsAlerts.find(x => (x.id || '') === card.dataset.alert);
        if (f) {
          openAlertFloat(f);
          if (f.geometry) {
            try {
              const layer = L.geoJSON(f);
              state.map.fitBounds(layer.getBounds(), { padding: [30,30], maxZoom: 8 });
            } catch(_) {}
          }
        }
      });
    });
  }

  function renderNwsLayer() {
    state.layersGroup.nws.clearLayers();
    if (!state.layers.nws) return;
    state.nwsAlerts.forEach(f => {
      if (!f.geometry) return;
      const sev = (f.properties || {}).severity || '';
      const color = severityColor(sev);
      L.geoJSON(f, {
        style: { color, weight: 1.5, fillOpacity: 0.2, fillColor: color },
        onEachFeature: (feat, layer) => {
          const p = feat.properties || {};
          layer.on('click', () => openAlertFloat(feat));
          layer.bindPopup(`<div class="popup-title">${escapeHtml(p.event||'')}</div>
            <div class="popup-meta">${escapeHtml(p.severity||'')} · ${escapeHtml((p.areaDesc||'').slice(0,80))}</div>
            <div style="margin-top:4px;font-size:10px;color:var(--cyan)">Click for full alert</div>`);
        }
      }).addTo(state.layersGroup.nws);
    });
  }

  function setNexrad(on) {
    if (state.nexradLayer) {
      state.map.removeLayer(state.nexradLayer);
      state.nexradLayer = null;
    }
    if (!on) return;
    const product = $('#nexrad-product').value || 'nexrad-n0q-900913';
    state.nexradLayer = L.tileLayer.wms(CFG.NEXRAD_WMS, {
      layers: product,
      format: 'image/png',
      transparent: true,
      attribution: 'NEXRAD © Iowa Env. Mesonet',
      opacity: 0.65,
    }).addTo(state.map);
  }

  async function loadUsgs() {
    if (!state.layers.usgs) return;
    try {
      const feedKey = state.usgs.feed || CFG.USGS_DEFAULT;
      const url = CFG.USGS_FEEDS[feedKey] || CFG.USGS_FEEDS[CFG.USGS_DEFAULT];
      const data = await fetchJson(url);
      state.usgs.features = data.features || [];
      renderUsgs();
      $('#count-usgs').textContent = state.usgs.features.length;
    } catch (e) { console.warn('USGS', e); }
  }

  async function loadGdacs() {
    if (!state.layers.gdacs) return;
    try {
      let data;
      try { data = await fetchJson(CFG.GDACS, {}, 1); }
      catch { data = await fetchJson(CFG.PROXY + encodeURIComponent(CFG.GDACS)); }
      const feats = Array.isArray(data) ? data : (data.features || data.events || []);
      state.gdacs.features = feats.slice(0, 80);
      renderGdacs();
      $('#count-gdacs').textContent = state.gdacs.features.length;
    } catch (e) { console.warn(e); }
  }

  async function loadIss() {
    try {
      const data = await fetchJson(CFG.ISS);
      const lat = parseFloat(data.latitude);
      const lon = parseFloat(data.longitude);
      state.iss = {
        lat, lon,
        alt: data.altitude != null ? Number(data.altitude).toFixed(1) : '—',
        vel: data.velocity != null ? Math.round(data.velocity) : '—',
        vis: data.visibility || '—',
        footprint: data.footprint != null ? Math.round(data.footprint) : '—',
      };
      if (state.layers.issTrail) {
        state.trail.push([lat, lon]);
        if (state.trail.length > 120) state.trail.shift();
      }
      renderIss();
      updateIssHud();
      if (state.cesiumViewer) updateCesiumIss();
    } catch (e) {
      $('#iss-status').textContent = 'NO SIGNAL';
      $('#iss-status').style.color = 'var(--red)';
    }
  }

  async function loadCrew() {
    try {
      let data;
      try { data = await fetchJson(CFG.ASTROS, {}, 0); }
      catch { data = await fetchJson(CFG.PROXY + encodeURIComponent(CFG.ASTROS)); }
      state.crew = data.people || [];
      renderCrew();
      $('#iss-crew').textContent = `Crew: ${data.number || state.crew.length} in space`;
    } catch (e) { $('#iss-crew').textContent = 'Crew: —'; }
  }

  // ── RENDER HELPERS ──
  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    state.filtered = state.events.filter(ev => {
      if (state.status === 'open' && ev.closed) return false;
      if (state.status === 'closed' && !ev.closed) return false;
      if (state.enabledCats.size && !ev.categories.some(c => state.enabledCats.has(c.id))) return false;
      if (q && !(ev.title||'').toLowerCase().includes(q)) return false;
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
    const layerCount = Object.values(state.layers).filter(Boolean).length + (state.nexradLayer ? 1 : 0);
    $('#stat-layers').textContent = layerCount;
    const entities = (state.layers.eonet?state.filtered.length:0) + (state.layers.usgs?state.usgs.features.length:0) +
      (state.layers.gdacs?state.gdacs.features.length:0) + (state.layers.iss?1:0) + (state.layers.nws?state.nwsAlerts.length:0);
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
      state.filtered.forEach(ev => (ev.categories||[]).forEach(c => {
        if (!used.has(c.title)) { used.add(c.title); rows.push({label:c.title, color:catColor(c.title)}); }
      }));
    }
    if (state.layers.nws) rows.push({label:'NWS Alert', color:'#eab308'});
    if (state.layers.usgs) rows.push({label:'USGS Earthquake', color:'#f97316'});
    if (state.layers.gdacs) rows.push({label:'GDACS', color:'#ef4444'});
    if (state.layers.iss) rows.push({label:'ISS', color:'#06b6d4'});
    if (state.nexradLayer) rows.push({label:'NEXRAD', color:'#22c55e'});
    $('#legend-rows').innerHTML = rows.slice(0,14).map(r =>
      `<div class="legend-row"><span class="legend-swatch" style="background:${r.color}"></span>${r.label}</div>`).join('');
  }

  function renderCategoryList() {
    const list = $('#category-list');
    list.innerHTML = '';
    [...state.categories.values()].sort((a,b)=>a.title.localeCompare(b.title)).forEach(c => {
      const lab = document.createElement('label');
      lab.innerHTML = `<input type="checkbox" data-cat="${c.id}" ${state.enabledCats.has(c.id)?'checked':''}/> ${c.title}`;
      list.appendChild(lab);
    });
  }

  function renderEventList() {
    const list = $('#event-list');
    if (!state.filtered.length) { list.innerHTML = '<div class="empty-state">No events match.</div>'; return; }
    list.innerHTML = state.filtered.map(ev => {
      const cat = (ev.categories && ev.categories[0]) || {title:'—'};
      const date = (ev.geometry && ev.geometry[0] && ev.geometry[0].date) || '';
      return `<div class="event-card ${ev.id===state.selectedId?'active':''}" data-id="${ev.id}">
        <div class="etitle">${escapeHtml(ev.title)}</div>
        <div class="emeta"><span class="cat-pill">${escapeHtml(cat.title)}</span><span>${date?date.slice(0,10):''}</span>${ev.closed?'<span>CLOSED</span>':''}</div>
      </div>`;
    }).join('');
    list.querySelectorAll('.event-card').forEach(card => card.addEventListener('click', () => selectEvent(card.dataset.id)));
  }

  function selectEvent(id) {
    state.selectedId = id;
    renderEventList();
    const ev = state.events.find(e => e.id === id);
    if (!ev) return;
    showDetail(ev);
    const geom = ev.geometry && ev.geometry[ev.geometry.length-1];
    if (geom && geom.coordinates) {
      let lat, lon;
      if (geom.type === 'Point') [lon, lat] = geom.coordinates;
      else if (geom.type === 'Polygon' && geom.coordinates[0]) {
        const ring = geom.coordinates[0];
        lon = ring.reduce((s,c)=>s+c[0],0)/ring.length;
        lat = ring.reduce((s,c)=>s+c[1],0)/ring.length;
      }
      if (lat != null) {
        state.map.flyTo([lat, lon], Math.max(state.map.getZoom(), 5), {duration:0.8});
        const m = state.markers.get(id);
        if (m) m.openPopup();
      }
    }
    switchTab('detail');
  }


  // ── NWS GRIDPOINT LAYERS (weather-gov gridpoints) ──
  function parseGridValues(layer) {
    if (!layer || !layer.values) return [];
    return layer.values.map(v => ({
      time: (v.validTime || '').split('/')[0],
      value: v.value,
      uom: layer.uom || '',
    })).filter(x => x.value != null);
  }

  function currentGridValue(layer) {
    const vals = parseGridValues(layer);
    if (!vals.length) return null;
    // Prefer the first (soonest) valid entry
    return vals[0];
  }

  function fmtTemp(c, uom) {
    if (c == null) return '—';
    // NWS grid temps are usually degC
    const f = (c * 9/5) + 32;
    return `${Math.round(f)}°F (${Math.round(c)}°C)`;
  }

  function fmtPct(v) {
    if (v == null) return '—';
    return Math.round(v) + '%';
  }

  function fmtWind(v, uom) {
    if (v == null) return '—';
    // often km/h or m/s — display raw + unit
    const unit = (uom || '').replace('wmoUnit:', '') || '';
    return `${Math.round(v)} ${unit}`;
  }

  async function loadGridpoint(lat, lon) {
    state.gridpointLoading = true;
    state.gridpoint = null;
    try {
      const pt = await fetchJson(CFG.NWS_POINTS(lat.toFixed(4), lon.toFixed(4)));
      const props = pt.properties || {};
      const gridUrl = props.forecastGridData;
      const forecastUrl = props.forecast;
      const hourlyUrl = props.forecastHourly;
      if (!gridUrl) throw new Error('No forecastGridData for this point');

      const grid = await fetchJson(gridUrl);
      const gprops = grid.properties || {};

      // Pull key layers from https://weather-gov.github.io/api/gridpoints
      const layers = {
        temperature: gprops.temperature,
        dewpoint: gprops.dewpoint,
        apparentTemperature: gprops.apparentTemperature,
        maxTemperature: gprops.maxTemperature,
        minTemperature: gprops.minTemperature,
        relativeHumidity: gprops.relativeHumidity,
        skyCover: gprops.skyCover,
        windSpeed: gprops.windSpeed,
        windGust: gprops.windGust,
        windDirection: gprops.windDirection,
        probabilityOfPrecipitation: gprops.probabilityOfPrecipitation,
        quantitativePrecipitation: gprops.quantitativePrecipitation,
        weather: gprops.weather,
        hazards: gprops.hazards,
        snowfallAmount: gprops.snowfallAmount,
        iceAccumulation: gprops.iceAccumulation,
        probabilityOfThunder: gprops.probabilityOfThunder,
      };

      state.gridpoint = {
        lat, lon,
        office: props.cwa || props.gridId,
        gridX: props.gridX,
        gridY: props.gridY,
        updateTime: gprops.updateTime,
        layers,
        forecastUrl,
        hourlyUrl,
        gridUrl,
        city: props.relativeLocation?.properties?.city,
        state: props.relativeLocation?.properties?.state,
      };
      renderGridpointPanel();
      toast(`Gridpoint loaded · ${state.gridpoint.office} ${state.gridpoint.gridX},${state.gridpoint.gridY}`, 'success');
    } catch (e) {
      console.warn('Gridpoint failed', e);
      toast('Gridpoint data unavailable for this location', 'error');
      state.gridpoint = null;
    } finally {
      state.gridpointLoading = false;
    }
  }

  function renderGridpointPanel() {
    const gp = state.gridpoint;
    // Ensure detail panel shows grid data
    $('#detail-empty').classList.add('hidden');
    const box = $('#detail-content');
    box.classList.remove('hidden');

    if (!gp) {
      box.innerHTML = '<p class="hint">No gridpoint selected. Click the map or use Sample Gridpoint.</p>';
      return;
    }

    const L = gp.layers;
    const t = currentGridValue(L.temperature);
    const app = currentGridValue(L.apparentTemperature);
    const dew = currentGridValue(L.dewpoint);
    const rh = currentGridValue(L.relativeHumidity);
    const pop = currentGridValue(L.probabilityOfPrecipitation);
    const qpf = currentGridValue(L.quantitativePrecipitation);
    const wind = currentGridValue(L.windSpeed);
    const gust = currentGridValue(L.windGust);
    const sky = currentGridValue(L.skyCover);
    const maxT = currentGridValue(L.maxTemperature);
    const minT = currentGridValue(L.minTemperature);

    let weatherStr = '—';
    if (L.weather && L.weather.values && L.weather.values[0] && L.weather.values[0].value) {
      const w = L.weather.values[0].value;
      if (Array.isArray(w) && w[0]) {
        weatherStr = [w[0].weather, w[0].coverage, w[0].intensity].filter(Boolean).join(' · ') || 'See raw';
      }
    }

    let hazardsHtml = '';
    if (L.hazards && L.hazards.values) {
      const hs = [];
      L.hazards.values.forEach(v => {
        if (Array.isArray(v.value)) {
          v.value.forEach(h => {
            if (h && h.phenomenon) hs.push(`${h.phenomenon}${h.significance ? '-' + h.significance : ''}${h.event_number ? ' #' + h.event_number : ''}`);
          });
        }
      });
      if (hs.length) hazardsHtml = hs.slice(0, 8).map(h => `<span class="pill">${escapeHtml(h)}</span>`).join(' ');
    }

    const locLabel = [gp.city, gp.state].filter(Boolean).join(', ') || `${gp.lat.toFixed(3)}, ${gp.lon.toFixed(3)}`;

    box.innerHTML = `
      <h3>NWS Gridpoint Forecast</h3>
      <div class="meta-row">
        <span class="pill">${escapeHtml(gp.office || '')} ${gp.gridX},${gp.gridY}</span>
        <span class="pill">${escapeHtml(locLabel)}</span>
      </div>
      <p class="hint" style="margin-bottom:10px">Raw 2.5 km grid layers · Updated ${gp.updateTime ? gp.updateTime.slice(0,16) : '—'}Z</p>

      <div class="iss-card" style="margin-bottom:12px">
        <div class="iss-grid">
          <div><span>Temperature</span><strong>${t ? fmtTemp(t.value) : '—'}</strong></div>
          <div><span>Feels Like</span><strong>${app ? fmtTemp(app.value) : '—'}</strong></div>
          <div><span>Dewpoint</span><strong>${dew ? fmtTemp(dew.value) : '—'}</strong></div>
          <div><span>Humidity</span><strong>${rh ? fmtPct(rh.value) : '—'}</strong></div>
          <div><span>Sky Cover</span><strong>${sky ? fmtPct(sky.value) : '—'}</strong></div>
          <div><span>Precip Chance</span><strong>${pop ? fmtPct(pop.value) : '—'}</strong></div>
          <div><span>Wind</span><strong>${wind ? fmtWind(wind.value, L.windSpeed?.uom) : '—'}</strong></div>
          <div><span>Gust</span><strong>${gust ? fmtWind(gust.value, L.windGust?.uom) : '—'}</strong></div>
          <div><span>Max Temp</span><strong>${maxT ? fmtTemp(maxT.value) : '—'}</strong></div>
          <div><span>Min Temp</span><strong>${minT ? fmtTemp(minT.value) : '—'}</strong></div>
          <div><span>QPF</span><strong>${qpf && qpf.value != null ? (Math.round(qpf.value * 100) / 100) + ' ' + (L.quantitativePrecipitation?.uom||'').replace('wmoUnit:','') : '—'}</strong></div>
          <div><span>Weather</span><strong style="font-size:11px">${escapeHtml(weatherStr)}</strong></div>
        </div>
      </div>

      ${hazardsHtml ? `<div class="section"><h4>Hazards (grid)</h4><div class="meta-row">${hazardsHtml}</div></div>` : ''}

      <div class="section">
        <h4>Time series (next values)</h4>
        <ul class="source-list" style="font-size:11px;font-family:var(--font-mono)">
          ${parseGridValues(L.temperature).slice(0,6).map(v => `<li>${v.time.slice(0,16)}Z → ${fmtTemp(v.value)}</li>`).join('') || '<li>—</li>'}
        </ul>
      </div>

      <div class="section">
        <h4>Links</h4>
        <ul class="source-list">
          ${gp.forecastUrl ? `<li><a href="${gp.forecastUrl}" target="_blank" rel="noopener">12-h Forecast →</a></li>` : ''}
          ${gp.hourlyUrl ? `<li><a href="${gp.hourlyUrl}" target="_blank" rel="noopener">Hourly Forecast →</a></li>` : ''}
          ${gp.gridUrl ? `<li><a href="${gp.gridUrl}" target="_blank" rel="noopener">Raw Gridpoint JSON →</a></li>` : ''}
        </ul>
      </div>
      <p class="hint small">Layers from api.weather.gov/gridpoints · See weather-gov.github.io/api/gridpoints</p>
    `;
    switchTab('detail');
  }


  function showDetail(ev) {
    $('#detail-empty').classList.add('hidden');
    const box = $('#detail-content');
    box.classList.remove('hidden');
    const cats = (ev.categories||[]).map(c=>`<span class="pill">${escapeHtml(c.title)}</span>`).join('');
    const sources = (ev.sources||[]).map(s=>`<li><a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.id)}</a></li>`).join('');
    const geoms = (ev.geometry||[]).map(g=>`<li>${g.date?g.date.slice(0,16):'—'} · ${g.type}</li>`).join('');
    box.innerHTML = `<h3>${escapeHtml(ev.title)}</h3>
      <div class="meta-row">${cats}${ev.closed?'<span class="pill">CLOSED</span>':'<span class="pill">OPEN</span>'}</div>
      ${ev.description?`<p style="margin-bottom:12px;color:var(--text-mid)">${escapeHtml(ev.description)}</p>`:''}
      <div class="section"><h4>Sources</h4><ul class="source-list">${sources||'<li>—</li>'}</ul></div>
      <div class="section"><h4>Geometry</h4><ul class="source-list">${geoms||'<li>—</li>'}</ul></div>
      <div class="section"><h4>API</h4><a href="${ev.link||CFG.EONET+'/events/'+ev.id}" target="_blank" rel="noopener">Open in EONET →</a></div>`;
  }

  function renderEonetLayer() {
    state.layersGroup.eonet.clearLayers();
    state.markers.clear();
    if (!state.layers.eonet) return;
    state.filtered.forEach(ev => {
      const geoms = ev.geometry || [];
      if (!geoms.length) return;
      const color = catColor((ev.categories&&ev.categories[0]&&ev.categories[0].title)||'');
      const pts = [];
      geoms.forEach(g => { if (g.type==='Point'&&g.coordinates) pts.push([g.coordinates[1],g.coordinates[0]]); });
      if (pts.length > 1) L.polyline(pts,{color,weight:2,opacity:0.55,dashArray:'4 4'}).addTo(state.layersGroup.eonet);
      const last = geoms[geoms.length-1];
      if (last.type==='Point'&&last.coordinates) {
        const [lon,lat] = last.coordinates;
        const marker = L.marker([lat,lon],{icon:makeEonetIcon(color)})
          .bindPopup(`<div class="popup-title">${escapeHtml(ev.title)}</div><div class="popup-meta">${escapeHtml((ev.categories[0]||{}).title||'')} · ${last.date?last.date.slice(0,10):''}</div>`)
          .on('click', () => selectEvent(ev.id));
        marker.addTo(state.layersGroup.eonet);
        state.markers.set(ev.id, marker);
      } else if (last.type==='Polygon'&&last.coordinates&&last.coordinates[0]) {
        const latlngs = last.coordinates[0].map(c=>[c[1],c[0]]);
        L.polygon(latlngs,{color,weight:1.5,fillOpacity:0.15}).addTo(state.layersGroup.eonet);
      }
    });
  }

  function renderUsgs() {
    state.layersGroup.usgs.clearLayers();
    if (!state.layers.usgs) return;
    state.usgs.features.forEach(f => {
      const [lon,lat] = f.geometry.coordinates;
      const mag = f.properties.mag;
      L.circleMarker([lat,lon],{radius:Math.max(4,Math.min(14,mag*3)),color:'#f97316',fillColor:'#f97316',fillOpacity:0.45,weight:1})
        .bindPopup(`<div class="popup-title">M${mag} — ${escapeHtml(f.properties.place||'')}</div><div class="popup-meta">${new Date(f.properties.time).toISOString().slice(0,16)}Z</div>`)
        .addTo(state.layersGroup.usgs);
    });
  }

  function renderGdacs() {
    state.layersGroup.gdacs.clearLayers();
    if (!state.layers.gdacs) return;
    state.gdacs.features.forEach(f => {
      let lat, lon, title = 'GDACS';
      if (f.geometry&&f.geometry.coordinates) [lon,lat]=f.geometry.coordinates;
      else if (f.lat!=null) { lat=f.lat; lon=f.lon||f.longitude; }
      if (lat==null) return;
      title = f.name||f.title||f.eventname||(f.properties&&f.properties.name)||title;
      L.circleMarker([lat,lon],{radius:7,color:'#ef4444',fillColor:'#ef4444',fillOpacity:0.5,weight:1})
        .bindPopup(`<div class="popup-title">${escapeHtml(String(title))}</div>`)
        .addTo(state.layersGroup.gdacs);
    });
  }

  function renderIss() {
    state.layersGroup.iss.clearLayers();
    state.layersGroup.trail.clearLayers();
    if (!state.iss.lat) return;
    if (state.layers.iss) {
      L.marker([state.iss.lat,state.iss.lon],{icon:makeIssIcon(),zIndexOffset:1000})
        .bindPopup(`<div class="popup-title">International Space Station</div><div class="popup-meta">${state.iss.lat.toFixed(2)}°, ${state.iss.lon.toFixed(2)}° · ${state.iss.alt} km</div>`)
        .on('click', openCesium)
        .addTo(state.layersGroup.iss);
    }
    if (state.layers.issTrail && state.trail.length > 1) {
      L.polyline(state.trail,{color:'#06b6d4',weight:2,opacity:0.65,dashArray:'6 4'}).addTo(state.layersGroup.trail);
    }
  }

  function updateIssHud() {
    const i = state.iss;
    if (i.lat==null) return;
    $('#iss-lat').textContent = i.lat.toFixed(2)+'°';
    $('#iss-lon').textContent = i.lon.toFixed(2)+'°';
    $('#iss-alt').textContent = i.alt;
    $('#iss-vel').textContent = i.vel;
    $('#iss-lat2').textContent = i.lat.toFixed(4)+'°';
    $('#iss-lon2').textContent = i.lon.toFixed(4)+'°';
    $('#iss-alt2').textContent = i.alt+' km';
    $('#iss-vel2').textContent = i.vel+' km/h';
    $('#iss-vis').textContent = i.vis;
    $('#iss-foot').textContent = i.footprint+' km';
    $('#iss-status').textContent = 'TRACKING';
    $('#iss-status').style.color = 'var(--green)';
  }

  function renderCrew() {
    const ul = $('#crew-list');
    if (!state.crew.length) { ul.innerHTML = '<li>No data</li>'; return; }
    ul.innerHTML = state.crew.map(p => `<li><span>${escapeHtml(p.name)}</span><span class="craft">${escapeHtml(p.craft||'')}</span></li>`).join('');
  }

  function fitToEvents() {
    const pts = [];
    state.filtered.forEach(ev => {
      const g = ev.geometry && ev.geometry[ev.geometry.length-1];
      if (g&&g.type==='Point'&&g.coordinates) pts.push([g.coordinates[1],g.coordinates[0]]);
    });
    if (state.layers.iss && state.iss.lat!=null) pts.push([state.iss.lat,state.iss.lon]);
    if (pts.length) state.map.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:6});
  }

  // ── WFO STATIONS ──
  function renderWfoList(filter='') {
    const list = $('#wfo-list');
    const q = filter.trim().toLowerCase();
    const items = (window.WFO_LIST || []).filter(w => {
      if (!q) return true;
      return w.code.toLowerCase().includes(q) || w.name.toLowerCase().includes(q) || w.state.toLowerCase().includes(q);
    });
    // Group by state
    const byState = {};
    items.forEach(w => { (byState[w.state] = byState[w.state] || []).push(w); });
    let html = '';
    Object.keys(byState).sort().forEach(st => {
      html += `<div style="padding:6px 8px;font-size:10px;letter-spacing:0.1em;color:var(--text-dim)">${st}</div>`;
      byState[st].forEach(w => {
        html += `<div class="wfo-item" data-code="${w.code}" data-lat="${w.lat}" data-lon="${w.lon}">
          <span>${escapeHtml(w.name)}</span>
          <span><span class="code">${w.code}</span> <span class="state">${w.state}</span></span>
        </div>`;
      });
    });
    list.innerHTML = html || '<div class="empty-state">No match</div>';
    list.querySelectorAll('.wfo-item').forEach(el => {
      el.addEventListener('click', () => selectWfo(el.dataset.code, +el.dataset.lat, +el.dataset.lon, el.querySelector('span').textContent));
    });
  }

  function selectWfo(code, lat, lon, name) {
    state.selectedWfo = { code, lat, lon, name };
    $('#wfo-list').classList.add('hidden');
    $('#wfo-detail').classList.remove('hidden');
    $('#wfo-detail-name').textContent = `${name} (${code})`;
    $('#wfo-products').innerHTML = '<p class="hint">Loading office alerts & products…</p>';
    // Auto-load alerts + products for this office
    pingWfo();
  }

  async function pingWfo() {
    if (!state.selectedWfo) return;
    const code = state.selectedWfo.code;
    $('#wfo-products').innerHTML = '<p class="hint">Loading…</p>';
    let html = '';

    // 1) Active alerts for this office (primary UX)
    try {
      const alerts = await fetchJson(`https://api.weather.gov/alerts/active?office=${code}`);
      const feats = alerts.features || [];
      html += `<div class="wfo-section-title">ACTIVE ALERTS (${feats.length})</div>`;
      if (!feats.length) {
        html += '<p class="hint">No active alerts for this office.</p>';
      } else {
        feats.forEach((f, idx) => {
          const p = f.properties || {};
          const sev = p.severity || 'Unknown';
          const color = severityColor(sev);
          const id = f.id || `alert-${idx}`;
          html += `<div class="alert-card" data-alert-id="${escapeHtml(id)}" style="border-left:3px solid ${color}">
            <div class="alert-card-head">
              <strong>${escapeHtml(p.event || p.headline || 'Alert')}</strong>
              ${severityBadge(sev)}
            </div>
            <div class="alert-card-meta">${escapeHtml((p.areaDesc || '').slice(0, 80))}</div>
            <div class="alert-card-meta">${p.onset ? p.onset.slice(0,16) : ''} → ${p.expires ? p.expires.slice(0,16) : ''}Z</div>
          </div>`;
        });
      }
      // Store for floating window
      state._wfoAlerts = feats;
    } catch (e) {
      html += '<p class="hint">Could not load alerts for office.</p>';
      state._wfoAlerts = [];
    }

    // 2) Office info + recent products
    try {
      const office = await fetchJson(CFG.NWS_OFFICE(code));
      html += `<div class="wfo-section-title" style="margin-top:12px">OFFICE</div>
        <div class="prod"><strong>${escapeHtml(office.name || code)}</strong><br>
        <a href="${office['@id'] || 'https://www.weather.gov/' + code.toLowerCase()}" target="_blank" rel="noopener">NWS page →</a></div>`;
    } catch (_) {}

    try {
      let list = [];
      try {
        const all = await fetchJson(CFG.NWS_PRODUCTS_ALL(code));
        list = (all['@graph'] || all.products || []).slice(0, 15);
      } catch (_) {
        const prods = await fetchJson(CFG.NWS_PRODUCTS(code));
        list = (prods['@graph'] || prods.products || []).slice(0, 12);
      }
      if (list.length) {
        html += '<div class="wfo-section-title" style="margin-top:10px">RECENT PRODUCTS</div>';
        list.forEach((p, i) => {
          const pid = p['@id'] || p.url || '';
          html += `<div class="prod prod-clickable" data-product-url="${escapeHtml(pid)}" data-product-name="${escapeHtml(p.productName || p.id || 'Product')}">
            <strong>${escapeHtml(p.productName || p.id || 'Product')}</strong>
            <div style="color:var(--text-dim);font-size:10px">${p.issuanceTime ? p.issuanceTime.slice(0,16) : ''}Z · click to open</div>
          </div>`;
        });
      }
    } catch (_) {}

    $('#wfo-products').innerHTML = html;

    // Click handlers for alert cards → floating detail window
    $('#wfo-products').querySelectorAll('.alert-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.alertId;
        const f = (state._wfoAlerts || []).find(x => (x.id || '') === id);
        if (f) openAlertFloat(f);
      });
    });
    // Product cards → fetch full text and show in float
    $('#wfo-products').querySelectorAll('.prod-clickable').forEach(card => {
      card.addEventListener('click', async () => {
        const url = card.dataset.productUrl;
        const name = card.dataset.productName || 'Product';
        if (!url) return;
        toast('Loading product…');
        try {
          const data = await fetchJson(url);
          openProductFloat(data, name);
        } catch (e) {
          toast('Could not load product text', 'error');
        }
      });
    });
  }

  function openAlertFloat(f) {
    const p = f.properties || {};
    const sev = p.severity || 'Unknown';
    const color = severityColor(sev);
    // Remove existing float
    const prev = document.getElementById('alert-float');
    if (prev) prev.remove();

    const el = document.createElement('div');
    el.id = 'alert-float';
    el.className = 'alert-float';
    el.innerHTML = `
      <div class="alert-float-head" style="border-top:3px solid ${color}">
        <div>
          <strong>${escapeHtml(p.event || 'Alert')}</strong>
          ${severityBadge(sev)}
        </div>
        <button class="icon-btn" id="alert-float-close">✕</button>
      </div>
      <div class="alert-float-body">
        <div class="alert-float-headline">${escapeHtml(p.headline || '')}</div>
        <div class="meta-row" style="margin:8px 0">
          <span class="pill">${escapeHtml(p.urgency || '')}</span>
          <span class="pill">${escapeHtml(p.certainty || '')}</span>
          <span class="pill">${escapeHtml(p.response || '')}</span>
        </div>
        <div class="alert-float-area"><strong>Area:</strong> ${escapeHtml(p.areaDesc || '—')}</div>
        <div class="alert-float-time">Onset: ${p.onset ? p.onset.slice(0,16)+'Z' : '—'} · Expires: ${p.expires ? p.expires.slice(0,16)+'Z' : '—'}</div>
        <div class="alert-float-desc">${escapeHtml((p.description || '').slice(0, 1200))}${(p.description||'').length > 1200 ? '…' : ''}</div>
        ${p.instruction ? `<div class="alert-float-instr"><strong>Instructions:</strong> ${escapeHtml(p.instruction.slice(0,600))}</div>` : ''}
        <div style="margin-top:10px">
          <button class="btn" id="alert-float-zoom">Zoom map to alert</button>
          ${p['@id'] ? `<a class="btn ghost" href="${p['@id']}" target="_blank" rel="noopener" style="margin-left:6px">Official →</a>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(el);
    $('#alert-float-close').onclick = () => el.remove();
    $('#alert-float-zoom').onclick = () => {
      if (f.geometry) {
        try {
          const layer = L.geoJSON(f);
          state.map.fitBounds(layer.getBounds(), { padding: [40,40], maxZoom: 8 });
        } catch(_) {}
      }
      el.remove();
    };
  }

  // ── CESIUM 3D ──
  function openCesium() {
    $('#cesium-modal').classList.remove('hidden');
    $('#cesium-status').textContent = 'Loading Cesium globe…';
    if (state.cesiumViewer) {
      updateCesiumIss();
      return;
    }
    try {
      // No Ion token required for basic ellipsoid + OSM imagery
      Cesium.Ion.defaultAccessToken = undefined;
      const viewer = new Cesium.Viewer('cesiumContainer', {
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: true,
        sceneModePicker: true,
        navigationHelpButton: false,
        fullscreenButton: false,
        imageryProvider: false,
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        requestRenderMode: true,
      });
      // Free OSM imagery
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          credit: '© OpenStreetMap',
        })
      );
      viewer.scene.globe.enableLighting = true;
      state.cesiumViewer = viewer;
      updateCesiumIss();
      $('#cesium-status').textContent = 'LIVE · ISS position + recent ground track';
    } catch (e) {
      console.error(e);
      $('#cesium-status').textContent = 'Cesium failed to initialize: ' + e.message;
    }
  }

  function updateCesiumIss() {
    const v = state.cesiumViewer;
    if (!v || state.iss.lat == null) return;
    // Remove previous ISS entities
    const toRemove = [];
    v.entities.values.forEach(e => { if (e.name === 'ISS' || e.name === 'ISS Trail') toRemove.push(e); });
    toRemove.forEach(e => v.entities.remove(e));

    const pos = Cesium.Cartesian3.fromDegrees(state.iss.lon, state.iss.lat, (parseFloat(state.iss.alt)||400)*1000);
    v.entities.add({
      name: 'ISS',
      position: pos,
      point: { pixelSize: 12, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
      label: { text: 'ISS', font: '14px sans-serif', fillColor: Cesium.Color.CYAN, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -14) },
    });

    if (state.trail.length > 2) {
      const positions = state.trail.map(([la, lo]) => Cesium.Cartesian3.fromDegrees(lo, la, 400000));
      v.entities.add({
        name: 'ISS Trail',
        polyline: { positions, width: 2, material: Cesium.Color.CYAN.withAlpha(0.7) },
      });
    }

    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(state.iss.lon, state.iss.lat, 2500000),
      duration: 1.2,
    });
  }


  function openProductFloat(data, name) {
    const prev = document.getElementById('alert-float');
    if (prev) prev.remove();

    const text = data.productText || data.productContent || JSON.stringify(data, null, 2);
    // Clean up common NWS product formatting
    let body = escapeHtml(text)
      .replace(/\\n/g, '\n')
      .replace(/\n/g, '<br>')
      .replace(/&amp;/g, '&');
    // Highlight KEY MESSAGES / WARNING style headers
    body = body.replace(/(KEY MESSAGES?|DISCUSSION|AVIATION|MARINE|FIRE WEATHER|HYDROLOGY|SYNOPSIS)/gi,
      '<span style="color:var(--amber);font-weight:600">$1</span>');
    body = body.replace(/(WARNING|WATCH|ADVISORY|STATEMENT)/gi,
      '<span style="color:#fca5a5;font-weight:600">$1</span>');

    const el = document.createElement('div');
    el.id = 'alert-float';
    el.className = 'alert-float product-float';
    el.innerHTML = `
      <div class="alert-float-head" style="border-top:3px solid var(--cyan)">
        <div>
          <strong>${escapeHtml(name)}</strong>
          <span class="sev-badge" style="background:rgba(6,182,212,0.15);color:var(--cyan);border:1px solid rgba(6,182,212,0.35)">${escapeHtml(data.productCode || 'PRODUCT')}</span>
        </div>
        <button class="icon-btn" id="alert-float-close">✕</button>
      </div>
      <div class="alert-float-body product-body">
        <div class="alert-float-meta" style="font-size:11px;color:var(--text-dim);margin-bottom:10px">
          ${data.issuingOffice ? 'Office: ' + escapeHtml(data.issuingOffice) + ' · ' : ''}
          ${data.issuanceTime ? data.issuanceTime.slice(0,16) + 'Z' : ''}
        </div>
        <div class="product-text">${body}</div>
        ${data['@id'] ? `<div style="margin-top:12px"><a class="btn ghost" href="${data['@id']}" target="_blank" rel="noopener">Official product →</a></div>` : ''}
      </div>
    `;
    document.body.appendChild(el);
    document.getElementById('alert-float-close').onclick = () => el.remove();
  }

  function openWindyOverlay(layer) {
    const c = state.map.getCenter();
    const z = Math.min(state.map.getZoom(), 11);
    const overlays = {
      wind: 'wind', temp: 'temp', rain: 'rain', clouds: 'clouds',
      pressure: 'pressure', radar: 'radar', satellite: 'satellite',
      thunder: 'thunder', humidity: 'rh', gust: 'gust',
      waves: 'waves', snow: 'snow', dewpoint: 'dewpoint',
      cape: 'cape', visibility: 'visibility',
    };
    const ov = overlays[layer] || layer || 'radar';
    const url = `https://embed.windy.com/embed2.html?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&zoom=${z}&level=surface&overlay=${ov}&product=ecmwf&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1`;

    let modal = document.getElementById('windy-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'windy-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-backdrop" id="windy-close-bg"></div>
        <div class="modal-panel" style="width:min(1200px,96vw);height:min(800px,92vh)">
          <div class="modal-head">
            <span>WINDY · <span id="windy-layer-label">${ov.toUpperCase()}</span></span>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <select id="windy-layer-select" class="ctrl-select" style="font-size:11px">
                <option value="radar">Radar</option>
                <option value="satellite">Satellite</option>
                <option value="wind">Wind</option>
                <option value="temp">Temperature</option>
                <option value="rain">Rain / Snow</option>
                <option value="clouds">Clouds</option>
                <option value="pressure">Pressure</option>
                <option value="thunder">Thunderstorms</option>
                <option value="gust">Wind Gusts</option>
                <option value="humidity">Humidity</option>
                <option value="dewpoint">Dewpoint</option>
                <option value="cape">CAPE</option>
                <option value="snow">Snow cover</option>
                <option value="waves">Waves</option>
                <option value="visibility">Visibility</option>
              </select>
              <button class="icon-btn" id="windy-close">✕</button>
            </div>
          </div>
          <iframe id="windy-frame" style="flex:1;border:none;width:100%;min-height:0;background:#000" allowfullscreen></iframe>
          <div class="modal-foot">Powered by Windy.com embed · Syncs to current map center</div>
        </div>`;
      document.body.appendChild(modal);
      document.getElementById('windy-close').onclick = () => modal.classList.add('hidden');
      document.getElementById('windy-close-bg').onclick = () => modal.classList.add('hidden');
      document.getElementById('windy-layer-select').onchange = (e) => {
        openWindyOverlay(e.target.value);
      };
    }
    modal.classList.remove('hidden');
    document.getElementById('windy-layer-label').textContent = ov.toUpperCase();
    document.getElementById('windy-layer-select').value = ov;
    document.getElementById('windy-frame').src = url;
  }


  function closeCesium() {
    $('#cesium-modal').classList.add('hidden');
  }

  // ── UI BINDINGS ──
  function switchTab(name) {
    $$('#right-panel .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('#right-panel .tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  }

  function bindUi() {
    $$('#status-seg button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#status-seg button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.status = btn.dataset.status;
      });
    });
    $('#days-select').addEventListener('change', e => { state.days = Number(e.target.value); });
    $('#search-input').addEventListener('input', e => { state.search = e.target.value; applyFilters(); });
    $('#cat-toggle-all').addEventListener('click', () => {
      const allOn = state.enabledCats.size === state.categories.size;
      state.enabledCats.clear();
      if (!allOn) state.categories.forEach((_, id) => state.enabledCats.add(id));
      renderCategoryList();
    });
    $('#category-list').addEventListener('change', e => {
      if (e.target.matches('input[data-cat]')) {
        const id = e.target.dataset.cat;
        if (e.target.checked) state.enabledCats.add(id);
        else state.enabledCats.delete(id);
      }
    });

    const layerMap = {
      'layer-eonet':'eonet','layer-nws':'nws','layer-usgs':'usgs','layer-gdacs':'gdacs',
      'layer-iss':'iss','layer-iss-trail':'issTrail'
    };
    Object.entries(layerMap).forEach(([domId, key]) => {
      const el = $('#'+domId);
      if (!el) return;
      el.addEventListener('change', () => {
        state.layers[key] = el.checked;
        if (key === 'eonet') renderEonetLayer();
        if (key === 'nws') { if (el.checked) { loadNwsAlerts(); renderNwsLayer(); } else state.layersGroup.nws.clearLayers(); }
        if (key === 'usgs') { if (el.checked && !state.usgs.features.length) loadUsgs(); else renderUsgs(); }
        if (key === 'gdacs') {
          if (el.checked) { state.layersGroup.gdacs.addTo(state.map); if (!state.gdacs.features.length) loadGdacs(); else renderGdacs(); }
          else state.map.removeLayer(state.layersGroup.gdacs);
        }
        if (key === 'iss' || key === 'issTrail') renderIss();
        updateStats(); updateLegend();
      });
    });

    $('#usgs-feed')?.addEventListener('change', e => {
      state.usgs.feed = e.target.value;
      if (state.layers.usgs) loadUsgs();
    });

    $('#layer-nexrad').addEventListener('change', e => {
      setNexrad(e.target.checked);
      updateStats(); updateLegend();
    });
    $('#nexrad-product').addEventListener('change', () => {
      if ($('#layer-nexrad').checked) setNexrad(true);
    });

    $('#btn-sample-grid')?.addEventListener('click', () => {
      const c = state.map.getCenter();
      toast(`Sampling gridpoint at map center…`);
      loadGridpoint(c.lat, c.lng);
    });
    $('#btn-windy')?.addEventListener('click', () => openWindyOverlay('radar'));

    $('#btn-apply').addEventListener('click', async () => { await loadEvents(); toast('Filters applied', 'success'); });
    $('#btn-reset').addEventListener('click', () => {
      state.status = 'open'; state.days = 30; state.search = '';
      state.enabledCats = new Set(state.categories.keys());
      $('#search-input').value = ''; $('#days-select').value = '30';
      $$('#status-seg button').forEach(b => b.classList.toggle('active', b.dataset.status === 'open'));
      renderCategoryList(); loadEvents();
    });
    $('#btn-refresh').addEventListener('click', () => {
      loadEvents(); loadUsgs(); loadNwsAlerts();
      if (state.layers.gdacs) loadGdacs();
      loadIss();
      if ($('#layer-nexrad')?.checked) setNexrad(true);
      toast('Full soft refresh complete');
    });
    $('#btn-alerts').addEventListener('click', () => {
      state.alertsEnabled = !state.alertsEnabled;
      $('#btn-alerts').setAttribute('aria-pressed', state.alertsEnabled);
      toast(state.alertsEnabled ? 'Three-tone alerts ON' : 'Alerts OFF');
    });
    $('#btn-fullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });

    $$('#right-panel .tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $$('#nws-panel .tab').forEach(t => {
      t.addEventListener('click', () => {
        $$('#nws-panel .tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        const name = t.dataset.nwstab;
        $('#panel-stations').classList.toggle('active', name === 'stations');
        $('#panel-alerts').classList.toggle('active', name === 'alerts');
        if (name === 'alerts') loadNwsAlerts();
      });
    });

    $('#wfo-search').addEventListener('input', e => renderWfoList(e.target.value));
    $('#btn-wfo-reset')?.addEventListener('click', () => {
      $('#wfo-search').value = '';
      $('#wfo-detail').classList.add('hidden');
      $('#wfo-list').classList.remove('hidden');
      state.selectedWfo = null;
      renderWfoList('');
      toast('WFO list reset');
    });
    $('#btn-nws-reset')?.addEventListener('click', () => {
      state.nwsSearch = '';
      state.nwsSev = 'all';
      $('#nws-alert-search').value = '';
      $$('#nws-sev-seg button').forEach(b => b.classList.toggle('active', b.dataset.sev === 'all'));
      loadNwsAlerts();
      toast('NWS alerts reloaded');
    });
    $('#wfo-back').addEventListener('click', () => {
      $('#wfo-detail').classList.add('hidden');
      $('#wfo-list').classList.remove('hidden');
      state.selectedWfo = null;
    });
    $('#wfo-zoom').addEventListener('click', () => {
      if (state.selectedWfo) state.map.flyTo([state.selectedWfo.lat, state.selectedWfo.lon], 7, {duration:0.9});
    });
    $('#wfo-ping').addEventListener('click', pingWfo);

    $('#nws-alert-search').addEventListener('input', e => { state.nwsSearch = e.target.value; applyNwsFilter(); });
    $$('#nws-sev-seg button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#nws-sev-seg button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.nwsSev = btn.dataset.sev;
        applyNwsFilter();
      });
    });

    $('#btn-iss-3d').addEventListener('click', openCesium);
    $('#btn-iss-3d-2').addEventListener('click', openCesium);
    $('#cesium-close').addEventListener('click', closeCesium);
    $('#cesium-close-bg').addEventListener('click', closeCesium);

    $('#autorefresh-select').addEventListener('change', e => {
      state.autoRefreshMs = Number(e.target.value) * 1000;
      scheduleAutoRefresh();
    });
  }

  function scheduleAutoRefresh() {
    if (state.autoTimer) clearInterval(state.autoTimer);
    if (state.autoRefreshMs > 0) {
      state.autoTimer = setInterval(() => {
        // Full site refresh every interval (default 2 min)
        loadEvents();
        loadUsgs();
        loadNwsAlerts();
        if (state.layers.gdacs) loadGdacs();
        loadIss();
        // Keep NEXRAD tiles fresh by re-adding if enabled
        if (state.layers.nexrad || $('#layer-nexrad')?.checked) {
          setNexrad(true);
        }
      }, state.autoRefreshMs);
    }
  }

  async function initApp() {
    initMap();
    bindUi();
    renderWfoList();
    updateClock();
    setInterval(updateClock, 1000);

    await loadCategories();
    await Promise.all([loadEvents(), loadUsgs(), loadNwsAlerts(), loadIss(), loadCrew()]);
    scheduleAutoRefresh();
    setInterval(loadIss, CFG.POLL_ISS_MS);
    setInterval(loadCrew, 5 * 60 * 1000);
    toast('EONETXPLR V2.1 online — 2-min refresh active', 'success');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
