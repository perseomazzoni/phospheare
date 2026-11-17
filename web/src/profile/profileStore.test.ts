// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortableDoc } from "./portableDoc";

// Pins the writer's portable profile store: the local copy per writer, and
// the merge with every installation's copy in Drive's application data.
// Drive is stubbed at `portableDrive.ts`, and the registry at
// `findWriter`, so a row can connect Drive without a real grant.

interface Listed {
  fileId: string;
  installation: string;
  modifiedTime?: string | null;
  md5?: string | null;
}

const drive = vi.hoisted(() => ({
  list: vi.fn<() => Promise<Listed[]>>(),
  read: vi.fn<(fileId: string) => Promise<unknown>>(),
  write:
    vi.fn<
      (
        installation: string,
        json: string,
        fileId: string | null,
      ) => Promise<string>
    >(),
  remove: vi.fn<(fileId: string) => Promise<void>>(),
  syncing: new Set<string>(),
}));

vi.mock("./portableDrive", () => ({
  // A listing without a checksum is one the merge must read.
  listProfileCopies: async () =>
    (await drive.list()).map((copy) => ({
      modifiedTime: null,
      md5: null,
      ...copy,
    })),
  readProfileCopy: (fileId: string) => drive.read(fileId),
  writeProfileCopy: (
    installation: string,
    json: string,
    fileId: string | null,
  ) => drive.write(installation, json, fileId),
  deleteProfileCopy: (fileId: string) => drive.remove(fileId),
}));
vi.mock("../writers/registry", () => ({
  findWriter: (id: string) =>
    drive.syncing.has(id)
      ? { id, drive: { connectionId: "conn" } }
      : { id, drive: null },
}));

const W = "writer-a";
const OWN = "mmmmmmmm";
const A = "0a1b2c3d-0000-4000-8000-00000000000a";
const B = "0a1b2c3d-0000-4000-8000-00000000000b";
const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:00:01.000Z";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

async function load() {
  vi.resetModules();
  const currentUser = await import("../auth/currentUser");
  currentUser.setCurrentUserId(W);
  const store = await import("./profileStore");
  const { applyAdd, applyPref, applyRemove } = await import("./portableDoc");
  /** One preference write, as `setPref` makes it. */
  const pref = (writer: string, key: string, value: unknown, at = T0) =>
    store.editProfile(writer, (doc) =>
      applyPref(doc, key, { value, updatedAt: at }),
    );
  /** The merge, then the preferences it left. */
  const merged = async (writer = W) => {
    await store.mergeWithDrive(writer);
    return store.profileDoc(writer).prefs;
  };
  return { ...store, applyAdd, applyRemove, pref, merged, currentUser };
}

/** Another installation's copy, as Drive lists and serves it. */
function remote(
  installation: string,
  body: Partial<PortableDoc>,
  md5: string | null = null,
): void {
  const fileId = `file-${installation}`;
  const listed = drive.list.getMockImplementation();
  drive.list.mockImplementation(async () => [
    ...((await listed?.()) ?? []),
    { fileId, installation, md5 },
  ]);
  const read = drive.read.getMockImplementation();
  drive.read.mockImplementation(async (id: string) =>
    id === fileId
      ? { v: 1, installation, prefs: {}, library: {}, ...body }
      : read?.(id),
  );
}

function stored(writerId = W): {
  doc: PortableDoc;
  fileId: string | null;
  uploadedSum: string | null;
  mergedSums: Record<string, string>;
  syncedAt: string | null;
} {
  return JSON.parse(localStorage.getItem(`profile.${writerId}`) ?? "null") as {
    doc: PortableDoc;
    fileId: string | null;
    uploadedSum: string | null;
    mergedSums: Record<string, string>;
    syncedAt: string | null;
  };
}

