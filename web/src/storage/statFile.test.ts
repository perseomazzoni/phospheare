// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryProvider } from "./memoryProvider";
import { driveProvider } from "./driveProvider";
import { mirror } from "./mirrored";
import { mockDriveFetch, mockDriveSeed } from "./mockDrive.fixture";
import type { ProjectRef, StorageProvider } from "./types";
import type { IconName } from "../ui/icons";

vi.mock("./driveToken", () => ({
  driveAccessToken: () => Promise.resolve("test-token"),
  forgetDriveToken: () => {},
}));

vi.mock("./driveLayout", () => ({
  projectsFolderId: () => Promise.resolve("projects-canonical"),
}));

/** `statFile` is an optional port member that each provider here implements,
 * so the guard fires only on a wiring mistake. */
function statFileOf(provider: { statFile?: StorageProvider["statFile"] }) {
  if (!provider.statFile) throw new Error("statFile expected on the provider");
  return provider.statFile;
}

// The `statFile` contract, per provider. `statFile` is the storage port's
// timestamp seam (the notes-list datetime). The three providers each know
// time differently: Drive knows a real birth, the File System Access API has
// none, and the memory fixture invents one. The contract pins what each may
// say:
//
//   - `created` is a real creation time when the provider knows one, and is
//     absent when it does not. A value that advances on every save is never
//     reported as a birth.
//   - `updatedAt` is the most recent modification, when known.
//   - a file the provider cannot reach answers `null`, never a throw.
//   - the mirror delegates both optional seams when the base has them, and
//     reports `undefined` when it does not.

const ref: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "2026-01-01T00:00:00.000Z",
};

describe("memoryProvider.statFile", () => {
  const stat = statFileOf(memoryProvider);

  it("knows the seeded birth of a reference file", async () => {
    const meta = await stat(ref, "/reference/character--humans.md");
    // The birth fact, not an exact shape: the overwrite row mutates the
    // module's `fileMeta` map, and this row must survive running after it.
    expect(meta?.created).toBe("2026-01-01T00:00:00.000Z");
  });

  it("records the overwrite as updatedAt, never moving created", async () => {
    await memoryProvider.writeFile(
      ref,
      "/reference/character--humans.md",
      "# New\n",
    );
    const meta = await stat(ref, "/reference/character--humans.md");
    expect(meta?.created).toBe("2026-01-01T00:00:00.000Z");
    expect(meta?.updatedAt).toBeTruthy();
  });

  it("answers null for a path with no stored timestamp", async () => {
    expect(await stat(ref, "/document/section--x.md")).toBe(null);
  });
});

describe("driveProvider.statFile", () => {
  const driveRef: ProjectRef = {
    providerId: "drive",
    key: "root-id",
    name: "Once Dark",
    openedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(mockDriveFetch));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("reads Drive's own createdTime and modifiedTime for the file at a path", async () => {
    mockDriveSeed([
      {
        id: "root-id",
        name: "once-dark",
        mimeType: "application/vnd.google-apps.folder",
        parents: [],
      },
      {
        id: "note",
        name: "notes--alpha.md",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "",
        createdTime: "2026-01-01T10:00:00.000Z",
        modifiedTime: "2026-01-02T11:00:00.000Z",
      },
    ]);
    const meta = await statFileOf(driveProvider)(driveRef, "/notes--alpha.md");
    expect(meta).toEqual({
      created: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-02T11:00:00.000Z",
    });
  });

  it("omits updatedAt when Drive reports the file never modified since creation", async () => {
    mockDriveSeed([
      {
        id: "root-id",
        name: "once-dark",
        mimeType: "application/vnd.google-apps.folder",
        parents: [],
      },
      {
        id: "note",
        name: "notes--alpha.md",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "",
        createdTime: "2026-01-01T10:00:00.000Z",
      },
    ]);
    const meta = await statFileOf(driveProvider)(driveRef, "/notes--alpha.md");
    expect(meta).toEqual({ created: "2026-01-01T10:00:00.000Z" });
  });

  it("answers null for a file Drive does not know", async () => {
    mockDriveSeed([
      {
        id: "root-id",
        name: "once-dark",
        mimeType: "application/vnd.google-apps.folder",
        parents: [],
      },
    ]);
    expect(await statFileOf(driveProvider)(driveRef, "/notes--alpha.md")).toBe(
      null,
    );
  });
});

describe("mirror()'s statFile seam, and its unconditional fingerprint delegation", () => {
  // `fingerprintFile` and `fingerprintDir` are mandatory `StorageProvider`
  // members, because every adapter can fingerprint. The type system
  // forbids a base that lacks them, so the one shape to pin is unconditional
  // delegation of both, with the `hint`/`hints` argument forwarded untouched.
  it("delegates fingerprintFile and fingerprintDir unconditionally, hint and all", async () => {
    const fingerprintFile = vi.fn(async () => ({ hash: "abc" }));
    const fingerprintDir = vi.fn(async () => new Map());
    const base = {
      id: "local",
      kind: "device" as const,
      label: () => "Local",
      icon: "mark" as IconName,
      isAvailable: () => true,
      reopenProject: async () => true,
      canAccess: async () => "granted" as const,
      listDir: async () => [],
      exists: async () => true,
      readFile: async () => "",
      writeFile: async () => undefined,
      createDir: async () => undefined,
      renameFile: async () => undefined,
      moveFile: async () => undefined,
      removeFile: async () => undefined,
      fingerprintFile,
      fingerprintDir,
    };
    const wrapped = mirror(
      base,
      async () => {},
      () => [],
    );
    const hint = { mtime: 1, hash: "old" };

    await wrapped.fingerprintFile(ref, "/reference/a.md", hint);
    expect(fingerprintFile).toHaveBeenCalledWith(ref, "/reference/a.md", hint);

    const hints = new Map([["a.md", hint]]);
    await wrapped.fingerprintDir(ref, "/reference", hints);
    expect(fingerprintDir).toHaveBeenCalledWith(ref, "/reference", hints);
  });

  it("delegates statFile when the base has it, and stays silent when it doesn't — the one member still genuinely optional", async () => {
    const statFile = vi.fn(async () => ({
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const withStat = {
      id: "local",
      kind: "device" as const,
      label: () => "Local",
      icon: "mark" as IconName,
      isAvailable: () => true,
      reopenProject: async () => true,
      canAccess: async () => "granted" as const,
      listDir: async () => [],
      exists: async () => true,
      readFile: async () => "",
      writeFile: async () => undefined,
      createDir: async () => undefined,
      renameFile: async () => undefined,
      moveFile: async () => undefined,
      removeFile: async () => undefined,
      fingerprintFile: async () => ({ hash: "abc" }),
      fingerprintDir: async () => new Map(),
      statFile,
    };
    const wrapped = mirror(
      withStat,
      async () => {},
      () => [],
    );
    expect(await wrapped.statFile?.(ref, "/reference/a.md")).toEqual({
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(statFile).toHaveBeenCalledWith(ref, "/reference/a.md");

    const withoutStat = { ...withStat, statFile: undefined };
    expect(
      mirror(
        withoutStat,
        async () => {},
        () => [],
      ).statFile,
    ).toBeUndefined();
  });
});
