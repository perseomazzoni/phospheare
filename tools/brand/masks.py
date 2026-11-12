# Copyright (C) 2026 Perseo Mazzoni
# SPDX-License-Identifier: AGPL-3.0-or-later
# Free software under the GNU Affero General Public License, version 3 or
# later; the full text is in `LICENSE`.

import cv2, numpy as np
im = cv2.imread('source.webp')
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
cyan = ((hsv[...,0] > 80) & (hsv[...,0] < 100) & (hsv[...,1] > 90) & (hsv[...,2] > 110)).astype(np.uint8)*255
ink = ((gray > 110) | (cyan > 0)).astype(np.uint8)*255
# hand mask for the human figure, full-image coordinates
poly = np.array([
 (570,128),(665,128),(690,190),(745,155),(788,124),(814,148),(772,198),(750,220),(700,258),(665,285),
 (655,300),(655,350),(700,395),(745,433),(754,468),(715,482),(650,425),(630,405),
 (600,450),(565,505),(515,548),(497,520),(540,445),(582,385),(585,340),(572,300),
 (520,328),(485,362),(440,352),(465,302),(520,278),(572,255),(582,220),(566,180)], np.int32)
mask = np.zeros_like(ink); cv2.fillPoly(mask, [poly], 255)
fig = cv2.bitwise_and(ink, mask)
def write_preview():
    p = im.copy()
    cv2.polylines(p, [poly], True, (0,0,255), 2)
    p[fig>0] = (0.5*p[fig>0] + (0,128,0)).astype(np.uint8)
    cv2.imwrite('mask_preview.png', cv2.resize(p[100:580, 420:860], None, fx=1.6, fy=1.6))
if __name__ == '__main__':
    write_preview()
    sp = np.zeros_like(cyan); sp[220:370, 540:735] = cyan[220:370, 540:735]
    cv2.imwrite('spark_mask.png', cv2.resize(sp[200:390, 520:755], None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST))
