# walk.lc — Local Circle

Small monthly walks in cities around the world. First twenty minutes silent. Then talk if you want. No app. No fee. Just show up.

This is the static site for [walk.lc](https://walk.lc), the spinout from `pilgrimapp.org/circles`. Sister project of [Pilgrim](https://pilgrimapp.org).

## Stack

Pure static HTML, CSS, and (eventually) JS. No build step. Deployed to GitHub Pages from `main`.

```
walk.lc/                 → index.html      master seal + manifesto + city grid + start CTA
walk.lc/austin/          → austin/index.html
walk.lc/start/           → start/index.html  the BYO city kit
walk.lc/assets/*.ics     → calendar files
walk.lc/css/site.css     → shared styles, warm-rust palette
walk.lc/js/seal.js       → procedural goshuin renderer (pending — implementation step 2)
walk.lc/js/cadence.js    → next-walk date + .ics generation (pending — implementation step 3)
```

## Adding a new city

For now (v1), each city is a hand-crafted page. Once `js/seal.js` and `js/cadence.js` land, the per-city work shrinks to filling in a JSON data block.

1. **Scout the loop.** Three miles, unmistakable meeting point, restroom and post-walk gathering spot nearby. Pick a date pattern (e.g., "first Saturday of every month") and a time.
2. **Pick a kanji** for the city's seal from the curated menu (`js/kanji-menu.json` once it exists; for now the starter set is in [the design doc](#design-references) below).
3. **Create the city page** at `<city>/index.html`. Copy `austin/index.html` as a template and replace:
   - `<title>`, meta description, canonical URL, OG tags
   - The `seal-austin` SVG: rotation, route polygon points, kanji glyph, top-arc text (`CITY · STATE`), bottom-arc text (cadence)
   - All copy: hero, poetry, rule + next date, practical block, subscribe CTA
4. **Add the city to the homepage grid** (`index.html`) — one new `<a class="city-tile">` with the city's seal and slug.
5. **Configure the email worker.** Edit the `plgrim` worker config (in the sibling `plgrim` repo): add the new city's email allowlist (leader's address) and Listmonk list id. Create the Listmonk list first.
6. **Add a Cloudflare Email Routing rule** for `<city>@walk.lc` → the worker.
7. **Push and deploy.**

## Email infrastructure

Email for `walk.lc` is handled by the `plgrim` Cloudflare Worker (one worker, two domains: `plgr.im` and `walk.lc`). Routing model:

- `[city]@walk.lc` — single inbox per city. The worker's classifier:
  - If `From` matches the city's leader allowlist → broadcast to the city's Listmonk list
  - Subject "add me" / "subscribe" → add subscriber + send confirmation
  - Body "stop" / "unsubscribe" → remove + send confirmation
  - Anything else → forward to the leader for personal reply
- `start@walk.lc` — auto-replies with the BYO kit content, then forwards the inquiry to the curator for personal follow-up.

## Design references

See `/Users/rubberduck/.claude/plans/ok-so-now-we-magical-swan.md` for the full design spec, including:

- Brand and visual identity (warm-rust goshuin, Cormorant + Lato, palette)
- Curated kanji menu (`歩 道 集 縁 巡 静 輪 路 遊 友 朝`)
- Page anatomy
- Email infrastructure details
- Implementation order

## Local dev

Just open `index.html` in a browser, or run any static file server:

```bash
python3 -m http.server 8000
# or
npx serve .
```

## License

(TBD)
