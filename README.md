# EONETXPLR V2.0

**Mission-critical global natural event & orbital intelligence platform**

A complete rebuild of the NASA EONET explorer with an OSIRIS-inspired dark intelligence aesthetic and live ISS tracking (Hamchron-style).

![Status](https://img.shields.io/badge/status-operational-22c55e)
![Static](https://img.shields.io/badge/hosting-GitHub%20Pages-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## Features

- **NASA EONET v3** — open/closed events, categories, sources, geometry tracks & polygons
- **Live ISS position** — altitude, velocity, visibility, footprint + ground track trail
- **People in Space** — current crew roster
- **USGS Earthquakes** — M2.5+ past 24 h
- **GDACS Global Hazards** (optional layer)
- Dark cyber / OSINT UI with Zulu clock, entity counters, audio alerts
- Soft auto-refresh, retry logic, degraded-mode indicators
- Fully static — no backend required

## Quick Start (GitHub Pages)

1. Create a new repository (or push into an existing one).
2. Upload the contents of this folder (`index.html`, `css/`, `js/`) to the root or a `/docs` folder.
3. In **Settings → Pages**, set the source to the branch and folder you used.
4. Visit `https://<you>.github.io/<repo>/`.

No build step. No API keys required for core functionality.

## Local Preview

```bash
# any static server
npx serve .
# or
python -m http.server 8080
```

Open `http://localhost:8080`.

## Data Sources

| Layer        | Endpoint / Source                                      |
|--------------|--------------------------------------------------------|
| EONET        | `https://eonet.gsfc.nasa.gov/api/v3`                   |
| USGS Quakes  | USGS GeoJSON feed (2.5_day)                            |
| ISS          | `https://api.wheretheiss.at/v1/satellites/25544`       |
| Crew         | Open Notify `/astros.json` (via CORS proxy if needed)  |
| GDACS        | GDACS public MAP endpoint (may require proxy)          |

## Keyboard / UX Notes

- Click any event card or map marker to inspect detail & fly the map.
- Toggle layers independently; ISS trail persists the last ~90 samples.
- Audio alerts fire when new EONET events appear while enabled.
- Fullscreen button available in the top bar.

## Architecture

```
index.html          — shell + boot splash
css/styles.css      — complete design system
js/app.js           — all application logic (IIFE, no build tools)
```

Designed for long-term maintainability and zero-dependency deployment.

## Roadmap Ideas

- NEXRAD / NWS alert polygons
- SPC convective outlooks
- Satellite imagery overlays (EONET layers API)
- Offline cache via service worker
- Shareable deep links (`?event=EONET_xxxx`)

---

Built for operators who need situational awareness at a glance.
Data remains the property of the respective agencies (NASA, USGS, etc.).
