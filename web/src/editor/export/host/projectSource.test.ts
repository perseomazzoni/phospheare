// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import { languageLabel } from "../../../locales/languages";
import { defaultProperties } from "../../../project/properties";
import type {
  DocNode,
  DocumentProperties,
  DocumentStructure,
} from "../../../project/types";
import {
  StorageError,
  type DirEntry,
  type ProjectRef,
  type StorageProvider,
} from "../../../storage/types";
import {
  projectExportSource,
  type ProjectSourceOptions,
} from "./projectSource";

// Pins the export's reading of a book as its files hold it: the structure
// handed in, each node's adopted file, and a reference as a reader of the
// shelf sees it, with no `<!-- -->` notes, no unanswered template questions
// and no summary metadata.
//
// The provider is a Map behind the source's two calls (`listDir` on
// `reference/`, `readFile`), so every row can also say which file was read.

const ref: ProjectRef = {
  providerId: "local",
  key: "once-dark",
  name: "Once Dark",
  openedAt: "2026-10-01T00:00:00.000Z",
};

/** The key, with its variables: enough to see which words were asked for. */
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars
    ? `[${key} ${JSON.stringify(vars)}]`
    : `[${key}]`) as unknown as TFunction;

function section(id: string, title: string, adopted: string): DocNode {
  return { kind: "section", id, title, adopted, snapshots: [] };
}

const structure: DocumentStructure = {
  version: 1,
  children: [
    {
      kind: "part",
      id: "EL1",
      title: "Act One",
      adopted: "part--act_one.EL1.01.md",
      snapshots: [],
      children: [
        section("EL2", "The Storm", "section--the_storm.EL2.01.md"),
        section("EL3", "Calm", "section--calm.EL3.01.md"),
      ],
    },
    section("EL4", "Coda", "section--coda.EL4.01.md"),
  ],
};

function storageOver(files: Record<string, string>) {
  const listDir = vi.fn(async (_ref: ProjectRef, path: string) => {
    const entries: DirEntry[] = [];
    for (const file of Object.keys(files)) {
      if (!file.startsWith(`${path}/`)) continue;
      const name = file.slice(path.length + 1);
      entries.push({ path: file, name, kind: "file" });
    }
    if (entries.length === 0)
      throw new StorageError(`Folder not found: ${path}`, "not-found");
    // A folder inside `reference/` is not a document and never becomes one.
    entries.push({ path: `${path}/drafts`, name: "drafts", kind: "folder" });
    return entries;
  });
  const readFile = vi.fn(async (_ref: ProjectRef, path: string) => {
    const content = files[path];
    if (content === undefined)
      throw new StorageError(`File not found: ${path}`, "not-found");
    return content;
  });
  return {
    storage: { listDir, readFile } as unknown as StorageProvider,
    listDir,
    readFile,
  };
}

function source(
  files: Record<string, string>,
  overrides: Partial<ProjectSourceOptions> = {},
) {
  const { storage, readFile, listDir } = storageOver(files);
  const properties = defaultProperties("Once Dark");
  return {
    readFile,
    listDir,
    properties,
    source: projectExportSource({
      storage,
      ref,
      structure: () => structure,
      properties: () => properties,
      t,
      ...overrides,
    }),
  };
}

