// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { LEDGER_RECIPE_REVISION, type SectionLedger } from "../domain/ledger";
import type {
  KnownName,
  ModelDescriptor,
  ModelRequest,
  SourceDescriptor,
} from "../domain/types";
import type { ModelProvider, ProjectSources } from "../ports";
import {
  chunksOf,
  declaredLedgerText,
  declaredLedgerTexts,
  ensureLedgers,
  guidanceOf,
  LEDGER_INSTRUCTIONS,
  type LedgerDependencies,
  ledgerTextOf,
  ledgerTexts,
} from "./ledger";

const section = (id: string, order: number): SourceDescriptor => ({
  id: `node:${id}`,
  kind: "manuscript",
  title: `Chapter ${id}`,
  path: `document/${id}.md`,
  nodeId: id,
  nodeKind: "section",
  order,
  authority: "manuscript",
});

const SHEET: SourceDescriptor = {
  id: "reference:characters--marta.md",
  kind: "reference",
  title: "Marta",
  path: "reference/characters--marta.md",
  group: "characters",
  authority: "reference",
};

const CATALOG: SourceDescriptor[] = [
  section("A", 0),
  section("B", 1),
  { ...section("P", 2), nodeKind: "part" },
  SHEET,
  { ...SHEET, id: "reference:notes--n.md", kind: "note", group: "notes" },
  { ...SHEET, id: "reference:characters--empty.md", title: "Empty" },
  { ...SHEET, id: "reference:characters--gone.md", title: "Gone" },
];

const TEXTS: Record<string, string> = {
  "node:A": "Marta had grey eyes.\nShe was thirty-four.",
  "node:B": "Her eyes were green that morning.",
  "node:P": "A part heading.",
  "reference:characters--marta.md": "# Marta\n\n## Eyes\nGrey\n",
  "reference:notes--n.md": "Eyes: blue",
  "reference:characters--empty.md": "# Empty\n\n## Eyes\n",
};

const sources: ProjectSources = {
  async list() {
    return CATALOG;
  },
  async read(id: string) {
    const text = TEXTS[id];
    if (text === undefined) throw new Error("source-not-found");
    return { text, revision: `r-${id}`, origin: "project-file" };
  },
  async allowedReaderSources() {
    return new Set<string>();
  },
};

const DESCRIPTOR: ModelDescriptor = {
  id: "m",
  providerId: "ollama",
  label: "m",
  kind: "device",
  capabilities: { tools: true, structuredOutput: true },
  contextTokens: 131_072,
};

