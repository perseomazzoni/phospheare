// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── "Once Dark", as Vision's reference design draws it ───────────────────────
//
// The book behind every number Vision's reference design prints, written as
// the local folder the app opens: structure, word counts and goal, the text of
// "The First Light", two margin comments, the Reference shelves, three notes,
// four snapshots and one chat with Nova. Each value must match the
// design's, or the comparison against it reports a difference in the
// drawing that is a difference in the book. `vision-fixture.spec.ts` pins it.
//
// The numbers come from `stats.perNode`, which the open trusts when it covers
// every node and sums to `stats.words`. So the tree reads 633 / 512 / 401 /
// 280 whatever the files hold, and a file's text is only what a state shows.
//
// The design draws its states as separate pictures, and three of them
// disagree about "The First Light". Each gets its own text, and nothing else differs:
//
//   section  the open page: three paragraphs and the four that scroll;
//   desk     the Desk's quote is the last paragraph and its thread a marker
//            ("??? whose elephant") one paragraph from the end;
//   find     "elephant" is found twice in the Section, the second in a
//            passage the open page never shows.

/** Which picture of the design this seed is for. */
export type FirstLightText = "section" | "desk" | "find";

/** A real uuid: the project's address and its shelf row's key. */
export const BOOK_ID = "a7c3e0d2-5b14-4f6e-8a91-3d2c6b0e7f45";
export const BOOK_FOLDER = "once-dark";
export const CHAT_ID = "4e9b2c71-0d3a-4f58-9b6e-71a2c8d4e530";

// ── The clock ────────────────────────────────────────────────────────────────
//
// Read in UTC (the specs set `timezoneId: "UTC"`, `locale: "en-US"`). The
// writer sat down on Tuesday 13 October at noon and it is now 14:32 the same
// day: the Desk says "since Tuesday", the bar "Saved · 14:32" after a save,
// and the last answer was two minutes ago. "last written Tue 21:14"
// is the count of the Tuesday before.

/** When the page's clock starts: before the save at 14:32. */
export const CLOCK_START = "2026-10-13T14:31:00.000Z";
/** The minute the bar's save names. */
export const SAVE_AT = "2026-10-13T14:32:00.000Z";

const SESSION_START = "2026-10-13T12:00:00.000Z";
const COUNTED_AT = "2026-10-06T21:14:00.000Z";
const ANSWERED_AT = "2026-10-13T14:30:00.000Z";

// ── The shape ────────────────────────────────────────────────────────────────

interface SectionSeed {
  id: string;
  title: string;
  slug: string;
  words: number;
}

interface PartSeed extends SectionSeed {
  children: SectionSeed[];
}

/**
 * Four Parts, six Sections, a goal of 4,000. Ketsu has no Section, so its
 * 280 words are the Part's own text, and the ledger counts six Sections.
 */
export const PARTS: PartSeed[] = [
  {
    id: "EL1",
    title: "Ki — Void",
    slug: "ki_void",
    words: 0,
    children: [
      { id: "EL5", title: "The Dark", slug: "the_dark", words: 412 },
      {
        id: "EL6",
        title: "The First Light",
        slug: "the_first_light",
        words: 221,
      },
    ],
  },
  {
    id: "EL2",
    title: "Shō — The Spark",
    slug: "shō_the_spark",
    words: 0,
    children: [
      {
        id: "EL7",
        title: "All Living Beings",
        slug: "all_living_beings",
        words: 300,
      },
      {
        id: "EL8",
        title: "From Awareness Comes Responsibility",
        slug: "from_awareness_comes_responsibility",
        words: 212,
      },
    ],
  },
  {
    id: "EL3",
    title: "Ten — The Flame",
    slug: "ten_the_flame",
    words: 0,
    children: [
      {
        id: "EL9",
        title: "The Memory of Water",
        slug: "the_memory_of_water",
        words: 198,
      },
      { id: "EL10", title: "The Flame", slug: "the_flame", words: 203 },
    ],
  },
  {
    id: "EL4",
    title: "Ketsu — Earthlings",
    slug: "ketsu_earthlings",
    words: 280,
    children: [],
  },
];

export const GOAL = 4000;
export const TOTAL_WORDS = 1826;

