// DropMyBeats — real-time song requests for DJ events
// Run: npm install && npm start   →  http://localhost:3000
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'events.json');
const SEARCH_MOCK = process.env.SEARCH_MOCK === '1';
const UPLOAD_DIR = path.join(path.dirname(DATA_FILE), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Storage (simple JSON file — no database needed)                     */
/* ------------------------------------------------------------------ */
let db = { events: {} };
try {
  if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  console.warn('Could not read data file, starting fresh:', e.message);
}
// Older events: fill in currency code
for (const ev of Object.values(db.events || {})) {
  if (ev.settings && !ev.settings.currencyCode) {
    const bySymbol = { '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP' };
    ev.settings.currencyCode = bySymbol[String(ev.settings.currency || '₹').trim()] || 'INR';
  }
  // Old default quick-picks are no longer preset; guests type their own amount
  if (ev.settings && JSON.stringify(ev.settings.tipAmounts) === '[50,100,200,500]') ev.settings.tipAmounts = [];
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DATA_FILE);
  }, 300);
}

const id = (n = 8) => crypto.randomBytes(n).toString('hex');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do {
    c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (db.events[c]);
  return c;
}
const clean = (s, max = 80) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const norm = (s) => clean(s, 200).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9ऀ-෿]+/g, ' ').trim();

// Currencies the admin can pick from (symbol shown to guests; "unit" = what counts as one boost step)
const CURRENCIES = {
  INR: { symbol: '₹', unit: 100 }, USD: { symbol: '$', unit: 5 }, EUR: { symbol: '€', unit: 5 },
  GBP: { symbol: '£', unit: 5 }, AED: { symbol: 'AED ', unit: 20 }, SGD: { symbol: 'S$', unit: 5 },
  AUD: { symbol: 'A$', unit: 5 }, CAD: { symbol: 'C$', unit: 5 }, CHF: { symbol: 'CHF ', unit: 5 },
  JPY: { symbol: '¥', unit: 500 }, LKR: { symbol: 'Rs ', unit: 300 }, NPR: { symbol: 'Rs ', unit: 150 },
  BDT: { symbol: '৳', unit: 100 }, SAR: { symbol: 'SAR ', unit: 20 }, QAR: { symbol: 'QAR ', unit: 20 },
  MYR: { symbol: 'RM', unit: 20 }, THB: { symbol: '฿', unit: 150 }, ZAR: { symbol: 'R', unit: 80 },
};
function applyCurrency(s, code) {
  const c = CURRENCIES[code] ? code : 'INR';
  s.currencyCode = c;
  s.currency = CURRENCIES[c].symbol;
}
const MAX_TIP = 1000000;

const DEFAULT_SETTINGS = {
  tipsEnabled: true,
  tipAmounts: [],            // optional quick-pick amounts; guests can always type their own
  currencyCode: 'INR',
  currency: '₹',
  upiId: '',
  upiName: '',
  timeBombEnabled: true,
  timeBombMinutes: 30,       // a request explodes if not played within this time
  defuseLikes: 10,           // ...unless it collects this many likes (0 = never defuse)
  maxOpenRequestsPerUser: 3,
  requestsOpen: true,
  allowExplicit: true,
};

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
function getEvent(code) {
  return db.events[String(code || '').toUpperCase()] || null;
}

function roleFor(ev, key) {
  if (!ev || !key) return null;
  if (key === ev.adminKey) return 'admin';
  if (ev.managerPin && key === ev.managerPin) return 'manager';
  return null;
}

function priorityOf(r, s) {
  // Higher = closer to the top of the DJ's queue
  const unit = s.tipAmounts.length ? Math.min(...s.tipAmounts) : (CURRENCIES[s.currencyCode] || CURRENCIES.INR).unit;
  let p = r.likes.length * 10 + Math.min((r.tipTotal || 0) / Math.max(1, unit), 50) * 15;
  if (r.pinned) p += 100000;
  if (s.timeBombEnabled && r.expiresAt && !r.defused) {
    const minsLeft = (r.expiresAt - Date.now()) / 60000;
    if (minsLeft < 5) p += (5 - minsLeft) * 4; // urgency boost as the bomb ticks down
  }
  return p;
}

