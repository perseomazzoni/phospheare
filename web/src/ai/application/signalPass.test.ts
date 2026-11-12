// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { OBSESSIONS, obsessionById } from "../domain/obsessions";
import { skillsFor } from "../domain/skills";
import { SignalPass } from "./signalPass";

// One run's pre-pass: each text scanned once, the count kept for the turn,
// and a skill picked up mid-answer heard from then on.

const filter = obsessionById(OBSESSIONS, "E.filter");
const hedge = OBSESSIONS.obsessions.find((one) => one.detector === "hedges");

describe("a run's signal pre-pass", () => {
  it("scans the attached prose when it starts, and counts what it found", () => {
    const pass = new SignalPass([filter], "en", [
      { id: "s1", text: "She saw the lights go out. She heard the door." },
    ]);
    expect(pass.attached).toHaveLength(1);
    expect(pass.count).toBe(2);
  });

  it("scans each text a tool reads once, and never the attached prose again", () => {
    const pass = new SignalPass([filter], "en", [
      { id: "s1", text: "She saw the lights go out." },
    ]);
    expect(pass.scan("s1", "She saw the lights go out.")).toEqual([]);
    const read = "He heard the sea. He felt the cold.";
    expect(pass.scan("s2", read)).toHaveLength(1);
    expect(pass.scan("s2", read)).toEqual([]);
    expect(pass.count).toBe(3);
    // The same Section read again with other words is another text.
    expect(pass.scan("s2", "He saw the gulls.")).toHaveLength(1);
    expect(pass.count).toBe(4);
  });

  it("hears a skill picked up mid-answer in what it reads after", () => {
    expect(hedge).toBeDefined();
    const domain = (hedge as NonNullable<typeof hedge>).domain;
    const skill = skillsFor("editorial").find((one) =>
      one.lenses.includes(domain),
    );
    expect(skill).toBeDefined();
    const pass = new SignalPass([filter], "en", []);
    expect(pass.scan("s1", "It was almost dark.")).toEqual([]);
    pass.addSkill(skill as NonNullable<typeof skill>);
    expect(pass.scan("s2", "It was almost dark.")).not.toEqual([]);
  });

  it("finds nothing in a language it has no word lists for", () => {
    const pass = new SignalPass([filter], "fr", [
      { id: "s1", text: "She saw the lights go out." },
    ]);
    expect(pass.attached).toEqual([]);
    expect(pass.scan("s2", "He heard the sea.")).toEqual([]);
    expect(pass.count).toBe(0);
  });
});
