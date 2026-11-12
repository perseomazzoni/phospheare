// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// WCAG 2 contrast between two of a theme's tokens, as the page would paint
// them: each token's `var()` chain followed to a colour, a translucent ink
// laid over its ground and a translucent ground over the page's paper.
// A value that is wholly a hex, an `rgb()`/`rgba()` or a
// `color-mix(in srgb, X p%, transparent)` is read; anything else (another
// mix, a gradient, `light-dark()`) is not a colour this module can judge,
// and says so rather than judging the first colour in it.

type Rgba = [number, number, number, number];

/** Inks on the grounds they are set on, held to 4.5:1 as text (1.4.3). */
export const TEXT_PAIRS: [string, string][] = [
  ["--ink", "--paper"],
  ["--ink", "--paper-raised"],
  ["--ink", "--paper-sunk"],
  ["--ink", "--field"],
  ["--ink-2", "--paper"],
  ["--ink-3", "--paper"],
  ["--ink-3", "--paper-raised"],
  ["--prose-ink", "--paper"],
  ["--accent", "--paper"],
  ["--danger", "--paper"],
  ["--on-fill", "--accent"],
  ["--tip-ink", "--tip-solid"],
  ["--press-ink", "--press-ground"],
];

/** A focus ring's and a control's marks, held to 3:1 (1.4.11). */
export const MARK_PAIRS: [string, string][] = [
  ["--accent", "--paper-raised"],
  ["--attention", "--paper"],
];

/**
 * A token's value with every `var()` replaced, its fallback taken when the
 * name is not stated, or `null` for a cycle or a name with neither.
 */
export function resolve(
  tokens: Record<string, string>,
  value: string,
  depth = 0,
): string | null {
  if (depth > 12) return null;
  const at = value.indexOf("var(");
  if (at < 0) return value;
  // The `var()`'s closing parenthesis, past any its fallback holds.
  let end = at + 4;
  for (let open = 1; end < value.length && open > 0; end++)
    if (value[end] === "(") open++;
    else if (value[end] === ")") open--;
  const inside = value.slice(at + 4, end - 1);
  const comma = inside.indexOf(",");
  const name = (comma < 0 ? inside : inside.slice(0, comma)).trim();
  const stated = tokens[name];
  const replaced =
    stated !== undefined
      ? resolve(tokens, stated, depth + 1)
      : comma < 0
        ? null
        : resolve(tokens, inside.slice(comma + 1).trim(), depth + 1);
  const rest = resolve(tokens, value.slice(end), depth);
  if (replaced === null || rest === null) return null;
  return value.slice(0, at) + replaced + rest;
}

/** The colour a resolved value is, or `null` when it is not one it reads. */
export function parseColor(value: string): Rgba | null {
  const v = value.trim();
  if (v === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(
      v,
    );
  if (rgb) {
    const a =
      rgb[4] === undefined
        ? 1
        : rgb[4].endsWith("%")
          ? parseFloat(rgb[4]) / 100
          : parseFloat(rgb[4]);
    return [+rgb[1], +rgb[2], +rgb[3], a];
  }
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(
    v,
  );
  if (mix) {
    const c = parseColor(mix[1]);
    return c && [c[0], c[1], c[2], c[3] * (parseFloat(mix[2]) / 100)];
  }
  return null;
}

/** `top` laid over an opaque `under`. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The contrast of the token `ink` on the token `ground`, both read from
 * `tokens`, the ground laid on `--paper` first; `null` when either holds no
 * colour this module reads.
 */
export function contrast(
  tokens: Record<string, string>,
  ink: string,
  ground: string,
): number | null {
  const read = (name: string) => {
    const value = resolve(tokens, tokens[name] ?? "");
    return value === null ? null : parseColor(value);
  };
  const paper = read("--paper");
  const g = read(ground);
  const i = read(ink);
  if (!paper || !g || !i) return null;
  const base = over(g, over(paper, [255, 255, 255, 1]));
  const [x, y] = [luminance(over(i, base)), luminance(base)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
