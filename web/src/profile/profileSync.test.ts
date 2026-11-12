// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins the app's entry point to the profile: reads and writes land in the local
// profile at once, and the merge with Drive runs at the moments it is asked
// for, and after changes once they pause or the cap after the first one runs
// out. `mergeWithDrive` is the
// real one wrapped in a spy, so a test can hold it or make it change the
// profile as another installation's copy would; no account has Drive
// connected, so the real one only reports the merge off. Timers are faked
// so the window can be crossed.

import type { RemoteProfile } from "./profileStore";

const merges = vi.hoisted(() => ({
  spy: vi.fn<(userId: string) => Promise<RemoteProfile>>(),
}));

vi.mock("./profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./profileStore")>();
  merges.spy.mockImplementation(actual.mergeWithDrive);
  return { ...actual, mergeWithDrive: (id: string) => merges.spy(id) };
});

const USER = "test-user";
const BOOK_A = "0a1b2c3d-0000-4000-8000-00000000000a";
const BOOK_B = "0a1b2c3d-0000-4000-8000-00000000000b";
const START = "2026-10-01T10:00:00.000Z";

/** Moves the faked clock on, so the next stamp is strictly newer. */
function later(ms = 1_000): void {
  vi.setSystemTime(Date.now() + ms);
}

interface StoredRow {
  name: string;
  key: string;
  at: string;
  removedAt: string | null;
  card: { title: string } | null;
}

