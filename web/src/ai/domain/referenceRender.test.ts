// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { CATALOGUE } from "./referenceCatalogue";
import { parseReference, withRoles } from "./referenceRecords";
import {
  guidanceItems,
  mentions,
  pageLine,
  renderForChat,
  selectRecords,
  usageClause,
} from "./referenceRender";

// A reference document as a model is shown it.

const page = (id: string) => {
  const found = CATALOGUE.get(id);
  if (!found) throw new Error(id);
  return found;
};

describe("renderForChat", () => {
  it("shows every record under its role's heading, with the page it is", () => {
    const parsed = parseReference(
      [
        "# Marta",
        "- **Fears:** the sea",
        "- **Age and date of birth:** possibly 34",
        "- **Secrets and unacknowledged truths:** she failed once",
        "- **Looks:** grey",
      ].join("\n"),
      page("character"),
      "Marta",
    );
    expect(renderForChat(parsed)).toBe(
      [
        "[Character sheet: some of the writer's text is outside the page's fields, shown under OTHER NOTES]",
        "ESTABLISHED",
        "- Age and date of birth: possibly 34",
        "",
        "WHO KNOWS WHAT",
        "- Secrets and unacknowledged truths: she failed once",
        "",
        "INNER LIFE",
        "- Fears: the sea",
        "",
        "OTHER NOTES",
        "- Looks: grey",
      ].join("\n"),
    );
  });

  it("names a block's records by their instance, and says how a page was read", () => {
    const parsed = parseReference(
      "## The Harbour\n- **Visitors and access:** only by boat\n",
      page("world:locations"),
    );
    expect(renderForChat(parsed)).toContain(
      "- The Harbour — Visitors and access: only by boat",
    );
    expect(pageLine(parseReference("Loose words.\n", null))).toBe(
      "[the writer's own notes, outside any page]",
    );
    expect(pageLine(parseReference("Loose words.\n", page("arc")))).toContain(
      "no answer matched the page's fields",
    );
    expect(renderForChat(parseReference("", page("arc")))).toBe("");
  });
});

describe("a reference narrowed to some roles", () => {
  it("shows only those records, and says so on its page line", () => {
    const parsed = withRoles(
      parseReference(
        [
          "- **Voice and way of speaking:** short sentences",
          "- **Fears:** the sea",
        ].join("\n"),
        page("character"),
        "Marta",
      ),
      new Set(["rule"]),
    );
    expect(renderForChat(parsed)).toBe(
      [
        "[Character sheet: every answer read by its field; shown here: only MUST HOLD]",
        "MUST HOLD",
        "- Voice and way of speaking: short sentences",
      ].join("\n"),
    );
    // What the parser could not place is kept, and then named: a sheet in
    // the writer's own words has nothing else.
    const free = withRoles(
      parseReference("She talks in short bursts.", page("character"), "Marta"),
      new Set(["rule"]),
    );
    expect(renderForChat(free)).toContain(
      "shown here: only MUST HOLD, OTHER NOTES]",
    );
    expect(renderForChat(free)).toContain("She talks in short bursts.");
    // Null keeps every record, and says nothing of a narrowing.
    const whole = withRoles(parsed, null);
    expect(whole).toBe(parsed);
  });

  it("explains only the headings the narrowed records can carry", () => {
    const narrowed = usageClause(
      [page("character")],
      false,
      Infinity,
      new Set(["rule"]),
    );
    expect(narrowed).toContain("- MUST HOLD:");
    expect(narrowed).not.toContain("- ESTABLISHED:");
    expect(usageClause([page("character")], false)).toContain("- ESTABLISHED:");
  });
});

