// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import FRAME_CSS from "./frame.css?raw";

// The editor's frame stylesheets as one text, in the order `frame.css`
// imports them, for the tests that read the stylesheet itself. The list comes
// from `frame.css`, so a sheet added there is read here with no other change.

const SHEETS = import.meta.glob<string>("./**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Every `@import` in `frame.css`, in order. */
export const EDITOR_SHEETS = [
  ...FRAME_CSS.matchAll(/@import\s+"([^"]+)"\s+layer\(frame\);/g),
].map(([, path]) => {
  const text = SHEETS[path];
  if (text === undefined)
    throw new Error(`frame.css imports ${path}, which is not under editor/`);
  return { path, text };
});

/** The editor's frame stylesheets joined, in cascade order. */
export const EDITOR_CSS = EDITOR_SHEETS.map((s) => s.text).join("\n");