function profile(userId = USER): {
  prefs: Record<string, { value: unknown }>;
  library: Record<string, StoredRow>;
} {
  const raw = localStorage.getItem(`profile.${userId}`);
  return raw
    ? (JSON.parse(raw) as { doc: ReturnType<typeof profile> }).doc
    : { prefs: {}, library: {} };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** Holds the next merge until the test releases it. */
function holdMerge() {
  let release!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  merges.spy.mockImplementationOnce(async () => {
    enter();
    await gate;
    return "found";
  });
  return { entered, release };
}

async function load() {
  return {
    ...(await import("./profileSync")),
    currentUser: await import("../auth/currentUser"),
    store: await import("./profileStore"),
    doc: await import("./portableDoc"),
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(START));
  vi.resetModules();
  merges.spy.mockReset();
  vi.stubGlobal("localStorage", memoryStorage());
  const { setCurrentUserId } = await import("../auth/currentUser");
  setCurrentUserId(USER);
  // The wrapped original survives `vi.resetModules`, and with it the
  // profile layer's in-memory copy, which a fresh storage stub would
  // otherwise fall back to.
  const { removeProfile } = await import("./profileStore");
  for (const id of [USER, "other-user"]) removeProfile(id);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("getPref / setPref", () => {
  it("returns the fallback when nothing has been set", async () => {
    const { getPref } = await load();
    expect(getPref("density", "grid")).toBe("grid");
  });

  it("writes the profile at once", async () => {
    const { getPref, setPref } = await load();
    setPref("density", "list");
    expect(getPref("density", "grid")).toBe("list");
    expect(profile().prefs.density.value).toBe("list");
  });

  it("keeps different writers apart", async () => {
    const { getPref, setPref, currentUser } = await load();

    setPref("density", "list");
    currentUser.setCurrentUserId("other-user");
    expect(getPref("density", "grid")).toBe("grid");
    setPref("density", "grid");

    currentUser.setCurrentUserId(USER);
    expect(getPref("density", "fallback")).toBe("list");
    expect(profile("other-user").prefs.density.value).toBe("grid");
  });

  it("with no open writer, reads the fallback and writes nothing", async () => {
    const { getPref, setPref, currentUser } = await load();
    setPref("density", "list");
    currentUser.setCurrentUserId(null);

    // The profile in storage belongs to whoever was open last.
    expect(getPref("density", "grid")).toBe("grid");
    setPref("density", "grid");
    expect(profile().prefs.density.value).toBe("list");
  });

  it("before an account is signed in, reads the fallback", async () => {
    const { setPref } = await load();
    setPref("density", "list");

    // A fresh page load: `currentUser` has not been set yet.
    vi.resetModules();
    const { getPref } = await import("./profileSync");
    expect(getPref("density", "grid")).toBe("grid");
  });
});

describe("syncProfile", () => {
  it("merges and reports an unchanged shelf, and what Remote Storage held", async () => {
    const { syncProfile } = await load();
    merges.spy.mockResolvedValueOnce("none");
    expect(await syncProfile(USER)).toEqual({
      librarySettled: true,
      membershipChanged: false,
      remote: "none",
    });
    expect(merges.spy).toHaveBeenCalledWith(USER);
  });

  it("reports a membership change another installation's copy brought", async () => {
    const { addToLibrary, libraryRows, syncProfile, store, doc } = await load();
    addToLibrary(USER, { id: BOOK_A, provider: "local", key: "a", name: "A" });
    merges.spy.mockImplementationOnce(async () => {
      store.editProfile(USER, (d) =>
        doc.applyRemove(d, BOOK_A, "2026-10-01T10:00:05.000Z"),
      );
      return "found";
    });

    expect(await syncProfile(USER)).toEqual({
      librarySettled: true,
      membershipChanged: true,
      remote: "found",
    });
    expect(libraryRows(USER)).toEqual([]);
  });

  it("shares one merge between concurrent calls for one writer", async () => {
    const { syncProfile } = await load();
    const held = holdMerge();
    const first = syncProfile(USER);
    const second = syncProfile(USER);
    await held.entered;
    held.release();
    await Promise.all([first, second]);
    expect(merges.spy).toHaveBeenCalledTimes(1);
  });

  it("with fresh, runs a merge that starts after the one in flight", async () => {
    const { syncProfile } = await load();
    const held = holdMerge();
    const running = syncProfile(USER);
    await held.entered;
    const fresh = syncProfile(USER, { fresh: true });
    held.release();
    await Promise.all([running, fresh]);
    expect(merges.spy).toHaveBeenCalledTimes(2);
  });

  it("reports unsettled when the writer changes during the merge", async () => {
    const { syncProfile, currentUser } = await load();
    const held = holdMerge();
    const sync = syncProfile(USER);
    await held.entered;
    currentUser.setCurrentUserId("other-user");
    held.release();
    expect(await sync).toEqual({
      librarySettled: false,
      membershipChanged: false,
      remote: "off",
    });
  });
});

describe("the merge after a change", () => {
  it("collapses a burst of changes into one merge once they pause", async () => {
    const { setPref, addToLibrary, MERGE_QUIET_MS } = await load();
    setPref("density", "list");
    await vi.advanceTimersByTimeAsync(MERGE_QUIET_MS - 1);
    addToLibrary(USER, { id: BOOK_A, provider: "local", key: "a", name: "A" });
    await vi.advanceTimersByTimeAsync(MERGE_QUIET_MS - 1);
    setPref("filter", "local");

    await vi.advanceTimersByTimeAsync(MERGE_QUIET_MS - 1);
    expect(merges.spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(merges.spy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MERGE_QUIET_MS * 10);
    expect(merges.spy).toHaveBeenCalledTimes(1);
  });

  it("still merges steady changes by the cap after the first one", async () => {
    const { setPref, MERGE_QUIET_MS, MERGE_AT_MOST_MS } = await load();
    const step = MERGE_QUIET_MS / 2;
    let elapsed = 0;
    for (; elapsed < MERGE_AT_MOST_MS - step; elapsed += step) {
      setPref("density", elapsed % 2 === 0 ? "list" : "grid");
      await vi.advanceTimersByTimeAsync(step);
    }
    expect(merges.spy).not.toHaveBeenCalled();
    setPref("density", "list");
    await vi.advanceTimersByTimeAsync(MERGE_AT_MOST_MS - elapsed);
    expect(merges.spy).toHaveBeenCalledTimes(1);
  });

  it("schedules the next merge for a change made while one runs", async () => {
    const { setPref, syncProfile, MERGE_AT_MOST_MS } = await load();
    const held = holdMerge();
    const sync = syncProfile(USER);
    await held.entered;
    setPref("density", "list");
    held.release();
    await sync;

    await vi.advanceTimersByTimeAsync(MERGE_AT_MOST_MS);
    expect(merges.spy).toHaveBeenCalledTimes(2);
  });

  it("is carried by a merge that starts before the window ends", async () => {
    const { setPref, syncProfile, MERGE_AT_MOST_MS } = await load();
    setPref("density", "list");
    await syncProfile(USER);
    await vi.advanceTimersByTimeAsync(MERGE_AT_MOST_MS);
    expect(merges.spy).toHaveBeenCalledTimes(1);
  });

  it("never runs for the next account", async () => {
    const { setPref, currentUser, MERGE_AT_MOST_MS } = await load();
    setPref("density", "list");
    currentUser.setCurrentUserId(null);
    await vi.advanceTimersByTimeAsync(MERGE_AT_MOST_MS);
    expect(merges.spy).not.toHaveBeenCalled();
  });

  it("is not scheduled for a write that changes nothing", async () => {
    const { addToLibrary, MERGE_AT_MOST_MS } = await load();
    const row = { id: BOOK_A, provider: "local", key: "a", name: "A" };
    addToLibrary(USER, row);
    await vi.advanceTimersByTimeAsync(MERGE_AT_MOST_MS);
    merges.spy.mockClear();

    addToLibrary(USER, row);
    await vi.advanceTimersByTimeAsync(MERGE_AT_MOST_MS);
    expect(merges.spy).not.toHaveBeenCalled();
  });
});

describe("flushProfile", () => {
  it("runs the scheduled merge now", async () => {
    const { setPref, flushProfile, MERGE_AT_MOST_MS } = await load();
    setPref("density", "list");
    await flushProfile();
    expect(merges.spy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MERGE_AT_MOST_MS);
    expect(merges.spy).toHaveBeenCalledTimes(1);
  });

  it("waits for the merge in flight when nothing is scheduled", async () => {
    const { syncProfile, flushProfile } = await load();
    const held = holdMerge();
    void syncProfile(USER);
    await held.entered;
    let flushed = false;
    const flush = flushProfile().then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    held.release();
    await flush;
    expect(merges.spy).toHaveBeenCalledTimes(1);
  });

  it("does nothing with nothing to merge", async () => {
    const { flushProfile } = await load();
    await flushProfile();
    expect(merges.spy).not.toHaveBeenCalled();
  });
});

describe("addToLibrary / removeFromLibrary", () => {
  const rowA = { id: BOOK_A, provider: "local", key: "a", name: "A" };

  it("writes the row to the profile at once", async () => {
    const { addToLibrary, libraryRows } = await load();
    addToLibrary(USER, rowA);
    expect(libraryRows(USER).map((r) => r.id)).toEqual([BOOK_A]);
    expect(profile().library[BOOK_A]).toMatchObject({
      name: "A",
      key: "a",
      at: START,
      removedAt: null,
    });
  });

  it("writes nothing for a row the profile already holds unchanged", async () => {
    // The adopt and scan flows call this for every project they touch.
    const { addToLibrary } = await load();
    addToLibrary(USER, rowA);
    const before = localStorage.getItem(`profile.${USER}`);
    later();
    addToLibrary(USER, rowA);
    expect(localStorage.getItem(`profile.${USER}`)).toBe(before);
  });

  it("moves and renames the row in place, by identity", async () => {
    const { addToLibrary, libraryRows } = await load();
    addToLibrary(USER, rowA);
    later();
    addToLibrary(USER, { ...rowA, key: "moved", name: "A renamed" });

    expect(libraryRows(USER)).toMatchObject([
      { id: BOOK_A, key: "moved", name: "A renamed" },
    ]);
    expect(profile().library[BOOK_A]).toMatchObject({
      key: "moved",
      name: "A renamed",
    });
  });

  it("removes the row and keeps a tombstone", async () => {
    const { addToLibrary, removeFromLibrary, libraryRows } = await load();
    addToLibrary(USER, rowA);
    later();
    removeFromLibrary(USER, BOOK_A);

    expect(libraryRows(USER)).toEqual([]);
    expect(profile().library[BOOK_A].removedAt).toBe(
      "2026-10-01T10:00:01.000Z",
    );
  });

  it("keeps a book added back after it was forgotten", async () => {
    const { addToLibrary, removeFromLibrary, libraryRows } = await load();
    addToLibrary(USER, rowA);
    later();
    removeFromLibrary(USER, BOOK_A);
    later();
    addToLibrary(USER, rowA);

    expect(libraryRows(USER).map((r) => r.id)).toEqual([BOOK_A]);
    expect(profile().library[BOOK_A].removedAt).toBeNull();
  });

  it("answers no rows without an account", async () => {
    const { libraryRows } = await load();
    expect(libraryRows("")).toEqual([]);
  });

  it("reduces a card to the drawn shape before the profile", async () => {
    const { addToLibrary } = await load();
    const { asCardContent } = await import("./library");
    const hostile = {
      id: BOOK_B,
      title: "B",
      type: "novel",
      words: 10,
      parts: 1,
      sections: 1,
      goal: null,
      perNode: [],
      structure: {
        version: 1,
        children: [
          {
            kind: "section" as const,
            id: "s1",
            title: "S",
            adopted: "s1.md",
            snapshots: [
              {
                file: "s1.md",
                title: "S",
                created: "2026-01-01T00:00:00.000Z",
              },
            ],
            // The summaries and bin subtrees the shelf does not draw.
            summary: "bin summary",
            bins: { removed: ["a manuscript line"] },
          },
        ],
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
      cachedAt: "2026-01-02T00:00:00.000Z",
      futureYamlField: "never rides",
    };
    addToLibrary(
      USER,
      { id: BOOK_B, provider: "local", key: "b", name: "B" },
      hostile,
    );

    const plain = (value: unknown) =>
      JSON.parse(JSON.stringify(value)) as unknown;
    expect(plain(profile().library[BOOK_B].card)).toEqual(
      plain(asCardContent(hostile)),
    );
    expect(JSON.stringify(profile())).not.toContain("a manuscript line");
  });
});

describe("rememberCard — the content-only write seam", () => {
  async function readOf(id: string, title: string) {
    const { defaultProperties } = await import("../project/properties");
    const { STRUCTURE_VERSION } = await import("../project/types");
    const props = defaultProperties(title);
    return {
      props: { ...props, document: { ...props.document, id } },
      structure: { version: STRUCTURE_VERSION, children: [] },
    };
  }

  it("hands back the card unpersisted when no row holds the book", async () => {
    const { rememberCard } = await load();
    const { props, structure } = await readOf(BOOK_A, "A");
    expect(rememberCard(USER, props, structure)?.title).toBe("A");
    expect(localStorage.getItem(`profile.${USER}`)).toBeNull();
  });

  it("writes content under the row's membership stamp", async () => {
    const { addToLibrary, rememberCard, libraryRows } = await load();
    addToLibrary(USER, { id: BOOK_A, provider: "local", key: "a", name: "A" });
    const stamp = libraryRows(USER)[0].lastSeenAt;

    later(60_000);
    const { props, structure } = await readOf(BOOK_A, "A v2");
    rememberCard(USER, props, structure, "2026-10-01T10:00:30.000Z");

    // The row shows the content; its membership stamp does not move.
    expect(libraryRows(USER)[0].card?.title).toBe("A v2");
    expect(libraryRows(USER)[0].lastSeenAt).toBe(stamp);
    expect(profile().library[BOOK_A].card?.title).toBe("A v2");
  });

  it("writes nothing for an unchanged card", async () => {
    const { addToLibrary, rememberCard } = await load();
    addToLibrary(USER, { id: BOOK_A, provider: "local", key: "a", name: "A" });
    const { props, structure } = await readOf(BOOK_A, "A");
    rememberCard(USER, props, structure);
    const before = localStorage.getItem(`profile.${USER}`);

    later();
    rememberCard(USER, props, structure);
    expect(localStorage.getItem(`profile.${USER}`)).toBe(before);
  });

  it("does not revive a row another installation removed", async () => {
    // A background read after a merge brought the removal carries no
    // membership authority.
    const { addToLibrary, rememberCard, libraryRows, store, doc } =
      await load();
    addToLibrary(USER, { id: BOOK_A, provider: "local", key: "a", name: "A" });
    later();
    store.editProfile(USER, (d) =>
      doc.applyRemove(d, BOOK_A, new Date().toISOString()),
    );
    later();
    const { props, structure } = await readOf(BOOK_A, "A v2");
    rememberCard(USER, props, structure);

    expect(profile().library[BOOK_A].removedAt).not.toBeNull();
    expect(libraryRows(USER)).toEqual([]);
  });
});

describe("renameLibraryRow", () => {
  it("follows the folder's new name and moves the row's clock", async () => {
    const { addToLibrary, renameLibraryRow, libraryRows } = await load();
    addToLibrary(USER, { id: BOOK_A, provider: "drive", key: "d1", name: "A" });
    later();
    renameLibraryRow(USER, "drive", "d1", "Renamed");

    expect(libraryRows(USER)[0].name).toBe("Renamed");
    expect(profile().library[BOOK_A].at).toBe("2026-10-01T10:00:01.000Z");
  });

  it("changes nothing for a folder the shelf does not hold, or the same name", async () => {
    const { addToLibrary, renameLibraryRow } = await load();
    addToLibrary(USER, { id: BOOK_A, provider: "drive", key: "d1", name: "A" });
    const before = localStorage.getItem(`profile.${USER}`);
    later();
    renameLibraryRow(USER, "drive", "d2", "Other");
    renameLibraryRow(USER, "drive", "d1", "A");
    expect(localStorage.getItem(`profile.${USER}`)).toBe(before);
  });
});
