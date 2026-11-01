/* Shared helpers for every DropMyBeats page */
window.DMB = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('dmb:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('dmb:' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('dmb:' + k); } catch {} },
  };

  function userId() {
    let u = store.get('uid');
    if (!u) { u = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('uid', u); }
    return u;
  }

  let toastTimer;
  function toast(msg, isErr) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  const icons = {
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.1 4.5c2 0 3.4 1.1 4.9 2.9 1.5-1.8 2.9-2.9 4.9-2.9 3.5 0 5.6 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/></svg>',
  };

  function fmtLeft(ms) {
    if (ms <= 0) return '0:00';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    if (m >= 60) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    return m + ':' + String(s % 60).padStart(2, '0');
  }
  function fmtDur(sec) { if (!sec) return ''; return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function ago(t, now = Date.now()) {
    const m = Math.round((now - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    return Math.floor(m / 60) + 'h ago';
  }
  const art = (url, cls = 'art') => url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="${cls}" aria-hidden="true"></div>`;

  function codeFromPath() {
    const m = location.pathname.match(/\/(?:e|dj|screen)\/([A-Za-z0-9]+)/);
    return m ? m[1].toUpperCase() : '';
  }

  // Server clock offset so countdowns are right on every phone
  let skew = 0;
  const setServerTime = (t) => { if (t) skew = t - Date.now(); };
  const now = () => Date.now() + skew;

  function bombPill(r, settings) {
    if (!settings.timeBombEnabled) return '';
    if (r.pinned) return '<span class="pill pin">📌 Pinned</span>';
    if (!r.expiresAt) return r.defused ? '<span class="pill safe">✓ Defused</span>' : '';
    const left = r.expiresAt - now();
    const hot = left < 5 * 60000;
    return `<span class="pill bomb ${hot ? 'hot' : ''}" data-exp="${r.expiresAt}">💣 <b>${fmtLeft(left)}</b></span>`;
  }
  // Tick all bomb countdowns once a second without re-rendering
  setInterval(() => {
    for (const el of $$('[data-exp]')) {
      const left = Number(el.dataset.exp) - now();
      const b = el.querySelector('b');
      if (b) b.textContent = fmtLeft(left);
      el.classList.toggle('hot', left < 5 * 60000);
    }
  }, 1000);

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied: ' + text); }
    catch { prompt('Copy this:', text); }
  }

  /* Resize a photo in the browser before upload: logos ≤ 600px, posters ≤ 1600px */
  async function shrinkImage(file, kind) {
    if (!/^image\//.test(file.type)) throw new Error('Please choose an image file');
    // Keep animated GIF logos as they are (if they're a sensible size)
    if (file.type === 'image/gif' && file.size <= 3 * 1024 * 1024) return file;
    const maxSide = kind === 'logo' ? 600 : 1600;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("Couldn't read that image")); i.src = url; });
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const toBlob = (type, q) => new Promise((ok) => c.toBlob(ok, type, q));
      // Logos keep transparency (WebP, else PNG); posters become JPEG
      let blob = kind === 'logo' ? await toBlob('image/webp', 0.9) : await toBlob('image/jpeg', 0.86);
      if (!blob || (kind === 'logo' && blob.type !== 'image/webp')) blob = await toBlob('image/png');
      if (!blob) throw new Error("Couldn't process that image");
      return blob;
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadMedia(code, kind, file, key) {
    const blob = await shrinkImage(file, kind);
    const r = await fetch(`/api/events/${code}/media/${kind}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream', 'x-admin-key': key }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Upload failed');
    return j.url;
  }
  async function removeMedia(code, kind, key) {
    const r = await fetch(`/api/events/${code}/media/${kind}`, { method: 'DELETE', headers: { 'x-admin-key': key } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not remove');
  }

  /* Full-screen poster viewer */
  function viewImage(src, alt) {
    const d = document.createElement('div');
    d.className = 'lightbox';
    d.setAttribute('role', 'dialog');
    d.innerHTML = `<img src="${esc(src)}" alt="${esc(alt || '')}"><button class="icon-btn" aria-label="Close">${icons.close}</button>`;
    const close = () => { d.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => e.key === 'Escape' && close();
    d.onclick = close;
    document.addEventListener('keydown', onKey);
    document.body.appendChild(d);
  }

  return { $, $$, esc, store, userId, toast, icons, fmtLeft, fmtDur, ago, art, codeFromPath, setServerTime, now, bombPill, copy, shrinkImage, uploadMedia, removeMedia, viewImage };
})();
