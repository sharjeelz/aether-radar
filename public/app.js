/* =========================================================================
   ÆTHER RADAR — client
   ========================================================================= */
'use strict';

/* ---------- helpers ------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (n) => String(n).padStart(2, '0');
const R_EARTH = 6371000, KT_TO_MS = 0.514444, D2R = Math.PI / 180, R2D = 180 / Math.PI;
const AIRLINES = window.AIRLINES || {}, TYPES = window.TYPES || {};

/* ---------- config ------------------------------------------------------- */
const POLL_MS = 9000;        // refresh cadence
const MOVE_DEBOUNCE = 700;
const TRAIL_MAX = 28;
const DEMO_FLEET = 46;
const MAX_CONTACTS = 600;    // perf guard for dense areas

/* =========================================================================
   MAP
   ========================================================================= */
const map = L.map('map', {
  zoomControl: false, worldCopyJump: true, preferCanvas: true, minZoom: 3, maxZoom: 12,
}).setView([51.2, 3.5], 7);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd', maxZoom: 19,
}).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd', maxZoom: 19, opacity: 0.8,
}).addTo(map);

const trailLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

/* =========================================================================
   ALTITUDE → COLOR
   ========================================================================= */
const ALT_STOPS = [
  [0, [43, 185, 138]], [10000, [30, 159, 192]], [20000, [224, 168, 42]],
  [30000, [214, 132, 15]], [40000, [214, 64, 107]],
];
function altColor(alt) {
  alt = clamp(alt || 0, 0, 40000);
  for (let i = 1; i < ALT_STOPS.length; i++) {
    const [a0, c0] = ALT_STOPS[i - 1], [a1, c1] = ALT_STOPS[i];
    if (alt <= a1) {
      const t = (alt - a0) / (a1 - a0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(255,111,141)';
}

/* =========================================================================
   DEAD RECKONING
   ========================================================================= */
function deadReckon(lat, lon, trackDeg, gspeedKt, dt) {
  if (!gspeedKt || gspeedKt < 1) return [lat, lon];
  const delta = (gspeedKt * KT_TO_MS * dt) / R_EARTH;
  const th = trackDeg * D2R, f1 = lat * D2R, l1 = lon * D2R;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(delta) + Math.cos(f1) * Math.sin(delta) * Math.cos(th));
  const l2 = l1 + Math.atan2(
    Math.sin(th) * Math.sin(delta) * Math.cos(f1),
    Math.cos(delta) - Math.sin(f1) * Math.sin(f2)
  );
  return [f2 * R2D, ((l2 * R2D + 540) % 360) - 180];
}

/* =========================================================================
   AIRLINE CODE FROM CALLSIGN
   ========================================================================= */
function airlineCode(callsign) {
  const m = (callsign || '').trim().toUpperCase().match(/^([A-Z]{3})\d/);
  return m ? m[1] : null;
}

/* =========================================================================
   CONTACT STORE
   ========================================================================= */
const contacts = new Map();
let selectedId = null;

function makeIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="ac"><div class="ac-rot"><svg viewBox="0 0 32 32"><use href="#plane"/></svg></div></div>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  });
}

function applyColor(c) {
  if (!c.svgEl) return;
  const color = altColor(c.alt);
  c.svgEl.style.setProperty('--c', color);
  c.svgEl.style.setProperty('--glow', color.replace('rgb', 'rgba').replace(')', ',0.7)'));
}

function upsertContact(f) {
  const id = f.fr24_id;
  if (!id || typeof f.lat !== 'number' || typeof f.lon !== 'number') return;
  let c = contacts.get(id);
  if (!c) {
    const marker = L.marker([f.lat, f.lon], { icon: makeIcon(), keyboard: false }).addTo(map);
    marker.on('click', () => selectContact(id));
    c = { id, trail: [], marker, rotEl: null, svgEl: null, demo: Boolean(f.__demo), enrich: {} };
    contacts.set(id, c);
    marker.bindTooltip('', { className: 'ac-tip', direction: 'top', offset: [0, -12], opacity: 1 });
  }
  c.data = f;
  c.lat = f.lat; c.lon = f.lon;
  c.track = f.track || 0;
  c.gspeed = f.gspeed || 0;
  c.alt = f.alt || 0;
  c.serverTs = f.timestamp ? Date.parse(f.timestamp) : Date.now();

  const el = c.marker.getElement();
  if (el && !c.rotEl) { c.rotEl = el.querySelector('.ac-rot'); c.svgEl = el.querySelector('.ac'); }
  applyColor(c);
  c.marker.setTooltipContent(`<b>${f.callsign || f.flight || '——'}</b> <span>${f.type || ''}</span>`);
  if (id === selectedId) updatePanel(c);
}

