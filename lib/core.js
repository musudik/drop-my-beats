// DropMyBeats — event logic shared by the local server and Vercel.
// Pure functions: they read/modify an event object and never touch storage.
'use strict';

const crypto = require('crypto');

const id = (n = 8) => crypto.randomBytes(n).toString('hex');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
const clean = (s, max = 80) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const norm = (s) => clean(s, 200).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9ऀ-෿]+/g, ' ').trim();

/* ---------- Same-song matching ----------
 * "Kesariya (From \"Brahmastra\")" by "Arijit Singh" and "Kesariya" by "Pritam, Arijit Singh"
 * are the same song. Titles are compared without brackets/"from…"/"feat…", and the artists
 * only need to share one name. Mirrored in public/js/common.js (DMB.sameSong). */
function titleKey(t) {
  return clean(t, 200).toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s[-–—]\s.*$/, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/[^a-z0-9\u0900-\u0dff]+/g, ' ').trim();
}
function artistKeys(a) {
  return clean(a, 200).toLowerCase()
    .split(/,|&|\band\b|\bx\b|\bfeat\.?|\bft\.?|\bwith\b|\//)
    .map((x) => x.replace(/[^a-z0-9\u0900-\u0dff]+/g, ' ').trim())
    .filter(Boolean);
}
function sameSong(a, b) {
  if (!a || !b || titleKey(a.title) !== titleKey(b.title) || !titleKey(a.title)) return false;
  const x = artistKeys(a.artist), y = artistKeys(b.artist);
  if (!x.length || !y.length) return true; // typed by hand without an artist
  return x.some((n) => y.includes(n));
}

// Currencies the admin can pick from (symbol shown to guests; "unit" = what counts as one boost step)
const CURRENCIES = {
  INR: { symbol: '₹', unit: 100 }, USD: { symbol: '$', unit: 5 }, EUR: { symbol: '€', unit: 5 },
  GBP: { symbol: '£', unit: 5 }, AED: { symbol: 'AED ', unit: 20 }, SGD: { symbol: 'S$', unit: 5 },
  AUD: { symbol: 'A$', unit: 5 }, CAD: { symbol: 'C$', unit: 5 }, CHF: { symbol: 'CHF ', unit: 5 },
  JPY: { symbol: '¥', unit: 500 }, LKR: { symbol: 'Rs ', unit: 300 }, NPR: { symbol: 'Rs ', unit: 150 },
  BDT: { symbol: '৳', unit: 100 }, SAR: { symbol: 'SAR ', unit: 20 }, QAR: { symbol: 'QAR ', unit: 20 },
  MYR: { symbol: 'RM', unit: 20 }, THB: { symbol: '฿', unit: 150 }, ZAR: { symbol: 'R', unit: 80 },
};
const currencyList = () => Object.entries(CURRENCIES).map(([code, c]) => ({ code, symbol: c.symbol.trim() }));
function applyCurrency(s, code) {
  const c = CURRENCIES[code] ? code : 'INR';
  s.currencyCode = c;
  s.currency = CURRENCIES[c].symbol;
}
const MAX_TIP = 1000000;

const DEFAULT_SETTINGS = {
  tipsEnabled: true,
  tipAmounts: [], // optional quick-pick amounts; guests can always type their own
  currencyCode: 'INR',
  currency: '₹',
  upiId: '',
  upiName: '',
  timeBombEnabled: true,
  timeBombMinutes: 30, // a request explodes if not played within this time
  defuseLikes: 10, // ...unless it collects this many likes (0 = never defuse)
  maxOpenRequestsPerUser: 3,
  repeatBlockMinutes: 60, // a played song can't be requested again for this long (0 = allow repeats)
  requestsOpen: true,
  allowExplicit: true,
};

function createEvent(code, body) {
  const ev = {
    code,
    v: 1,
    salt: id(6),
    name: clean(body.name, 60),
    djName: clean(body.djName, 40),
    venue: clean(body.venue, 60),
    adminKey: id(12),
    managerPin: '',
    status: 'live',
    createdAt: Date.now(),
    settings: { ...DEFAULT_SETTINGS, tipAmounts: [] },
    participants: {},
    requests: [],
    announcement: '',
    logoUrl: '',
    posterUrl: '',
    djlogoUrl: '',
    info: {},
  };
  applyCurrency(ev.settings, String(body.currencyCode || 'INR').toUpperCase());
  return ev;
}

// Bring events saved by older versions up to date
function migrate(ev) {
  if (!ev) return ev;
  ev.v = ev.v || 1;
  ev.salt = ev.salt || ev.code;
  ev.participants = ev.participants || {};
  ev.info = ev.info && typeof ev.info === 'object' ? ev.info : {};
  ev.settings = { ...DEFAULT_SETTINGS, ...(ev.settings || {}) };
  if (!ev.settings.currencyCode || !(ev.settings.currencyCode in CURRENCIES)) {
    const bySymbol = { '₹': 'INR', $: 'USD', '€': 'EUR', '£': 'GBP' };
    ev.settings.currencyCode = bySymbol[String(ev.settings.currency || '₹').trim()] || 'INR';
  }
  if (JSON.stringify(ev.settings.tipAmounts) === '[50,100,200,500]') ev.settings.tipAmounts = [];
  return ev;
}

function roleFor(ev, key) {
  key = String(key || '');
  if (!ev || !key) return null;
  if (key === ev.adminKey) return 'admin';
  if (ev.managerPin && key === ev.managerPin) return 'manager';
  return null;
}

// Short one-way tag for a guest, so the shared (cacheable) state can mark "mine"/"liked" without exposing IDs
const userHash = (ev, userId) => crypto.createHash('sha256').update(ev.salt + ':' + userId).digest('hex').slice(0, 12);

function priorityOf(r, s, now = Date.now()) {
  const unit = s.tipAmounts.length ? Math.min(...s.tipAmounts) : (CURRENCIES[s.currencyCode] || CURRENCIES.INR).unit;
  let p = r.likes.length * 10 + Math.min((r.tipTotal || 0) / Math.max(1, unit), 50) * 15;
  if (r.pinned) p += 100000;
  if (s.timeBombEnabled && r.expiresAt && !r.defused) {
    const minsLeft = (r.expiresAt - now) / 60000;
    if (minsLeft < 5) p += (5 - minsLeft) * 4; // urgency boost as the bomb ticks down
  }
  return p;
}

function viewRequest(r, ev, dj) {
  const out = {
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
    byH: userHash(ev, r.byId),
    likeH: r.likes.map((u) => userHash(ev, u)),
    likes: r.likes.length,
    tipTotal: r.tipTotal || 0,
    status: r.status,
    pinned: !!r.pinned,
    defused: !!r.defused,
    createdAt: r.createdAt,
    expiresAt: ev.settings.timeBombEnabled && !r.defused && !r.pinned ? r.expiresAt : null,
    playedAt: r.playedAt,
    closedAt: r.closedAt,
  };
  if (dj) {
    out.likers = r.likeNames.slice(-20);
    out.tips = r.tips.map((t) => ({ by: t.by, amount: t.amount, at: t.at, confirmed: t.confirmed }));
    out.note = r.note;
  } else {
    delete out.closedAt;
  }
  return out;
}

// dj = false → the public state, identical for every guest (safe to cache on a CDN)
function viewState(ev, dj = false) {
  const s = ev.settings;
  const now = Date.now();
  const open = ev.requests.filter((r) => r.status === 'queued');
  open.sort((a, b) => priorityOf(b, s, now) - priorityOf(a, s, now) || a.createdAt - b.createdAt);
  const nowPlaying = ev.requests.find((r) => r.status === 'playing') || null;
  const played = ev.requests.filter((r) => r.status === 'played').sort((a, b) => b.playedAt - a.playedAt).slice(0, 30);
  const out = {
    code: ev.code,
    v: ev.v,
    name: ev.name,
    djName: ev.djName,
    venue: ev.venue,
    logoUrl: ev.logoUrl || '',
    posterUrl: ev.posterUrl || '',
    djlogoUrl: ev.djlogoUrl || '',
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
      repeatBlockMinutes: s.repeatBlockMinutes,
      requestsOpen: s.requestsOpen,
      allowExplicit: s.allowExplicit,
    },
    announcement: ev.announcement || '',
    info: infoSummary(ev),
    nowPlaying: nowPlaying && viewRequest(nowPlaying, ev, dj),
    queue: open.map((r) => viewRequest(r, ev, dj)),
    played: played.map((r) => viewRequest(r, ev, dj)),
    serverTime: now,
  };
  if (dj) {
    out.rejected = ev.requests
      .filter((r) => r.status === 'rejected' || r.status === 'exploded')
      .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
      .slice(0, 30)
      .map((r) => viewRequest(r, ev, true));
    out.stats = {
      participants: Object.keys(ev.participants || {}).length,
      requests: ev.requests.length,
      played: ev.requests.filter((r) => r.status === 'played').length,
      likes: ev.requests.reduce((n, r) => n + r.likes.length, 0),
      tips: Math.round(ev.requests.reduce((n, r) => n + (r.tipTotal || 0), 0) * 100) / 100,
      exploded: ev.requests.filter((r) => r.status === 'exploded').length,
    };
    out.managerPin = ev.managerPin || '';
  }
  return out;
}

