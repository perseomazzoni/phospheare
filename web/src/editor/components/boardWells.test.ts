// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";

import { wellsOf } from "./boardWells";

// The board is grouped and its arrangement is fixed, so these rows pin the
// order, against the editor's real 24 commands rather than invented ones.

const cmd = (id: string, label: string, group: string) => ({
  id,
  label,
  group,
});

/** The editor's real board, in the order `useEditorCommands` writes it. */
const editorCommands = [
  cmd("bold", "Bold", "Formatting"),
  cmd("italic", "Italic", "Formatting"),
  cmd("mono", "Monospace", "Formatting"),
  cmd("normal", "Normal text", "Formatting"),
  cmd("case", "Change case", "Formatting"),
  cmd("h1", "Title (H1)", "Blocks"),
  cmd("h2", "Subtitle (H2)", "Blocks"),
  cmd("body", "Body", "Blocks"),
  cmd("break", "Page break", "Blocks"),
  cmd("left", "Align left", "Alignment"),
  cmd("centre", "Align center", "Alignment"),
  cmd("right", "Align right", "Alignment"),
  cmd("justify", "Justify", "Alignment"),
  cmd("undo", "Undo", "Editing"),
  cmd("redo", "Redo", "Editing"),
  cmd("chars", "Special characters", "Editing"),
  cmd("find", "Search", "The file"),
  cmd("save", "Save", "The file"),
  cmd("shortcuts", "Keyboard shortcuts", "The file"),
  cmd("ask", "Enlighten!", "Places"),
  cmd("reference", "Reference", "Places"),
  cmd("notes", "Notes", "Places"),
  cmd("snapshots", "Snapshots", "Places"),
  cmd("history", "History", "Places"),
];

describe("wellsOf", () => {
  it("keeps the groups in the order the caller wrote them", () => {
    // Not alphabetical and not by size. The arrangement is the thing the
    // writer learns, so it has to be the one the editor wrote down.
    expect(wellsOf(editorCommands).map((w) => w.name)).toEqual([
      "Formatting",
      "Blocks",
      "Alignment",
      "Editing",
      "The file",
      "Places",
    ]);
  });

  it("puts every command in exactly one well, losing none", () => {
    const wells = wellsOf(editorCommands);
    const ids = wells.flatMap((w) => w.commands.map((c) => c.id));
    expect(ids).toEqual(editorCommands.map((c) => c.id));
  });

  it("collects a group's commands even when they are not adjacent", () => {
    const wells = wellsOf([
      cmd("a", "A", "one"),
      cmd("b", "B", "two"),
      cmd("c", "C", "one"),
    ]);
    expect(wells.map((w) => w.name)).toEqual(["one", "two"]);
    expect(wells[0].commands.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("answers with nothing for nothing", () => {
    expect(wellsOf([])).toEqual([]);
  });
});
