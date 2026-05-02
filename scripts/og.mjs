#!/usr/bin/env node
// walk.lc — per-walk OG image generator
//
// Reads a walk.json next to a walk's assets, builds a 1200x630 SVG with the
// etegami subtly faded on the right, the walk's hash seal as a stamp in the
// bottom-right corner, and the walk's title/stats on the left. Renders with
// rsvg-convert into og.png next to walk.json.
//
//   node scripts/og.mjs austin/2026-05-02/walk.json
//
// Requires: rsvg-convert (brew install librsvg), fonts Cormorant Garamond + Lato.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WIDTH  = 1200;
const HEIGHT = 630;

const PARCHMENT  = '#F5F0E8';
const INK        = '#3D342C';
const INK_SOFT   = '#6B5D50';
const ACCENT     = '#8B3A2E';

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Crop the bottom of the etegami where Pilgrim's caption, sub-stats, and brand
// mark live. Leaves only the hand-drawn route. Returns a base64 PNG data URI.
function croppedEtegamiUri(filepath) {
  const result = spawnSync('magick', [
    filepath,
    '-gravity', 'north',
    '-crop', '100%x63%+0+0',
    '+repage',
    'png:-',
  ]);
  if (result.status !== 0) {
    process.stderr.write(result.stderr?.toString() || '');
    throw new Error(`magick exited ${result.status}`);
  }
  return `data:image/png;base64,${result.stdout.toString('base64')}`;
}

function buildSvg(walk, etegamiUri) {
  const eyebrow  = (walk.eyebrow || `the ${walk.city.toLowerCase()} circle`).toUpperCase();
  const date     = walk.dateLabel;
  const sub      = walk.subtitle || '';
  const caption  = walk.caption || '';
  const stats    = [
    walk.pilgrims ? `${walk.pilgrims} ${walk.pilgrims === 1 ? 'PILGRIM' : 'PILGRIMS'}` : null,
    walk.distance ? walk.distance.toUpperCase() : null,
    walk.duration ? walk.duration.toUpperCase() : null,
  ].filter(Boolean).join('  ·  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="white" stop-opacity="0"/>
      <stop offset="55%"  stop-color="white" stop-opacity="1"/>
      <stop offset="100%" stop-color="white" stop-opacity="1"/>
    </linearGradient>
    <mask id="fadeMask" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">
      <rect x="0" y="0" width="1" height="1" fill="url(#fade)"/>
    </mask>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PARCHMENT}"/>

  <g opacity="0.34">
    <image xlink:href="${etegamiUri}"
           x="660" y="0" width="540" height="${HEIGHT}"
           preserveAspectRatio="xMidYMid meet"
           mask="url(#fadeMask)"/>
  </g>

  <g transform="translate(80 0)">
    <text x="0" y="170"
          font-family="Lato, -apple-system, sans-serif"
          font-size="20" font-weight="400"
          fill="${ACCENT}" letter-spacing="8">${xmlEscape(eyebrow)}</text>

    <text x="0" y="278"
          font-family="Cormorant Garamond, Georgia, serif"
          font-size="86" font-weight="300"
          fill="${INK}">${xmlEscape(date)}</text>

    ${sub ? `<text x="0" y="328"
          font-family="Cormorant Garamond, Georgia, serif"
          font-size="30" font-style="italic"
          fill="${INK_SOFT}">${xmlEscape(sub)}</text>` : ''}

    ${caption ? `<text x="0" y="430"
          font-family="Cormorant Garamond, Georgia, serif"
          font-size="22" font-style="italic"
          fill="${INK_SOFT}">${xmlEscape(caption)}</text>` : ''}

    ${stats ? `<text x="0" y="488"
          font-family="Lato, -apple-system, sans-serif"
          font-size="16" font-weight="400"
          fill="${INK}" letter-spacing="3">${xmlEscape(stats)}</text>` : ''}

    <text x="0" y="576"
          font-family="Lato, -apple-system, sans-serif"
          font-size="11" font-weight="300"
          fill="${INK_SOFT}" letter-spacing="6">WALK.LC</text>
  </g>
</svg>
`;
}

function render(svg, outPath) {
  const result = spawnSync(
    'rsvg-convert',
    ['-w', String(WIDTH), '-h', String(HEIGHT), '-o', outPath],
    { input: svg }
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr?.toString() || '');
    throw new Error(`rsvg-convert exited ${result.status}`);
  }
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: node scripts/og.mjs <path/to/walk.json>');
    process.exit(2);
  }

  const walkPath = path.resolve(arg);
  const walkDir  = path.dirname(walkPath);
  const walk     = JSON.parse(fs.readFileSync(walkPath, 'utf8'));

  const etegami = path.join(walkDir, walk.etegami);
  const out     = path.join(walkDir, 'og.png');

  const svg = buildSvg(walk, croppedEtegamiUri(etegami));

  // Optionally write the SVG for inspection if --keep-svg
  if (process.argv.includes('--keep-svg')) {
    fs.writeFileSync(path.join(walkDir, 'og.svg'), svg);
  }

  render(svg, out);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

main();
