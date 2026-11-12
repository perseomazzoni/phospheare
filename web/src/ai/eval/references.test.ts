// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { modelText, withoutAsides } from "../../editor/assistant/sourceText";
import {
  guidanceOf,
  LEDGER_CHUNK_CHARACTERS,
  referenceLedgerText,
} from "../application/ledger";
import { validateFinding } from "../application/validateEvidence";
import { pageOf } from "../domain/referenceCatalogue";
import {
  extractionChunks,
  recordExtraction,
} from "../domain/referenceExtraction";
import { parseReference } from "../domain/referenceRecords";
import { selectRecords } from "../domain/referenceRender";
import { rulePassages, rulesOf } from "../domain/rules";
import { fold } from "../domain/textMatch";
import type { Finding, SourceDescriptor } from "../domain/types";
import type { Expectation } from "./score";

// The reference fixture book: one small book per language whose
// references are the app's own templates, filled as a writer fills them. It
// holds two character sheets (Tomas's with its Appearance field renamed
// "Eyes"), Ilse's arc, the world's rules, a timeline, the continuity page,
// and a free note.
//
// Five Sections hold each case the reference catalogue must get right, and
// `expect.json` names them: a claim kept apart from the fact (she says she is
// thirty), a qualification deep in a long answer (her mother may have
// drowned), a plan for a Section not written, a rule broken where no two
// facts pair, the rule's exception kept, a belief kept a belief, a limp the
// continuity page explains, and the same words under two fields. Three are
// knowledge acted on too early, which only the knowledge check raises:
// a character's secret, a myth's truth known before it is found,
// and a system the narration explains before the reader is meant to learn it.
// Two the check is known not to find: a renamed field and a note,
// which are context only by policy.
//
// `scripts/fact-eval.mjs --corpus references` measures what a model makes of
// it. This file pins what code alone guarantees, whatever the model says:
// what may be read for facts, and as what; where a quote's field is; which
// rules are asked and with which exceptions; which names reach a person's
// guidance.

const FILES = import.meta.glob("./references/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const EXPECT = import.meta.glob("./references/*/expect.json", {
  eager: true,
  import: "default",
}) as Record<string, Expectation[]>;

/** The source a file is, as `scripts/eval-common.mjs` catalogues it. */
function sourceOf(name: string, text: string): SourceDescriptor {
  const bare = name.replace(/^[a-z]+--/u, "").replace(/\.md$/u, "");
  const shelf = /^(guidebook|world)--/u.exec(name)?.[1];
  const group = shelf
    ? shelf
    : name.startsWith("character--")
      ? "characters"
      : name.startsWith("arc--")
        ? "arcs"
        : name.startsWith("notes--")
          ? "notes"
          : undefined;
  if (!group)
    return {
      id: `node:${name}`,
      kind: "manuscript",
      authority: "manuscript",
      nodeKind: "section",
      title: bare,
      path: name,
    };
  return {
    id: `reference:${name}`,
    kind: group === "notes" ? "note" : "reference",
    authority: "reference",
    title: shelf ? (/^#\s+(.+)$/mu.exec(text)?.[1].trim() ?? bare) : bare,
    path: name,
    group,
    ...(shelf ? { sectionId: bare } : {}),
  };
}

/** One book, each file read as the project adapter reads it. */
function book(language: string) {
  const prefix = `./references/${language}/`;
  return Object.entries(FILES)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, raw]) => {
      const name = path.slice(prefix.length);
      const source = sourceOf(name, raw);
      return {
        name,
        source,
        raw,
        text: modelText(source.kind, withoutAsides(raw)),
        revision: `r-${name}`,
      };
    });
}

const parsedOf = (file: ReturnType<typeof book>[number]) =>
  parseReference(file.text, pageOf(file.source), file.source.title);