function removeContact(id) {
  const c = contacts.get(id);
  if (!c) return;
  map.removeLayer(c.marker);
  if (c.trailLine) trailLayer.removeLayer(c.trailLine);
  contacts.delete(id);
  if (id === selectedId) closePanel();
}

function removeStale(seenIds) {
  for (const id of contacts.keys()) if (!seenIds.has(id) && id !== selectedId) removeContact(id);
  $('contacts').textContent = contacts.size;
}

function clearAllContacts() {
  for (const id of [...contacts.keys()]) removeContact(id);
  trailLayer.clearLayers();
  $('contacts').textContent = '0';
}

/* =========================================================================
   ANIMATION LOOP
   ========================================================================= */
let lastFrame = performance.now();
let trailsOn = true;
let lastEstAt = 0;

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  for (const c of contacts.values()) {
    const [lat, lon] = deadReckon(c.lat, c.lon, c.track, c.gspeed, dt);
    c.lat = lat; c.lon = lon;
    c.marker.setLatLng([lat, lon]);

    if (!c.rotEl) {
      const el = c.marker.getElement();
      if (el) { c.rotEl = el.querySelector('.ac-rot'); c.svgEl = el.querySelector('.ac'); applyColor(c); }
    }
    if (c.rotEl) c.rotEl.style.setProperty('--rot', c.track + 'deg');

    // isolation: hide everything except the selected contact
    const show = !isolate || c.id === selectedId;
    if (c._shown !== show) {
      c._shown = show;
      const el = c.marker.getElement();
      if (el) el.style.display = show ? '' : 'none';
      if (!show && c.trailLine) { trailLayer.removeLayer(c.trailLine); c.trailLine = null; }
    }
    if (!show) continue;

    if (!c._trailAt || now - c._trailAt > 1100) {
      c.trail.push([lat, lon]);
      if (c.trail.length > TRAIL_MAX) c.trail.shift();
      c._trailAt = now;
      c._trailDirty = true;
    }
  }

  renderTrails();
  if (selectedId) {
    const c = contacts.get(selectedId);
    if (c) {
      $('p-pos').textContent = `POS  ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`;
      const age = Math.round((Date.now() - c.serverTs) / 1000);
      $('p-age').textContent = `· age ${isFinite(age) ? age : '—'}s`;
      if (now - lastEstAt > 500) { lastEstAt = now; updateRouteEstimates(c); }
    }
  }
  requestAnimationFrame(frame);
}

function renderTrails() {
  for (const c of contacts.values()) {
    if (!trailsOn || !c._trailDirty) continue;
    c._trailDirty = false;
    if (c.trailLine) trailLayer.removeLayer(c.trailLine);
    if (c.trail.length < 2) continue;
    const sel = c.id === selectedId;
    c.trailLine = L.polyline(c.trail, {
      color: sel ? '#c9700a' : altColor(c.alt),
      weight: sel ? 2.5 : 1.2, opacity: sel ? 0.85 : 0.45, lineCap: 'round', interactive: false,
    }).addTo(trailLayer);
  }
}
requestAnimationFrame(frame);

/* =========================================================================
   SELECTION + TELEMETRY PANEL
   ========================================================================= */
const panel = $('panel');
const airportCache = new Map();

function selectContact(id) {
  if (selectedId) { const p = contacts.get(selectedId); if (p && p.svgEl) p.svgEl.classList.remove('sel'); }
  selectedId = id;
  const c = contacts.get(id);
  if (!c) return;
  if (c.svgEl) c.svgEl.classList.add('sel');
  c._trailDirty = true;
  c.enrich = {};
  c.routeOrigLL = null; c.routeDestLL = null;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  suppressMove++;
  map.panTo([c.lat, c.lon], { animate: true, duration: 0.6 });
  updatePanel(c);
  enrich(c);
  drawRoute(c);
}

function closePanel() {
  if (selectedId) {
    const c = contacts.get(selectedId);
    if (c && c.svgEl) c.svgEl.classList.remove('sel');
    if (c) c._trailDirty = true;
  }
  selectedId = null;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  routeLayer.clearLayers();
  if (isolate || follow) {
    isolate = false; follow = false;
    $('btn-isolate').classList.remove('on');
    $('btn-follow').classList.remove('on');
  }
}