// TimeBomb: mark expired requests as exploded. Returns true if anything changed.
function tick(ev, now = Date.now()) {
  if (!ev.settings.timeBombEnabled || ev.status !== 'live') return false;
  let changed = false;
  for (const r of ev.requests) {
    if (r.status === 'queued' && !r.defused && !r.pinned && r.expiresAt && r.expiresAt <= now) {
      r.status = 'exploded';
      r.closedAt = now;
      changed = true;
    }
  }
  return changed;
}
const needsTick = (ev, now = Date.now()) =>
  ev.settings.timeBombEnabled && ev.status === 'live' &&
  ev.requests.some((r) => r.status === 'queued' && !r.defused && !r.pinned && r.expiresAt && r.expiresAt <= now);

function checkDefuse(ev, r) {
  const n = ev.settings.defuseLikes;
  if (n > 0 && r.likes.length >= n) r.defused = true;
}

/* ------------------------------------------------------------------ */
/* Actions. Each one: (ev, actor, data) → { error } or { ok, ... }      */
/* actor = { role: 'guest' | 'manager' | 'admin', userId, name }        */
/* ------------------------------------------------------------------ */
const guest = {
  join(ev, a) {
    if (!a.name) return { error: 'Please enter your name' };
    const p = ev.participants[a.userId] || { joinedAt: Date.now() };
    p.name = a.name;
    p.lastSeen = Date.now();
    ev.participants[a.userId] = p;
    return { ok: true };
  },

  request(ev, a, song) {
    if (!a.name) return { error: 'Please enter your name first' };
    if (ev.status !== 'live') return { error: 'This event has ended' };
    if (!ev.settings.requestsOpen) return { error: 'The DJ has paused requests for now' };
    const title = clean(song.title, 120);
    const artist = clean(song.artist, 120);
    if (!title) return { error: 'Pick a song first' };
    if (song.explicit && !ev.settings.allowExplicit) return { error: 'Explicit tracks are not allowed at this event' };

    const wanted = { title, artist };
    // Played recently? The DJ can block repeats for a while.
    const block = ev.settings.repeatBlockMinutes;
    if (block > 0) {
      const recent = ev.requests.find((r) => r.status === 'played' && r.playedAt && Date.now() - r.playedAt < block * 60000 && sameSong(r, wanted));
      if (recent) {
        const ago = Math.max(1, Math.round((Date.now() - recent.playedAt) / 60000));
        const wait = Math.max(1, Math.ceil(block - (Date.now() - recent.playedAt) / 60000));
        return { error: `“${recent.title}” was played ${ago} min ago. It can be requested again in ${wait} min.`, code: 'recently-played' };
      }
    }
    // Same song already in the queue (or playing)? Count it as a +1 instead of a duplicate.
    const dup = ev.requests.find((r) => (r.status === 'queued' || r.status === 'playing') && sameSong(r, wanted));
    if (dup) {
      if (dup.status === 'playing') return { ok: true, merged: true, playing: true, id: dup.id };
      if (!dup.likes.includes(a.userId) && dup.byId !== a.userId) {
        dup.likes.push(a.userId);
        dup.likeNames.push(a.name);
        checkDefuse(ev, dup);
      }
      return { ok: true, merged: true, id: dup.id };
    }
    const mineOpen = ev.requests.filter((r) => r.byId === a.userId && r.status === 'queued').length;
    const max = ev.settings.maxOpenRequestsPerUser;
    if (max > 0 && mineOpen >= max) return { error: `You already have ${mineOpen} songs waiting. Like other requests or wait for yours to play.` };

    const now = Date.now();
    const httpsOnly = (u) => (/^(https:\/\/|\/api\/mock-art\/)/.test(u || '') ? clean(u, 400) : '');
    const r = {
      id: id(6),
      title,
      artist,
      album: clean(song.album, 120),
      artwork: httpsOnly(song.artwork),
      previewUrl: httpsOnly(song.previewUrl),
      trackUrl: httpsOnly(song.trackUrl),
      duration: Number(song.duration) || 0,
      explicit: !!song.explicit,
      source: clean(song.source, 10),
      byId: a.userId,
      byName: a.name,
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
    return { ok: true, id: r.id };
  },

  like(ev, a, { id: rid }) {
    const r = ev.requests.find((x) => x.id === rid);
    if (!r || r.status !== 'queued') return { error: 'That request is no longer in the queue' };
    if (r.byId === a.userId) return { error: "That's your own request 🙂" };
    const i = r.likes.indexOf(a.userId);
    if (i >= 0) {
      r.likes.splice(i, 1);
      r.likeNames.splice(i, 1);
    } else {
      r.likes.push(a.userId);
      r.likeNames.push(a.name || 'Someone');
      checkDefuse(ev, r);
    }
    return { ok: true };
  },

  tip(ev, a, { id: rid, amount }) {
    if (!ev.settings.tipsEnabled) return { error: 'Tips are turned off' };
    const r = ev.requests.find((x) => x.id === rid);
    amount = Number(amount);
    if (!r || r.status !== 'queued') return { error: 'That request is no longer in the queue' };
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TIP) return { error: 'Enter a valid tip amount' };
    amount = Math.round(amount * 100) / 100;
    r.tips.push({ by: a.name || 'Someone', userId: a.userId, amount, at: Date.now(), confirmed: false });
    r.tipTotal = Math.round(((r.tipTotal || 0) + amount) * 100) / 100;
    r.defused = true; // a tip always defuses the TimeBomb
    return { ok: true };
  },

  withdraw(ev, a, { id: rid }) {
    const r = ev.requests.find((x) => x.id === rid && x.byId === a.userId && x.status === 'queued');
    if (!r) return { error: 'Cannot remove that request' };
    ev.requests.splice(ev.requests.indexOf(r), 1);
    return { ok: true };
  },
};

