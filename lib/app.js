// DropMyBeats — HTTP app (Express). Used by server.js locally and as the Vercel Function.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const core = require('./core');
const { createStore, StoreError } = require('./store');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const SEARCH_MOCK = process.env.SEARCH_MOCK === '1';
const ON_VERCEL = !!process.env.VERCEL;

const store = createStore();
let notifier = null; // set by server.js when Socket.IO push is available
const setNotifier = (fn) => { notifier = fn; };
const notify = (ev) => { if (notifier && ev) try { notifier(ev); } catch (e) { console.warn('notify failed', e); } };

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '50kb' }));
// Locally Express serves the files; on Vercel the CDN serves public/** and this line is ignored
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Express 4 doesn't catch promise rejections, so wrap async handlers
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const codeOf = (req) => String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

/* ---------------------------- helpers ---------------------------- */
function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && !/^169\.254/.test(ni.address)) return ni.address;
    }
  }
  return 'localhost';
}
function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  let host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  // Phones can't reach "localhost": swap in this computer's Wi-Fi/LAN address
  host = host.replace(/^(localhost|127\.0\.0\.1|\[::1\])/, lanIp());
  return `${proto}://${host}`;
}

const rate = new Map();
function limited(key, max, windowMs = 60000) {
  const now = Date.now();
  const arr = (rate.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rate.set(key, arr);
  if (rate.size > 5000) rate.delete(rate.keys().next().value);
  return arr.length > max;
}

const noStore = (res) => res.set('Cache-Control', 'no-store');
// Shared state: let Vercel's CDN answer most polls for ~2s so hundreds of phones cost almost nothing
function cdnShort(res) {
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  res.set('Vercel-CDN-Cache-Control', 'public, s-maxage=2, stale-while-revalidate=2');
}

// Run the TimeBomb when someone reads the event (Vercel has no background timer)
async function loadEvent(code) {
  let ev = await store.getEvent(code);
  if (ev && core.needsTick(ev)) {
    const out = await store.updateEvent(code, (e) => (core.tick(e) ? { ok: true } : { skipSave: true }));
    if (out.ev) { ev = out.ev; notify(ev); }
  }
  return ev;
}

// Static pages, read from disk (local) or from our own CDN (Vercel)
const pageCache = new Map();
async function readPage(name, req) {
  if (pageCache.has(name)) return pageCache.get(name);
  let html;
  try {
    // Literal paths so Vercel's bundler includes these files in the Function
    const files = {
      'index.html': () => fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'),
      'event.html': () => fs.readFileSync(path.join(__dirname, '..', 'public', 'event.html'), 'utf8'),
      'dj.html': () => fs.readFileSync(path.join(__dirname, '..', 'public', 'dj.html'), 'utf8'),
      'screen.html': () => fs.readFileSync(path.join(__dirname, '..', 'public', 'screen.html'), 'utf8'),
    };
    html = files[name]();
  } catch {
    const r = await fetch(`${baseUrl(req)}/${name}`);
    if (!r.ok) throw new StoreError('Page not found', 404);
    html = await r.text();
  }
  if (ON_VERCEL || process.env.NODE_ENV === 'production') pageCache.set(name, html);
  return html;
}

/* ---------------------------- pages ---------------------------- */
const escAttr = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

app.get('/', h(async (req, res) => res.type('html').send(await readPage('index.html', req))));

app.get('/e/:code', h(async (req, res) => {
  // Inject link-preview tags so WhatsApp / Instagram show the event poster or logo
  let html = await readPage('event.html', req);
  let ev = null;
  try { ev = await store.getEvent(codeOf(req)); } catch { /* still serve the page */ }
  if (ev) {
    const base = baseUrl(req);
    const img = ev.posterUrl || ev.logoUrl || '/img/icon-512.png';
    const title = `${ev.name}${ev.djName ? ' with ' + ev.djName : ''}`;
    const desc = `Request your songs for ${ev.name}${ev.venue ? ' at ' + ev.venue : ''} on DropMyBeats.`;
    const tags = [
      '<meta property="og:type" content="website">',
      `<meta property="og:title" content="${escAttr(title)}">`,
      `<meta property="og:description" content="${escAttr(desc)}">`,
      `<meta property="og:image" content="${escAttr(base + img)}">`,
      `<meta property="og:url" content="${escAttr(base + '/e/' + ev.code)}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="description" content="${escAttr(desc)}">`,
    ].join('\n');
    html = html.replace('</head>', tags + '\n</head>').replace('<title>DropMyBeats</title>', `<title>${escAttr(ev.name)} · DropMyBeats</title>`);
  }
  res.type('html').set('Cache-Control', 'public, max-age=0, must-revalidate').set('Vercel-CDN-Cache-Control', 'public, s-maxage=60').send(html);
}));
app.get('/dj/:code', h(async (req, res) => res.type('html').set('X-Robots-Tag', 'noindex').send(await readPage('dj.html', req))));
app.get('/screen/:code', h(async (req, res) => res.type('html').send(await readPage('screen.html', req))));

/* ---------------------------- API ---------------------------- */
app.get('/api/config', (req, res) => {
  noStore(res).json({ realtime: notifier ? 'socket' : 'poll', storage: store.kind });
});

app.get('/api/currencies', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').json(core.currencyList());
});

