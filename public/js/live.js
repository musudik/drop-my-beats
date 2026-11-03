/* Live connection to an event.
 *  • Local server: instant updates over Socket.IO
 *  • Vercel: polls /state every few seconds (served from Vercel's CDN cache, so it's cheap)
 * Changes (requests, likes, DJ actions…) are always plain HTTP POSTs to /act.
 */
DMB.live = (() => {
  let configP = null;
  const config = () => (configP ||= fetch('/api/config').then((r) => r.json()).catch(() => ({ realtime: 'poll' })));

  function loadSocketIo() {
    return new Promise((ok, bad) => {
      if (window.io) return ok(window.io);
      const s = document.createElement('script');
      s.src = '/socket.io/socket.io.js';
      s.onload = () => ok(window.io);
      s.onerror = () => bad(new Error('socket.io not available'));
      document.head.appendChild(s);
    });
  }

  /**
   * opts: { code, mode: 'guest' | 'dj' | 'screen', key(): string, identity(): {userId,name},
   *         onState(state, fresh), onStatus(online), onAuthError(msg), onNotFound() }
   */
  function connect(opts) {
    const { code, mode } = opts;
    let lastV = 0;
    let socket = null;
    let pollTimer = null;
    let stopped = false;
    let failures = 0;

    function accept(state, fresh) {
      if (!state || stopped) return;
      if (state.v < lastV) return; // an older cached copy, ignore
      if (state.v === lastV) return; // nothing new
      lastV = state.v;
      opts.onState(state, fresh);
    }

    async function pollOnce() {
      try {
        let r, j;
        if (mode === 'dj') {
          r = await fetch(`/api/events/${code}/dj`, { headers: { 'x-dmb-key': opts.key() } });
          j = await r.json();
          if (r.status === 403 || r.status === 429) { stop(); return opts.onAuthError && opts.onAuthError(j.error); }
          if (r.status === 404) { stop(); return opts.onNotFound && opts.onNotFound(); }
          if (!r.ok) throw new Error(j.error);
          if (j.role) opts.role = j.role;
          accept(j.state, true);
        } else {
          r = await fetch(`/api/events/${code}/state`);
          j = await r.json();
          if (r.status === 404) { stop(); return opts.onNotFound && opts.onNotFound(); }
          if (!r.ok) throw new Error(j.error);
          accept(j, false);
        }
        failures = 0;
        opts.onStatus && opts.onStatus(true);
      } catch (e) {
        failures++;
        if (failures >= 2) opts.onStatus && opts.onStatus(false, e.message);
      }
    }

    function schedule() {
      clearTimeout(pollTimer);
      if (stopped) return;
      const hidden = document.hidden;
      // With Socket.IO connected we only poll as a slow safety net
      const ms = socket && socket.connected ? 30000 : hidden ? 15000 : mode === 'dj' ? 2500 : 3000;
      pollTimer = setTimeout(async () => { await pollOnce(); schedule(); }, ms);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !stopped) { pollOnce(); schedule(); } });

    async function start() {
      const cfg = await config();
      await pollOnce(); // first paint
      if (stopped) return;
      if (cfg.realtime === 'socket') {
        try {
          const io = await loadSocketIo();
          socket = io({ transports: ['websocket', 'polling'] });
          socket.on('connect', () => {
            opts.onStatus && opts.onStatus(true);
            const ev = mode === 'dj' ? 'watch-dj' : 'watch';
            socket.emit(ev, { code, key: opts.key && opts.key() }, (res) => {
              if (res && res.error && mode === 'dj') { stop(); return opts.onAuthError && opts.onAuthError(res.error); }
              if (res && res.state) accept(res.state, true);
            });
          });
          socket.on('disconnect', () => { opts.onStatus && opts.onStatus(false); schedule(); });
          socket.on('state', (s) => accept(s, true));
          socket.on('kicked', () => { stop(); opts.onAuthError && opts.onAuthError('The admin changed the manager PIN'); });
        } catch { /* fall back to polling */ }
      }
      schedule();
    }

    function stop() {
      stopped = true;
      clearTimeout(pollTimer);
      if (socket) socket.close();
    }

    async function act(type, data = {}) {
      const id = opts.identity ? opts.identity() : {};
      try {
        const r = await fetch(`/api/events/${code}/act`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dmb-key': (opts.key && opts.key()) || '' },
          body: JSON.stringify({ type, data, userId: id.userId, name: id.name }),
        });
        const j = await r.json().catch(() => ({ error: 'Unexpected reply from the server' }));
        if (!r.ok) return { error: j.error || 'Something went wrong' };
        if (j.state) accept(j.state, true);
        return j;
      } catch {
        return { error: 'No connection, try again' };
      }
    }

    start();
    return { act, stop, refresh: pollOnce };
  }

  return { connect, config };
})();
