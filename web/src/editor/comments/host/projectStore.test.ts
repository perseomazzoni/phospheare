// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ProjectRef, StorageProvider } from "../../../storage/types";
import { projectCommentStore } from "./projectStore";

const ref = { providerId: "local", key: "book" } as ProjectRef;

function fakeProvider() {
  const files = new Map<string, string>();
  const provider = {
    exists: async (_ref: ProjectRef, path: string) => files.has(path),
    readFile: async (_ref: ProjectRef, path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error("not found");
      return text;
    },
    writeFile: async (_ref: ProjectRef, path: string, text: string) => {
      files.set(path, text);
    },
  } as unknown as StorageProvider;
  return { provider, files };
}

describe("projectCommentStore", () => {
  it("reads and writes comments/<nodeId>.json, and calls a file that is not there missing", async () => {
    const { provider, files } = fakeProvider();
    const store = projectCommentStore(provider, ref);
    expect(await store.read("EL3")).toEqual({ kind: "missing" });
    await store.write("EL3", "{}");
    expect([...files.keys()]).toEqual(["/comments/EL3.json"]);
    expect(await store.read("EL3")).toEqual({ kind: "text", text: "{}" });
  });

  it("lets a storage that does not answer throw, rather than reading as empty", async () => {
    const provider = {
      exists: async () => {
        throw new Error("offline");
      },
    } as unknown as StorageProvider;
    await expect(
      projectCommentStore(provider, ref).read("EL1"),
    ).rejects.toThrow("offline");
  });
});
