/* DJ / Manager / Admin console */
(() => {
  const { $, $$, esc, store, toast, icons, fmtDur, ago, art, codeFromPath, setServerTime, bombPill, copy } = DMB;
  const code = codeFromPath();
  const params = new URLSearchParams(location.search);
  if (params.get('key')) {
    store.set('key:' + code, params.get('key'));
    history.replaceState(null, '', location.pathname); // keep the key out of the address bar
  }
  let key = store.get('key:' + code, '');
  let role = null;
  let state = null;
  let tab = 'queue';
  let settingsDirty = false;

  $('#gateCode').textContent = code;
  let live = null;
  const emit = async (type, data) => (live ? live.act(type, data) : { error: 'Not connected yet' });

  function showGate(msg) {
    if (live) { live.stop(); live = null; }
    $('#app').classList.add('hidden');
    $('#gate').classList.remove('hidden');
    $('#lockBtn').classList.add('hidden');
    if (msg) toast(msg, true);
  }
  function notFound() {
    $('#gate').innerHTML = '<div class="empty"><h2 style="font-size:22px">Event not found</h2><a class="btn" href="/">Home</a></div>';
    showGate();
  }
  async function auth() {
    if (!key) return showGate();
    let r, j;
    try {
      r = await fetch(`/api/events/${code}/dj`, { headers: { 'x-dmb-key': key } });
      j = await r.json();
    } catch {
      return showGate('No connection, try again');
    }
    if (r.status === 404) return notFound();
    if (!r.ok) {
      if (r.status === 403) { store.del('key:' + code); key = ''; }
      return showGate(j.error);
    }
    role = j.role;
    $('#gate').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#lockBtn').classList.remove('hidden');
    $('#roleBadge').textContent = role;
    $('#roleBadge').className = 'role-badge ' + role;
    $('#settingsPanel').classList.toggle('hidden', role !== 'admin');
    render(j.state, true);
    loadShare();
    live = DMB.live.connect({
      code,
      mode: 'dj',
      key: () => key,
      onState: (s) => render(s),
      onStatus: (ok) => $('#conn').classList.toggle('hidden', ok),
      onAuthError: (msg) => { store.del('key:' + code); key = ''; showGate(msg || 'Please sign in again'); },
      onNotFound: notFound,
    });
  }
  auth();

  $('#gateForm').onsubmit = (e) => {
    e.preventDefault();
    key = $('#pin').value.trim();
    if (!key) return;
    store.set('key:' + code, key);
    auth();
  };
  $('#lockBtn').onclick = () => {
    if (role === 'admin' && !confirm('Lock the console on this device? You will need your admin link to get back in.')) return;
    store.del('key:' + code);
    location.reload();
  };

  /* ---------------- share ---------------- */
  async function loadShare() {
    const j = await (await fetch('/api/events/' + code + '/link')).json();
    $('#qr').src = '/api/events/' + code + '/qr.svg?t=' + Date.now();
    $('#bigCode').textContent = code;
    $('#joinLink').textContent = j.url;
    $('#dlQr').href = '/api/events/' + code + '/qr.png';
    $('#screenLink').href = '/screen/' + code;
    const origin = j.url.replace(/\/e\/.*$/, '');
    $('#mgrLink').textContent = origin + '/dj/' + code;
    $('#copyLink').onclick = () => copy(j.url);
    $('#shareLink').onclick = async () => {
      if (navigator.share) { try { await navigator.share({ title: state.name, text: 'Request songs at ' + state.name + ' 🎧', url: j.url }); } catch {} }
      else copy(j.url);
    };
    const adminUrl = origin + '/dj/' + code + '?key=' + encodeURIComponent(key);
    $('#copyAdmin').onclick = () => copy(adminUrl);
    if (params.get('welcome') && role === 'admin') {
      $('#welcome').classList.remove('hidden');
      $('#welcomeAdminLink').onclick = (e) => { e.preventDefault(); copy(adminUrl); };
      history.replaceState(null, '', location.pathname);
    }
  }

  /* ---------------- render ---------------- */
  $$('.tabs button').forEach((b) => b.onclick = () => {
    tab = b.dataset.tab;
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  });

  function render(s, first) {
    if (!s) return;
    const prevCount = state ? state.queue.length : null;
    state = s;
    setServerTime(s.serverTime);
    document.title = 'DJ · ' + s.name;
    $('#evTitle').textContent = `${s.name} · ${s.code}${s.status === 'ended' ? ' · ENDED' : ''}`;
    const tb = $('.topbar a img');
    tb.src = s.logoUrl || '/img/logo-mark.png';
    tb.classList.toggle('ev-mark', !!s.logoUrl);
    const st = s.stats;
    $('#stats').innerHTML = [
      [s.queue.length, 'in queue'], [st.participants, 'guests'], [st.played, 'played'],
      [st.likes, 'likes'], [s.settings.currency + st.tips, 'tips pledged'], [st.exploded, 'exploded 💣'],
    ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${l}</span></div>`).join('');
    $('#toggleReq').textContent = s.settings.requestsOpen ? '⏸ Pause requests' : '▶ Open requests';
    $('#toggleReq').className = 'btn sm ' + (s.settings.requestsOpen ? 'dark' : '');
    $('#cQueue').textContent = s.queue.length || '';
    $('#endEvent').textContent = s.status === 'ended' ? 'Re-open event' : 'End event';

    const np = s.nowPlaying;
    $('#nowPlaying').classList.toggle('hidden', !np);
    if (np) {
      $('#nowPlaying').innerHTML = `
        <div class="label"><span class="eq"><i></i><i></i><i></i></span> Now playing</div>
        <div class="np">${art(np.artwork)}<div class="grow"><div class="t">${esc(np.title)}</div><div class="muted">${esc(np.artist)}</div><div class="faint small">for ${esc(np.by)}${np.likes ? ` · ♥ ${np.likes}` : ''}</div></div>
        <button class="btn sm" data-act="played" data-id="${np.id}">Done</button></div>`;
    }
    if (role === 'admin' && (first || !settingsDirty)) fillSettings();
    if (role === 'admin') renderBrand();
    renderList();
    if (prevCount != null && s.queue.length > prevCount && document.hidden) document.title = '(' + s.queue.length + ') New request · ' + s.name;
  }

  function renderList() {
    const s = state;
    let items = tab === 'queue' ? s.queue : tab === 'played' ? s.played : s.rejected;
    if (!items.length) {
      $('#list').innerHTML = `<div class="empty"><img src="/img/logo-mark.png" alt=""><div>${tab === 'queue' ? 'No requests waiting. Share the QR code to get the crowd going!' : 'Nothing here yet.'}</div></div>`;
      return;
    }
    $('#list').innerHTML = items.map((r, i) => djRow(r, i)).join('');
  }

  function djRow(r, i) {
    const st = state.settings;
    const exact = r.artist ? `${r.title} - ${r.artist}` : r.title;
    const tips = (r.tips || []).map((t, ti) => `<button class="pill ${t.confirmed ? 'tip' : ''}" data-act="tipc" data-id="${r.id}" data-i="${ti}" style="border:0;cursor:pointer" title="Tap to mark as received">${t.confirmed ? '✓' : '?'} ${esc(st.currency)}${t.amount} ${esc(t.by)}</button>`).join(' ');
    const hot = r.expiresAt && r.expiresAt - DMB.now() < 5 * 60000;
    let actions = '';
    if (r.status === 'queued') {
      actions = `
        <button class="btn sm" data-act="playing" data-id="${r.id}">▶ Play now</button>
        <button class="btn sm dark" data-act="played" data-id="${r.id}">✓ Played</button>
        <button class="btn sm dark" data-act="pin" data-id="${r.id}">${r.pinned ? 'Unpin' : '📌 Pin'}</button>
        ${st.timeBombEnabled && r.expiresAt ? `<button class="btn sm dark" data-act="defuse" data-id="${r.id}">✂ Defuse</button>` : ''}
        <button class="btn sm danger" data-act="rejected" data-id="${r.id}">✕</button>`;
    } else if (r.status === 'played') {
      actions = `<button class="btn sm dark" data-act="queued" data-id="${r.id}">↺ Back to queue</button>`;
    } else {
      actions = `<span class="faint small grow">${r.status === 'exploded' ? '💣 Exploded' : 'Removed'} ${r.closedAt ? ago(r.closedAt) : ''}</span><button class="btn sm dark" data-act="queued" data-id="${r.id}">↺ Restore</button>`;
    }
    return `<div class="dj-song ${r.pinned ? 'pinned' : ''} ${hot && r.status === 'queued' ? 'hot' : ''}">
      ${r.status === 'queued' ? `<div class="score" title="Priority score">${i + 1}<small>${r.likes}♥</small></div>` : '<div></div>'}
      ${art(r.artwork)}
      <div style="min-width:0">
        <div class="t copy-exact" data-copy="${esc(exact)}" title="Tap to copy the exact name" style="font-weight:800">${esc(r.title)}${r.explicit ? ' <span class="pill explicit">E</span>' : ''}</div>
        <div class="muted small">${esc(r.artist)}${r.album ? ' · ' + esc(r.album) : ''}${r.duration ? ' · ' + fmtDur(r.duration) : ''}</div>
        <div class="by" style="color:var(--faint);font-size:12.5px;margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <span>by <b style="color:var(--muted)">${esc(r.by)}</b> · ${ago(r.createdAt)}</span>
          ${r.status === 'queued' ? bombPill(r, st) : ''}
          ${r.tipTotal ? `<span class="pill tip">${esc(st.currency)}${r.tipTotal}</span>` : ''}
          ${r.trackUrl ? `<a class="pill" href="${esc(r.trackUrl)}" target="_blank" rel="noopener">Open ↗</a>` : ''}
        </div>
        ${r.note ? `<div class="small" style="margin-top:6px;color:var(--orange-2)">💬 ${esc(r.note)}</div>` : ''}
        ${r.likers && r.likers.length ? `<div class="faint small" style="margin-top:4px">♥ ${esc(r.likers.slice(-6).join(', '))}${r.likes > 6 ? ' +' + (r.likes - 6) : ''}</div>` : ''}
        ${tips ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${tips}</div>` : ''}
      </div>
      <div class="dj-actions">${actions}</div>
    </div>`;
  }

  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) return copy(c.dataset.copy);
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const id = a.dataset.id;
    const act = a.dataset.act;
    let res;
    if (act === 'pin') res = await emit('dj:pin', { id });
    else if (act === 'defuse') res = await emit('dj:defuse', { id });
    else if (act === 'tipc') res = await emit('dj:confirm-tip', { id, index: Number(a.dataset.i) });
    else {
      if (act === 'rejected' && !confirm('Remove this request from the queue?')) return;
      res = await emit('dj:set-status', { id, status: act });
    }
    if (res && res.error) toast(res.error, true);
  });

  $('#toggleReq').onclick = async () => {
    const res = await emit('dj:toggle-requests');
    if (res.error) toast(res.error, true);
  };
  $('#announceBtn').onclick = async () => {
    const text = prompt('Message for everyone (blank to clear):', state.announcement || '');
    if (text === null) return;
    const res = await emit('dj:announce', { text });
    res.error ? toast(res.error, true) : toast(text ? 'Announcement sent' : 'Announcement cleared');
  };

  /* ---------------- settings (admin) ---------------- */
  const form = $('#settingsForm');
  form.addEventListener('input', () => settingsDirty = true);
  function fillSettings() {
    const s = state.settings;
    const f = form.elements;
    f.name.value = state.name; f.djName.value = state.djName || ''; f.venue.value = state.venue || '';
    f.tipsEnabled.checked = s.tipsEnabled; f.tipAmounts.value = s.tipAmounts.join(', ');
    f.currencyCode.value = s.currencyCode || 'INR'; f.upiId.value = s.upiId; f.upiName.value = s.upiName;
    syncUpi();
    renderBrand();
    f.timeBombEnabled.checked = s.timeBombEnabled; f.timeBombMinutes.value = s.timeBombMinutes; f.defuseLikes.value = s.defuseLikes;
    f.maxOpenRequestsPerUser.value = s.maxOpenRequestsPerUser; f.allowExplicit.checked = s.allowExplicit;
    f.managerPin.value = state.managerPin || '';
    settingsDirty = false;
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = form.elements;
    const patch = {
      name: f.name.value, djName: f.djName.value, venue: f.venue.value,
      tipsEnabled: f.tipsEnabled.checked, tipAmounts: f.tipAmounts.value, currencyCode: f.currencyCode.value,
      upiId: f.upiId.value, upiName: f.upiName.value,
      timeBombEnabled: f.timeBombEnabled.checked, timeBombMinutes: f.timeBombMinutes.value, defuseLikes: f.defuseLikes.value,
      maxOpenRequestsPerUser: f.maxOpenRequestsPerUser.value, allowExplicit: f.allowExplicit.checked,
    };
    patch.managerPin = f.managerPin.value;
    const res = await emit('admin:settings', patch);
    if (res.error) return toast(res.error, true);
    settingsDirty = false;
    toast('Settings saved');
  };
  // Currency dropdown
  fetch('/api/currencies').then((r) => r.json()).then((list) => {
    $('#currencySel').innerHTML = list.map((c) => `<option value="${c.code}">${esc(c.symbol)} ${c.code}</option>`).join('');
    if (state) $('#currencySel').value = state.settings.currencyCode || 'INR';
  });
  const syncUpi = () => $('#upiFields').classList.toggle('hidden', form.elements.currencyCode.value !== 'INR' && form.elements.currencyCode.value !== '');
  form.elements.currencyCode.addEventListener('change', syncUpi);

  /* ---------------- branding (admin) ---------------- */
  function renderBrand() {
    for (const slot of $$('.brand-slot')) {
      const url = state[slot.dataset.kind + 'Url'];
      const img = slot.querySelector('img.thumb');
      img.hidden = !url;
      if (url && img.getAttribute('src') !== url) img.src = url;
      slot.querySelector('[data-empty]').hidden = !!url;
      slot.querySelector('[data-remove]').hidden = !url;
    }
  }
  for (const slot of $$('.brand-slot')) {
    const kind = slot.dataset.kind;
    slot.querySelector('input[type=file]').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const lbl = slot.querySelector('.file-label');
      lbl.firstChild.textContent = 'Uploading…';
      try { await DMB.uploadMedia(code, kind, file, key); toast(kind === 'logo' ? 'Logo updated' : 'Poster updated'); }
      catch (err) { toast(err.message, true); }
      lbl.firstChild.textContent = 'Upload';
    };
    slot.querySelector('[data-remove]').onclick = async () => {
      if (!confirm('Remove the event ' + kind + '?')) return;
      try { await DMB.removeMedia(code, kind, key); toast('Removed'); } catch (err) { toast(err.message, true); }
    };
  }

  $('#clearHist').onclick = async () => {
    if (!confirm('Clear all played and removed songs? The live queue stays.')) return;
    const res = await emit('admin:clear-history');
    res.error ? toast(res.error, true) : toast('History cleared');
  };
  $('#endEvent').onclick = async () => {
    const ending = state.status !== 'ended';
    if (ending && !confirm('End the event? Guests will no longer be able to request songs.')) return;
    const res = await emit('admin:settings', { status: ending ? 'ended' : 'live' });
    res.error ? toast(res.error, true) : toast(ending ? 'Event ended' : 'Event re-opened');
  };

  // Refresh "x min ago" labels every 30s
  setInterval(() => state && renderList(), 30000);
})();
