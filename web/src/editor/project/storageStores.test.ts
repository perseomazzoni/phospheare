// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectRef, StorageProvider } from "../../storage";
import { StorageError } from "../../storage/types";
import { appLog } from "../../log";
import { providerReader } from "./storageStores";

const project = { providerId: "local", key: "k" } as ProjectRef;

/** A provider whose every read fails with `code`. */
function failing(code: "not-found" | "io"): StorageProvider {
  return {
    readFile: vi.fn(async () => {
      throw new StorageError("A read failed.", code);
    }),
  } as unknown as StorageProvider;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the project reader", () => {
  it("answers null for a metadata file that is not there", async () => {
    const reader = providerReader(failing("not-found"));
    await expect(reader.properties(project)).resolves.toBeNull();
    await expect(reader.catalogue(project)).resolves.toBeNull();
    await expect(reader.structure(project)).resolves.toBeNull();
  });

  it("throws for a metadata file that cannot be read, never answering missing", async () => {
    const reader = providerReader(failing("io"));
    await expect(reader.properties(project)).rejects.toMatchObject({
      code: "io",
    });
    await expect(reader.catalogue(project)).rejects.toMatchObject({
      code: "io",
    });
    await expect(reader.structure(project)).rejects.toMatchObject({
      code: "io",
    });
  });

  it("skips a snapshot that cannot be read, and logs it by kind", async () => {
    const warn = vi.spyOn(appLog, "warn").mockImplementation(() => {});
    await expect(
      providerReader(failing("io")).snapshot(project, "chapter.md"),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "editor",
      "A project file could not be read.",
      expect.objectContaining({ file: "section", code: "io" }),
    );
    warn.mockClear();
    await expect(
      providerReader(failing("not-found")).snapshot(project, "chapter.md"),
    ).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