function updatePanel(c) {
  const f = c.data, e = c.enrich || {};
  $('p-callsign').textContent = f.callsign || f.flight || '——————';
  $('p-airline-tag').textContent = e.code || airlineCode(f.callsign) || (f.callsign || '···').slice(0, 3);
  $('p-airline').textContent = e.airline || 'Acquiring…';

  $('p-orig').textContent = e.origCode || f.orig_iata || f.orig_icao || (source === 'adsb' ? '···' : '···');
  $('p-dest').textContent = e.destCode || f.dest_iata || f.dest_icao || (source === 'adsb' ? '···' : '···');

  $('p-alt').textContent = f.alt != null ? (f.__ground ? 'GND' : f.alt.toLocaleString()) : '—';
  $('p-gs').textContent = f.gspeed != null ? f.gspeed : '—';
  $('p-hdg').textContent = f.track != null ? pad(Math.round(f.track)) : '—';

  const vs = f.vspeed || 0;
  $('p-vs').textContent = (vs > 0 ? '+' : '') + vs;
  const vsGauge = $('p-vs').closest('.gauge');
  vsGauge.classList.toggle('climb', vs > 100);
  vsGauge.classList.toggle('descend', vs < -100);

  const typeName = e.typeName || (f.type && TYPES[f.type]);
  $('p-type').textContent = f.type ? (typeName ? `${f.type} · ${typeName}` : f.type) : '—';
  $('p-reg').textContent = f.reg || '—';
  $('p-squawk').textContent = f.squawk || '—';
  $('p-hex').textContent = f.hex || '—';
  $('p-source').textContent = f.source || '—';
  $('p-id').textContent = f.fr24_id || '—';
  $('p-glyph').parentElement.style.color = altColor(f.alt);
  $('p-glyph').style.fill = altColor(f.alt);
  if (e.origName !== undefined) $('p-orig-name').textContent = e.origName;
  if (e.destName !== undefined) $('p-dest-name').textContent = e.destName;
  $('p-orig-wx').textContent = e.origWx || '—';
  $('p-dest-wx').textContent = e.destWx || '—';

  updateRouteEstimates(c);

  // keep the route line's mid-point anchored to the live position
  if (c.routeOrigLL && c.routeDestLL && selectedId === c.id) paintRoute(c.routeOrigLL, [c.lat, c.lon], c.routeDestLL, c.track);
}

async function enrich(c) {
  const f = c.data;
  const code = f.operating_as || f.painted_as || airlineCode(f.callsign);
  c.enrich = c.enrich || {};
  c.enrich.code = code;
  c.enrich.airline = code ? (AIRLINES[code] || code) : (f.__airlineName || 'Unknown operator');
  c.enrich.typeName = f.type ? TYPES[f.type] : null;

  if (c.demo) {
    c.enrich.airline = f.__airlineName || c.enrich.airline;
    c.enrich.origName = f.__origName || '';
    c.enrich.destName = f.__destName || '';
    updatePanel(c); return;
  }
  if (source === 'adsb') {
    c.enrich.origName = 'looking up route…'; c.enrich.destName = '';
    updatePanel(c);
    getRoute(f.callsign).then((rt) => {
      if (selectedId !== c.id) return;
      if (rt && rt.origin && rt.destination) {
        c.enrich.origCode = rt.origin.iata_code; c.enrich.destCode = rt.destination.iata_code;
        c.enrich.origName = apLabel(rt.origin); c.enrich.destName = apLabel(rt.destination);
        if (rt.airline && rt.airline.name) c.enrich.airline = rt.airline.name;
        c.routeOrigLL = [rt.origin.latitude, rt.origin.longitude];
        c.routeDestLL = [rt.destination.latitude, rt.destination.longitude];
        paintRoute(c.routeOrigLL, [c.lat, c.lon], c.routeDestLL, c.track);
        loadRouteWeather(c);
      } else {
        c.enrich.origCode = '—'; c.enrich.destCode = '—';
        c.enrich.origName = 'route not in database'; c.enrich.destName = '';
      }
      updatePanel(c);
    });
    return;
  }
  // FR24: resolve airport names
  c.enrich.origName = 'Origin'; c.enrich.destName = 'Destination';
  updatePanel(c);
  if (f.orig_iata) getAirport(f.orig_iata).then((ap) => {
    if (ap && selectedId === c.id) { c.enrich.origName = apName(ap); updatePanel(c); }
  });
  if (f.dest_iata) getAirport(f.dest_iata).then((ap) => {
    if (ap && selectedId === c.id) { c.enrich.destName = apName(ap); updatePanel(c); }
  });
}

const apName = (ap) => `${ap.city || ''}${ap.city && ap.name ? ' · ' : ''}${ap.name || ''}`.trim();
const apLabel = (ap) => `${ap.municipality || ''}${ap.municipality && ap.name ? ' · ' : ''}${ap.name || ''}`.trim();

async function getRoute(callsign) {
  const cs = (callsign || '').trim().toUpperCase();
  if (!cs) return null;
  if (routeCache.has(cs)) return routeCache.get(cs);
  try {
    const r = await fetch('/api/route?callsign=' + encodeURIComponent(cs));
    const j = r.ok ? await r.json() : null;
    const rt = j && j.response && j.response.flightroute ? j.response.flightroute : null;
    routeCache.set(cs, rt);
    return rt;
  } catch { return null; }
}

