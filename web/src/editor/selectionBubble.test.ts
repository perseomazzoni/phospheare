// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { placeBubble, type Rect } from "./selectionBubble";
import { MARGIN } from "../ui/overlay/onScreen";

// The box is clamped and the tail is not: a bubble pulled back from the
// window's edge points at its words only if the tail moves the other way by
// the same amount. Every test here pins that, or the flip.

const HOST: Rect = {
  left: 0,
  top: 0,
  right: 1280,
  bottom: 860,
  width: 1280,
  height: 860,
};
const BOX = { width: 300, height: 40 };

const at = (left: number, top: number, width = 120, height = 20): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe("placeBubble", () => {
  it("centres on the selection and sits above it", () => {
    const p = placeBubble(at(500, 400), HOST, BOX);
    // Selection centre is 560; the box is 300 wide, so its left edge is 410.
    expect(p.left).toBe(410);
    expect(p.top).toBe(400 - 40 - 9);
    expect(p.below).toBe(false);
    // And the tail points back at the centre.
    expect(p.left + p.tail).toBe(560);
  });

  it("pulls back from the left edge without losing the selection", () => {
    const p = placeBubble(at(4, 400), HOST, BOX);
    expect(p.left).toBe(MARGIN);
    // The tail follows the words rather than the box.
    expect(p.left + p.tail).toBe(64);
  });

  it("pulls back from the right edge the same way", () => {
    const p = placeBubble(at(1220, 400), HOST, BOX);
    expect(p.left).toBe(1280 - 300 - MARGIN);
    // The tail stops short of the bubble's end rather than leave it.
    expect(p.tail).toBe(300 - 12);
  });

  // A bubble tucked under the titlebar is a bubble the writer cannot click.
  it("flips below when above would be behind the chrome", () => {
    const p = placeBubble(at(500, 60), HOST, BOX);
    expect(p.below).toBe(true);
    expect(p.top).toBe(80 + 9);
  });

  it("stays above the moment there is room for it", () => {
    // 95 - 40 - 9 = 46, the clearance itself.
    const p = placeBubble(at(500, 95), HOST, BOX);
    expect(p.below).toBe(false);
    expect(p.top).toBe(46);
  });

  // The host is not the window: the editor's shell has its own origin, and a
  // bubble placed in window coordinates inside it would be off by that much.
  it("answers in the host’s coordinate space", () => {
    const host: Rect = {
      left: 100,
      top: 50,
      right: 1380,
      bottom: 910,
      width: 1280,
      height: 860,
    };
    const p = placeBubble(at(600, 450), host, BOX);
    expect(p.left).toBe(410);
    expect(p.top).toBe(450 - 50 - 40 - 9);
  });

  // A whole-line selection is the ordinary case for "make this a heading", and
  // its centre is the middle of the line rather than either end.
  it("stays on the page, clear of the panel, and still points at its words", () => {
    // The page runs 264..1040: a selection at its left edge would hang the
    // bubble over the panel.
    const page = { left: 264, right: 1040 };
    const p = placeBubble(at(270, 400), HOST, BOX, page);
    expect(p.left).toBe(264);
    expect(p.left + p.tail).toBe(330);
    // A page narrower than the bubble leaves it to the window.
    const narrow = placeBubble(at(270, 400), HOST, BOX, {
      left: 264,
      right: 500,
    });
    expect(narrow.left).toBe(180);
  });

  it("centres on a selection wider than itself", () => {
    const p = placeBubble(at(0, 400, 1280), HOST, BOX);
    expect(p.left).toBe(490);
    expect(p.left + p.tail).toBe(640);
  });
});
