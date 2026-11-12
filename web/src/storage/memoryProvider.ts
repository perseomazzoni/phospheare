// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  ROOT_PATH,
  StorageError,
  baseName,
  joinPath,
  parentPath,
  type Access,
  type DirEntry,
  type FileFingerprint,
  type FileHint,
  type ProjectRef,
  type StorageProvider,
} from "./types";
import type { IconName } from "../ui/icons";
import { t } from "i18next";
import { sha256Hex } from "../text/hash";
import { DEMO_COMPARISON, DEMO_SAME_LINE } from "./demoFixtureAnchors";
import { STRUCTURE_HEADER } from "../project/structure";

// ── In-memory provider ───────────────────────────────────────────────────────
//
// A project that lives in a Map, seeded with a small novel. The File System
// Access API needs a native folder picker, which no automated check can
// drive, so this is how structural gestures in the panel get tested.
//
// Reached at `/app/editor/demo`. Nothing here touches the writer's disk, and
// a reload starts the fixture over.

const PROVIDER_ID = "memory";

const FIXTURE_STRUCTURE = `${STRUCTURE_HEADER}version: 1
document:
  - id: EL1
    part: "Ki — Void"
    adopted: part--ki_void.EL1.00.md
    children:
      - id: EL5
        section: "The Dark"
        adopted: section--the_dark.EL5.00.md
      - id: EL6
        section: "The First Light"
        adopted: section--the_first_light.EL6.01.md
  - id: EL2
    part: "Shō — The Spark"
    adopted: part--shō_the_spark.EL2.00.md
    children:
      - id: EL7
        section: "All Living Beings"
        adopted: section--all_living_beings.EL7.00.md
      - id: EL8
        section: "From Awareness Comes Responsibility"
        adopted: section--from_awareness_comes_responsibility.EL8.00.md
  - id: EL3
    part: "Ten — The Flame"
    adopted: part--ten_the_flame.EL3.00.md
    children:
      - id: EL9
        section: "The Memory of the Past"
        adopted: section--the_memory_of_the_past.EL9.00.md
      - id: EL10
        section: "The Flame"
        adopted: section--the_flame.EL10.00.md
  - id: EL4
    part: "Ketsu — Earthlings"
    adopted: part--ketsu_earthlings.EL4.00.md
    children:
      - id: EL11
        section: "Equal in Existence"
        adopted: section--equal_in_existence.EL11.01.md
      - id: EL12
        section: "Earthlings"
        adopted: section--earthlings.EL12.00.md
`;