for (const language of ["en", "it"]) {
  const files = book(language);
  const file = (start: string) => {
    const found = files.find((one) => one.name.startsWith(start));
    if (!found) throw new Error(`no ${start} in ${language}`);
    return found;
  };

  describe(`the reference fixture book (${language})`, () => {
    it("states every disagreement it expects, on both sides, in the files it names", () => {
      const expectations = EXPECT[`./references/${language}/expect.json`];
      expect(expectations.map((one) => one.id)).toEqual([
        "age-claim",
        "age-slip",
        "scar",
        "mother",
        "night-rule",
        "night-exception",
        "flood-belief",
        "flood-year",
        "limp",
        "tom-eyes",
        "ferry-colour",
        "tom-knows",
        "lantern-knows",
        "bell-reveal",
      ]);
      for (const expectation of expectations)
        for (const side of expectation.sides)
          expect(
            side.sources.some((sourceId) =>
              side.words.some((word) =>
                fold(
                  files.find((one) => one.source.id === sourceId)?.text ?? "",
                ).includes(fold(word)),
              ),
            ),
            `${expectation.id}: ${side.words.join(", ")}`,
          ).toBe(true);
    });

    it("reads each page as far as its labels are the catalogue's, and no further", () => {
      const levels = Object.fromEntries(
        files
          .filter((one) => one.source.kind !== "manuscript")
          .map((one) => [one.name, parsedOf(one).interpretation]),
      );
      expect(levels).toEqual({
        "arc--ilse.md": "full",
        "character--ilse.md": "full",
        // "Eyes" is no label of the sheet: the rest is read.
        "character--tomas.md": "partial",
        "guidebook--continuity.md": "full",
        [file("notes--").name]: "raw",
        "world--myths.md": "full",
        "world--rules.md": "full",
        "world--systems.md": "full",
        "world--timeline.md": "full",
      });
    });

    it("shows the fact reader no inner life, open question or rule, and every plan as planned", () => {
      // What the fact reader is shown of a page, as the ledger chunks it.
      const view = (start: string) => {
        const parsed = referenceLedgerText(file(start))?.parsed;
        return parsed
          ? extractionChunks(parsed, LEDGER_CHUNK_CHARACTERS)
              .map((chunk) => chunk.text)
              .join("\n")
          : "";
      };
      const answer = (start: string, field: string) =>
        parsedOf(file(start)).records.find((one) => one.field?.id === field)
          ?.lines[0].text ?? "";
      const ilse = view("character--ilse");
      expect(ilse).toContain(answer("character--ilse", "age"));
      // Fears are inner life: never a fact.
      expect(answer("character--ilse", "fears")).not.toBe("");
      expect(ilse).not.toContain(answer("character--ilse", "fears"));
      // An open question and every rule stay out of the fact reader's view.
      expect(answer("guidebook--continuity", "open")).not.toBe("");
      expect(view("guidebook--continuity")).not.toContain(
        answer("guidebook--continuity", "open"),
      );
      expect(view("world--rules")).toBe("");
      // An arc is read, and only as planned.
      const arc = parsedOf(file("arc--ilse"));
      expect(arc.records.length).toBeGreaterThan(0);
      expect(new Set(arc.records.map(recordExtraction))).toEqual(
        new Set(["planned"]),
      );
      // The renamed field and the note are context, never a fact's source.
      const eyes = parsedOf(file("character--tomas")).records.find(
        (one) => one.field === null,
      );
      expect(eyes && recordExtraction(eyes)).toBe("unclassified");
      expect(
        new Set(parsedOf(file("notes--")).records.map(recordExtraction)),
      ).toEqual(new Set(["unclassified"]));
    });

    it("keeps the qualification when a long answer is cut to the part a request is about", () => {
      // The mother's fate is one sentence deep in a long answer: under a room
      // too small for the answer, the part shown is that sentence whole,
      // "may have" / "forse" and all, never the words around a match.
      const ilse = file("character--ilse");
      const formative = parsedOf(ilse).records.find(
        (one) => one.field?.id === "formative",
      );
      if (!formative) throw new Error("no formative answer");
      const term = language === "en" ? "drowned" : "annegata";
      // One character short of the whole answer, so the answer is cut.
      const whole = selectRecords(parsedOf(ilse), [term], Infinity);
      const room = (whole?.text.length ?? 0) - 1;
      const chosen = selectRecords(parsedOf(ilse), [term], room);
      const qualified =
        language === "en"
          ? "Her mother may have drowned"
          : "La madre forse è annegata";
      expect(chosen?.text).toContain(qualified);
      expect((chosen?.text.length ?? 0) <= room).toBe(true);
    });

    it("binds a quote found under two fields to the field its place is in", () => {
      const ilse = file("character--ilse");
      const records = parsedOf(ilse).records;
      const appearance = records.find((one) => one.field?.id === "appearance");
      const details = records.find((one) => one.field?.id === "details");
      if (!appearance || !details) throw new Error("fields missing");
      // The same opening words stand in both answers.
      const words = appearance.lines[0].text.split(",")[0];
      expect(details.lines[0].text.startsWith(words)).toBe(true);
      const captures = new Map([
        [
          ilse.source.id,
          {
            text: ilse.text,
            revision: ilse.revision,
            origin: "project-file" as const,
          },
        ],
      ]);
      const kinds = new Map([[ilse.source.id, ilse.source]]);
      const bound = (at: number) => {
        const finding: Finding = {
          id: "f",
          severity: "major",
          title: "t",
          explanation: "e",
          status: "open",
          evidence: [
            {
              sourceId: ilse.source.id,
              revision: ilse.revision,
              quote: words,
              prefix: ilse.text.slice(Math.max(0, at - 32), at),
              suffix: ilse.text.slice(
                at + words.length,
                at + words.length + 32,
              ),
            },
          ],
        };
        return validateFinding(finding, captures, kinds).finding.evidence[0]
          ?.field;
      };
      expect(bound(appearance.lines[0].start)).toBe("character/appearance");
      expect(bound(details.lines[0].start)).toBe("character/details");
    });

    it("asks the impossible with its exception, over both night crossings", () => {
      const rules = file("world--rules");
      const rule = rulesOf([
        {
          sourceId: rules.source.id,
          title: rules.source.title,
          revision: rules.revision,
          text: rules.text,
          parsed: parsedOf(rules),
        },
      ]).find((one) => one.record.field?.id === "impossible");
      expect(rule?.exceptions.map((one) => one.record.field?.id)).toEqual([
        "costs",
      ]);
      const sections = files
        .filter((one) => one.source.kind === "manuscript")
        .map((one) => ({
          sourceId: one.source.id,
          title: one.source.title,
          revision: one.revision,
          text: one.text,
        }));
      const { passages, coverage } = rulePassages(
        rule as NonNullable<typeof rule>,
        sections,
      );
      expect(coverage).toBe("checked");
      expect(new Set(passages.map((one) => one.sourceId))).toEqual(
        new Set([
          files.find((one) => one.name.startsWith("section--02"))?.source.id,
          files.find((one) => one.name.startsWith("section--03"))?.source.id,
        ]),
      );
    });

    it("asks Ilse's secret as a note on who knows what, over the Section where Tom knows too early", () => {
      // Section 3 has Tom know what the sheet says he learns only in
      // section 5: no two places state a fact two ways, so only the
      // knowledge check can raise it.
      const ilse = file("character--ilse");
      const notes = rulesOf(
        [
          {
            sourceId: ilse.source.id,
            title: ilse.source.title,
            revision: ilse.revision,
            text: ilse.text,
            parsed: parsedOf(ilse),
          },
        ],
        "knowing",
      );
      expect(notes.map((one) => one.record.field?.id)).toEqual(["secrets"]);
      const sections = files
        .filter((one) => one.source.kind === "manuscript")
        .map((one) => ({
          sourceId: one.source.id,
          title: one.source.title,
          revision: one.revision,
          text: one.text,
        }));
      const { passages } = rulePassages(notes[0], sections);
      expect(passages.map((one) => one.sourceId)).toContain(
        files.find((one) => one.name.startsWith("section--03"))?.source.id,
      );
    });

    it("asks a myth's truth and a system's reveal as notes on who knows what, over the Sections that leak them", () => {
      const sections = files
        .filter((one) => one.source.kind === "manuscript")
        .map((one) => ({
          sourceId: one.source.id,
          title: one.source.title,
          revision: one.revision,
          text: one.text,
        }));
      for (const [page, field, leak] of [
        ["world--myths", "belief-truth", "section--04"],
        ["world--systems", "system.reader", "section--02"],
      ] as const) {
        const document = file(page);
        const notes = rulesOf(
          [
            {
              sourceId: document.source.id,
              title: document.source.title,
              revision: document.revision,
              text: document.text,
              parsed: parsedOf(document),
            },
          ],
          "knowing",
        );
        expect(notes.map((one) => one.record.field?.id)).toEqual([field]);
        const { passages } = rulePassages(notes[0], sections);
        expect(passages.map((one) => one.sourceId)).toContain(
          files.find((one) => one.name.startsWith(leak))?.source.id,
        );
      }
    });

    it("gives the judge the continuity page's word on the limp for every question, and Ilse's secret by her names", () => {
      const guidance = guidanceOf(
        files.filter((one) => one.source.kind === "reference"),
      );
      const continuity = guidance.find((one) =>
        one.sourceId.includes("guidebook--continuity"),
      );
      expect(continuity?.entity).toBeUndefined();
      expect(continuity?.text).toContain(
        parsedOf(file("guidebook--continuity")).records.find(
          (one) => one.field?.id === "relationships",
        )?.lines[0].text,
      );
      const ilse = guidance.find((one) =>
        one.sourceId.includes("character--ilse"),
      );
      expect(ilse).toMatchObject({ entity: "ilse", aliases: ["Ilse Varga"] });
      // Tomas's sheet holds nothing the judge reads as his but the field the
      // writer renamed, shown as context and reached by his nickname.
      const tomas = guidance.filter((one) =>
        one.sourceId.includes("character--tomas"),
      );
      expect(tomas).toHaveLength(1);
      expect(tomas[0]).toMatchObject({
        entity: "tomas",
        aliases: ["Tomas Varga", "Tom"],
      });
      expect(tomas[0].text.startsWith("OTHER NOTES")).toBe(true);
    });
  });
}