async function getAirport(code) {
  if (airportCache.has(code)) return airportCache.get(code);
  try {
    const r = await fetch('/api/airport?code=' + encodeURIComponent(code));
    const j = r.ok ? await r.json() : null;
    airportCache.set(code, j);
    return j;
  } catch { return null; }
}

async function drawRoute(c) {
  routeLayer.clearLayers();
  c.routeOrigLL = null; c.routeDestLL = null;
  const f = c.data;
  if (c.demo) {
    if (f.__origLL && f.__destLL) { c.routeOrigLL = f.__origLL; c.routeDestLL = f.__destLL; paintRoute(f.__origLL, [c.lat, c.lon], f.__destLL, c.track); loadRouteWeather(c); }
    return;
  }
  if (source === 'adsb') return; // handled by enrich() via adsbdb
  const reqId = c.id;
  const [o, d] = await Promise.all([
    f.orig_iata ? getAirport(f.orig_iata) : null,
    f.dest_iata ? getAirport(f.dest_iata) : null,
  ]);
  if (selectedId !== reqId) return;
  if (o && o.lat) c.routeOrigLL = [o.lat, o.lon];
  if (d && d.lat) c.routeDestLL = [d.lat, d.lon];
  paintRoute(c.routeOrigLL, [c.lat, c.lon], c.routeDestLL, c.track);
  loadRouteWeather(c);
}

function paintRoute(oLL, acLL, dLL, track) {
  routeLayer.clearLayers();
  if (oLL) {
    L.polyline([oLL, acLL], { color: '#0e7ea6', weight: 1.5, opacity: 0.6, dashArray: '2 6', interactive: false }).addTo(routeLayer);
    L.circleMarker(oLL, { radius: 4, color: '#0e7ea6', weight: 1.5, fillColor: '#0e7ea6', fillOpacity: 0.25, interactive: false }).addTo(routeLayer);
  }
  if (dLL) {
    // If the live track says the aircraft is flying away from this destination,
    // the callsign→route lookup is almost certainly stale — draw it faint/grey
    // instead of a confident line to an airport the plane is leaving behind.
    const stale = routeStale(oLL, acLL, dLL, track);
    const col = stale ? '#9aa0aa' : '#c9700a';
    L.polyline([acLL, dLL], { color: col, weight: 1.5, opacity: stale ? 0.4 : 0.65, dashArray: stale ? '1 7' : '2 6', interactive: false }).addTo(routeLayer);
    L.circleMarker(dLL, { radius: 4, color: col, weight: 1.5, fillColor: col, fillOpacity: stale ? 0.12 : 0.25, interactive: false }).addTo(routeLayer);
  }
}

// Bearing (deg, 0=N) from point a to point b.
function bearingDeg(a, b) {
  const f1 = a[0] * D2R, f2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}
// Smallest absolute angle between two bearings, 0–180.
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// True when the origin→dest route doesn't fit the live position/track, i.e. the
// callsign route DB is stale (reused callsign). Shared by the line + the ETAs.
function routeStale(oLL, acLL, dLL, track) {
  if (!oLL || !dLL) return false;
  const total = gcNm(oLL, dLL);
  if (total < 5) return false;
  if (gcNm(oLL, acLL) + gcNm(acLL, dLL) > total * 1.3) return true; // off the direct line
  if (track != null && gcNm(acLL, dLL) > 25 && angDiff(track, bearingDeg(acLL, dLL)) > 100) return true; // flying away
  return false;
}

/* ---- weather + estimated times ------------------------------------------ */
const wxCache = new Map();