describe("selectRecords", () => {
  const long = (fact: string) =>
    [
      `- **Formative experiences:** ${"She grew up by the river. ".repeat(80)}Unconfirmed. ${fact} Or so she says. ${"The mill closed. ".repeat(80)}`,
      "- **Age and date of birth:** 34",
      "- **Fears:** the harbour at night",
    ].join("\n");

  it("keeps the records that mention the request, whole, under their headings", () => {
    const parsed = parseReference(long("x"), page("character"), "Marta");
    const chosen = selectRecords(parsed, ["harbour"], 3_000);
    expect(chosen?.shown).toBe(1);
    expect(chosen?.of).toBe(3);
    expect(chosen?.text).toContain("INNER LIFE\n- Fears: the harbour at night");
    expect(chosen?.text).not.toContain("Age and date of birth");
  });

  it("shows a long answer as its sentences that mention the request, and the qualification beside them", () => {
    const parsed = parseReference(
      long("She was born at the harbour in 1989."),
      page("character"),
      "Marta",
    );
    const chosen = selectRecords(parsed, ["harbour"], 3_000);
    expect(chosen?.text).toContain(
      "- Formative experiences: [part of this answer] Unconfirmed. She was born at the harbour in 1989. Or so she says.",
    );
    // The whole record would not fit; the other matching one does.
    expect(chosen?.text).toContain("- Fears: the harbour at night");
    expect(chosen?.text).not.toContain("The mill closed. The mill closed.");
    expect(chosen?.text.length).toBeLessThanOrEqual(3_000);
  });

  it("finds nothing when nothing mentions the request, or nothing fits", () => {
    const parsed = parseReference(long("x"), page("character"), "Marta");
    expect(selectRecords(parsed, ["lighthouse"], 3_000)).toBeNull();
    expect(selectRecords(parsed, [], 3_000)).toBeNull();
    expect(selectRecords(parsed, ["harbour"], 20)).toBeNull();
  });

  it("matches a block by its instance's name", () => {
    const parsed = parseReference(
      "## The Harbour\n- **Visitors and access:** only by boat\n## The Mill\n- **Visitors and access:** by road\n",
      page("world:locations"),
    );
    const chosen = selectRecords(parsed, ["Harbour"], 3_000);
    expect(chosen?.text).toContain(
      "The Harbour — Visitors and access: only by boat",
    );
    expect(chosen?.text).not.toContain("by road");
  });
});

describe("selectRecords on a request that names the sheet's person", () => {
  // "How old is Ilse?" has no word of five letters that a record holds:
  // `relevanceTerms` keeps "according", "character", "sheet", and the name
  // is four letters. The sheet is about Ilse, and the request says so.
  const SHEET =
    "- **Names and nicknames:**\n  - Ilse Varga; Isa\n- **Age and date of birth:**\n  - Twenty-six in 1911.\n- **Formative experiences:**\n  - She grew up on the water. Her mother may have drowned in 1899. She keeps the comb.\n- **Details to remember:**\n  - A scar on the left hand.\n";
  const parsed = parseReference(SHEET, page("character"), "Ilse");

  it("selects the sheet's records when the request names its person, by title or by any name the sheet records", () => {
    for (const request of [
      "How old is Ilse, according to her sheet?",
      "How old is Isa?",
    ]) {
      const chosen = selectRecords(
        parsed,
        ["according", "sheet"],
        3_000,
        request,
      );
      expect(chosen?.text).toContain("Twenty-six in 1911.");
    }
    expect(
      selectRecords(parsed, ["according", "sheet"], 3_000, "How old is Marta?"),
    ).toBeNull();
  });

  it("ranks the records the request's own words match before those its name alone reaches", () => {
    // Room for the matching answer and little else: "mother" wins it over
    // the age, which comes first in the sheet.
    const whole = selectRecords(parsed, ["mother"], 3_000, "")?.text ?? "";
    const chosen = selectRecords(
      parsed,
      ["mother"],
      whole.length + 20,
      "What about Ilse's mother?",
    );
    expect(chosen?.text).toContain("Her mother may have drowned in 1899.");
    expect(chosen?.text).not.toContain("Twenty-six");
  });

  it("ranks an answer the request's words match before one only the sheet's person matches, when the name is itself a term", () => {
    // "Marta" is long enough to be a term, and every record on her sheet is
    // about her: the answer that speaks of the mother still comes first.
    const marta = parseReference(
      SHEET.replace("Ilse Varga; Isa", "Marta Neri"),
      page("character"),
      "Marta",
    );
    const whole = selectRecords(marta, ["mother"], 3_000, "")?.text ?? "";
    const chosen = selectRecords(
      marta,
      ["marta", "mother"],
      whole.length + 20,
      "What about Marta's mother?",
    );
    expect(chosen?.text).toContain("Her mother may have drowned in 1899.");
    expect(chosen?.text).not.toContain("Twenty-six");
  });
});

