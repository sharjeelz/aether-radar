/**
 * ÆTHER RADAR — local server
 * - Serves the static UI from /public
 * - Proxies the Flightradar24 API so the token stays server-side
 * - Caches static airline/airport lookups to conserve API credits
 *
 * Zero dependencies. Requires Node 18+ (uses the global fetch).
 *   node server.js   ->   http://localhost:8787
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Minimal .env loader (no dotenv dependency)
// ---------------------------------------------------------------------------
function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}
loadEnv();

const TOKEN = process.env.FR24_TOKEN || '';
const BASE = (process.env.FR24_BASE || 'https://fr24api.flightradar24.com/api').replace(/\/$/, '');
const PORT = parseInt(process.env.PORT || '8787', 10);

if (!TOKEN) {
  console.warn('\x1b[33m[warn]\x1b[0m FR24_TOKEN is not set. Live data will fail; use DEMO mode in the UI.');
}

const FR24_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/json',
  'Accept-Version': 'v1',
};

// ---------------------------------------------------------------------------
// Tiny TTL cache
// ---------------------------------------------------------------------------
const cache = new Map();
const cacheGet = (k, ttl) => {
  const e = cache.get(k);
  if (e && Date.now() - e.t < ttl) return e.v;
  if (e) cache.delete(k);
  return null;
};
const cacheSet = (k, v) => cache.set(k, { t: Date.now(), v });
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// FR24 fetch helper
// ---------------------------------------------------------------------------
async function fr24(endpoint, query) {
  const url = new URL(BASE + endpoint);
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: FR24_HEADERS });
  const body = await res.text();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
const sendJSON = (res, status, obj) => {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(s);
};
const sendRaw = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
};

// ---------------------------------------------------------------------------
// API routes (our own namespace, /api/*)
// ---------------------------------------------------------------------------
async function handleApi(pathname, url, res) {
  const q = Object.fromEntries(url.searchParams);

  if (pathname === '/api/config') {
    return sendJSON(res, 200, { hasToken: Boolean(TOKEN), base: BASE });
  }

  if (pathname === '/api/flights') {
    if (!q.bounds) return sendJSON(res, 400, { error: 'bounds parameter required' });
    const allow = ['bounds', 'altitude_ranges', 'categories', 'limit', 'airports', 'airlines', 'gspeed'];
    const query = {};
    for (const k of allow) if (q[k]) query[k] = q[k];
    const r = await fr24('/live/flight-positions/full', query);
    return sendRaw(res, r.status, r.body);
  }

  if (pathname === '/api/airline') {
    const code = (q.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return sendJSON(res, 400, { error: 'code required' });
    const key = 'al:' + code;
    const hit = cacheGet(key, DAY);
    if (hit) return sendRaw(res, 200, hit);
    const r = await fr24(`/static/airlines/${encodeURIComponent(code)}/light`);
    if (r.status === 200) cacheSet(key, r.body);
    return sendRaw(res, r.status, r.body);
  }

  if (pathname === '/api/airport') {
    const code = (q.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return sendJSON(res, 400, { error: 'code required' });
    const light = q.light === '1';
    const key = (light ? 'apL:' : 'ap:') + code;
    const hit = cacheGet(key, DAY);
    if (hit) return sendRaw(res, 200, hit);
    const r = await fr24(`/static/airports/${encodeURIComponent(code)}/${light ? 'light' : 'full'}`);
    if (r.status === 200) cacheSet(key, r.body);
    return sendRaw(res, r.status, r.body);
  }

  if (pathname === '/api/summary') {
    const id = (q.id || '').replace(/[^a-zA-Z0-9,]/g, '');
    if (!id) return sendJSON(res, 400, { error: 'id required' });
    const r = await fr24('/flight-summary/light', { flight_ids: id });
    return sendRaw(res, r.status, r.body);
  }

  if (pathname === '/api/adsb') {
    const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
    if (!isFinite(lat) || !isFinite(lon)) return sendJSON(res, 400, { error: 'lat/lon required' });
    let dist = parseInt(q.dist || '120', 10);
    dist = Math.max(1, Math.min(250, isFinite(dist) ? dist : 120));
    try {
      const r = await fetch(`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`, {
        headers: { 'User-Agent': 'aether-radar/1.0 (personal local use)', Accept: 'application/json' },
      });
      const body = await r.text();
      return sendRaw(res, r.status, body);
    } catch (e) {
      return sendJSON(res, 502, { error: 'adsb.lol unreachable', detail: String((e && e.message) || e) });
    }
  }

  if (pathname === '/api/route') {
    const cs = (q.callsign || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cs) return sendJSON(res, 400, { error: 'callsign required' });
    const key = 'rt:' + cs;
    const hit = cacheGet(key, 6 * 3600 * 1000);
    if (hit) return sendRaw(res, 200, hit);
    try {
      const r = await fetch('https://api.adsbdb.com/v0/callsign/' + encodeURIComponent(cs), {
        headers: { 'User-Agent': 'aether-radar/1.0 (personal)', Accept: 'application/json' },
      });
      const body = await r.text();
      if (r.status === 200) cacheSet(key, body);
      return sendRaw(res, r.status, body);
    } catch (e) {
      return sendJSON(res, 502, { error: 'adsbdb unreachable' });
    }
  }

  if (pathname === '/api/wx') {
    const lat = parseFloat(q.lat), lon = parseFloat(q.lon);
    if (!isFinite(lat) || !isFinite(lon)) return sendJSON(res, 400, { error: 'lat/lon required' });
    const key = `wx:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = cacheGet(key, 10 * 60 * 1000); // 10 min
    if (hit) return sendRaw(res, 200, hit);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=celsius&wind_speed_unit=kmh`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      const body = await r.text();
      if (r.status === 200) cacheSet(key, body);
      return sendRaw(res, r.status, body);
    } catch (e) {
      return sendJSON(res, 502, { error: 'open-meteo unreachable' });
    }
  }

  if (pathname === '/api/find') {
    const raw = (q.q || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!raw) return sendJSON(res, 400, { error: 'q required' });
    const tries = ['callsign/' + raw, 'registration/' + raw, 'hex/' + raw.toLowerCase()];
    for (const t of tries) {
      try {
        const r = await fetch('https://api.adsb.lol/v2/' + t, {
          headers: { 'User-Agent': 'aether-radar/1.0 (personal)', Accept: 'application/json' },
        });
        if (r.status === 200) {
          const j = JSON.parse(await r.text());
          if (j && Array.isArray(j.ac) && j.ac.length) return sendJSON(res, 200, j);
        }
      } catch { /* try next */ }
    }
    return sendJSON(res, 200, { ac: [] });
  }

  if (pathname === '/api/usage') {
    const r = await fr24('/usage', { period: q.period || '24h' });
    return sendRaw(res, r.status, r.body);
  }

  return sendJSON(res, 404, { error: 'unknown endpoint' });
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const PUBLIC = path.join(__dirname, 'public');

function serveStatic(pathname, res) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // prevent path traversal
  const filePath = path.normalize(path.join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(url.pathname, url, res);
    } else {
      serveStatic(url.pathname, res);
    }
  } catch (e) {
    sendJSON(res, 502, { error: 'proxy error', detail: String((e && e.message) || e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  \x1b[36mÆTHER RADAR\x1b[0m  ready`);
  console.log(`  → \x1b[1mhttp://localhost:${PORT}\x1b[0m`);
  console.log(`  token: ${TOKEN ? '\x1b[32mloaded\x1b[0m (sandbox)' : '\x1b[31mmissing\x1b[0m'}\n`);
});
