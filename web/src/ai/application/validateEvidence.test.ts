// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { EvidenceAnchor, Finding, SourceText } from "../domain/types";
import {
  anchorOffset,
  anchorState,
  quoteIn,
  validateFinding,
  validateFindings,
} from "./validateEvidence";

// Pins how evidence is held to the text it quotes, and that a reference's
// evidence stands inside one answer, bound to its field.

const capture = (text: string, revision = "r1"): SourceText => ({
  text,
  revision,
  origin: "project-file",
});

const anchor = (over: Partial<EvidenceAnchor> = {}): EvidenceAnchor => ({
  sourceId: "node:S1",
  quote: "the gate",
  ...over,
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "f1",
  severity: "major",
  title: "A claim",
  explanation: "Why it matters.",
  evidence: [anchor()],
  status: "open",
  ...over,
});

describe("evidence validation", () => {
  it("verifies an exact unique quotation", () => {
    expect(anchorState(anchor(), "by the gate at dusk")).toBe("verified");
    expect(anchorState(anchor(), "no such words")).toBe("missing");
    expect(anchorState(anchor({ quote: "" }), "anything")).toBe("missing");
  });

  it("refuses a repeated quotation unless its context resolves it", () => {
    const text = "the gate at dawn, the gate at dusk";
    expect(anchorState(anchor(), text)).toBe("ambiguous");
    expect(
      anchorState(anchor({ prefix: "at dawn, ", suffix: " at dusk" }), text),
    ).toBe("verified");
    expect(anchorState(anchor({ prefix: "at noon, " }), text)).toBe(
      "ambiguous",
    );
  });

  it("says where a verified quotation begins, by the same rule", () => {
    // The Section map places a beat by this offset and its button opens the
    // passage by `anchorState`; one matcher answers both, so a tick can never
    // sit on a passage the button would refuse.
    expect(anchorOffset(anchor(), "by the gate at dusk")).toBe(3);
    expect(anchorOffset(anchor(), "no such words")).toBeNull();
    const text = "the gate at dawn, the gate at dusk";
    expect(anchorOffset(anchor(), text)).toBeNull();
    expect(anchorOffset(anchor({ prefix: "at dawn, " }), text)).toBe(18);
    expect(anchorOffset(anchor({ suffix: " at dawn" }), text)).toBe(0);
  });

  it("forgives the marks a copy may change, and keeps the words exact", () => {
    const text = "sentito quel famoso filo d’oro — disse «piano»";
    const quote = 'filo d\'oro - disse "piano"';
    expect(anchorState(anchor({ quote }), text)).toBe("verified");
    // The offset is the writer's: every fold is one character for one.
    expect(anchorOffset(anchor({ quote }), text)).toBe(text.indexOf("filo"));
    expect(anchorState(anchor({ quote: "filo d'argento" }), text)).toBe(
      "missing",
    );
    expect(anchorState(anchor({ quote: "Filo d'oro" }), text)).toBe("missing");
  });

  it("drops anchors from unknown sources or changed revisions", () => {
    const captures = new Map([["node:S1", capture("by the gate", "r2")]]);
    const changed = validateFinding(
      finding({ evidence: [anchor({ revision: "r1" })] }),
      captures,
    );
    expect(changed.finding.evidence).toEqual([]);
    expect(changed.demoted).toBe(true);

    const unknown = validateFinding(
      finding({ evidence: [anchor({ sourceId: "node:gone" })] }),
      captures,
    );
    expect(unknown.finding.evidence).toEqual([]);
    expect(unknown.droppedAnchors).toBe(1);
  });

  it("demotes a finding that loses all of its evidence", () => {
    const validated = validateFinding(
      finding({ evidence: [anchor({ quote: "invented" })] }),
      new Map([["node:S1", capture("by the gate")]]),
    );
    expect(validated.demoted).toBe(true);
    expect(validated.finding.severity).toBe("observation");
    expect(validated.finding.unverified).toBe("all");
  });

  it("keeps a finding whose remaining anchor verifies, and stamps the revision", () => {
    const validated = validateFinding(
      finding({
        evidence: [
          anchor({ quote: "invented" }),
          anchor({ quote: "the gate" }),
        ],
      }),
      new Map([["node:S1", capture("by the gate", "r9")]]),
    );
    expect(validated.demoted).toBe(false);
    expect(validated.droppedAnchors).toBe(1);
    expect(validated.finding.evidence).toEqual([
      { ...anchor(), revision: "r9" },
    ]);
  });

  it("demotes a comparison that loses one of its sides, and keeps the side that stood", () => {
    const captures = new Map([
      ["node:S1", capture("Marta's eyes are grey.")],
      ["reference:character--marta.md", capture("Marta has green eyes.")],
    ]);
    const comparison = (quote: string) =>
      finding({
        evidence: [
          anchor({ quote: "Marta's eyes are grey." }),
          anchor({ sourceId: "reference:character--marta.md", quote }),
        ],
      });
    // Both sides quoted exactly: a finding, as the model called it.
    const whole = validateFinding(
      comparison("Marta has green eyes."),
      captures,
    );
    expect(whole.demoted).toBe(false);
    expect(whole.finding.severity).toBe("major");
    // The sheet's side invented: half a contradiction is an observation,
    // with the verified side kept so the writer can still look at it.
    const halved = validateFinding(
      comparison("Marta has blue eyes."),
      captures,
    );
    expect(halved.demoted).toBe(true);
    expect(halved.finding.severity).toBe("observation");
    expect(halved.finding.evidence.map((one) => one.sourceId)).toEqual([
      "node:S1",
    ]);
    expect(halved.finding.unverified).toBe("half");
    // Two quotes from one source are not a comparison: losing one is the
    // ordinary partial loss, and the finding keeps its severity.
    const oneSide = validateFinding(
      finding({
        evidence: [anchor({ quote: "Marta's eyes" }), anchor({ quote: "no" })],
      }),
      captures,
    );
    expect(oneSide.demoted).toBe(false);
  });

  it("deduplicates and rejects shapeless findings in a batch", () => {
    const captures = new Map([["node:S1", capture("by the gate")]]);
    const batch = validateFindings(
      [
        finding(),
        finding(),
        finding({ title: "  ", explanation: "" }),
        finding({ title: "Another", evidence: [] }),
      ],
      captures,
    );
    expect(batch.findings.map((one) => one.title)).toEqual([
      "A claim",
      "Another",
    ]);
    expect(batch.rejected).toBe(1);
    expect(batch.demoted).toBe(0);
  });

  it("folds findings that contest the same passage into one", () => {
    const captures = new Map([
      ["node:S1", capture("in the winter of 1911 she was twenty-two")],
      ["reference:sheet", capture("twenty-six in 1911; thirty to strangers")],
    ]);
    const prose = anchor({ quote: "she was twenty-two" });
    const batch = validateFindings(
      [
        finding({
          severity: "minor",
          title: "Ilse's age",
          evidence: [
            prose,
            anchor({ sourceId: "reference:sheet", quote: "twenty-six" }),
          ],
        }),
        finding({
          id: "f2",
          title: "Ilse's age",
          evidence: [
            prose,
            anchor({ sourceId: "reference:sheet", quote: "thirty" }),
          ],
        }),
        finding({
          id: "f3",
          title: "The year",
          explanation: "1911 is late.",
          evidence: [prose],
        }),
      ],
      captures,
    );
    // One finding, naming every place either one disagreed with, at the
    // heavier severity, with the second claim kept in its explanation.
    expect(batch.findings).toHaveLength(1);
    const [one] = batch.findings;
    expect(one.severity).toBe("major");
    expect(one.evidence.map((e) => e.quote)).toEqual([
      "she was twenty-two",
      "twenty-six",
      "thirty",
    ]);
    expect(one.explanation).toBe("Why it matters.\n\nThe year: 1911 is late.");
  });

  it("never folds findings whose passage did not verify", () => {
    const captures = new Map([["node:S1", capture("by the gate")]]);
    const batch = validateFindings(
      [
        finding({ title: "One", evidence: [anchor({ quote: "nowhere" })] }),
        finding({ title: "Two", evidence: [anchor({ quote: "nowhere" })] }),
      ],
      captures,
    );
    expect(batch.findings.map((one) => one.title)).toEqual(["One", "Two"]);
  });
});

