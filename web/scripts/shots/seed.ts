// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MODEL_ID, P3 } from "../../e2e/fixtures/vision/onceDark";

// ── What the landing's pictures show that the e2e book does not ──────────────
//
// Written over the e2e fixture's "Once Dark" through `openVisionProject`'s
// `extra`, so the fixture the e2e specs pin stays as it is. Each piece is a
// thing the landing page shows a writer: a character sheet filled in from the
// app's own template, the rules of the world, a margin thread a persona
// answered, and the editorial letter with its revision plan.

const TEMPLATES = fileURLToPath(
  new URL("../../src/editor/reference/md-templates/en/", import.meta.url),
);

/**
 * The template with its fields answered. Each answer lands on the empty
 * bullet under its field, after the hint, as a writer fills it in the Dock.
 */
function filled(file: string, title: string, answers: Record<string, string>) {
  let text = readFileSync(TEMPLATES + file, "utf8").replace("{{title}}", title);
  for (const [field, answer] of Object.entries(answers)) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(- \\*\\*${escaped}[:?]\\*\\*\\n\\s*<!--[\\s\\S]*?-->\\n\\s*- )`,
    );
    if (!pattern.test(text)) throw new Error(`${file}: no field "${field}"`);
    text = text.replace(pattern, `$1${answer}`);
  }
  return text;
}

const MIRA = filled("character.md", "Mirai", {
  "Names and nicknames": "Mirai; “the girl from the well” to the town",
  "Age and date of birth": "Nine at the start of Shō",
  "Role in the story":
    "The first human to ask why the old dog has no name. Through her the town learns to look.",
  "Everyday life":
    "Fetches water before school, feeds whatever waits by the well.",
  "The deep wound — the ghost":
    "Her mother left without a word; nobody explained, so she stopped asking adults anything.",
  "The belief born from the wound":
    "If no one answers, the question was wrong. (provisional)",
  "The conscious desire — the goal": "To find out who the dog belongs to.",
  "The unconscious need":
    "To be answered: to learn that a question can change the people who hear it.",
  Fears: "Being the only one who notices.",
  "Under pressure":
    "Goes silent and keeps watching; acts only when she is sure no one else will.",
});

const RULES = filled("world/rules.md", "Rules of the world", {
  "What is possible":
    "Only what our world allows. The change is in how people see, never in what they can do.",
  "What is impossible":
    "No animal speaks; no one hears thoughts. Understanding arrives through attention alone.",
  "Costs and limitations":
    "Every act of noticing costs someone a comfort: a habit, a meal, an excuse.",
  "What must remain consistent":
    "The animals have no names until a human gives them one.",
  "Fundamental rules":
    "Nothing is solved by a speech. The light spreads from one person to the next.",
});

/**
 * The Guidebook pages an editorial chat works from, each begun, so the chat
 * has what it reads and asks for nothing.
 */
const GUIDEBOOK: Record<string, string> = {
  "editing-brief": filled("guidebook/editing-brief.md", "Editing brief", {
    "The state of the manuscript": "A complete first draft, revised once.",
    "What you would like help with":
      "Whether the turn in Ten lands, and whether the humans come alive early enough.",
    "What you want to preserve": "The quiet voice; the animals never speak.",
  }),
  "at-a-glance": filled("guidebook/at-a-glance.md", "Story at a glance", {
    Genre: "Literary fable",
    "Intended readers": "Adult readers of quiet, idea-led fiction.",
    "Tone and atmosphere": "Hushed, patient, warm at the edges.",
  }),
  "prose-style": filled("guidebook/prose-style.md", "Prose style", {
    "Narrative voice":
      "A collective narrator remembering, never inside one head for long.",
    "Rhythm and prose construction":
      "Short declaratives that open into one long sentence per paragraph.",
    "Deliberate departures from convention":
      "No dialogue tags; almost no dialogue.",
  }),
  promise: filled("guidebook/promise.md", "The reader's experience", {
    "What kind of experience should this story give the reader":
      "The feeling of a light coming on slowly in a room you thought you knew.",
    "What you hope will stay with the reader":
      "That attention is a kind of love.",
  }),
  theme: filled("guidebook/theme.md", "Themes and questions", {
    "Central theme": "Every life is lived from its own centre.",
    "Recurring motifs": "Small lights; water; names given and withheld.",
  }),
  series: filled("guidebook/series.md", "Series plans", {
    "The current project": "A standalone novel.",
  }),
};

/**
 * Two threads where the writer tagged a persona and it answered. The page
 * shows only the app's own personas, so no reviewer here is made up.
 */
const COMMENTS_EL6 = {
  threads: [
    {
      id: "t-phos",
      state: "open",
      anchor: {
        quote:
          "Every sentient being experiences the world from its own center.",
        prefix: "people began to understand something simple. ",
        suffix: " A child feels joy no less than an",
      },
      entries: [
        {
          id: "e-ask-phos",
          author: { kind: "writer" },
          at: "2026-10-12T17:20:00.000Z",
          body: "@Phos is this the turn of the whole Part?",
        },
        {
          id: "e-phos",
          author: { kind: "persona", id: "10" },
          at: "2026-10-12T17:21:00.000Z",
          body: "It is. Slow it down: give the change a scene.",
        },
      ],
    },
    {
      id: "t-spark",
      state: "open",
      anchor: { quote: P3, prefix: "", suffix: "" },
      entries: [
        {
          id: "e-ask",
          author: { kind: "writer" },
          at: "2026-10-13T14:10:00.000Z",
          body: "@Spark is this line earning the end of Ki, or just announcing it?",
        },
        {
          id: "e-spark",
          author: { kind: "persona", id: "30" },
          at: "2026-10-13T14:11:00.000Z",
          body:
            "It's announcing it, and you're one image away from earning it! " +
            "Right now the line tells us the awareness spread. Show one person " +
            "it spread to, just one, and the end of Ki lands on its own. " +
            "Try the baker who starts leaving water out for the dog.",
        },
      ],
    },
  ],
  dismissed: [],
};

const LETTER_ID = "8c2f6a10-3b7e-4d95-a6c1-52e9d0b7f318";
const MODEL = { providerId: "openrouter", modelId: MODEL_ID };

const LETTER_TEXT = [
  "Respectfully, here is my letter on *Once Dark* as it stands.",
  "**What the book is.** A literary fable in four movements, told in the kishōtenketsu manner: a world that learns, slowly, that every life is lived from its own centre. It promises the reader not a plot but a change of sight, and the first two Parts keep that promise with real restraint.",
  "**What works.** First, the voice. Sentences such as “slower than any revolution, but deeper than any empire” carry the theme without explaining it. Second, the animals: they are never symbols, exactly as your Guidebook asks. Finally, the structure itself: Ten turns where it should.",
  "**What does not yet work.** First, “The First Light” announces its change instead of showing it: the paragraph that closes Ki tells us the awareness spread, but no single person is seen to change. Second, the humans have no face until Shō; Mirai arrives late for the reader to follow her. Finally, “The Memory of Water” and “The Flame” do not hand the image of water to the image of fire; a reader may feel the book starting again.",
].join("\n\n");

const LETTER_CHAT = {
  schemaVersion: 1,
  id: LETTER_ID,
  title: "Editorial letter",
  kind: "editorial",
  createdAt: "2026-10-13T14:24:00.000Z",
  updatedAt: "2026-10-13T14:31:00.000Z",
  preferences: {
    personaId: "10",
    model: MODEL,
    mode: 0.9,
    pinnedSourceIds: [],
  },
  turns: [
    {
      id: "u1",
      role: "user",
      text: "/letter",
      createdAt: "2026-10-13T14:24:00.000Z",
      outcome: "complete",
    },
    {
      id: "a1",
      role: "assistant",
      personaId: "10",
      text: LETTER_TEXT,
      createdAt: "2026-10-13T14:31:00.000Z",
      outcome: "complete",
      model: MODEL,
      usage: {
        inputTokens: 41_200,
        outputTokens: 1_480,
        totalTokens: 42_680,
        steps: 4,
        contextTokens: 64_000,
        contextWindow: 200_000,
      },
      elapsedMs: 52_000,
    },
  ],
  plan: {
    items: [
      {
        id: "p1",
        priority: "must",
        text: "In “The First Light”, show one person changed by the light, instead of saying it spread.",
        state: "open",
        turnId: "a1",
      },
      {
        id: "p2",
        priority: "must",
        text: "Bring Mirai into Ki, even for a page, so the reader has a human to follow into Shō.",
        state: "open",
        turnId: "a1",
      },
      {
        id: "p3",
        priority: "should",
        text: "Let “The Flame” open on the water “The Memory of Water” ends with, so the image is handed on.",
        state: "open",
        turnId: "a1",
      },
      {
        id: "p4",
        priority: "could",
        text: "Vary the three sentences about the animals in “The First Light”: they fall in one rhythm.",
        state: "done",
        turnId: "a1",
      },
    ],
  },
};

/**
 * "First pass", reworded through the whole Section, so the compare view has
 * words to weigh, not paragraphs to drop.
 */
const FIRST_PASS = [
  "{align:center}# The First Light",
  "Small acts, yes. Little sparks that nobody saw. But every one of them lit a flame. And the light only grew when it was shared.",
  "In time, people came to understand something simple. Every sentient being lives the world from its own center. A child feels joy no less than an old man. A dog hopes to come home. An elephant grieves for its dead.",
  "This awareness spread slowly, slower than a revolution, but deeper than an empire.",
  "No law ordered it. No prophet carried it from town to town. It moved the way warmth moves through a house, from one body to another, until nobody could say where it had started.",
  "Children were the first to speak of it. They asked why the fish in the market had no names, and why the old dog on the corner was fed only when someone remembered.",
  "So the answers changed. Slowly, and then all at once, the way a coastline changes.",
].join("\n\n");

/** Every file the landing's pictures add to the book. */
export const LANDING_EXTRA: Record<string, string> = {
  "reference/character--Mirai.md": MIRA,
  "reference/world--rules.md": RULES,
  "comments/EL6.json": JSON.stringify(COMMENTS_EL6),
  [`assistant/chat--${LETTER_ID}.json`]: JSON.stringify(LETTER_CHAT),
  "document/section--the_first_light.EL6.01.md": `${FIRST_PASS}\n`,
  // Summaries as the assistant writes them: the Section's events in order,
  // and the Part's drawn from its Sections'.
  "reference/summary--EL6.md":
    "Small acts of noticing begin to spread: no law and no prophet, only warmth passed from one body to the next. Children are the first to ask out loud why the fish have no names and the old dog is fed only when someone remembers, and the adults' answers start to sound like excuses. The change comes slowly, then all at once, like a shoreline, and those who felt the first spark know it as a light that was always there.\n",
  "reference/summary--EL1.md":
    "Ki opens on a dark nobody questions, then follows the first small lights: people begin to see that every creature lives from its own centre, and the awareness spreads, slower than any revolution, deeper than any empire.\n",
  ...Object.fromEntries(
    Object.entries(GUIDEBOOK).map(([id, text]) => [
      `reference/guidebook--${id}.md`,
      text,
    ]),
  ),
};

/** Sample editorial text rendered by the real chat, without a model request. */
export const CONTINUITY_EXTRA: Record<string, string> = {
  [`assistant/chat--${LETTER_ID}.json`]: JSON.stringify({
    ...LETTER_CHAT,
    title: "Continuity check",
    plan: undefined,
    turns: [
      { ...LETTER_CHAT.turns[0], text: "/continuity Mirai" },
      {
        ...LETTER_CHAT.turns[1],
        text: "**Mirai and the river**\n\nHer character sheet says she cannot swim. In chapter 30, she dives in and swims to the other bank.\n\nHas she learned during the story? If so, a passage establishing that change would help the reader follow it.",
      },
    ],
  }),
};
