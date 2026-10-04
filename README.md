# EONETXPLR V2.1

Mission-critical global natural event & orbital intelligence platform.

## What’s new in 2.1

- **Free basemaps** (no API key) — Carto Dark / Esri Imagery / OpenTopoMap / OSM fallback
- **NEXRAD radar** via Iowa Environmental Mesonet WMS (Base Reflectivity)
- **NWS active alerts** nationwide with search + severity filter + map polygons
- **WFO Stations column** — all NWS Weather Forecast Offices by state, zoom-to-office, ping for latest products & local alerts
- **Four-column layout** — Filters | Map | Feed/Detail/ISS | NWS Stations + Alerts
- **Three-tone audio** on new EONET events and new Extreme/Severe NWS alerts
- **Default 2-minute auto-refresh**
- **ISS 3D globe** (CesiumJS) with live position + ground-track trajectory when ISS is clicked or “Open 3D Globe” is used
- Restored previous sources: EONET, NWS, NEXRAD, USGS, GDACS, ISS, crew roster
- **NWS Gridpoint layers** (api.weather.gov/gridpoints) — click map or “Sample Gridpoint” to load temperature, dewpoint, apparent temp, PoP, QPF, wind, gust, sky cover, humidity, weather, hazards, max/min for that 2.5 km cell

## Deploy on GitHub Pages

1. Push the contents of this folder to a repo (root or `/docs`).
2. Settings → Pages → select branch/folder.
3. Done. No build, no keys required for core features.

## Local

```bash
npx serve .
# or
python -m http.server 8080
```

## Data sources

| Layer / Feature | Source |
|-----------------|--------|
| EONET events | eonet.gsfc.nasa.gov/api/v3 |
| NWS alerts | api.weather.gov/alerts/active |
| NWS offices | api.weather.gov/offices/{code} |
| NEXRAD | mesonet.agron.iastate.edu WMS |
| USGS quakes | earthquake.usgs.gov GeoJSON |
| GDACS | gdacs.org API |
| ISS position | api.wheretheiss.at |
| People in space | api.open-notify.org/astros.json |
| NWS Gridpoints | api.weather.gov/points + /gridpoints/{wfo}/{x},{y} |

## Notes

- Carto dark tiles are preferred; if a watermark appears in the future, switch to the OSM / SAT / TOPO buttons (all key-free).
- Cesium runs without an Ion token (ellipsoid + OSM imagery).
- Three-tone alert uses Web Audio API (853/960 Hz style).
- MONTCO-specific ReadyMontco feed is not publicly available as an open API; PHI (Philadelphia/Mt Holly) WFO covers Montgomery County, PA — use the WFO panel and NWS alerts for that region.

Built for operators who need situational awareness at a glance.