function publicRequest(r, ev, forUser) {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    artwork: r.artwork,
    previewUrl: r.previewUrl,
    duration: r.duration,
    explicit: r.explicit,
    trackUrl: r.trackUrl,
    by: r.byName,
    byId: forUser === true ? r.byId : undefined,
    mine: typeof forUser === 'string' ? r.byId === forUser : undefined,
    liked: typeof forUser === 'string' ? r.likes.includes(forUser) : undefined,
    likes: r.likes.length,
    likers: forUser === true ? r.likeNames.slice(-20) : undefined,
    tipTotal: r.tipTotal || 0,
    tips: forUser === true ? r.tips : undefined,
    status: r.status,
    pinned: !!r.pinned,
    defused: !!r.defused,
    note: forUser === true ? r.note : undefined,
    createdAt: r.createdAt,
    expiresAt: ev.settings.timeBombEnabled && !r.defused && !r.pinned ? r.expiresAt : null,
    playedAt: r.playedAt,
    priority: Math.round(priorityOf(r, ev.settings)),
  };
}

function snapshot(ev, forUser) {
  const s = ev.settings;
  const open = ev.requests.filter((r) => r.status === 'queued');
  open.sort((a, b) => priorityOf(b, s) - priorityOf(a, s) || a.createdAt - b.createdAt);
  const nowPlaying = ev.requests.find((r) => r.status === 'playing') || null;
  const played = ev.requests
    .filter((r) => r.status === 'played')
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, 30);
  const out = {
    code: ev.code,
    name: ev.name,
    djName: ev.djName,
    venue: ev.venue,
    logoUrl: ev.logoUrl || '',
    posterUrl: ev.posterUrl || '',
    status: ev.status,
    createdAt: ev.createdAt,
    settings: {
      tipsEnabled: s.tipsEnabled,
      tipAmounts: s.tipAmounts,
      currency: s.currency,
      currencyCode: s.currencyCode,
      upiId: s.upiId,
      upiName: s.upiName,
      timeBombEnabled: s.timeBombEnabled,
      timeBombMinutes: s.timeBombMinutes,
      defuseLikes: s.defuseLikes,
      maxOpenRequestsPerUser: s.maxOpenRequestsPerUser,
      requestsOpen: s.requestsOpen,
      allowExplicit: s.allowExplicit,
    },
    announcement: ev.announcement || '',
    nowPlaying: nowPlaying && publicRequest(nowPlaying, ev, forUser),
    queue: open.map((r) => publicRequest(r, ev, forUser)),
    played: played.map((r) => publicRequest(r, ev, forUser)),
    serverTime: Date.now(),
  };
  if (forUser === true) {
    out.rejected = ev.requests
      .filter((r) => r.status === 'rejected' || r.status === 'exploded')
      .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
      .slice(0, 30)
      .map((r) => publicRequest(r, ev, true));
    out.stats = {
      participants: Object.keys(ev.participants || {}).length,
      requests: ev.requests.length,
      played: ev.requests.filter((r) => r.status === 'played').length,
      likes: ev.requests.reduce((n, r) => n + r.likes.length, 0),
      tips: ev.requests.reduce((n, r) => n + (r.tipTotal || 0), 0),
      exploded: ev.requests.filter((r) => r.status === 'exploded').length,
    };
    out.managerPin = ev.managerPin || '';
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Server                                                               */
/* ------------------------------------------------------------------ */
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

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
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  let host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  // Phones can't reach "localhost" — swap in this computer's Wi-Fi/LAN address
  host = host.replace(/^(localhost|127\.0\.0\.1|\[::1\])/, lanIp());
  return `${proto}://${host}`;
}

