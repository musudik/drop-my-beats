// DropMyBeats — storage.
//  • Upstash Redis (REST) when KV_REST_API_URL / UPSTASH_REDIS_REST_URL is set → used on Vercel
//  • otherwise a JSON file in ./data (local computer, Render, Railway…)
'use strict';

const fs = require('fs');
const path = require('path');
const { migrate, randomCode } = require('./core');

const TTL = 60 * 60 * 24 * 60; // Redis keeps an event for 60 days after its last change
const MEDIA_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

class StoreError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

/* ------------------------------------------------------------------ */
/* Upstash Redis over HTTPS (works inside Vercel Functions)             */
/* ------------------------------------------------------------------ */
function redisStore(url, token) {
  url = url.replace(/\/+$/, '');
  async function call(body, pathPart = '') {
    let r;
    try {
      r = await fetch(url + pathPart, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new StoreError('Could not reach the Redis database: ' + e.message, 503);
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new StoreError('Redis error: ' + (j.error || r.status), 503);
    return j;
  }
  const cmd = async (...args) => (await call(args)).result;
  const pipeline = async (cmds) => (await call(cmds, '/pipeline')).map((x) => x.result);

  const k = (code) => 'dmb:ev:' + code;
  const kv = (code) => 'dmb:ev:' + code + ':v';
  // Compare-and-set: only write if nobody else changed the event in the meantime
  const CAS = `local v = redis.call('GET', KEYS[2]) or '1'
if v ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
return 1`;

  async function getEvent(code) {
    const [raw, v] = await cmd('MGET', k(code), kv(code));
    if (!raw) return null;
    const ev = migrate(JSON.parse(raw));
    ev.v = Number(v) || ev.v || 1;
    return ev;
  }

  return {
    kind: 'redis',
    getEvent,
    async createEvent(make) {
      for (let i = 0; i < 8; i++) {
        const ev = make(randomCode());
        const ok = await cmd('SET', k(ev.code), JSON.stringify(ev), 'NX', 'EX', String(TTL));
        if (ok === 'OK') {
          await cmd('SET', kv(ev.code), String(ev.v), 'EX', String(TTL));
          return ev;
        }
      }
      throw new StoreError('Could not create a unique event code, try again');
    },
    // mutator(ev) → result; return { error } to abort, or { skipSave: true } for no change
    async updateEvent(code, mutator) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const ev = await getEvent(code);
        if (!ev) return { ev: null, result: { error: 'Event not found', status: 404 } };
        const oldV = ev.v;
        const result = mutator(ev) || { ok: true };
        if (result.error || result.skipSave) return { ev, result };
        ev.v = oldV + 1;
        const ok = await cmd('EVAL', CAS, '2', k(code), kv(code), String(oldV), JSON.stringify(ev), String(ev.v), String(TTL));
        if (ok === 1) return { ev, result };
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 60 * (attempt + 1)));
      }
      return { ev: null, result: { error: 'The event is very busy right now, please try again', status: 409 } };
    },
    async putMedia(name, buf) {
      await cmd('SET', 'dmb:media:' + name, buf.toString('base64'), 'EX', String(TTL));
    },
    async getMedia(name) {
      const b64 = await cmd('GET', 'dmb:media:' + name);
      if (!b64) return null;
      return { buf: Buffer.from(b64, 'base64'), type: MEDIA_TYPES[path.extname(name).slice(1)] || 'application/octet-stream' };
    },
    async delMedia(name) {
      await cmd('DEL', 'dmb:media:' + name);
    },
    _pipeline: pipeline,
  };
}

/* ------------------------------------------------------------------ */
/* JSON file (local / any server with a disk)                           */
/* ------------------------------------------------------------------ */
function fileStore(dataFile) {
  const uploadDir = path.join(path.dirname(dataFile), 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  let db = { events: {} };
  try {
    if (fs.existsSync(dataFile)) db = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (e) {
    console.warn('Could not read data file, starting fresh:', e.message);
  }
  db.events = db.events || {};
  for (const ev of Object.values(db.events)) migrate(ev);

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const tmp = dataFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
      fs.renameSync(tmp, dataFile);
    }, 300);
  }
  const safeName = (name) => path.join(uploadDir, path.basename(name));

  return {
    kind: 'file',
    uploadDir,
    allEvents: () => Object.values(db.events),
    async getEvent(code) {
      return db.events[code] || null;
    },
    async createEvent(make) {
      let ev;
      do ev = make(randomCode()); while (db.events[ev.code]);
      db.events[ev.code] = ev;
      save();
      return ev;
    },
    async updateEvent(code, mutator) {
      const ev = db.events[code];
      if (!ev) return { ev: null, result: { error: 'Event not found', status: 404 } };
      // Work on a copy so a failed action leaves the event untouched
      const draft = JSON.parse(JSON.stringify(ev));
      const result = mutator(draft) || { ok: true };
      if (result.error || result.skipSave) return { ev, result };
      draft.v = (ev.v || 1) + 1;
      db.events[code] = draft;
      save();
      return { ev: draft, result };
    },
    async putMedia(name, buf) {
      fs.writeFileSync(safeName(name), buf);
    },
    async getMedia(name) {
      try {
        return { buf: fs.readFileSync(safeName(name)), type: MEDIA_TYPES[path.extname(name).slice(1)] || 'application/octet-stream' };
      } catch {
        return null;
      }
    },
    async delMedia(name) {
      fs.promises.unlink(safeName(name)).catch(() => {});
    },
  };
}

/* ------------------------------------------------------------------ */
function missingStore() {
  const fail = async () => {
    throw new StoreError(
      'Storage is not set up. In your Vercel project open Storage → Create Database → Upstash (Redis), connect it to this project, then redeploy.',
      503,
    );
  };
  return { kind: 'none', getEvent: fail, createEvent: fail, updateEvent: fail, putMedia: fail, getMedia: fail, delMedia: fail };
}

// Finds the Upstash variables, including ones Vercel added with a custom prefix (e.g. DMB_KV_REST_API_URL)
function redisEnv() {
  const env = process.env;
  const pairs = [['KV_REST_API_URL', 'KV_REST_API_TOKEN'], ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']];
  for (const [u, t] of pairs) if (env[u] && env[t]) return { url: env[u], token: env[t] };
  for (const name of Object.keys(env)) {
    for (const [u, t] of pairs) {
      if (name.endsWith('_' + u) && env[name]) {
        const tok = env[name.slice(0, -u.length) + t];
        if (tok) return { url: env[name], token: tok };
      }
    }
  }
  return {};
}

function createStore() {
  const { url, token } = redisEnv();
  if (url && token) return redisStore(url, token);
  if (process.env.VERCEL) return missingStore(); // Vercel's disk is read-only
  return fileStore(process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'events.json'));
}

module.exports = { createStore, StoreError };
