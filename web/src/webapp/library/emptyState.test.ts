// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { driveProvider, localProvider } from "../../storage";
import { emptyState } from "./emptyState";

// Ids come from the providers rather than from string literals, so a renamed
// id cannot leave this file passing against an id nothing uses. `emptyState`
// imports the same modules, so this adds nothing to the import graph.
const LOCAL = localProvider.id;
const DRIVE = driveProvider.id;

describe("emptyState", () => {
  it("blames the query whenever there is one", () => {
    expect(emptyState("salt", "all", true, false)).toBe("noMatch");
  });

  // Both can be true at once, and the search is the better explanation: it is
  // the writer's most recent act and the one they can undo. Blaming the store
  // for a mistyped title sends them to reconnect an account that was never
  // the problem.
  it("lets a query outrank the store, even a disconnected one", () => {
    expect(emptyState("salt", DRIVE, false, false)).toBe("noMatch");
    expect(emptyState("salt", LOCAL, false, true)).toBe("noMatch");
  });

  it("treats whitespace as no query at all", () => {
    expect(emptyState("   ", DRIVE, false, false)).toBe("driveDisconnected");
  });

  // Drive selected without a connection is not an empty shelf but one that
  // cannot be seen.
  it("separates a Drive we cannot reach from a Drive with nothing in it", () => {
    expect(emptyState("", DRIVE, false, false)).toBe("driveDisconnected");
    expect(emptyState("", DRIVE, true, false)).toBe("driveEmpty");
  });

  it("names this device when that is what was selected", () => {
    expect(emptyState("", LOCAL, false, false)).toBe("localEmpty");
    expect(emptyState("", LOCAL, true, false)).toBe("localEmpty");
  });

  // A mapped but empty folder and no folder chosen are different answers: one
  // says to point at a folder, the other that this folder holds no projects.
  // They never share a sentence.
  it("says the folder holds nothing when a root is mapped but the scan found no projects", () => {
    expect(emptyState("", LOCAL, false, true)).toBe("localScannedEmpty");
    expect(emptyState("", LOCAL, true, true)).toBe("localScannedEmpty");
  });

  // No query and no place chosen: nothing about a store explains the bare
  // shelf, so the generic panel is the accurate one.
  it('falls back to the generic panel under "all"', () => {
    expect(emptyState("", "all", true, false)).toBe("noMatch");
    expect(emptyState("", "all", false, true)).toBe("noMatch");
  });
});