describe("book — the stored facts, coded values in words", () => {
  function factsOf(edit: (doc: DocumentProperties["document"]) => void) {
    const properties = defaultProperties("Once Dark");
    edit(properties.document);
    return projectExportSource({
      storage: storageOver({}).storage,
      ref,
      structure: () => structure,
      properties: () => properties,
      t,
    }).book();
  }

  it("names each genre, the readers and the shape through the locale", () => {
    const facts = factsOf((doc) => {
      doc.id = "book-1";
      doc.author = "Vera Lind";
      doc.type = "Novel";
      doc.language = "it";
      doc.genres = ["fantasy", "romance"];
      doc.ageCategory = "young-adult";
      doc.tropes = ["The Chosen One"];
      doc.structure = "threeact";
      doc.createdAt = "2026-01-02T00:00:00.000Z";
      doc.updatedAt = "2026-09-30T00:00:00.000Z";
    });
    expect(facts).toEqual({
      id: "book-1",
      title: "Once Dark",
      author: "Vera Lind",
      // Stored as the writer saw it and shown verbatim elsewhere in the app,
      // so not run through the locale.
      type: "Novel",
      language: "it",
      languageLabel: languageLabel("it"),
      genres: ["[genre.name.fantasy]", "[genre.name.romance]"],
      ageCategory: "[genre.age.young-adult]",
      tropes: ["The Chosen One"],
      structure: "[create.shape.threeact]",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-09-30T00:00:00.000Z",
    });
  });

  // An unset value stays null: printed through the locale it would be a key
  // like `genre.age.null` on a tech page sent to an agent.
  it("leaves what the writer has not said as null, not as a looked-up word", () => {
    const facts = factsOf((doc) => {
      doc.genres = [];
      doc.ageCategory = null;
      doc.structure = null;
    });
    expect(facts.genres).toEqual([]);
    expect(facts.ageCategory).toBeNull();
    expect(facts.structure).toBeNull();
  });
});

describe("manuscript — the structure on screen, nested", () => {
  it("keeps Parts around their Sections and Sections childless, in order", () => {
    expect(source({}).source.manuscript()).toEqual([
      {
        id: "EL1",
        kind: "part",
        title: "Act One",
        children: [
          { id: "EL2", kind: "section", title: "The Storm", children: [] },
          { id: "EL3", kind: "section", title: "Calm", children: [] },
        ],
      },
      { id: "EL4", kind: "section", title: "Coda", children: [] },
    ]);
  });
});

describe("references — the shelf's order", () => {
  it("is the guidebook, each character with its arc, the world, the summaries, the notes", async () => {
    const R = "/reference";
    const { source: s } = source({
      [`${R}/notes--zebra.md`]: "",
      [`${R}/world--economy.md`]: "",
      [`${R}/character--Maren.md`]: "",
      [`${R}/summary--EL2.md`]: "",
      [`${R}/guidebook--logline.md`]: "",
      [`${R}/arc--Maren.md`]: "",
      [`${R}/world--rules.md`]: "",
      [`${R}/summary--EL1.md`]: "",
      [`${R}/notes--apple.md`]: "",
      [`${R}/character--Aldo.md`]: "",
      [`${R}/guidebook--at-a-glance.md`]: "",
      // Never drawn on the shelf, so never exported: an arc for nobody, a
      // compiled-group file that is not a catalogue section, a file that
      // declares no group at all.
      [`${R}/arc--Ghost.md`]: "",
      [`${R}/guidebook--my-own.md`]: "",
      [`${R}/readme.md`]: "",
    });

    expect(await s.references()).toEqual([
      // The compiled groups read in catalogue order, titled by their label.
      {
        fileName: "guidebook--at-a-glance.md",
        group: "guidebook",
        title: "[reference.section.guidebook.at-a-glance]",
      },
      {
        fileName: "guidebook--logline.md",
        group: "guidebook",
        title: "[reference.section.guidebook.logline]",
      },
      // Characters by name; an arc follows its own character at once, the two
      // reading as one sentence, and a character without one stands alone.
      { fileName: "character--Aldo.md", group: "characters", title: "Aldo" },
      { fileName: "character--Maren.md", group: "characters", title: "Maren" },
      {
        fileName: "arc--Maren.md",
        group: "arcs",
        title: '[export.pick.arcOf {"name":"Maren"}]',
      },
      {
        fileName: "world--rules.md",
        group: "world",
        title: "[reference.section.world.rules]",
      },
      {
        fileName: "world--economy.md",
        group: "world",
        title: "[reference.section.world.economy]",
      },
      // Summaries in the book's own order, titled by the current title of
      // the node they summarise, not its id.
      { fileName: "summary--EL1.md", group: "summaries", title: "Act One" },
      { fileName: "summary--EL2.md", group: "summaries", title: "The Storm" },
      { fileName: "notes--apple.md", group: "notes", title: "apple" },
      { fileName: "notes--zebra.md", group: "notes", title: "zebra" },
    ]);
  });

  it("is nothing at all for a book with no reference folder yet", async () => {
    expect(await source({}).source.references()).toEqual([]);
  });
});

