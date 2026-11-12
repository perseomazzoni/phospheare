// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Builds docs/brand/study.html: the complete logo study, self-contained. Fonts and
// the source emblem are embedded as data URIs because Chrome refuses to load
// @font-face files from a file:// page, and the study must open from disk.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const brand = path.join(here, '..', '..', 'docs', 'brand');
const fonts = path.join(here, '..', '..', 'web', 'public', 'fonts');
const read = (p) => fs.readFileSync(p, 'utf8');
const b64 = (p, mime) => `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;

const font = (family, file, style, weight = '200 800') => `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};src:url("${b64(path.join(fonts, file), 'font/woff2')}") format("woff2-variations")}`;
const fontCss = [
  font('Newsreader', 'newsreader-latin-opsz-normal.woff2', 'normal'),
  font('Newsreader', 'newsreader-latin-opsz-italic.woff2', 'italic'),
  font('Brygada 1918', 'brygada-latin-wght-normal.woff2', 'normal', '400 700'),
  font('Geist', 'geist-latin-wght-normal.woff2', 'normal'),
  font('Geist Mono', 'geist-mono-latin-wght-normal.woff2', 'normal'),
].join('\n');

const emblemUri = b64(path.join(here, 'source.webp'), 'image/webp');
const emblemCss = `.emblem{background:url("${emblemUri}") 50% 9%/178% no-repeat;display:block}`;
const mark = read(path.join(brand, 'mark.svg'));
const spark = read(path.join(brand, 'spark.svg'));
const sparkSmall = read(path.join(brand, 'spark-small.svg'));
const vb = (s) => s.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const sized = (svg, w, h) => svg.replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`);
const fitH = (svg, h) => { const [, , w, hh] = vb(svg); return sized(svg, Math.round(w * h / hh), h); };
const fitW = (svg, w) => { const [, , ww, h] = vb(svg); return sized(svg, w, Math.round(h * w / ww)); };
const paint = (svg) => svg.replace('fill="currentColor"', 'fill="var(--spark)"');
// The whole figure, centred in a square for the app tiles. It is never cropped.
const tile = (s) => sized(mark, s, s);
const sparkTile = (s) => sized(paint(sparkSmall), s, s);
// The tab cut: favicon.svg with its scheme switch removed, so each panel
// paints it with its own pair. An inline <style> would apply page-wide.
const favicon = read(path.join(brand, 'favicon.svg'))
  .replace(/<style>[\s\S]*?<\/style>\s*/, '')
  .replace('class="figure"', 'fill="var(--ink)" stroke="var(--ink)"')
  .replace('class="spark"', 'fill="var(--spark)"');
const tab = (s) => sized(favicon, s, s);

const NAME = JSON.parse(read(path.join(here, '..', '..', 'product.json'))).name;
const word = (cls = '', size = 40) => `<span class="word ${cls}" style="font-size:${size}px">${NAME}</span>`;