/** The body of the `n`th upload. */
function uploaded(n = 0): PortableDoc {
  return JSON.parse(drive.write.mock.calls[n][1]) as PortableDoc;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  localStorage.setItem("installation", OWN);
  drive.list.mockReset().mockResolvedValue([]);
  drive.read.mockReset().mockResolvedValue(null);
  drive.write.mockReset().mockResolvedValue(`file-${OWN}`);
  drive.remove.mockReset().mockResolvedValue(undefined);
  drive.syncing.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe("the local copy", () => {
  it("keeps preferences per writer, under the writer's own key", async () => {
    const { pref, merged, profileSyncState } = await load();
    pref(W, "density", "list");
    pref("writer-b", "density", "grid");

    expect((await merged(W)).density.value).toBe("list");
    expect((await merged("writer-b")).density.value).toBe("grid");
    expect(stored(W).doc.prefs.density.value).toBe("list");
    expect(profileSyncState(W)).toEqual({ kind: "off" });
    expect(drive.list).not.toHaveBeenCalled();
  });

  it("keeps the newest entry per key", async () => {
    const { pref, profileDoc } = await load();
    pref(W, "density", "list", T1);
    pref(W, "density", "grid", T0);
    pref(W, "filter", "local", T0);
    const prefs = profileDoc(W).prefs;
    expect(prefs.density.value).toBe("list");
    expect(prefs.filter.value).toBe("local");
  });

  it("drops a value outside the preference domain", async () => {
    const { pref, profileDoc } = await load();
    pref(W, "theme", "dark");
    pref(W, "endpoint", "http://localhost:11434");
    expect(profileDoc(W).prefs).toEqual({});
  });

  it("adds, lists and tombstones library rows", async () => {
    const { editProfile, applyAdd, applyRemove, profileRows } = await load();
    editProfile(W, (doc) =>
      applyAdd(doc, {
        id: A.toUpperCase(),
        provider: "local",
        key: "folder",
        name: "Book",
        at: T0,
      }),
    );
    expect(profileRows(W)).toMatchObject([
      { id: A, name: "Book", lastSeenAt: T0 },
    ]);

    editProfile(W, (doc) => applyRemove(doc, A, T1));
    expect(profileRows(W)).toEqual([]);
    expect(stored().doc.library[A].removedAt).toBe(T1);
  });

  it("hands back the same parsed profile until the stored string changes", async () => {
    const { pref, profileDoc, profileRows } = await load();
    pref(W, "density", "list");
    expect(profileDoc(W)).toBe(profileDoc(W));
    expect(profileRows(W)).toBe(profileRows(W));

    // Another tab's write changes the string, and the next read sees it.
    const other = stored();
    other.doc.prefs.density = { value: "grid", updatedAt: T1 };
    localStorage.setItem(`profile.${W}`, JSON.stringify(other));
    expect(profileDoc(W).prefs.density.value).toBe("grid");
  });

  it("tells the log once a session that the stored settings are damaged", async () => {
    localStorage.setItem(`profile.${W}`, "{ not json");
    const { profileDoc } = await load();
    const { appLog } = await import("../log");
    const error = vi.spyOn(appLog, "error");
    expect(profileDoc(W).prefs).toEqual({});
    expect(profileDoc(W).prefs).toEqual({});
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "profile",
      expect.any(String),
      expect.objectContaining({ bytes: 10, error: expect.any(String) }),
    );
  });

  it("ignores a stored profile it cannot read", async () => {
    localStorage.setItem(`profile.${W}`, JSON.stringify({ doc: { v: 2 } }));
    const { profileDoc, pref } = await load();
    expect(profileDoc(W).prefs).toEqual({});
    pref(W, "density", "list");
    expect(stored().doc.prefs.density.value).toBe("list");
  });

  it("keeps the installation id it was given and makes one when there is none", async () => {
    const first = await load();
    expect(first.installationId()).toBe(OWN);

    localStorage.removeItem("installation");
    const second = await load();
    const made = second.installationId();
    expect(made).toMatch(/^[a-z0-9]{12}$/);
    expect(localStorage.getItem("installation")).toBe(made);
  });

  it("removes a writer's copy on request", async () => {
    const { pref, removeProfile, merged } = await load();
    pref(W, "density", "list");
    removeProfile(W);
    expect(localStorage.getItem(`profile.${W}`)).toBeNull();
    expect(await merged(W)).toEqual({});
  });

  it("refuses writes for a purged account until the account changes", async () => {
    const { pref, currentUser } = await load();
    const { markUserPurged } = await import("./purgeLatch");
    markUserPurged(W);
    pref(W, "density", "list");
    expect(localStorage.getItem(`profile.${W}`)).toBeNull();

    currentUser.setCurrentUserId("writer-b");
    currentUser.setCurrentUserId(W);
    pref(W, "density", "list");
    expect(stored().doc.prefs.density.value).toBe("list");
  });
});