function gcNm(a, b) {
  const dLa = (b[0] - a[0]) * D2R, dLo = (b[1] - a[1]) * D2R;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.sin(dLo / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s))) / 1852;
}
const zulu = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}<i>z</i>`;
function fmtDur(h) {
  const mins = Math.max(0, Math.round(h * 60));
  return `${Math.floor(mins / 60)}h ${pad(mins % 60)}m`;
}
function wxIcon(code) {
  if (code === 0) return '☀';
  if (code <= 2) return '🌤';
  if (code === 3) return '☁';
  if (code <= 48) return '🌫';
  if (code <= 57) return '🌦';
  if (code <= 67) return '🌧';
  if (code <= 77) return '❄';
  if (code <= 82) return '🌦';
  if (code <= 86) return '🌨';
  return '⛈';
}
const wxText = (cur) => cur ? `${wxIcon(cur.weather_code)} ${Math.round(cur.temperature_2m)}°C` : '—';

async function getWx(lat, lon) {
  const key = lat.toFixed(2) + ',' + lon.toFixed(2);
  if (wxCache.has(key)) return wxCache.get(key);
  try {
    const r = await fetch(`/api/wx?lat=${lat}&lon=${lon}`);
    const j = r.ok ? await r.json() : null;
    const cur = j && j.current ? j.current : null;
    wxCache.set(key, cur);
    return cur;
  } catch { return null; }
}

function loadRouteWeather(c) {
  if (c.routeOrigLL) getWx(c.routeOrigLL[0], c.routeOrigLL[1]).then((w) => {
    if (selectedId === c.id) { c.enrich.origWx = wxText(w); updatePanel(c); }
  });
  if (c.routeDestLL) getWx(c.routeDestLL[0], c.routeDestLL[1]).then((w) => {
    if (selectedId === c.id) { c.enrich.destWx = wxText(w); updatePanel(c); }
  });
}

function updateRouteEstimates(c) {
  const o = c.routeOrigLL, d = c.routeDestLL;
  const plane = $('p-route-plane'), fill = $('p-progress');
  const warn = $('p-route-warn');
  if (!o || !d) {
    fill.style.width = '0%'; plane.style.left = '0%';
    $('p-etd').innerHTML = '--:--<i>z</i>'; $('p-eta').innerHTML = '--:--<i>z</i>';
    $('p-remain').textContent = '—';
    if (warn) warn.hidden = true;
    return;
  }
  const ac = [c.lat, c.lon];
  const flown = gcNm(o, ac), remain = gcNm(ac, d), total = gcNm(o, d);
  const denom = flown + remain;

  // Sanity: if the aircraft isn't actually near the origin→dest line, the route
  // DB entry is stale/mismatched (reused callsign) — don't fabricate times, and
  // flag it so a plane visibly heading away from "its" airport reads as stale data.
  const stale = routeStale(o, ac, d, c.track);
  if (warn) warn.hidden = !stale;
  if (total < 5 || stale) {
    fill.style.width = '0%'; plane.style.left = '0%';
    $('p-etd').innerHTML = '--:--<i>z</i>'; $('p-eta').innerHTML = '--:--<i>z</i>';
    $('p-remain').textContent = '—';
    return;
  }

  const progress = denom > 0 ? clamp(flown / denom, 0, 1) : 0;
  fill.style.width = (progress * 100).toFixed(1) + '%';
  plane.style.left = (progress * 100).toFixed(1) + '%';
  const gs = c.gspeed || (c.data && c.data.gspeed) || 0;
  const now = Date.now();
  if (gs > 50) {
    $('p-eta').innerHTML = zulu(new Date(now + (remain / gs) * 3600e3));
    $('p-etd').innerHTML = zulu(new Date(now - (flown / gs) * 3600e3));
    $('p-remain').textContent = fmtDur(remain / gs);
  } else {
    $('p-eta').innerHTML = '--:--<i>z</i>'; $('p-etd').innerHTML = '--:--<i>z</i>';
    $('p-remain').textContent = Math.round(remain) + ' nm';
  }
}

$('panel-close').addEventListener('click', closePanel);
map.on('click', () => { if (selectedId) closePanel(); });

/* =========================================================================
   DATA SOURCES
   ========================================================================= */
let source = 'adsb';     // 'adsb' | 'fr24' | 'demo'
let altFloor = 0;
let category = '';        // '' | 'jet' | 'ga' | 'heli'
let pollTimer = null, moveTimer = null, inFlight = false;
let isolate = false, follow = false, suppressMove = 0;
const routeCache = new Map();

function setFeed(state, text) {
  $('feed-status').className = 'r-value status feed-' + state;
  $('feed-text').textContent = text;
}

function radiusNm() {
  const b = map.getBounds();
  const m = b.getCenter().distanceTo(b.getNorthEast());
  return clamp(Math.round(m / 1852), 20, 250);
}

function currentBounds() {
  const b = map.getBounds().pad(0.15);
  return [b.getNorth(), b.getSouth(), b.getWest(), b.getEast()].map((n) => n.toFixed(3)).join(',');
}

function passesFilter(f) {
  if (altFloor > 0 && (f.alt || 0) < altFloor) return false;
  if (!category) return true;
  if (source === 'adsb') {
    const cat = f.__adsbCat;
    if (category === 'jet') return ['A3', 'A4', 'A5'].includes(cat) || (f.alt || 0) >= 18000;
    if (category === 'ga') return ['A1', 'A2'].includes(cat) || ((f.alt || 0) < 12000 && (f.gspeed || 0) < 250);
    if (category === 'heli') return cat === 'A7';
  }
  return true;
}

/* ---- ADS-B (adsb.lol) --------------------------------------------------- */
function normalizeAdsb(ac) {
  if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return null;
  const ground = ac.alt_baro === 'ground';
  const alt = ground ? 0 : (typeof ac.alt_baro === 'number' ? ac.alt_baro : (ac.alt_geom || 0));
  const cs = (ac.flight || '').trim();
  const code = airlineCode(cs);
  return {
    fr24_id: ac.hex,
    callsign: cs || ac.r || ac.hex,
    flight: cs,
    lat: ac.lat, lon: ac.lon,
    track: ac.track != null ? ac.track : (ac.true_heading != null ? ac.true_heading : (ac.nav_heading || 0)),
    alt,
    gspeed: ac.gs != null ? Math.round(ac.gs) : 0,
    vspeed: ac.baro_rate != null ? ac.baro_rate : (ac.geom_rate || 0),
    squawk: ac.squawk || null,
    hex: (ac.hex || '').toUpperCase(),
    type: ac.t || null,
    reg: ac.r || null,
    operating_as: code, painted_as: code,
    source: ac.type ? ac.type.replace('adsb_', '').replace('_', '-').toUpperCase() : 'ADSB',
    timestamp: new Date(Date.now() - (ac.seen_pos || 0) * 1000).toISOString(),
    orig_iata: null, dest_iata: null, eta: null,
    __adsbCat: ac.category || null,
    __ground: ground,
  };
}

async function fetchAdsb() {
  const c = map.getCenter();
  const r = await fetch(`/api/adsb?lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&dist=${radiusNm()}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  let ac = Array.isArray(j.ac) ? j.ac : [];
  ac.sort((a, b) => (a.dst || 0) - (b.dst || 0));
  if (ac.length > MAX_CONTACTS) ac = ac.slice(0, MAX_CONTACTS);
  return ac.map(normalizeAdsb).filter(Boolean);
}