const html = `<!--
  Copyright (C) 2026 Perseo Mazzoni
  SPDX-License-Identifier: AGPL-3.0-or-later
  Free software under the GNU Affero General Public License, version 3 or
  later; the full text is in \`LICENSE\`.
-->
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${NAME} — logo study</title>
<style>
${fontCss}
${emblemCss}
:root{--night:#07090D;--day:#FFFFFF;--ink-n:#F2F4F7;--ink-d:#1D2126;--spark-n:#3BE8E5;--spark-d:#0E6E73;--dim:rgba(242,244,247,.55);--rule:rgba(242,244,247,.12)}
*{box-sizing:border-box}
body{margin:0;background:var(--night);color:var(--ink-n);font-family:Geist,system-ui,sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.night{background:var(--night);color:var(--ink-n);--paper:var(--night);--ink:var(--ink-n);--spark:var(--spark-n);--mute:rgba(242,244,247,.55);--line:rgba(242,244,247,.14);--raised:#101318}
.day{background:var(--day);color:var(--ink-d);--paper:var(--day);--ink:var(--ink-d);--spark:var(--spark-d);--mute:rgba(29,33,38,.6);--line:rgba(29,33,38,.14);--raised:#F3F2EE}
main{max-width:1100px;margin:0 auto;padding:0 40px 120px}
header.top{padding:96px 0 64px;border-bottom:1px solid var(--rule)}
header.top h1{font-family:Newsreader,serif;font-weight:400;font-size:56px;line-height:1.05;margin:0 0 16px;letter-spacing:-.01em}
header.top p{max-width:60ch;color:var(--dim);margin:0;font-size:17px}
section{padding:72px 0;border-bottom:1px solid var(--rule)}
section>h2{font-family:Geist,sans-serif;font-weight:500;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:0 0 8px}
section>h3{font-family:Newsreader,serif;font-weight:400;font-size:34px;margin:0 0 20px;letter-spacing:-.01em}
section>p,.note{max-width:62ch;color:var(--dim);margin:0 0 28px}
.word{font-family:Newsreader,serif;font-weight:400;letter-spacing:-.012em;white-space:nowrap;line-height:1}
.word.geist{font-family:Geist,sans-serif;font-weight:500;letter-spacing:-.02em}
.word.mono{font-family:"Geist Mono",monospace;font-weight:400;letter-spacing:0}
.word.brygada{font-family:"Brygada 1918",serif;font-weight:400}
.word.caps{font-weight:600;letter-spacing:.2em;text-transform:uppercase}
.word.it{font-style:italic;font-weight:300}
.word.light{font-weight:300}
.tag{font-family:Geist,sans-serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--mute)}
.grid{display:grid;gap:24px}
.g4{grid-template-columns:repeat(4,1fr)}.g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:repeat(3,1fr)}
.card{background:var(--raised);border:1px solid var(--line);border-radius:14px;padding:28px;display:flex;flex-direction:column;gap:16px;min-height:220px}
.card .art{flex:1;display:flex;align-items:center;justify-content:center;min-height:140px}
.card h4{margin:0;font-weight:500;font-size:15px}
.card p{margin:0;color:var(--mute);font-size:13px;line-height:1.45}
.card small{color:var(--mute);font-size:12px}
.panel{border:1px solid var(--line);border-radius:14px;padding:40px;margin-bottom:24px}
.row{display:flex;align-items:flex-end;gap:36px;flex-wrap:wrap}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}
figcaption{font-size:11px;color:var(--mute);font-family:"Geist Mono",monospace}
.type-row{display:grid;grid-template-columns:1fr 280px;gap:32px;align-items:center;padding:28px 0;border-top:1px solid var(--line)}
.type-row:last-child{border-bottom:1px solid var(--line)}
.type-row .why{font-size:13px;color:var(--mute)}
.type-row .why b{display:block;color:var(--ink);font-weight:500;margin-bottom:4px;font-family:Geist}
.verdict{display:inline-block;font-family:"Geist Mono",monospace;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);margin-left:10px;vertical-align:middle;color:var(--mute)}
.verdict.yes{color:var(--spark);border-color:var(--spark)}
.lockup{display:inline-flex;align-items:center;gap:22px}
.stack{display:inline-flex;flex-direction:column;align-items:center;gap:18px}
.clear{position:relative;display:inline-block;padding:var(--x);outline:1px dashed var(--spark);outline-offset:-1px}
.clear::after{content:"X";position:absolute;left:4px;top:0;font:11px "Geist Mono",monospace;color:var(--spark)}
.sw{display:flex;flex-direction:column;gap:10px}
.sw .chip{height:88px;border-radius:12px;border:1px solid var(--line)}
.sw b{font-weight:500;font-size:14px}.sw code{font-family:"Geist Mono",monospace;font-size:12px;color:var(--mute)}
.sw .cr{font-size:12px;color:var(--mute)}
/* mocks */
.tabbar{display:flex;align-items:flex-end;gap:2px;background:var(--raised);padding:10px 12px 0;border-radius:12px 12px 0 0;border:1px solid var(--line);border-bottom:0}
.tab{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px 8px 0 0;font-size:12px;color:var(--mute);background:transparent}
.tab.on{background:var(--paper);color:var(--ink)}
.tab .fav{width:16px;height:16px;display:inline-flex}
.urlbar{background:var(--paper);border:1px solid var(--line);border-top:0;border-radius:0 0 12px 12px;padding:10px 14px;font-size:12px;color:var(--mute);font-family:"Geist Mono",monospace}
.home{display:grid;grid-template-columns:repeat(4,64px);gap:22px;justify-content:center;padding:28px;border-radius:24px;background:var(--raised);border:1px solid var(--line)}
.home figure{gap:7px}.home figcaption{font-family:Geist;font-size:10px;color:var(--ink)}
.app{width:60px;height:60px;border-radius:14px;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.app.blank{background:var(--line)}
.app.ours{background:var(--paper);border:1px solid var(--line)}
.bar{height:52px;display:flex;align-items:center;gap:28px;padding:0 18px;border:1px solid var(--line);border-radius:10px;background:var(--paper)}
.bar .nav{display:flex;gap:22px;font-size:13px;color:var(--mute);margin-left:auto}
.signin{max-width:360px;margin:0 auto;padding:44px 36px;border:1px solid var(--line);border-radius:18px;background:var(--raised);text-align:center}
.signin .btn{margin-top:28px;display:inline-block;padding:10px 18px;border-radius:8px;border:1px solid var(--line);font-size:13px}
.signin p{font-size:13px;color:var(--mute);margin:14px 0 0}
.bar .avatar{width:26px;height:26px;border-radius:50%;background:var(--line)}
.social{width:600px;height:315px;margin:0 auto;background:var(--night);color:var(--ink-n);--ink:var(--ink-n);--spark:var(--spark-n);--mute:rgba(242,244,247,.55);border-radius:10px;display:flex;align-items:center;gap:30px;padding:0 44px;border:1px solid var(--rule);overflow:hidden}
.social img{height:240px;width:240px;object-fit:cover;object-position:50% 32%;border-radius:50%}
.dont{display:grid;grid-template-columns:1fr 1fr;gap:40px}
.dont ul{margin:0;padding-left:18px;color:var(--mute);font-size:14px}.dont li{margin:8px 0}.dont h4{margin:0 0 10px;font-weight:500}
@media(max-width:860px){main{padding:0 20px 80px}.g4,.g3{grid-template-columns:1fr 1fr}.g2{grid-template-columns:1fr}.type-row{grid-template-columns:1fr}.social{width:100%;height:auto;padding:24px}.social img{height:120px;width:120px}}
</style></head>
<body class="night"><main>

<header class="top">
  <div class="tag" style="margin-bottom:22px">Logo study · October 2026</div>
  <h1>${NAME}</h1>
  <p>One emblem, three marks cut from it, and a name set in the studio's own serif. Everything below is traced from the painted original; nothing is redrawn.</p>
</header>

<section>
  <h2>01</h2><h3>Origin</h3>
  <p>The emblem is a brush painting: four figures in a ring, each lit by a cyan spark. It is the brand's hero and stays untouched at hero sizes. It cannot shrink, so the marks below are cut from it rather than designed beside it.</p>
  <div class="grid g2" style="align-items:center">
    <span class="emblem" style="width:100%;aspect-ratio:1;border-radius:14px;background-position:center;background-size:contain"></span>
    <div>
      <p style="margin-bottom:18px">What the family keeps from it:</p>
      <ul style="color:var(--dim);padding-left:18px;margin:0;line-height:1.7">
        <li>the dry-brush edge, traced, not smoothed</li>
        <li>the leaping human as the figure (the writer is the subject)</li>
        <li>one spark at the chest, the only colour</li>
        <li>black ground, white ink, cyan light</li>
      </ul>
    </div>
  </div>
</section>

<section>
  <h2>02</h2><h3>The family</h3>
  <p>Three marks, one per size band. Each one is the largest piece of the emblem that still reads at that size. Nothing is used outside its band.</p>
  <div class="grid g3">
    <div class="card"><div class="art"><span class="emblem" style="width:150px;height:150px;border-radius:50%"></span></div><h4>Emblem</h4><p>Landing hero, sign-in splash, Settings › About, social card, print.</p><small>240px and up</small></div>
    <div class="card"><div class="art">${fitH(mark, 150)}</div><h4>Figure</h4><p>The logo. The app and landing headers, lockups and, whole on the night ground, the touch icon and the installed app's icons. A heavier-stroked cut of it is the browser tab icon.</p><small>32px and up · tab cut 16px</small></div>
    <div class="card"><div class="art">${sparkTile(96)}</div><h4>Spark</h4><p>The figure's heart, on its own. Nothing in the app shows it alone: the splash lights it in the figure's chest.</p><small>16 to 24px</small></div>
  </div>
  <div class="panel" style="margin-top:24px">
    <div class="tag" style="margin-bottom:24px">Each mark at the bottom of its band</div>
    <div class="row">
      <figure>${fitH(mark, 32)}<figcaption>figure 32</figcaption></figure>
      <figure>${fitH(mark, 96)}<figcaption>figure 96</figcaption></figure>
      <figure>${tab(16)}<figcaption>tab cut 16</figcaption></figure>
      <figure>${tab(32)}<figcaption>tab cut 32</figcaption></figure>
      <figure><span class="app ours" style="width:32px;height:32px;border-radius:7px">${tile(26)}</span><figcaption>tile 32</figcaption></figure>
      <figure><span class="app ours" style="width:48px;height:48px;border-radius:11px">${tile(38)}</span><figcaption>tile 48</figcaption></figure>
      <figure><span class="app ours" style="width:96px;height:96px;border-radius:22px">${tile(76)}</span><figcaption>tile 96</figcaption></figure>
      <figure>${sparkTile(16)}<figcaption>spark 16</figcaption></figure>
      <figure>${sparkTile(24)}<figcaption>spark 24</figcaption></figure>
      <figure>${sparkTile(32)}<figcaption>spark 32</figcaption></figure>
    </div>
  </div>
</section>

<section>
  <h2>03</h2><h3>Wordmark</h3>
  <p>The mark is a gesture: wet, fast, uneven. The name must be its opposite, composed and still, or the two fight for the same register. The studio ships three faces with three jobs: Newsreader sets prose and titles, Geist the interface, Geist Mono paths, counts and labels.</p>

  <div class="type-row">
    <div>${word('', 52)}<span class="verdict yes">wordmark</span></div>
    <div class="why"><b>Newsreader 400</b>An editorial serif with real contrast in its strokes. It says manuscript, not software, and its calm sits well against the brush. Tracking tightened 1.2%. The name in every piece of brand material, and in the app under Matte and Radiant.</div>
  </div>
  <div class="type-row">
    <div>${word('brygada', 52)}<span class="verdict">Vision</span></div>
    <div class="why"><b>Brygada 1918 400</b>Vision's book face, a roman of the years the Vienna workshops printed in. Vision sets its whole chrome in it, so the name follows. Inside the app only.</div>
  </div>
  <div class="type-row">
    <div>${word('mono caps', 30)}<span class="verdict">Shine</span></div>
    <div class="why"><b>Geist Mono 600, capitals, tracked 20%</b>Too technical for the brand: the product is a studio for writers, not a terminal. Shine wears it in its header and on its landing, because Shine's chrome is mono. Inside Shine only.</div>
  </div>
  <div class="type-row">
    <div>${word('it', 52)}<span class="verdict">alternate</span></div>
    <div class="why"><b>Newsreader 300 italic</b>Beautiful alone, but the italic is itself a gesture, and two gestures side by side cancel. Reserve it for the tagline in editorial settings.</div>
  </div>
  <div class="type-row">
    <div>${word('geist', 48)}<span class="verdict">interface only</span></div>
    <div class="why"><b>Geist 500</b>Clean, but it reads as a product name on a pricing page. It is the right face for everything around the wordmark: navigation, the tagline, buttons.</div>
  </div>
  <p class="note" style="margin:28px 0 0">The mark never changes with the theme. The name does: inside the app, each theme sets it in a face of its own. Outside the app, the name is always Newsreader 400.</p>

  <div class="panel" style="margin-top:40px">
    <div class="tag" style="margin-bottom:28px">The pairing: serif name, sans everything else</div>
    <div class="stack" style="align-items:flex-start;gap:14px">
      ${word('', 64)}
      <span class="tag" style="letter-spacing:.3em">The same spark</span>
    </div>
  </div>
</section>

<section>
  <h2>04</h2><h3>Lockups</h3>
  <p>The figure stands at twice the cap height of the name, its raised hand clearing the top of the ascenders. Clear space on every side is X, the width of the figure's head. Never place anything inside it.</p>

  <div class="panel">
    <div class="tag" style="margin-bottom:28px">Horizontal, primary</div>
    <span class="clear" style="--x:34px"><span class="lockup">${fitH(mark, 92)}${word('', 46)}</span></span>
  </div>

  <div class="grid g2">
    <div class="panel" style="margin:0;text-align:center">
      <div class="tag" style="margin-bottom:28px">Stacked, for centred screens</div>
      <span class="stack">${fitH(mark, 150)}${word('', 40)}<span class="tag" style="letter-spacing:.3em">The same spark</span></span>
    </div>
    <div class="panel day" style="margin:0;text-align:center">
      <div class="tag" style="margin-bottom:28px">The same, on the day theme</div>
      <span class="stack">${fitH(mark, 150)}${word('', 40)}<span class="tag" style="letter-spacing:.3em">The same spark</span></span>
    </div>
  </div>

  <div class="panel" style="margin-top:24px">
    <div class="tag" style="margin-bottom:28px">Minimum sizes</div>
    <div class="row">
      <figure><span class="lockup" style="gap:12px">${fitH(mark, 32)}${word('', 18)}</span><figcaption>smallest lockup, the header · figure 32</figcaption></figure>
      <figure><span class="lockup" style="gap:14px">${fitH(mark, 48)}${word('', 24)}</span><figcaption>figure 48</figcaption></figure>
      <figure>${word('', 20)}<figcaption>wordmark alone · 120px wide</figcaption></figure>
    </div>
    <p class="note" style="margin:28px 0 0">Below a 32px figure, the lockup drops the figure and keeps the name. The spark never sits beside the name on its own: the splash without its figure is a decoration, not a signature.</p>
  </div>
</section>

<section>
  <h2>05</h2><h3>Colour</h3>
  <p>Two grounds, one ink per ground, one light. The light is the only colour. The cyan is sampled from the painting, and it fails on white (1.5:1), so on a light ground the spark is a deep teal of the same hue instead.</p>
  <div class="grid g3">
    <div class="sw"><div class="chip" style="background:#07090D"></div><b>Night</b><code>#07090D</code><span class="cr">the app icons' ground and the installed app's theme colour</span></div>
    <div class="sw"><div class="chip" style="background:#F2F4F7"></div><b>Ink, night</b><code>#F2F4F7</code><span class="cr">18.1:1 on Night</span></div>
    <div class="sw"><div class="chip" style="background:#3BE8E5"></div><b>Spark</b><code>#3BE8E5</code><span class="cr">13.2:1 on Night · sampled from the emblem</span></div>
    <div class="sw"><div class="chip" style="background:#FFFFFF"></div><b>Day</b><code>#FFFFFF</code><span class="cr">the light ground the day pair is measured on</span></div>
    <div class="sw"><div class="chip" style="background:#1D2126"></div><b>Ink, day</b><code>#1D2126</code><span class="cr">16.2:1 on Day</span></div>
    <div class="sw"><div class="chip" style="background:#0E6E73"></div><b>Spark, day</b><code>#0E6E73</code><span class="cr">6.0:1 on Day · same hue, deepened</span></div>
  </div>
  <p class="note" style="margin-top:32px">The figure is always ink and the spark is always the light. Neither takes any other colour, and the spark never appears on a cyan ground. These pairs belong to the mark, not to a theme: in the app, the page's colour scheme alone picks the night or the day pair, and no theme can repaint the logo or lend it its own ink.</p>
</section>

<section>
  <h2>06</h2><h3>In use</h3>
  <p>Each mark in the place it is for.</p>

  <div class="grid g2">
    <div>
      <div class="tag" style="margin-bottom:14px">Browser tab · tab cut 16</div>
      <div class="tabbar"><div class="tab on"><span class="fav">${tab(16)}</span>${NAME}</div><div class="tab"><span class="fav" style="background:var(--line);border-radius:3px"></span>Dictionary</div><div class="tab"><span class="fav" style="background:var(--line);border-radius:3px"></span>Mail</div></div>
      <div class="urlbar">oncedark.studio/app</div>
    </div>
    <div class="day" style="border-radius:14px;padding:1px">
      <div class="tag" style="margin:14px 0 14px 14px">Browser tab, day · tab cut 16</div>
      <div style="padding:0 14px 14px"><div class="tabbar"><div class="tab on"><span class="fav">${tab(16)}</span>${NAME}</div><div class="tab"><span class="fav" style="background:var(--line);border-radius:3px"></span>Dictionary</div></div><div class="urlbar">oncedark.studio/app</div></div>
    </div>
  </div>

  <div class="grid g2" style="margin-top:24px">
    <div><div class="tag" style="margin-bottom:14px">Home screen · the figure on the night ground</div>
      <div class="home">
        <figure><span class="app blank"></span><figcaption>Notes</figcaption></figure>
        <figure><span class="app ours night">${tile(46)}</span><figcaption>Once Dark</figcaption></figure>
        <figure><span class="app blank"></span><figcaption>Mail</figcaption></figure>
        <figure><span class="app blank"></span><figcaption>Photos</figcaption></figure>
      </div></div>
    <div class="day" style="border-radius:14px;padding:14px"><div class="tag" style="margin-bottom:14px">Home screen, day</div>
      <div class="home">
        <figure><span class="app blank"></span><figcaption>Notes</figcaption></figure>
        <figure><span class="app ours night">${tile(46)}</span><figcaption>Once Dark</figcaption></figure>
        <figure><span class="app blank"></span><figcaption>Mail</figcaption></figure>
        <figure><span class="app blank"></span><figcaption>Photos</figcaption></figure>
      </div></div>
  </div>

  <div style="margin-top:24px"><div class="tag" style="margin-bottom:14px">Library header · figure 32</div>
    <div class="bar"><span class="lockup" style="gap:12px">${fitH(mark, 32)}${word('', 18)}</span><div class="nav"><span>Palette</span><span class="avatar"></span></div></div>
  </div>
  <div class="day" style="margin-top:12px;border-radius:12px;padding:12px"><div class="bar"><span class="lockup" style="gap:12px">${fitH(mark, 32)}${word('', 18)}</span><div class="nav"><span>Palette</span><span class="avatar"></span></div></div></div>

  <div class="grid g3" style="margin-top:40px;align-items:start">
    <div><div class="tag" style="margin-bottom:14px">Landing · figure 32, emblem hero</div>
      <div class="signin"><span class="lockup" style="gap:10px">${fitH(mark, 32)}${word('', 16)}</span><span class="emblem" style="width:150px;height:150px;margin:24px auto 0;border-radius:50%"></span><span class="btn">Sign in with Google</span><p>The emblem shows at 300px on the page.</p></div></div>
    <div><div class="tag" style="margin-bottom:14px">Settings › About · emblem 240</div>
      <div class="signin"><span class="stack" style="gap:12px"><span class="emblem" style="width:150px;height:150px;border-radius:50%"></span>${word('', 24)}<span class="tag" style="letter-spacing:.3em">The same spark</span></span><p>A stacked lockup with the emblem in place of the figure.</p></div></div>
    <div><div class="tag" style="margin-bottom:14px">Social card · emblem · not shipped</div>
      <div class="social" style="width:100%;height:auto;aspect-ratio:1200/630;padding:0 5%;gap:20px"><span class="emblem" style="flex:none;width:30%;aspect-ratio:1;border-radius:50%"></span><div class="stack" style="align-items:flex-start;gap:8px;min-width:0">${word('', 20)}<span class="tag" style="letter-spacing:.3em;font-size:8px">The same spark</span></div></div></div>
  </div>
  <p class="note" style="margin:32px 0 0">Exports carry no mark. A manuscript is the writer's, so the name goes only into each file's metadata, as its generator or creator.</p>
</section>

<section>
  <h2>07</h2><h3>Rules</h3>
  <div class="dont">
    <div><h4>Do</h4><ul>
      <li>Use the figure as the logo everywhere it has 32px of height.</li>
      <li>Use the tab cut for the browser tab, the whole figure on the night ground for any square tile. Never crop it.</li>
      <li>In brand material, set the name in Newsreader 400, tracked 1.2% tight, and nothing else.</li>
      <li>Keep X of clear space around every lockup.</li>
      <li>Paint the mark in its own night or day pair, picked by the ground alone.</li>
      <li>Keep the traced edge. It is the signature.</li>
    </ul></div>
    <div><h4>Don't</h4><ul>
      <li>Don't shrink the emblem or the ring below 240px: it becomes a smudge.</li>
      <li>Don't put the full figure in any slot under 32px; the tab cut exists for that.</li>
      <li>Don't set the name in Geist, in italic, in caps, or in any weight but 400 outside the app. Inside it, the theme decides.</li>
      <li>Don't recolour the figure, paint it in a theme's ink, add a gradient, a glow or a drop shadow.</li>
      <li>Don't use the cyan on a light ground; the day teal exists for that.</li>
      <li>Don't smooth, outline, stroke or redraw the figure's edge.</li>
    </ul></div>
  </div>
</section>

</main></body></html>
`;
fs.writeFileSync(path.join(brand, 'study.html'), html);
console.log('study.html', Math.round(html.length / 1024), 'KB');