/** A model that states, for each text it is shown, the facts `answer` gives. */
function model(
  answer: (content: string) => unknown,
  seen: ModelRequest[] = [],
): ModelProvider {
  return {
    id: "stub",
    listModels: async () => [],
    describeModel: async () => DESCRIPTOR,
    estimate: async () => ({ tokens: 1, exact: true }),
    generate: async function* (request) {
      seen.push(request);
      const content = request.messages[0]?.content ?? "";
      yield {
        type: "text-delta",
        text: JSON.stringify(answer(content)),
      };
      yield {
        type: "completed",
        reason: "answer",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}

class Store {
  ledgers = new Map<string, SectionLedger>();
  written: string[] = [];
  async readLedger(id: string) {
    return this.ledgers.get(id) ?? null;
  }
  async writeLedger(ledger: SectionLedger) {
    this.written.push(ledger.sourceId);
    this.ledgers.set(ledger.sourceId, ledger);
  }
}

const eyes = (norm: string, quote: string) => ({
  entity: "Marta",
  kind: "person",
  status: "stated",
  attribute: "eye colour",
  type: "colour",
  value: norm,
  norm,
  quote,
  change: false,
});

/** The facts of this file's texts, as a faithful model would state them. */
function faithful(content: string): unknown {
  if (content.includes("Marta had grey eyes"))
    return {
      facts: [
        eyes("grey", "Marta had grey eyes."),
        {
          ...eyes("34 years", "She was thirty-four."),
          attribute: "age",
          type: "number",
          value: "thirty-four",
        },
        // Stated nowhere: the model's own idea, dropped.
        eyes("blue", "Marta had blue eyes."),
      ],
    };
  if (content.includes("Her eyes were green"))
    return { facts: [eyes("green", "Her eyes were green that morning.")] };
  if (content.includes("REFERENCE SHEET"))
    return { facts: [eyes("grey", "Grey")] };
  return { facts: [] };
}

const depsWith = (
  store: Store,
  provider: ModelProvider,
): LedgerDependencies => ({
  sources,
  artifacts: store,
  model: provider,
  descriptor: DESCRIPTOR,
  modelRef: { providerId: "ollama", modelId: "qwen3:8b" },
});

const NAMES: KnownName[] = [
  { sourceId: SHEET.id, kind: "character", names: ["Marta", "Neri"] },
  { sourceId: "reference:world--locations.md", kind: "place", names: ["Rome"] },
];

const signal = new AbortController().signal;

describe("the ledger's texts", () => {
  it("reads every Section and every answered fact sheet as read_source gives them", async () => {
    const texts = await ledgerTexts(sources, CATALOG, signal);
    expect(texts.map((one) => [one.source.id, one.origin])).toEqual([
      ["node:A", "prose"],
      ["node:B", "prose"],
      ["reference:characters--marta.md", "sheet"],
    ]);
    // As read, so every quote is the file's own words.
    expect(texts[2].text).toBe(TEXTS["reference:characters--marta.md"]);
  });
});

describe("ensureLedgers", () => {
  it("reads each stale text once, keeps what its quotes support, and reuses it next time", async () => {
    const store = new Store();
    const seen: ModelRequest[] = [];
    const deps = depsWith(store, model(faithful, seen));
    const texts = await ledgerTexts(sources, CATALOG, signal);
    const reading: string[] = [];
    const first = await ensureLedgers(texts, NAMES, deps, signal, (source) =>
      reading.push(source.id),
    );
    expect(reading).toEqual([
      "node:A",
      "node:B",
      "reference:characters--marta.md",
    ]);
    expect(first.usage.steps).toBe(6);
    const [a, b, sheet] = first.ledgers;
    expect(a).toMatchObject({
      sourceId: "node:A",
      contentHash: "r-node:A",
      recipeRevision: LEDGER_RECIPE_REVISION,
      model: "ollama/qwen3:8b",
      origin: "prose",
    });
    expect(a.claims.map((claim) => [claim.norm, claim.at])).toEqual([
      ["grey", 0],
      ["34 years", TEXTS["node:A"].indexOf("She was")],
    ]);
    expect(b.claims).toHaveLength(1);
    expect(sheet.origin).toBe("sheet");
    // The sheet names travel; the places do not name a person.
    const told = seen[0].messages[0]?.content ?? "";
    expect(told).toContain("- Marta, Neri");
    expect(told).not.toContain("Rome");
    expect(seen[4].messages[0]?.content).toContain("REFERENCE SHEET");

    // Nothing changed: nothing is read again.
    const again = await ensureLedgers(texts, NAMES, deps, signal);
    expect(seen).toHaveLength(6);
    expect(again.ledgers).toEqual(first.ledgers);

    // One Section moved: that one is read, the rest reused.
    const moved = texts.map((one) =>
      one.source.id === "node:B" ? { ...one, revision: "r2" } : one,
    );
    await ensureLedgers(moved, NAMES, deps, signal);
    expect(seen).toHaveLength(8);
    expect(store.written).toEqual([
      "node:A",
      "node:B",
      "reference:characters--marta.md",
      "node:B",
    ]);

    // A ledger from another recipe is read again.
    store.ledgers.set("node:A", { ...a, recipeRevision: "0" });
    await ensureLedgers(moved, NAMES, deps, signal);
    expect(seen).toHaveLength(10);
  });

  it("shows a sheet the book's Sections, and dates a change it declares by one", async () => {
    const seen: ModelRequest[] = [];
    const sheetFacts = {
      facts: [
        { ...eyes("grey", "Grey"), section: 0 },
        { ...eyes("green", "Grey"), change: true, section: 2 },
        // Off the list: a change, dated by no Section.
        { ...eyes("blue", "Grey"), change: true, section: 9 },
      ],
    };
    const deps = depsWith(
      new Store(),
      model(
        (content) =>
          content.includes("REFERENCE SHEET") ? sheetFacts : faithful(content),
        seen,
      ),
    );
    const texts = await ledgerTexts(sources, CATALOG, signal);
    const { ledgers } = await ensureLedgers(texts, NAMES, deps, signal);
    const sheet = ledgers[2];
    expect(sheet.claims.map((claim) => [claim.norm, claim.from])).toEqual([
      ["grey", undefined],
      ["green", "node:B"],
      ["blue", undefined],
    ]);
    const told = seen[4];
    expect(told.messages[0]?.content).toContain(
      `THE BOOK'S SECTIONS, IN ORDER:\n1. "Chapter A"\n2. "Chapter B"`,
    );
    expect(JSON.stringify(told.output)).toContain('"section"');
    // The prose is asked no Section, and is shown none.
    expect(seen[0].messages[0]?.content).not.toContain("SECTIONS");
    expect(JSON.stringify(seen[0].output)).not.toContain('"section"');
  });

  it("reads a long text in chunks and places each claim in the whole text", async () => {
    const store = new Store();
    const seen: ModelRequest[] = [];
    const long = `${"Filler line.\n".repeat(1_200)}Marta had grey eyes.\n`;
    const deps = depsWith(
      store,
      model(
        (content) =>
          content.includes("Marta had grey eyes")
            ? { facts: [eyes("grey", "Marta had grey eyes.")] }
            : { facts: [] },
        seen,
      ),
    );
    const { ledgers } = await ensureLedgers(
      [{ source: section("L", 0), text: long, revision: "r", origin: "prose" }],
      [],
      deps,
      signal,
    );
    expect(seen.length).toBeGreaterThan(1);
    expect(ledgers[0].claims[0].at).toBe(long.indexOf("Marta"));
    // No sheet names, no names block.
    expect(seen[0].messages[0]?.content).not.toContain("PEOPLE");
  });

  it("reads an answer the output limit cut off again in halves, and counts what it dropped", async () => {
    const text = `${"Filler line.\n".repeat(300)}Marta had grey eyes.\n`;
    const seen: string[] = [];
    const provider: ModelProvider = {
      id: "stub",
      listModels: async () => [],
      describeModel: async () => DESCRIPTOR,
      estimate: async () => ({ tokens: 1, exact: true }),
      generate: async function* (request) {
        const content = request.messages[0]?.content ?? "";
        seen.push(content);
        // The whole text is too much to answer; either half is not.
        if (content.length > text.length / 2 + 200) {
          yield { type: "text-delta", text: '{"facts":[{"entity":"Ma' };
          yield { type: "completed", reason: "limit" };
          return;
        }
        yield {
          type: "text-delta",
          text: JSON.stringify({
            facts: content.includes("Marta had grey eyes")
              ? [
                  eyes("grey", "Marta had grey eyes."),
                  // Not in the text: dropped, and counted.
                  eyes("blue", "Marta had blue eyes."),
                ]
              : [],
          }),
        };
        yield { type: "completed", reason: "answer" };
      },
    };
    const { ledgers } = await ensureLedgers(
      [{ source: section("L", 0), text, revision: "r", origin: "prose" }],
      [],
      depsWith(new Store(), provider),
      signal,
    );
    // The whole once, then pieces of at most half, cut at line breaks.
    expect(seen.length).toBeGreaterThan(2);
    expect(ledgers[0].claims.map((claim) => claim.at)).toEqual([
      text.indexOf("Marta"),
    ]);
    // Read twice: the made-up fact is dropped each time.
    expect(ledgers[0].dropped).toBe(2);
  });

  it("reads a sheet the output limit cut off again in halves of its records, each quote still placed in its field", async () => {
    const text = [
      "- **Names and nicknames:**",
      "  - Marta Neri",
      "- **Age and date of birth:**",
      "  - thirty-four",
      // Past `LEDGER_CHUNK_FLOOR`, so halving it is worth a request.
      "- **Everyday life:**",
      `  - ${"She walks to the ward before dawn. ".repeat(40)}`,
      "- **Details to remember:**",
      "  - a scar on the left hand",
    ].join("\n");
    const seen: string[] = [];
    const provider: ModelProvider = {
      id: "stub",
      listModels: async () => [],
      describeModel: async () => DESCRIPTOR,
      estimate: async () => ({ tokens: 1, exact: true }),
      generate: async function* (request) {
        const content = request.messages[0]?.content ?? "";
        seen.push(content);
        // The whole sheet is too much to answer; a half of its records is not.
        if (content.includes("thirty-four") && content.includes("scar")) {
          yield { type: "text-delta", text: '{"facts":[{"entity":"Ma' };
          yield { type: "completed", reason: "limit" };
          return;
        }
        yield {
          type: "text-delta",
          text: JSON.stringify({
            facts: content.includes("scar")
              ? [
                  {
                    ...eyes("left hand", "a scar on the left hand"),
                    attribute: "scar",
                    type: "words",
                    value: "left hand",
                  },
                ]
              : [],
          }),
        };
        yield { type: "completed", reason: "answer" };
      },
    };
    const sheet = ledgerTextOf(SHEET, { text, revision: "r" });
    if (!sheet) throw new Error("the sheet has facts to read");
    const { ledgers } = await ensureLedgers(
      [sheet],
      [],
      depsWith(new Store(), provider),
      signal,
    );
    // The whole once, then its records again in two pieces.
    expect(seen.length).toBeGreaterThan(2);
    expect(ledgers[0].claims.map((claim) => [claim.at, claim.field])).toEqual([
      [text.indexOf("a scar"), "character/details"],
    ]);
  });

  it("stores nothing for a text the model answered in no shape, and names it", async () => {
    const store = new Store();
    const deps = depsWith(
      store,
      model(() => "not a list"),
    );
    const texts = await ledgerTexts(sources, [section("A", 0)], signal);
    const read = await ensureLedgers(texts, [], deps, signal);
    expect(read.ledgers).toEqual([]);
    expect(read.unread.map((source) => source.id)).toEqual(["node:A"]);
    expect(read.usage.steps).toBe(1);
    expect(store.written).toEqual([]);
  });

  it("keeps a ledger it read when the store cannot keep it", async () => {
    // The kept copy only saves the next check a reading; this one has the
    // facts in hand, so a full disk costs nothing but that.
    const store = new Store();
    store.writeLedger = async () => {
      throw new Error("quota");
    };
    const deps = depsWith(store, model(faithful));
    const texts = await ledgerTexts(sources, [section("A", 0)], signal);
    const read = await ensureLedgers(texts, NAMES, deps, signal);
    expect(read.ledgers.map((one) => one.sourceId)).toEqual(["node:A"]);
    expect(read.unread).toEqual([]);
  });

  it("stops when asked", async () => {
    const stop = new AbortController();
    stop.abort();
    const deps = depsWith(new Store(), model(faithful));
    const texts = await ledgerTexts(sources, [section("A", 0)], signal);
    await expect(
      ensureLedgers(texts, [], deps, stop.signal),
    ).rejects.toMatchObject({ failure: { code: "cancelled" } });
  });
});

describe("chunksOf", () => {
  it("cuts at a line break in the second half, and covers the text exactly", () => {
    const text = "aaaaaaa\nbbbbbbbb\ncc";
    const chunks = chunksOf(text, 10);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    expect(chunks[0]).toEqual({ start: 0, text: "aaaaaaa\n" });
    // No break in the second half: cut at the size.
    expect(chunksOf("x".repeat(25), 10).map((chunk) => chunk.start)).toEqual([
      0, 10, 20,
    ]);
    expect(chunksOf("", 10)).toEqual([]);
  });
});

// ── A sheet's Sections and declared references ───────────────────────────────

describe("a sheet's Section binding follows the book", () => {
  const dated = (content: string) =>
    content.includes("REFERENCE SHEET")
      ? { facts: [{ ...eyes("grey", "Grey"), change: true, section: 2 }] }
      : { facts: [] };

  it("reads an unchanged sheet again when the Sections it was numbered against change", async () => {
    const store = new Store();
    const seen: ModelRequest[] = [];
    const deps = depsWith(store, model(dated, seen));
    const texts = await ledgerTexts(sources, CATALOG, signal);
    const [a, b] = [section("A", 0), section("B", 1)];
    const first = await ensureLedgers(texts, NAMES, deps, signal, () => {}, [
      a,
      b,
    ]);
    const sheet = () => first.ledgers[2];
    expect(sheet().claims[0]?.from).toBe("node:B");
    expect(sheet().sections).toBeDefined();
    const calls = seen.length;

    // Nothing changed: nothing read again.
    await ensureLedgers(texts, NAMES, deps, signal, () => {}, [a, b]);
    expect(seen).toHaveLength(calls);

    // The chapters swapped: the sheet is read again, the prose is not,
    // and "chapter two" is now the other Section.
    const swapped = await ensureLedgers(texts, NAMES, deps, signal, () => {}, [
      b,
      a,
    ]);
    expect(seen.length).toBe(calls + 2);
    expect(swapped.ledgers[2]?.claims[0]?.from).toBe("node:A");
    expect(store.written.slice(-1)).toEqual(["reference:characters--marta.md"]);

    // A renamed Section changes what "chapter two" was resolved against too.
    await ensureLedgers(texts, NAMES, deps, signal, () => {}, [
      b,
      { ...a, title: "Chapter A, renamed" },
    ]);
    expect(seen.length).toBe(calls + 4);
  });

  it("numbers a sheet by the whole book given, not by the Sections in scope", async () => {
    const store = new Store();
    const seen: ModelRequest[] = [];
    const deps = depsWith(store, model(dated, seen));
    // Only Chapter B is in scope, but the book is A then B.
    const texts = (await ledgerTexts(sources, CATALOG, signal)).filter(
      (one) => one.source.id !== "node:A",
    );
    const { ledgers } = await ensureLedgers(
      texts,
      NAMES,
      deps,
      signal,
      () => {},
      [section("A", 0), section("B", 1)],
    );
    const told = seen.find((request) =>
      request.messages[0]?.content.includes("REFERENCE SHEET"),
    );
    expect(told?.messages[0]?.content).toContain(
      `THE BOOK'S SECTIONS, IN ORDER:\n1. "Chapter A"\n2. "Chapter B"`,
    );
    expect(ledgers[1]?.claims[0]?.from).toBe("node:B");
  });
});

describe("a declared reference as the ledger reads it", () => {
  // As the project adapter publishes a notes file: kind `note`, never
  // `reference`. A fixture of kind `reference` would pass while every real
  // note is left out.
  const notes: SourceDescriptor = {
    id: "reference:notes--n.md",
    kind: "note",
    group: "notes",
    title: "Notes",
    path: "reference/notes--n.md",
    authority: "reference",
  };
  it("reads a filled guidebook or notes document as a sheet, and nothing derived or empty", () => {
    expect(
      declaredLedgerText(notes, {
        text: "Marta's eyes are grey.",
        revision: "r",
      }),
    ).toMatchObject({ origin: "sheet", text: "Marta's eyes are grey." });
    expect(
      declaredLedgerText(notes, {
        text: "# Notes\n\n- **Eyes:**\n  - ",
        revision: "r",
      }),
    ).toBeNull();
    expect(
      declaredLedgerText(
        { ...notes, group: "summaries", summarises: "A" },
        { text: "Marta crosses the harbour.", revision: "r" },
      ),
    ).toBeNull();
    // A fact sheet has its own reader; a Section is the prose's own path.
    expect(
      declaredLedgerText(SHEET, { text: "Grey", revision: "r" }),
    ).toBeNull();
    expect(
      declaredLedgerText(section("A", 0), { text: "Grey", revision: "r" }),
    ).toBeNull();
  });

  it("reads a note-kind document through the port, beside a guidebook reference", async () => {
    const guide: SourceDescriptor = {
      ...notes,
      id: "reference:guidebook--continuity.md",
      kind: "reference",
      group: "guidebook",
      title: "Continuity",
    };
    const texts: Record<string, string> = {
      [notes.id]: "Marta is a doctor.",
      [guide.id]: "Keep the harbour grey.",
    };
    const reads: string[] = [];
    const port: ProjectSources = {
      ...sources,
      async read(id: string) {
        reads.push(id);
        return { text: texts[id] ?? "", revision: "r", origin: "project-file" };
      },
    };
    const read = await declaredLedgerTexts(
      port,
      [notes, guide, SHEET, section("A", 0)],
      new AbortController().signal,
    );
    // The note and the guide, as sheets; the fact sheet and the Section
    // have their own readers and are not opened here.
    expect(read.map((one) => [one.source.id, one.origin])).toEqual([
      [notes.id, "sheet"],
      [guide.id, "sheet"],
    ]);
    expect(reads).toEqual([notes.id, guide.id]);
  });

  // ── The guidance for the judge ─────────────────────────────────────────────
  // The judge sees each declared document by record, under its role. A line
  // the catalogue cannot place is shown as the writer's note, word for word.
  it("gives the judge each declared document's records, the Editing brief last, and no empty one", () => {
    const guide: SourceDescriptor = {
      ...notes,
      id: "reference:guidebook--continuity.md",
      kind: "reference",
      group: "guidebook",
      sectionId: "continuity",
      title: "Continuity",
    };
    const brief: SourceDescriptor = {
      ...guide,
      id: "reference:guidebook--editing-brief.md",
      sectionId: "editing-brief",
      title: "Editing brief",
    };
    const guidance = guidanceOf([
      { source: brief, text: "Be strict about time.", revision: "b1" },
      { source: notes, text: "   \n", revision: "n1" },
      {
        source: guide,
        text: "Compare only within each version.",
        revision: "g1",
      },
    ]);
    // The brief is about every review, so when room runs short in the
    // judge's question (`judgeMessage`), the document about this check is
    // kept first. A template the writer answered nothing in is no guidance.
    expect(guidance).toEqual([
      {
        sourceId: guide.id,
        title: "Continuity",
        text: "OTHER NOTES\n- Compare only within each version.",
        revision: "g1",
      },
      {
        sourceId: brief.id,
        title: "Editing brief",
        text: "OTHER NOTES\n- Be strict about time.",
        revision: "b1",
      },
    ]);
  });

  it("shows the judge only the records a verdict turns on, each under its role, and a block or a person as its own item", () => {
    const guide: SourceDescriptor = {
      ...notes,
      id: "reference:guidebook--continuity.md",
      kind: "reference",
      group: "guidebook",
      sectionId: "continuity",
      title: "Continuity",
    };
    const places: SourceDescriptor = {
      ...guide,
      id: "reference:world--locations.md",
      group: "world",
      sectionId: "locations",
      title: "Places",
    };
    const guidance = guidanceOf([
      {
        source: guide,
        text: [
          "- **Relationships and other facts:** odd chapters are one life",
          "- **Open questions:** does Marta stay?",
          "- **Contradictions to resolve:** her eyes in chapter four",
        ].join("\n"),
        revision: "g1",
      },
      {
        source: SHEET,
        text: "- **Fears:** the sea\n- **Secrets and unacknowledged truths:** she failed once\n",
        revision: "s1",
      },
      {
        source: places,
        text: "## The Harbour\n- **Names:** the Mouth\n- **Atmosphere:** loud\n",
        revision: "p1",
      },
    ]);
    expect(guidance).toEqual([
      {
        sourceId: guide.id,
        title: "Continuity",
        text: [
          "ESTABLISHED",
          "- Relationships and other facts: odd chapters are one life",
          "",
          "UNDECIDED",
          "- Open questions: does Marta stay?",
          "",
          "ALREADY ON THE WRITER'S LIST",
          "- Contradictions to resolve: her eyes in chapter four",
        ].join("\n"),
        revision: "g1",
      },
      // A person's fears decide no verdict; what they hide may.
      {
        sourceId: SHEET.id,
        title: "Marta",
        text: "WHO KNOWS WHAT\n- Secrets and unacknowledged truths: she failed once",
        revision: "s1",
        entity: "Marta",
      },
    ]);
    // The harbour's names and atmosphere are no judge's reading at all.
  });
});

// ── A value's own time ───────────────────────────────────────────────────────

describe("a value's own time", () => {
  it("tells the model what `when` is, with the past-tense narration told apart from a past value", () => {
    expect(LEDGER_INSTRUCTIONS).toContain(
      "- when: the time the value holds at",
    );
    expect(LEDGER_INSTRUCTIONS).toContain(
      '"She was sixty-one" in a story told in the past tense is the present)',
    );
    // A finished total is no state at a time. "had kept the hut for
    // twenty-seven years" scoped as past is a tenure of another time, and
    // meets no sheet.
    expect(LEDGER_INSTRUCTIONS).toContain(
      "is his tenure, not a past value of it",
    );
  });
});

describe("one person's names", () => {
  it("tells the model the name type is the entity's own, and a relation's name is words", () => {
    expect(LEDGER_INSTRUCTIONS).toContain(
      "never another's name in relation to it: a father's, a friend's, an author's name is words",
    );
  });

  it("tells the model a fact on a person's page is theirs unless the answer ties it to someone else", () => {
    expect(LEDGER_INSTRUCTIONS).toContain(
      "on Hollis's page, \"daughter of Amos, who kept the hut for thirty-eight years\" is Amos's tenure, never hers",
    );
    // Recipe revision 13 carries this rule, and every later one keeps it.
    expect(Number(LEDGER_RECIPE_REVISION)).toBeGreaterThanOrEqual(13);
  });

  it("tells the model a label names the kind of fact, never its answer (EVAL attempt 13)", () => {
    // "right hand scar: yes" and "left hand scar: yes" are two facts that
    // can both be true, so the label grouping keeps them apart and a slip
    // between the sheet and the prose is never compared.
    expect(LEDGER_INSTRUCTIONS).toContain(
      'It names the kind of fact, never its answer: nothing of the value goes in it. "scar location" with the value "right hand", never "right hand scar" with the value "yes"',
    );
    expect(Number(LEDGER_RECIPE_REVISION)).toBeGreaterThanOrEqual(14);
  });

  it("tells the model an event is named by what happened, never by its date", () => {
    // The fixture's flood: "the flood of 1904" on the timeline and "the
    // flood of 1906" in the prose are two names, so the two years are never
    // put side by side.
    expect(LEDGER_INSTRUCTIONS).toContain(
      'An event is named by what happened, never by when: "the flood", never "the flood of 1906" or "the 1906 flood"',
    );
    expect(Number(LEDGER_RECIPE_REVISION)).toBeGreaterThanOrEqual(15);
  });

  it("tells the model an event's date is labelled date, whatever its precision", () => {
    // The fixture's flood again, both sides named "the flood": a prose year
    // labelled "year" and a timeline year labelled "date" are never
    // compared, because the label grouping sees no entity and does not take
    // a year and a date for one fact.
    expect(LEDGER_INSTRUCTIONS).toContain(
      `An event's own date is labelled "date", whether the text gives its day, its month or only its year: "date" with "1906", never "year".`,
    );
    expect(Number(LEDGER_RECIPE_REVISION)).toBeGreaterThanOrEqual(16);
  });
});

// ── A sheet read by its catalogue page ───────────────────────────────────────

describe("a sheet read by its catalogue page", () => {
  const guide = (sectionId: string, title: string): SourceDescriptor => ({
    id: `reference:guidebook--${sectionId}.md`,
    kind: "reference",
    group: "guidebook",
    sectionId,
    title,
    path: `reference/guidebook--${sectionId}.md`,
    authority: "reference",
  });
  const fact = (quote: string, extra: Record<string, unknown> = {}) => ({
    ...eyes("grey", quote),
    ...extra,
  });

  /** One sheet read once, the model answering `facts` to it. */
  async function readSheet(
    source: SourceDescriptor,
    text: string,
    facts: unknown[],
    seen: ModelRequest[] = [],
  ) {
    const one =
      declaredLedgerText(source, { text, revision: "r" }) ??
      (
        await ledgerTexts(
          {
            ...sources,
            read: async () => ({ text, revision: "r", origin: "project-file" }),
          },
          [source],
          signal,
        )
      )[0];
    const { ledgers } = await ensureLedgers(
      [one],
      [],
      {
        ...depsWith(
          new Store(),
          model(() => ({ facts }), seen),
        ),
        reads: 1,
      },
      signal,
      () => {},
      [section("A", 0), section("B", 1)],
    );
    return ledgers[0];
  }

  it("never reads an open question or a known contradiction of the continuity page as a fact", async () => {
    const text = [
      "# Continuity",
      "- **Names and terms:** Marta has grey eyes",
      "- **Open questions:** does Marta keep her grey eyes?",
      "- **Contradictions to resolve:** her grey eyes turn green in chapter B",
    ].join("\n");
    const seen: ModelRequest[] = [];
    const ledger = await readSheet(
      guide("continuity", "Continuity"),
      text,
      [
        fact("Marta has grey eyes"),
        fact("does Marta keep her grey eyes?"),
        fact("her grey eyes turn green in chapter B"),
      ],
      seen,
    );
    // The reader was never shown the other two: their quotes are nowhere
    // in what it read, and are dropped.
    expect(seen[0].messages[0]?.content).not.toContain("does Marta keep");
    expect(ledger.claims.map((one) => [one.quote, one.at, one.field])).toEqual([
      [
        "Marta has grey eyes",
        text.indexOf("Marta has grey eyes"),
        "guidebook:continuity/names",
      ],
    ]);
    expect(ledger.dropped).toBe(2);
    expect(ledger.interpretation).toBe("full");
  });

  it("holds a plan's claims at planned, a dated change included, so it never splits the story", async () => {
    const arc: SourceDescriptor = {
      ...SHEET,
      id: "reference:arcs--marta.md",
      group: "arcs",
    };
    const ledger = await readSheet(
      arc,
      "- **Turning point:** her eyes go green in chapter two\n",
      [fact("her eyes go green in chapter two", { change: true, section: 2 })],
    );
    expect(ledger.claims).toMatchObject([
      { status: "planned", from: "node:B", field: "arc/turning" },
    ]);
  });

  it("keeps a belief a fact field records as a belief: the field never promotes it", async () => {
    const ledger = await readSheet(
      SHEET,
      "- **Appearance:** the village thinks her eyes are grey\n",
      [fact("the village thinks her eyes are grey", { status: "believed" })],
    );
    expect(ledger.claims).toMatchObject([
      { status: "believed", field: "character/appearance" },
    ]);
  });

  it("reads a note, a renamed field and loose prose as context only, and says the page was partly read", async () => {
    const notes: SourceDescriptor = {
      ...SHEET,
      id: "reference:notes--n.md",
      kind: "note",
      group: "notes",
      title: "Notes",
    };
    const note = await readSheet(notes, "Marta was born in 1989.\n", [
      fact("Marta was born in 1989."),
    ]);
    expect(note.claims).toMatchObject([
      { status: "stated", unclassified: true },
    ]);
    expect(note.claims[0].field).toBeUndefined();
    expect(note.interpretation).toBe("raw");

    const renamed = await readSheet(
      SHEET,
      "- **Looks:** grey eyes\n- **Age and date of birth:** 34 years old\n",
      [
        fact("grey eyes"),
        fact("34 years old", {
          attribute: "age",
          type: "number",
          norm: "34 years",
        }),
      ],
    );
    expect(
      renamed.claims.map((one) => [one.quote, one.unclassified, one.field]),
    ).toEqual([
      ["grey eyes", true, undefined],
      ["34 years old", undefined, "character/age"],
    ]);
    expect(renamed.interpretation).toBe("partial");
  });

  it("makes no ledger text of a page with nothing a fact may be read from", () => {
    expect(
      ledgerTextOf(SHEET, {
        text: "- **Fears:** the sea\n- **Role in the story:** the lead\n",
        revision: "r",
      }),
    ).toBeNull();
    expect(
      declaredLedgerText(guide("prose-style", "Style"), {
        text: "- **Point of view and tense:** close third, past\n",
        revision: "r",
      }),
    ).toBeNull();
  });

  it("reads a sheet again when the catalogue changes, and never the prose", async () => {
    const store = new Store();
    const seen: ModelRequest[] = [];
    const deps = depsWith(store, model(faithful, seen));
    const texts = await ledgerTexts(sources, CATALOG, signal);
    await ensureLedgers(texts, NAMES, deps, signal);
    const calls = seen.length;
    const sheet = store.ledgers.get(SHEET.id);
    const prose = store.ledgers.get("node:A");
    expect(sheet?.recipeRevision).toMatch(
      new RegExp(`^${LEDGER_RECIPE_REVISION}\\.[0-9a-f]{8}$`),
    );
    expect(prose?.recipeRevision).toBe(LEDGER_RECIPE_REVISION);
    // A sheet written under another catalogue is read again.
    store.ledgers.set(SHEET.id, {
      ...(sheet as SectionLedger),
      recipeRevision: `${LEDGER_RECIPE_REVISION}.00000000`,
    });
    await ensureLedgers(texts, NAMES, deps, signal);
    expect(seen.length).toBe(calls + 2);
    expect(store.written.slice(-1)).toEqual([SHEET.id]);
  });
});

// ── The story's present in the prose ─────────────────────────────────────────
//
// The extractor reads one Section at a time, so on its own it cannot tell
// when the story is, and a value such as "in the winter of 1911 she was
// twenty-two" is scoped inconsistently. Each Section is told the present the
// writer's timeline states, in the writer's own words.

describe("the story's present, told to the prose", () => {
  const TIMELINE: SourceDescriptor = {
    id: "reference:world--timeline.md",
    kind: "reference",
    title: "History and timeline",
    path: "reference/world--timeline.md",
    group: "world",
    sectionId: "timeline",
    authority: "reference",
  };
  const timeline = (present: string) =>
    ledgerTextOf(TIMELINE, {
      text: `# History and timeline\n\n- **The story's present:**\n  - ${present}\n`,
      revision: `r-${present}`,
    });
  const prose = () =>
    ledgerTextOf(section("A", 0), { text: TEXTS["node:A"], revision: "r-A" });
  const told = (request: ModelRequest | undefined) =>
    request?.messages[0]?.content ?? "";
  const LINE = `THE STORY'S PRESENT, AS THE WRITER'S TIMELINE GIVES IT: "The autumn and winter of 1911."`;

  it("tells each Section the present the timeline states, and keeps it with the ledger", async () => {
    const store = new Store();
    const seen: ModelRequest[] = [];
    const texts = [prose(), timeline("The autumn and winter of 1911.")].filter(
      (one) => one !== null,
    );
    expect(texts).toHaveLength(2);
    await ensureLedgers(
      texts,
      NAMES,
      depsWith(store, model(faithful, seen)),
      signal,
    );
    expect(told(seen[0])).toContain(LINE);
    // The sheet is its own source of the present, and is not told it.
    const sheet = seen.find((one) => told(one).includes("REFERENCE SHEET"));
    expect(told(sheet)).toContain("REFERENCE SHEET");
    expect(told(sheet)).not.toContain("THE STORY'S PRESENT");
    expect(store.ledgers.get("node:A")?.present).toBe(
      "The autumn and winter of 1911.",
    );
  });

  it("tells nothing when no timeline states a present", async () => {
    const seen: ModelRequest[] = [];
    const texts = [prose()].filter((one) => one !== null);
    await ensureLedgers(
      texts,
      NAMES,
      depsWith(new Store(), model(faithful, seen)),
      signal,
    );
    expect(told(seen[0])).not.toContain("THE STORY'S PRESENT");
  });

  it("reads a Section again only when the present it would be told has changed", async () => {
    const store = new Store();
    const seen: ModelRequest[] = [];
    const deps = depsWith(store, model(faithful, seen));
    const with1911 = [
      prose(),
      timeline("The autumn and winter of 1911."),
    ].filter((one) => one !== null);
    await ensureLedgers(with1911, NAMES, deps, signal);
    const reads = () =>
      seen.filter((one) => told(one).includes("Marta had grey eyes")).length;
    // Each extraction reads the text more than once (`LEDGER_READS`).
    const once = reads();
    expect(once).toBeGreaterThan(0);
    // The same present: nothing is read again.
    await ensureLedgers(with1911, NAMES, deps, signal);
    expect(reads()).toBe(once);
    // A check that reads no timeline knows no present, and takes the ledger
    // as it is: two commands that read different sheets never undo each
    // other's work.
    await ensureLedgers(
      [prose()].filter((one) => one !== null),
      NAMES,
      deps,
      signal,
    );
    expect(reads()).toBe(once);
    // The writer moved the present: the Section is read again, told so.
    const with1913 = [prose(), timeline("The spring of 1913.")].filter(
      (one) => one !== null,
    );
    await ensureLedgers(with1913, NAMES, deps, signal);
    expect(reads()).toBe(2 * once);
    expect(store.ledgers.get("node:A")?.present).toBe("The spring of 1913.");
  });

  it("tells the model a value of that present is of the passage's own time", () => {
    expect(LEDGER_INSTRUCTIONS).toContain(
      "A passage headed by the story's present is of that time: a value the text gives for it, a season or a year of it named or not, takes no when.",
    );
    expect(LEDGER_RECIPE_REVISION).toBe("17");
  });
});
