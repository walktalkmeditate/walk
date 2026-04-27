# walk.lc — Local Circle

Small monthly walks in cities around the world. First twenty minutes silent. Then talk if you want. No app. No fee. Just show up.

This is the static site for [walk.lc](https://walk.lc). Sister project of [Pilgrim](https://pilgrimapp.org).

## Stack

Pure static HTML, CSS, and JS. No build step. Deployed to GitHub Pages from `main`. Email is handled by the [plgrim](https://github.com/walktalkmeditate/plgrim) Cloudflare Worker (separate repo, one worker handles both `circles@plgr.im` and the `walk.lc` flows).

```
walk.lc/                 → index.html        master seal + manifesto + city grid + start CTA
walk.lc/austin/          → austin/index.html
walk.lc/start/           → start/index.html  the BYO city kit
walk.lc/css/site.css                         shared styles, warm-rust palette, dark mode
walk.lc/js/seal.js                           procedural goshuin renderer (SVG, hash-derived)
walk.lc/js/cadence.js                        next-walk date + .ics generation
walk.lc/assets/og/*                          OG images (1200×630)
walk.lc/assets/favicon*                      favicons + apple-touch-icon
walk.lc/sitemap.xml, robots.txt              SEO
```

Each city page reads an inline `#city-data` JSON block; `seal.js` renders the procedural seal from it and `cadence.js` computes the next walk date + on-the-fly `.ics` download. Adding a city = duplicate the template, edit the data block.

## Local dev

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# or
npx serve .
```

Then open `http://127.0.0.1:8000`.

---

## Adding a new city — runbook

The first city (Austin) reused the existing `circles` Listmonk list (id 6). City #2 onward needs a fresh Listmonk list. Plan ~30 minutes per city.

### 1 · Scout the loop

Walk it yourself a few times. Confirm:
- ~3 miles
- Unmistakable meeting point (landmark, not an intersection)
- Restroom near the start
- Post-walk gathering spot nearby
- Reachable by transit or has obvious parking

Pick a cadence pattern (`first-saturday`, `last-sunday`, etc.) and a time (8 AM is the default).

### 2 · Pick a kanji

The leader picks one from the curated menu: `歩` (walk), `道` (way), `集` (gather), `縁` (connection), `巡` (pilgrimage), `静` (stillness), `輪` (circle), `路` (path), `遊` (wander), `友` (friend), `朝` (morning).

### 3 · Create the Listmonk list

Listmonk admin → Lists → New list. Note the new list's id; you'll need it in step 5.

### 4 · Create the city page

```
mkdir <city-slug>
cp austin/index.html <city-slug>/index.html
```

In the new file, edit:
- `<title>`, meta description, canonical URL, all `og:*` and `twitter:*` tags
- JSON-LD `Event` block: name, dates, location, geo, organizer (currently set for Austin)
- Hero `<h1>` and subtitle
- The leader's poetry verse + attribution
- The cadence `<p class="rule">` text
- The practical block (`<dl>`): where + maps links, loop description, format, leader contact
- Subscribe CTA `<a href="mailto:...">` to the city's address
- The `#city-data` JSON block at the bottom — `name`, `state`, `kanji`, `lat`, `lng`, `loop` (route polygon coords), `cadence` rule, `where`, `loopDescription`

`seal.js` and `cadence.js` automatically render the seal and compute the next walk date from the data block.

### 5 · Add the city to the homepage tile grid

Edit `index.html`'s `#cities-data` JSON block (near the bottom). Add a new entry mirroring the Austin entry — same minimum shape so the homepage tile renderer can draw the seal.

### 6 · Wire the email worker

In the `plgrim` repo, edit `src/walks/config.ts` and add a new `CityConfig` entry:

```ts
export const CITIES: Record<string, CityConfig> = {
  austin: { ... },
  <new-slug>: {
    slug: '<new-slug>',
    name: '<City Name>',
    leaderName: '<Leader First Name>',
    leaders: ['<leader-envelope-address>', '<any-other-allowlisted-addresses>'],
    listmonkListId: <new list id from step 3>,
  },
};
```

Note: the `leaders` array must include whatever address Cloudflare's `message.from` actually sees — that's the SMTP envelope, not the visible From: header. If the leader uses Gmail's "Send mail as" feature, add their actual Gmail too.

Then in the `plgrim` repo:

```bash
npx vitest run            # confirm tests pass
npx wrangler deploy
```

### 7 · Cloudflare Email Routing

CF dashboard → `walk.lc` zone → Email → Email Routing → Routes → Create address:
- `<city-slug>@walk.lc` → Send to a Worker → `plgrim`

### 8 · OG image (optional)

Generate a 1200×630 PNG to match the existing pattern. Quick path: copy `assets/og/austin.svg`, edit the seal SVG block + headline + tagline, then render via Chrome screenshot at 1200×630 into `assets/og/<slug>.png`.

When the city collection grows past ~3, replace this manual step with a script that renders OGs from `seal.js`.

### 9 · Push + verify

```bash
git add . && git commit -m "Add <city>"
git push
```

Then test the email flow end-to-end:
- From a non-allowlisted address → `<city>@walk.lc` with subject "add me" → expect welcome reply, subscriber appears in Listmonk
- From the leader's address → `<city>@walk.lc` with a real broadcast → expect "Sent to N subscribers" reply, campaign in Listmonk admin, subscriber receives it

---

## Operations

### Email infrastructure

- **Inbound**: Cloudflare Email Routing on `walk.lc` (MX records point at Cloudflare). Routes for `[city]@walk.lc`, `start@walk.lc`, and `hi@walk.lc` are configured in the CF dashboard.
- **Worker**: `plgrim` (deployed to Cloudflare Workers, version pinned per `wrangler deployments list`). Handles classification (subscribe / unsubscribe / forward / leader-broadcast) and Listmonk integration.
- **Subscriber storage**: Listmonk. Austin reuses list 6 (the legacy "circles" list, sharing subscribers with `circles@plgr.im` for continuity).
- **Outbound**: Listmonk → AWS SES. Broadcasts are sent from `Local Circle <hi@walk.lc>` (configurable via `WALKS_BROADCAST_FROM` in plgrim's `wrangler.toml`).

### DNS / SES setup (already done for walk.lc)

For sending from `@walk.lc` via SES:
- Custom MAIL FROM subdomain `mail.walk.lc` with its own SPF (`include:amazonses.com`) and MX (SES feedback)
- 3 SES DKIM CNAMEs at the root
- DMARC `p=none` (observation-only — should tighten to `p=quarantine` once SES sending reputation is established, ~2-4 weeks of clean broadcasts)

### Worker deploy

```bash
cd ../plgrim
npx vitest run            # all tests should pass
npx wrangler deploy
```

Watch logs:

```bash
npx wrangler tail
```

### Worker observability

CF dashboard → Workers & Pages → `plgrim` → Logs. Or query via Workers Observability API (Cloudflare's MCP tool).

Errors to watch for:
- `walks/<city> action <action> failed` — Listmonk operation failed
- `walks/<city> broadcast failed` — campaign creation/send failed (SES, Listmonk)
- `walks/<city> ... reply failed` — Cloudflare reply() rejected (usually inbound auth issue, not load-bearing — Listmonk action already succeeded)

### Sister repo

[`walktalkmeditate/plgrim`](https://github.com/walktalkmeditate/plgrim) — the Cloudflare Worker for email routing. Per-city config lives in `src/walks/config.ts`.

---

## Spec / design history

The original design doc lives in `~/.claude/plans/ok-so-now-we-magical-swan.md` (local-only). It covers brand identity, the goshuin seal vocabulary, the email model, and the v1 scope.

## License

(TBD)
