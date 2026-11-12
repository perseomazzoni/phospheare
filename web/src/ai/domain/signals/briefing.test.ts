// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { OBSESSIONS, obsessionById } from "../obsessions";
import { briefingOf, signalGroups } from "./briefing";

// What a turn is handed from the pre-pass: the persona's own
// detectors, over the writer's prose, labelled as candidates for judgement.

/** What a turn is handed: the groups found, framed as candidates. */
const briefingFor = (...args: Parameters<typeof signalGroups>) =>
  briefingOf(signalGroups(...args));

const filter = obsessionById(OBSESSIONS, "E.filter");
const withDetector = OBSESSIONS.obsessions.filter((one) => one.detector);
const hedge = withDetector.find((one) => one.detector === "hedges");

describe("the pre-pass briefing", () => {
  it("frames its candidates as candidates, with their exceptions", () => {
    const said = briefingFor(
      ["She saw the lights go out. She heard the door."],
      "en",
      [filter],
    );
    expect(said).toMatch(/^CANDIDATES FROM A MECHANICAL PRE-PASS/);
    expect(said).toContain("None of these is a finding");
    expect(said).toContain(`E.filter — ${filter.notices}`);
    expect(said).toContain("A choice, not a fault, when:");
    expect(said).toContain('- "She saw the lights go out."');
  });

  it("runs only the detectors of the obsessions it is given", () => {
    // Hedges in the prose, and an editor who does not look for them.
    expect(hedge).toBeDefined();
    expect(briefingFor(["It was almost dark."], "en", [filter])).toBe("");
    expect(
      briefingFor(["It was almost dark."], "en", [
        filter,
        hedge as (typeof withDetector)[number],
      ]),
    ).toContain('"It was almost dark."');
  });

  it("says how many it found when it shows only the densest", () => {
    const prose = Array.from(
      { length: 12 },
      (_, n) => `She saw the ${n} lights.`,
    ).join(" ");
    expect(briefingFor([prose], "en", [filter])).toMatch(
      /found 12 in all; the densest \d+ shown/,
    );
  });

  it("is silent for an unknown language, no detectors, or nothing found", () => {
    const prose = ["She saw the lights go out."];
    expect(briefingFor(prose, "fr", [filter])).toBe("");
    expect(briefingFor(prose, undefined, [filter])).toBe("");
    expect(
      briefingFor(
        prose,
        "en",
        OBSESSIONS.obsessions.filter((one) => !one.detector).slice(0, 3),
      ),
    ).toBe("");
    expect(briefingFor(["The lights went out."], "en", [filter])).toBe("");
    expect(briefingFor(["  "], "en", [filter])).toBe("");
  });
});
