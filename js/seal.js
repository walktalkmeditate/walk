/* walk.lc — procedural goshuin renderer.
   Adapted from pilgrim-landing/js/seal.js for the warm-rust Local Circle palette.
   Renders two kinds of seal:
     - master:  fixed, the brand mark (centered 輪, "LOCAL · CIRCLE")
     - city:    per-city, derived from the city data block (name, kanji,
                cadence, lat/lng, loop polygon)

   Auto-init at DOMContentLoaded:
     <div data-seal="master"></div>      → renders the master mark
     <div data-seal="city"></div>        → reads <script id="city-data" type="application/json">
*/

(function() {

  const INK    = '#8B3A2E';
  const SIZE   = 280;
  const CX     = SIZE / 2;
  const CY     = SIZE / 2;
  const OUTER  = 118;
  const ARC_R  = OUTER - 34;

  /* ---------- escape user-controlled strings before interpolating into SVG ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
    }[c]));
  }

  /* ---------- hash utilities ---------- */

  async function hashBytes(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return new Uint8Array(buf);
  }

  /* ---------- polygon: real loop → SVG points ---------- */

  function loopToPoints(loop, maxR) {
    if (!loop || loop.length < 3) return null;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lat, lng] of loop) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const latRange = Math.max(maxLat - minLat, 1e-9);
    const lngRange = Math.max(maxLng - minLng, 1e-9);
    const range    = Math.max(latRange, lngRange);
    const scale    = (maxR * 1.5) / range;
    const midLat   = (minLat + maxLat) / 2;
    const midLng   = (minLng + maxLng) / 2;
    return loop.map(([lat, lng]) => {
      const x = CX + (lng - midLng) * scale;
      const y = CY - (lat - midLat) * scale;          // flip Y for SVG
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  /* ---------- synthetic loop (used for the master mark) ---------- */

  function syntheticLoop(seed) {
    const pts = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const noise = 1 + ((seed[i % seed.length] / 255) - 0.5) * 0.10;
      const r = 60 * noise;
      pts.push(`${(CX + Math.cos(a) * r).toFixed(1)},${(CY + Math.sin(a) * r).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  /* ---------- cadence pattern → display label ---------- */

  const CADENCE_LABELS = {
    'first-saturday':  'FIRST SATURDAY',
    'first-sunday':    'FIRST SUNDAY',
    'first-monday':    'FIRST MONDAY',
    'second-saturday': 'SECOND SATURDAY',
    'second-sunday':   'SECOND SUNDAY',
    'last-saturday':   'LAST SATURDAY',
    'last-sunday':     'LAST SUNDAY',
  };

  function cadenceLabel(cadence) {
    if (!cadence || !cadence.pattern) return '';
    return CADENCE_LABELS[cadence.pattern] || cadence.pattern.toUpperCase().replace(/-/g, ' ');
  }

  /* ---------- core renderer ---------- */

  function buildSvg(opts) {
    const {
      seed, kanji, topText, botText, polygonPoints, slug,
    } = opts;

    const rotation  = ((seed[0] / 255) * 14) - 7;     // -7° to +7°
    const ringCount = 2 + (seed[1] % 3);              // 2-4 inner rings (plus the solid outer)
    const dotCount  = 3 + (seed[12] % 3);             // 3-5 scattered dots

    const filterId = `seal-rough-${slug}`;
    const topId    = `seal-top-${slug}`;
    const botId    = `seal-bot-${slug}`;

    const parts = [];

    // outer ring (always solid, the seal's containing edge)
    parts.push(`<circle cx="${CX}" cy="${CY}" r="${OUTER}" fill="none" stroke="${INK}" stroke-width="1.6" opacity="0.85"/>`);

    // 2-4 inner rings, varied dash + width
    for (let i = 0; i < ringCount; i++) {
      const r     = OUTER - 13 - i * 16;
      const dashL = 2 + (seed[2 + i] % 6);
      const dashG = 2 + ((seed[3 + i] >> 4) % 4);
      const sw    = 0.7 + (seed[4 + i] % 3) * 0.1;
      const op    = 0.55 - i * 0.08;
      parts.push(`<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${INK}" stroke-width="${sw.toFixed(1)}" opacity="${op.toFixed(2)}" stroke-dasharray="${dashL} ${dashG}"/>`);
    }

    // 4 cardinal long spokes
    for (let i = 0; i < 4; i++) {
      const a  = (Math.PI / 2) * i;
      const x1 = CX + Math.cos(a) * (OUTER - 16);
      const y1 = CY + Math.sin(a) * (OUTER - 16);
      const x2 = CX + Math.cos(a) * OUTER;
      const y2 = CY + Math.sin(a) * OUTER;
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" stroke-width="0.9" opacity="0.6" stroke-linecap="round"/>`);
    }

    // 4 diagonal short spokes (varied position via seed)
    for (let i = 0; i < 4; i++) {
      const a  = (Math.PI / 4) + (Math.PI / 2) * i;
      const r1 = OUTER - 50 + (seed[8 + i] % 10);
      const x1 = CX + Math.cos(a) * r1;
      const y1 = CY + Math.sin(a) * r1;
      const x2 = CX + Math.cos(a) * (r1 + 11);
      const y2 = CY + Math.sin(a) * (r1 + 11);
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" stroke-width="0.6" opacity="0.45" stroke-linecap="round"/>`);
    }

    // route polygon (real loop for cities, synthetic for master). Points are
    // numeric strings we built ourselves; safe to interpolate.
    if (polygonPoints) {
      parts.push(`<polygon points="${polygonPoints}" fill="none" stroke="${INK}" stroke-width="0.8" opacity="0.55"/>`);
    }

    // scattered dots (deterministic but varied)
    for (let i = 0; i < dotCount; i++) {
      const a  = (seed[13 + i] / 255) * Math.PI * 2;
      const r  = 30 + (seed[14 + i] % 60);
      const x  = CX + Math.cos(a) * r;
      const y  = CY + Math.sin(a) * r;
      const dr = 1.2 + (seed[15 + i] % 2) * 0.2;
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dr.toFixed(1)}" fill="${INK}" opacity="0.45"/>`);
    }

    const topArc = `M ${(CX - ARC_R).toFixed(1)},${CY} A ${ARC_R},${ARC_R} 0 0,1 ${(CX + ARC_R).toFixed(1)},${CY}`;
    const botArc = `M ${(CX + ARC_R).toFixed(1)},${(CY + 8).toFixed(1)} A ${ARC_R},${ARC_R} 0 0,1 ${(CX - ARC_R).toFixed(1)},${(CY + 8).toFixed(1)}`;

    const safeSlug    = esc(slug);
    const safeTop     = esc(topText);
    const safeBot     = esc(botText);
    const safeKanji   = esc(kanji);
    const safeFilter  = esc(filterId);
    const safeTopId   = esc(topId);
    const safeBotId   = esc(botId);

    const botBlock = botText
      ? `<text fill="${INK}" font-family="Lato, system-ui, sans-serif" font-size="9" letter-spacing="6" font-weight="500" opacity="0.7">
           <textPath href="#${safeBotId}" startOffset="50%" text-anchor="middle">${safeBot}</textPath>
         </text>`
      : '';

    return `
      <svg class="seal-svg" width="100%" height="100%" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${safeTop} seal">
        <defs>
          <filter id="${safeFilter}" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="3" seed="${seed[31]}"/>
            <feDisplacementMap in="SourceGraphic" scale="1.5"/>
          </filter>
          <path id="${safeTopId}" d="${topArc}" fill="none"/>
          <path id="${safeBotId}" d="${botArc}" fill="none"/>
        </defs>
        <g filter="url(#${safeFilter})" transform="rotate(${rotation.toFixed(1)} ${CX} ${CY})">
          ${parts.join('\n          ')}
        </g>
        <text fill="${INK}" font-family="Lato, system-ui, sans-serif" font-size="13" letter-spacing="5" font-weight="600" opacity="0.85">
          <textPath href="#${safeTopId}" startOffset="50%" text-anchor="middle">${safeTop}</textPath>
        </text>
        ${botBlock}
        <text x="${CX}" y="${CY + 20}" text-anchor="middle" fill="${INK}" font-family="'Cormorant Garamond', Georgia, serif" font-size="68" font-style="italic" filter="url(#${safeFilter})" opacity="0.92">${safeKanji}</text>
      </svg>
    `;
  }

  /* ---------- public renderers ---------- */

  async function renderMasterSeal(container) {
    const seed = await hashBytes('walk.lc::local-circle::master');
    const svg = buildSvg({
      seed,
      kanji: '輪',
      topText: 'LOCAL  ·  CIRCLE',
      botText: '',
      polygonPoints: syntheticLoop(seed),
      slug: 'master',
    });
    container.innerHTML = svg;
    animate(container.querySelector('.seal-svg'));
  }

  async function renderCitySeal(container, data) {
    const loopSig = (data.loop || []).map((p) => p.join(',')).join(';');
    const seed    = await hashBytes(`walk.lc::city::${data.name}::${data.lat},${data.lng}::${loopSig}`);
    const slug    = (data.name || 'city').toLowerCase().replace(/\W+/g, '');
    const topText = [data.name, data.state].filter(Boolean).map((s) => s.toUpperCase()).join('  ·  ');
    const polygonPoints = loopToPoints(data.loop, 70) || syntheticLoop(seed);
    const svg = buildSvg({
      seed,
      kanji:   data.kanji || '歩',
      topText,
      botText: cadenceLabel(data.cadence),
      polygonPoints,
      slug,
    });
    container.innerHTML = svg;
    animate(container.querySelector('.seal-svg'));
  }

  /* ---------- animation: stroke draw-in + dot fade-in ---------- */

  function animate(svgEl) {
    if (!svgEl) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const strokes = svgEl.querySelectorAll('circle[stroke], line, polygon');
    const dots    = svgEl.querySelectorAll('circle[fill]:not([stroke])');

    strokes.forEach((el, i) => {
      let len;
      if (el.tagName === 'circle') {
        len = 2 * Math.PI * parseFloat(el.getAttribute('r'));
      } else if (el.tagName === 'line') {
        len = Math.hypot(
          parseFloat(el.getAttribute('x2')) - parseFloat(el.getAttribute('x1')),
          parseFloat(el.getAttribute('y2')) - parseFloat(el.getAttribute('y1'))
        );
      } else {
        len = 800;
      }
      el.style.strokeDasharray  = len;
      el.style.strokeDashoffset = len;
      el.style.transition       = `stroke-dashoffset ${(1.0 + i * 0.08).toFixed(2)}s ease ${(i * 0.07).toFixed(2)}s`;
    });

    dots.forEach((el, i) => {
      const target = el.getAttribute('opacity') || '0.45';
      el.dataset.targetOpacity = target;
      el.style.opacity    = '0';
      el.style.transition = `opacity 0.6s ease ${(strokes.length * 0.07 + i * 0.08).toFixed(2)}s`;
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          strokes.forEach((el) => { el.style.strokeDashoffset = '0'; });
          dots.forEach((el) => { el.style.opacity = el.dataset.targetOpacity; });
          observer.disconnect();
        }
      });
    }, { threshold: 0.2 });
    observer.observe(svgEl);
  }

  /* ---------- auto-init ---------- */

  function init() {
    document.querySelectorAll('[data-seal="master"]').forEach(renderMasterSeal);

    const cityContainers = document.querySelectorAll('[data-seal="city"]');
    if (cityContainers.length === 0) return;

    const dataEl = document.getElementById('city-data');
    if (!dataEl) {
      console.warn('[seal] data-seal="city" present but no #city-data script found');
      return;
    }
    let data;
    try {
      data = JSON.parse(dataEl.textContent);
    } catch (err) {
      console.error('[seal] failed to parse #city-data:', err);
      return;
    }
    cityContainers.forEach((c) => renderCitySeal(c, data));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for ad-hoc use (e.g., homepage city grid that may render multiple cities)
  window.LocalCircleSeal = { renderMasterSeal, renderCitySeal };

})();
