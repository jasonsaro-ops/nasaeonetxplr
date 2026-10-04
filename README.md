# EONETXPLR — NASA Natural Event Tracker

Focused NASA Earth Observatory platform.

## Scope

- **NASA EONET** — natural events, categories, sources, geometry timeline, related imagery layers
- **NASA FIRMS** — VIIRS/MODIS active fire hotspots (24h public CSV)
- **NASA GIBS** — satellite imagery overlays (MODIS / VIIRS true color and science layers)
- **USGS earthquakes** — official GeoJSON feeds
- **NASA API key services** — APOD, DONKI space weather, NeoWs near-Earth objects

Removed: NWS, NEXRAD, Windy, ISS, GDACS, Cesium.

## Deploy

Static site for GitHub Pages. Push folder contents and enable Pages.

## API key

NASA demo/personal key is embedded for APOD / DONKI / NeoWs.  
EONET, FIRMS public CSV, GIBS, and USGS do not require the key.

## Local

```bash
npx serve .
```
