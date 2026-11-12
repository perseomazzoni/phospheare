// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  emptyManifest,
  withBaseline,
  withPathMoved,
  withoutPath,
} from "./manifest";

describe("emptyManifest", () => {
  it("starts with no files", () => {
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
    expect(manifest.remote).toEqual({ providerId: "drive", key: "folder-1" });
    expect(manifest.files).toEqual({});
  });
});

describe("withBaseline", () => {
  it("adds a baseline without mutating the original", () => {
    const original = emptyManifest({ providerId: "drive", key: "folder-1" });
    const updated = withBaseline(original, "/document/section--opening.md", {
      local: "aaa",
      remote: "bbb",
      remoteFileId: "file-1",
      localMtime: 123,
    });
    expect(original.files).toEqual({});
    expect(updated.files["/document/section--opening.md"]).toEqual({
      local: "aaa",
      remote: "bbb",
      remoteFileId: "file-1",
      localMtime: 123,
    });
  });

  it("replaces an existing baseline at the same path", () => {
    const first = withBaseline(
      emptyManifest({ providerId: "drive", key: "folder-1" }),
      "/a.md",
      {
        local: "v1",
        remote: "v1",
        remoteFileId: "file-1",
        localMtime: 1,
      },
    );
    const second = withBaseline(first, "/a.md", {
      local: "v2",
      remote: "v2",
      remoteFileId: "file-1",
      localMtime: 2,
    });
    expect(Object.keys(second.files)).toEqual(["/a.md"]);
    expect(second.files["/a.md"].local).toBe("v2");
  });
});

describe("withoutPath", () => {
  it("drops exactly the named path", () => {
    const manifest = withBaseline(
      withBaseline(
        emptyManifest({ providerId: "drive", key: "folder-1" }),
        "/a.md",
        {
          local: "x",
          remote: "x",
          remoteFileId: "f1",
          localMtime: 1,
        },
      ),
      "/b.md",
      { local: "y", remote: "y", remoteFileId: "f2", localMtime: 2 },
    );
    const updated = withoutPath(manifest, "/a.md");
    expect(Object.keys(updated.files)).toEqual(["/b.md"]);
  });

  it("is a no-op when the path is not present", () => {
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
    expect(withoutPath(manifest, "/missing.md").files).toEqual({});
  });
});

describe("withPathMoved", () => {
  const at = (hash: string) => ({
    local: hash,
    remote: hash,
    remoteFileId: "",
    localMtime: 0,
  });

  it("moves a file's baseline, and a folder's with everything under it", () => {
    let manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
    manifest = withBaseline(manifest, "/document/part/a.md", at("a"));
    manifest = withBaseline(manifest, "/document/part/inner/b.md", at("b"));
    manifest = withBaseline(manifest, "/document/partly.md", at("c"));

    const moved = withPathMoved(manifest, "/document/part", "/document/act");

    expect(moved.files).toEqual({
      "/document/act/a.md": at("a"),
      "/document/act/inner/b.md": at("b"),
      "/document/partly.md": at("c"),
    });
  });

  it("replaces a baseline at the destination and keeps one with no source", () => {
    let manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
    manifest = withBaseline(manifest, "/a.md", at("new"));
    manifest = withBaseline(manifest, "/b.md", at("old"));

    expect(withPathMoved(manifest, "/a.md", "/b.md").files).toEqual({
      "/b.md": at("new"),
    });
    expect(withPathMoved(manifest, "/gone.md", "/b.md").files).toEqual(
      manifest.files,
    );
  });
});