/* ---- FR24 --------------------------------------------------------------- */
async function fetchFr24() {
  const params = new URLSearchParams({ bounds: currentBounds() });
  if (altFloor > 0) params.set('altitude_ranges', `${altFloor}-60000`);
  const r = await fetch('/api/flights?' + params.toString());
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return Array.isArray(j.data) ? j.data : [];
}

/* ---- polling ------------------------------------------------------------ */
async function poll() {
  if (source === 'demo' || inFlight) return;
  inFlight = true;
  setFeed('wait', 'SYNC');
  try {
    const list = source === 'adsb' ? await fetchAdsb() : await fetchFr24();
    const seen = new Set();
    for (const f of list) { if (!passesFilter(f)) continue; upsertContact(f); seen.add(f.fr24_id); }
    removeStale(seen);
    if (follow && selectedId && contacts.has(selectedId)) {
      const c = contacts.get(selectedId);
      suppressMove++;
      map.panTo([c.lat, c.lon], { animate: true, duration: 1.0 });
    }
    setFeed('live', source === 'demo' ? 'SIM' : 'LIVE');
  } catch (e) {
    setFeed('err', 'ERR');
    console.warn('[poll]', e.message);
  } finally {
    inFlight = false;
  }
}

function startPolling() { stopPolling(); poll(); pollTimer = setInterval(poll, POLL_MS); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

map.on('moveend', () => {
  if (suppressMove > 0) { suppressMove--; return; }
  if (source === 'demo') { reseedDemoIfNeeded(); return; }
  clearTimeout(moveTimer);
  moveTimer = setTimeout(poll, MOVE_DEBOUNCE);
});

/* =========================================================================
   DEMO TRAFFIC
   ========================================================================= */
const DEMO_AIRLINES = [
  ['BAW', 'British Airways', 'BA'], ['DLH', 'Lufthansa', 'LH'], ['AFR', 'Air France', 'AF'],
  ['UAE', 'Emirates', 'EK'], ['KLM', 'KLM', 'KL'], ['RYR', 'Ryanair', 'FR'],
  ['THY', 'Turkish Airlines', 'TK'], ['SWR', 'SWISS', 'LX'], ['UAL', 'United', 'UA'],
  ['QTR', 'Qatar Airways', 'QR'], ['EZY', 'easyJet', 'U2'], ['SAS', 'SAS', 'SK'],
];
const DEMO_TYPES = ['A320', 'A20N', 'A321', 'A359', 'A388', 'B738', 'B38M', 'B77W', 'B789', 'E190'];
const DEMO_PORTS = [
  ['LHR', 'London', 51.47, -0.4543], ['CDG', 'Paris', 49.01, 2.55], ['FRA', 'Frankfurt', 50.03, 8.57],
  ['AMS', 'Amsterdam', 52.31, 4.76], ['MAD', 'Madrid', 40.49, -3.57], ['IST', 'Istanbul', 41.26, 28.74],
  ['DXB', 'Dubai', 25.25, 55.36], ['JFK', 'New York', 40.64, -73.78], ['BCN', 'Barcelona', 41.30, 2.08],
  ['ZRH', 'Zurich', 47.46, 8.55], ['MUC', 'Munich', 48.35, 11.79], ['CPH', 'Copenhagen', 55.62, 12.65],
];
let demoSeq = 1000, demoSeed = 7;
const rnd = () => { demoSeed = (demoSeed * 16807) % 2147483647; return (demoSeed - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

function spawnDemo(b) {
  const al = pick(DEMO_AIRLINES), type = pick(DEMO_TYPES);
  let o = pick(DEMO_PORTS), d = pick(DEMO_PORTS);
  while (d === o) d = pick(DEMO_PORTS);
  const lat = b.getSouth() + rnd() * (b.getNorth() - b.getSouth());
  const lon = b.getWest() + rnd() * (b.getEast() - b.getWest());
  const num = Math.floor(100 + rnd() * 8900);
  const rr = () => String.fromCharCode(65 + Math.floor(rnd() * 26));
  return {
    fr24_id: 'demo' + (demoSeq++), __demo: true,
    flight: al[2] + num, callsign: al[0] + num, operating_as: al[0], painted_as: al[0],
    __airlineName: al[1], type, reg: 'D-' + rr() + rr() + rr() + rr(),
    lat, lon, track: Math.floor(rnd() * 360),
    alt: Math.round((2000 + rnd() * 39000) / 500) * 500,
    gspeed: Math.round(360 + rnd() * 220), vspeed: Math.round((rnd() - 0.5) * 600),
    squawk: String(Math.floor(rnd() * 7777)).padStart(4, '0'),
    hex: Math.floor(rnd() * 0xffffff).toString(16).toUpperCase().padStart(6, '0'),
    source: 'SIM', orig_iata: o[0], dest_iata: d[0],
    __origName: o[1], __destName: d[1], __origLL: [o[2], o[3]], __destLL: [d[2], d[3]],
    eta: new Date(Date.now() + (1 + rnd() * 4) * 3600e3).toISOString(),
    timestamp: new Date().toISOString(),
  };
}

function startDemo() {
  const b = map.getBounds().pad(0.1);
  for (let i = 0; i < DEMO_FLEET; i++) upsertContact(spawnDemo(b));
  $('contacts').textContent = contacts.size;
  setFeed('live', 'SIM');
}

function reseedDemoIfNeeded() {
  if (source !== 'demo') return;
  const view = map.getBounds(), big = view.pad(0.6);
  let inView = 0;
  for (const [id, c] of contacts) {
    if (!big.contains([c.lat, c.lon])) removeContact(id);
    else if (view.contains([c.lat, c.lon])) inView++;
  }
  const b = view.pad(0.1);
  while (inView < DEMO_FLEET) { upsertContact(spawnDemo(b)); inView++; }
  $('contacts').textContent = contacts.size;
}

/* =========================================================================
   SOURCE SWITCHING
   ========================================================================= */
const SRC_META = {
  adsb: { badge: 'ADS-B·LIVE', cls: 'adsb', note: 'Real live traffic · <b>adsb.lol</b> · free' },
  fr24: { badge: 'FR24·SANDBOX', cls: 'fr24', note: 'FR24 sandbox · <b>1 sample flight</b> · upgrade key for live' },
  demo: { badge: 'DEMO·TRAFFIC', cls: 'demo', note: 'Simulated fleet · <b>preview only</b>' },
};

function setSource(src) {
  source = src;
  closePanel();
  stopPolling();
  clearAllContacts();
  const meta = SRC_META[src];
  const badge = $('mode-badge');
  badge.textContent = meta.badge;
  badge.className = meta.cls;
  $('src-note').innerHTML = meta.note;
  if (src === 'demo') startDemo();
  else startPolling();
}

/* =========================================================================
   UI WIRING
   ========================================================================= */
function tick() {
  const d = new Date();
  $('clock').textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
setInterval(tick, 1000); tick();

$('alt-floor').addEventListener('input', (e) => {
  altFloor = +e.target.value;
  $('alt-floor-val').textContent = altFloor === 0 ? 'ANY' : (altFloor / 1000) + 'k';
});
$('alt-floor').addEventListener('change', () => { if (source !== 'demo') poll(); });

$('cat-seg').addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  [...$('cat-seg').children].forEach((b) => b.classList.toggle('active', b === btn));
  category = btn.dataset.cat || '';
  if (source !== 'demo') poll(); else reseedDemoIfNeeded();
});

$('src-seg').addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn || btn.classList.contains('disabled')) return;
  [...$('src-seg').children].forEach((b) => b.classList.toggle('active', b === btn));
  setSource(btn.dataset.src);
});

