// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Page } from "@playwright/test";

/** A part of a picture, in its own pixels. */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Re-encodes a PNG in the browser, so no image library is needed: as WebP
 * by default, keeping only `area` when one is given. Cropping here rather
 * than clipping the screenshot keeps a frosted pane whole at the edge: a
 * clipped capture blurs nothing past its border, so the text behind the
 * pane shows through there.
 */
export async function encode(
  page: Page,
  png: Buffer,
  {
    type = "image/webp",
    quality = 0.82,
    area,
  }: { type?: string; quality?: number; area?: Area } = {},
): Promise<Buffer> {
  const encoded = await page.evaluate(
    async ({ data, type, quality, area }) => {
      // An image, not a fetch: the app's policy lets `data:` into an image
      // and keeps it out of `connect-src`.
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const bitmap = await createImageBitmap(image);
      const { x, y, width, height } = area ?? {
        x: 0,
        y: 0,
        width: bitmap.width,
        height: bitmap.height,
      };
      const canvas = new OffscreenCanvas(width, height);
      canvas
        .getContext("2d")!
        .drawImage(bitmap, x, y, width, height, 0, 0, width, height);
      const out = await canvas.convertToBlob({ type, quality });
      const bytes = new Uint8Array(await out.arrayBuffer());
      let text = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    },
    { data: png.toString("base64"), type, quality, area },
  );
  return Buffer.from(encoded, "base64");
}

/** Re-encodes a PNG as WebP, whole. */
export function toWebp(page: Page, png: Buffer, quality = 0.82) {
  return encode(page, png, { quality });
}
