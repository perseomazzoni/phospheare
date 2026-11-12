// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { FRAME_GEOMETRY, dockRoom } from "./geometry";

describe("the frame's geometry", () => {
  it("is the editor's one layout, under every theme", () => {
    expect(FRAME_GEOMETRY).toEqual({
      panelLeft: 8,
      panelGutter: 40,
      railGutter: 40,
      measure: 680,
      surfaceRight: 40,
      panelW: 248,
      railPanelW: 52,
      dockW: 340,
      dockInset: 8,
      narrowAt: 1016,
      findExcerpt: { width: 60, before: 30 },
      notes: { gap: 28, column: 180, inset: 14 },
      sheet: { gap: 8, barSeat: 0, cutSeat: 10, bar: 46 },
    });
  });

  it("stands the sheet on the panel's own inset", () => {
    expect(FRAME_GEOMETRY.sheet.gap).toBe(FRAME_GEOMETRY.panelLeft);
  });

  it("fits the Dock beside the whole measure", () => {
    // 1536 wide, the 248 panel open: 1536 − (8 + 248 + 40) − 680 − 40.
    expect(dockRoom(FRAME_GEOMETRY, 1536, 248, false).fit).toBe(520);
  });
});
