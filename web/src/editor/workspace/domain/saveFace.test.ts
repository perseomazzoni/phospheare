// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { afterEdit, afterSettle, faceState, type HeldSave } from "./saveFace";

const HELD: HeldSave[] = ["clean", "dirty", "saving", "saved", "failed"];

describe("the held save state after an edit", () => {
  it("turns dirty on a change, unless a write is in flight", () => {
    expect(HELD.map((now) => afterEdit(now, true))).toEqual([
      "dirty",
      "dirty",
      "saving",
      "dirty",
      "dirty",
    ]);
  });

  it("turns clean when the buffer matches the file, keeping the confirmations", () => {
    expect(HELD.map((now) => afterEdit(now, false))).toEqual([
      "clean",
      "clean",
      "saving",
      "saved",
      "clean",
    ]);
  });

  it("lets only the tick settle", () => {
    expect(HELD.map(afterSettle)).toEqual([
      "clean",
      "dirty",
      "saving",
      "clean",
      "failed",
    ]);
  });
});

describe("the chip's state", () => {
  const facts = { open: true, inDiff: false, held: "saved" as const };

  it("is absent with no Section open, whatever is held", () => {
    expect(
      faceState({ ...facts, open: false, inDiff: true, queued: true }),
    ).toBe("absent");
  });

  it("says comparing while a comparison is up", () => {
    expect(faceState({ ...facts, inDiff: true, queued: false })).toBe(
      "comparing",
    );
  });

  it("says cached for a landed write the remote still waits for", () => {
    expect(faceState({ ...facts, queued: true })).toBe("cached");
    expect(faceState({ ...facts, queued: false })).toBe("saved");
  });

  it("never calls a write that did not land cached", () => {
    for (const held of ["dirty", "failed", "saving", "clean"] as const)
      expect(faceState({ ...facts, held, queued: true })).toBe(held);
  });
});