/**
 * When each node was last written, newest first: the spine pales by this
 * rank. "The First Light" is newest, so the Desk resumes there; its stamp is
 * also the adopted snapshot's date (10/10/26, 6:40 PM).
 */
const WRITTEN: Record<string, { at: string; delta?: number }> = {
  EL6: { at: "2026-10-10T18:40:00.000Z", delta: 152 },
  EL5: { at: "2026-10-09T20:10:00.000Z", delta: -38 },
  EL7: { at: "2026-10-05T09:00:00.000Z" },
  EL8: { at: "2026-10-04T09:00:00.000Z" },
  EL9: { at: "2026-10-02T09:00:00.000Z" },
  EL10: { at: "2026-10-01T09:00:00.000Z" },
  EL4: { at: "2026-09-28T09:00:00.000Z" },
};

// ── "The First Light" ────────────────────────────────────────────────────────

const P1 =
  "Small acts, yes. Tiny sparks that no one noticed. But each one kindled a flame. And that light grew brighter only when it was shared.";
const P2 =
  "Over time, people began to understand something simple. Every sentient being experiences the world from its own center. A child feels joy no less than an old person. A dog hopes to return home. An elephant mourns its dead.";
export const P3 =
  "This awareness spread slowly, slower than any revolution, but deeper than any empire.";
const MORE = [
  "No law commanded it. No prophet carried it from town to town. It moved the way warmth moves through a room, from one body to the next, until no one could say where it had begun.",
  "Children were the first to speak of it plainly. They asked why the fish in the market had no names, and why the old dog on the corner was fed only when someone remembered. The adults had no answer that did not sound, once spoken aloud, a little like an excuse.",
  "So the answers changed. Slowly, and then all at once, the way a shoreline changes: nothing seems to move, and then one morning the old path is under water and a new one has been worn into the dunes.",
  "Some called it softness. Others called it the end of something. But those who had felt the first spark knew it for what it was: not an ending, and not a beginning either, but a light that had always been there, waiting for enough eyes to see it.",
];
/** The Desk's thread: a note to self, one paragraph from the end. */
export const MARKER = "??? whose elephant";
/** The find's second hit, in a passage the open page never shows. */
const FIND_TAIL =
  "It was carried on by a child, a dog, an elephant: three small lights in a very large dark.";

const TITLE = "{align:center}# The First Light";

function firstLight(text: FirstLightText): string {
  const blocks =
    text === "desk"
      ? [TITLE, P1, P2, MARKER, P3]
      : text === "find"
        ? [TITLE, P1, P2, P3, ...MORE, FIND_TAIL]
        : [TITLE, P1, P2, P3, ...MORE];
  return `${blocks.join("\n\n")}\n`;
}

/** The earlier drafts, oldest first, and the one after the adopted one. */
const FIRST_LIGHT_SNAPSHOTS = [
  {
    n: "00",
    title: "Opening lines",
    created: "2026-10-08T07:55:00.000Z",
    body: `${TITLE}\n\n${P1}\n`,
  },
  {
    n: "01",
    title: "First pass",
    created: "2026-10-09T18:02:00.000Z",
    body: `${TITLE}\n\n${P1}\n\n${P2}\n`,
  },
  {
    n: "02",
    title: "Before the turn",
    created: "2026-10-10T18:40:00.000Z",
    body: null,
  },
  {
    n: "03",
    title: "The morning it clicked",
    created: "2026-10-11T09:18:00.000Z",
    body: `${TITLE}\n\nSmall acts, yes. Tiny sparks that no one noticed. But each one kindled a flame.\n\nOver time, people began to understand something simple. A child, who had never been asked, felt joy no less than an old person, and said so.\n`,
  },
];
const ADOPTED_FIRST_LIGHT = "02";

// The other Sections are never read on screen except where the find quotes
// them, so each holds a sentence or two.
const OTHER_TEXT: Record<string, string> = {
  EL5: "Before anything, there was the dark, and nobody in it thought to ask whose it was.",
  EL7: "A sparrow, a mule, a woman at a well: each the middle of its own world.",
  EL8: "To know that another feels is to owe it something.",
  EL9: "The river kept what the town forgot.",
  EL10: "In the morning, where the elephant had stood, the grass stayed flat for a long time.",
  EL4: "They came last, and found a world that had already learned to look.",
};

