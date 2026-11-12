// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { backupLoser } from "./backup";
import { PRODUCT } from "../../product";
import {
  StorageError,
  type ProjectRef,
  type StorageProvider,
} from "../../storage/types";
import type { IconName } from "../../ui/icons";

const ref: ProjectRef = {
  providerId: "fake",
  key: "k",
  name: "Project",
  openedAt: "",
};

/** A minimal fake, independent of the app's real providers: a Map. */
function fakeProvider(
  seed: Record<string, string> = {},
): StorageProvider & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    id: "fake",
    kind: "device" as const,
    label: () => "Fake",
    icon: "mark" as IconName,
    files,
    isAvailable: () => true,
    reopenProject: async () => true,
    canAccess: async () => "granted",
    listDir: async () => [],
    exists: async (_ref, path) => files.has(path),
    readFile: async (_ref, path) => {
      const content = files.get(path);
      if (content === undefined)
        throw new StorageError("not found", "not-found");
      return content;
    },
    writeFile: async (_ref, path, content) => {
      files.set(path, content);
    },
    createDir: async () => {},
    renameFile: async () => {},
    moveFile: async () => {},
    removeFile: async (_ref, path) => {
      files.delete(path);
    },
    fingerprintFile: async () => ({ hash: "fake" }),
    fingerprintDir: async () => new Map(),
  };
}

describe("backupLoser", () => {
  it("copies the discarded side's bytes under the app's hidden folder, in conflicts/<ISO>/", async () => {
    const discarded = fakeProvider({
      "/document/section--opening.md": "discarded content",
    });
    const local = fakeProvider();

    const backupDir = await backupLoser(
      { provider: discarded, ref },
      { provider: local, ref },
      ["/document/section--opening.md"],
    );

    // Named after the product, never the internal name.
    expect(backupDir?.startsWith(`/.${PRODUCT.kebab}/conflicts/`)).toBe(true);
    expect(backupDir).toMatch(/\/conflicts\/\d{4}-\d{2}-\d{2}T/);
    expect(local.files.get(`${backupDir}/document/section--opening.md`)).toBe(
      "discarded content",
    );
  });

  it("never touches the discarded provider — read-only", async () => {
    const discarded = fakeProvider({ "/a.md": "x" });
    const local = fakeProvider();

    await backupLoser({ provider: discarded, ref }, { provider: local, ref }, [
      "/a.md",
    ]);

    expect(discarded.files.get("/a.md")).toBe("x");
  });

  it("skips a path the discarded side never had, without failing the whole backup", async () => {
    const discarded = fakeProvider({ "/a.md": "x" });
    const local = fakeProvider();

    const backupDir = await backupLoser(
      { provider: discarded, ref },
      { provider: local, ref },
      ["/a.md", "/never-existed.md"],
    );

    expect(local.files.get(`${backupDir}/a.md`)).toBe("x");
    expect(local.files.has(`${backupDir}/never-existed.md`)).toBe(false);
  });

  it("backs up every named path", async () => {
    const discarded = fakeProvider({ "/a.md": "a", "/b.md": "b" });
    const local = fakeProvider();

    const backupDir = await backupLoser(
      { provider: discarded, ref },
      { provider: local, ref },
      ["/a.md", "/b.md"],
    );

    expect(local.files.get(`${backupDir}/a.md`)).toBe("a");
    expect(local.files.get(`${backupDir}/b.md`)).toBe("b");
  });

  it("given the kept side, skips a path whose bytes it already holds", async () => {
    const discarded = fakeProvider({ "/a.md": "differs", "/b.md": "same" });
    const kept = fakeProvider({ "/a.md": "kept", "/b.md": "same" });
    const local = fakeProvider();

    const backupDir = await backupLoser(
      { provider: discarded, ref },
      { provider: local, ref },
      ["/a.md", "/b.md"],
      { provider: kept, ref },
    );

    expect(local.files.get(`${backupDir}/a.md`)).toBe("differs");
    expect(local.files.has(`${backupDir}/b.md`)).toBe(false);
  });

  it("names no folder when no file needed saving", async () => {
    const discarded = fakeProvider({ "/a.md": "same" });
    const kept = fakeProvider({ "/a.md": "same" });
    const local = fakeProvider();

    const backupDir = await backupLoser(
      { provider: discarded, ref },
      { provider: local, ref },
      ["/a.md", "/never-existed.md"],
      { provider: kept, ref },
    );

    expect(backupDir).toBeNull();
    expect(local.files.size).toBe(0);
  });

  it("gives two backups made at different times two different folders", async () => {
    const discarded = fakeProvider({ "/a.md": "a" });
    const local = fakeProvider();

    // The clock is set, not waited on: one backup at nine, one a minute on.
    const nine = Date.UTC(2026, 10, 7, 9, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(nine);
      const first = await backupLoser(
        { provider: discarded, ref },
        { provider: local, ref },
        ["/a.md"],
      );
      vi.setSystemTime(nine + 60_000);
      const second = await backupLoser(
        { provider: discarded, ref },
        { provider: local, ref },
        ["/a.md"],
      );

      expect(first).not.toBe(second);
    } finally {
      vi.useRealTimers();
    }
  });
});
