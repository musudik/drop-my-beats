/* Guest view of the event details: schedule, food menu, parking, general info */
(() => {
  const { $, $$, esc, codeFromPath, viewImage, bigArt } = DMB;
  const code = codeFromPath();
  $('#backBtn').href = '/e/' + code;

  const LABELS = { general: 'Details', schedule: 'Schedule', food: 'Food menu', parking: 'Parking' };
  const ICONS = {
    general: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    food: '<path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8M7 7h4M17 3c-2 2-2 7 0 9v9"/>',
    parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
  };
  const icon = (k) => `<svg class="sec-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
  const FOOD_TAG = { veg: 'Veg', nonveg: 'Non-veg', vegan: 'Vegan', drink: 'Drink' };

  // escape, keep line breaks, make links tappable
  const rich = (t) => esc(t)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(\+?\d[\d\s-]{7,}\d)/g, (m, s, n) => `${s}<a href="tel:${n.replace(/[\s-]/g, '')}">${n}</a>`)
    .replace(/\n/g, '<br>');
  const mapsUrl = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  const mapsBtn = (addr) => addr ? `<a class="btn sm map-btn" href="${mapsUrl(addr)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.general}</svg>Open in Maps</a>` : '';

  function photos(list, label) {
    if (!list.length) return '';
    return `<div class="info-photos">${list.map((u, i) => `
      <button class="info-photo" data-img="${esc(u)}" aria-label="Open ${esc(label)} photo ${i + 1}">
        <img src="${esc(u)}" alt="${esc(label)} photo ${i + 1}" loading="lazy"><span class="zoom">Tap to zoom</span>
      </button>`).join('')}</div>`;
  }

  // "7:30 PM", "19:30", "7pm" → minutes after midnight (or null)
  function minutesOf(t) {
    const m = String(t).trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  // Mark what's happening now, when the schedule times can be read
  function nowIndex(items) {
    const mins = items.map((it) => minutesOf(it.a));
    if (!mins.length || mins.some((x) => x === null)) return -1;
    const d = new Date();
    let now = d.getHours() * 60 + d.getMinutes();
    // parties run past midnight: treat early-morning times as "after" the evening ones
    const first = mins[0];
    const adj = (x) => (x < first - 6 * 60 ? x + 1440 : x);
    if (now < first - 6 * 60) now += 1440;
    // only while the event is on: from the first slot until 2 hours after the last one
    if (now < first || now > adj(mins[mins.length - 1]) + 120) return -1;
    let idx = -1;
    mins.forEach((x, i) => { if (adj(x) <= now) idx = i; });
    return idx;
  }

  function sectionHtml(k, sec) {
    let body = '';
    if (k === 'general') {
      body += sec.when ? `<div class="fact"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.schedule}</svg><div><b>When</b><span>${esc(sec.when)}</span></div></div>` : '';
      body += sec.address ? `<div class="fact"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.general}</svg><div><b>Where</b><span>${esc(sec.address)}</span>${mapsBtn(sec.address)}</div></div>` : '';
      body += sec.text ? `<div class="info-text">${rich(sec.text)}</div>` : '';
    } else if (k === 'schedule') {
      if (sec.items.length) {
        const ni = nowIndex(sec.items);
        body += `<ol class="timeline">${sec.items.map((it, i) => `
          <li class="${i === ni ? 'now' : i < ni ? 'past' : ''}">
            <span class="tl-time">${esc(it.a)}</span>
            <span class="tl-what">${esc(it.b)}${i === ni ? '<em class="now-chip">Now</em>' : ''}</span>
          </li>`).join('')}</ol>`;
      }
      body += sec.text ? `<div class="info-text">${rich(sec.text)}</div>` : '';
    } else if (k === 'food') {
      if (sec.items.length) {
        const tags = [...new Set(sec.items.map((it) => it.tag).filter(Boolean))];
        body += `<ul class="menu">${sec.items.map((it) => `
          <li>${it.tag ? `<i class="ftag ${it.tag}" title="${FOOD_TAG[it.tag]}" aria-label="${FOOD_TAG[it.tag]}"></i>` : '<i class="ftag none" aria-hidden="true"></i>'}
            <span class="dish">${esc(it.a)}</span><span class="price">${esc(it.b)}</span></li>`).join('')}</ul>`;
        if (tags.length) body += `<div class="legend">${tags.map((t) => `<span><i class="ftag ${t}"></i>${FOOD_TAG[t]}</span>`).join('')}</div>`;
      }
      body += sec.text ? `<div class="info-text">${rich(sec.text)}</div>` : '';
    } else if (k === 'parking') {
      body += sec.address ? `<div class="fact"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.parking}</svg><div><b>Parking at</b><span>${esc(sec.address)}</span>${mapsBtn(sec.address)}</div></div>` : '';
      body += sec.text ? `<div class="info-text">${rich(sec.text)}</div>` : '';
    }
    body += photos(sec.images, LABELS[k]);
    return `<section class="info-sec" id="${k}"><h2>${icon(k)}${LABELS[k]}</h2>${body}</section>`;
  }

  const has = (s) => !!(s.text || s.address || s.when || s.items.length || s.images.length);
  let last = '';

  async function load() {
    let r, d;
    try {
      r = await fetch(`/api/events/${code}/info`);
      d = await r.json();
    } catch {
      return; // keep what's on screen; try again on the next poll
    }
    if (r.status === 404) {
      $('#main').innerHTML = '<div class="empty" style="padding-top:60px"><h2 style="font-size:22px">Event not found</h2><p>Check the code or scan the QR again.</p><a class="btn" href="/">Back home</a></div>';
      return;
    }
    const sig = JSON.stringify(d);
    if (sig === last) return;
    last = sig;
    render(d);
  }

  function render(d) {
    document.title = `${d.name} · Event info`;
    $('#evName').textContent = d.name;
    $('#evTitle').textContent = [d.djName && 'with ' + d.djName, d.venue].filter(Boolean).join(', ') || 'Event info';
    const lg = $('#evLogo');
    if (d.logoUrl && lg.getAttribute('src') !== d.logoUrl) lg.src = d.logoUrl;
    lg.classList.toggle('hidden', !d.logoUrl);
    const amb = $('#ambientImg');
    const ambSrc = d.posterUrl || d.logoUrl;
    if (ambSrc && amb.dataset.src !== ambSrc) { amb.onload = () => amb.classList.add('on'); amb.src = ambSrc; amb.dataset.src = ambSrc; }

    const keys = Object.keys(LABELS).filter((k) => has(d.sections[k]));
    const tabs = $('#tabs');
    tabs.classList.toggle('hidden', keys.length < 2);
    tabs.innerHTML = keys.map((k) => `<a href="#${k}" data-tab="${k}">${LABELS[k]}</a>`).join('');

    let html = '';
    if (d.posterUrl) html += `<button class="info-poster" data-img="${esc(d.posterUrl)}" aria-label="Open the event poster"><img src="${esc(d.posterUrl)}" alt="${esc(d.name)} poster"><span class="zoom">Tap to zoom</span></button>`;
    if (!keys.length) html += `<div class="empty-line" style="margin-top:16px">The organiser hasn't added the schedule, menu or parking details yet. Check back soon.</div>`;
    html += keys.map((k) => sectionHtml(k, d.sections[k])).join('');
    $('#main').innerHTML = html;
    spy();
    if (location.hash && !render.jumped) { render.jumped = true; jumpTo(location.hash.slice(1)); }
  }

  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-img]');
    if (p) return viewImage(p.dataset.img, 'Event photo');
    const t = e.target.closest('#tabs a');
    if (t) {
      e.preventDefault();
      const el = document.getElementById(t.dataset.tab);
      if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      history.replaceState(null, '', '#' + t.dataset.tab);
    }
  });

  // Jump to a section from a link like /info#food. Photos above it load later and push it down,
  // so aim again once they've loaded (unless the guest has started scrolling themselves).
  function jumpTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    let userScrolled = false;
    const stop = () => { userScrolled = true; };
    addEventListener('touchstart', stop, { once: true, passive: true });
    addEventListener('wheel', stop, { once: true, passive: true });
    const go = () => { if (!userScrolled) el.scrollIntoView(); };
    go();
    const imgs = $$('#main img').filter((im) => !im.complete && (im.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    imgs.forEach((im) => { im.loading = 'eager'; im.addEventListener('load', go, { once: true }); im.addEventListener('error', go, { once: true }); });
    setTimeout(go, 1500);
  }

  // highlight the tab of the section on screen
  let spyRaf = 0;
  function spy() {
    const line = innerHeight * 0.35;
    let active = '';
    for (const s of $$('.info-sec')) if (s.getBoundingClientRect().top < line) active = s.id;
    $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === active));
  }
  addEventListener('scroll', () => { if (!spyRaf) spyRaf = requestAnimationFrame(() => { spyRaf = 0; spy(); }); }, { passive: true });

  load();
  setInterval(() => { if (!document.hidden) load(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