describe("the merge with Drive", () => {
  it("reports what Remote Storage held: copies, none, or no answer", async () => {
    const { mergeWithDrive } = await load();
    expect(await mergeWithDrive(W)).toBe("off");

    drive.syncing.add(W);
    expect(await mergeWithDrive(W)).toBe("none");

    remote("rrrrrrrr", {});
    expect(await mergeWithDrive(W)).toBe("found");

    drive.list.mockRejectedValueOnce(new Error("offline"));
    expect(await mergeWithDrive(W)).toBe("unreachable");
  });

  it("merges every other installation's copy and writes back its own", async () => {
    drive.syncing.add(W);
    remote("rrrrrrrr", {
      prefs: { language: { value: "it", updatedAt: T0 } },
      library: {
        [B]: {
          id: B,
          provider: "drive",
          key: "folderB",
          name: "Remote book",
          openedAt: T0,
          at: T0,
          removedAt: null,
          card: null,
        },
      },
    });
    const { pref, merged, profileRows, profileSyncState } = await load();
    pref(W, "density", "list");

    const prefs = await merged();

    expect(prefs.language.value).toBe("it");
    expect(prefs.density.value).toBe("list");
    expect(profileRows(W).map((r) => r.id)).toEqual([B]);
    expect(drive.write).toHaveBeenCalledTimes(1);
    const [installation, , fileId] = drive.write.mock.calls[0];
    expect(installation).toBe(OWN);
    expect(fileId).toBeNull();
    expect(uploaded().prefs.language.value).toBe("it");
    expect(stored().fileId).toBe(`file-${OWN}`);
    expect(profileSyncState(W)).toMatchObject({ kind: "synced" });
  });

  it("reads its own copy before updating it in place, when it does not know it", async () => {
    drive.syncing.add(W);
    drive.list.mockResolvedValue([{ fileId: "own-file", installation: OWN }]);
    const { pref, merged } = await load();
    pref(W, "density", "list");
    await merged();

    expect(drive.read).toHaveBeenCalledWith("own-file");
    expect(drive.write.mock.calls[0][2]).toBe("own-file");
  });

  it("keeps the newest of its own copies and deletes the others", async () => {
    drive.syncing.add(W);
    drive.list.mockResolvedValue([
      { fileId: "own-old", installation: OWN, modifiedTime: T0 },
      { fileId: "own-new", installation: OWN, modifiedTime: T1 },
      { fileId: "own-older", installation: OWN, modifiedTime: T0 },
    ]);
    drive.read.mockImplementation(async (id: string) =>
      id === "own-old"
        ? {
            v: 1,
            installation: OWN,
            prefs: { language: { value: "it", updatedAt: T0 } },
            library: {},
          }
        : null,
    );
    drive.write.mockImplementation(async (_, __, fileId) => fileId ?? "new");
    drive.remove.mockRejectedValueOnce(new Error("Google Drive is gone."));
    const { merged, profileSyncState } = await load();

    const prefs = await merged();

    expect(prefs.language.value).toBe("it");
    expect(drive.write).toHaveBeenCalledTimes(1);
    expect(drive.write.mock.calls[0][2]).toBe("own-new");
    expect(drive.remove.mock.calls.map(([id]) => id).sort()).toEqual([
      "own-old",
      "own-older",
    ]);
    expect(stored().fileId).toBe("own-new");
    expect(profileSyncState(W)).toMatchObject({ kind: "synced" });
  });

  it("uploads only when the merged content changed", async () => {
    drive.syncing.add(W);
    const { pref, merged } = await load();
    pref(W, "density", "list");
    await merged();
    drive.list.mockResolvedValue([
      { fileId: `file-${OWN}`, installation: OWN },
    ]);

    await merged();
    expect(drive.write).toHaveBeenCalledTimes(1);

    pref(W, "density", "grid", T1);
    await merged();
    expect(drive.write).toHaveBeenCalledTimes(2);
    expect(drive.write.mock.calls[1][2]).toBe(`file-${OWN}`);
  });

  it("writes its copy again when the listing lacks it, changed or not", async () => {
    drive.syncing.add(W);
    const { pref, merged } = await load();
    pref(W, "density", "list");
    await merged();

    await merged();
    expect(drive.write).toHaveBeenCalledTimes(2);
    expect(drive.write.mock.calls[1][2]).toBe(`file-${OWN}`);
    expect(uploaded(1).prefs.density.value).toBe("list");
  });

  it("takes turns with the browser's other tabs for the account", async () => {
    drive.syncing.add(W);
    const request = vi.fn(
      (_name: string, _options: unknown, merge: () => Promise<void>) => merge(),
    );
    vi.stubGlobal("navigator", { locks: { request }, onLine: true });
    const { pref, merged } = await load();
    pref(W, "density", "list");
    await merged();

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe(`profile.merge.${W}`);
    expect(drive.write).toHaveBeenCalledOnce();
  });

  it("reads a copy again while it holds a value this build refused", async () => {
    drive.syncing.add(W);
    remote(
      "rrrrrrrr",
      {
        prefs: {
          language: { value: "it", updatedAt: T0 },
          density: { value: "a-later-density", updatedAt: T0 },
        },
      },
      "m1",
    );
    const { merged } = await load();
    expect((await merged()).language.value).toBe("it");
    await merged();
    expect(drive.read).toHaveBeenCalledTimes(2);
    expect(stored().mergedSums).toEqual({});
  });

  it("stores a checksum of the upload, not the uploaded text", async () => {
    drive.syncing.add(W);
    const { pref, merged } = await load();
    pref(W, "density", "list");
    await merged();

    expect(stored().uploadedSum).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(stored())).not.toContain("uploaded");
  });

  it("skips its own copy once it wrote it, and a copy unchanged since the last merge", async () => {
    drive.syncing.add(W);
    remote(
      "rrrrrrrr",
      { prefs: { language: { value: "it", updatedAt: T0 } } },
      "m1",
    );
    const { merged } = await load();
    await merged();
    expect(drive.read.mock.calls.map(([id]) => id)).toEqual(["file-rrrrrrrr"]);

    drive.read.mockClear();
    const listed = drive.list.getMockImplementation();
    drive.list.mockImplementation(async () => [
      ...((await listed?.()) ?? []),
      { fileId: `file-${OWN}`, installation: OWN, md5: "own" },
    ]);
    expect((await merged()).language.value).toBe("it");
    expect(drive.read).not.toHaveBeenCalled();

    drive.list.mockResolvedValue([
      { fileId: "file-rrrrrrrr", installation: "rrrrrrrr", md5: "m2" },
      { fileId: `file-${OWN}`, installation: OWN, md5: "own" },
    ]);
    await merged();
    expect(drive.read.mock.calls.map(([id]) => id)).toEqual(["file-rrrrrrrr"]);
  });

  it("reads a copy again while it holds an entry stamped ahead of this device", async () => {
    drive.syncing.add(W);
    const ahead = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    remote(
      "rrrrrrrr",
      { prefs: { language: { value: "it", updatedAt: ahead } } },
      "m1",
    );
    const { merged } = await load();
    expect((await merged()).language).toBeUndefined();
    await merged();
    expect(drive.read).toHaveBeenCalledTimes(2);
    expect(stored().mergedSums).toEqual({});
  });

  it("reads the other copies in parallel", async () => {
    drive.syncing.add(W);
    drive.list.mockResolvedValue([
      { fileId: "file-rrrrrrrr", installation: "rrrrrrrr", md5: "r" },
      { fileId: "file-ssssssss", installation: "ssssssss", md5: "s" },
    ]);
    const answers: (() => void)[] = [];
    drive.read.mockImplementation(
      (id: string) =>
        new Promise((resolve) =>
          answers.push(() =>
            resolve({
              v: 1,
              installation: id.slice(5),
              prefs: {},
              library: {},
            }),
          ),
        ),
    );
    const { merged } = await load();
    const sync = merged();
    await vi.waitFor(() => expect(drive.read).toHaveBeenCalledTimes(2));
    for (const answer of answers) answer();
    await sync;
    expect(stored().mergedSums).toEqual({
      "file-rrrrrrrr": "r",
      "file-ssssssss": "s",
    });
  });

  it("keeps whichever edit is newer, this device's or another's", async () => {
    drive.syncing.add(W);
    remote("rrrrrrrr", {
      prefs: { density: { value: "grid", updatedAt: T0 } },
    });
    const { pref, merged } = await load();
    pref(W, "density", "list", T1);

    expect((await merged()).density.value).toBe("list");
  });

  it("takes a copy's installation from its file name, not its body", async () => {
    // A copy cannot claim a larger installation id to win every tie.
    drive.syncing.add(W);
    remote("aaaaaaaa", {
      installation: "zzzzzzzz",
      prefs: { density: { value: "grid", updatedAt: T0 } },
    });
    const { pref, merged } = await load();
    pref(W, "density", "list");
    expect((await merged()).density.value).toBe("list");
  });

  it("ignores a copy that is not a profile, and validates the rest", async () => {
    drive.syncing.add(W);
    remote("rrrrrrrr", {
      prefs: {
        density: { value: "grid", updatedAt: T0 },
        endpoint: { value: "http://evil.example", updatedAt: T0 },
      },
    });
    drive.list.mockResolvedValue([
      ...(await drive.list()),
      { fileId: "junk", installation: "jjjjjjjj" },
    ]);
    const { merged } = await load();
    expect(await merged()).toEqual({
      density: { value: "grid", updatedAt: T0 },
    });
  });

  it("keeps edits made while the merge ran", async () => {
    drive.syncing.add(W);
    let land!: (fileId: string) => void;
    drive.write.mockImplementationOnce(
      () => new Promise<string>((resolve) => (land = resolve)),
    );
    const { pref, merged } = await load();
    const sync = merged();
    await vi.waitFor(() => expect(drive.write).toHaveBeenCalled());
    pref(W, "density", "list", T1);
    land(`file-${OWN}`);

    expect((await sync).density.value).toBe("list");
    expect(stored().doc.prefs.density.value).toBe("list");
  });

  it.each([
    [false, "offline"],
    [true, "drive"],
  ] as const)(
    "pauses with navigator.onLine %s as %s, and serves the local copy",
    async (onLine, reason) => {
      drive.syncing.add(W);
      vi.stubGlobal("navigator", { onLine });
      drive.list.mockRejectedValue(
        new Error("Google Drive refused that request."),
      );
      const { pref, merged, profileSyncState } = await load();
      pref(W, "density", "list");

      expect((await merged()).density.value).toBe("list");
      expect(profileSyncState(W)).toEqual({ kind: "paused", reason });
    },
  );

  it("aborts when the writer changes while the copies are listed", async () => {
    drive.syncing.add(W);
    let answer!: (copies: Listed[]) => void;
    drive.list.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const { mergeWithDrive, profileSyncState, currentUser } = await load();
    const sync = mergeWithDrive(W);
    await vi.waitFor(() => expect(drive.list).toHaveBeenCalled());
    currentUser.setCurrentUserId("writer-b");
    answer([{ fileId: "file-rrrrrrrr", installation: "rrrrrrrr" }]);
    await sync;

    expect(drive.read).not.toHaveBeenCalled();
    expect(drive.write).not.toHaveBeenCalled();
    expect(profileSyncState(W).kind).not.toBe("synced");
  });

  it("aborts when the writer changes while a copy is read", async () => {
    drive.syncing.add(W);
    remote("rrrrrrrr", { prefs: { language: { value: "it", updatedAt: T0 } } });
    const { merged, currentUser } = await load();
    const read = drive.read.getMockImplementation();
    if (!read) throw new Error("drive.read has no implementation");
    drive.read.mockImplementationOnce(async (id: string) => {
      currentUser.setCurrentUserId("writer-b");
      return read(id);
    });

    expect(await merged()).toEqual({});
    expect(drive.write).not.toHaveBeenCalled();
    expect(localStorage.getItem(`profile.${W}`)).toBeNull();
  });

  it("does not store the merge when the writer changes during the upload", async () => {
    drive.syncing.add(W);
    remote("rrrrrrrr", { prefs: { language: { value: "it", updatedAt: T0 } } });
    const { mergeWithDrive, currentUser } = await load();
    drive.write.mockImplementationOnce(async () => {
      currentUser.setCurrentUserId("writer-b");
      return `file-${OWN}`;
    });
    await mergeWithDrive(W);
    expect(localStorage.getItem(`profile.${W}`)).toBeNull();
  });

  it("does not touch Drive for an account without it", async () => {
    const { mergeWithDrive } = await load();
    await mergeWithDrive(W);
    expect(drive.list).not.toHaveBeenCalled();
  });
});