// ── Margin comments ──────────────────────────────────────────────────────────

/** A quote with up to 32 characters of context each side, as the app anchors. */
function around(text: string, quote: string) {
  const at = text.indexOf(quote);
  return {
    quote,
    prefix: text.slice(Math.max(0, at - 32), at),
    suffix: text.slice(at + quote.length, at + quote.length + 32),
  };
}

const COMMENTS_EL6 = {
  threads: [
    {
      id: "t-mara",
      state: "open",
      anchor: around(
        P2,
        "Every sentient being experiences the world from its own center.",
      ),
      entries: [
        {
          id: "e-mara",
          author: { kind: "editor", name: "Mara" },
          at: "2026-10-12T17:20:00.000Z",
          body: "This is the turn of the whole Part. Slow it down?",
        },
      ],
    },
    {
      id: "t-you",
      state: "open",
      anchor: { quote: P3, prefix: "", suffix: "" },
      entries: [
        {
          id: "e-you",
          author: { kind: "writer" },
          at: "2026-10-12T18:05:00.000Z",
          body: "Check the elephant line against the notes.",
        },
      ],
    },
  ],
  dismissed: [],
};

// ── Reference and notes ──────────────────────────────────────────────────────

/** Nine on the shelves (1 + 1 + 4 + 3); arcs are not counted. */
const REFERENCE: Record<string, string> = {
  "guidebook--logline.md":
    "# Logline\n\nA world learns, slowly, that every life is lived from its own centre.\n",
  "world--geography.md":
    "# Geography\n\nA river town, a hill, the long plain beyond.\n",
  "character--Animals.md":
    "# Animals\n\nThe animals are not symbols. Each one wants something the reader can name in a word: the dog, home; the elephant, its dead; the whale, its young.\n\nNone of them speaks. What they know arrives through what the humans finally notice.\n",
  "character--Humans.md":
    "# Humans\n\nThe last to understand, and the loudest about it.\n",
  "character--Other Sentient Beings.md":
    "# Other Sentient Beings\n\nKept from the assistant until the Part that needs them.\n",
  "character--Visitors.md": "# Visitors\n\nThey arrive in Ketsu.\n",
  "arc--Animals.md": "# Animals\n\nFrom unseen to seen.\n",
  "arc--Humans.md":
    "# Humans\n\nFrom the centre of the world to one centre among many.\n",
  "arc--Other Sentient Beings.md":
    "# Other Sentient Beings\n\nFrom rumour to neighbour.\n",
  "summary--EL1.md": "Ki opens on the dark and the first small lights.\n",
  "summary--EL5.md": "The dark, before anyone asks whose it is.\n",
  "summary--EL6.md":
    "The first acts of noticing spread, slower than revolutions.\n",
};
/** The shelf document kept from the assistant, with its closed eye. */
const KEPT = "reference:character--Other Sentient Beings.md";

/** Newest first, as the list shows them; `at` is the file's modified time. */
export const NOTES = [
  {
    file: "notes--Visitors arrive late.md",
    at: "2026-10-10T21:40:00.000Z",
    body: "# Visitors arrive late\n\nThe visitors arrive in Ketsu, never earlier. Nothing in the first three Parts should point at them.\n",
  },
  {
    file: "notes--The river bridge.md",
    at: "2026-10-09T10:12:00.000Z",
    body: "# The river bridge\n\nLumi lost the thread at the river. Check the bridge between “The Memory of Water” and “The Flame”.\n\nThe water carries the memory; the flame should take it from there, not start again.\n",
  },
  {
    file: "notes--Names of the animals.md",
    at: "2026-10-08T08:03:00.000Z",
    body: "# Names of the animals\n\nNone of the animals has a name until a human gives it one.\n",
  },
];

// ── The chat with Nova ───────────────────────────────────────────────────────

const MODEL = {
  providerId: "openrouter",
  modelId: "anthropic/claude-sonnet-5.5",
};
export const MODEL_ID = MODEL.modelId;

/**
 * An editorial chat (the only kind that keeps a revision plan), with one
 * finished exchange. The second question is asked live, so the search
 * waiting on the writer is the app's own.
 */
