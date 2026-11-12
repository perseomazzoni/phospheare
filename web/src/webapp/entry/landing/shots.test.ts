// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { allThemes } from "../../../theme";
import shots from "./shots.json";

// The landing page shows each screen in the theme the visitor wears, so every
// registered theme needs every picture: a new theme, or a new default, can
// never reach the page without its screenshots (`npm run shots:landing`).
//
// The page sets each picture's shape from `shots.json` before it loads, so a
// file captured at another size (a crop changed, the manifest not rewritten)
// would be drawn stretched.

const FILES = import.meta.glob<string>("../../../../public/landing/*.webp", {
  query: "?inline",
  import: "default",
});

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const PICTURES = new Map(
  Object.entries(FILES).map(([path, load]) => [nameOf(path), load]),
);

/** A WebP's width and height, read from its first chunk's header. */
function sizeOf(dataUrl: string): { width: number; height: number } {
  // 64 base64 characters are the first 48 bytes, past every header field.
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const head = atob(data.slice(0, 64));
  const byte = (at: number) => head.charCodeAt(at);
  const uint = (at: number, length: number) =>
    Array.from({ length }, (_, i) => byte(at + i) << (8 * i)).reduce(
      (sum, part) => sum + part,
      0,
    );
  const chunk = head.slice(12, 16);
  if (chunk === "VP8X")
    return { width: uint(24, 3) + 1, height: uint(27, 3) + 1 };
  if (chunk === "VP8L") {
    const bits = uint(21, 4);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { width: uint(26, 2) & 0x3fff, height: uint(28, 2) & 0x3fff };
}

describe("the landing's screenshots", () => {
  it.each(allThemes().map((theme) => theme.id))(
    "cover every surface in %s",
    (id) => {
      const missing = Object.keys(shots.surfaces).filter(
        (surface) => !PICTURES.has(`${id}-${surface}.webp`),
      );
      expect(missing).toEqual([]);
    },
  );

  it.each(allThemes().map((theme) => theme.id))(
    "are the size the page reserves for them in %s",
    async (id) => {
      const wrong: string[] = [];
      for (const [surface, size] of Object.entries(shots.surfaces)) {
        const load = PICTURES.get(`${id}-${surface}.webp`);
        if (!load) continue;
        const actual = sizeOf(await load());
        if (actual.width !== size.width || actual.height !== size.height)
          wrong.push(surface);
      }
      expect(wrong).toEqual([]);
    },
  );
});