$('trail-toggle').addEventListener('change', (e) => {
  trailsOn = e.target.checked;
  if (!trailsOn) { trailLayer.clearLayers(); for (const c of contacts.values()) c.trailLine = null; }
});

/* ---- search ------------------------------------------------------------- */
const searchEl = $('search'), resultsEl = $('search-results');

function localMatches(q) {
  q = q.toUpperCase();
  const out = [];
  for (const c of contacts.values()) {
    const f = c.data;
    const hay = [f.callsign, f.flight, f.reg, f.hex].filter(Boolean).join(' ').toUpperCase();
    if (hay.includes(q)) out.push(c);
    if (out.length >= 8) break;
  }
  return out;
}

const fmtAlt = (f) => f.__ground ? 'GND' : (f.alt ? (Math.round(f.alt / 100) * 100).toLocaleString() + 'ft' : '—');

function renderSearch() {
  const q = searchEl.value.trim();
  $('search-clear').style.display = q ? 'grid' : 'none';
  if (!q) { resultsEl.classList.remove('show'); resultsEl.innerHTML = ''; return; }
  const m = localMatches(q);
  let html = m.map((c) => {
    const f = c.data;
    return `<button class="sr" data-id="${c.id}"><b>${f.callsign || f.flight || '—'}</b>` +
      `<span>${(f.type || '')} ${(f.reg || '')}</span><i>${fmtAlt(f)}</i></button>`;
  }).join('');
  html += `<button class="sr global" data-global="1"><b>⌖</b> Search worldwide for “${q.toUpperCase()}”</button>`;
  resultsEl.innerHTML = html;
  resultsEl.classList.add('show');
}

