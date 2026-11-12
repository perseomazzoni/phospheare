// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { BARRED_SOURCES_FILE } from "../../project/naming";
import { serializeBarred } from "../../project/barredSources";
import type { ProjectRef, StorageProvider } from "../../storage/types";
import { BarredSources } from "./barredSources";

const ref: ProjectRef = {
  providerId: "fake",
  key: "p",
  name: "P",
  openedAt: "2026-01-01T00:00:00.000Z",
};

/** A folder of one file, which a test can change behind the service's back. */
function folder() {
  const files = new Map<string, string>();
  let unreachable = false;
  const provider = {
    exists: vi.fn(async (_ref: ProjectRef, path: string) => {
      if (unreachable) throw new Error("unreachable");
      return files.has(path);
    }),
    readFile: vi.fn(async (_ref: ProjectRef, path: string) => {
      if (unreachable) throw new Error("unreachable");
      const text = files.get(path);
      if (text === undefined) throw new Error("not found");
      return text;
    }),
    writeFile: vi.fn(async (_ref: ProjectRef, path: string, text: string) => {
      files.set(path, text);
    }),
  } as unknown as StorageProvider;
  return {
    files,
    provider,
    cut: () => {
      unreachable = true;
    },
  };
}

describe("BarredSources", () => {
  it("reads no file as nothing barred", async () => {
    const { provider } = folder();
    const service = new BarredSources(provider, ref);
    expect([...(await service.current())]).toEqual([]);
  });

  it("writes a bar to its own file and lifts it again", async () => {
    const { files, provider } = folder();
    const service = new BarredSources(provider, ref);
    await service.setBarred("reference:world.md", true);
    expect(files.get(BARRED_SOURCES_FILE)).toBe(
      serializeBarred(["reference:world.md"]),
    );
    expect(service.snapshot()).toEqual(["reference:world.md"]);
    await service.setBarred("reference:world.md", false);
    expect(files.get(BARRED_SOURCES_FILE)).toBe(serializeBarred([]));
    expect(service.snapshot()).toEqual([]);
  });

  it("answers the file as it is now, so a bar a sync brought down holds at once", async () => {
    const { files, provider } = folder();
    const service = new BarredSources(provider, ref);
    expect([...(await service.current())]).toEqual([]);
    files.set(BARRED_SOURCES_FILE, serializeBarred(["reference:notes.md"]));
    expect([...(await service.current())]).toEqual(["reference:notes.md"]);
  });

  it("keeps two quick toggles, and a toggle keeps a bar written elsewhere", async () => {
    const { files, provider } = folder();
    files.set(BARRED_SOURCES_FILE, serializeBarred(["reference:other.md"]));
    const service = new BarredSources(provider, ref);
    await Promise.all([
      service.setBarred("reference:a.md", true),
      service.setBarred("reference:b.md", true),
    ]);
    expect([...(await service.current())]).toEqual([
      "reference:other.md",
      "reference:a.md",
      "reference:b.md",
    ]);
  });

  it("fails closed and writes nothing when the file cannot be reached", async () => {
    const { provider, cut } = folder();
    const service = new BarredSources(provider, ref);
    cut();
    await expect(service.current()).rejects.toThrow("unreachable");
    await expect(service.setBarred("reference:a.md", true)).rejects.toThrow(
      "unreachable",
    );
    expect(provider.writeFile).not.toHaveBeenCalled();
  });

  it("fails closed and writes nothing over a damaged file", async () => {
    for (const damaged of [
      '{"sourceIds":["reference:a.md"',
      JSON.stringify({ ids: ["reference:a.md"] }),
    ]) {
      const { files, provider } = folder();
      files.set(BARRED_SOURCES_FILE, damaged);
      const service = new BarredSources(provider, ref);
      await expect(service.current()).rejects.toThrow("barred-sources-damaged");
      await expect(service.setBarred("reference:b.md", true)).rejects.toThrow(
        "barred-sources-damaged",
      );
      expect(files.get(BARRED_SOURCES_FILE)).toBe(damaged);
    }
  });

  it("tells its listeners of a change, and nobody once disposed", async () => {
    const { files, provider } = folder();
    const service = new BarredSources(provider, ref);
    const heard = vi.fn();
    service.subscribe(heard);
    await service.setBarred("reference:a.md", true);
    expect(heard).toHaveBeenCalledOnce();
    service.dispose();
    files.set(BARRED_SOURCES_FILE, serializeBarred([]));
    await service.current();
    expect(heard).toHaveBeenCalledOnce();
  });
});
