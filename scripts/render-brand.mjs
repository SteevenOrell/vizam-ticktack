#!/usr/bin/env node
/**
 * Renders the TickTack brand rasters from the source mark (assets/brand/logo-target.svg geometry, "dart in the
 * bullseye"). Only the outputs Expo needs are written:
 *   - assets/icon.png                       1024, mark on charcoal, no transparency
 *   - assets/android-icon-foreground.png    1024 transparent, mark inside the adaptive safe zone
 *   - assets/android-icon-monochrome.png    1024 transparent, single-colour silhouette
 *   - assets/favicon.png                    256, mark on charcoal
 *   - assets/splash-icon.png                1024 transparent, native splash image (the logo alone)
 * Run: npm run render:brand
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => join(root, p);

const ORANGE = '#FF7A24';
const CHARCOAL = '#17191B';
const CREAM = '#F4EFE6';

// Mark geometry in the 200-unit box (keep in sync with assets/brand/logo-target.svg and src/ui/brand/LogoMark.tsx).
const SHAFT = 'M166 34 L104 96';
const FLETCH = ['M175 38 L162 38 L162 25', 'M163 50 L150 50 L150 37'];
// The mark's ink box is x 32..175, y 20..168: its centre sits at (103.5, 94) while the bullseye is at (100, 100).
const INK_CENTRE = [103.5, 94];

/**
 * `at` is the canvas point where the box centre (100,100) lands; `unit` is canvas pixels per box unit.
 * mono: one colour, with the gap around the dart cut out of the rings by a mask instead of painted in charcoal.
 */
function mark({ at, unit, mono }) {
  const ring = mono ?? ORANGE;
  const dart = mono ?? CREAM;
  const gap = mono
    ? `<mask id="gap" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
        <rect width="200" height="200" fill="#fff"/>
        <path d="${SHAFT}" stroke="#000" stroke-width="12" stroke-linecap="round"/>
      </mask>`
    : '';
  const gapPaint = mono ? '' : `<path d="${SHAFT}" stroke="${CHARCOAL}" stroke-width="12" stroke-linecap="round"/>`;
  return `<g transform="translate(${at[0]} ${at[1]}) scale(${unit}) translate(-100 -100)">
    ${gap}
    <g ${mono ? 'mask="url(#gap)"' : ''}>
      <g fill="none" stroke="${ring}" stroke-width="12"><circle cx="100" cy="100" r="68"/><circle cx="100" cy="100" r="42"/></g>
      <circle cx="100" cy="100" r="15" fill="${ring}"/>
    </g>
    ${gapPaint}
    <g fill="none" stroke="${dart}" stroke-linecap="round" stroke-linejoin="round">
      <path d="${SHAFT}" stroke-width="6"/>
      ${FLETCH.map((d) => `<path d="${d}" stroke-width="4"/>`).join('\n      ')}
    </g>
  </g>`;
}

/** Ink box centred on the canvas (icons) so the mark looks balanced, not just the bullseye. */
function inkCentred(size, unit) {
  return [size / 2 - (INK_CENTRE[0] - 100) * unit, size / 2 - (INK_CENTRE[1] - 100) * unit];
}

function png(size, bg, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}
  ${body}
</svg>`;
  return new Resvg(svg).render().asPng();
}

// App icon: ink box about 60% of the canvas width.
writeFileSync(out('assets/icon.png'), png(1024, CHARCOAL, mark({ at: inkCentred(1024, 4.3), unit: 4.3 })));

// Adaptive icon: the launcher masks to a circle of 66/108 of the canvas (626 px of 1024); the farthest ink corner
// (the fletching) is ~103 units from the ink centre, so 3.0 px per unit stays inside the circle (309 < 313).
writeFileSync(out('assets/android-icon-foreground.png'), png(1024, null, mark({ at: inkCentred(1024, 3), unit: 3 })));
writeFileSync(
  out('assets/android-icon-monochrome.png'),
  png(1024, null, mark({ at: inkCentred(1024, 3), unit: 3, mono: '#FFFFFF' })),
);

writeFileSync(out('assets/favicon.png'), png(256, CHARCOAL, mark({ at: inkCentred(256, 1.15), unit: 1.15 })));

// Native splash image: the bullseye is the exact centre of the canvas (and of the screen), and the 200-unit box is
// 62% of the canvas so the whole mark stays inside Android 12's centred icon circle. With imageWidth 288 the box
// is 178.56 dp; the in-app splash (src/features/splash) uses the same numbers.
writeFileSync(out('assets/splash-icon.png'), png(1024, null, mark({ at: [512, 512], unit: (1024 * 0.62) / 200 })));

console.log('Brand assets rendered');