describe("profile recovery", () => {
  it("recovers the own remote copy after a sign-out purged it locally", async () => {
    drive.syncing.add(W);
    remote(OWN, { prefs: { language: { value: "it", updatedAt: T0 } } });
    const { merged } = await load();
    expect((await merged()).language.value).toBe("it");
    expect(drive.write.mock.calls[0][2]).toBe(`file-${OWN}`);
    expect(uploaded().prefs.language.value).toBe("it");
  });

  it("retains the newest in-memory profile and reports a failed durable write", async () => {
    const { pref, profileDoc, profileDurable } = await load();
    pref(W, "density", "list");
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
    expect(pref(W, "density", "grid", T1)).toBe(false);
    expect(profileDoc(W).prefs.density.value).toBe("grid");
    expect(profileDurable(W)).toBe(false);
    localStorage.setItem = setItem;
    expect(pref(W, "filter", "local")).toBe(true);
    expect(profileDurable(W)).toBe(true);
    expect(stored().doc.prefs.density.value).toBe("grid");
  });

  it("keeps an edit when storage held nothing for the account and refuses to save", async () => {
    const { editProfile, applyAdd, applyRemove, profileRows } = await load();
    localStorage.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
    expect(
      editProfile(W, (doc) =>
        applyAdd(doc, {
          id: A,
          provider: "drive",
          key: "folder",
          name: "Book",
          at: T0,
        }),
      ),
    ).toBe(false);
    expect(profileRows(W).map((r) => r.id)).toEqual([A]);
    expect(editProfile(W, (doc) => applyRemove(doc, A, T1))).toBe(false);
    expect(profileRows(W)).toEqual([]);
  });
});