const CHAT = {
  schemaVersion: 1,
  id: CHAT_ID,
  title: "The turn in “The First Light”",
  kind: "editorial",
  createdAt: "2026-10-13T14:20:00.000Z",
  updatedAt: ANSWERED_AT,
  preferences: {
    personaId: "20",
    model: MODEL,
    // Near Standard, where the design draws the Mode's dot.
    mode: 0.9,
    pinnedSourceIds: [],
    targetNodeId: "EL6",
  },
  turns: [
    {
      id: "u1",
      role: "user",
      text: "Does the second paragraph earn the turn, or am I rushing it?",
      createdAt: "2026-10-13T14:29:30.000Z",
      outcome: "complete",
    },
    {
      id: "a1",
      role: "assistant",
      personaId: "20",
      text:
        "It earns it, but it arrives too fast. The child, the dog and the elephant come in three sentences of the same length, so none of them stays with the reader.\n\n" +
        "> A child feels joy no less than an old person. A dog hopes to return home.\n\n" +
        "In a kishōtenketsu the third movement usually slows down here.[web:1] One longer sentence for the child would be enough.",
      createdAt: ANSWERED_AT,
      outcome: "complete",
      model: MODEL,
      usage: {
        inputTokens: 1820,
        outputTokens: 320,
        totalTokens: 2140,
        steps: 2,
        // The window the answer filled, as the design reads it: 42% context.
        contextTokens: 84_000,
        contextWindow: 200_000,
      },
      elapsedMs: 14_000,
      sources: [
        {
          id: "node:EL6",
          kind: "manuscript",
          title: "The First Light",
          path: "document/section--the_first_light.EL6.02.md",
          nodeId: "EL6",
          nodeKind: "section",
          reason: "tool",
          coverage: "full-text",
          characters: 1200,
        },
      ],
      tools: [
        {
          callId: "c1",
          name: "read_source",
          status: "ok",
          sourceId: "node:EL6",
        },
        { callId: "c2", name: "web_search", status: "ok" },
      ],
      trace: { steps: [{ toolCallIds: ["c1", "c2"] }] },
      web: [
        {
          callId: "c2",
          engine: { kind: "provider", providerId: "openrouter" },
          status: "searched",
          query: "kishōtenketsu third act pacing",
          results: [
            {
              id: "web:1",
              url: "https://en.wikipedia.org/wiki/Kish%C5%8Dtenketsu",
              title: "Kishōtenketsu",
            },
          ],
        },
      ],
    },
  ],
  plan: {
    items: [
      {
        id: "p1",
        priority: "must",
        text: "Slow the turn in “The First Light”: let the child have a sentence of its own.",
        state: "open",
        turnId: "a1",
      },
      {
        id: "p2",
        priority: "should",
        text: "Vary the three sentences about the animals. They fall in the same rhythm.",
        state: "open",
        turnId: "a1",
      },
      {
        id: "p3",
        priority: "could",
        text: "Check the elephant line against the notes.",
        state: "done",
        turnId: "a1",
        check: {
          verdict: "resolved",
          note: "it matches the note on the elephants.",
          turnId: "a1",
        },
      },
    ],
  },
};

/** The question asked live, and the search the stub proposes for it. */
export const LIVE_QUESTION = "How do other novels pace a turn like this?";
export const LIVE_QUERY = "kishōtenketsu pacing, “The First Light”";

// ── The folder ───────────────────────────────────────────────────────────────

const STRUCTURE_HEADER = "# Phospheare — document structure";

function partFile(p: PartSeed) {
  return `part--${p.slug}.${p.id}.00.md`;
}
function sectionFile(s: SectionSeed, n = "00") {
  return `section--${s.slug}.${s.id}.${n}.md`;
}
function adoptedOf(s: SectionSeed) {
  return s.id === "EL6" ? sectionFile(s, ADOPTED_FIRST_LIGHT) : sectionFile(s);
}