function focusContact(id) {
  if (!contacts.has(id)) return;
  selectContact(id);
  suppressMove++;
  const c = contacts.get(id);
  map.setView([c.lat, c.lon], Math.max(map.getZoom(), 8), { animate: true });
  resultsEl.classList.remove('show');
}

function activateSource(src) {
  [...$('src-seg').children].forEach((b) => b.classList.toggle('active', b.dataset.src === src));
  setSource(src);
}

async function commitSearch() {
  const q = searchEl.value.trim();
  if (!q) return;
  const local = localMatches(q);
  if (local.length) { focusContact(local[0].id); return; }
  setFeed('wait', 'FIND');
  try {
    const r = await fetch('/api/find?q=' + encodeURIComponent(q));
    const j = await r.json();
    if (j.ac && j.ac.length) {
      const f = normalizeAdsb(j.ac[0]);
      if (f) {
        if (source !== 'adsb') activateSource('adsb');   // keep it live-tracked
        suppressMove++;
        map.setView([f.lat, f.lon], 8, { animate: false });
        upsertContact(f);
        focusContact(f.fr24_id);
        setTimeout(() => { if (source !== 'demo') poll(); }, 150);
      }
    } else {
      resultsEl.innerHTML = `<div class="none">No live ADS-B contact for “${q.toUpperCase()}”.<br>It may not be airborne, or it's flying over an area with no community ADS-B receivers (coverage is sparse over parts of the Middle East, Africa and oceans). Try again once it enters covered airspace.</div>`;
      resultsEl.classList.add('show');
    }
  } catch { /* ignore */ }
  setFeed('live', source === 'demo' ? 'SIM' : 'LIVE');
}

searchEl.addEventListener('input', renderSearch);
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitSearch(); }
  else if (e.key === 'Escape') { e.stopPropagation(); searchEl.value = ''; renderSearch(); searchEl.blur(); }
});
$('search-clear').addEventListener('click', () => { searchEl.value = ''; renderSearch(); searchEl.focus(); });
resultsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  if (btn.dataset.global) commitSearch();
  else if (btn.dataset.id) focusContact(btn.dataset.id);
});
document.addEventListener('click', (e) => { if (!e.target.closest('.hud-search')) resultsEl.classList.remove('show'); });

/* ---- isolate / follow --------------------------------------------------- */
$('btn-isolate').addEventListener('click', () => {
  isolate = !isolate;
  $('btn-isolate').classList.toggle('on', isolate);
});
$('btn-follow').addEventListener('click', () => {
  follow = !follow;
  $('btn-follow').classList.toggle('on', follow);
  if (follow && selectedId && contacts.has(selectedId)) {
    suppressMove++;
    const c = contacts.get(selectedId);
    map.panTo([c.lat, c.lon], { animate: true });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement !== searchEl) closePanel();
});

/* =========================================================================
   BOOT
   ========================================================================= */
function boot() {
  const el = document.createElement('div');
  el.className = 'boot';
  el.innerHTML = `<div class="b-ring"></div>ACQUIRING SURVEILLANCE FEED`;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 700); }, 1400);
  setSource('adsb'); // default: real, free data
  // If the host has no FR24 token (e.g. a public deploy), disable that tab.
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    if (!cfg.hasToken) {
      const b = [...$('src-seg').children].find((x) => x.dataset.src === 'fr24');
      if (b) { b.classList.add('disabled'); b.title = 'Add an FR24 token on the server to enable'; }
    }
  }).catch(() => {});
}
boot();
