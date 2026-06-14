# ÆTHER · Radar

A **Flightradar24-style live air-traffic console** with a clean light
"aeronautical-chart" UI. Real free ADS-B traffic by default, aircraft that glide between
updates via dead-reckoning, click-to-inspect telemetry with routes/weather/estimated
times, worldwide flight search, and isolate/follow tracking.

![mode badge: SANDBOX·LIVE](https://img.shields.io/badge/mode-SANDBOX-ffb454)

---

## Run it

Requires **Node 18+** (uses the built-in `fetch`). No `npm install` — zero dependencies.

```bash
node server.js
```

Then open **http://localhost:8787**.

The server reads your token from `.env` (already populated with the sandbox key you
provided) and proxies every FR24 call so the token never reaches the browser.

```
FR24_TOKEN=<id>|<secret>      # from https://fr24api.flightradar24.com/key-management
FR24_BASE=https://fr24api.flightradar24.com/api
PORT=8787
```

---

## What you'll see

| Area | Detail |
|------|--------|
| **Top HUD** | Zulu clock, live contact count, feed status (LIVE/SYNC/ERR), mode badge |
| **Aircraft** | Top-view jet glyphs, rotated to heading, **colored by altitude** (green→cyan→amber→rose) |
| **Motion** | Between API polls, planes **dead-reckon** forward along their track + groundspeed, so they glide instead of jumping. Fading **vapor trails** show recent path |
| **Click a plane** | Right telemetry panel: callsign, airline, ORIG→DEST route with great-circle line + progress bar, **estimated departure/arrival (Zulu) and time enroute**, **current weather at both cities**, ALT / GS / V/S / HDG gauges, type, registration, squawk, Mode-S, live position |
| **Left deck** | Altitude-floor filter, category filter (jet/cargo/GA), demo toggle, trails toggle |

Press **Esc** or click empty map to dismiss the panel.

### Find & track a specific flight

- **Search** (top bar) — type a callsign, registration, or hex. Matches currently on the
  map appear instantly; pick one to fly to it. Hit **Enter** (or "Search worldwide") to
  find a flight **anywhere on the planet** — the map jumps to it and starts tracking it.
- **ISOLATE** (in the telemetry panel) — hides every other aircraft so only your flight
  is shown.
- **FOLLOW** — keeps the map centered on the selected flight as it moves.

---

## Data sources

Pick one in the **DATA SOURCE** card (top-left). The map, dead-reckoning, trails and
telemetry panel all work identically across sources.

| Source | What it is |
|--------|-----------|
| **ADS-B** *(default)* | **Real live traffic** from [adsb.lol](https://adsb.lol) — free, no signup. Real positions, callsigns, types, altitude, speed. Airline + aircraft-type names are resolved offline from `public/lookup.js`. **Routes** (origin→destination) are looked up live from the free [adsbdb.com](https://www.adsbdb.com/) callsign database — most scheduled airline flights resolve. |
| **FR24** | Your Flightradar24 sandbox key. Returns a single canned sample flight (`SAS7679`) regardless of where you pan — that's the sandbox, not a bug. Upgrade to a production token (drop it in `.env`, restart) and this same view fills with real FR24 traffic **including scheduled origin→destination routes**. |
| **DEMO** | A simulated fleet (~46 aircraft) for previewing the UI. Badged **DEMO·TRAFFIC**, never mixed with real data. |

ADS-B uses adsb.lol's radius API (centre of map + up to 250 nm), so zoom in for cleaner
coverage; it's capped at 600 rendered contacts for performance.

## Times & weather

- **Estimated times** are computed from live kinematics — distance already flown ÷ ground
  speed → estimated departure; distance remaining ÷ ground speed → estimated arrival.
  They are *estimates*, not scheduled times (free ADS-B/route data carries no schedule).
  If an aircraft isn't actually on the looked-up origin→destination line (a reused/stale
  callsign in the route DB), the times are suppressed rather than faked.
- **Weather** at the origin and destination cities comes from [Open-Meteo](https://open-meteo.com/)
  (free, no key), cached 10 minutes.

---

## Architecture

```
server.js        zero-dep Node server: static host + FR24 proxy + TTL cache for
                 airline/airport lookups (saves API credits)
public/
  index.html     HUD layout + inline SVG aircraft sprite
  styles.css     glass-cockpit theme (Chakra Petch + IBM Plex Mono)
  app.js         Leaflet map, marker store, dead-reckoning rAF loop,
                 polling, telemetry panel, demo fleet
```

### Proxy endpoints (server-side token injection)

| Route | FR24 endpoint |
|-------|---------------|
| `GET /api/flights?bounds=N,S,W,E` | `live/flight-positions/full` |
| `GET /api/airline?code=ICAO` | `static/airlines/{code}/light` (cached 24h) |
| `GET /api/airport?code=IATA` | `static/airports/{code}/full` (cached 24h) |
| `GET /api/summary?id=FR24ID` | `flight-summary/light` |
| `GET /api/usage` | `usage` |
| `GET /api/config` | reports whether a token is loaded |

The live feed polls every **9 s** and on map pan/zoom (debounced), querying only the
current viewport's bounds to keep credit usage low.

---

## Security

`.env` holds your API token and is **git-ignored**. Don't commit or share it. If it ever
leaks, rotate it at the FR24 key-management page.