// Uploaded event logos & posters
app.use('/media', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

// Pages with event codes in the path
const escAttr = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get('/e/:code', (req, res) => {
  // Inject link-preview tags so WhatsApp / Instagram show the event poster or logo
  const ev = getEvent(req.params.code);
  let html = fs.readFileSync(path.join(__dirname, 'public', 'event.html'), 'utf8');
  if (ev) {
    const base = baseUrl(req);
    const img = ev.posterUrl || ev.logoUrl || '/img/icon-512.png';
    const title = `${ev.name}${ev.djName ? ' with ' + ev.djName : ''}`;
    const desc = `Request your songs for ${ev.name}${ev.venue ? ' at ' + ev.venue : ''} on DropMyBeats.`;
    const tags = [
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${escAttr(title)}">`,
      `<meta property="og:description" content="${escAttr(desc)}">`,
      `<meta property="og:image" content="${escAttr(base + img)}">`,
      `<meta property="og:url" content="${escAttr(base + '/e/' + ev.code)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="description" content="${escAttr(desc)}">`,
    ].join('\n');
    html = html.replace('</head>', tags + '\n</head>').replace('<title>DropMyBeats</title>', `<title>${escAttr(ev.name)} · DropMyBeats</title>`);
  }
  res.type('html').set('Cache-Control', 'no-store').send(html);
});
app.get('/dj/:code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dj.html')));
app.get('/screen/:code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));

// Create an event → the creator becomes Admin
app.post('/api/events', (req, res) => {
  const name = clean(req.body.name, 60);
  const djName = clean(req.body.djName, 40);
  if (!name) return res.status(400).json({ error: 'Event name is required' });
  const code = newCode();
  const ev = {
    code,
    name,
    djName,
    venue: clean(req.body.venue, 60),
    adminKey: id(12),
    managerPin: '',
    status: 'live',
    createdAt: Date.now(),
    settings: { ...DEFAULT_SETTINGS, tipAmounts: [] },
    participants: {},
    requests: [],
    announcement: '',
  };
  applyCurrency(ev.settings, String(req.body.currencyCode || 'INR').toUpperCase());
  db.events[code] = ev;
  save();
  res.json({ code, adminKey: ev.adminKey });
});

app.get('/api/currencies', (req, res) => res.json(Object.entries(CURRENCIES).map(([code, c]) => ({ code, symbol: c.symbol.trim() }))));

app.get('/api/events/:code', (req, res) => {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  res.json({ code: ev.code, name: ev.name, djName: ev.djName, venue: ev.venue, status: ev.status, logoUrl: ev.logoUrl || '', posterUrl: ev.posterUrl || '' });
});

app.get('/api/events/:code/link', (req, res) => {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  res.json({ url: `${baseUrl(req)}/e/${ev.code}` });
});

app.get('/api/events/:code/qr.svg', async (req, res) => {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).end();
  const svg = await QRCode.toString(`${baseUrl(req)}/e/${ev.code}`, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
});

app.get('/api/events/:code/qr.png', async (req, res) => {
  const ev = getEvent(req.params.code);
  if (!ev) return res.status(404).end();
  const buf = await QRCode.toBuffer(`${baseUrl(req)}/e/${ev.code}`, { width: 1024, margin: 2 });
  res.type('png')
    .set('Content-Disposition', `attachment; filename="DropMyBeats-${ev.code}-QR.png"`)
    .send(buf);
});

/* ----------------------- Event logo & poster ----------------------- */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}
function removeMedia(url) {
  if (!url || !url.startsWith('/media/')) return;
  const f = path.join(UPLOAD_DIR, path.basename(url));
  fs.promises.unlink(f).catch(() => {});
}
function adminOnly(req, res) {
  const ev = getEvent(req.params.code);
  if (!ev) { res.status(404).json({ error: 'Event not found' }); return null; }
  if (roleFor(ev, String(req.get('x-admin-key') || '')) !== 'admin') { res.status(403).json({ error: 'Only the event admin can change branding' }); return null; }
  if (!['logo', 'poster'].includes(req.params.kind)) { res.status(400).json({ error: 'Unknown image type' }); return null; }
  return ev;
}
app.post('/api/events/:code/media/:kind', express.raw({ type: () => true, limit: '8mb' }), (req, res) => {
  const ev = adminOnly(req, res);
  if (!ev) return;
  const ext = sniffImage(req.body);
  if (!ext) return res.status(400).json({ error: 'Please upload a PNG, JPG, WebP or GIF image' });
  const kind = req.params.kind;
  const name = `${ev.code}-${kind}-${id(5)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
  removeMedia(ev[kind + 'Url']);
  ev[kind + 'Url'] = '/media/' + name;
  save();
  broadcast(ev);
  res.json({ ok: true, url: ev[kind + 'Url'] });
});
app.delete('/api/events/:code/media/:kind', (req, res) => {
  const ev = adminOnly(req, res);
  if (!ev) return;
  removeMedia(ev[req.params.kind + 'Url']);
  ev[req.params.kind + 'Url'] = '';
  save();
  broadcast(ev);
  res.json({ ok: true });
});
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Image is too large (max 8 MB)' });
  next(err);
});

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
  const n = norm(q);
  return MOCK.filter(([t, a]) => norm(t + ' ' + a).includes(n) || n.split(' ').some((w) => w && norm(t + ' ' + a).includes(w)))
    .map(([title, artist, album], i) => ({
      source: 'mock', sourceId: 'm' + i + norm(title).replace(/ /g, ''), title, artist, album,
      artwork: '', previewUrl: '', duration: 200 + i * 7, explicit: false, year: '', trackUrl: '',
    }));
}

app.get('/api/search', async (req, res) => {
  const q = clean(req.query.q, 100);
  const country = /^[a-z]{2}$/i.test(req.query.country || '') ? req.query.country : 'IN';
  if (q.length < 2) return res.json({ results: [] });
  const key = country + '|' + q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return res.json({ results: hit.results, source: hit.source });
  let results = [];
  let source = 'none';
  if (SEARCH_MOCK) {
    results = searchMock(q);
    source = 'mock';
  } else {
    try {
      results = await searchItunes(q, country);
      source = 'itunes';
    } catch (e) {
      console.warn('iTunes search failed:', e.message);
    }
    if (!results.length) {
      try {
        results = await searchDeezer(q);
        source = 'deezer';
      } catch (e) {
        console.warn('Deezer search failed:', e.message);
      }
    }
  }
  // Drop duplicates of the same title+artist
  const seen = new Set();
  results = results.filter((r) => {
    const k = norm(r.title) + '|' + norm(r.artist);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (results.length) {
    searchCache.set(key, { at: Date.now(), results, source });
    if (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value);
  }
  res.json({ results, source, offline: !results.length && !SEARCH_MOCK });
});

/* ------------------------------------------------------------------ */
/* Real-time (Socket.IO)                                               */
/* ------------------------------------------------------------------ */
function broadcast(ev) {
  io.to('p:' + ev.code).fetchSockets().then((sockets) => {
    for (const s of sockets) s.emit('state', snapshot(ev, s.data.userId || ''));
  });
  io.to('dj:' + ev.code).emit('state', snapshot(ev, true));
  io.to('screen:' + ev.code).emit('state', snapshot(ev, ''));
}

const rate = new Map(); // userId -> timestamps (anti-spam)
function limited(userId, max = 12, windowMs = 60000) {
  const now = Date.now();
  const arr = (rate.get(userId) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rate.set(userId, arr);
  return arr.length > max;
}

io.on('connection', (socket) => {
  const ack = (cb, payload) => typeof cb === 'function' && cb(payload);

  // Participant joins (no login — just a name)
  socket.on('join', ({ code, userId, name } = {}, cb) => {
    const ev = getEvent(code);
    if (!ev) return ack(cb, { error: 'Event not found' });
    userId = clean(userId, 40) || id(8);
    name = clean(name, 30);
    socket.data = { code: ev.code, userId, name, role: 'participant' };
    socket.join('p:' + ev.code);
    if (name) {
      const p = ev.participants[userId] || { joinedAt: Date.now() };
      p.name = name;
      p.lastSeen = Date.now();
      ev.participants[userId] = p;
      save();
    }
    ack(cb, { ok: true, userId, state: snapshot(ev, userId) });
  });

  // Screen / projector view
  socket.on('screen', ({ code } = {}, cb) => {
    const ev = getEvent(code);
    if (!ev) return ack(cb, { error: 'Event not found' });
    socket.data = { code: ev.code, role: 'screen' };
    socket.join('screen:' + ev.code);
    ack(cb, { ok: true, state: snapshot(ev, '') });
  });

  // DJ console login (Admin key or Manager PIN)
  socket.on('dj:auth', ({ code, key } = {}, cb) => {
    const ev = getEvent(code);
    if (!ev) return ack(cb, { error: 'Event not found' });
    if (limited('auth:' + socket.handshake.address, 10, 60000)) return ack(cb, { error: 'Too many attempts, wait a minute' });
    const role = roleFor(ev, String(key || ''));
    if (!role) return ack(cb, { error: 'Wrong PIN or admin key' });
    socket.data = { code: ev.code, role, userId: 'dj' };
    socket.join('dj:' + ev.code);
    ack(cb, { ok: true, role, adminKey: role === 'admin' ? ev.adminKey : undefined, state: snapshot(ev, true) });
  });

  /* ---------- participant actions ---------- */
  socket.on('request', (song = {}, cb) => {
    const { code, userId, name } = socket.data || {};
    const ev = getEvent(code);
    if (!ev || !userId) return ack(cb, { error: 'Join the event first' });
    if (!name) return ack(cb, { error: 'Please enter your name first' });
    if (ev.status !== 'live') return ack(cb, { error: 'This event has ended' });
    if (!ev.settings.requestsOpen) return ack(cb, { error: 'The DJ has paused requests for now' });
    if (limited(userId)) return ack(cb, { error: 'Slow down a little — try again in a minute' });
    const title = clean(song.title, 120);
    const artist = clean(song.artist, 120);
    if (!title) return ack(cb, { error: 'Pick a song first' });
    if (song.explicit && !ev.settings.allowExplicit) return ack(cb, { error: 'Explicit tracks are not allowed at this event' });

    // Same song already in the queue? Count it as a like instead of a duplicate.
    const k = norm(title) + '|' + norm(artist);
    const dup = ev.requests.find((r) => (r.status === 'queued' || r.status === 'playing') && norm(r.title) + '|' + norm(r.artist) === k);
    if (dup) {
      if (!dup.likes.includes(userId) && dup.byId !== userId) {
        dup.likes.push(userId);
        dup.likeNames.push(name);
        checkDefuse(ev, dup);
      }
      save();
      broadcast(ev);
      return ack(cb, { ok: true, merged: true, id: dup.id });
    }
    const mineOpen = ev.requests.filter((r) => r.byId === userId && r.status === 'queued').length;
    const max = ev.settings.maxOpenRequestsPerUser;
    if (max > 0 && mineOpen >= max) return ack(cb, { error: `You already have ${mineOpen} songs waiting — like other requests or wait for yours to play` });

    const now = Date.now();
    const r = {
      id: id(6),
      title,
      artist,
      album: clean(song.album, 120),
      artwork: /^https:\/\//.test(song.artwork || '') ? clean(song.artwork, 400) : '',
      previewUrl: /^https:\/\//.test(song.previewUrl || '') ? clean(song.previewUrl, 400) : '',
      trackUrl: /^https:\/\//.test(song.trackUrl || '') ? clean(song.trackUrl, 400) : '',
      duration: Number(song.duration) || 0,
      explicit: !!song.explicit,
      source: clean(song.source, 10),
      byId: userId,
      byName: name,
      note: clean(song.note, 140),
      likes: [],
      likeNames: [],
      tips: [],
      tipTotal: 0,
      status: 'queued',
      createdAt: now,
      expiresAt: now + ev.settings.timeBombMinutes * 60000,
    };
    ev.requests.push(r);
    save();
    broadcast(ev);
    ack(cb, { ok: true, id: r.id });
  });

  socket.on('like', ({ id: rid } = {}, cb) => {
    const { code, userId, name } = socket.data || {};
    const ev = getEvent(code);
    if (!ev || !userId) return ack(cb, { error: 'Join the event first' });
    const r = ev.requests.find((x) => x.id === rid);
    if (!r || r.status !== 'queued') return ack(cb, { error: 'That request is no longer in the queue' });
    if (r.byId === userId) return ack(cb, { error: "That's your own request 🙂" });
    const i = r.likes.indexOf(userId);
    if (i >= 0) {
      r.likes.splice(i, 1);
      r.likeNames.splice(i, 1);
    } else {
      r.likes.push(userId);
      r.likeNames.push(name || 'Someone');
      checkDefuse(ev, r);
    }
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  socket.on('tip', ({ id: rid, amount } = {}, cb) => {
    const { code, userId, name } = socket.data || {};
    const ev = getEvent(code);
    if (!ev || !userId) return ack(cb, { error: 'Join the event first' });
    if (!ev.settings.tipsEnabled) return ack(cb, { error: 'Tips are turned off' });
    const r = ev.requests.find((x) => x.id === rid);
    amount = Number(amount);
    if (!r || r.status !== 'queued') return ack(cb, { error: 'That request is no longer in the queue' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TIP) return ack(cb, { error: 'Enter a valid tip amount' });
    amount = Math.round(amount * 100) / 100;
    r.tips.push({ by: name || 'Someone', userId, amount, at: Date.now(), confirmed: false });
    r.tipTotal = (r.tipTotal || 0) + amount;
    r.defused = true; // a tip always defuses the TimeBomb
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  socket.on('withdraw', ({ id: rid } = {}, cb) => {
    const { code, userId } = socket.data || {};
    const ev = getEvent(code);
    const r = ev && ev.requests.find((x) => x.id === rid && x.byId === userId && x.status === 'queued');
    if (!r) return ack(cb, { error: 'Cannot remove that request' });
    ev.requests.splice(ev.requests.indexOf(r), 1);
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  /* ---------- DJ / manager / admin actions ---------- */
  function djEvent(cb, needAdmin) {
    const { code, role } = socket.data || {};
    const ev = getEvent(code);
    if (!ev || !role || role === 'participant' || role === 'screen') {
      ack(cb, { error: 'Not authorised' });
      return null;
    }
    if (needAdmin && role !== 'admin') {
      ack(cb, { error: 'Only the event admin can do that' });
      return null;
    }
    return ev;
  }

  socket.on('dj:set-status', ({ id: rid, status } = {}, cb) => {
    const ev = djEvent(cb);
    if (!ev) return;
    const r = ev.requests.find((x) => x.id === rid);
    if (!r) return ack(cb, { error: 'Request not found' });
    const now = Date.now();
    if (status === 'playing') {
      for (const x of ev.requests) if (x.status === 'playing') { x.status = 'played'; x.playedAt = x.playedAt || now; }
      r.status = 'playing';
      r.playedAt = now;
    } else if (status === 'played') {
      r.status = 'played';
      r.playedAt = r.playedAt || now;
    } else if (status === 'rejected') {
      r.status = 'rejected';
      r.closedAt = now;
    } else if (status === 'queued') {
      r.status = 'queued';
      r.expiresAt = now + ev.settings.timeBombMinutes * 60000;
      delete r.closedAt;
    } else return ack(cb, { error: 'Unknown status' });
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  socket.on('dj:pin', ({ id: rid } = {}, cb) => {
    const ev = djEvent(cb);
    if (!ev) return;
    const r = ev.requests.find((x) => x.id === rid);
    if (!r) return ack(cb, { error: 'Request not found' });
    r.pinned = !r.pinned;
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  socket.on('dj:defuse', ({ id: rid } = {}, cb) => {
    const ev = djEvent(cb);
    if (!ev) return;
    const r = ev.requests.find((x) => x.id === rid);
    if (!r) return ack(cb, { error: 'Request not found' });
    r.defused = true;
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  socket.on('dj:confirm-tip', ({ id: rid, index } = {}, cb) => {
    const ev = djEvent(cb);
    if (!ev) return;
    const r = ev.requests.find((x) => x.id === rid);
    const t = r && r.tips[index];
    if (!t) return ack(cb, { error: 'Tip not found' });
    t.confirmed = !t.confirmed;
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  socket.on('dj:announce', ({ text } = {}, cb) => {
    const ev = djEvent(cb);
    if (!ev) return;
    ev.announcement = clean(text, 140);
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  socket.on('dj:toggle-requests', (_ = {}, cb) => {
    const ev = djEvent(cb);
    if (!ev) return;
    ev.settings.requestsOpen = !ev.settings.requestsOpen;
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  socket.on('admin:settings', (patch = {}, cb) => {
    const ev = djEvent(cb, true);
    if (!ev) return;
    const s = ev.settings;
    if ('name' in patch) ev.name = clean(patch.name, 60) || ev.name;
    if ('djName' in patch) ev.djName = clean(patch.djName, 40);
    if ('venue' in patch) ev.venue = clean(patch.venue, 60);
    if ('tipsEnabled' in patch) s.tipsEnabled = !!patch.tipsEnabled;
    if ('tipAmounts' in patch) {
      const arr = [...new Set((Array.isArray(patch.tipAmounts) ? patch.tipAmounts : String(patch.tipAmounts).split(','))
        .map((x) => Math.round(Number(String(x).trim())))
        .filter((x) => x > 0 && x <= MAX_TIP))].sort((a, b) => a - b).slice(0, 6);
      s.tipAmounts = arr; // empty = guests type any amount
    }
    if ('currencyCode' in patch) applyCurrency(s, String(patch.currencyCode).toUpperCase());
    if ('upiId' in patch) s.upiId = clean(patch.upiId, 60).replace(/\s/g, '');
    if ('upiName' in patch) s.upiName = clean(patch.upiName, 40);
    if ('timeBombEnabled' in patch) s.timeBombEnabled = !!patch.timeBombEnabled;
    if ('timeBombMinutes' in patch) {
      const m = Math.min(240, Math.max(1, Math.round(Number(patch.timeBombMinutes) || 30)));
      if (m !== s.timeBombMinutes) {
        // re-arm open bombs with the new fuse length
        for (const r of ev.requests) if (r.status === 'queued') r.expiresAt = r.createdAt + m * 60000;
      }
      s.timeBombMinutes = m;
    }
    if ('defuseLikes' in patch) s.defuseLikes = Math.min(1000, Math.max(0, Math.round(Number(patch.defuseLikes) || 0)));
    if ('maxOpenRequestsPerUser' in patch) s.maxOpenRequestsPerUser = Math.min(50, Math.max(0, Math.round(Number(patch.maxOpenRequestsPerUser) || 0)));
    if ('requestsOpen' in patch) s.requestsOpen = !!patch.requestsOpen;
    if ('allowExplicit' in patch) s.allowExplicit = !!patch.allowExplicit;
    if ('managerPin' in patch) {
      const pin = String(patch.managerPin || '').replace(/\D/g, '').slice(0, 8);
      if (pin && pin.length < 4) return ack(cb, { error: 'Manager PIN must be 4–8 digits' });
      const changed = pin !== ev.managerPin;
      ev.managerPin = pin;
      if (changed) {
        // kick out managers
        io.in('dj:' + ev.code).fetchSockets().then((ss) => ss.forEach((x) => x.data.role === 'manager' && x.emit('kicked')));
      }
    }
    if ('status' in patch && ['live', 'ended'].includes(patch.status)) ev.status = patch.status;
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });

  socket.on('admin:clear-history', (_ = {}, cb) => {
    const ev = djEvent(cb, true);
    if (!ev) return;
    ev.requests = ev.requests.filter((r) => r.status === 'queued' || r.status === 'playing');
    save();
    broadcast(ev);
    ack(cb, { ok: true });
  });
});

function checkDefuse(ev, r) {
  const n = ev.settings.defuseLikes;
  if (n > 0 && r.likes.length >= n) r.defused = true;
}

/* ---------------------- TimeBomb ticker ---------------------- */
setInterval(() => {
  const now = Date.now();
  for (const ev of Object.values(db.events)) {
    if (!ev.settings.timeBombEnabled || ev.status !== 'live') continue;
    let changed = false;
    for (const r of ev.requests) {
      if (r.status === 'queued' && !r.defused && !r.pinned && r.expiresAt && r.expiresAt <= now) {
        r.status = 'exploded';
        r.closedAt = now;
        changed = true;
      }
    }
    if (changed) {
      save();
      broadcast(ev);
    }
  }
}, 5000);

server.listen(PORT, () => {
  console.log('');
  console.log('  🎧  DropMyBeats is live');
  console.log(`      On this computer:   http://localhost:${PORT}`);
  console.log(`      On phones (Wi-Fi):  ${PUBLIC_URL || `http://${lanIp()}:${PORT}`}`);
  if (SEARCH_MOCK) console.log('      (song search is in MOCK mode)');
  console.log('');
});
