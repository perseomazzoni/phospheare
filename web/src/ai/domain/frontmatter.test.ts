// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  chatKindsField,
  parseFrontmatter,
  readsField,
  scopeKindsField,
} from "./frontmatter";

describe("chatKindsField", () => {
  const read = (value: string) =>
    chatKindsField(
      "x.md",
      parseFrontmatter("x.md", `---\nchats: ${value}\n---\nBody.`),
      "chats",
    );

  it("reads a comma list of chat kinds", () => {
    expect(read("general, drafting,editorial")).toEqual([
      "general",
      "drafting",
      "editorial",
    ]);
  });

  // A misspelt kind cast through would leave the voice or the command in no
  // chat at all: a missing feature, not an error.
  it("refuses a kind the app does not have, naming the file", () => {
    expect(() => read("general, alpha-readr")).toThrow(
      'x.md: unknown chat kind "alpha-readr" in chats',
    );
  });
});

describe("scopeKindsField", () => {
  const read = (value: string) =>
    scopeKindsField(
      "x.md",
      parseFrontmatter("x.md", `---\nscopes: ${value}\n---\nBody.`),
      "scopes",
    );

  it("reads the scopes a command offers", () => {
    expect(read("section, structure")).toEqual(["section", "structure"]);
  });

  // The retired words are not scopes, and a word no run can serve
  // must not parse: it would reach `runReview` with nowhere to go.
  it("refuses a word that is not a built scope", () => {
    expect(() => read("section, full")).toThrow(
      'x.md: unknown scope "full" in scopes',
    );
  });
});

describe("readsField", () => {
  const read = (value: string) =>
    readsField(
      "x.md",
      parseFrontmatter("x.md", `---\nreads: ${value}\n---\nBody.`),
      "reads",
    );

  it("reads whole groups and catalogue sections, in order", () => {
    expect(read("characters, world:timeline,notes")).toEqual([
      { group: "characters" },
      { group: "world", sectionId: "timeline" },
      { group: "notes" },
    ]);
  });

  it("refuses a group it does not read, summaries above all", () => {
    // A summary is the model's own output: checking prose against it would
    // check the model against itself.
    expect(() => read("summaries")).toThrow(
      'x.md: unknown reference group "summaries" in reads',
    );
    expect(() => read("charaters")).toThrow(
      'x.md: unknown reference group "charaters" in reads',
    );
  });

  it("narrows an entry to some roles of its records, and refuses a role it does not know", () => {
    expect(
      read("characters(rule), guidebook:prose-style(rule brief), notes"),
    ).toEqual([
      { group: "characters", roles: ["rule"] },
      {
        group: "guidebook",
        sectionId: "prose-style",
        roles: ["rule", "brief"],
      },
      { group: "notes" },
    ]);
    for (const bad of ["characters()", "characters(voice)"])
      expect(() => read(bad)).toThrow(`x.md: "${bad}" names no known roles`);
    for (const bad of ["characters(rule", "a(b)c"])
      expect(() => read(bad)).toThrow(
        `x.md: "${bad}" is not group[:section][(roles)]`,
      );
  });

  it("names a section only where the group has a catalogue", () => {
    for (const bad of ["characters:marta", "world:Time Line", "world:a:b"])
      expect(() => read(bad)).toThrow(
        `x.md: "${bad}" names no section in reads`,
      );
  });
});

describe("parseFrontmatter", () => {
  // A key written twice must not keep the second value in silence, where a
  // catalogue field declared twice would lose its first role unseen.
  it("refuses a key written twice, naming the file and the key", () => {
    expect(() =>
      parseFrontmatter(
        "x.md",
        "---\nchats: general\nchats: drafting\n---\nBody.",
      ),
    ).toThrow('x.md: duplicate key "chats"');
  });
});
