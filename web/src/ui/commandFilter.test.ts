// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  filterCommands,
  matchesCommand,
  nextIndex,
  resetIndex,
} from "./commandFilter";

const cmd = (id: string, label: string, group: string) => ({
  id,
  label,
  group,
});

const COMMANDS = [
  cmd("b1", "Once Dark", "Drive"),
  cmd("b2", "Hollow Water", "This device"),
  cmd("b3", "Perché No", "Drive"),
  cmd("new", "Start a project…", "Create"),
  cmd("settings", "Settings", "Go"),
];

describe("matchesCommand", () => {
  it("shows everything before anything is typed", () => {
    expect(matchesCommand(COMMANDS[0], "")).toBe(true);
    expect(matchesCommand(COMMANDS[0], "  ")).toBe(true);
  });

  it("matches the label, whatever the case", () => {
    expect(matchesCommand(COMMANDS[0], "dark")).toBe(true);
    expect(matchesCommand(COMMANDS[0], "DARK")).toBe(true);
  });

  // A group's name finds every command in the group, with no title known.
  it("matches the group", () => {
    expect(filterCommands(COMMANDS, "drive").map((c) => c.id)).toEqual([
      "b1",
      "b3",
    ]);
    expect(filterCommands(COMMANDS, "create").map((c) => c.id)).toEqual([
      "new",
    ]);
  });

  it("folds accents the same way the shelf does", () => {
    expect(matchesCommand(COMMANDS[2], "perche")).toBe(true);
  });

  it("refuses what is not there", () => {
    expect(filterCommands(COMMANDS, "quarry")).toEqual([]);
  });
});

describe("nextIndex", () => {
  it("moves down and up", () => {
    expect(nextIndex(5, 0, 1)).toBe(1);
    expect(nextIndex(5, 3, -1)).toBe(2);
  });

  // Holding Down rests on the last row rather than cycling, so the position
  // is known without watching the highlight.
  it("stops at the ends rather than wrapping", () => {
    expect(nextIndex(5, 4, 1)).toBe(4);
    expect(nextIndex(5, 0, -1)).toBe(0);
  });

  it("has no selection at all in an empty list", () => {
    expect(nextIndex(0, 0, 1)).toBe(-1);
    expect(nextIndex(0, -1, -1)).toBe(-1);
  });

  it("pulls a stale index back inside the list", () => {
    expect(nextIndex(2, 7, 1)).toBe(1);
    expect(nextIndex(2, -4, 1)).toBe(0);
  });

  it("handles a single command", () => {
    expect(nextIndex(1, 0, 1)).toBe(0);
    expect(nextIndex(1, 0, -1)).toBe(0);
  });
});

describe("resetIndex", () => {
  // After another letter the best match is the first row, and the next key is
  // Enter; keeping the old position would run whatever slid into it.
  it("goes back to the top when there is anything to select", () => {
    expect(resetIndex(3)).toBe(0);
  });

  it("selects nothing when nothing matched", () => {
    expect(resetIndex(0)).toBe(-1);
  });
});
