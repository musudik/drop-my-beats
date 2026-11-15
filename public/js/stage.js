/* DropMyBeats — motion pieces shared by the guest page, DJ console and big screen:
 * the record player deck, +1 bursts, FLIP re-ordering and the up-next card carousel. */
DMB.stage = (() => {
  const { esc, cover, bigArt, genBg, initials, fmtDur } = DMB;
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RING = 603.2; // circumference of the progress ring (r = 96)

  /* ---------- Record player ---------- */
  function deck(root, { textEl, ambientImg }) {
    const disc = root.querySelector('.disc');
    const label = root.querySelector('.label');
    const ring = root.querySelector('.ring-fill');
    if (!root.querySelector('.glow')) root.querySelector('.turntable').insertAdjacentHTML('afterbegin', '<div class="glow"></div>');
    let key = null;
    let song = null;

    function setAmbient(url) {
      if (!ambientImg) return;
      if (!url) { ambientImg.classList.remove('on'); return; }
      if (ambientImg.dataset.src === url) return;
      ambientImg.classList.remove('on');
      const im = new Image();
      im.referrerPolicy = 'no-referrer';
      im.onload = () => { ambientImg.src = url; ambientImg.dataset.src = url; requestAnimationFrame(() => ambientImg.classList.add('on')); };
      im.src = url;
    }

    function tick() {
      if (!ring) return;
      const timeEl = textEl && textEl.querySelector('[data-np-time]');
      if (!song || !song.playedAt) { ring.style.strokeDashoffset = RING; if (timeEl) timeEl.textContent = ''; return; }
      const elapsed = Math.max(0, DMB.now() - song.playedAt) / 1000;
      if (song.duration) {
        const pct = Math.min(1, elapsed / song.duration);
        ring.style.strokeDashoffset = String(RING * (1 - pct));
        if (timeEl) timeEl.textContent = `${fmtDur(Math.min(Math.round(elapsed), song.duration)) || '0:00'} / ${fmtDur(song.duration)}`;
      } else {
        ring.style.strokeDashoffset = String(RING * 0.999);
        if (timeEl) timeEl.textContent = fmtDur(Math.round(elapsed)) || '0:00';
      }
    }
    setInterval(tick, 1000);

    /** s: { song, fallbackArt, fallbackTitle, html(song) → static text HTML, live(song) → updates dynamic bits } */
    function set(s) {
      song = s.song || null;
      const playing = !!song;
      root.classList.toggle('playing', playing);
      root.classList.toggle('idle', !playing);
      const art = playing ? song.artwork : s.fallbackArt;
      const title = playing ? song.title : s.fallbackTitle;
      const k = playing ? 'song:' + song.id : 'idle:' + (art || '') + title;
      if (k !== key) {
        key = k;
        label.innerHTML = art ? `<img src="${esc(bigArt(art))}" alt="" referrerpolicy="no-referrer">` : `<div class="gen" style="background:${genBg(title)}">${esc(initials(title))}</div>`;
        if (!reduced()) { disc.classList.remove('drop'); void disc.offsetWidth; disc.classList.add('drop'); }
        if (textEl) textEl.innerHTML = s.html(song);
        setAmbient(art ? bigArt(art, 300) : '');
      }
      if (s.live && textEl) s.live(song, textEl);
      tick();
    }
    return { set };
  }

  /* ---------- +1 burst ---------- */
  function burst(el, text = '+1') {
    if (reduced() || !el) return;
    const r = el.getBoundingClientRect();
    const b = document.createElement('div');
    b.className = 'burst';
    b.style.left = r.left + r.width / 2 + 'px';
    b.style.top = r.top + r.height / 2 + 'px';
    let html = '';
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const d = 34 + Math.random() * 30;
      html += `<i style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px"></i>`;
    }
    b.innerHTML = html + `<b>${esc(text)}</b>`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 1000);
  }

  /* ---------- FLIP: animate rows to their new rank ---------- */
  function flip(container, render) {
    const before = new Map();
    container.querySelectorAll('[data-rid]').forEach((e) => before.set(e.dataset.rid, e.getBoundingClientRect().top));
    render();
    if (reduced()) return;
    const hadItems = before.size > 0;
    container.querySelectorAll('[data-rid]').forEach((e) => {
      const was = before.get(e.dataset.rid);
      if (was === undefined) { if (hadItems) e.classList.add('enter'); return; }
      const dy = was - e.getBoundingClientRect().top;
      if (Math.abs(dy) < 2) return;
      e.style.transition = 'none';
      e.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        e.style.transition = 'transform .7s cubic-bezier(.2,.8,.2,1)';
        e.style.transform = '';
        if (dy > 0) e.classList.add('climbed');
        setTimeout(() => { e.style.transition = ''; }, 800);
      }));
    });
  }

  /* ---------- Up-next carousel: centre card is biggest ---------- */
  function carousel(el) {
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = el.scrollLeft + el.clientWidth / 2;
      for (const c of el.children) {
        const d = Math.min(1, Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) / (c.offsetWidth * 1.1));
        c.style.setProperty('--d', d.toFixed(3));
      }
    };
    el.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    window.addEventListener('resize', update);
    return { update };
  }

  return { deck, burst, flip, carousel, reduced, cover };
})();
