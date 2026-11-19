/* DJ console (admin): edit the Event info page: details, schedule, food menu, parking */
(() => {
  const { $, $$, esc, store, toast, codeFromPath } = DMB;
  const code = codeFromPath();
  const key = () => store.get('key:' + code, '');
  const panel = $('#infoPanel');
  if (!panel) return;

  const SECTIONS = {
    general: { label: 'Details', photo: 'Add photos (venue, dress code, flyer…)' },
    schedule: { label: 'Schedule', photo: 'Upload schedule photo (JPG)', row: ['Time', 'What happens'], add: 'Add time slot', rowPh: ['7:00 PM', 'Welcome drinks'] },
    food: { label: 'Food', photo: 'Upload menu photo', row: ['Dish', 'Price'], add: 'Add dish', rowPh: ['Paneer tikka', '€8'] },
    parking: { label: 'Parking', photo: 'Upload parking map (JPG)' },
  };
  const FOOD_TAGS = [['', 'Type'], ['veg', 'Veg'], ['nonveg', 'Non-veg'], ['vegan', 'Vegan'], ['drink', 'Drink']];

  let info = null;          // last copy from the server
  const drafts = {};        // unsaved edits per section
  let current = 'general';
  let loaded = false;

  $('#infoPreview').href = `/e/${code}/info`;

  async function load() {
    const r = await fetch(`/api/events/${code}/info?fresh=${Date.now()}`); // skip the CDN cache
    if (!r.ok) return toast('Could not load event info', true);
    info = await r.json();
    loaded = true;
    renderTabs();
    renderEditor();
  }
  panel.addEventListener('toggle', () => { if (panel.open && !loaded) load(); });

  const sec = (k) => drafts[k] || info.sections[k];

  function renderTabs() {
    $('#infoTabs').innerHTML = Object.entries(SECTIONS).map(([k, s]) =>
      `<button type="button" role="tab" data-sec="${k}" class="${k === current ? 'on' : ''}" aria-selected="${k === current}">${s.label}${drafts[k] ? ' •' : ''}</button>`).join('');
  }
  $('#infoTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec]');
    if (!b) return;
    collect();
    current = b.dataset.sec;
    renderTabs();
    renderEditor();
  });

  function rowHtml(k, it = { a: '', b: '', tag: '' }) {
    const S = SECTIONS[k];
    return `<div class="ed-row ${k}">
      <input class="input" data-f="a" value="${esc(it.a)}" placeholder="${S.rowPh[0]}" aria-label="${S.row[0]}" maxlength="80">
      <input class="input" data-f="b" value="${esc(it.b)}" placeholder="${S.rowPh[1]}" aria-label="${S.row[1]}" maxlength="120">
      ${k === 'food' ? `<select class="input" data-f="tag" aria-label="Food type">${FOOD_TAGS.map(([v, l]) => `<option value="${v}" ${it.tag === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
      <button type="button" class="icon-btn ed-del" aria-label="Remove row">✕</button>
    </div>`;
  }

  function renderEditor() {
    const k = current;
    const S = SECTIONS[k];
    const s = sec(k);
    let h = '';
    if (k === 'general') {
      h += `<label class="field"><span>When</span><input class="input" data-f="when" value="${esc(s.when)}" maxlength="120" placeholder="Sat 22 Nov, 7 PM till late"></label>`;
      h += `<label class="field"><span>Venue address (opens in Google Maps)</span><input class="input" data-f="address" value="${esc(s.address)}" maxlength="200" placeholder="Hotel Grand, Banjara Hills, Hyderabad"></label>`;
      h += `<label class="field"><span>Details</span><textarea class="input" data-f="text" rows="5" maxlength="3000" placeholder="Dress code, entry rules, contact number…">${esc(s.text)}</textarea></label>`;
    }
    if (k === 'schedule' || k === 'food') {
      h += `<div><div class="ed-head ${k}"><span>${S.row[0]}</span><span>${S.row[1]}</span>${k === 'food' ? '<span>Type</span>' : ''}<span></span></div>
        <div id="edRows" class="stack" style="--gap:8px">${(s.items.length ? s.items : [undefined]).map((it) => rowHtml(k, it)).join('')}</div>
        <button type="button" class="btn sm dark" id="edAdd" style="margin-top:10px">＋ ${S.add}</button></div>`;
      h += `<label class="field"><span>Notes (optional)</span><textarea class="input" data-f="text" rows="3" maxlength="3000" placeholder="${k === 'food' ? 'Buffet opens at 8 PM. Jain food on request.' : 'Timings may shift a little on the night.'}">${esc(s.text)}</textarea></label>`;
    }
    if (k === 'parking') {
      h += `<label class="field"><span>Parking location (opens in Google Maps)</span><input class="input" data-f="address" value="${esc(s.address)}" maxlength="200" placeholder="Basement P2, Hotel Grand"></label>`;
      h += `<label class="field"><span>Details</span><textarea class="input" data-f="text" rows="4" maxlength="3000" placeholder="Free valet at the main gate. Overflow parking behind the hall.">${esc(s.text)}</textarea></label>`;
    }
    // photos (saved straight away when uploaded)
    const imgs = info.sections[k].images;
    h += `<div><div class="field"><span style="display:block;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px">Photos (${imgs.length}/8)</span></div>
      <div class="ed-photos">${imgs.map((u) => `<div class="ed-photo"><img src="${esc(u)}" alt=""><button type="button" class="icon-btn" data-rm="${esc(u)}" aria-label="Remove photo">✕</button></div>`).join('')}
      ${imgs.length < 8 ? `<label class="ed-add file-label"><input type="file" accept="image/*" multiple id="edFiles"><span>＋<br>${S.photo}</span></label>` : ''}</div></div>`;
    h += `<button type="button" class="btn block" id="edSave">Save ${S.label.toLowerCase()}</button>`;
    $('#infoEditor').innerHTML = h;

    $('#infoEditor').oninput = () => { if (!drafts[k]) { collect(); renderTabs(); } };
    const add = $('#edAdd');
    if (add) add.onclick = () => { $('#edRows').insertAdjacentHTML('beforeend', rowHtml(k)); $('#edRows').lastElementChild.querySelector('input').focus(); collect(); renderTabs(); };
    const files = $('#edFiles');
    if (files) files.onchange = () => upload([...files.files]);
    $('#edSave').onclick = save;
  }

  // read the form into a draft for the current section
  function collect() {
    if (!info || !$('#infoEditor').firstElementChild) return;
    const k = current;
    const base = info.sections[k];
    const val = (f) => { const el = $(`#infoEditor [data-f="${f}"]:not(.ed-row *)`); return el ? el.value : base[f]; };
    const items = $$('#edRows .ed-row').map((r) => ({
      a: r.querySelector('[data-f="a"]').value.trim(),
      b: r.querySelector('[data-f="b"]').value.trim(),
      tag: r.querySelector('[data-f="tag"]') ? r.querySelector('[data-f="tag"]').value : '',
    })).filter((it) => it.a || it.b);
    const d = { ...base, text: val('text') || '', address: val('address') || '', when: val('when') || '', items: $('#edRows') ? items : base.items };
    const changed = ['text', 'address', 'when'].some((f) => (d[f] || '') !== (base[f] || '')) || JSON.stringify(d.items) !== JSON.stringify(base.items);
    if (changed) drafts[k] = d; else delete drafts[k];
  }

  $('#infoEditor').addEventListener('click', async (e) => {
    const del = e.target.closest('.ed-del');
    if (del) { del.closest('.ed-row').remove(); collect(); renderTabs(); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      if (!confirm('Remove this photo?')) return;
      try { const j = await DMB.removeInfoImage(code, current, rm.dataset.rm, key()); keepDraftAndApply(j.info); toast('Photo removed'); }
      catch (err) { toast(err.message, true); }
    }
  });

  function keepDraftAndApply(newInfo) {
    collect();
    info = newInfo;
    renderTabs();
    renderEditor();
  }

  async function upload(list) {
    if (!list.length) return;
    const lbl = $('#infoEditor .ed-add span');
    for (let i = 0; i < list.length; i++) {
      if (lbl) lbl.innerHTML = `Uploading ${i + 1} of ${list.length}…`;
      try { const j = await DMB.uploadInfoImage(code, current, list[i], key()); collect(); info = j.info; }
      catch (err) { toast(err.message, true); break; }
    }
    renderTabs();
    renderEditor();
    toast('Photos added');
  }

  async function save() {
    collect();
    const k = current;
    const d = drafts[k] || info.sections[k];
    const btn = $('#edSave');
    btn.disabled = true;
    try {
      const r = await fetch(`/api/events/${code}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-dmb-key': key() },
        body: JSON.stringify({ type: 'admin:info', data: { section: k, text: d.text, items: d.items, address: d.address, when: d.when } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not save');
      info.sections[k] = { ...info.sections[k], text: d.text, items: d.items, address: d.address, when: d.when };
      delete drafts[k];
      renderTabs();
      renderEditor();
      toast(`${SECTIONS[k].label} saved`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  }
})();
