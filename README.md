# DropMyBeats

Live song requests for DJ events. Guests scan a QR code, type their name (no sign-up), search for a song, and request it. They can also like other guests' requests and tip to boost a song. The DJ sees a ranked queue on a laptop or phone that updates live.

## Run it (Windows, macOS, Linux)

Requires **Node.js 18+** (https://nodejs.org).

```bash
cd DropMyBeatV2
npm install
npm start
```

Open **http://localhost:3000** and click **Host an event**. The console prints the address phones should use, e.g. `http://192.168.1.20:3000`.

* Phones must be on the **same Wi-Fi** as the computer running the app. If Windows asks, allow Node.js through the firewall on Private networks.
* `npm run mock` runs with built-in demo songs (no internet needed for search).
* The port can be changed with `PORT=8080`. Data is saved to `data/events.json`.

## Pages

| URL | Who | What |
|---|---|---|
| `/` | Everyone | Join with an event code, or host a new event |
| `/e/CODE` | Guests | Enter a name, search and request songs, like, tip/boost, see Now Playing |
| `/dj/CODE` | Admin / Manager | Live ranked queue, Play now / Played / Pin / Defuse / Remove, QR code, announcements, settings |
| `/screen/CODE` | Projector / TV | Big QR code, event code, Now Playing and the next 8 songs |

## Roles

* **Participant**: no login, just a name. A random ID kept on the phone stops duplicate likes.
* **Admin**: whoever creates the event. Their browser keeps a secret admin key. Use **Copy admin link** to open the console on another device. Only the admin can change settings.
* **Manager**: the admin sets a Manager PIN (4–8 digits). Managers open `/dj/CODE`, enter the PIN, and can run the queue but cannot change settings. Changing or clearing the PIN signs managers out.

## Features

* **Song search** uses the iTunes Search API (India store) and falls back to Deezer. Neither needs an API key. Results show the exact title, artist, album, year, length and a 30-second preview. If a song isn't found, guests can type it in by hand.
* **Duplicates**: requesting a song that's already queued counts as a like instead.
* **Ranking**: likes ×10, tips ×15 per boost step (the smallest quick-pick amount, or e.g. ₹100 / €5 if none are set), plus an urgency boost in the last 5 minutes of a TimeBomb. Pinned songs stay on top.
* **TimeBomb** 💣: each request counts down (30 minutes by default). If it isn't played in time, it explodes and drops off the queue. A tip, a DJ pin or defuse, or reaching the like threshold (10 by default) defuses it. Exploded songs can be restored from the **Removed** tab.
* **Event logo & poster**: the admin uploads them when creating the event, or later in *Event settings → Event logo & poster*. The logo appears in the guest header, the DJ console and the big screen. The poster appears as a tappable banner for guests, alternates with the queue on the big screen every 15 seconds, and is the preview image when the event link is shared on WhatsApp. Images are resized in the browser before upload and stored in `data/uploads/`.
* **Tips**: the admin picks the **currency** from a dropdown (INR, USD, EUR, GBP, AED and more). Guests type any amount they like. The admin can optionally add one-tap quick-pick amounts. With INR, the admin can add a **UPI ID**, and the tip button then opens the guest's UPI app (GPay, PhonePe, Paytm…) with the amount filled in. Tips are recorded as *pledged*. The DJ taps a tip to mark it as received. The app does not verify payments itself.
* **Controls**: pause or open requests, a per-person limit on waiting requests, an explicit-content filter, announcements shown to everyone, and end or re-open the event.
* Guests can add the app to their home screen, since it ships a web app manifest.

## Hosting online (optional)

To let guests use mobile data instead of the venue Wi-Fi, deploy to any host that runs a long-lived Node server with WebSockets, such as Render, Railway, Fly.io or a VPS. Pure serverless hosts like Vercel won't work. Set `PUBLIC_URL=https://your-domain` so the QR code points to the public address. Put the app behind HTTPS in production.

## Project layout

```
server.js            Express + Socket.IO server, storage, search, TimeBomb ticker
public/index.html    Landing (join / host)
public/event.html    Guest view          → public/js/event.js
public/dj.html       DJ / admin console  → public/js/dj.js
public/screen.html   Projector view
public/js/common.js  Shared helpers
public/css/app.css   Styles (mobile-first, brand orange #F68712 on black)
public/img/          Logo (PNG + animated GIF) and app icons
```