function structureYaml(): string {
  const lines = [STRUCTURE_HEADER, "version: 1", "document:"];
  for (const p of PARTS) {
    lines.push(
      `  - id: ${p.id}`,
      `    part: "${p.title}"`,
      `    adopted: ${partFile(p)}`,
    );
    if (p.children.length) {
      lines.push("    children:");
      for (const s of p.children)
        lines.push(
          `      - id: ${s.id}`,
          `        section: "${s.title}"`,
          `        adopted: ${adoptedOf(s)}`,
        );
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The properties file and the snapshot catalogue, built from one walk. */
function metadata(): { properties: string; catalogue: string } {
  const snapshots: Record<
    string,
    { file: string; title: string; created: string }[]
  > = {};
  const perNode: {
    nodeId: string;
    words: number;
    updatedAt?: string;
    lastDelta?: number;
  }[] = [];
  const stat = (n: SectionSeed) => {
    const w = WRITTEN[n.id];
    perNode.push({
      nodeId: n.id,
      words: n.words,
      ...(w ? { updatedAt: w.at } : {}),
      ...(w?.delta !== undefined ? { lastDelta: w.delta } : {}),
    });
  };
  for (const p of PARTS) {
    snapshots[p.id] = [
      {
        file: partFile(p),
        title: `${p.title} 1`,
        created: "2026-01-01T00:00:00.000Z",
      },
    ];
    stat(p);
    for (const s of p.children) {
      snapshots[s.id] =
        s.id === "EL6"
          ? FIRST_LIGHT_SNAPSHOTS.map((x) => ({
              file: sectionFile(s, x.n),
              title: x.title,
              created: x.created,
            }))
          : [
              {
                file: sectionFile(s),
                title: `${s.title} 1`,
                created: "2026-01-01T00:00:00.000Z",
              },
            ];
      stat(s);
    }
  }
  const sum = perNode.reduce((n, e) => n + e.words, 0);
  if (sum !== TOTAL_WORDS)
    throw new Error(`fixture words ${sum}, not ${TOTAL_WORDS}`);
  const properties = JSON.stringify({
    schemaVersion: 1,
    document: {
      id: BOOK_ID,
      title: "Once Dark",
      author: "",
      type: "Novel",
      structure: "kishotenketsu",
      language: "en",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: COUNTED_AT,
      goal: GOAL,
      genres: ["literary"],
      ageCategory: null,
      tropes: [],
    },
    sync: null,
    ui: {
      expanded: ["EL1", "EL3"],
      lastOpened: "EL6",
      session: { startedAt: SESSION_START, words: TOTAL_WORDS - 152 },
      // The preferences card as drawn: a smooth caret, autosave every 30 sec.
      smoothCaret: true,
      autosave: true,
      autosaveDelay: 30,
    },
    stats: {
      words: TOTAL_WORDS,
      parts: 4,
      sections: 6,
      countedAt: COUNTED_AT,
      perNode,
    },
    summaries: {
      EL1: "summary--EL1.md",
      EL5: "summary--EL5.md",
      EL6: "summary--EL6.md",
    },
  });
  const catalogue = JSON.stringify({ snapshots, binned: {} });
  return { properties, catalogue };
}

/** Every file of the book, by its path inside the book's folder. */
export function bookFiles(text: FirstLightText): Record<string, string> {
  const { properties, catalogue } = metadata();
  const files: Record<string, string> = {
    "document-properties.json": properties,
    "snapshots-catalogue.json": catalogue,
    "document-structure.yaml": structureYaml(),
    "comments/EL6.json": JSON.stringify(COMMENTS_EL6),
    [`assistant/chat--${CHAT_ID}.json`]: JSON.stringify(CHAT),
    "assistant/barred-sources.json": `${JSON.stringify({ sourceIds: [KEPT] }, null, 2)}\n`,
  };
  for (const p of PARTS) {
    files[`document/${partFile(p)}`] = OTHER_TEXT[p.id]
      ? `${OTHER_TEXT[p.id]}\n`
      : "";
    for (const s of p.children) {
      if (s.id !== "EL6") {
        files[`document/${sectionFile(s)}`] = `${OTHER_TEXT[s.id]}\n`;
        continue;
      }
      for (const x of FIRST_LIGHT_SNAPSHOTS)
        files[`document/${sectionFile(s, x.n)}`] = x.body ?? firstLight(text);
    }
  }
  for (const [name, body] of Object.entries(REFERENCE))
    files[`reference/${name}`] = body;
  for (const note of NOTES) files[`reference/${note.file}`] = note.body;
  return files;
}

/** The notes' modified times, which a seed written now cannot carry. */
export function noteTimes(): Record<string, number> {
  return Object.fromEntries(NOTES.map((n) => [n.file, Date.parse(n.at)]));
}