// Create an event → the creator becomes Admin
app.post('/api/events', h(async (req, res) => {
  if (limited('create:' + req.ip, 10)) return res.status(429).json({ error: 'Too many new events, wait a minute' });
  if (!core.clean(req.body.name, 60)) return res.status(400).json({ error: 'Event name is required' });
  const ev = await store.createEvent((code) => core.createEvent(code, req.body || {}));
  noStore(res).json({ code: ev.code, adminKey: ev.adminKey });
}));

app.get('/api/events/:code', h(async (req, res) => {
  const ev = await store.getEvent(codeOf(req));
  if (!ev) return noStore(res).status(404).json({ error: 'Event not found' });
  noStore(res).json({ code: ev.code, name: ev.name, djName: ev.djName, venue: ev.venue, status: ev.status, logoUrl: ev.logoUrl || '', posterUrl: ev.posterUrl || '' });
}));

// Public live state: the same for every guest, so it can be cached
app.get('/api/events/:code/state', h(async (req, res) => {
  const ev = await loadEvent(codeOf(req));
  if (!ev) return noStore(res).status(404).json({ error: 'Event not found' });
  cdnShort(res);
  res.json(core.viewState(ev));
}));

// DJ / manager state (never cached)
app.get('/api/events/:code/dj', h(async (req, res) => {
  noStore(res);
  const key = String(req.get('x-dmb-key') || '');
  const ev = await loadEvent(codeOf(req));
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const role = core.roleFor(ev, key);
  if (!role) {
    if (limited('auth:' + req.ip, 10)) return res.status(429).json({ error: 'Too many attempts, wait a minute' });
    return res.status(403).json({ error: 'Wrong PIN or admin key' });
  }
  res.json({ role, state: core.viewState(ev, true) });
}));

// Every change (request, like, tip, DJ action, settings) goes through here
app.post('/api/events/:code/act', h(async (req, res) => {
  noStore(res);
  const code = codeOf(req);
  const { type, data = {} } = req.body || {};
  const key = String(req.get('x-dmb-key') || '');
  const userId = core.clean(req.body.userId, 40);
  const name = core.clean(req.body.name, 30);
  if (typeof type !== 'string') return res.status(400).json({ error: 'Missing action' });

  const isGuestAction = !/^(dj|admin):/.test(type);
  if (isGuestAction && !userId) return res.status(400).json({ error: 'Join the event first' });
  if (type === 'request' && limited('req:' + code + ':' + userId, 12)) return res.status(429).json({ error: 'Slow down a little, try again in a minute' });
  if (limited('act:' + req.ip, 240)) return res.status(429).json({ error: 'Too many actions, wait a moment' });

  let role = 'guest';
  const out = await store.updateEvent(code, (ev) => {
    role = isGuestAction ? 'guest' : core.roleFor(ev, key);
    const found = core.findAction(type, role);
    if (found.error) return { error: found.error, status: found.status };
    return found.fn(ev, { role, userId, name }, data && typeof data === 'object' ? data : {});
  });
  const { ev, result } = out;
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  notify(ev);
  const dj = role === 'admin' || role === 'manager';
  res.json({ ...result, userHash: dj ? undefined : core.userHash(ev, userId), state: core.viewState(ev, dj) });
}));

