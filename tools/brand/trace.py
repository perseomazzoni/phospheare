# Copyright (C) 2026 Perseo Mazzoni
# SPDX-License-Identifier: AGPL-3.0-or-later
# Free software under the GNU Affero General Public License, version 3 or
# later; the full text is in `LICENSE`.

import cv2, numpy as np, sys
sys.path.insert(0, '.')
import masks
OUT = '../../docs/brand/'
hsv = masks.hsv
# Looser cyan: the thin rays are anti-aliased against white, so their saturation drops.
cyan = ((hsv[...,0] > 78) & (hsv[...,0] < 102) & (hsv[...,1] > 45) & (hsv[...,2] > 90)).astype(np.uint8)*255
spark = np.zeros_like(cyan); spark[222:372, 545:735] = cyan[222:372, 545:735]
fig = masks.fig.copy()
# Seal the dry-brush cracks inside the strokes before anything measures them:
# at hero size they are the texture, at mark size they read as a broken limb,
# and the taper below judges depth against them.
fig = cv2.morphologyEx(fig, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9,9)))
# Brush lift at each limb end. Where the mask cut a stroke that continues into
# the ring, erode it toward the tip: a pixel survives only if it sits deeper
# inside the stroke than the taper demands, and the demand rises to the full
# half-width at the tip, so the stroke thins to nothing along its own shape
# instead of ending in a block.
inside = cv2.distanceTransform(fig, cv2.DIST_L2, 3)
yy, xx = np.mgrid[:fig.shape[0], :fig.shape[1]]
for (ex, ey, L) in [(812,146,70), (440,352,60), (515,548,60), (754,468,55)]:
    need = 14 * np.clip(1 - np.hypot(xx - ex, yy - ey) / L, 0, 1)
    fig[inside < need] = 0
fig[fig > 0] = 255
# Anything the taper cut loose is a droplet, not a limb.
n, lab, stats, _ = cv2.connectedComponentsWithStats(fig)
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] < 150: fig[lab == i] = 0
# Shorten the right leg: the last stretch belongs to the goat and the bird's beak.

def trace(mask, min_outer, min_hole, eps, pad=6):
    """Contours → SVG path (evenodd). Drops islands under min_outer px² and
    specks of black under min_hole px² — the brush texture that reads as noise
    once the shape is small — but keeps every larger ragged edge."""
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    ys, xs = np.where(mask > 0)
    x0, y0, x1, y1 = xs.min()-pad, ys.min()-pad, xs.max()+pad, ys.max()+pad
    d = []
    for i, c in enumerate(cs):
        is_hole = hier[0][i][3] >= 0
        a = cv2.contourArea(c)
        if (is_hole and a < min_hole) or (not is_hole and a < min_outer): continue
        if not is_hole and hier[0][i][3] < 0:
            pass
        elif is_hole and cv2.contourArea(cs[hier[0][i][3]]) < min_outer: continue
        c = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(c) < 3: continue
        d.append('M' + ' '.join(f'{x-x0},{y-y0}' for x, y in c) + 'Z')
    return ' '.join(d), (x1-x0, y1-y0), (x0, y0)

def svg(path, size, extra=''):
    w, h = size
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">\n'
            f'  <path fill="currentColor" fill-rule="evenodd" d="{path}"/>{extra}\n</svg>\n')

# Spark, full: every ray the mask caught. Spark, small: core and the heavier rays only,
# which is what survives a 16px render; the fine rays become grey haze there.
sp_full, sp_size, sp_org = trace(spark, 12, 10, 0.8)
# Small spark: the same splash thickened by one pixel so the thin rays still
# cover a pixel at 16px, with the far-flung droplets dropped and the frame
# squared on the core rather than on the splash's lopsided bounding box.
n, lab, stats, cents = cv2.connectedComponentsWithStats(spark)
core = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]); ccx, ccy = cents[core]
near = np.zeros_like(spark)
for i in range(1, n):
    if np.hypot(*(cents[i] - (ccx, ccy))) < 58 and stats[i, cv2.CC_STAT_AREA] >= 6: near[lab == i] = 255
near = cv2.dilate(near, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3,3)))
ys, xs = np.where(near > 0)
half = int(max(ccx - xs.min(), xs.max() - ccx, ccy - ys.min(), ys.max() - ccy)) + 4
sq = np.zeros_like(near); x0, y0 = int(ccx) - half, int(ccy) - half
sq[y0:y0+2*half, x0:x0+2*half] = near[y0:y0+2*half, x0:x0+2*half]
cs, _ = cv2.findContours(sq, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
sp_small = ' '.join('M' + ' '.join(f'{x-x0},{y-y0}' for x, y in cv2.approxPolyDP(c, 0.8, True).reshape(-1, 2)) + 'Z'
                    for c in cs if len(c) >= 3)
open(OUT+'spark.svg','w').write(svg(sp_full, sp_size))
open(OUT+'spark-small.svg','w').write(svg(sp_small, (2*half, 2*half)))

# Figure: fill the black specks inside the strokes, keep real gaps.
fg_path, fg_size, fg_org = trace(fig, 150, 250, 1.0)
# spark placed in the figure's frame
dx, dy = sp_org[0]-fg_org[0], sp_org[1]-fg_org[1]
sp_in_fig = f'\n  <path class="spark" fill="var(--spark, currentColor)" fill-rule="evenodd" transform="translate({dx} {dy})" d="{sp_full}"/>'
open(OUT+'mark.svg','w').write(svg(fg_path, fg_size, sp_in_fig))
print('spark', sp_size, 'figure', fg_size, 'offset', dx, dy)
