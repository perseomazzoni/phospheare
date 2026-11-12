// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { isUnwritten } from "../../ai/domain/rooms";
import { stripAsides } from "../../project/asides";
import { stripUnansweredQuestions } from "../../project/referenceAnswers";
import { ledgerTextOf } from "../../ai/application/ledger";

// Pins that an untouched template is not the writer's. Every shipped
// template, cleaned the way the port cleans a reference read (notes and
// unanswered questions gone), reads as unwritten in both languages. A
// scaffold that counts as authored spends the budget, silences the room's
// "you have not written this yet" and hands the model template guidance as
// the writer's material. Guidance therefore lives in a hint, never in a
// blockquote, which neither strip removes.

const raw = import.meta.glob<string>(
  "../reference/md-templates/{en,it}/**/*.md",
  { eager: true, query: "?raw", import: "default" },
);

const cleaned = (text: string) => stripUnansweredQuestions(stripAsides(text));

describe("the shipped reference templates, untouched", () => {
  it("are all unwritten once cleaned, in both languages", () => {
    const entries = Object.entries(raw);
    expect(entries.length).toBeGreaterThan(20);
    const written = entries
      .filter(([, text]) => !isUnwritten(cleaned(text)))
      .map(([path]) => path.split("md-templates/")[1]);
    expect(written).toEqual([]);
  });

  it("never enter the fact ledger as a sheet", () => {
    const arc =
      Object.entries(raw).find(([path]) => path.endsWith("/en/arc.md"))?.[1] ??
      "";
    expect(arc).not.toBe("");
    const source = {
      id: "reference:arc--Marta.md",
      kind: "reference" as const,
      group: "arcs",
      title: "Marta",
      path: "reference/arc--Marta.md",
      authority: "reference" as const,
    };
    expect(
      ledgerTextOf(source, { text: cleaned(arc), revision: "r1" }),
    ).toBeNull();
  });

  it("still count a writer's own answer as written", () => {
    const rules =
      Object.entries(raw).find(([path]) =>
        path.endsWith("/en/world/rules.md"),
      )?.[1] ?? "";
    const answered = rules.replace(
      "- **What is possible:**",
      "- **What is possible:**\n  - Magic costs a memory each time.",
    );
    expect(isUnwritten(cleaned(answered))).toBe(false);
  });
});
