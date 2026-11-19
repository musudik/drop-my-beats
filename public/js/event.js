/* Guest view */
(() => {
  const { $, $$, esc, store, userId, toast, icons, fmtDur, ago, codeFromPath, setServerTime, bombPill, viewImage, sameSong, cover, avatar, bigArt } = DMB;
  const stage = DMB.stage;
  const code = codeFromPath();
  const uid = userId();
  let name = store.get('name', '');
  let state = null;
  let tab = 'queue';
  let pendingSong = null;

  $('#qIcon').innerHTML = icons.search;
  $$('[data-close]').forEach((b) => { b.innerHTML = icons.close; b.onclick = closeSheets; });
  $('#meLabel').textContent = name || 'You';

  /* ---------------- sheets ---------------- */
  function openSheet(id) {
    $$('.sheet.open').forEach((s) => s.classList.remove('open'));
    $('#bg').classList.add('open');
    $('#' + id).classList.add('open');
  }
  function closeSheets(force) {
    if (!name && force !== true) return; // a name is needed before anything else
    $$('.sheet.open').forEach((s) => s.classList.remove('open'));
    $('#bg').classList.remove('open');
    stopPreview();
  }
  const sheetOpen = (id) => $('#' + id).classList.contains('open');
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
      $('#main').innerHTML = `<div class="empty" style="padding-top:80px"><img class="dmb-anim" src="/img/logo-anim.gif" alt="DropMyBeats"><h2 style="font-size:22px">Event not found</h2><p>Check the code or scan the QR again.</p><a class="btn" href="/">Back home</a></div>`;
      $('.dock').classList.add('hidden');
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
    const first = !name;
    name = n;
    store.set('name', n);
    $('#meLabel').textContent = n;
    closeSheets();
    join();
    toast(first ? `Welcome, ${n}! 🎶` : 'Name updated');
  };
  $('#meBtn').onclick = () => { openSheet('nameSheet'); setTimeout(() => $('#nameInput').focus(), 250); };

  /* ---------------- dock tabs ---------------- */
  const titles = { queue: 'Queue', mine: 'My requests', played: 'Played tonight' };
  $$('.dock-btn[data-tab]').forEach((b) => b.onclick = () => {
    tab = b.dataset.tab;
    $$('.dock-btn[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    $('#listTitle').textContent = titles[tab];
    renderList(false);
    $('.list-sec').scrollIntoView({ behavior: stage.reduced() ? 'auto' : 'smooth', block: 'start' });
  });

  /* ---------------- render ---------------- */
  const deck = stage.deck($('#deck'), { textEl: $('#deckText'), ambientImg: $('#ambientImg') });
  const carousel = stage.carousel($('#cards'));

  function render(s, fresh) {
    if (!s) return;
    // Mark my requests and +1s (the shared state only carries anonymous tags)
    const mark = (r) => { r.mine = !!myHash && r.byH === myHash; r.liked = !!myHash && (r.likeH || []).includes(myHash); };
    s.queue.forEach(mark); s.played.forEach(mark); if (s.nowPlaying) mark(s.nowPlaying);
    state = s;
    if (fresh) setServerTime(s.serverTime);
    document.title = s.name + ' · DropMyBeats';
    $('#evName').textContent = s.name;
    $('#evTitle').textContent = [s.djName && 'with ' + s.djName, s.venue].filter(Boolean).join(', ') || 'Live song requests';
    // event logo sits beside the event name; the animated DropMyBeats logo stays on the left
    const evLogo = $('#evLogo');
    if (s.logoUrl && evLogo.getAttribute('src') !== s.logoUrl) evLogo.src = s.logoUrl;
    evLogo.classList.toggle('hidden', !s.logoUrl);
    renderInfoLinks(s);
    renderDj(s);
    renderNameBrand(s);

    $('#ended').classList.toggle('hidden', s.status !== 'ended');
    $('#paused').classList.toggle('hidden', s.status === 'ended' || s.settings.requestsOpen);
    $('#announce').classList.toggle('hidden', !s.announcement);
    $('#announceText').textContent = s.announcement;
    $('.dock').classList.toggle('hidden', s.status === 'ended');
    $('#requestBtn').disabled = !s.settings.requestsOpen;

    renderDeck(s);
    renderCards(s);
    $('#cQueue').textContent = s.queue.length || '';
    $('#cMine').textContent = s.queue.filter((r) => r.mine).length || '';
    const st = s.settings;
    $("#bombHint").textContent = st.timeBombEnabled ? `💣 ${st.timeBombMinutes}-min fuse, ${st.defuseLikes ? st.defuseLikes + " +1s" : "a tip"} saves a song` : "";
    renderList(true);
    if (sheetOpen('searchSheet') && lastResults.length) renderResults();
  }

  function renderDeck(s) {
    const np = s.nowPlaying;
    const next = s.queue[0];
    deck.set({
      song: np,
      fallbackArt: s.posterUrl || s.logoUrl || '',
      fallbackTitle: s.name,
      html: (song) => song
        ? `<div class="np-label"><span class="eqbars"><i></i><i></i><i></i><i></i></span>Now playing</div>
           <div class="np-title">${esc(DMB.splitTitle(song.title)[0])}</div>
           ${DMB.splitTitle(song.title)[1] ? `<div class="np-sub">${esc(DMB.splitTitle(song.title)[1])}</div>` : ''}
           <div class="np-artist">${esc(song.artist)}</div>
           <div class="np-for">${avatar(song.by)} for ${song.mine ? 'you' : esc(song.by)}</div>
           <div class="np-time" data-np-time></div>`
        : `<div class="np-label" style="color:var(--smoke)">Waiting for the first drop</div>
           <div class="np-title">${esc(s.name)}</div>
           <div class="np-artist">${esc(s.djName ? 'with ' + s.djName : 'Live song requests')}</div>
           <div class="np-for" data-np-next></div>
           <button class="btn np-cta" data-cta>Request a song</button>`,
      live: (song, el) => {
        const n = el.querySelector('[data-np-next]');
        if (n) n.textContent = next ? `Up next: ${next.title}` : 'The queue is empty. Be the first!';
        const cta = el.querySelector('[data-cta]');
        if (cta) { cta.onclick = openSearch; cta.disabled = !s.settings.requestsOpen || s.status === 'ended'; }
      },
    });
  }

  let cardsSig = '';
  function renderCards(s) {
    const items = s.queue.slice(0, 8);
    $('#upnext').classList.toggle('hidden', !items.length);
    const sig = items.map((r) => [r.id, r.likes, r.liked, r.mine, r.tipTotal].join(':')).join('|');
    if (sig === cardsSig) return;
    const prevIds = new Set([...$('#cards').children].map((c) => c.dataset.rid));
    cardsSig = sig;
    $('#upnextHint').textContent = s.queue.length > 8 ? `Top 8 of ${s.queue.length}` : items.length > 1 ? 'Swipe to see more' : '';
    $('#cards').innerHTML = items.map((r, i) => `
      <article class="ucard ${prevIds.size && !prevIds.has(r.id) ? 'enter' : ''}" data-rid="${r.id}">
        ${r.artwork ? `<img class="cover" src="${esc(bigArt(r.artwork))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="gen" style="background:${DMB.genBg(r.title)}">${esc(DMB.initials(r.title))}</div>`}
        <span class="rank">#${i + 1}</span>
        ${plusBtn(r)}
        <div class="info">
          <div class="t">${esc(r.title)}</div>
          <div class="a">${esc(r.artist)}</div>
          <div class="by">${avatar(r.by)}<span>${r.mine ? 'You' : esc(r.by)}</span>${r.tipTotal ? `<span class="pill tip">${esc(s.settings.currency.trim())}${r.tipTotal}</span>` : ''}</div>
        </div>
      </article>`).join('');
    carousel.update();
  }

  function plusBtn(r) {
    if (r.status !== 'queued') return `<div class="plus1" aria-label="${r.likes} likes"><b>♥</b><small>${r.likes}</small></div>`;
    const label = r.mine ? 'Your request' : r.liked ? `Remove your +1 from ${r.title}` : `+1 ${r.title}`;
    return `<button class="plus1 ${r.liked ? 'on' : ''}" data-like="${r.id}" ${r.mine ? 'disabled' : ''} aria-label="${esc(label)}" aria-pressed="${!!r.liked}"><b>${r.liked ? '✓' : '+1'}</b><small>${r.likes}</small></button>`;
  }

  function renderList(animate) {
    if (!state) return;
    const s = state;
    let items;
    if (tab === 'queue') items = s.queue;
    else if (tab === 'mine') items = [...(s.nowPlaying && s.nowPlaying.mine ? [s.nowPlaying] : []), ...s.queue.filter((r) => r.mine), ...s.played.filter((r) => r.mine)];
    else items = s.played;

    const draw = () => {
      if (!items.length) {
        const msg = tab === 'queue' ? 'No requests yet. Tap + to drop the first beat.' : tab === 'mine' ? "You haven't requested anything yet. Tap + to pick a song." : 'Nothing has been played from requests yet.';
        $('#list').innerHTML = `<div class="empty-line">${msg}</div>`;
        return;
      }
      $('#list').innerHTML = items.map((r, i) => row(r, i)).join('');
    };
    if (animate) stage.flip($('#list'), draw); else draw();
  }

  function row(r, i) {
    const st = state.settings;
    const queued = r.status === 'queued';
    const status = r.status === 'played' ? `<span class="pill">Played ${ago(r.playedAt)}</span>` : r.status === 'playing' ? '<span class="pill pin">Playing now</span>' : '';
    const tip = r.tipTotal ? `<span class="pill tip">${esc(st.currency.trim())}${r.tipTotal}</span>` : '';
    const acts = queued && (st.tipsEnabled || r.mine)
      ? `<div class="acts">
          ${st.tipsEnabled ? `<button class="btn sm dark" data-tip="${r.id}">${esc(st.currency.trim())} Boost</button>` : ''}
          ${r.mine ? `<button class="btn sm ghost" data-withdraw="${r.id}">Remove</button>` : ''}
        </div>` : '';
    const ranked = tab === 'queue';
    return `<div class="qrow ${ranked ? '' : 'no-rank'} ${r.mine ? 'mine' : ''}" data-rid="${r.id}">
      ${ranked ? `<div class="rk">${i + 1}</div>` : ''}
      ${cover(r.artwork, r.title)}
      <div style="min-width:0">
        <div class="t">${esc(r.title)}${r.explicit ? ' <span class="pill explicit">E</span>' : ''}</div>
        <div class="a">${esc(r.artist)}</div>
        <div class="by"><span>${r.mine ? 'You' : esc(r.by)}</span>${status}${queued ? bombPill(r, st) : ''}${tip}</div>
        ${acts}
      </div>
      ${plusBtn(r)}
    </div>`;
  }

  async function toggleLike(btn, id) {
    if (!name) return openSheet('nameSheet');
    const r = state && state.queue.find((x) => x.id === id);
    const adding = r && !r.liked;
    btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
    if (adding) stage.burst(btn, '+1');
    const res = await emit('like', { id });
    if (res.error) toast(res.error, true);
    return res;
  }

  document.addEventListener('click', async (e) => {
    const like = e.target.closest('[data-like]');
    if (like && !like.disabled && (e.target.closest('#list') || e.target.closest('#cards'))) return toggleLike(like, like.dataset.like);
    const tip = e.target.closest('#list [data-tip]');
    if (tip) return openTip(tip.dataset.tip);
    const wd = e.target.closest('#list [data-withdraw]');
    if (wd) {
      if (!confirm('Remove your request?')) return;
      const res = await emit('withdraw', { id: wd.dataset.withdraw });
      res.error ? toast(res.error, true) : toast('Request removed');
    }
  });

  // Header button + chips that open the Event info page (schedule, food menu, parking, poster)
  const INFO = {
    general: ['Details', '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'],
    schedule: ['Schedule', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
    food: ['Food menu', '<path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8M7 7h4M17 3c-2 2-2 7 0 9v9"/>'],
    parking: ['Parking', '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V8h3a2.5 2.5 0 0 1 0 5h-3"/>'],
  };
  // DJ's own logo + name
  let djKey = null;
  function renderDj(s) {
    const k = (s.djlogoUrl || '') + '|' + (s.djName || '');
    if (k === djKey) return;
    djKey = k;
    const el = $('#djStrip');
    el.classList.toggle('hidden', !s.djlogoUrl);
    el.innerHTML = s.djlogoUrl ? `<img src="${esc(s.djlogoUrl)}" alt="${esc(s.djName || 'DJ')} logo"><div><span>Your DJ tonight</span><b>${esc(s.djName || 'On the decks')}</b></div>` : '';
  }

  let infoKey = '';
  function renderInfoLinks(s) {
    const keys = (s.info || []).filter((k) => INFO[k]);
    const k = keys.join(',') + '|' + (s.posterUrl ? 1 : 0);
    if (k === infoKey) return;
    infoKey = k;
    const base = `/e/${code}/info`;
    $('#infoBtn').href = base;
    $('#infoBtn').classList.toggle('hidden', !keys.length && !s.posterUrl);
    const chips = keys.map((x) => `<a href="${base}#${x}"><svg viewBox="0 0 24 24" aria-hidden="true">${INFO[x][1]}</svg>${INFO[x][0]}</a>`);
    if (s.posterUrl) chips.push(`<a href="${base}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5"/><circle cx="9.5" cy="9" r="2"/><path d="m5 18 5-5 3 3 2.5-2.5L19 17"/></svg>Poster</a>`);
    $('#infoChips').innerHTML = chips.join('');
    $('#infoChips').classList.toggle('hidden', !chips.length);
  }

  let nameBrandKey = '';
  function renderNameBrand(s) {
    const img = s.posterUrl || s.logoUrl;
    if (nameBrandKey === img + s.name) return;
    nameBrandKey = img + s.name;
    const nb = $('#nameBrand');
    nb.classList.toggle('hidden', !img);
    nb.innerHTML = img ? `<img src="${esc(img)}" alt="${esc(s.name)}"><div style="margin-top:10px;font-family:var(--display);font-weight:800;font-size:18px">${esc(s.name)}</div>` : '';
  }

  /* ---------------- search ---------------- */
  function openSearch() {
    if (!name) return openSheet('nameSheet');
    openSheet('searchSheet');
    setTimeout(() => $('#q').focus(), 260);
  }
  $('#requestBtn').onclick = openSearch;

  let searchTimer, searchSeq = 0, lastResults = [], lastQuery = '';
  $('#q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 350); });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(); $('#q').blur(); } });

  async function doSearch() {
    const q = $('#q').value.trim();
    const seq = ++searchSeq;
    if (q.length < 2) return;
    lastQuery = q;
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
        $('#results').innerHTML = `<div class="empty">${j.offline ? 'Song search is offline right now.' : 'No matches. Try another spelling, or add the artist.'}</div>${manualForm(q)}`;
        return;
      }
      renderResults();
    } catch {
      $('#results').innerHTML = `<div class="empty">Search failed. Check your connection.</div>${manualForm(q)}`;
    }
  }

  // Where does this song stand tonight? (in the queue, playing, played recently…)
  function statusOf(t) {
    const s = state;
    if (!s || !t) return { kind: 'new' };
    if (s.nowPlaying && sameSong(s.nowPlaying, t)) return { kind: 'playing', r: s.nowPlaying };
    const qi = s.queue.findIndex((r) => sameSong(r, t));
    if (qi >= 0) return { kind: 'queue', r: s.queue[qi], rank: qi + 1 };
    const p = s.played.find((r) => sameSong(r, t));
    if (p) {
      const mins = (DMB.now() - p.playedAt) / 60000;
      const block = s.settings.repeatBlockMinutes || 0;
      if (block && mins < block) return { kind: 'blocked', r: p, mins, wait: Math.max(1, Math.ceil(block - mins)) };
      return { kind: 'played', r: p, mins };
    }
    return { kind: 'new' };
  }
  const agoText = (mins) => (mins < 1 ? 'just now' : mins < 60 ? `${Math.round(mins)} min ago` : `${Math.floor(mins / 60)} h ${Math.round(mins % 60)} min ago`);

  function renderResults() {
    const scroll = $('#results').scrollTop;
    $('#results').innerHTML = lastResults.map((t, i) => {
      const st = statusOf(t);
      let badge = '', btn = `<button class="btn sm" data-pick="${i}">Pick</button>`;
      if (st.kind === 'queue') {
        const r = st.r;
        badge = `<div class="rbadge queue">#${st.rank} in the queue, ${r.likes} ${r.likes === 1 ? '+1' : '+1s'}</div>`;
        btn = r.mine ? '<button class="btn sm dark" disabled>Yours</button>'
          : `<button class="plus1 ${r.liked ? 'on' : ''}" data-plus="${i}" aria-label="${r.liked ? 'Remove your +1' : '+1 this song'}"><b>${r.liked ? '✓' : '+1'}</b><small>${r.likes}</small></button>`;
      } else if (st.kind === 'playing') {
        badge = '<div class="rbadge playing">🎧 Playing right now</div>';
        btn = '<button class="btn sm dark" disabled>Live</button>';
      } else if (st.kind === 'blocked') {
        badge = `<div class="rbadge blocked">Played ${agoText(st.mins)}</div>`;
        btn = `<button class="btn sm dark" data-pick="${i}">In ${st.wait}m</button>`;
      } else if (st.kind === 'played') {
        badge = `<div class="rbadge played">Played ${agoText(st.mins)}</div>`;
      }
      return `<div class="result ${st.kind === 'queue' ? 'is-queued' : ''}">
        <button class="play-prev" data-prev="${i}" aria-label="Preview ${esc(t.title)}" ${t.previewUrl ? '' : 'disabled'}>
          ${t.artwork ? `<img src="${esc(t.artwork)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="gen-art" style="width:100%;height:100%;background:${DMB.genBg(t.title)}">${esc(DMB.initials(t.title))}</div>`}
          ${t.previewUrl ? `<span class="ov">${icons.play}</span>` : ''}
        </button>
        <div class="meta">
          <div class="t">${esc(t.title)}${t.explicit ? ' <span class="pill explicit">E</span>' : ''}</div>
          <div class="a">${esc(t.artist)}</div>
          ${badge || `<div class="x">${esc([t.album, t.year, fmtDur(t.duration)].filter(Boolean).join(', '))}</div>`}
        </div>
        ${btn}
      </div>`;
    }).join('') + `<p class="faint small center" style="margin:16px 0 4px">Can't find it?</p>${manualForm(lastQuery)}`;
    $('#results').scrollTop = scroll;
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
      <input class="input" name="artist" placeholder="Artist or movie" maxlength="120">
      <button class="btn dark block">Use this song</button></form>`;
  }

  $('#results').addEventListener('submit', (e) => {
    if (e.target.id !== 'manual') return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    confirmSong({ title: f.title.trim(), artist: f.artist.trim(), source: 'manual' });
  });

  $('#results').addEventListener('click', async (e) => {
    const p = e.target.closest('[data-prev]');
    const pick = e.target.closest('[data-pick]');
    const plus = e.target.closest('[data-plus]');
    if (p) togglePreview(lastResults[p.dataset.prev], p);
    if (pick) confirmSong(lastResults[pick.dataset.pick]);
    if (plus) {
      const st = statusOf(lastResults[plus.dataset.plus]);
      if (st.r) {
        const wasLiked = st.r.liked;
        const res = await toggleLike(plus, st.r.id);
        if (res && !res.error) toast(wasLiked ? '+1 removed' : `+1 added to “${st.r.title}”`);
      }
    }
  });

  /* audio preview (30-second clips from the search provider) */
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

  /* ---------------- confirm (with the "already requested" check) ---------------- */
  function confirmSong(t) {
    stopPreview();
    pendingSong = t;
    const s = state;
    if (t.explicit && !s.settings.allowExplicit) return toast('Explicit tracks are not allowed at this event', true);
    const st = statusOf(t);
    const back = '<button class="btn ghost block" data-back>Back to search</button>';
    const songCard = (r, stats, cls = '') => `<div class="dupe-card ${cls}">${cover(r.artwork || t.artwork, r.title)}<div style="min-width:0"><div style="font-weight:800;font-size:17px;line-height:1.25">${esc(r.title)}</div><div class="muted small">${esc(r.artist || 'Unknown artist')}</div>${stats}</div></div>`;

    if (st.kind === 'queue') {
      const r = st.r;
      $('#confirmTitle').textContent = r.mine ? "You've already requested this" : 'Already requested';
      const stats = `<div class="dupe-stats"><span class="rbadge queue">#${st.rank} in the queue</span><span class="rbadge played">${r.likes} ${r.likes === 1 ? '+1' : '+1s'}</span></div>`;
      $('#confirmBody').innerHTML = songCard(r, stats) + (r.mine
        ? `<p class="muted" style="margin:0">It's waiting in the queue. Share the event so friends can +1 it.</p>${back}`
        : r.liked
          ? `<p class="muted" style="margin:0">${esc(r.by)} asked for this, and you've already given it your +1.</p>${back}`
          : `<p class="muted" style="margin:0">${esc(r.by)} asked for this. Add your +1 to push it up the queue.</p>
             <button class="btn block" data-plusone="${r.id}">+1 this song</button>${back}`);
    } else if (st.kind === 'playing') {
      $('#confirmTitle').textContent = "It's playing right now";
      $('#confirmBody').innerHTML = songCard(st.r, '<div class="dupe-stats"><span class="rbadge playing">🎧 Now playing</span></div>') + `<p class="muted" style="margin:0">Get on the dance floor! 💃</p>${back}`;
    } else if (st.kind === 'blocked') {
      $('#confirmTitle').textContent = 'Played a moment ago';
      $('#confirmBody').innerHTML = songCard(st.r, `<div class="dupe-stats"><span class="rbadge blocked">Played ${agoText(st.mins)}</span></div>`, 'warn') +
        `<p class="muted" style="margin:0">The DJ doesn't repeat songs within ${s.settings.repeatBlockMinutes} min. You can request it again in ${st.wait} min.</p>${back}`;
    } else if (st.kind === 'played') {
      $('#confirmTitle').textContent = 'This was played earlier';
      $('#confirmBody').innerHTML = songCard(st.r, `<div class="dupe-stats"><span class="rbadge played">Played ${agoText(st.mins)}</span></div>`, 'warn') +
        `<label class="field"><span>Shout-out for the DJ (optional)</span><input id="note" class="input" maxlength="140" placeholder="One more time! 🔁"></label>
         <button class="btn block" id="sendReq">Request it again</button>${back}`;
    } else {
      $('#confirmTitle').textContent = 'Request this song?';
      $('#confirmBody').innerHTML = songCard(t, t.album ? `<div class="faint small">${esc(t.album)}${t.year ? ', ' + esc(t.year) : ''}</div>` : '', 'warn') +
        `<label class="field"><span>Shout-out for the DJ (optional)</span><input id="note" class="input" maxlength="140" placeholder="It's my birthday! 🎂"></label>
         <button class="btn block" id="sendReq">Send to the DJ</button>`;
    }
    openSheet('confirmSheet');
    const send = $('#sendReq');
    if (send) send.onclick = sendRequest;
    const bk = $('#confirmBody [data-back]');
    if (bk) bk.onclick = () => openSheet('searchSheet');
    const po = $('#confirmBody [data-plusone]');
    if (po) po.onclick = async () => {
      stage.burst(po, '+1');
      const res = await emit('like', { id: po.dataset.plusone });
      if (res.error) return toast(res.error, true);
      closeSheets();
      toast('Your +1 is in! ♥');
    };
  }

  async function sendRequest() {
    const btn = $('#sendReq');
    btn.disabled = true;
    const res = await emit('request', { ...pendingSong, note: $('#note') ? $('#note').value : '' });
    btn.disabled = false;
    if (res.error) return toast(res.error, true);
    $('#q').value = '';
    $('#results').innerHTML = '';
    lastResults = [];
    if (res.merged) { closeSheets(); return toast(res.playing ? "It's playing right now! 🎧" : 'Already requested, so we added your +1 ♥'); }
    toast('Request sent! 🎧');
    if (state.settings.tipsEnabled) {
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
        <input id="customAmt" class="input" type="number" inputmode="decimal" min="1" step="any" placeholder="0" style="padding-left:${16 + cur.length * 11}px;font-size:22px;font-weight:800;font-family:var(--display)"></div></label>
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