describe("quoteIn", () => {
  const excerpt =
    "The tower was  built between 1887 and 1889 as the entrance to the\u200b 1889 World's Fair.";

  it("answers the app's slice of the plain line, not the model's string", () => {
    // Doubled space and a zero-width space in the quote: both sides go
    // through the one `plainLine`, so the stored slice is the normalised
    // text.
    expect(quoteIn(excerpt, "built between\u200b 1887  and 1889")).toBe(
      "built between 1887 and 1889",
    );
    // Across the excerpt's own invisible character.
    expect(quoteIn(excerpt, "entrance to the 1889 World's")).toBe(
      "entrance to the 1889 World's",
    );
  });

  it("finds nothing the excerpt does not hold, and never repairs a quote", () => {
    expect(quoteIn(excerpt, "built between 1887 and 1890")).toBeNull();
    // A curly apostrophe is a different character, not a typo to forgive.
    expect(quoteIn(excerpt, "1889 World’s Fair")).toBeNull();
    expect(quoteIn(excerpt, "BUILT BETWEEN 1887")).toBeNull();
  });

  it("finds an empty or invisible-only quote nowhere, and returns (the empty-needle hang)", () => {
    // `indexOf("", n)` past the end answers the end again, so `occurrences`
    // finds an empty needle nowhere rather than looping.
    expect(quoteIn(excerpt, "")).toBeNull();
    expect(quoteIn(excerpt, "   ")).toBeNull();
    expect(quoteIn(excerpt, "\u200b\u2060\ufeff")).toBeNull();
    expect(quoteIn("", "")).toBeNull();
  });

  it("keeps an empty anchor missing, never a hang", () => {
    expect(anchorState(anchor({ quote: "" }), "text")).toBe("missing");
  });
});

