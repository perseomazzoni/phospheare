// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { emptyManifest } from "./manifest";

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId("test-user");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("manifestStore", () => {
  it("returns null for a project that has never been synced", async () => {
    const { getManifest } = await import("./manifestStore");
    expect(await getManifest("local-key-1")).toBeNull();
  });

  it("round-trips a manifest by the project's own id", async () => {
    const { getManifest, putManifest } = await import("./manifestStore");
    const manifest = emptyManifest({
      providerId: "drive",
      key: "drive-folder-1",
    });
    await putManifest("local-key-1", manifest);
    expect(await getManifest("local-key-1")).toEqual(manifest);
  });

  it("keeps manifests for different projects separate", async () => {
    const { getManifest, putManifest } = await import("./manifestStore");
    await putManifest(
      "project-a",
      emptyManifest({ providerId: "drive", key: "folder-a" }),
    );
    await putManifest(
      "project-b",
      emptyManifest({ providerId: "drive", key: "folder-b" }),
    );
    expect((await getManifest("project-a"))?.remote).toEqual({
      providerId: "drive",
      key: "folder-a",
    });
    expect((await getManifest("project-b"))?.remote).toEqual({
      providerId: "drive",
      key: "folder-b",
    });
  });

  it("losing the manifest is safe: remove leaves the key readable as null", async () => {
    const { getManifest, putManifest, removeManifest } =
      await import("./manifestStore");
    await putManifest(
      "local-key-1",
      emptyManifest({ providerId: "drive", key: "folder-1" }),
    );
    await removeManifest("local-key-1");
    expect(await getManifest("local-key-1")).toBeNull();
  });

  it("does not throw when removing a manifest that was never stored", async () => {
    const { removeManifest } = await import("./manifestStore");
    await expect(removeManifest("never-stored")).resolves.toBeUndefined();
  });

  it("allManifests lists every paired project by its own id", async () => {
    const { allManifests, putManifest } = await import("./manifestStore");
    await putManifest(
      "project-a",
      emptyManifest({ providerId: "drive", key: "folder-a" }),
    );
    await putManifest(
      "project-b",
      emptyManifest({ providerId: "drive", key: "folder-b" }),
    );

    const all = await allManifests();

    expect(all).toHaveLength(2);
    expect(new Set(all.map((e) => e.projectId))).toEqual(
      new Set(["project-a", "project-b"]),
    );
    expect(
      all.find((e) => e.projectId === "project-a")?.manifest.remote,
    ).toEqual({ providerId: "drive", key: "folder-a" });
  });

  it("allManifests is empty when nothing is paired", async () => {
    const { allManifests } = await import("./manifestStore");
    expect(await allManifests()).toEqual([]);
  });

  it("keeps manifests for different users apart, even under the same project id", async () => {
    const { setCurrentUserId } = await import("../../auth/currentUser");
    const { getManifest, putManifest, allManifests } =
      await import("./manifestStore");

    setCurrentUserId("user-a");
    await putManifest(
      "shared-key",
      emptyManifest({ providerId: "drive", key: "folder-a" }),
    );

    setCurrentUserId("user-b");
    expect(await getManifest("shared-key")).toBeNull();
    expect(await allManifests()).toEqual([]);
    await putManifest(
      "shared-key",
      emptyManifest({ providerId: "drive", key: "folder-b" }),
    );

    setCurrentUserId("user-a");
    expect((await getManifest("shared-key"))?.remote).toEqual({
      providerId: "drive",
      key: "folder-a",
    });
    expect(await allManifests()).toHaveLength(1);
  });
});
