// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  driveProvider,
  getProvider,
  isRemoteRef,
  localProvider,
  memoryProvider,
} from "./index";

// Pins the one axis above the port. Every provider declares a `kind`, and
// code above the port asks "is this remote" through it. Comparing
// `providerId` with `driveProvider.id` answers "is this Google Drive", which
// agrees only while Drive is the only remote. Adding a backend is
// then a registration, not a hunt through the Library.

describe("provider kinds", () => {
  it("puts each registered provider on the right side of the line", () => {
    // Not a restatement of the literals: one of the three providers is
    // reachable over a network, and the demo fixture, which lives in a Map and
    // is committed nowhere, is not it.
    expect(driveProvider.kind).toBe("remote");
    expect(localProvider.kind).toBe("device");
    expect(memoryProvider.kind).toBe("device");
  });

  it("answers isRemoteRef from the registry, not from an id comparison", () => {
    expect(isRemoteRef({ providerId: driveProvider.id })).toBe(true);
    expect(isRemoteRef({ providerId: localProvider.id })).toBe(false);
  });

  it("reads an unknown provider as not remote", () => {
    // A card whose backend this build does not register cannot be reached
    // over a network from here, so "not remote" is the honest answer. It is
    // also the safe one: every caller uses it to decide whether to offer a
    // remote action, and offering one for a backend that does not exist is
    // worse than withholding it.
    expect(getProvider("dropbox")).toBeNull();
    expect(isRemoteRef({ providerId: "dropbox" })).toBe(false);
  });
});

describe("the remote's own capabilities", () => {
  it("gives Drive a web address built from the folder id, and local none", () => {
    // The provider builds this URL, so the Library's "reveal" knows nothing
    // about Google.
    const ref = { providerId: "drive", key: "1AbC", name: "", openedAt: "" };
    expect(driveProvider.folderUrl?.(ref)).toBe(
      "https://drive.google.com/drive/folders/1AbC",
    );
    expect(localProvider.folderUrl).toBeUndefined();
  });

  it("gives Drive a bin and the device providers none", () => {
    // The File System Access API has no bin: a folder it removes is gone for
    // good, so there is nothing honest to implement here. This absence makes
    // `cardActions` offer "Remove from library" on those cards instead, a
    // different promise.
    expect(typeof driveProvider.trashProject).toBe("function");
    expect(localProvider.trashProject).toBeUndefined();
    expect(memoryProvider.trashProject).toBeUndefined();
  });
});
