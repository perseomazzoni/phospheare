// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

const fs = require('fs');
const out = __dirname + '/../../docs/brand/';
const read = n => fs.readFileSync(out + n, 'utf8');
const NAME = JSON.parse(read('../../product.json')).name;
const spark = read('spark.svg'), mark = read('mark.svg');
const vb = s => s.match(/viewBox="0 0 (\d+) (\d+)"/).slice(1).map(Number);
const pathOf = s => s.match(/<path[^>]*d="([^"]+)"/)[1];
const [sw, sh] = vb(spark);

// Favicon: the figure with the spark at its chest, squared up. The figure
// is stroked heavier so its limbs still cover a pixel at 16px. The colours
// are the header logo's pairs, picked by the scheme.
const [mw, mh] = vb(mark);
const figure = pathOf(mark);
const sparkAt = mark.match(/class="spark"[^>]*transform="([^"]+)"/)[1];
const sparkPath = mark.match(/class="spark"[^>]*d="([^"]+)"/)[1];
const fside = Math.max(mw, mh) + 12, fx = (fside - mw) / 2, fy = (fside - mh) / 2;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fside} ${fside}" width="64" height="64">
  <style>
    .figure { fill: #1d2126; stroke: #1d2126; }
    .spark { fill: #0e6e73; }
    @media (prefers-color-scheme: dark) {
      .figure { fill: #f2f4f7; stroke: #f2f4f7; }
      .spark { fill: #3be8e5; }
    }
  </style>
  <g transform="translate(${fx} ${fy})">
    <path class="figure" stroke-width="9" stroke-linejoin="round" fill-rule="evenodd" d="${figure}"/>
    <path class="spark" fill-rule="evenodd" transform="${sparkAt}" d="${sparkPath}"/>
  </g>
</svg>
`;
fs.writeFileSync(out + "favicon.svg", favicon);
fs.writeFileSync(out + "../../web/public/favicon.svg", favicon);

// Lockup: full spark at cap height beside the wordmark in Geist. Text is live
// for now; outline it for the final asset.
const H = 64, sc = 44 / sh, lw = Math.round(sw * sc);
fs.writeFileSync(out + 'lockup.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lw + 300} ${H}" width="${lw + 300}" height="${H}">
  <path class="spark" fill="var(--spark, currentColor)" fill-rule="evenodd" transform="translate(0 ${(H - sh * sc) / 2}) scale(${sc.toFixed(4)})" d="${pathOf(spark)}"/>
  <text x="${lw + 14}" y="43" font-family="Geist Variable, Geist, 'Avenir Next', 'Nunito Sans', system-ui, sans-serif" font-size="32" font-weight="500" letter-spacing="-0.5" fill="currentColor">${NAME}</text>
</svg>
`);
console.log('ok');