describe("guidanceItems and mentions", () => {
  it("gives the judge a block's rules as an item about that block", () => {
    const parsed = parseReference(
      "## Teleportation\n- **What it is:** gates\n- **What it cannot do:** cross water\n",
      page("world:systems"),
    );
    const items = guidanceItems(parsed, "Systems");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Systems — Teleportation",
      entity: "Teleportation",
    });
    expect(items[0].text).toContain("MUST HOLD");
  });

  it("gives a person's item every name the sheet records, so a nickname reaches it", () => {
    const parsed = parseReference(
      "- **Names and nicknames:**\n  - Tomas Varga; Tom\n- **Abilities and limitations:**\n  - cannot swim\n",
      page("character"),
      "Tomas",
    );
    expect(guidanceItems(parsed, "Tomas")).toEqual([
      expect.objectContaining({
        entity: "Tomas",
        aliases: ["Tomas Varga", "Tom"],
      }),
    ]);
  });

  it("matches a name by its longer words, or all of them when none is long", () => {
    expect(mentions("The Harbour", "at the harbour, grey")).toBe(true);
    expect(mentions("The Harbour", "the gate")).toBe(false);
    expect(mentions("Leo", "Leo was tall")).toBe(true);
    expect(mentions("Leo", "Leonardo was tall")).toBe(false);
  });
});

describe("usageClause", () => {
  it("tells what each heading on the pages read means, and what each page is for", () => {
    const clause = usageClause([page("arc")], true);
    expect(clause).toContain("HOW TO USE THE WRITER'S REFERENCES.");
    expect(clause).toContain(
      "- PLANNED: Intended story, possibly not yet written.",
    );
    expect(clause).toContain("- OTHER NOTES:");
    // Only the headings an arc can carry.
    expect(clause).not.toContain("- MUST HOLD:");
    expect(clause).toContain(
      `- Character arc: ${page("arc").purpose.slice(0, 40)}`,
    );
    expect(clause).toContain("The writer's notes are free text");
    expect(usageClause([], false)).toBe("");
  });

  it("names the pages rather than explain them when the explanation is longer than its room", () => {
    const pages = [page("character"), page("guidebook:continuity")];
    const full = usageClause(pages, false);
    const short = usageClause(pages, false, full.length - 1);
    // Room for the headings, not for the pages' purposes.
    expect(short.length).toBeLessThan(full.length);
    expect(short).toContain("- ESTABLISHED:");
    expect(short).toContain(
      "The pages read: Character sheet, Plot and narrative continuity.",
    );
    expect(short).not.toContain("What each page is for");
  });

  it("keeps each heading with its gloss when even the headings are longer than the room", () => {
    const pages = [page("character"), page("arc")];
    const compact = usageClause(pages, false, 0);
    expect(compact.length).toBeLessThan(700);
    expect(compact).toContain("HOW TO USE THE WRITER'S REFERENCES.");
    expect(compact).toContain(
      "PLANNED (intended story, perhaps not written yet; never proof of the prose)",
    );
    expect(compact).toContain("OTHER NOTES (context, never evidence)");
    expect(compact).not.toContain("- ESTABLISHED:");
  });

  it("explains the notes alone when the chat reads no page", () => {
    const full = usageClause([], true);
    expect(full).toContain("The writer's notes are free text");
    expect(full).not.toContain("What each page is for");
    // No page to name, so the short form is the glosses at once.
    const short = usageClause([], true, full.length - 1);
    expect(short).not.toContain("The pages read");
    expect(short).toContain("OTHER NOTES (context, never evidence)");
  });
});
