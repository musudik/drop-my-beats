// DropMyBeats — live song requests for DJ events
//
//  Local / Render / Railway:  npm install && npm start  →  http://localhost:3000
//                             (instant updates over Socket.IO, data saved in ./data)
//  Vercel:                    this file exports the Express app; Vercel runs it as a Function.
//                             Updates use short polling and data lives in Upstash Redis.
'use strict';

require('express'); // lets Vercel detect this as an Express app
const { app, store, setNotifier, core, lanIp } = require('./lib/app');

function start() {
  const http = require('http');
  const { Server } = require('socket.io');
  const PORT = Number(process.env.PORT) || 3000;
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: false } });

  // Push fresh state to everyone watching an event
  const push = async (ev) => {
    io.to('pub:' + ev.code).emit('state', core.viewState(ev));
    const djSockets = await io.in('dj:' + ev.code).fetchSockets();
    if (!djSockets.length) return;
    const djState = core.viewState(ev, true);
    for (const s of djSockets) {
      if (core.roleFor(ev, s.data.key)) s.emit('state', djState);
      else { s.emit('kicked'); s.leave('dj:' + ev.code); } // manager PIN changed
    }
  };
  setNotifier(push);

  io.on('connection', (socket) => {
    const ack = (cb, payload) => typeof cb === 'function' && cb(payload);
    socket.on('watch', async ({ code } = {}, cb) => {
      code = String(code || '').toUpperCase();
      const ev = await store.getEvent(code).catch(() => null);
      if (!ev) return ack(cb, { error: 'Event not found' });
      socket.join('pub:' + code);
      ack(cb, { ok: true, state: core.viewState(ev) });
    });
    socket.on('watch-dj', async ({ code, key } = {}, cb) => {
      code = String(code || '').toUpperCase();
      const ev = await store.getEvent(code).catch(() => null);
      if (!ev) return ack(cb, { error: 'Event not found' });
      const role = core.roleFor(ev, key);
      if (!role) return ack(cb, { error: 'Wrong PIN or admin key' });
      socket.data.key = String(key);
      socket.join('dj:' + code);
      ack(cb, { ok: true, role, state: core.viewState(ev, true) });
    });
  });

  // TimeBomb ticker (on Vercel the bomb is checked whenever the queue is read instead)
  if (store.allEvents) {
    setInterval(async () => {
      for (const ev of store.allEvents()) {
        if (!core.needsTick(ev)) continue;
        const out = await store.updateEvent(ev.code, (e) => (core.tick(e) ? { ok: true } : { skipSave: true }));
        if (out.ev && !out.result.skipSave) push(out.ev);
      }
    }, 5000);
  }

  server.listen(PORT, () => {
    console.log('');
    console.log('  🎧  DropMyBeats is live');
    console.log(`      On this computer:   http://localhost:${PORT}`);
    console.log(`      On phones (Wi-Fi):  ${process.env.PUBLIC_URL || `http://${lanIp()}:${PORT}`}`);
    console.log(`      Storage:            ${store.kind === 'redis' ? 'Upstash Redis' : 'data/events.json'}`);
    if (process.env.SEARCH_MOCK === '1') console.log('      (song search is in MOCK mode)');
    console.log('');
  });
}

// On Vercel the platform handles requests itself; everywhere else we start a server
if (!process.env.VERCEL) start();

module.exports = app;
