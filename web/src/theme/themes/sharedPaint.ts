// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A theme's sheet as the page uses it: the paint every theme shares
// (`shared.css`), then the theme's own. The shared rules stand where each
// sheet had them, just before its own rules and in the layer that holds its
// paint: `paint` for a sheet that layers its paint, and no layer for Matte,
// which paints outside one. A theme overrides a shared rule by stating it
// again in its own sheet.

const shared = () => import("./shared.css?inline").then((m) => m.default);

/** The loader a family's `sheet` takes: shared paint, then `own`. */
export function withSharedPaint(
  own: () => Promise<{ default: string }>,
  layer?: "paint",
): () => Promise<string> {
  return async () => {
    const [common, sheet] = await Promise.all([shared(), own()]);
    const placed = layer ? `@layer ${layer} {\n${common}\n}` : common;
    return `${placed}\n${sheet.default}`;
  };
}