app.get('/api/events/:code/link', h(async (req, res) => {
  const ev = await store.getEvent(codeOf(req));
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  noStore(res).json({ url: `${baseUrl(req)}/e/${ev.code}` });
}));

app.get('/api/events/:code/qr.svg', h(async (req, res) => {
  const code = codeOf(req);
  const svg = await QRCode.toString(`${baseUrl(req)}/e/${code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=300').send(svg);
}));

app.get('/api/events/:code/qr.png', h(async (req, res) => {
  const code = codeOf(req);
  const buf = await QRCode.toBuffer(`${baseUrl(req)}/e/${code}`, { width: 1024, margin: 2 });
  res.type('png').set('Content-Disposition', `attachment; filename="DropMyBeats-${code}-QR.png"`).send(buf);
}));

/* ----------------------- Event logo & poster ----------------------- */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}
const mediaName = (url) => (url && url.startsWith('/media/') ? path.basename(url) : '');

// Vercel accepts request bodies up to 4.5 MB; the browser shrinks images well below that
app.post('/api/events/:code/media/:kind', express.raw({ type: () => true, limit: '4mb' }), h(async (req, res) => {
  noStore(res);
  const code = codeOf(req);
  const kind = req.params.kind;
  if (!['logo', 'poster'].includes(kind)) return res.status(400).json({ error: 'Unknown image type' });
  const ext = sniffImage(req.body);
  if (!ext) return res.status(400).json({ error: 'Please upload a PNG, JPG, WebP or GIF image' });
  const ev0 = await store.getEvent(code);
  if (!ev0) return res.status(404).json({ error: 'Event not found' });
  if (core.roleFor(ev0, req.get('x-admin-key')) !== 'admin') return res.status(403).json({ error: 'Only the event admin can change branding' });
  const name = `${code}-${kind}-${core.id(5)}.${ext}`;
  await store.putMedia(name, req.body);
  let old = '';
  const { ev, result } = await store.updateEvent(code, (e) => { old = mediaName(e[kind + 'Url']); e[kind + 'Url'] = '/media/' + name; return { ok: true }; });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  if (old) store.delMedia(old).catch(() => {});
  notify(ev);
  res.json({ ok: true, url: ev[kind + 'Url'] });
}));

app.delete('/api/events/:code/media/:kind', h(async (req, res) => {
  noStore(res);
  const code = codeOf(req);
  const kind = req.params.kind;
  if (!['logo', 'poster'].includes(kind)) return res.status(400).json({ error: 'Unknown image type' });
  let old = '';
  const { ev, result } = await store.updateEvent(code, (e) => {
    if (core.roleFor(e, req.get('x-admin-key')) !== 'admin') return { error: 'Only the event admin can change branding', status: 403 };
    old = mediaName(e[kind + 'Url']);
    e[kind + 'Url'] = '';
    return { ok: true };
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  if (old) store.delMedia(old).catch(() => {});
  notify(ev);
  res.json({ ok: true });
}));

// Uploaded files never change (each upload gets a new name), so cache them for a year
app.get('/media/:name', h(async (req, res) => {
  const m = await store.getMedia(path.basename(req.params.name));
  if (!m) return res.status(404).end();
  res.type(m.type).set('Cache-Control', 'public, max-age=31536000, immutable').send(m.buf);
}));

/* ---------------------------- Song search --------------------------- */
const searchCache = new Map();
async function fetchJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'DropMyBeats/1.0' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}
async function searchItunes(q, country) {
  const u = `https://itunes.apple.com/search?media=music&entity=song&limit=25&country=${encodeURIComponent(country)}&term=${encodeURIComponent(q)}`;
  const j = await fetchJson(u);
  return (j.results || []).map((t) => ({
    source: 'itunes',
    sourceId: String(t.trackId),
    title: t.trackName,
    artist: t.artistName,
    album: t.collectionName,
    artwork: (t.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
    previewUrl: t.previewUrl || '',
    duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : 0,
    explicit: t.trackExplicitness === 'explicit',
    year: t.releaseDate ? t.releaseDate.slice(0, 4) : '',
    trackUrl: t.trackViewUrl || '',
  }));
}
async function searchDeezer(q) {
  const j = await fetchJson(`https://api.deezer.com/search?limit=25&q=${encodeURIComponent(q)}`);
  return (j.data || []).map((t) => ({
    source: 'deezer',
    sourceId: String(t.id),
    title: t.title,
    artist: t.artist && t.artist.name,
    album: t.album && t.album.title,
    artwork: (t.album && (t.album.cover_medium || t.album.cover)) || '',
    previewUrl: t.preview || '',
    duration: t.duration || 0,
    explicit: !!t.explicit_lyrics,
    year: '',
    trackUrl: t.link || '',
  }));
}
const MOCK = [
  ['Kesariya', 'Arijit Singh', 'Brahmastra'], ['Naatu Naatu', 'Rahul Sipligunj & Kaala Bhairava', 'RRR'],
  ['Blinding Lights', 'The Weeknd', 'After Hours'], ['Levitating', 'Dua Lipa', 'Future Nostalgia'],
  ['Jhoome Jo Pathaan', 'Arijit Singh & Sukriti Kakar', 'Pathaan'], ['Butta Bomma', 'Armaan Malik', 'Ala Vaikunthapurramuloo'],
  ['One Dance', 'Drake', 'Views'], ['Despacito', 'Luis Fonsi', 'Vida'], ['Tum Hi Ho', 'Arijit Singh', 'Aashiqui 2'],
  ['Calm Down', 'Rema & Selena Gomez', 'Rave & Roses'], ['Srivalli', 'Sid Sriram', 'Pushpa'], ['Shape of You', 'Ed Sheeran', '÷'],
];
function searchMock(q) {
  const n = core.norm(q);
  return MOCK.filter(([t, a]) => core.norm(t + ' ' + a).includes(n) || n.split(' ').some((w) => w && core.norm(t + ' ' + a).includes(w)))
    .map(([title, artist, album], i) => ({
      source: 'mock', sourceId: 'm' + i, title, artist, album,
      artwork: '', previewUrl: '', duration: 200 + i * 7, explicit: false, year: '', trackUrl: '',
    }));
}

app.get('/api/search', h(async (req, res) => {
  const q = core.clean(req.query.q, 100);
  const country = /^[a-z]{2}$/i.test(req.query.country || '') ? req.query.country : 'IN';
  if (q.length < 2) return res.json({ results: [] });
  const key = country + '|' + q.toLowerCase();
  const hit = searchCache.get(key);
  let results = [];
  let source = 'none';
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) ({ results, source } = hit);
  else if (SEARCH_MOCK) { results = searchMock(q); source = 'mock'; }
  else {
    try { results = await searchItunes(q, country); source = 'itunes'; } catch (e) { console.warn('iTunes search failed:', e.message); }
    if (!results.length) {
      try { results = await searchDeezer(q); source = 'deezer'; } catch (e) { console.warn('Deezer search failed:', e.message); }
    }
    const seen = new Set();
    results = results.filter((r) => {
      const k = core.norm(r.title) + '|' + core.norm(r.artist);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (results.length) {
      searchCache.set(key, { at: Date.now(), results, source });
      if (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value);
    }
  }
  if (results.length) res.set('Vercel-CDN-Cache-Control', 'public, s-maxage=86400');
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ results, source, offline: !results.length && !SEARCH_MOCK });
}));

/* ---------------------------- errors ---------------------------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Image is too large (max 4 MB)' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  noStore(res).status(status).json({ error: err instanceof StoreError ? err.message : 'Something went wrong' });
});

module.exports = { app, store, setNotifier, core, baseUrl, lanIp };
