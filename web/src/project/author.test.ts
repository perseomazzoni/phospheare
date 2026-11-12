// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ProjectRef, StorageProvider } from "../storage/types";
import { setProjectAuthor } from "./author";
import { PROPERTIES_FILE } from "./naming";
import {
  AUTHOR_MAX,
  defaultProperties,
  parseProperties,
  serializeProperties,
} from "./properties";

// Pins `setProjectAuthor`.

const ref: ProjectRef = {
  providerId: "fake",
  key: "k",
  name: "salt-roads",
  openedAt: "2026-10-02T10:00:00.000Z",
};

/** Just enough provider to read and write one file. */
function fakeProvider(seed: string) {
  const files = new Map([[PROPERTIES_FILE, seed]]);
  const provider = {
    readFile: async (_r: ProjectRef, path: string) => {
      const found = files.get(path);
      if (found === undefined) throw new Error(`no such file ${path}`);
      return found;
    },
    writeFile: async (_r: ProjectRef, path: string, content: string) =>
      void files.set(path, content),
  } as unknown as StorageProvider;
  return { provider, files };
}

describe("setProjectAuthor", () => {
  it("saves the author and keeps every other field", async () => {
    const props = defaultProperties("Salt Roads");
    props.document.genres = ["fantasy"];
    const { provider, files } = fakeProvider(serializeProperties(props));
    await setProjectAuthor(provider, ref, "Ada Lovelace");
    const saved = parseProperties(files.get(PROPERTIES_FILE) ?? null, "x");
    expect(saved.document.author).toBe("Ada Lovelace");
    expect(saved.document.title).toBe("Salt Roads");
    expect(saved.document.genres).toEqual(["fantasy"]);
    expect(saved.document.id).toBe(props.document.id);
  });

  // The window hands over what was typed; the file holds one bounded line,
  // because the name lands in running heads.
  it("folds a typed name onto one bounded line before it is saved", async () => {
    const { provider, files } = fakeProvider(
      serializeProperties(defaultProperties("Salt Roads")),
    );
    const newline = String.fromCharCode(10);
    await setProjectAuthor(
      provider,
      ref,
      `  Ada${newline}Lovelace ${"x".repeat(AUTHOR_MAX)}`,
    );
    const raw = JSON.parse(files.get(PROPERTIES_FILE) ?? "{}") as {
      document: { author: string };
    };
    expect(raw.document.author.startsWith("Ada Lovelace x")).toBe(true);
    expect(Array.from(raw.document.author)).toHaveLength(AUTHOR_MAX);
  });

  // The export window writes outside the editor, so it reads the file the
  // way the Properties window does: a folder whose properties file is not a
  // book is refused, never overwritten with a fresh one carrying a name.
  it("refuses a folder that is not a book, and writes nothing", async () => {
    const { provider, files } = fakeProvider("{ not json");
    await expect(
      setProjectAuthor(provider, ref, "Ada Lovelace"),
    ).rejects.toThrow("facts-unreadable");
    expect(files.get(PROPERTIES_FILE)).toBe("{ not json");
  });
});
