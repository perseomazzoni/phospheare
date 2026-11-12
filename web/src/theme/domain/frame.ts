// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Frame options ────────────────────────────────────────────────────────────
//
// The few places where the frame draws one of two layouts, each built once in
// the frame's own code and stylesheets. A theme picks one by name and writes
// none of it. The editor reads them through `theme/editor.ts`, the stylesheets
// through the matching attribute on the root (`theme/page.ts`).
//
// Every theme names each option; no option is any theme's by default.

export interface FrameOptions {
  /**
   * Comments stand as cards in whatever room the text leaves, or as notes in
   * a fixed margin column beside the text, the two centred together.
   */
  comments: "cards" | "notes";
  /**
   * The text scrolls under the command bar, which is frosted, and the title
   * bar; or is cut at the bar's foot; or scrolls under the bar and is cut at
   * the sheet's head, the bar standing inside the sheet as it does when cut.
   */
  underBar: "slide" | "cut" | "sheet";
  /**
   * The Dock's faces are chosen on a sliding track, or named as words on a
   * ruled line.
   */
  dockTabs: "track" | "words";
  /**
   * The structure panel floats, inset from the window's edge, the title bar
   * and the window's foot; or is attached, flush to the window's left edge
   * from the title bar's foot to the window's. Its right edge is the same in
   * both, so nothing that stands beside it moves.
   */
  panel: "float" | "attached";
  /**
   * The panel's spine draws its Parts close, a few points apart, or apart,
   * each Part a group of its own with clear room between them.
   */
  spineGroups: "close" | "apart";
  /**
   * The command bar centres on the prose, which stands aside for a margin
   * column and moves with the Dock, or on the paper the prose is set on.
   */
  barCentre: "prose" | "paper";
  /**
   * Where a Dock that covers the measure stands against the command bar:
   * over it, from the panels' horizon, the bar running on beneath it; or
   * below it, the Dock stepping down to the page's top edge so the bar keeps
   * a row of its own between the panel and the window's edge, the panel's
   * head standing on the bar's top and foot.
   */
  leaves: "under" | "row";
}
