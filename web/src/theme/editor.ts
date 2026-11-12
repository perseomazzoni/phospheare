// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The editor's one entry point into the theme. The editor reads what the
// theme on the page changes about it (its frame options, decorations and the
// frame's shell numbers) and flips its variant, and nothing else: no theme's
// id, no palette, no stylesheet, no choice of theme.
// `boundaries.test.ts` holds every editor file to this module.

// The app's themes, registered: the editor always uses one, even drawn
// outside the app's provider (a component test, an embedder).
import "./index";

export { useDecorations, useFrameOptions, useSchemeFlip } from "./useChrome";
export {
  FRAME_GEOMETRY,
  dockRoom,
  type ShellGeometry,
} from "./domain/geometry";
export type { FrameOptions } from "./domain/frame";
export type { Decorations } from "./domain/decorations";
