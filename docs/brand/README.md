# Brand

The product's marks, cut from its emblem by tracing `tools/brand/source.webp`.

In the app:

- `BrandMark` (`web/src/brand`) draws `mark.svg` as the header and landing
  logo, the same under every theme. `web/src/brand/mark.ts` holds the same
  paths and is kept in step with `mark.svg`.
- `favicon.svg` (the figure with its spark) is the app's favicon.
- `tools/brand/icons.mjs` renders the app icons (the whole figure on the night
  ground, never cropped) into `web/public`. The desktop program's Windows icon
  is made from `icon-512.png`.
- `web/public/brand/emblem.webp`, the round emblem, appears on the sign-in
  splash and in Settings › About.
- `tray-day.png` and `tray-night.png` are the sources of the desktop
  program's tray icons; `desktop/tools/winres -tray` turns them into the
  icons.

## Files

- `spark.svg`: the full chest splash, with every ray that the trace caught.
  It fills with `currentColor`; the style sheet paints it with `--spark`.
- `spark-small.svg`: the same splash, thickened by one pixel and squared at
  its core, for a spark drawn alone below 48 px.
- `favicon.svg`: the figure and its spark, squared, with the figure stroked
  heavier so that its limbs hold at 16 px. A `prefers-color-scheme` switch
  picks the header logo's colour pairs; `sheet.js` writes it here and to
  `web/public`.
- `mark.svg`: the leaping figure with the splash at its chest. The cracks of
  the dry-brush texture are sealed, and the four limb ends are tapered where
  the mask cut them from the ring. The spark path carries `class="spark"` and
  takes `--spark`.
- `lockup.svg`: the full spark beside the wordmark in Geist. The text is live;
  convert it to outlines before it ships.
- `lockup-stacked-light.png`, `lockup-stacked-dark.png`: the stacked lockup
  on a transparent ground, in the light pair and the dark pair of
  `favicon.svg`. The top of the README shows the one that suits GitHub's
  theme.
- `tray-day.png`, `tray-night.png`: the whole figure on a transparent square,
  in the pair for a light taskbar and the pair for a dark one.
- `study.html`: the complete study: the origin, the three-mark family, the
  wordmark type candidates, the lockups with clear space and minimum sizes,
  colour with contrast ratios, mock-ups in use, and the rules. It is
  self-contained (the fonts and the emblem are embedded), so it opens from
  disk. `tools/brand/build-study.js` builds it.

## Rebuilding

From `tools/brand/`:

- `python -I masks.py`: the mask preview;
- `python -I trace.py`: writes the SVGs;
- `node sheet.js`: the favicon and the lockup;
- `node build-study.js`: the study.

From the repository root (both need Playwright's Chromium,
`npx playwright install chromium`, once):

- `node tools/brand/icons.mjs`: the app icons;
- `node tools/brand/tray.mjs`: the tray icon sources.

The figure's hand mask is the polygon in `masks.py`; the taper tips are the
four points in `trace.py`.
