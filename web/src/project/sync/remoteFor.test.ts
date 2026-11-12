// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const pairingFor = vi.fn();
vi.mock("./pairing", () => ({
  pairingFor: (...args: unknown[]) => pairingFor(...args),
}));
const projectIdFor = vi.fn();
vi.mock("../projectId", () => ({
  projectIdFor: (...args: unknown[]) => projectIdFor(...args),
}));
vi.mock("../../storage", () => ({
  isRemoteRef: (ref: { providerId: string }) => ref.providerId === "drive",
}));

beforeEach(() => {
  vi.resetModules();
  pairingFor.mockReset();
  projectIdFor.mockReset();
});

// A remote-primary project and a device project are different questions with
// the same answer shape, answered in one place.
describe("remoteFor", () => {
  it("answers a remote-primary project from the ref alone", async () => {
    // No lookup, nothing async, nothing that can be cold, so the drain's
    // "pairing vanished, drop everything" branch is unreachable for these
    // projects.
    const { remoteFor } = await import("./remoteFor");
    expect(await remoteFor({ providerId: "drive", key: "folder-1" })).toEqual({
      providerId: "drive",
      key: "folder-1",
    });
    expect(pairingFor).not.toHaveBeenCalled();
  });

  it("asks the pairing for a device project, and can answer nothing", async () => {
    // The async half, and the only one that can say null: a device project
    // has a destination only if it is paired, and an unpaired one is a Local
    // project with no working copy and no queue.
    const { remoteFor } = await import("./remoteFor");
    projectIdFor.mockReturnValue("book-1");
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-9" });
    expect(await remoteFor({ providerId: "local", key: "book" })).toEqual({
      providerId: "drive",
      key: "folder-9",
    });
    // The book, not the folder it sits in.
    expect(pairingFor).toHaveBeenCalledWith("book-1");

    pairingFor.mockResolvedValue(null);
    expect(await remoteFor({ providerId: "local", key: "book" })).toBeNull();
  });

  it("resolves a caller that holds the book's id without asking the mirror", async () => {
    // The drain's records carry the id because the queue answers with no
    // library mirror: a cold shelf must not read as an unpair, or the
    // drain would drop work nobody chose to drop. `projectIdFor` throws here,
    // so a consulted mirror would fail the row.
    const { remoteFor } = await import("./remoteFor");
    projectIdFor.mockImplementation(() => {
      throw new Error("the mirror must not be consulted");
    });
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-9" });
    expect(
      await remoteFor({ providerId: "local", key: "book", id: "book-7" }),
    ).toEqual({ providerId: "drive", key: "folder-9" });
    expect(pairingFor).toHaveBeenCalledWith("book-7");
    expect(projectIdFor).not.toHaveBeenCalled();
  });

  it("answers nothing for a folder this shelf cannot name", () => {
    // A mirror not pulled yet, or a folder not on the shelf. Fail closed: an
    // unnameable project is an unpaired one, so its words go straight to disk
    // rather than to a destination guessed from an address.
    return (async () => {
      const { remoteFor } = await import("./remoteFor");
      projectIdFor.mockReturnValue(null);
      expect(await remoteFor({ providerId: "local", key: "book" })).toBeNull();
      expect(pairingFor).not.toHaveBeenCalled();
    })();
  });
});