const dj = {
  'set-status'(ev, a, { id: rid, status }) {
    const r = ev.requests.find((x) => x.id === rid);
    if (!r) return { error: 'Request not found' };
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
    } else return { error: 'Unknown status' };
    return { ok: true };
  },
  pin(ev, a, { id: rid }) {
    const r = ev.requests.find((x) => x.id === rid);
    if (!r) return { error: 'Request not found' };
    r.pinned = !r.pinned;
    return { ok: true };
  },
  defuse(ev, a, { id: rid }) {
    const r = ev.requests.find((x) => x.id === rid);
    if (!r) return { error: 'Request not found' };
    r.defused = true;
    return { ok: true };
  },
  'confirm-tip'(ev, a, { id: rid, index }) {
    const r = ev.requests.find((x) => x.id === rid);
    const t = r && r.tips[index];
    if (!t) return { error: 'Tip not found' };
    t.confirmed = !t.confirmed;
    return { ok: true };
  },
  announce(ev, a, { text }) {
    ev.announcement = clean(text, 140);
    return { ok: true };
  },
  'toggle-requests'(ev) {
    ev.settings.requestsOpen = !ev.settings.requestsOpen;
    return { ok: true };
  },
};

/* ---------- Event info: schedule, food menu, parking, general details ----------
 * ev.info[section] = { text, items: [{ a, b, tag }], address, when, images: ['/media/…'] }
 *   general  → when, address, text, images
 *   schedule → items (a = time, b = what), text, images (e.g. a schedule JPG)
 *   food     → items (a = dish, b = price, tag = veg | nonveg | vegan | drink), text, images (menu photo)
 *   parking  → address, text, images (parking map) */