// Every node's snapshot list, keyed by id, for the catalogue; the yaml above
// names only the adopted file. Where the fixture keeps the earlier draft as
// `.00` to compare against, the `.01` is adopted.
const FIXTURE_SNAPSHOTS = {
  EL1: [
    {
      file: "part--ki_void.EL1.00.md",
      title: "Ki — Void 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
  EL2: [
    {
      file: "part--shō_the_spark.EL2.00.md",
      title: "Shō — The Spark 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
  EL3: [
    {
      file: "part--ten_the_flame.EL3.00.md",
      title: "Ten — The Flame 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
  EL4: [
    {
      file: "part--ketsu_earthlings.EL4.00.md",
      title: "Ketsu — Earthlings 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
  EL5: [
    {
      file: "section--the_dark.EL5.00.md",
      title: "The Dark 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
  EL6: [
    {
      file: "section--the_first_light.EL6.00.md",
      title: DEMO_COMPARISON.earlierRow,
      created: "2026-08-14T09:12:00.000Z",
    },
    {
      file: "section--the_first_light.EL6.01.md",
      title: DEMO_COMPARISON.adoptedRow,
      created: "2026-08-15T08:00:00.000Z",
    },
  ],
  EL7: [
    {
      file: "section--all_living_beings.EL7.00.md",
      title: "All Living Beings 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
  EL8: [
    {
      file: "section--from_awareness_comes_responsibility.EL8.00.md",
      title: "From Awareness Comes Responsibility 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
  EL9: [
    {
      file: "section--the_memory_of_the_past.EL9.00.md",
      title: "The Memory of the Past 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
  EL10: [
    {
      file: "section--the_flame.EL10.00.md",
      title: "The Flame 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
  EL11: [
    {
      file: "section--equal_in_existence.EL11.00.md",
      title: DEMO_SAME_LINE.earlierRow,
      created: "2026-08-14T09:12:00.000Z",
    },
    {
      file: "section--equal_in_existence.EL11.01.md",
      title: DEMO_SAME_LINE.adoptedRow,
      created: "2026-08-15T08:00:00.000Z",
    },
  ],
  EL12: [
    {
      file: "section--earthlings.EL12.00.md",
      title: "Earthlings 1",
      created: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const FIXTURE_SUMMARIES = {
  EL1: "summary--EL1.md",
  EL5: "summary--EL5.md",
  EL7: "summary--EL7.md",
};

const FIXTURE_PROPERTIES = JSON.stringify(
  {
    schemaVersion: 1,
    document: {
      title: "Once Dark",
      type: "novel",
      language: "en",
      structure: "kishotenketsu",
      // The demo Desk draws the goal-anchored shape like every real project:
      // about 970 words against 1200 keeps the bars mostly full with
      // a visible hatched remainder.
      goal: 1200,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    ui: {
      expanded: ["EL1", "EL3"],
      lastOpened: "EL6",
    },
    summaries: FIXTURE_SUMMARIES,
  },
  null,
  2,
);

const FIXTURE_CATALOGUE = JSON.stringify(
  { snapshots: FIXTURE_SNAPSHOTS, binned: {} },
  null,
  2,
);

// ── The drafts the snapshot checks compare ───────────────────────────────────
//
// Both pairs are built from `demoFixtureAnchors.ts`, not written out twice, so
// the story and the checks cannot drift apart.

/**
 * The First Light's opening paragraph. The drafts differ by one word, the
 * hunk the accept checks apply. The earlier draft has no adopted-only
 * paragraphs, so those read as block deletes in the comparison.
 */
const firstLightOpening = (word: string) =>
  `Small acts, yes. Tiny sparks that no one ${word}. But each one kindled a flame. ` +
  `And that light grew brighter only when it was shared.`;

/**
 * The paragraph both drafts carry after the opening. Without it the opening
 * would be the earlier draft's last paragraph, and comparing a file-final
 * paragraph leaves a whitespace-only ghost hunk after an accept.
 * Keeping it means the accept checks pin their own claim, not that defect.
 */
const firstLightMiddle =
  "Over time, people began to understand something simple. Every sentient being " +
  "experiences the world from its own center. A child feels joy no less than an " +
  "old person. A dog hopes to return home. An elephant mourns its dead. A whale " +
  "protects its young. A bird struggles to survive another winter. A pig, a cow, " +
  "a chicken, they only want to go on living. Each one holds its own life from " +
  "within.";

/**
 * Equal in Existence, whose two drafts differ by two words on the closing
 * line with a kept word between them: two hunks by word, one by paragraph.
 */
const equalInExistence = (closing: string) =>
  "{align:center}# Equal in Existence\n\n\n\n\n\nAnd so the old saying is remembered: once there was dark. Now there is light upon " +
  "the Earth. In that light, we see one another, all sentient beings, as equals, " +
  "deserving of respect, care, help, and the freedom to live without unnecessary " +
  `pain.\n\n${closing}\n`;

/**
 * Path to contents. Folders are implied by the paths of the files inside.
 *
 * Exported for `demoFixtureAnchors.test.ts`, which must assert against the
 * bytes the demo seeds, not a copy, or it would pass while the fixture
 * drifted.
 */
export function seed(): Map<string, string> {
  return new Map([
    ["/document-properties.json", `${FIXTURE_PROPERTIES}\n`],
    ["/snapshots-catalogue.json", `${FIXTURE_CATALOGUE}\n`],
    ["/document-structure.yaml", FIXTURE_STRUCTURE],
    [
      "/document/part--ki_void.EL1.00.md",
      "{align:center}# Ki — Void\n\n\n\n{align:center}## Void\n\n",
    ],
    [
      "/document/part--shō_the_spark.EL2.00.md",
      "{align:center}# Shō — The Spark\n\n\n\n{align:center}## The Spark\n\n",
    ],
    [
      "/document/part--ten_the_flame.EL3.00.md",
      "{align:center}# Ten — The Flame\n\n\n\n{align:center}## The Flame\n\n",
    ],
    [
      "/document/part--ketsu_earthlings.EL4.00.md",
      "{align:center}# Ketsu — Earthlings\n\n\n\n{align:center}## Earthlings\n\n",
    ],
    [
      "/document/section--the_dark.EL5.00.md",
      "{align:center}# The Dark\n\n\n\n\n\nOnce there was dark. Not the darkness of night, but another kind of darkness: " +
        "the darkness of believing that we were alone, that every living creature was " +
        "an adversary or a threat.\n\n" +
        "Slowly, a light began to shine. It did not fall from the sky, nor did we find " +
        "it in some secret book. It was born every time one being recognised another. " +
        "A little girl saving a tired bird, a doctor staying an extra hour beside a " +
        "frightened patient, a farmer planting trees beneath which they would never sit, " +
        "a scientist sharing knowledge instead of chasing fame, a stranger forgiving " +
        "another stranger.\n",
    ],
    // The adopted snapshot is the `.01`; the `.00` holds the chapter's
    // earlier draft, so the snapshot table has a second row to compare.
    [
      "/document/section--the_first_light.EL6.00.md",
      "{align:center}# The First Light\n\n\n\n\n\n" +
        `${firstLightOpening(DEMO_COMPARISON.earlierWord)}\n\n` +
        `${firstLightMiddle}\n`,
    ],
    [
      "/document/section--the_first_light.EL6.01.md",
      "{align:center}# The First Light\n\n\n\n\n\n" +
        `${firstLightOpening(DEMO_COMPARISON.adoptedWord)}\n\n` +
        `${firstLightMiddle}\n\n` +
        "This awareness spread slowly, slower than any revolution, but deeper than " +
        "any empire.\n",
    ],
    [
      "/document/section--all_living_beings.EL7.00.md",
      "{align:center}# All Living Beings\n\n\n\n\n\nPeople began to understand that intelligence does not grant permission to dominate. " +
        "Rather, it gives us a responsibility. The strongest became guardians instead of " +
        "masters.\n\n" +
        "And slowly, almost without anyone being able to point to the precise moment when " +
        "it had begun, the world began to move. Cities changed. Schools taught empathy " +
        "alongside mathematics. Hospitals treated loneliness with the same seriousness " +
        "with which they treated illness. Technologies were judged not only by profit, " +
        "but by how much suffering they could truly alleviate. Governments measured progress " +
        "not only in wealth, but also in the well-being of humans, animals, and the " +
        "living world that sustained them.\n\n" +
        "It was no longer simply a question of what human beings could do. It had become " +
        "a question of what, knowing they could do it, they chose to do.\n",
    ],
    [
      "/document/section--from_awareness_comes_responsibility.EL8.00.md",
      "{align:center}# From Awareness Comes Responsibility\n\n\n\n\n\nChildren now find all of this completely normal. When they study history, they ask " +
        'in astonishment: "Was there really a time when people thought some lives were ' +
        "worth more than others? That language, colour, or species made us more different " +
        'than our shared capacity to suffer and to hope?"\n\n' +
        'The teachers sigh and answer: "Many believed so."\n',
    ],
    [
      "/document/section--the_memory_of_the_past.EL9.00.md",
      "{align:center}# The Memory of the Past\n\n\n\n\n\nThe Earth itself slowly recovered. Forests returned where deserts had once been. " +
        "Rivers ran clearer. Cities grew quieter.\n\n" +
        "Not because humanity was perfect. They still made mistakes, argued, suffered. " +
        "But they had accepted a simple principle: every sentient being is equal in the " +
        "experience of existence. No consciousness stands above another. Every life is " +
        "the only life that particular mind will ever know.\n\n" +
        "From this idea came respect. From respect, care. And from care, freedom from " +
        "unnecessary suffering.\n",
    ],
    [
      "/document/section--the_flame.EL10.00.md",
      "{align:center}# The Flame\n\n\n\n\n\nTravelers from beyond the stars do not see a magical halo around the planet. But " +
        "those who land feel a difference: people look at other people differently, not as " +
        "competitors in an endless race, not as strangers divided by invisible lines, but " +
        "as fellow beings of Earth, each with their own precious perspective.\n\n" +
        "And when someone forgets all this, they are not met with hatred, but with " +
        "patience, justice, a compassion strong enough to protect the vulnerable without " +
        "ceasing to recognize the humanity of the one who has done harm.\n\n" +
        "Because light is never the absence of conflict, but the choice to face it " +
        "without losing sight of the dignity of the other.\n",
    ],
    // The same chapter twice, differing only in its closing line: the `.00`
    // is the earlier draft, the `.01` is adopted. Two words apart with one
    // kept word between them, the shape the granularity lens is pinned
    // against.
    [
      "/document/section--equal_in_existence.EL11.00.md",
      equalInExistence(DEMO_SAME_LINE.earlierLine),
    ],
    [
      "/document/section--equal_in_existence.EL11.01.md",
      equalInExistence(DEMO_SAME_LINE.adoptedLine),
    ],
    [
      "/document/section--earthlings.EL12.00.md",
      "{align:center}# Earthlings\n\n\n\n\n\nMany millennia later, in a school at the edge of the forest, a little girl, now " +
        "an old woman, tells a story to her grandchildren.\n\n" +
        '"Once there was dark," she says.\n\n' +
        "The children listen.\n\n" +
        '"Not the darkness of night," she continues. "The darkness of when we thought ' +
        'we were alone."\n\n' +
        "Outside the window, a bird settles on a branch. Farther away, among the trees, " +
        "the call of an animal can be heard.\n\n" +
        "The old woman smiles.\n\n" +
        '"Then came the light."\n\n' +
        'One of the children asks her, "Where did it come from?"\n\n' +
        "She looks outside.\n\n" +
        '"From us."\n\n' +
        "The child remains silent.\n\n" +
        '"And now?"\n\n' +
        "The old woman looks at the forest.\n\n" +
        '"Now we can see each other."\n\n' +
        "Not only human beings. All the others. All the sentient beings of the planet. " +
        "As equals. As companions. As creatures who need respect, care, and help. As " +
        "beings who deserve to live free, as much as possible, from the pain we can " +
        "prevent.\n\n" +
        "The Earth has not become perfect. It has become aware.\n\n" +
        "To be Earthlings.\n\n" +
        "Not the masters of the Earth. Not the most important species. But one of the " +
        "many forms through which the Earth has always sought to look upon itself.\n\n" +
        "And in the light, at last, we can see one another. All the others. And no one " +
        "is completely alone anymore.\n\n\n\n{align:center}## The End\n\n",
    ],

    // The open half: reference, assistant, guidebook. Without it the
    // reference shelf and the assistant dock could only be checked against an
    // empty folder, the state that proves least.
    [
      // Catalogue ids, not free stems: the compiled spaces draw only sections
      // the catalogue names, and a `guidebook--once-dark.md` would sit
      // on disk undrawn.
      "/reference/guidebook--logline.md",
      "# Once Dark\n\nFrom void to light — the story of how every sentient being on Earth " +
        "learned to see the other.\n",
    ],
    [
      "/reference/character--humans.md",
      "# Humans\n\nThe species that first believed it was alone. Guardians, not masters. " +
        "The girl who saved a bird, the doctor who stayed an hour, the farmer who planted " +
        "trees, the teacher who answered the children's questions.\n",
    ],
    [
      "/reference/character--visitors.md",
      "# Visitors\n\nTravelers from beyond the stars. They do not see a magical halo, but " +
        "they feel a difference — people who look at each other as fellow beings, not " +
        "competitors.\n",
    ],
    [
      "/reference/character--animals.md",
      "# Animals\n\nThe dog that hopes to return home. The elephant that mourns its dead. " +
        "The whale that protects its young. The bird that struggles through another winter. " +
        "The pig, the cow, the chicken — each one holds its own life from within.\n",
    ],
    [
      "/reference/character--other-sentient-beings.md",
      "# Other Sentient Beings\n\nEvery creature that experiences the world from its own " +
        "center. Equal in the experience of existence. No consciousness stands above " +
        "another.\n",
    ],
    [
      // `timeline`, not `earth-recovery`: as with the guidebook, the world
      // space draws only sections the catalogue names.
      "/reference/world--timeline.md",
      "# Earth Recovery\n\nForests returned where deserts had once been. Rivers ran clearer. " +
        "Cities grew quieter. Schools taught empathy alongside mathematics. Hospitals treated " +
        "loneliness. Technologies were judged by how much suffering they could alleviate.\n",
    ],
    // Summaries bind to node ids, which stay stable across renames.
    [
      "/reference/summary--EL1.md",
      "From darkness to light — the first spark of recognition between beings.\n",
    ],
    [
      "/reference/summary--EL5.md",
      "The dark of believing we were alone. A little girl saves a bird. A doctor stays " +
        "an hour. A farmer plants trees.\n",
    ],
    [
      "/reference/summary--EL7.md",
      "Intelligence gives responsibility, not permission to dominate. The strongest " +
        "became guardians.\n",
    ],
    [
      "/reference/notes--earthlings.md",
      "# Earthlings\n\nNot the masters of the Earth. Not the most important species. But " +
        "one of the many forms through which the Earth has always sought to look upon " +
        "itself.\n",
    ],
    // Unprefixed: a file that declares no group stays on disk, untouched and
    // never drawn, because the panel skips rather than refuses.
    // `reference/` is the open half and stays open.
    ["/reference/scrap.md", "The light is never the absence of conflict.\n"],

    // Not chats, so they sit in the assistant's memory: only chats
    // live at the top of `assistant/`.
    [
      "/assistant/memory/persona--the-editor.md",
      "# The Editor\n\nReads for what the sentence is doing, not for what it says.\n",
    ],
    [
      "/assistant/memory/rules--house-style.md",
      "# House style\n\nEm dashes, not parentheses. British spelling.\n",
    ],
    [
      "/assistant/memory/skill--continuity-check.md",
      "# Continuity check\n\nNames, weather, and what time it is.\n",
    ],
    [
      "/assistant/memory/memory.md",
      "# What I know about this project\n\nThe ferry is never on time. That is deliberate.\n",
    ],
  ]);
}

const files = seed();

/** File timestamps: `created` on first write, `updatedAt` on overwrite. */
const fileMeta = new Map<string, { created: string; updatedAt?: string }>();
for (const path of files.keys()) {
  if (path.startsWith("/reference/")) {
    fileMeta.set(path, { created: "2026-01-01T00:00:00.000Z" });
  }
}

/** Folders exist implicitly, except the ones created empty. */
const emptyDirs = new Set<string>();

/**
 * Binary files (exports), kept apart from `files`, which holds text: a binary
 * read as text would be garbage, and nothing reads an export back. They are
 * listed and they exist, which is all an export needs.
 */
const binaries = new Map<string, Uint8Array>();

function requireFile(path: string): string {
  const content = files.get(path);
  if (content === undefined)
    throw new StorageError(
      `File not found: ${path}`,
      "not-found",
      "storage.fileGone",
      { name: baseName(path) },
    );
  return content;
}

export const memoryProvider: StorageProvider = {
  id: PROVIDER_ID,
  kind: "device",
  label: () => t("storage.demoLabel"),
  icon: "mark" as IconName,

  isAvailable: () => true,

  async reopenProject(): Promise<boolean> {
    return true;
  },

  async canAccess(): Promise<Access> {
    return "granted";
  },

  async listDir(_ref: ProjectRef, path: string): Promise<DirEntry[]> {
    const prefix = path === ROOT_PATH ? ROOT_PATH : `${path}/`;
    const seen = new Map<string, DirEntry>();

    for (const filePath of [...files.keys(), ...binaries.keys()]) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      if (rest.length === 0) continue;
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      seen.set(name, {
        path: joinPath(path, name),
        name,
        kind: slash === -1 ? "file" : "folder",
      });
    }

    for (const dir of emptyDirs) {
      if (parentPath(dir) === path) {
        const name = baseName(dir);
        if (!seen.has(name))
          seen.set(name, { path: dir, name, kind: "folder" });
      }
    }

    // A folder nobody has put anything in and nobody created is not there.
    if (seen.size === 0 && path !== ROOT_PATH && !emptyDirs.has(path)) {
      throw new StorageError(
        `Folder not found: ${path}`,
        "not-found",
        "storage.folderGone",
        { name: baseName(path) },
      );
    }
    return [...seen.values()];
  },

  async exists(_ref: ProjectRef, path: string): Promise<boolean> {
    if (files.has(path) || binaries.has(path) || emptyDirs.has(path))
      return true;
    return [...files.keys(), ...binaries.keys()].some((f) =>
      f.startsWith(`${path}/`),
    );
  },

  async readFile(_ref: ProjectRef, path: string): Promise<string> {
    return requireFile(path);
  },

  async writeFile(
    _ref: ProjectRef,
    path: string,
    content: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = fileMeta.get(path);
    if (existing) {
      fileMeta.set(path, { created: existing.created, updatedAt: now });
    } else {
      fileMeta.set(path, { created: now });
    }
    files.set(path, content);
    emptyDirs.delete(parentPath(path));
  },

  async writeBytes(
    _ref: ProjectRef,
    path: string,
    bytes: Uint8Array,
  ): Promise<void> {
    binaries.set(path, bytes.slice());
    emptyDirs.delete(parentPath(path));
  },

  async createDir(_ref: ProjectRef, path: string): Promise<void> {
    emptyDirs.add(path);
  },

  async renameFile(
    _ref: ProjectRef,
    path: string,
    newName: string,
  ): Promise<void> {
    const content = requireFile(path);
    const meta = fileMeta.get(path);
    files.delete(path);
    fileMeta.delete(path);
    const newPath = joinPath(parentPath(path), newName);
    files.set(newPath, content);
    if (meta) fileMeta.set(newPath, meta);
  },

  async moveFile(
    _ref: ProjectRef,
    fromPath: string,
    toDir: string,
  ): Promise<void> {
    const content = requireFile(fromPath);
    const meta = fileMeta.get(fromPath);
    files.delete(fromPath);
    fileMeta.delete(fromPath);
    const newPath = joinPath(toDir, baseName(fromPath));
    files.set(newPath, content);
    if (meta) fileMeta.set(newPath, meta);
    emptyDirs.delete(toDir);
  },

  async removeFile(_ref: ProjectRef, path: string): Promise<void> {
    files.delete(path);
    fileMeta.delete(path);
    // An export is a binary file; removing one must leave `exists` truthful.
    // Rename and move stay text-only: nothing moves an export, and
    // `requireFile` refuses one instead of pretending.
    binaries.delete(path);
  },

  /** The fixture's timestamps, so sync code has something to run against. */
  async statFile(
    _ref: ProjectRef,
    path: string,
  ): Promise<{ created: string; updatedAt?: string } | null> {
    return fileMeta.get(path) ?? null;
  },

  async fingerprintFile(
    _ref: ProjectRef,
    path: string,
    hint?: FileHint,
  ): Promise<FileFingerprint> {
    // No disk I/O to save: the Map read and the hash are cheap. `hint` is
    // accepted for the port's uniform signature.
    void hint;
    return { hash: await sha256Hex(requireFile(path)) };
  },

  async fingerprintDir(
    _ref: ProjectRef,
    dirPath: string,
    hints?: Map<string, FileHint>,
  ): Promise<Map<string, FileFingerprint>> {
    void hints;
    const prefix = dirPath === ROOT_PATH ? ROOT_PATH : `${dirPath}/`;
    const out = new Map<string, FileFingerprint>();
    for (const [filePath, content] of files) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      if (rest.length === 0 || rest.includes("/")) continue;
      out.set(rest, { hash: await sha256Hex(content) });
    }
    return out;
  },
};

// Checks reach into the fixture because the states worth checking hardest are
// the ones a writer reaches by damaging their folder, and there is no picker
// to damage a folder through. Demo route only.
if (
  typeof window !== "undefined" &&
  window.location.pathname === "/app/editor/demo"
) {
  // An e2e probe onto the fixture only: it must never expose local or Remote
  // Storage handles or tokens. The pathname must match exactly, with no prefix
  // match and no trailing-slash normalization. The name is neutral, like
  // everything the browser keeps.
  (window as unknown as { __demo: unknown }).__demo = {
    files,
    emptyDirs,
  };
}
