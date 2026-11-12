// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Colour arithmetic the theme generators share: `oklch` to `srgb` bytes and
// their hex spelling. A generator walks lightness along one hue here, so equal
// steps of `L` read as equal steps of lightness on either ground.

/** `oklch` to `srgb` bytes, clipped to the gamut. */
export function oklchToRgb(
  L: number,
  C: number,
  h: number,
): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
  const [r, g, bl] = lin.map((v) =>
    Math.round(
      255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055),
    ),
  );
  return [r, g, bl];
}

/** Bytes as `#RRGGBB`, upper case. */
export const hex = (rgb: readonly number[]): string =>
  `#${rgb
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