const INFO_SECTIONS = ['general', 'schedule', 'food', 'parking'];
const FOOD_TAGS = ['veg', 'nonveg', 'vegan', 'drink', ''];
const MAX_INFO_IMAGES = 8;
// like clean() but keeps line breaks
const cleanText = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
function infoSection(ev, section) {
  const cur = ev.info[section] || {};
  return { text: cur.text || '', items: cur.items || [], address: cur.address || '', when: cur.when || '', images: cur.images || [] };
}
const sectionHasContent = (x) => !!(x && (x.text || x.address || x.when || (x.items && x.items.length) || (x.images && x.images.length)));
function infoSummary(ev) {
  return INFO_SECTIONS.filter((k) => sectionHasContent(ev.info && ev.info[k]));
}
function viewInfo(ev) {
  const out = { code: ev.code, name: ev.name, djName: ev.djName, venue: ev.venue, logoUrl: ev.logoUrl || '', posterUrl: ev.posterUrl || '', djlogoUrl: ev.djlogoUrl || '', sections: {} };
  for (const k of INFO_SECTIONS) out.sections[k] = infoSection(ev, k);
  return out;
}

const admin = {
  // Save the typed parts of one info section (photos are added through their own upload route)
  info(ev, a, data) {
    const section = String(data.section || '');
    if (!INFO_SECTIONS.includes(section)) return { error: 'Unknown section' };
    const cur = infoSection(ev, section);
    const items = (Array.isArray(data.items) ? data.items : []).slice(0, 60)
      .map((it) => ({
        a: clean(it && it.a, 80),
        b: clean(it && it.b, 120),
        tag: section === 'food' && FOOD_TAGS.includes(it && it.tag) ? it.tag : '',
      }))
      .filter((it) => it.a || it.b);
    ev.info[section] = {
      ...cur,
      text: cleanText(data.text, 3000),
      items: section === 'schedule' || section === 'food' ? items : [],
      address: section === 'general' || section === 'parking' ? clean(data.address, 200) : '',
      when: section === 'general' ? clean(data.when, 120) : '',
    };
    return { ok: true };
  },

  settings(ev, a, patch) {
    const s = ev.settings;
    if ('managerPin' in patch) {
      const pin = String(patch.managerPin || '').replace(/\D/g, '').slice(0, 8);
      if (pin && pin.length < 4) return { error: 'Manager PIN must be 4–8 digits' };
      ev.managerPin = pin;
    }
    if ('name' in patch) ev.name = clean(patch.name, 60) || ev.name;
    if ('djName' in patch) ev.djName = clean(patch.djName, 40);
    if ('venue' in patch) ev.venue = clean(patch.venue, 60);
    if ('tipsEnabled' in patch) s.tipsEnabled = !!patch.tipsEnabled;
    if ('tipAmounts' in patch) {
      s.tipAmounts = [...new Set((Array.isArray(patch.tipAmounts) ? patch.tipAmounts : String(patch.tipAmounts).split(','))
        .map((x) => Math.round(Number(String(x).trim())))
        .filter((x) => x > 0 && x <= MAX_TIP))].sort((x, y) => x - y).slice(0, 6); // empty = guests type any amount
    }
    if ('currencyCode' in patch) applyCurrency(s, String(patch.currencyCode).toUpperCase());
    if ('upiId' in patch) s.upiId = clean(patch.upiId, 60).replace(/\s/g, '');
    if ('upiName' in patch) s.upiName = clean(patch.upiName, 40);
    if ('timeBombEnabled' in patch) s.timeBombEnabled = !!patch.timeBombEnabled;
    if ('timeBombMinutes' in patch) {
      const m = Math.min(240, Math.max(1, Math.round(Number(patch.timeBombMinutes) || 30)));
      if (m !== s.timeBombMinutes) for (const r of ev.requests) if (r.status === 'queued') r.expiresAt = r.createdAt + m * 60000;
      s.timeBombMinutes = m;
    }
    if ('defuseLikes' in patch) s.defuseLikes = Math.min(1000, Math.max(0, Math.round(Number(patch.defuseLikes) || 0)));
    if ('repeatBlockMinutes' in patch) s.repeatBlockMinutes = Math.min(720, Math.max(0, Math.round(Number(patch.repeatBlockMinutes) || 0)));
    if ('maxOpenRequestsPerUser' in patch) s.maxOpenRequestsPerUser = Math.min(50, Math.max(0, Math.round(Number(patch.maxOpenRequestsPerUser) || 0)));
    if ('requestsOpen' in patch) s.requestsOpen = !!patch.requestsOpen;
    if ('allowExplicit' in patch) s.allowExplicit = !!patch.allowExplicit;
    if ('status' in patch && ['live', 'ended'].includes(patch.status)) ev.status = patch.status;
    return { ok: true };
  },
  'clear-history'(ev) {
    ev.requests = ev.requests.filter((r) => r.status === 'queued' || r.status === 'playing');
    return { ok: true };
  },
};

// Look up an action by name and check the actor may run it
function findAction(type, role) {
  if (guest[type] && Object.prototype.hasOwnProperty.call(guest, type)) return { fn: guest[type] };
  const [scope, name] = String(type).split(':');
  if (scope === 'dj' && Object.prototype.hasOwnProperty.call(dj, name)) {
    if (role !== 'admin' && role !== 'manager') return { error: 'Not authorised', status: 403 };
    return { fn: dj[name] };
  }
  if (scope === 'admin' && Object.prototype.hasOwnProperty.call(admin, name)) {
    if (role !== 'admin') return { error: 'Only the event admin can do that', status: 403 };
    return { fn: admin[name] };
  }
  return { error: 'Unknown action', status: 400 };
}

module.exports = {
  INFO_SECTIONS, MAX_INFO_IMAGES, viewInfo, infoSection,
  id, randomCode, clean, norm, sameSong, titleKey, artistKeys, CURRENCIES, currencyList, MAX_TIP,
  createEvent, migrate, roleFor, userHash, viewState, tick, needsTick, findAction,
};
