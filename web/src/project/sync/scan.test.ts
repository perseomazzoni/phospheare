// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scan } from "./scan";
import { BARRED_SOURCES_FILE } from "../naming";
import { memoryProvider } from "../../storage/memoryProvider";
import { driveProvider } from "../../storage/driveProvider";
import { mockDriveFetch, mockDriveSeed } from "../../storage/mockDrive.fixture";
import { StorageError, type ProjectRef } from "../../storage/types";

vi.mock("../../storage/driveToken", () => ({
  driveAccessToken: () => Promise.resolve("test-token"),
  forgetDriveToken: () => {},
}));

// `memoryProvider` is a shared module-level fixture, not reset between `it`
// blocks, so these rows run as one sequence, each building on what the
// previous one left behind.

const ref: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "2026-01-01T00:00:00.000Z",
};

describe("scan", () => {
  it("does not fail when assistant/ and reference/ do not exist yet", async () => {
    await expect(scan(memoryProvider, ref)).resolves.toBeInstanceOf(Map);
  });

  it("fails when a listing fails for any reason but not-found, instead of reading the folder as empty", async () => {
    const failing = {
      ...memoryProvider,
      listDir: async () => {
        throw new StorageError("Remote Storage could not be reached.", "io");
      },
    };
    await expect(scan(failing, ref)).rejects.toThrow();
  });

  it("fingerprints the structure file and everything under document/", async () => {
    const result = await scan(memoryProvider, ref);

    expect(result.has("/document-structure.yaml")).toBe(true);
    expect(result.has("/document/part--ki_void.EL1.00.md")).toBe(true);
    expect(result.has("/document/section--the_dark.EL5.00.md")).toBe(true);
  });

  it("never scans document-properties.json", async () => {
    const result = await scan(memoryProvider, ref);
    expect(result.has("/document-properties.json")).toBe(false);
  });

  it("gives an unchanged file the same fingerprint on repeated scans", async () => {
    const first = await scan(memoryProvider, ref);
    const second = await scan(memoryProvider, ref);

    expect(second.get("/document-structure.yaml")).toEqual(
      first.get("/document-structure.yaml"),
    );
  });

  it("reflects a changed file with a different fingerprint", async () => {
    const before = await scan(memoryProvider, ref);
    await memoryProvider.writeFile(
      ref,
      "/document/section--opening.EL2.00.md",
      "A different opening line.",
    );
    const after = await scan(memoryProvider, ref);

    expect(after.get("/document/section--opening.EL2.00.md")).not.toEqual(
      before.get("/document/section--opening.EL2.00.md"),
    );
  });

  it("picks up a file added under assistant/ or reference/", async () => {
    await memoryProvider.writeFile(
      ref,
      "/assistant/persona.md",
      "Write like Hemingway.",
    );
    await memoryProvider.writeFile(
      ref,
      "/reference/notes.md",
      "Background research.",
    );

    const result = await scan(memoryProvider, ref);

    expect(result.has("/assistant/persona.md")).toBe(true);
    expect(result.has("/reference/notes.md")).toBe(true);
  });

  // The margin's files travel between devices as the chats do.
  it("picks up a node's comments file under comments/", async () => {
    await memoryProvider.writeFile(
      ref,
      "/comments/EL2.json",
      '{"threads":[],"dismissed":[]}',
    );
    const result = await scan(memoryProvider, ref);
    expect(result.has("/comments/EL2.json")).toBe(true);
  });

  // A bar set on one device must hold on every paired copy: a source the
  // writer barred is never readable by the assistant elsewhere.
  it("picks up the writer's barred sources", async () => {
    await memoryProvider.writeFile(
      ref,
      BARRED_SOURCES_FILE,
      '{"sourceIds":["reference:notes.md"]}',
    );
    const result = await scan(memoryProvider, ref);
    expect(result.has(BARRED_SOURCES_FILE)).toBe(true);
  });

  // The assistant's memory is a folder inside `assistant/`: the
  // ledgers and review runs travel wherever the chats do, so the walk
  // descends into it. The demo seeds four files there.
  it("picks up the assistant's memory folder, one level down", async () => {
    await memoryProvider.writeFile(
      ref,
      "/assistant/memory/review--run.json",
      "{}",
    );
    const result = await scan(memoryProvider, ref);
    expect(result.has("/assistant/memory/review--run.json")).toBe(true);
    expect(result.has("/assistant/memory/memory.md")).toBe(true);
  });
});

// Against a provider whose `fingerprintDir` folds the checksums into the
// listing (Drive), `scan()` costs one `fingerprintDir` call per folder
// rather than a `fingerprintFile` request per file. This pins
// that `walk()` takes that path end to end; `fingerprintDir` itself is pinned
// in `storage/driveProvider.test.ts`.
describe("scan against a bulk-fingerprint-capable provider (Drive)", () => {
  const driveRef: ProjectRef = {
    providerId: "drive",
    key: "root-id",
    name: "Once Dark",
    openedAt: "2026-01-01T00:00:00.000Z",
  };
  const FOLDER = "application/vnd.google-apps.folder";

  beforeEach(() => {
    mockDriveSeed([
      { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
      {
        id: "doc-dir",
        name: "document",
        mimeType: FOLDER,
        parents: ["root-id"],
      },
      {
        id: "structure",
        name: "document-structure.yaml",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "version: 1\n",
        sha256Checksum: "structure-hash",
      },
      {
        id: "opening",
        name: "section--opening.md",
        mimeType: "text/plain",
        parents: ["doc-dir"],
        content: "It was a dark night.",
        sha256Checksum: "opening-hash",
      },
      {
        id: "closing",
        name: "section--closing.md",
        mimeType: "text/plain",
        parents: ["doc-dir"],
        content: "The end.",
        sha256Checksum: "closing-hash",
      },
    ]);
    vi.stubGlobal("fetch", vi.fn(mockDriveFetch));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fingerprints every file in a folder without a per-file request", async () => {
    const result = await scan(driveProvider, driveRef);

    expect(result.get("/document/section--opening.md")).toEqual({
      hash: "opening-hash",
    });
    expect(result.get("/document/section--closing.md")).toEqual({
      hash: "closing-hash",
    });

    // The per-file fallback (`fingerprintFile`) hits `/files/{id}?fields=…`
    // for that file's id. Neither of `document/`'s two files fetched that way
    // shows directly that `walk()` took the bulk path. A count of folder
    // listings would not, since it also includes the structure file's
    // resolution and the empty probes for `assistant/` and `reference/`.
    const perFileFingerprintCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url]) =>
          /\/files\/(opening|closing)\?/.test(String(url)) &&
          String(url).includes("sha256Checksum"),
      );
    expect(perFileFingerprintCalls).toHaveLength(0);
  });
});
