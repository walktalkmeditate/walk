const SYNODIC_MONTH = 29.53059;
const KNOWN_NEW_MOON = new Date(2000, 0, 6, 18, 14);

function getMoonPhase(date) {
  const diffMs = date.getTime() - KNOWN_NEW_MOON.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const phase = ((diffDays % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH / SYNODIC_MONTH;
  return phase;
}

function getMoonPhaseName(phase) {
  if (phase < 0.0625) return 'New Moon';
  if (phase < 0.1875) return 'Waxing Crescent';
  if (phase < 0.3125) return 'First Quarter';
  if (phase < 0.4375) return 'Waxing Gibbous';
  if (phase < 0.5625) return 'Full Moon';
  if (phase < 0.6875) return 'Waning Gibbous';
  if (phase < 0.8125) return 'Last Quarter';
  if (phase < 0.9375) return 'Waning Crescent';
  return 'New Moon';
}

function renderMoon(container) {
  const phase = getMoonPhase(new Date());
  const name = getMoonPhaseName(phase);

  container.setAttribute('aria-label', name);
  container.setAttribute('title', name);

  const size = 32;
  const half = size / 2;

  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size * 2;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const lit = isDark ? '#F0EBE1' : '#B8AFA2';
  const shadow = isDark ? '#1C1914' : '#F5F0E8';

  ctx.scale(2, 2);

  ctx.beginPath();
  ctx.arc(half, half, half, 0, Math.PI * 2);
  ctx.fillStyle = lit;
  ctx.fill();

  ctx.beginPath();
  if (phase < 0.5) {
    const sweep = 1 - phase * 4;
    ctx.arc(half, half, half, -Math.PI / 2, Math.PI / 2, false);
    ctx.bezierCurveTo(
      half + half * sweep, half + half * 0.55,
      half + half * sweep, half - half * 0.55,
      half, half - half
    );
  } else {
    const sweep = (phase - 0.5) * 4 - 1;
    ctx.arc(half, half, half, Math.PI / 2, -Math.PI / 2, false);
    ctx.bezierCurveTo(
      half - half * sweep, half - half * 0.55,
      half - half * sweep, half + half * 0.55,
      half, half + half
    );
  }
  ctx.fillStyle = shadow;
  ctx.fill();

  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(canvas);
}

window.Moon = { renderMoon, getMoonPhase, getMoonPhaseName };
