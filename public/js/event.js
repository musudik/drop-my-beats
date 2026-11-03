/* Participant view */
(() => {
  const { $, $$, esc, store, userId, toast, icons, fmtDur, ago, art, codeFromPath, setServerTime, bombPill, viewImage } = DMB;
  const code = codeFromPath();
  const uid = userId();
  let name = store.get('name', '');
  let state = null;
  let tab = 'queue';
  let pendingSong = null;

  $('#meBtn').innerHTML = icons.user;
  $('#qIcon').innerHTML = icons.search;
  $$('[data-close]').forEach((b) => { b.innerHTML = icons.close; b.onclick = closeSheets; });
  $('#requestBtn').insertAdjacentHTML('afterbegin', icons.search.replace('<svg', '<svg width="22" height="22"'));

  /* ---------------- sheets ---------------- */
  function openSheet(id) {
    $$('.sheet.open').forEach((s) => s.classList.remove('open'));
    $('#bg').classList.add('open');
    $('#' + id).classList.add('open');
  }
  function closeSheets(force) {
    if (!name && force !== true) return; // name required before anything else
    $$('.sheet.open').forEach((s) => s.classList.remove('open'));
    $('#bg').classList.remove('open');
    stopPreview();
  }
  $('#bg').onclick = closeSheets;
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeSheets());

  /* ---------------- live connection ---------------- */
  let myHash = store.get('hash:' + code, '');
  const live = DMB.live.connect({
    code,
    mode: 'guest',
    identity: () => ({ userId: uid, name }),
    onState: (s, fresh) => render(s, fresh),
    onStatus: (ok) => $('#conn').classList.toggle('hidden', ok),
    onNotFound: () => {
      $('#main').innerHTML = `<div class="empty"><img src="/img/logo-mark.png" alt=""><h2 style="font-size:22px">Event not found</h2><p>Check the code or scan the QR again.</p><a class="btn" href="/">Back home</a></div>`;
      $('.fab-bar').classList.add('hidden');
      closeSheets(true);
    },
  });
  async function emit(type, data) {
    const res = await live.act(type, data);
    if (res.userHash && res.userHash !== myHash) { myHash = res.userHash; store.set('hash:' + code, myHash); if (state) render(state); }
    return res;
  }
  async function join() {
    if (!name) return;
    const res = await emit('join');
    if (res.error) toast(res.error, true);
  }
  join();

  /* ---------------- name ---------------- */
  if (!name) openSheet('nameSheet');
  $('#nameInput').value = name;
  $('#nameForm').onsubmit = (e) => {
    e.preventDefault();
    const n = $('#nameInput').value.trim();
    if (!n) return;
    name = n;
    store.set('name', n);
    closeSheets();
    join();
    toast('Welcome, ' + n + '! 🎶');
  };
  $('#meBtn').onclick = () => { openSheet('nameSheet'); setTimeout(() => $('#nameInput').focus(), 250); };

  /* ---------------- render ---------------- */
  $$('.tabs button').forEach((b) => b.onclick = () => {
    tab = b.dataset.tab;
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  });

  function render(s, fresh) {
    if (!s) return;
    // Mark my requests and likes (the shared state only carries anonymous tags)
    const mark = (r) => { r.mine = !!myHash && r.byH === myHash; r.liked = !!myHash && (r.likeH || []).includes(myHash); };
    s.queue.forEach(mark); s.played.forEach(mark); if (s.nowPlaying) mark(s.nowPlaying);
    state = s;
    if (fresh) setServerTime(s.serverTime);
    document.title = s.name + ' · DropMyBeats';
    $('#evTitle').textContent = [s.name, s.djName && 'with ' + s.djName].filter(Boolean).join(' ');
    renderBrand(s);
    $('#ended').classList.toggle('hidden', s.status !== 'ended');
    $('#paused').classList.toggle('hidden', s.status === 'ended' || s.settings.requestsOpen);
    $('#announce').classList.toggle('hidden', !s.announcement);
    $('#announceText').textContent = s.announcement;
    $('.fab-bar').classList.toggle('hidden', s.status === 'ended');
    $('#requestBtn').disabled = !s.settings.requestsOpen;

    const np = s.nowPlaying;
    $('#nowPlaying').classList.toggle('hidden', !np);
    if (np) {
      $('#nowPlaying').innerHTML = `
        <div class="label"><span class="eq"><i></i><i></i><i></i></span> Now playing</div>
        <div class="np">${art(np.artwork)}<div class="grow"><div class="t">${esc(np.title)}</div><div class="muted">${esc(np.artist)}</div><div class="faint small">Requested by ${esc(np.by)}${np.likes ? ` · ♥ ${np.likes}` : ''}</div></div></div>`;
    }
    const mine = s.queue.filter((r) => r.mine).length;
    $('#cQueue').textContent = s.queue.length || '';
    $('#cMine').textContent = mine || '';
    const st = s.settings;
    $('#bombHint').classList.toggle('hidden', !st.timeBombEnabled);
    $('#bombHint').innerHTML = `💣 <b>TimeBomb is on:</b> requests drop after ${st.timeBombMinutes} min unless played${st.defuseLikes ? `, they reach ${st.defuseLikes} likes` : ''}${st.tipsEnabled ? ', or someone tips' : ''}.`;
    renderList();
  }

  let brandKey = '';
  function renderBrand(s) {
    const k = [s.logoUrl, s.posterUrl, s.name, s.djName, s.venue].join('|');
    if (k === brandKey) return; // avoid reloading images on every queue update
    brandKey = k;
    const tb = $('.topbar a img');
    tb.src = s.logoUrl || '/img/logo-mark.png';
    tb.classList.toggle('ev-mark', !!s.logoUrl);
    const hasBrand = s.logoUrl || s.posterUrl;
    const hero = $('#evHero');
    hero.classList.toggle('hidden', !hasBrand);
    hero.classList.toggle('has-poster', !!s.posterUrl);
    if (hasBrand) {
      const sub = [s.djName && 'with ' + s.djName, s.venue].filter(Boolean).join(' · ');
      hero.innerHTML = `
        ${s.posterUrl ? `<button class="poster" id="posterBtn" aria-label="View the event poster"><img src="${esc(s.posterUrl)}" alt="${esc(s.name)} poster"><span class="expand">View poster</span></button>` : ''}
        <div class="info">
          ${s.logoUrl ? `<img class="ev-logo" src="${esc(s.logoUrl)}" alt="${esc(s.name)} logo">` : ''}
          <div class="grow"><h1>${esc(s.name)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
        </div>`;
      const pb = $('#posterBtn');
      if (pb) pb.onclick = () => viewImage(s.posterUrl, s.name + ' poster');
    }
    const nb = $('#nameBrand');
    const img = s.posterUrl || s.logoUrl;
    nb.classList.toggle('hidden', !img);
    nb.innerHTML = img ? `<img src="${esc(img)}" alt="${esc(s.name)}"><div style="margin-top:10px;font-family:var(--display);font-weight:800;font-size:18px">${esc(s.name)}</div>` : '';
  }

  function renderList() {
    if (!state) return;
    const s = state;
    let items;
    if (tab === 'queue') items = s.queue;
    else if (tab === 'mine') items = [...s.queue.filter((r) => r.mine), ...(s.nowPlaying && s.nowPlaying.mine ? [s.nowPlaying] : []), ...s.played.filter((r) => r.mine)];
    else items = s.played;

    if (!items.length) {
      const msg = tab === 'queue' ? 'No requests yet. Be the first to drop a beat!' : tab === 'mine' ? "You haven't requested anything yet." : 'Nothing played from requests yet.';
      $('#list').innerHTML = `<div class="empty"><img src="/img/logo-mark.png" alt=""><div>${msg}</div></div>`;
      return;
    }
    $('#list').innerHTML = items.map((r, i) => songRow(r, i, tab)).join('');
  }

  function songRow(r, i, view) {
    const st = state.settings;
    const queued = r.status === 'queued';
    const statusPill = r.status === 'played' ? `<span class="pill">Played ${ago(r.playedAt)}</span>` : r.status === 'playing' ? '<span class="pill pin">Playing now</span>' : '';
    const tipPill = r.tipTotal ? `<span class="pill tip">${esc(st.currency)}${r.tipTotal}</span>` : '';
    const likeBtn = queued
      ? `<button class="like-btn ${r.liked ? 'on' : ''}" data-like="${r.id}" ${r.mine ? 'disabled title="Your request"' : ''} aria-label="${r.liked ? 'Unlike' : 'Like'} ${esc(r.title)}" aria-pressed="${!!r.liked}">${icons.heart}<span>${r.likes}</span></button>`
      : `<div class="like-btn" style="cursor:default" aria-label="${r.likes} likes">${icons.heart}<span>${r.likes}</span></div>`;
    const actions = queued && (st.tipsEnabled || r.mine)
      ? `<div class="row" style="margin-top:8px;gap:6px">
          ${st.tipsEnabled ? `<button class="btn sm dark" data-tip="${r.id}">${esc(st.currency.trim())} Boost</button>` : ''}
          ${r.mine ? `<button class="btn sm ghost" data-withdraw="${r.id}">Remove</button>` : ''}
        </div>` : '';
    return `<div class="song ${r.mine ? 'mine' : ''}">
      ${view === 'queue' ? `<div class="rank">${i + 1}</div>` : ''}
      ${art(r.artwork)}
      <div class="meta">
        <div class="t">${esc(r.title)}${r.explicit ? ' <span class="pill explicit">E</span>' : ''}</div>
        <div class="a">${esc(r.artist)}</div>
        <div class="by"><span>${r.mine ? 'You' : esc(r.by)}</span>${statusPill}${queued ? bombPill(r, st) : ''}${tipPill}</div>
        ${actions}
      </div>
      ${likeBtn}
    </div>`;
  }

  $('#list').addEventListener('click', async (e) => {
    const like = e.target.closest('[data-like]');
    const tip = e.target.closest('[data-tip]');
    const wd = e.target.closest('[data-withdraw]');
    if (like && !like.disabled) {
      if (!name) return openSheet('nameSheet');
      like.classList.add('pop');
      const res = await emit('like', { id: like.dataset.like });
      if (res.error) toast(res.error, true);
    } else if (tip) {
      openTip(tip.dataset.tip);
    } else if (wd) {
      if (!confirm('Remove your request?')) return;
      const res = await emit('withdraw', { id: wd.dataset.withdraw });
      res.error ? toast(res.error, true) : toast('Request removed');
    }
  });

  /* ---------------- search ---------------- */
  $('#requestBtn').onclick = () => {
    if (!name) return openSheet('nameSheet');
    openSheet('searchSheet');
    setTimeout(() => $('#q').focus(), 260);
  };

  let searchTimer, searchSeq = 0, lastResults = [];
  $('#q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 350);
  });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(); $('#q').blur(); } });

  async function doSearch() {
    const q = $('#q').value.trim();
    const seq = ++searchSeq;
    if (q.length < 2) return;
    $('#results').innerHTML = '<div class="empty">Searching…</div>';
    try {
      const r = await fetch('/api/search?q=' + encodeURIComponent(q));
      const j = await r.json();
      if (seq !== searchSeq) return;
      lastResults = j.results || [];
      // Cloud servers are sometimes blocked by Apple: ask iTunes straight from the phone instead
      if (!lastResults.length && j.source !== 'mock') {
        lastResults = await itunesFromBrowser(q).catch(() => []);
        if (seq !== searchSeq) return;
        if (lastResults.length) j.offline = false;
      }
      if (!lastResults.length) {
        $('#results').innerHTML = `<div class="empty">${j.offline ? 'Song search is offline right now.' : 'No matches. Try a different spelling, or add the artist.'}</div>${manualForm(q)}`;
        return;
      }
      const inQueue = new Set((state ? state.queue : []).map((x) => (x.title + '|' + x.artist).toLowerCase()));
      $('#results').innerHTML = lastResults.map((t, i) => {
        const queued = inQueue.has((t.title + '|' + t.artist).toLowerCase());
        return `<div class="result">
          <button class="play-prev" data-prev="${i}" aria-label="Preview ${esc(t.title)}" ${t.previewUrl ? '' : 'disabled'}>
            ${t.artwork ? `<img src="${esc(t.artwork)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="art" style="width:100%;height:100%;border-radius:0"></div>'}
            ${t.previewUrl ? `<span class="ov">${icons.play}</span>` : ''}
          </button>
          <div class="meta">
            <div class="t">${esc(t.title)}${t.explicit ? ' <span class="pill explicit">E</span>' : ''}</div>
            <div class="a">${esc(t.artist)}</div>
            <div class="x">${esc([t.album, t.year, fmtDur(t.duration)].filter(Boolean).join(' · '))}</div>
          </div>
          <button class="btn sm ${queued ? 'dark' : ''}" data-pick="${i}">${queued ? '♥ Like' : 'Pick'}</button>
        </div>`;
      }).join('') + `<p class="faint small center" style="margin:16px 0 4px">Can't find it?</p>${manualForm(q)}`;
    } catch {
      $('#results').innerHTML = `<div class="empty">Search failed. Check your connection.</div>${manualForm(q)}`;
    }
  }

  function itunesFromBrowser(q) {
    return new Promise((ok, bad) => {
      const cb = '_dmbIt' + Date.now();
      const sc = document.createElement('script');
      const done = (v) => { delete window[cb]; sc.remove(); clearTimeout(t); v instanceof Error ? bad(v) : ok(v); };
      const t = setTimeout(() => done(new Error('timeout')), 7000);
      window[cb] = (j) => done((j.results || []).map((x) => ({
        source: 'itunes', sourceId: String(x.trackId), title: x.trackName, artist: x.artistName, album: x.collectionName,
        artwork: (x.artworkUrl100 || '').replace('100x100bb', '300x300bb'), previewUrl: x.previewUrl || '',
        duration: x.trackTimeMillis ? Math.round(x.trackTimeMillis / 1000) : 0, explicit: x.trackExplicitness === 'explicit',
        year: x.releaseDate ? x.releaseDate.slice(0, 4) : '', trackUrl: x.trackViewUrl || '',
      })));
      sc.onerror = () => done(new Error('failed'));
      sc.src = `https://itunes.apple.com/search?media=music&entity=song&limit=25&country=IN&term=${encodeURIComponent(q)}&callback=${cb}`;
      document.head.appendChild(sc);
    });
  }

  function manualForm(q) {
    return `<form class="card stack" id="manual" style="margin-top:8px">
      <div class="small muted">Type the exact song details yourself:</div>
      <input class="input" name="title" placeholder="Song title" value="${esc(q)}" required maxlength="120">
      <input class="input" name="artist" placeholder="Artist / movie" maxlength="120">
      <button class="btn dark block">Use this</button></form>`;
  }

  $('#results').addEventListener('submit', (e) => {
    if (e.target.id !== 'manual') return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    confirmSong({ title: f.title.trim(), artist: f.artist.trim(), source: 'manual' });
  });

  $('#results').addEventListener('click', (e) => {
    const p = e.target.closest('[data-prev]');
    const pick = e.target.closest('[data-pick]');
    if (p) togglePreview(lastResults[p.dataset.prev], p);
    if (pick) confirmSong(lastResults[pick.dataset.pick]);
  });

  /* audio preview (30s clips from the search provider) */
  const audio = $('#preview');
  let playingBtn = null;
  function togglePreview(t, btn) {
    if (!t || !t.previewUrl) return;
    if (playingBtn === btn && !audio.paused) return stopPreview();
    stopPreview();
    audio.src = t.previewUrl;
    audio.play().catch(() => {});
    playingBtn = btn;
    btn.querySelector('.ov').innerHTML = icons.pause;
  }
  function stopPreview() {
    audio.pause();
    if (playingBtn) { const ov = playingBtn.querySelector('.ov'); if (ov) ov.innerHTML = icons.play; }
    playingBtn = null;
  }
  audio.onended = stopPreview;

  function confirmSong(t) {
    stopPreview();
    pendingSong = t;
    const st = state.settings;
    if (t.explicit && !st.allowExplicit) return toast('Explicit tracks are not allowed at this event', true);
    $('#confirmBody').innerHTML = `
      <div class="song" style="background:var(--card-2)">${art(t.artwork)}<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || 'Unknown artist')}</div>${t.album ? `<div class="by">${esc(t.album)}${t.year ? ' · ' + esc(t.year) : ''}</div>` : ''}</div></div>
      <label class="field"><span>Shout-out for the DJ (optional)</span><input id="note" class="input" maxlength="140" placeholder="It's my birthday! 🎂"></label>
      <button class="btn block" id="sendReq">Send to the DJ</button>
      <p class="faint small center" style="margin:0">If it's already in the queue, we'll add your like instead.</p>`;
    openSheet('confirmSheet');
    $('#sendReq').onclick = sendRequest;
  }

  async function sendRequest() {
    const btn = $('#sendReq');
    btn.disabled = true;
    const res = await emit('request', { ...pendingSong, note: $('#note').value });
    btn.disabled = false;
    if (res.error) return toast(res.error, true);
    $('#q').value = '';
    $('#results').innerHTML = '';
    tab = 'queue';
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'queue'));
    renderList();
    if (res.merged) { closeSheets(); return toast('Already requested, we added your like ♥'); }
    toast('Request sent! 🎧');
    if (state.settings.tipsEnabled) {
      // wait for the live queue to include the new request, then offer a boost
      for (let i = 0; i < 20 && !state.queue.some((x) => x.id === res.id); i++) await new Promise((r) => setTimeout(r, 100));
      openTip(res.id, true);
    } else closeSheets();
  }

  /* ---------------- tips ---------------- */
  function openTip(rid, afterRequest) {
    const st = state.settings;
    const r = state.queue.find((x) => x.id === rid);
    if (!r) return closeSheets();
    const useUpi = !!st.upiId && (st.currencyCode || 'INR') === 'INR';
    let amount = st.tipAmounts.length ? st.tipAmounts[Math.min(1, st.tipAmounts.length - 1)] : 0;
    const cur = esc(st.currency.trim());
    $('#tipTitle').textContent = afterRequest ? 'Boost your request?' : 'Boost this song';
    $('#tipBody').innerHTML = `
      <p class="muted" style="margin:0">A tip moves <b style="color:var(--text)">${esc(r.title)}</b> up the queue${st.timeBombEnabled ? ' and defuses its TimeBomb 💣' : ''}.</p>
      ${st.tipAmounts.length ? `<div class="tip-grid">${st.tipAmounts.map((a) => `<button type="button" data-amt="${a}" class="${a === amount ? 'on' : ''}">${cur}${a}</button>`).join('')}</div>` : ''}
      <label class="field"><span>${st.tipAmounts.length ? 'Or enter your own amount' : 'Enter an amount'}</span>
        <div style="position:relative"><span style="position:absolute;left:16px;top:50%;transform:translateY(-50%);font-weight:800;color:var(--muted)">${cur}</span>
        <input id="customAmt" class="input" type="number" inputmode="decimal" min="1" step="any" placeholder="0" value="${st.tipAmounts.length ? '' : ''}" style="padding-left:${16 + cur.length * 11}px;font-size:22px;font-weight:800;font-family:var(--display)"></div></label>
      <button class="btn block" id="payBtn" ${amount ? '' : 'disabled'}>${useUpi ? 'Pay with UPI' : 'Pledge tip'} · ${cur}<span id="amt">${amount || 0}</span></button>
      ${useUpi ? `<p class="faint small center" style="margin:0">Opens your UPI app (GPay, PhonePe, Paytm…) to pay ${esc(st.upiName || 'the DJ')}.</p>` : '<p class="faint small center" style="margin:0">Pay the DJ in person. They will confirm it.</p>'}
      ${afterRequest ? '<button class="btn ghost block" data-skip>Maybe later</button>' : ''}`;
    openSheet('tipSheet');
    const setAmt = (a) => { amount = a; $('#amt').textContent = a || 0; $('#payBtn').disabled = !(a > 0); };
    $$('#tipBody [data-amt]').forEach((b) => b.onclick = () => {
      $$('#tipBody [data-amt]').forEach((x) => x.classList.toggle('on', x === b));
      $('#customAmt').value = '';
      setAmt(Number(b.dataset.amt));
    });
    $('#customAmt').addEventListener('input', (e) => {
      $$('#tipBody [data-amt]').forEach((x) => x.classList.remove('on'));
      setAmt(Math.round(Number(e.target.value) * 100) / 100);
    });
    if (!st.tipAmounts.length && !afterRequest) setTimeout(() => $('#customAmt').focus(), 260);
    const skip = $('#tipBody [data-skip]');
    if (skip) skip.onclick = closeSheets;
    $('#payBtn').onclick = async () => {
      const res = await emit('tip', { id: rid, amount });
      if (res.error) return toast(res.error, true);
      closeSheets();
      toast('Thanks for the tip! 🔥');
      if (useUpi) {
        const p = new URLSearchParams({ pa: st.upiId, pn: st.upiName || 'DJ', am: String(amount), cu: 'INR', tn: ('DropMyBeats ' + r.title).slice(0, 50) });
        location.href = 'upi://pay?' + p.toString().replace(/\+/g, '%20');
      }
    };
  }
})();