describe("readNode — the text as it stands now", () => {
  const files = {
    "/document/section--the_storm.EL2.01.md": "Stored storm.",
    "/document/section--calm.EL3.01.md":
      "Calm water.\n\n<!-- remember the boat -->\n\nStill.",
  };

  it("reads a Section from its adopted file", async () => {
    const { source: s, readFile } = source(files);
    expect(await s.readNode("EL2")).toEqual({
      text: "Stored storm.",
      words: 2,
    });
    expect(readFile).toHaveBeenCalledWith(
      ref,
      "/document/section--the_storm.EL2.01.md",
    );
  });

  // A comment is the writer talking to themselves: it is not
  // content, it does not print, and it is not counted.
  it("takes the writer's notes out, and does not count them", async () => {
    const node = await source(files).source.readNode("EL3");
    expect(node.text).not.toContain("<!--");
    expect(node.text).not.toContain("remember the boat");
    expect(node.text).toContain("Still.");
    expect(node.words).toBe(3);
  });

  it("refuses an id the structure does not hold", async () => {
    await expect(source(files).source.readNode("EL99")).rejects.toThrow(
      "export-node-not-found",
    );
  });
});

describe("readReference — what a reader of the shelf sees", () => {
  /** A template question as the templates ship it, answered or not. */
  const question = (label: string, answer = "") =>
    [
      `- **${label}:**`,
      `  <!-- Hint: think about ${label}. -->`,
      `  - ${answer}`,
    ].join("\n");

  const sheet = [
    "# Maren",
    "",
    question("Pronouns", "she/her"),
    "",
    question("Age"),
    "",
  ].join("\n");

  it("reads a reference from its file in reference/", async () => {
    const { source: s, readFile } = source({
      "/reference/character--Maren.md": "# Maren\n\nThe saved sheet.",
    });
    expect(await s.readReference("character--Maren.md")).toContain(
      "The saved sheet.",
    );
    expect(readFile).toHaveBeenCalledWith(
      ref,
      "/reference/character--Maren.md",
    );
  });

  // The name comes from the selection, which came from a listing, but a path
  // is built from it here, and `reference/` is the only folder it may
  // address.
  it.each(["../document-properties.json", "a/b.md", "a\\b.md"])(
    "refuses a name that is a path: %j",
    async (name) => {
      const { source: s, readFile } = source({});
      await expect(s.readReference(name)).rejects.toThrow(
        "export-reference-name",
      );
      expect(readFile).not.toHaveBeenCalled();
    },
  );

  it("takes a reference's hints and unanswered questions out", async () => {
    const text = await source({
      "/reference/character--Maren.md": sheet,
    }).source.readReference("character--Maren.md");
    expect(text).toContain("she/her");
    expect(text).not.toContain("Hint:");
    expect(text).not.toContain("Age");
  });

  it("takes a summary's metadata block out, keeping its body", async () => {
    const text = await source({
      "/reference/summary--EL2.md":
        "---\nsources:\n  EL2: abc\n---\n\nThe storm breaks the boat.\n",
    }).source.readReference("summary--EL2.md");
    expect(text).toBe("The storm breaks the boat.");
  });

  // A note is the writer's free text, not a template: a "question" in it is
  // the writer's own, and only the `<!-- -->` notes are removed.
  it("leaves a note's own text alone, but for its comments", async () => {
    const text = await source({
      "/reference/notes--ideas.md": sheet,
    }).source.readReference("notes--ideas.md");
    expect(text).toContain("- **Age:**");
    expect(text).not.toContain("Hint:");
  });
});
