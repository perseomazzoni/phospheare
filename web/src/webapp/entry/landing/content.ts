// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { IconName } from "../../../ui/icons";
import type { Pace } from "./Sequence";
import type { ShotId } from "./Shot";

// ── What the landing page says, and in what order ────────────────────────────
//
// The Parts and their cards, the screenshot each one shows and the demo
// that runs in it. The words are the locale files' (`landing.*`); this file
// holds only ids and pictures, so a card is moved or reworded in one
// place each.

export type DemoId = "keys" | "focus" | "compare" | "template" | "autosave";

export interface CardDef {
  /** Its copy at `landing.cards.<id>`. */
  id: string;
  shot?: ShotId;
  demo?: DemoId;
  /** Real screenshots of one action, step by step, shown in turn. */
  frames?: readonly ShotId[];
  /** How long each frame holds and fades in (`Sequence`). */
  pace?: readonly Pace[];
  /** Takes the whole row, its words beside its picture. */
  wide?: boolean;
  /** A target other parts of the page link to. */
  anchor?: string;
  /** Opens a group of cards under a title, at `landing.groups.<group>`. */
  group?: string;
  /** The side its picture takes; by default the sides alternate. */
  side?: "left" | "right";
  /** A card with no picture is marked by this glyph over its title. */
  icon?: IconName;
}

export interface PartDef {
  /** Its copy at `landing.parts.<id>`, and its anchor. */
  id: "write" | "organise" | "revise" | "help" | "keep";
  cards: readonly CardDef[];
  /**
   * The smaller features, at `landing.parts.<id>.more.<item>`. Every Part's
   * list stands in the one disclosure near the close.
   */
  more: readonly string[];
}

export const PARTS: Record<PartDef["id"], PartDef> = {
  write: {
    id: "write",
    cards: [
      { id: "keys", demo: "keys", wide: true },
      { id: "focus", demo: "focus", wide: true, group: "focus" },
      {
        id: "henosis",
        frames: [
          "henosis-1",
          "henosis-2",
          "henosis-3",
          "henosis-4",
          "henosis-5",
        ],
        // The controls in view, then the fade as one dissolve, then the page
        // alone, held; the way back is the app's wake.
        pace: [
          { hold: 1400, fade: 500 },
          { hold: 450, fade: 450 },
          { hold: 450, fade: 450 },
          { hold: 450, fade: 450 },
          { hold: 2400, fade: 300 },
        ],
        wide: true,
      },
    ],
    more: ["engine", "find", "goal"],
  },
  organise: {
    id: "organise",
    cards: [
      {
        id: "structure",
        frames: ["structure-1", "structure-2", "structure-3", "structure-4"],
        wide: true,
      },
      { id: "desk", shot: "desk" },
    ],
    more: ["rule", "move", "wizard"],
  },
  revise: {
    id: "revise",
    cards: [{ id: "compare", demo: "compare", wide: true }],
    more: ["history", "snapshots"],
  },
  help: {
    id: "help",
    cards: [
      {
        id: "ask",
        anchor: "ask",
        shot: "comments",
      },
      { id: "summaries", shot: "summaries" },
    ],
    more: [
      "kinds",
      "ledgers",
      "pages",
      "ghosts",
      "comments",
      "checks",
      "search",
      "models",
    ],
  },
  keep: {
    id: "keep",
    cards: [
      { id: "autosave", demo: "autosave", wide: true },
      { id: "sync", icon: "custody" },
      { id: "move", icon: "out" },
    ],
    more: ["local", "offline", "import", "export", "open"],
  },
};

/**
 * The editorial team in the order the app lists them, with every attitude
 * the app offers each one (`ai/domain/personas/*.md`, named at
 * `dock.preset.<id>`).
 */
export const PERSONAS = [
  {
    id: "phos",
    name: "Phos",
    presets: ["whole-book", "market", "sensitivity", "authenticity"],
  },
  { id: "nova", name: "Nova", presets: ["line", "dialogue", "continuity"] },
  {
    id: "spark",
    name: "Spark",
    presets: ["structure", "character", "worldbuilding"],
  },
  {
    id: "lumi",
    name: "Lumi",
    presets: ["friend", "binge", "skeptic", "heart", "genre-veteran"],
  },
] as const;

export type Persona = (typeof PERSONAS)[number];

/**
 * The persona dialog as a writer uses it, step by step: the pointer passes
 * Phos, Nova, Spark and Lumi, Spark is picked, then one of its approaches.
 */
export const PERSONA_FRAMES: readonly ShotId[] = [
  "personas-1",
  "personas-2",
  "personas-3",
  "personas-4",
  "personas-5",
];

/**
 * The 24 commands by the chats that offer them (each skill's `chats:`), the
 * way the "/" menu groups them. Each note is the app's own,
 * `dock.commandNote.<command>`.
 */
export const COMMANDS = [
  { chats: "shared", commands: ["where", "map", "verify", "how-to-say"] },
  { chats: "drafting", commands: ["unstick", "what-if", "scene-plan"] },
  {
    chats: "editorial",
    commands: [
      "unresolved",
      "continuity",
      "summarise",
      "canon",
      "structure-and-motivation",
      "line-editing",
      "sensitivity",
      "letter",
      "first-pages",
      "genre",
    ],
  },
  {
    chats: "beta-reader",
    commands: ["read-on", "predict", "put-down", "review", "blurb"],
  },
  { chats: "alpha-reader", commands: ["heart", "intent"] },
] as const;

/** The phone band's three screens. */
export const PHONES: readonly ShotId[] = [
  "phone",
  "phone-desk",
  "phone-library",
];

/** The project's source; the one address allowed to spell its working name. */
export const SOURCE_URL = "https://github.com/perseomazzoni/phospheare";

/**
 * How a writer gets the program: no release holds one, so the README's
 * steps build it from a release's source code.
 */
export const QUICKSTART_URL = `${SOURCE_URL}#quickstart-for-everyone`;

/**
 * Where a remote model is paid for. The copy never spells a vendor, and the
 * app learns the connected one only after sign-in, so the page that sells
 * the AI names the one it supports here, as `{{provider}}`.
 */
export const MODEL_PROVIDER = "OpenRouter";

/** The demo: the whole editor on a sample novel, with no account. */
export const DEMO_PATH = "/app/editor/demo";

/** The questions, at `landing.faq.<id>`. */
export const FAQ = [
  "demo",
  "files",
  "cost",
  "ai",
  "leave",
  "offline",
  "browsers",
  "host",
  "finished",
] as const;