describe("a reference's evidence, bound to its field", () => {
  const SHEET_ID = "reference:characters--marta.md";
  const kinds = new Map([
    [
      SHEET_ID,
      { kind: "reference" as const, group: "characters", title: "Marta" },
    ],
    ["node:S1", { kind: "manuscript" as const, title: "One" }],
  ]);
  const TEXT = [
    "- **Appearance:** grey, like her father",
    "- **Details to remember:** grey, like her father",
    "- **Fears:** the sea",
  ].join("\n");
  const sheet = (over: Partial<EvidenceAnchor>) =>
    anchor({ sourceId: SHEET_ID, ...over });
  const validate = (anchors: EvidenceAnchor[]) =>
    validateFinding(
      finding({ evidence: anchors }),
      new Map([
        [SHEET_ID, capture(TEXT)],
        ["node:S1", capture("by the gate at dusk")],
      ]),
      kinds,
    ).finding.evidence;

  it("names the field the quote was found in, told apart by its place when the words repeat", () => {
    expect(
      validate([
        sheet({ quote: "grey, like her father", suffix: "\n- **Details" }),
        sheet({ quote: "grey, like her father", prefix: "remember:** " }),
        sheet({ quote: "the sea" }),
      ]).map((one) => one.field),
    ).toEqual(["character/appearance", "character/details", "character/fears"]);
  });

  it("drops a label, or a run across two answers, and never keeps a field the model claimed", () => {
    expect(
      validate([
        sheet({ quote: "Fears:" }),
        sheet({ quote: "father\n- **Fears:** the sea" }),
      ]),
    ).toEqual([]);
    expect(
      validate([sheet({ quote: "the sea", field: "character/age" })]),
    ).toMatchObject([{ field: "character/fears" }]);
    // The prose is checked as text, and carries no field.
    expect(validate([anchor({ field: "character/age" })])).toEqual([
      { sourceId: "node:S1", quote: "the gate", revision: "r1" },
    ]);
  });

  it("checks text alone when it is not told what a source is", () => {
    expect(
      validateFinding(
        finding({ evidence: [sheet({ quote: "Fears:" })] }),
        new Map([[SHEET_ID, capture(TEXT)]]),
      ).finding.evidence,
    ).toHaveLength(1);
  });
});
