/*
 * /walk — fetches the duck's feed and renders it as a sumi-e ink journey.
 *
 * Port + elaboration of CalligraphyPathRenderer + WalkDotView from the
 * Pilgrim iOS app (Pilgrim/Scenes/Home/*.swift).
 */

(function () {
  "use strict";

  const FEED_URL =
    "https://cdn.jsdelivr.net/gh/walktalkmeditate/rubberduck-walk@main/feed.json";
  const DUCK_GIF = "/assets/duck/duck.gif";
  const DUCK_LINK = "https://chiefrubberduck.org";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";
  const STALE_FEED_DAYS = 10;

  // Layout constants (matching CalligraphyPathRenderer's verticalSpacing/maxMeander/topInset).
  const VERTICAL_SPACING = 124;
  const MAX_MEANDER = 32;  // ~1/4 of vertical spacing, like the app
  const TOP_INSET = 40;
  const BOTTOM_INSET = 72;
  const STROKE_MIN = 1.6;
  const STROKE_MAX = 3.6;
  const PATH_WIDTH = 110;
  const PATH_WIDTH_MOBILE = 54;

  // Seasonal palette (spring → moss, summer → rust, autumn → dawn, winter → ink).
  function seasonForDate(iso) {
    const m = Number(iso.slice(5, 7));
    if (m >= 3 && m <= 5) return "moss";
    if (m >= 6 && m <= 8) return "rust";
    if (m >= 9 && m <= 11) return "dawn";
    return "ink";
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function seasonColor(key) {
    return cssVar(`--walk-${key}`) || "#7a8b6f";
  }

  // Dot body radius by kind.
  const DOT_RADIUS = {
    offering: 9,
    notice: 8,
    threshold: 13,
    letter: 10,
    silence: 5,
  };

  // Temple-number → nameLocalized.ja for Shikoku 88. Sourced from
  // open-pilgrimages waypoints.geojson (walktalkmeditate/open-pilgrimages).
  // We keep just the subset needed for ruby rendering; a full static table
  // ships in the client so we don't have to round-trip for kanji.
  const SHIKOKU_KANJI = {
    "Ryozen-ji": "霊山寺",
    "Gokuraku-ji": "極楽寺",
    "Konsen-ji": "金泉寺",
    "Dainichi-ji": "大日寺",
    "Jizo-ji": "地蔵寺",
    "Anraku-ji": "安楽寺",
    "Juraku-ji": "十楽寺",
    "Kumadani-ji": "熊谷寺",
    "Horin-ji": "法輪寺",
    "Kirihata-ji": "切幡寺",
    "Fujii-dera": "藤井寺",
    "Shozan-ji": "焼山寺",
    // Closure / orei-mairi
    "Koya-san Okunoin": "高野山奥之院",
    "Kōya-san Okunoin": "高野山奥之院",
    "Wakayama": "和歌山",
    "Hashimoto": "橋本",
    "Tokushima port": "徳島港",
  };

  function kanjiFor(name) {
    if (!name) return null;
    if (SHIKOKU_KANJI[name]) return SHIKOKU_KANJI[name];
    // Attempt "Name-ji" → "Name ji" fallback lookup
    const alt = name.replace("-ji", "ji");
    return SHIKOKU_KANJI[alt] ?? null;
  }

  // Deterministic x-meander per entry — stable hash so a given entry
  // always sits at the same horizontal position across reloads.
  function meanderHash(entry) {
    const s = `${entry.date}:${entry.route}:${entry.stage}:${entry.glyph}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 0xffffffff; // 0..1
  }
  function meanderOffset(entry) {
    return (meanderHash(entry) - 0.5) * MAX_MEANDER * 1.6;
  }

  function ageClass(ageDays) {
    if (ageDays <= 30) return "";
    if (ageDays <= 90) return "walk-entry--age-soft";
    return "walk-entry--age-distant";
  }

  function formatDate(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  // Absolute days between two ISO date strings (date-only, UTC-normalized).
  function daysBetween(isoA, isoB) {
    if (!isoA || !isoB) return 0;
    const a = new Date(isoA + "T00:00:00Z").getTime();
    const b = new Date(isoB + "T00:00:00Z").getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.abs((b - a) / 86_400_000);
  }

  // Long-form origin date: "April 22, 2026"
  function formatOriginDate(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function feedAgeDays(feed) {
    if (!feed.generatedAt) return 0;
    const generated = new Date(feed.generatedAt).getTime();
    if (Number.isNaN(generated)) return 0;
    return Math.floor((Date.now() - generated) / (1000 * 60 * 60 * 24));
  }

  function renderStateLine(feed) {
    const el = document.getElementById("walk-state-line");
    if (!el) return;

    if (feedAgeDays(feed) >= STALE_FEED_DAYS) {
      el.textContent = "the duck is resting elsewhere";
      return;
    }

    const d = feed.duck;
    if (d.mode === "resting") {
      el.textContent = `the duck is resting at ${d.stageName}`;
    } else if (d.mode === "completing") {
      el.textContent = `walking toward closure, near ${d.stageName}`;
    } else {
      el.textContent = `at ${d.stageName} · stage ${d.stage} of the ${d.routeName}`;
    }
  }

  function renderStatsLine(feed) {
    const el = document.getElementById("walk-stats-line");
    if (!el) return;
    const d = feed.duck;
    const parts = [];
    if (typeof d.daysOnRoute === "number") {
      parts.push(`day ${Math.max(1, d.daysOnRoute)}`);
    }
    if (typeof d.kmFromStart === "number" && typeof d.totalKm === "number") {
      parts.push(`${formatKm(d.kmFromStart)} of ${d.totalKm} km`);
    } else if (typeof d.kmFromStart === "number") {
      parts.push(`${formatKm(d.kmFromStart)} km`);
    }
    if (parts.length === 0) {
      el.textContent = "";
      return;
    }
    el.textContent = "";
    parts.forEach((p, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "walk-stats-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "·";
        el.append(sep);
      }
      const span = document.createElement("span");
      span.textContent = p;
      el.append(span);
    });
  }

  function formatKm(v) {
    if (v >= 10) return String(Math.round(v));
    return v.toFixed(1).replace(/\.0$/, "");
  }

  // Render a small red-ink goshuin at bottom-left showing the current stage's
  // kanji — circular to match the Pilgrim app and the landing-page seal.
  function renderStageSeal(feed) {
    const el = document.getElementById("walk-stage-seal");
    if (!el) return;
    const kanji = kanjiFor(feed.duck.stageName);
    if (!kanji) {
      el.hidden = true;
      return;
    }
    const chars = [...kanji].length;
    const fontSize = chars <= 2 ? 26 : chars === 3 ? 20 : chars === 4 ? 16 : 13;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 80 80");
    svg.setAttribute("aria-hidden", "true");

    const outer = document.createElementNS(SVG_NS, "circle");
    outer.setAttribute("class", "walk-stage-seal-frame");
    outer.setAttribute("cx", "40");
    outer.setAttribute("cy", "40");
    outer.setAttribute("r", "36");
    svg.append(outer);

    const inner = document.createElementNS(SVG_NS, "circle");
    inner.setAttribute("class", "walk-stage-seal-frame-inner");
    inner.setAttribute("cx", "40");
    inner.setAttribute("cy", "40");
    inner.setAttribute("r", "32");
    svg.append(inner);

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("class", "walk-stage-seal-kanji");
    text.setAttribute("x", "40");
    text.setAttribute("y", "46");
    text.setAttribute("font-size", String(fontSize));
    text.textContent = kanji;
    svg.append(text);

    while (el.firstChild) el.removeChild(el.firstChild);
    el.append(svg);
  }

  // Render the duck's real geographic route as a faint watermark behind the
  // page. Always draws the full outline so there's geographic context even
  // at stage 1; overlays the walked portion more prominently.
  function renderBgMap(feed) {
    const container = document.getElementById("walk-bgmap");
    if (!container) return;
    const path = feed.routePath ? feed.routePath[feed.duck.route] : null;
    if (!Array.isArray(path) || path.length < 2) return;

    const currentStage = Math.max(1, Math.min(path.length, feed.duck.stage));
    const walked = path.slice(0, currentStage);

    const allLons = path.map((p) => p[0]);
    const allLats = path.map((p) => p[1]);
    const frameLonMin = Math.min(...allLons);
    const frameLonMax = Math.max(...allLons);
    const frameLatMin = Math.min(...allLats);
    const frameLatMax = Math.max(...allLats);
    const lonRange = frameLonMax - frameLonMin || 1;
    const latRange = frameLatMax - frameLatMin || 1;

    const W = 800;
    const H = 800;
    const PAD = 60;

    function project(lon, lat) {
      const x = PAD + ((lon - frameLonMin) / lonRange) * (W - 2 * PAD);
      const y = PAD + ((frameLatMax - lat) / latRange) * (H - 2 * PAD);
      return [x, y];
    }

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("class", "walk-bgmap-svg");

    // Full outline of the route (geographic context — faint)
    const fullPts = path.map((p) => project(p[0], p[1]).join(",")).join(" ");
    const full = document.createElementNS(SVG_NS, "polyline");
    full.setAttribute("points", fullPts);
    full.setAttribute("class", "walk-bgmap-full");
    svg.append(full);

    // Walked portion (only if >= 2 points — else just show the current-pos dot)
    if (walked.length >= 2) {
      const walkedPts = walked.map((p) => project(p[0], p[1]).join(",")).join(" ");
      const w = document.createElementNS(SVG_NS, "polyline");
      w.setAttribute("points", walkedPts);
      w.setAttribute("class", "walk-bgmap-walked");
      svg.append(w);
    }

    // Mark duck's current position
    const last = project(walked[walked.length - 1][0], walked[walked.length - 1][1]);
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(last[0]));
    dot.setAttribute("cy", String(last[1]));
    dot.setAttribute("r", "5");
    dot.setAttribute("class", "walk-bgmap-duck");
    svg.append(dot);

    while (container.firstChild) container.removeChild(container.firstChild);
    container.append(svg);
  }

  // Draw a small moon SVG for a given date, sized to inline with meta text.
  function buildEntryMoon(iso) {
    if (!window.Moon || typeof window.Moon.getMoonPhase !== "function") return null;
    const phase = window.Moon.getMoonPhase(new Date(iso + "T12:00:00Z"));
    const size = 11;
    const half = size / 2;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "walk-entry-moon");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));

    const bg = document.createElementNS(SVG_NS, "circle");
    bg.setAttribute("cx", String(half));
    bg.setAttribute("cy", String(half));
    bg.setAttribute("r", String(half));
    bg.setAttribute("fill", "currentColor");
    bg.setAttribute("fill-opacity", "0.65");
    svg.append(bg);

    const shadow = document.createElementNS(SVG_NS, "path");
    let d;
    if (phase < 0.5) {
      const sweep = 1 - phase * 4;
      d = [
        `M ${half} 0`,
        `A ${half} ${half} 0 0 1 ${half} ${size}`,
        `C ${half + half * sweep} ${half + half * 0.55}, ${half + half * sweep} ${half - half * 0.55}, ${half} 0`,
        "Z",
      ].join(" ");
    } else {
      const sweep = (phase - 0.5) * 4 - 1;
      d = [
        `M ${half} ${size}`,
        `A ${half} ${half} 0 0 1 ${half} 0`,
        `C ${half - half * sweep} ${half - half * 0.55}, ${half - half * sweep} ${half + half * 0.55}, ${half} ${size}`,
        "Z",
      ].join(" ");
    }
    shadow.setAttribute("d", d);
    shadow.setAttribute("fill", "var(--walk-parchment)");
    svg.append(shadow);

    svg.setAttribute("aria-label", window.Moon.getMoonPhaseName(phase));
    return svg;
  }

  // ---- Entry card ----

  function buildEntryCard(entry) {
    const el = document.createElement("article");
    el.className = `walk-entry walk-entry--${entry.kind} ${ageClass(entry.ageDays)}`.trim();
    el.style.setProperty("--dot-i", String(entry._index));

    const meta = document.createElement("div");
    meta.className = "walk-entry-meta";
    const date = document.createElement("span");
    date.className = "walk-entry-date";
    date.textContent = formatDate(entry.date);
    const stage = document.createElement("span");
    stage.className = "walk-entry-stage";
    stage.textContent = entry.stageName;
    const kanji = kanjiFor(entry.stageName);
    if (kanji) {
      const ja = document.createElement("span");
      ja.className = "walk-entry-stage-ja";
      ja.textContent = kanji;
      stage.append(ja);
    }
    const moon = buildEntryMoon(entry.date);
    meta.append(date);
    if (moon) meta.append(moon);
    meta.append(stage);
    el.append(meta);

    // Sub-meta: weather + distance-from-last on their own soft line
    const subBits = [];
    if (entry.weather) subBits.push({ cls: "walk-entry-weather", text: entry.weather });
    if (typeof entry.kmSinceLastEntry === "number" && entry.kmSinceLastEntry > 0) {
      subBits.push({
        cls: "walk-entry-km",
        text: `${formatKm(entry.kmSinceLastEntry)} km from the last offering`,
      });
    }
    if (subBits.length > 0) {
      const sub = document.createElement("div");
      sub.className = "walk-entry-meta-sub";
      subBits.forEach((b, i) => {
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "walk-stats-sep";
          sep.setAttribute("aria-hidden", "true");
          sep.textContent = "·";
          sub.append(sep);
        }
        const span = document.createElement("span");
        span.className = b.cls;
        span.textContent = b.text;
        sub.append(span);
      });
      el.append(sub);
    }

    const glyph = document.createElement("div");
    glyph.className = "walk-entry-glyph";
    glyph.textContent = entry.glyph;
    el.append(glyph);

    const body = document.createElement("div");
    body.className = "walk-entry-body";
    if (entry.kind !== "silence") {
      const paragraphs = Array.isArray(entry.paragraphs) ? entry.paragraphs : [];
      for (const p of paragraphs) {
        const pEl = document.createElement("p");
        pEl.textContent = p;
        body.append(pEl);
      }
    }
    el.append(body);

    if (entry.kind === "letter" && entry.author) {
      const author = document.createElement("p");
      author.className = "walk-entry-author";
      author.textContent = entry.author;
      el.append(author);
    }

    return el;
  }

  // Origin note — a quiet serif line beneath the oldest entry, marking where
  // the duck began. Leading kanji 鴨 ("duck") in vermilion so the origin
  // carries the same ink color as the goshuin at the bottom-left corner.
  function buildOriginNote(oldest) {
    if (!oldest) return null;
    const div = document.createElement("div");
    div.className = "walk-origin";
    const duck = document.createElement("span");
    duck.className = "walk-origin-duck";
    duck.setAttribute("aria-hidden", "true");
    duck.textContent = "鴨";
    const text = document.createElement("span");
    text.className = "walk-origin-text";
    text.textContent = `the duck began on ${formatOriginDate(oldest.date)} · ${oldest.stageName}.`;
    div.append(duck, text);
    return div;
  }

  // ---- SVG path + dots ----

  // Build a single curved stroke segment between two dots. Uses a filter
  // for organic brush-edge variation instead of stacking multiple paths.
  function buildBrushSegment(a, b, strokeWidth, swayEntry, dayGap, pathWidth) {
    const midY = (a.cy + b.cy) / 2;
    // Control-point offset scales with the actual segment height so the curve
    // looks the same whether entries are 100px or 300px apart.
    const segHeight = Math.abs(b.cy - a.cy) || VERTICAL_SPACING;
    // Days between the two entries amplify the sway — same-day entries draw
    // as tight straight-ish segments (continuous motion), multi-day gaps draw
    // as wide sweeping arcs (rest days). Geometry encodes cadence.
    //   0 days  → pace 0.25 (barely curved whisper)
    //   1 day   → pace 1.10 (normal)
    //   2 days  → pace 1.95
    //   3+ days → pace up to 3.00 (dramatic sweeping arc)
    const gap = typeof dayGap === "number" ? dayGap : 1;
    const pace = Math.min(3, 0.25 + gap * 0.85);
    // Scale sway to the viewBox width so the curve bows the same fraction
    // of column width on both desktop (viewBox=110) and mobile (viewBox=54).
    // Without this, the unscaled sway overflowed the narrow mobile column.
    const widthScale = (pathWidth || PATH_WIDTH) / PATH_WIDTH;
    const sway = (meanderHash(swayEntry) - 0.5) * MAX_MEANDER * 0.6 * pace * widthScale;
    const cp1x = a.cx + sway;
    const cp1y = midY - segHeight * 0.18;
    const cp2x = b.cx - sway;
    const cp2y = midY + segHeight * 0.18;

    const d = `M ${a.cx} ${a.cy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${b.cx} ${b.cy}`;

    const seg = document.createElementNS(SVG_NS, "path");
    seg.setAttribute("d", d);
    seg.setAttribute("stroke-width", String(strokeWidth));
    seg.setAttribute("stroke-linecap", "round");
    seg.setAttribute("stroke-linejoin", "round");
    seg.setAttribute("fill", "none");
    return seg;
  }

  function buildPathSvg(entries, totalHeight, pathWidth, isNewestPulsing, centers) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "walk-path");
    svg.setAttribute("viewBox", `0 0 ${pathWidth} ${totalHeight}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
    svg.style.height = `${totalHeight}px`;

    const centerX = pathWidth / 2;

    // When `centers` is passed in (measured from real card positions), use
    // those Y values so the dots align with entries regardless of how tall
    // each card's body copy ends up on any viewport. Fallback to the old
    // fixed-spacing math is kept for defensive callers.
    const positions = entries.map((entry, i) => ({
      cx: centerX + meanderOffset(entry) * (pathWidth / PATH_WIDTH),
      cy: centers ? centers[i] : TOP_INSET + i * VERTICAL_SPACING + VERTICAL_SPACING / 2,
      entry,
      index: i,
    }));

    // Path segments — one stroked curve per pair, plus a thin fiber overlay
    // offset slightly for an optical brush-hair effect.
    for (let i = 0; i < positions.length - 1; i++) {
      const a = positions[i];
      const b = positions[i + 1];
      const t = positions.length > 1 ? i / (positions.length - 1) : 0;
      // Newer segments thicker; older segments thinner (ink drying out).
      const width = STROKE_MIN + (STROKE_MAX - STROKE_MIN) * (1 - t);
      // Days between these two entries — b is older than a (feed is newest-
      // first), so dayGap measures the rest/travel time between writings.
      const dayGap = daysBetween(a.entry.date, b.entry.date);

      const main = buildBrushSegment(a, b, width, a.entry, dayGap, pathWidth);
      main.setAttribute("filter", "url(#brush-fiber)");
      let cls = "walk-path-stroke";
      if (t > 0.7) cls += " walk-path-stroke--oldest";
      else if (t > 0.4) cls += " walk-path-stroke--older";
      main.setAttribute("class", cls);
      main.style.setProperty("--seg-i", String(i));
      svg.append(main);

      // Single thin fiber overlay, offset 0.6px for brush-hair texture
      const fiber = buildBrushSegment(a, b, Math.max(0.6, width * 0.35), b.entry, dayGap, pathWidth);
      fiber.setAttribute("class", "walk-path-fiber");
      fiber.setAttribute("transform", "translate(0.6, 0.3)");
      fiber.style.setProperty("--seg-i", String(i));
      svg.append(fiber);
    }

    // Dots
    const filterIds = ["sumi-dot", "sumi-dot-2", "sumi-dot-3"];
    for (const pos of positions) {
      const { entry, cx, cy, index } = pos;
      const baseR = DOT_RADIUS[entry.kind] ?? 8;
      const color = seasonColor(seasonForDate(entry.date));

      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", "walk-dot-group");
      group.setAttribute("transform", `translate(${cx} ${cy})`);
      group.style.setProperty("--dot-i", String(index));

      // Ambient bleed (lighter, larger, distorted)
      const bleed = document.createElementNS(SVG_NS, "circle");
      bleed.setAttribute("class", "walk-dot-bleed");
      bleed.setAttribute("r", String(baseR * 2.1));
      bleed.setAttribute("fill", color);
      group.append(bleed);

      // Main dot body — sumi-e filter gives irregular edge
      const body = document.createElementNS(SVG_NS, "circle");
      const filterPick = filterIds[(meanderHash(entry) * 100 | 0) % filterIds.length];
      body.setAttribute("class", "walk-dot-body" + (filterPick !== "sumi-dot" ? " walk-dot-body--irregular" : ""));
      body.setAttribute("r", String(baseR));
      body.setAttribute("fill", color);
      body.setAttribute("filter", `url(#${filterPick})`);
      group.append(body);

      // Dark ink pool at center
      const pool = document.createElementNS(SVG_NS, "circle");
      pool.setAttribute("class", "walk-dot-pool");
      pool.setAttribute("r", String(baseR * 0.42));
      pool.setAttribute("fill", cssVar("--walk-ink"));
      group.append(pool);

      // Highlight sheen
      const hl = document.createElementNS(SVG_NS, "circle");
      hl.setAttribute("class", "walk-dot-highlight");
      hl.setAttribute("r", String(baseR * 0.3));
      hl.setAttribute("cx", String(-baseR * 0.25));
      hl.setAttribute("cy", String(-baseR * 0.3));
      group.append(hl);

      // Letter ring
      if (entry.kind === "letter") {
        const ring = document.createElementNS(SVG_NS, "circle");
        ring.setAttribute("class", "walk-dot-ring");
        ring.setAttribute("r", String(baseR + 4));
        ring.setAttribute("stroke", color);
        group.append(ring);
      }

      svg.append(group);
    }

    // Ripples on newest dot
    if (isNewestPulsing && positions.length > 0) {
      const top = positions[0];
      const topColor = seasonColor(seasonForDate(top.entry.date));
      for (let k = 0; k < 2; k++) {
        const r = document.createElementNS(SVG_NS, "circle");
        r.setAttribute("class", "walk-dot-ripple" + (k ? " walk-dot-ripple--delayed" : ""));
        r.setAttribute("cx", String(top.cx));
        r.setAttribute("cy", String(top.cy));
        r.setAttribute("r", "12");
        r.setAttribute("fill", "none");
        r.setAttribute("stroke", topColor);
        svg.append(r);
      }
    }

    // Duck marker — wrapped in an <a> that links to chiefrubberduck.org.
    // The duck's center sits on the dot's center so it reads as perched on it.
    if (positions.length > 0) {
      const top = positions[0];
      const duckSize = 36;

      const anchor = document.createElementNS(SVG_NS, "a");
      anchor.setAttribute("class", "walk-duck-link");
      anchor.setAttribute("href", DUCK_LINK);
      anchor.setAttributeNS(XLINK_NS, "xlink:href", DUCK_LINK);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");

      const img = document.createElementNS(SVG_NS, "image");
      img.setAttributeNS(XLINK_NS, "xlink:href", DUCK_GIF);
      img.setAttribute("href", DUCK_GIF);
      img.setAttribute("class", "walk-duck-marker");
      img.setAttribute("x", String(top.cx - duckSize / 2));
      img.setAttribute("y", String(top.cy - duckSize / 2));
      img.setAttribute("width", String(duckSize));
      img.setAttribute("height", String(duckSize));

      anchor.append(img);
      svg.append(anchor);

      // Click the duck → a tiny sumi-e plink ring blooms around her center and
      // fades. The anchor opens chiefrubberduck.org in a new tab (target=_blank)
      // so this page keeps running and the ring animates to completion.
      anchor.addEventListener("click", () => {
        const cx = parseFloat(img.getAttribute("x")) + parseFloat(img.getAttribute("width")) / 2;
        const cy = parseFloat(img.getAttribute("y")) + parseFloat(img.getAttribute("height")) / 2;
        const ring = document.createElementNS(SVG_NS, "circle");
        ring.setAttribute("class", "walk-duck-plink");
        ring.setAttribute("aria-hidden", "true");
        ring.setAttribute("cx", String(cx));
        ring.setAttribute("cy", String(cy));
        ring.setAttribute("r", "4");
        svg.append(ring);
        setTimeout(() => ring.remove(), 700);
      });
    }

    return { svg, positions };
  }

  // ---- Moon + theme + constellation ----

  // Theme cycle: each click advances light → dark → constellation → light.
  const THEME_MODES = ["light", "dark", "constellation"];

  function applyMode(mode) {
    // Map mode to the two orthogonal switches: data-theme + body.constellation
    const wasConstellation = document.body.classList.contains("constellation");
    if (mode === "constellation") {
      document.documentElement.setAttribute("data-theme", "dark");
      document.body.classList.add("constellation");
      if (!wasConstellation) scheduleShootingStar();
    } else {
      document.documentElement.setAttribute("data-theme", mode);
      document.body.classList.remove("constellation");
    }
  }

  function currentMode() {
    if (document.body.classList.contains("constellation")) return "constellation";
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function initMoonAndTheme() {
    const moonBtn = document.getElementById("walk-moon");
    if (!moonBtn) return;

    const saved = localStorage.getItem("pilgrim-mode");
    let mode;
    if (saved && THEME_MODES.includes(saved)) {
      mode = saved;
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      mode = "dark";
    } else {
      mode = "light";
    }
    applyMode(mode);
    renderMoonInto(moonBtn);

    moonBtn.addEventListener("click", () => {
      const i = THEME_MODES.indexOf(currentMode());
      const next = THEME_MODES[(i + 1) % THEME_MODES.length];
      applyMode(next);
      localStorage.setItem("pilgrim-mode", next);
      renderMoonInto(moonBtn);
    });
  }

  function renderMoonInto(el) {
    if (window.Moon && typeof window.Moon.renderMoon === "function") {
      window.Moon.renderMoon(el);
    }
  }

  // ---- Ambient delights: shooting stars, seasonal drift, long-press ink ----

  // Schedule the next shooting star while constellation mode is on. Each
  // scheduler run captures a token; if the user toggles constellation off and
  // back on, a fresh scheduler starts with a new token and any previously
  // pending timer sees its token was superseded and exits. Without this,
  // rapid off/on cycles would stack concurrent chains.
  let shootingStarToken = 0;
  function scheduleShootingStar() {
    if (!document.body.classList.contains("constellation")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const myToken = ++shootingStarToken;
    const step = () => {
      if (myToken !== shootingStarToken) return;
      if (!document.body.classList.contains("constellation")) return;
      spawnShootingStar();
      setTimeout(step, 12000 + Math.random() * 21000);
    };
    setTimeout(step, 12000 + Math.random() * 21000);
  }
  function spawnShootingStar() {
    if (!document.body.classList.contains("constellation")) return;
    const star = document.createElement("div");
    star.className = "walk-shooting-star";
    star.setAttribute("aria-hidden", "true");
    star.style.top = (Math.random() * 45) + "vh";
    star.style.left = (Math.random() * 75) + "vw";
    star.style.setProperty("--sx", (180 + Math.random() * 240) + "px");
    star.style.setProperty("--sy", (100 + Math.random() * 160) + "px");
    document.body.append(star);
    setTimeout(() => star.remove(), 1000);
  }

  // Seasonal drift — spawn one particle every 12s. Respects reduced-motion.
  const DRIFT_SYMBOLS = { spring: "🌸", autumn: "🍁", winter: "❄" };
  function currentSeason() {
    const m = new Date().getMonth() + 1;
    if (m >= 3 && m <= 5) return "spring";
    if (m >= 6 && m <= 8) return "summer";
    if (m >= 9 && m <= 11) return "autumn";
    return "winter";
  }
  function spawnDriftParticle() {
    const season = currentSeason();
    const el = document.createElement("div");
    el.className = "walk-drift";
    el.setAttribute("aria-hidden", "true");
    if (season === "summer") {
      el.classList.add("walk-drift--firefly");
      el.style.left = Math.random() * 100 + "vw";
      el.style.top = (55 + Math.random() * 25) + "vh";
      el.style.setProperty("--drift", (Math.random() * 80 - 40) + "px");
    } else {
      el.textContent = DRIFT_SYMBOLS[season];
      el.style.fontSize = (12 + Math.random() * 12) + "px";
      el.style.left = Math.random() * 100 + "vw";
      el.style.setProperty("--drift", (Math.random() * 200 - 100) + "px");
      el.style.setProperty("--rot", Math.random() * 360 + "deg");
      el.style.animationDuration = (18 + Math.random() * 8) + "s";
    }
    document.body.append(el);
    setTimeout(() => el.remove(), 30000);
  }
  function startSeasonalDrift() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Stagger the first particle past the draw-in animation, then keep a
    // steady 12s cadence. Recursive setTimeout instead of setInterval so the
    // first→second gap matches every subsequent gap.
    const step = () => {
      spawnDriftParticle();
      setTimeout(step, 12000);
    };
    setTimeout(step, 4000);
  }

  // Long-press anywhere on the page → leave an ephemeral sumi-e mark at the
  // pointer position. Fades over 3s. Ignores links, buttons, and the moon
  // toggle so normal interactions still work. Listeners are on document (not
  // .walk-main) so the feature works in the wide side gutters too — on a
  // 1400px viewport the centered main is only 780px wide, leaving 310px of
  // gutter on each side that would otherwise be dead.
  function installLongPressBrush() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const THRESHOLD_MS = 450;
    const MOVE_TOL = 12;
    let timer = null;
    let startX = 0, startY = 0;
    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    document.addEventListener("pointerdown", (e) => {
      if (e.target.closest("a, button, input, [role=button]")) return;
      startX = e.clientX; startY = e.clientY;
      timer = setTimeout(() => {
        spawnBrushMark(startX, startY);
        timer = null;
      }, THRESHOLD_MS);
    });
    document.addEventListener("pointerup", cancel);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("pointermove", (e) => {
      if (!timer) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOL) cancel();
    });
  }
  // Calligraphy brush primitives — seven distinct stroke shapes inspired by
  // CJK brush fundamentals. Random pick combined with random scale, rotation,
  // width, opacity, and occasional red ink makes every long-press feel like
  // a real gesture instead of a stamped macro.
  const BRUSH_STROKES = [
    // Horizontal flick (ichi, 一)
    { d: "M 10 26 C 26 12, 52 10, 72 22 C 92 30, 108 30, 114 26" },
    // S-curve sweep
    { d: "M 10 30 C 30 10, 60 42, 90 18 C 105 8, 112 15, 115 20" },
    // Hook with kick
    { d: "M 10 22 C 40 20, 70 22, 90 28 L 108 42" },
    // Left-falling taper (pie, 丿)
    { d: "M 100 10 C 80 18, 45 30, 12 45" },
    // Right-falling taper (na, 乀)
    { d: "M 12 10 C 40 20, 75 30, 108 45" },
    // Dry-brush (horizontal flick, broken into dashes)
    { d: "M 10 26 C 26 12, 52 10, 72 22 C 92 30, 108 30, 114 26", dasharray: "3 4 6 3 8 3 5 5" },
    // Comma curl
    { d: "M 10 22 C 40 12, 80 20, 95 30 C 100 35, 98 40, 92 42" },
  ];

  function spawnBrushMark(x, y) {
    // Constellation mode swaps the ink stroke for a tiny starburst so the
    // gesture matches the cosmic palette of the mode.
    if (document.body.classList.contains("constellation")) {
      spawnStarPuff(x, y);
      return;
    }
    const stroke = BRUSH_STROKES[Math.floor(Math.random() * BRUSH_STROKES.length)];
    // 1-in-15 presses draw in vermilion — the same red the goshuin seal uses.
    // A tiny echo of the stamp, for anyone pressing often enough to notice.
    const isRed = Math.random() < 1 / 15;
    const color = isRed ? "var(--walk-red-seal, #a43a2e)" : "var(--walk-ink, #2c241e)";
    const strokeWidth = 4 + Math.random() * 5;       // 4-9 — bold to fine
    const strokeOpacity = 0.4 + Math.random() * 0.3; // 0.4-0.7 — fresh to dry
    const scale = 0.7 + Math.random() * 0.6;         // 0.7-1.3
    const rot = Math.random() * 360 - 180;           // full direction range

    const mark = document.createElementNS(SVG_NS, "svg");
    mark.setAttribute("class", "walk-brush-mark");
    mark.setAttribute("viewBox", "0 0 120 50");
    mark.setAttribute("aria-hidden", "true");
    mark.style.left = x + "px";
    mark.style.top = y + "px";
    mark.style.setProperty("--mark-rot", rot + "deg");
    mark.style.setProperty("--mark-scale", String(scale));

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", stroke.d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", String(strokeWidth));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-opacity", String(strokeOpacity));
    path.setAttribute("filter", "url(#brush-fiber)");
    if (stroke.dasharray) path.setAttribute("stroke-dasharray", stroke.dasharray);
    path.style.color = color;
    mark.append(path);
    document.body.append(mark);
    setTimeout(() => mark.remove(), 3100);

    // 30% of presses fleck 1-3 ink dots outward from the stroke center.
    // Dots start AT the stroke origin and fly to their destination during the
    // opening of the animation — reads as ink flecking off the brush as it
    // lifts, which is the right mental model for the deliberate 450ms hold.
    if (Math.random() < 0.3) {
      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const dx = (Math.random() - 0.5) * 80;
        const dy = (Math.random() - 0.5) * 50;
        spawnSplatterDot(x, y, dx, dy, color);
      }
    }
  }

  function spawnSplatterDot(centerX, centerY, dx, dy, color) {
    const dot = document.createElement("div");
    dot.className = "walk-splatter";
    dot.setAttribute("aria-hidden", "true");
    dot.style.left = centerX + "px";
    dot.style.top = centerY + "px";
    // Bumped from 2-5px to 5-10px — the sumi-dot filter needs enough pixel
    // area to read as an ink droplet; anything smaller gets fragmented into
    // near-invisible speckle by the displacement map.
    dot.style.setProperty("--size", (5 + Math.random() * 5) + "px");
    dot.style.setProperty("--dx", dx + "px");
    dot.style.setProperty("--dy", dy + "px");
    // Stagger each dot slightly so they don't all launch at once.
    dot.style.setProperty("--delay", (Math.random() * 80) + "ms");
    dot.style.color = color;
    document.body.append(dot);
    setTimeout(() => dot.remove(), 3000);
  }

  function spawnStarPuff(x, y) {
    const count = 3 + Math.floor(Math.random() * 3); // 3-5 dots
    for (let i = 0; i < count; i++) {
      const star = document.createElement("div");
      star.className = "walk-star-puff";
      star.setAttribute("aria-hidden", "true");
      const angle = Math.random() * Math.PI * 2;
      const radius = 4 + Math.random() * 22;
      star.style.left = (x + Math.cos(angle) * radius) + "px";
      star.style.top = (y + Math.sin(angle) * radius) + "px";
      star.style.setProperty("--size", (2 + Math.random() * 3) + "px");
      star.style.setProperty("--delay", (Math.random() * 180) + "ms");
      document.body.append(star);
      setTimeout(() => star.remove(), 1900);
    }
  }

  // ---- Main ----

  async function main() {
    initMoonAndTheme();
    startSeasonalDrift();
    installLongPressBrush();

    const journey = document.querySelector(".walk-journey");
    const empty = document.getElementById("walk-empty");
    if (!journey) return;

    let feed;
    try {
      const res = await fetch(FEED_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
      feed = await res.json();
    } catch (err) {
      const stateEl = document.getElementById("walk-state-line");
      if (stateEl) stateEl.textContent = "the duck is somewhere";
      console.error(err);
      return;
    }

    renderStateLine(feed);
    renderStatsLine(feed);
    renderBgMap(feed);
    renderStageSeal(feed);

    const entries = (feed.entries ?? [])
      .filter((e) => e.route === feed.duck.route)
      .map((e, i) => Object.assign({}, e, { _index: i }));

    if (entries.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }

    const pathWidth = window.matchMedia("(max-width: 640px)").matches
      ? PATH_WIDTH_MOBILE
      : PATH_WIDTH;
    const isRecent = feedAgeDays(feed) < STALE_FEED_DAYS;

    // Pre-compute day-gap between each entry and its neighbor above. Feed is
    // newest-first, so entries[i-1] is later in time than entries[i]. A 0-day
    // gap means same-day entries (tight continuous walking); bigger gaps are
    // rest/silent days and will draw as wider arcs AND leave more vertical
    // space between cards, so the path geometry reads as walking cadence.
    for (let i = 1; i < entries.length; i++) {
      entries[i]._dayGap = daysBetween(entries[i - 1].date, entries[i].date);
    }

    // Phase 1 — render the entry cards in natural flex-column flow so each one
    // is exactly as tall as its content needs, regardless of how the body copy
    // wraps at the current viewport. The old approach placed cards at fixed
    // VERTICAL_SPACING intervals with position: absolute, which overlapped on
    // narrow screens where poems wrapped to 3-4 lines.
    const entriesCol = document.createElement("div");
    entriesCol.className = "walk-entries";
    const cards = entries.map((entry) => {
      const card = buildEntryCard(entry);
      // Top margin scales with dayGap so rest days breathe visually. Caps at
      // 3 days; anything longer is still just a long sweeping arc.
      if (entry._dayGap && entry._dayGap > 0) {
        const extra = Math.min(3, entry._dayGap) * 0.7;
        card.style.marginTop = extra + "rem";
      }
      entriesCol.append(card);
      return card;
    });

    // Origin note — rendered as the last flex item in the column so it sits
    // below the oldest entry. It has no dot (the SVG path ends at the last
    // dot), it's purely a small serif inscription marking where the duck
    // began. Vermilion 鴨 (the duck kanji) as a colored leading mark.
    const origin = buildOriginNote(entries[entries.length - 1]);
    if (origin) entriesCol.append(origin);

    journey.append(entriesCol);

    // Wait for fonts to load before measuring — text rendered in the fallback
    // font has different line-height and glyph widths than Cormorant Garamond,
    // so measuring pre-font-ready gives us card heights that become wrong the
    // moment the real font paints, and dots end up misaligned from entries.
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch { /* no-op */ }
    }

    // Phase 2 — measure each card's meta-row center. Anchoring to the meta
    // row (the date/stage line) reads better than the geometric center: the
    // dot sits at the entry's "header" line no matter how long the body is.
    const colRect = entriesCol.getBoundingClientRect();
    const centers = cards.map((card) => {
      const anchor = card.querySelector(".walk-entry-meta") || card;
      const r = anchor.getBoundingClientRect();
      return r.top - colRect.top + r.height / 2;
    });
    const totalHeight = entriesCol.offsetHeight + BOTTOM_INSET;

    // Phase 3 — build the SVG path with measured dot positions.
    const { svg } = buildPathSvg(entries, totalHeight, pathWidth, isRecent, centers);
    journey.insertBefore(svg, entriesCol);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
