// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import {
  StorageError,
  type ProjectRef,
  type StorageProvider,
} from "../../storage/types";
import type { Connections } from "../../storage";
import type { IconName } from "../../ui/icons";
import {
  defaultProperties,
  serializeProperties,
} from "../../project/properties";
import { serializeStructure } from "../../project/structure";
import { STRUCTURE_VERSION } from "../../project/types";

// Mocked for the language-change row, which swaps `t`'s identity mid-test.
// No other row reads `t`, and the default (echo the key)
// matches the real library's fallback with no instance, so it changes
// nothing for them.
let mockT: (key: string, vars?: Record<string, unknown>) => string = (key) =>
  key;
vi.mock("react-i18next", () => ({
  // `t: mockT` directly, not a wrapping arrow: a wrapper would be a fresh
  // reference on every `useTranslation()` call, so `t` would look unstable on
  // every render, unlike real react-i18next. Reassigning the module-level
  // `mockT` between renders simulates a language change.
  useTranslation: () => ({ t: mockT }),
}));

// ── Fakes for both providers ─────────────────────────────────────────────────
//
// `localProvider` needs the real File System Access API, and `driveProvider`
// needs a live Drive or the `mockDrive.fixture.ts` fetch fake, so both are
// mocked whole. This file covers what `useProjects` does with what a provider
// reports; each provider's internals have their own test files.
//
// The membership and the card content are one store, the account's profile,
// which runs for real against a `localStorage` stub, with a fresh fake
// IndexedDB per test for the device stores. Running them for real proves
// the hook integrates with them.
const canAccessLocal = vi.fn();
const readFileLocal = vi.fn();
const canAccessDrive = vi.fn();
const readFileDrive = vi.fn();
const listDriveProjects = vi.fn();
const rootPermission = vi.fn();
const ensureLocalRoot = vi.fn();
const listLocalProjects = vi.fn();
const getLocalRoot = vi.fn();
const forgetLocalRoot = vi.fn();
// A spy, not a full mock: `profileSync`'s own functions (`rememberCard`,
// `addToLibrary`, `removeFromLibrary`) run for real against the real
// profile. Only `syncProfile` is watched, to prove the gather never runs the
// merge itself; `SessionGate` and the reveal gate own it.
const syncProfileSpy = vi.fn();
vi.mock("../../profile/profileSync", async () => {
  const actual = await vi.importActual<
    typeof import("../../profile/profileSync")
  >("../../profile/profileSync");
  return {
    ...actual,
    syncProfile: (userId: string) => {
      syncProfileSpy(userId);
      return actual.syncProfile(userId);
    },
  };
});

// The same for `allPairings`: real behaviour, which other rows rely on
// (`pair()`, dedup), with a call count exposed to prove a superseded gather
// never starts its own work, rather than starting and discarding its results.
const allPairingsSpy = vi.fn();
vi.mock("../../project/sync/pairing", async () => {
  const actual = await vi.importActual<
    typeof import("../../project/sync/pairing")
  >("../../project/sync/pairing");
  return {
    ...actual,
    allPairings: (...args: Parameters<typeof actual.allPairings>) => {
      allPairingsSpy(...args);
      return actual.allPairings(...args);
    },
  };
});

// The same for `checkSync`: real behaviour, where every check comes back
// clean against the stub providers, with call timing exposed to prove the
// background sync pass runs after the card reads settle instead of competing
// with them for the connection budget.
const checkSyncSpy = vi.fn();
vi.mock("../../project/sync/check", async () => {
  const actual = await vi.importActual<
    typeof import("../../project/sync/check")
  >("../../project/sync/check");
  return {
    ...actual,
    checkSync: (...args: Parameters<typeof actual.checkSync>) => {
      checkSyncSpy(...args);
      return actual.checkSync(...args);
    },
  };
});

function stubProvider(
  id: string,
  kind: StorageProvider["kind"],
  canAccess: typeof canAccessLocal,
  readFile: typeof readFileLocal,
): StorageProvider {
  return {
    id,
    kind,
    label: () => id,
    icon: "mark" as IconName,
    isAvailable: () => true,
    reopenProject: async () => true,
    canAccess: (ref) => canAccess(ref),
    listDir: async () => [],
    exists: async () => true,
    readFile: (ref, path) => readFile(ref, path),
    writeFile: async () => {},
    createDir: async () => {},
    renameFile: async () => {},
    moveFile: async () => {},
    removeFile: async () => {},
    fingerprintFile: async () => ({ hash: "fake" }),
    fingerprintDir: async () => new Map(),
  };
}

const localProviderFake = stubProvider(
  "local",
  "device",
  canAccessLocal,
  readFileLocal,
);
// "remote", so the pairing sweep resolves it as a destination: the queue and
// the conflict check both ask the registry for a remote provider.
const driveProviderFake = stubProvider(
  "drive",
  "remote",
  canAccessDrive,
  readFileDrive,
);

vi.mock("../../storage", () => ({
  StorageError,
  localProvider: localProviderFake,
  driveProvider: driveProviderFake,
  getProvider: (id: string) =>
    id === "local"
      ? localProviderFake
      : id === "drive"
        ? driveProviderFake
        : null,
  isRemoteRef: (ref: { providerId: string }) => ref.providerId === "drive",
  connectionFor: (id: string) =>
    id === "local"
      ? {
          id: "local",
          label: () => "local",
          icon: "mark" as IconName,
          reconnect: async () =>
            (await ensureLocalRoot()) !== null ? "granted" : "cancelled",
        }
      : id === "drive"
        ? {
            id: "drive",
            label: () => "drive",
            icon: "mark" as IconName,
            reconnect: async () => "granted",
          }
        : null,
  listDriveProjects: (...args: unknown[]) => listDriveProjects(...args),
  rootPermission: () => rootPermission(),
  ensureLocalRoot: () => ensureLocalRoot(),
  listLocalProjects: () => listLocalProjects(),
  getLocalRoot: () => getLocalRoot(),
  forgetLocalRoot: () => forgetLocalRoot(),
}));

// The storage a gather reads a book through. The working copy has its own
// tests and needs OPFS, which jsdom lacks, so by default this hands back the
// bare provider; the working-copy row swaps in its own.
const openProjectStorage = vi.fn();
const openBare = async (ref: ProjectRef) => ({
  storage: ref.providerId === "drive" ? driveProviderFake : localProviderFake,
  dispose: () => {},
});
vi.mock("../../project/projectStorage", () => ({
  openProjectStorage: (...args: unknown[]) => openProjectStorage(...args),
}));

const conns = (
  driveState: "connected" | "unset" = "unset",
  driveResolved = true,
  localState: "connected" | "unset" | "needs-gesture" = "connected",
  localResolved = true,
) =>
  ({
    drive: { state: driveState, resolved: driveResolved },
    local: {
      state: localState,
      resolved: localResolved,
      // The verbs mirror the real connection's: the pick and the forget,
      // wired to the file's mocks. `refresh` returns the settled verdict, as
      // the real one does.
      connect: async () => (await ensureLocalRoot()) !== null,
      disconnect: async () => {
        await forgetLocalRoot();
      },
      refresh: async () => localState,
    },
  }) as unknown as Connections;

const { useProjects, openableId } = await import("./useProjects");
import type { ProjectCard } from "./useProjects";
const { pair } = await import("../../project/sync/pairing");
const { rememberCard } = await import("../../profile/profileSync");
const { libraryRows } = await import("../../profile/profileSync");
const { editProfile, profileDoc } = await import("../../profile/profileStore");
const { applyAdd } = await import("../../profile/portableDoc");

beforeEach(async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage);
  vi.stubGlobal("indexedDB", new IDBFactory());

  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId("u1");
  mockT = (key) => key;

  canAccessLocal.mockReset().mockResolvedValue("granted");
  readFileLocal.mockReset();
  canAccessDrive.mockReset().mockResolvedValue("granted");
  readFileDrive.mockReset();
  listDriveProjects.mockReset().mockResolvedValue([]);
  // No root by default: the handle effect answers "not chosen", and the
  // sweep's own rows set the gate explicitly.
  rootPermission.mockReset().mockResolvedValue("needs-gesture");
  // The picker is cancelled by default; reconnect and scan rows opt into a
  // pick.
  ensureLocalRoot.mockReset().mockResolvedValue(null);
  listLocalProjects.mockReset().mockResolvedValue([]);
  getLocalRoot.mockReset().mockResolvedValue(null);
  forgetLocalRoot.mockReset().mockResolvedValue(undefined);
  syncProfileSpy.mockReset();
  openProjectStorage.mockReset().mockImplementation(openBare);
  allPairingsSpy.mockReset();
  checkSyncSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ref = (providerId: string, key: string, name = key): ProjectRef => ({
  providerId,
  key,
  name,
  openedAt: "2026-07-28T10:00:00.000Z",
});

/** A readFile mock good enough for `read()` to reach `state: 'ready'`. */
function readableContent(title: string) {
  return (ref: ProjectRef, path: string) => {
    if (path === "/document-properties.json") {
      // The id the fixtures agree on for this folder. `defaultProperties`
      // mints a random one, and the library row is keyed by this id,
      // so a fresh one on every read would make each read a different book.
      const props = defaultProperties(title);
      return Promise.resolve(
        serializeProperties({
          ...props,
          document: { ...props.document, id: bookId(ref.key) },
        }),
      );
    }
    if (path === "/document-structure.yaml") {
      return Promise.resolve(
        serializeStructure({ version: STRUCTURE_VERSION, children: [] }),
      );
    }
    return Promise.reject(
      new StorageError("unexpected path in test", "not-found"),
    );
  };
}

/**
 * Like `readableContent`, but the properties-file read hangs until its
 * resolver is invoked; the structure-file read answers immediately. `read()`
 * in `useProjects.ts` reads properties then structure per candidate, so
 * gating only the first keeps one release to one item admitted. Gating both
 * would count each item's two reads as two concurrent candidates.
 */
function gatedReadableContent(title: string, releases: (() => void)[]) {
  return (_ref: ProjectRef, path: string) => {
    if (path === "/document-properties.json") {
      return new Promise<string>((resolve) => {
        releases.push(() =>
          resolve(serializeProperties(defaultProperties(title))),
        );
      });
    }
    if (path === "/document-structure.yaml") {
      return Promise.resolve(
        serializeStructure({ version: STRUCTURE_VERSION, children: [] }),
      );
    }
    return Promise.reject(
      new StorageError("unexpected path in test", "not-found"),
    );
  };
}

/**
 * The identity every fixture agrees on for one folder: the row's key, the
 * card's `id`, and what a read of that folder's properties file says.
 */
function bookId(key: string) {
  // The profile keys rows by the project uuid and drops any other id, so the
  // key is folded into one.
  let hex = "";
  for (let seed = 0; hex.length < 32; seed++) {
    let h = 0x811c9dc5 ^ seed;
    for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    hex += (h >>> 0).toString(16).padStart(8, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** A row on the shelf, as an earlier session left it in the profile. */
function shelve(row: {
  id: string;
  provider: string;
  key: string;
  name: string;
  openedAt: string;
  card: ReturnType<typeof makeCard>;
}) {
  editProfile("u1", (doc) =>
    applyAdd(doc, {
      id: row.id,
      provider: row.provider,
      key: row.key,
      name: row.name,
      at: row.openedAt,
      card: row.card,
    }),
  );
}

function makeCard(title: string, cachedAt = "2026-07-28T10:00:00.000Z") {
  return {
    id: `doc-${title}`,
    title,
    type: "Novel",
    words: 12,
    parts: 1,
    sections: 1,
    goal: null,
    perNode: [],
    structure: { version: STRUCTURE_VERSION, children: [] },
    updatedAt: cachedAt,
    cachedAt,
  };
}

/**
 * Seed the profile with a row whose card carries what a successful read
 * would have left. The rows are the shelf's candidate source and the row's
 * card its decoration.
 */
function seedCache(key: string, title: string) {
  const [providerId, ...rest] = key.split(":");
  const id = rest.join(":");
  const row = {
    id: bookId(id),
    provider: providerId,
    key: id,
    name: title,
    openedAt: "2026-07-28T10:00:00.000Z",
    lastSeenAt: null,
    removedAt: null,
    card: { ...makeCard(title), id: bookId(id) },
  };
  shelve(row);
}

describe("initial candidates", () => {
  it("starts from the project cache, before the first gather resolves", () => {
    seedCache("local:a", "Once Dark");
    const { result } = renderHook(() => useProjects("u1", conns()));
    expect(result.current.cards.map((c) => c.ref.key)).toEqual(["a"]);
    expect(result.current.cards[0].state).toBe("loading");
  });
});

describe("gather â€” disconnected", () => {
  it("reads cached candidates and settles them to ready", async () => {
    seedCache("local:a", "Once Dark");
    readFileLocal.mockImplementation(readableContent("Once Dark"));

    const { result } = renderHook(() => useProjects("u1", conns()));

    await waitFor(() => expect(result.current.listing).toBe(false));
    await waitFor(() => expect(result.current.cards[0]?.state).toBe("ready"));
    expect(result.current.cards[0].content?.title).toBe("Once Dark");
  });

  it("does not attempt a Drive listing at all", async () => {
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(listDriveProjects).not.toHaveBeenCalled();
  });
});

describe("gather â€” connected", () => {
  it("reads cached candidates including Drive projects", async () => {
    seedCache("local:a", "Local Project");
    seedCache("drive:folder-1", "Drive Project");
    readFileLocal.mockImplementation(readableContent("Local Project"));
    readFileDrive.mockImplementation(readableContent("Drive Project"));

    const { result } = renderHook(() => useProjects("u1", conns("connected")));

    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(new Set(result.current.cards.map((c) => c.ref.key))).toEqual(
      new Set(["a", "folder-1"]),
    );
  });

  it("dedupes a Drive folder that is the synced half of a local project", async () => {
    seedCache("local:a", "Paired Project");
    await pair(bookId("a"), { providerId: "drive", key: "folder-1" });
    readFileLocal.mockImplementation(readableContent("Paired Project"));

    const { result } = renderHook(() => useProjects("u1", conns("connected")));

    await waitFor(() => expect(result.current.listing).toBe(false));
    // Only the `local:a` card: `folder-1` is the paired half, not a second
    // project. The synced set names the book, not its address.
    expect(result.current.synced.has(bookId("a"))).toBe(true);
  });

  it("skips the sync check for a pairing whose backend this build lacks", async () => {
    // A pairing names its provider, so it can outlive the adapter
    // that wrote it. The sweep skips that project rather than throwing: one
    // unresolvable pairing does not take down the shelf's conflict check, and
    // the card is still readable on disk.
    seedCache("local:a", "Orphaned Pairing");
    await pair(bookId("a"), { providerId: "dropbox", key: "folder-1" });
    readFileLocal.mockImplementation(readableContent("Orphaned Pairing"));

    const { result } = renderHook(() => useProjects("u1", conns("connected")));

    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(checkSyncSpy).not.toHaveBeenCalled();
    expect(result.current.cards.map((c) => c.state)).toEqual(["ready"]);
  });

  // The gather never runs the merge with Drive itself; `SessionGate` and the
  // reveal gate own it. A merge started by the painter would
  // race the gate's and change the rows mid-paint, and an unguarded await
  // between two gathers lets a superseded gather's `setCards` reset settled
  // cards to "loading". A read's `rememberCard` still writes
  // its card, which is a single edit, not a merge.
  it("— never runs the merge itself", async () => {
    seedCache("local:a", "Local Project");
    readFileLocal.mockImplementation(readableContent("Local Project"));
    readFileDrive.mockImplementation(readableContent("Drive Project"));

    const { result } = renderHook(() => useProjects("u1", conns("connected")));

    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(syncProfileSpy).not.toHaveBeenCalled();
  });
});

/**
 * Seed a Drive membership row, in the mirror and in the profile, holding its
 * card: what a prior connected session leaves, read only as decoration.
 */
function seedDriveCard(key: string, title: string, docId: string) {
  const row = {
    id: docId,
    provider: "drive",
    key,
    name: title,
    openedAt: "2026-07-28T10:00:00.000Z",
    lastSeenAt: null,
    removedAt: null,
    card: { ...makeCard(title), id: docId },
  };
  shelve(row);
}

describe("gather — disconnected with a Drive-only project in the library", () => {
  it("lists it as blocked — the membership mirror is the source of truth, but Drive cannot be reached", async () => {
    // Simulate a prior connected session having added this Drive membership.
    seedDriveCard(
      "folder-9",
      "Only On Drive",
      "0a1b2c3d-0000-4000-8000-000000000001",
    );

    const { result } = renderHook(() => useProjects("u1", conns()));

    await waitFor(() => expect(result.current.listing).toBe(false));
    const card = result.current.cards.find((c) => c.ref.key === "folder-9");
    expect(card).toBeDefined();
    expect(card?.state).toBe("blocked");
    expect(card?.content?.title).toBe("Only On Drive");
  });

  it("holds the card at loading while the Drive verdict is unresolved - no flash on refresh", async () => {
    // The gather can run before auth has answered, while `driveConnected` is
    // false only because nobody has asked yet. An unresolved verdict is not a
    // lapsed one, so no card or banner flashes blocked on refresh.
    seedDriveCard(
      "folder-9",
      "Still Loading",
      "0a1b2c3d-0000-4000-8000-000000000002",
    );

    const { result } = renderHook(() =>
      useProjects("u1", conns("unset", false)),
    );

    await waitFor(() => expect(result.current.listing).toBe(false));
    const card = result.current.cards.find((c) => c.ref.key === "folder-9");
    expect(card).toBeDefined();
    expect(card?.state).toBe("loading");
  });

  it("paints blocked once the verdict lands disconnected", async () => {
    seedDriveCard(
      "folder-9",
      "Genuinely Off",
      "0a1b2c3d-0000-4000-8000-000000000003",
    );

    const { result } = renderHook(() =>
      useProjects("u1", conns("unset", true)),
    );

    await waitFor(() => expect(result.current.listing).toBe(false));
    const card = result.current.cards.find((c) => c.ref.key === "folder-9");
    expect(card?.state).toBe("blocked");
  });
});

describe("the local root facts mirror the connection's verdict", () => {
  it("no root — ready false, resolved true once the verdict is in", () => {
    const { result } = renderHook(() =>
      useProjects("u1", conns(undefined, undefined, "unset", true)),
    );
    expect(result.current.localRootResolved).toBe(true);
    expect(result.current.localRootReady).toBe(false);
  });

  it("a root is chosen — ready true", () => {
    const { result } = renderHook(() => useProjects("u1", conns()));
    expect(result.current.localRootResolved).toBe(true);
    expect(result.current.localRootReady).toBe(true);
  });

  it("an unanswered verdict is not 'no root' — ready false, resolved false", () => {
    const { result } = renderHook(() =>
      useProjects("u1", conns(undefined, undefined, "unset", false)),
    );
    expect(result.current.localRootResolved).toBe(false);
    expect(result.current.localRootReady).toBe(false);
  });
});

// `localRootResolved` starts false and turns true once, when the handle
// store's IndexedDB read settles. The gather waits for it rather than
// running once unresolved and again resolved. The `alive()`
// check stops a superseded gather's state writes, but it sits
// partway through, so `allPairings()` and every paired project's
// `checkSync` would still fire for a run about to be discarded.
describe("gather does not run twice per landing", () => {
  it("does no work while the local root fact is unresolved, then gathers exactly once when it resolves", async () => {
    seedCache("drive:folder-1", "Drive Project");
    readFileDrive.mockImplementation(readableContent("Drive Project"));

    const { result, rerender } = renderHook(
      ({ localResolved }: { localResolved: boolean }) =>
        useProjects("u1", conns("connected", true, "connected", localResolved)),
      { initialProps: { localResolved: false } },
    );

    // While unresolved, listing stays true and no gather has started, not
    // even the pairings read every gather opens with.
    expect(result.current.listing).toBe(true);
    expect(allPairingsSpy).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ localResolved: true });
    });
    await waitFor(() => expect(result.current.listing).toBe(false));
    await waitFor(() =>
      expect(
        result.current.cards.find((c) => c.ref.key === "folder-1")?.state,
      ).toBe("ready"),
    );

    // One gather, not two: `allPairings()`, the first thing every gather
    // does, ran once for the whole landing.
    expect(allPairingsSpy).toHaveBeenCalledTimes(1);
  });
});

// Every gather start has a settle. `gatherSettles` is bumped in a `finally`
// around the gather closure's whole body, once per invocation, whether it
// completes or exits early via `alive()`. A gather superseded
// while suspended on `await allPairings()` would otherwise leave a start
// with no settle, and `useLibraryReveal`'s `awaitingFrom = starts + 1` wait
// would never close, holding the login splash.
//
// Two rescans back to back with no microtask between them reproduce it: the
// reveal's bridge rescan can race any other `rescan()` caller, such as
// `chooseLocalFolder`, `forgetLocalFolder` or a second membership-changed
// pull.
describe("gather counter desync — a superseded gather still settles", () => {
  it("— two rescans landing before the first's own settle still keep gatherStarts and gatherSettles matched", async () => {
    const { result } = renderHook(() => useProjects("u1", conns()));

    await waitFor(() => expect(result.current.listing).toBe(false));
    const startsAfterMount = result.current.gatherStarts;
    const settlesAfterMount = result.current.gatherSettles;

    // No `await` between these two: the first rescan's gather is still
    // suspended on its own `await allPairings()` when the second rescan's
    // effect cleanup aborts it, as two independent triggers moments apart
    // would.
    act(() => {
      result.current.rescan();
    });
    act(() => {
      result.current.rescan();
    });

    await waitFor(() => expect(result.current.listing).toBe(false));
    // Poll the settle counter rather than sleeping: the two settles are the
    // fact under test, and a fixed wait only guesses that they have landed.
    await waitFor(() =>
      expect(result.current.gatherSettles).toBe(settlesAfterMount + 2),
    );

    expect(result.current.gatherStarts).toBe(startsAfterMount + 2);
    // Both the superseded gather, on early return, and the surviving one, on
    // normal completion, settle through their `finally`, so the counters
    // never drift apart.
  });
});

// `choose` in `actions/useLocalFolder.ts` runs
// `connections.local.connect()`, which settles the connection's state, then
// `scanLocal()`, then an explicit `rescan()`. The state settle does not
// trigger a gather on its own, so the flow costs one gather, not two.
describe("chooseLocalFolder's flow costs exactly one gather, not two", () => {
  it("a connect that flips localRootReady, followed by scanLocal and an explicit rescan, gathers exactly once", async () => {
    listLocalProjects.mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ localState }: { localState: "connected" | "unset" }) =>
        useProjects("u1", conns(undefined, undefined, localState)),
      { initialProps: { localState: "unset" } },
    );
    await waitFor(() => expect(result.current.listing).toBe(false));
    allPairingsSpy.mockClear();

    // `connections.local.connect()`'s settle: the state turns connected,
    // which on its own starts no gather.
    await act(async () => {
      rerender({ localState: "connected" });
    });
    expect(allPairingsSpy).not.toHaveBeenCalled();

    // `scanLocal()`: the sweep itself is not a gather trigger either.
    await act(async () => {
      await result.current.scanLocal();
    });
    expect(allPairingsSpy).not.toHaveBeenCalled();

    // `rescan()`: the one explicit trigger the flow ends with.
    act(() => result.current.rescan());
    await waitFor(() => expect(result.current.listing).toBe(false));

    expect(allPairingsSpy).toHaveBeenCalledTimes(1);
  });
});

// `read` does not depend on `t`, and `read` is a dependency of the whole
// gather effect. `t`'s identity changes with i18next's language, which
// `reconcilePrefsUI` in `Library.tsx` sets on the normal path, so a
// dependency would re-read every project from disk for a change to a label.
describe("a language change does not retrigger the gather", () => {
  it("read stays stable, and the gather does not re-run, when t's identity changes", async () => {
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    const { result, rerender } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));
    allPairingsSpy.mockClear();

    // A language change: `t`'s reference changes, as it does when i18next's
    // language changes.
    mockT = (key) => key;
    rerender();

    await act(async () => {
      await Promise.resolve();
    });
    expect(allPairingsSpy).not.toHaveBeenCalled();
  });
});

// A re-gather merges rather than resetting: a "ready" card whose provider is
// still reachable keeps its state and content as the starting point of the
// repaint, and the pooled read that follows updates it in place only if
// something changed, so the shelf does not visibly re-read itself.
// The second gather's read is gated so the intermediate state
// is observable rather than hidden by the same final answer.
describe("a re-gather does not flash a ready card back to loading", () => {
  it("keeps a ready card's state and content while the second gather's read is still in flight", async () => {
    seedCache("drive:folder-1", "Drive Project");
    const normalRead = readableContent("Drive Project");
    let releaseSecondRead: (() => void) | null = null;
    let reads = 0;
    readFileDrive.mockImplementation((refArg: ProjectRef, path: string) => {
      reads++;
      if (reads <= 2) {
        // The first gather's properties + structure reads: normal.
        return normalRead(refArg, path);
      }
      // The second gather's read: hangs until the test releases it.
      return new Promise<string>((resolve) => {
        releaseSecondRead = () => {
          void normalRead(refArg, path).then(resolve);
        };
      });
    });

    const { result } = renderHook(() => useProjects("u1", conns("connected")));
    await waitFor(() => expect(result.current.listing).toBe(false));
    await waitFor(() =>
      expect(
        result.current.cards.find((c) => c.ref.key === "folder-1")?.state,
      ).toBe("ready"),
    );

    act(() => {
      result.current.rescan();
    });

    // Wait for the second gather's pooled read to start (its third
    // `readFileDrive` call, hung on the gate), not merely for `allPairings()`,
    // which fires before that gather reaches `setCards`. Once the pooled read
    // has started, the repaint has run, and the merged card reads "ready"
    // with its content intact.
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(3));
    const card = result.current.cards.find((c) => c.ref.key === "folder-1");
    expect(card?.state).toBe("ready");
    expect(card?.content?.title).toBe("Drive Project");

    const release = releaseSecondRead as (() => void) | null;
    if (release) release();
    await waitFor(() => expect(result.current.listing).toBe(false));
  });
});

describe("a Drive grant that is gone (the identity 409) — the card must say so, not look normal-but-locked", () => {
  it("settles a cached Drive card to blocked when the read hits storage.disconnected", async () => {
    seedCache("drive:folder-1", "Drive Project");
    readFileDrive.mockRejectedValue(
      new StorageError("grant gone", "permission", "storage.disconnected"),
    );

    const { result } = renderHook(() => useProjects("u1", conns("connected")));

    await waitFor(() => expect(result.current.listing).toBe(false));
    const card = result.current.cards.find((c) => c.ref.key === "folder-1");
    expect(card?.state).toBe("blocked");
    // And so no address: a blocked card offers no link, the same fact as "it
    // cannot be opened" rather than a second one.
    expect(openableId(card as ProjectCard)).toBeNull();
  });
});

describe("reconnecting Drive — the blocked card must settle back to ready", () => {
  // The gather does not react to `driveConnected` on its own; a rerender with
  // a fresh connection leaves the card where it was. Connecting Drive
  // is a full-page navigation whose return remounts this hook, so no rescan
  // bridge exists; this row calls `rescan` directly, as `chooseLocalFolder`
  // and `forgetLocalFolder` do for the local side.
  it("re-reads a cached Drive card after the connection returns and something calls rescan, so it does not stay unopenable", async () => {
    seedCache("drive:folder-1", "Drive Project");
    readFileDrive.mockImplementation(readableContent("Drive Project"));

    const { result, rerender } = renderHook(
      ({ driveState }: { driveState: "connected" | "unset" }) =>
        useProjects("u1", conns(driveState)),
      { initialProps: { driveState: "unset" } },
    );
    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(result.current.cards[0].state).toBe("blocked");

    await act(async () => {
      rerender({ driveState: "connected" });
    });
    // No rescan yet: the card reads as it did, because the connection change
    // alone is not a trigger.
    expect(result.current.cards[0].state).toBe("blocked");

    act(() => result.current.rescan());
    await waitFor(() => expect(result.current.listing).toBe(false));
    await waitFor(() => expect(result.current.cards[0].state).toBe("ready"));
    expect(result.current.cards[0].content?.title).toBe("Drive Project");
    expect(openableId(result.current.cards[0])).toBeTruthy();
  });
});

describe("the local root and the sweep — membership-truth, no auto-scan", () => {
  it("never scans on mount — a cached card settles through its own read, and a removed project stays removed", async () => {
    seedCache("local:a", "Once Dark");
    readFileLocal.mockImplementation(readableContent("Once Dark"));

    const { result } = renderHook(() => useProjects("u1", conns()));

    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(listLocalProjects).not.toHaveBeenCalled();
    expect(result.current.cards.map((c) => c.ref.key)).toEqual(["a"]);
    expect(result.current.cards[0].state).toBe("ready");
  });

  it("localRootReady mirrors the connection's root verdict — no waiting on gather", () => {
    const { result } = renderHook(() => useProjects("u1", conns()));
    expect(result.current.localRootReady).toBe(true);

    const none = renderHook(() =>
      useProjects("u1", conns(undefined, undefined, "unset")),
    );
    expect(none.result.current.localRootReady).toBe(false);
  });

  it("settles a cached card whose folder left the root to gone — the Drive-consistent state", async () => {
    seedCache("local:a", "A");
    canAccessLocal.mockResolvedValue("granted");
    readFileLocal.mockRejectedValue(
      new StorageError("gone", "not-found", "storage.projectGone"),
    );

    const { result } = renderHook(() => useProjects("u1", conns()));

    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(result.current.cards.map((c) => c.ref.key)).toEqual(["a"]);
    expect(result.current.cards[0].state).toBe("gone");
  });

  it("settles to gone even when the provider throws the RAW NotFoundError — the real shape before projectDir wraps it", async () => {
    // `read`'s mapping understands `StorageError`, and the provider wraps a
    // missing folder's `DOMException` in one. This row pins the contract at
    // the hook boundary for a provider that leaks the raw error: the card is
    // gone, not unreadable.
    seedCache("local:a", "A");
    canAccessLocal.mockResolvedValue("granted");
    readFileLocal.mockRejectedValue(
      new DOMException("Not found", "NotFoundError"),
    );

    const { result } = renderHook(() => useProjects("u1", conns()));

    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(result.current.cards[0].state).toBe("gone");
  });

  it("drops a card whose content is not a project, silently", async () => {
    seedCache("local:was-a-book", "Was A Book");
    readFileLocal.mockImplementation(() =>
      Promise.resolve("{not a properties file}"),
    );

    const { result } = renderHook(() => useProjects("u1", conns()));

    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(result.current.cards.map((c) => c.ref.key)).toEqual([]);
    // The membership goes with the card: the folder is not a project, so it
    // has no place in the library on any device, and one row carried both.
    expect(
      libraryRows("u1").find((r) => r.key === "was-a-book"),
    ).toBeUndefined();
  });

  it("scanDrive adopts scanned Drive folders that are not in the library, and returns the count", async () => {
    listDriveProjects.mockResolvedValue([
      ref("drive", "fresh-folder", "Fresh Folder"),
    ]);
    readFileDrive.mockImplementation(readableContent("Fresh Folder"));

    const { result } = renderHook(() => useProjects("u1", conns("connected")));
    await waitFor(() => expect(result.current.listing).toBe(false));

    const added = await act(async () => result.current.scanDrive());
    expect(added).toBe(1);
    expect(result.current.cards.map((c) => c.ref.key)).toContain(
      "fresh-folder",
    );
  });

  it("scanDrive is a no-op when Drive is not connected", async () => {
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    expect(await act(async () => result.current.scanDrive())).toBe(0);
    expect(listDriveProjects).not.toHaveBeenCalled();
  });

  // Drive's sweep reads its candidates through `pooled` (concurrency 4), as
  // `reconnect` and `scanLocal` do, not one at a time.
  it("scanDrive reads candidate folders concurrently, not one at a time", async () => {
    listDriveProjects.mockResolvedValue(
      ["a", "b", "c", "d", "e"].map((key) => ref("drive", key)),
    );
    const releases: (() => void)[] = [];
    let started = 0;
    const gated = gatedReadableContent("X", releases);
    readFileDrive.mockImplementation((r, path) => {
      if (path === "/document-properties.json") started++;
      return gated(r, path);
    });

    const { result } = renderHook(() => useProjects("u1", conns("connected")));
    await waitFor(() => expect(result.current.listing).toBe(false));
    started = 0;
    releases.length = 0;

    let addedPromise!: Promise<number>;
    act(() => {
      addedPromise = result.current.scanDrive();
    });

    await waitFor(() => expect(started).toBeGreaterThanOrEqual(4));
    expect(started).toBeLessThanOrEqual(5);
    for (const release of releases.splice(0)) release();

    // Concurrency 4 admits the fifth read once one of the first four
    // completes; it is released too, or it hangs and corrupts every later
    // test.
    await waitFor(() => expect(started).toBe(5));
    for (const release of releases.splice(0)) release();

    await act(async () => {
      await addedPromise;
    });
  });

  it("scanLocal adopts scanned folders that are not in the library, and returns the count", async () => {
    listLocalProjects.mockResolvedValue([
      ref("local", "fresh-folder", "Fresh Folder"),
    ]);
    readFileLocal.mockImplementation(readableContent("Fresh Folder"));

    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    const added = await act(async () => result.current.scanLocal());
    expect(added).toBe(1);
    expect(result.current.cards.map((c) => c.ref.key)).toContain(
      "fresh-folder",
    );
  });

  it("refuses a second folder holding a book the shelf already has", async () => {
    // The shelf refuses the copy instead of holding two rows for one uuid and
    // guessing between them. The same project cannot be added
    // twice.
    //
    // Silently, because a sweep reports how many books it added and this one
    // added none. Nothing tries to tell a move from a copy: the two are
    // indistinguishable from here.
    seedCache("local:a", "A");
    listLocalProjects.mockResolvedValue([ref("local", "a-copy", "A copy")]);
    // The copied folder carries the same properties file, uuid and all.
    // `readableContent` keys the id on the folder, so this one is spelled out.
    readFileLocal.mockImplementation((_r: ProjectRef, path: string) => {
      if (path === "/document-properties.json") {
        const props = defaultProperties("A");
        return Promise.resolve(
          serializeProperties({
            ...props,
            document: { ...props.document, id: bookId("a") },
          }),
        );
      }
      return Promise.resolve(
        serializeStructure({ version: STRUCTURE_VERSION, children: [] }),
      );
    });

    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    const added = await act(async () => result.current.scanLocal());
    expect(added).toBe(0);
    expect(libraryRows("u1").map((r) => r.key)).toEqual(["a"]);
  });

  it("a sweep read of a copy does not repaint the shelved book's card (review gate)", async () => {
    // The refusal above gates membership, but it runs after the read.
    // The read does not remember the copy's observation onto the shelved row
    // by the shared uuid; a differing title would otherwise win the row's card
    // under a fresh `cachedAt` and mint a profile op on every sweep. The copy
    // differs here because identical content is a no-op in `sameCardContent`.
    seedCache("local:a", "A");
    listLocalProjects.mockResolvedValue([ref("local", "a-copy", "A copy")]);
    // Only the copy folder holds the stale words. A double serving them to
    // every read would repaint through the real folder's own gather and
    // prove nothing about the copy.
    readFileLocal.mockImplementation((r: ProjectRef, path: string) => {
      if (path === "/document-properties.json") {
        const props = defaultProperties(
          r.key === "a-copy" ? "Stale A v0" : "A",
        );
        return Promise.resolve(
          serializeProperties({
            ...props,
            document: { ...props.document, id: bookId("a") },
          }),
        );
      }
      return Promise.resolve(
        serializeStructure({ version: STRUCTURE_VERSION, children: [] }),
      );
    });

    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    const added = await act(async () => result.current.scanLocal());
    expect(added).toBe(0);
    // The row's card still names the real book's content; the copy's stale
    // observation never lands on it.
    expect(libraryRows("u1").find((r) => r.key === "a")?.card?.title).toBe("A");
  });

  it("leaves a swept folder it could not read for the next sweep", async () => {
    // The sweep found a folder whose properties file the browser would not
    // open, so nothing knows which book it is, and the row is keyed by that.
    // An address alone does not adopt it.
    listLocalProjects.mockResolvedValue([
      ref("local", "locked-folder", "Locked Folder"),
    ]);
    canAccessLocal.mockResolvedValue("needs-gesture");

    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    const added = await act(async () => result.current.scanLocal());
    expect(added).toBe(0);
    expect(libraryRows("u1").some((r) => r.key === "locked-folder")).toBe(
      false,
    );
  });

  // `scanLocal`'s adoption reads run concurrently, not one folder at a time.
  // Mirrors the `reconnect` concurrency row; only the trigger
  // differs.
  it("scanLocal reads candidate folders concurrently, not one at a time", async () => {
    listLocalProjects.mockResolvedValue(
      ["a", "b", "c", "d", "e"].map((key) => ref("local", key)),
    );
    const releases: (() => void)[] = [];
    let started = 0;
    const gated = gatedReadableContent("X", releases);
    readFileLocal.mockImplementation((r, path) => {
      if (path === "/document-properties.json") started++;
      return gated(r, path);
    });

    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));
    started = 0;
    releases.length = 0;

    let addedPromise!: Promise<number>;
    act(() => {
      addedPromise = result.current.scanLocal();
    });

    await waitFor(() => expect(started).toBeGreaterThanOrEqual(4));
    expect(started).toBeLessThanOrEqual(5);
    for (const release of releases.splice(0)) release();

    // Concurrency 4 admits the fifth read once one of the first four
    // completes; it is released too, or it hangs and corrupts every later
    // test.
    await waitFor(() => expect(started).toBe(5));
    for (const release of releases.splice(0)) release();

    await act(async () => {
      await addedPromise;
    });
  });

  it("scanLocal skips folders the library already knows", async () => {
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    listLocalProjects.mockResolvedValue([ref("local", "a")]);

    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    const added = await act(async () => result.current.scanLocal());
    expect(added).toBe(0);
    expect(result.current.cards.map((c) => c.ref.key)).toEqual(["a"]);
  });

  it("scanLocal is a no-op without a root, and re-picks a lapsed permission inside the click", async () => {
    // No root: the sweep has nothing to look through.
    const rootless = renderHook(() =>
      useProjects("u1", conns(undefined, undefined, "unset")),
    );
    await waitFor(() => expect(rootless.result.current.listing).toBe(false));
    expect(await act(async () => rootless.result.current.scanLocal())).toBe(0);
    expect(listLocalProjects).not.toHaveBeenCalled();

    // A lapsed grant: the pick is the permission. Cancelled gives 0.
    const lapsed = renderHook(() =>
      useProjects("u1", conns(undefined, undefined, "needs-gesture")),
    );
    await waitFor(() => expect(lapsed.result.current.listing).toBe(false));
    listLocalProjects.mockResolvedValue([]);
    expect(await act(async () => lapsed.result.current.scanLocal())).toBe(0);
    expect(ensureLocalRoot).toHaveBeenCalled();
    expect(listLocalProjects).not.toHaveBeenCalled();

    // Picked: the sweep proceeds on the fresh grant.
    ensureLocalRoot.mockResolvedValue(ref("local", "root"));
    listLocalProjects.mockResolvedValue([]);
    expect(await act(async () => lapsed.result.current.scanLocal())).toBe(0);
    expect(listLocalProjects).toHaveBeenCalled();
  });

  it("scanLocal returns 0 when the scan throws — the sweep degrades, the shelf is untouched", async () => {
    listLocalProjects.mockRejectedValue(new Error("scan exploded"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(await act(async () => result.current.scanLocal())).toBe(0);
  });

  it("scanLocal skips a folder that is not a Phospheare project — no card, no membership", async () => {
    listLocalProjects.mockResolvedValue([ref("local", "not-a-book")]);
    readFileLocal.mockImplementation(() =>
      Promise.resolve("{not a properties file}"),
    );

    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    const added = await act(async () => result.current.scanLocal());
    expect(added).toBe(0);
    expect(result.current.cards.map((c) => c.ref.key)).toEqual([]);
    // The skip is silent, and the folder is not in the library on any
    // device.
    expect(
      libraryRows("u1").find((r) => r.key === "not-a-book"),
    ).toBeUndefined();
  });

  // The gather does not react to `localRootReady` on its own; the rerender
  // alone leaves the card where it was. `forget` in
  // `actions/useLocalFolder.ts` calls `rescan()` right after
  // `connections.local.disconnect()` for that reason, simulated here.
  it("a forgotten root leaves the cards on the shelf, blocked — Drive parity: the membership is the account's memory, not the connection's", async () => {
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    const { result, rerender } = renderHook(
      ({ localState }: { localState: "connected" | "unset" }) =>
        useProjects("u1", conns(undefined, undefined, localState)),
      { initialProps: { localState: "connected" } },
    );
    await waitFor(() => expect(result.current.listing).toBe(false));

    // The forget flow's verdict lands: the connection settles to "unset".
    await act(async () => {
      rerender({ localState: "unset" });
    });
    // No rescan yet: the connection change alone repaints nothing.
    expect(result.current.cards[0].state).toBe("ready");

    // `forgetLocalFolder`'s own explicit trigger, simulated.
    act(() => result.current.rescan());

    // The card stays on the shelf, blocked rather than gone: the folder
    // exists and the app has no root handle for it. The banner names the
    // cause, and choosing the root again re-reads it in place.
    await waitFor(() => expect(result.current.cards[0].state).toBe("blocked"));
    expect(result.current.cards.map((c) => c.ref.key)).toEqual(["a"]);
    // Its remembered content rides the row, so the dimmed paint keeps it.
    expect(libraryRows("u1").find((r) => r.key === "a")?.card).toBeDefined();
    expect(result.current.localRootReady).toBe(false);
  });

  it("rootless local cards are excluded from the pooled reads — no doomed gone-cards", async () => {
    seedCache("local:a", "A");
    readFileLocal.mockClear();
    const { result } = renderHook(() =>
      useProjects("u1", conns(undefined, undefined, "unset")),
    );
    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(result.current.cards[0].state).toBe("blocked");
    expect(readFileLocal).not.toHaveBeenCalled();
  });
});
describe("reconnect — the root-wide pick", () => {
  it("re-reads every local card after one pick of the root", async () => {
    seedCache("local:a", "A");
    seedCache("local:b", "B");
    readFileLocal.mockImplementation((ref: ProjectRef, path: string) => {
      if (path === "/document-properties.json") {
        return Promise.resolve(
          serializeProperties(defaultProperties(ref.name)),
        );
      }
      return Promise.resolve(
        serializeStructure({ version: STRUCTURE_VERSION, children: [] }),
      );
    });
    ensureLocalRoot.mockResolvedValue(ref("local", "root"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    await act(async () => {
      await result.current.reconnect(ref("local", "a"));
    });

    expect(ensureLocalRoot).toHaveBeenCalledTimes(1);
    expect(result.current.cards.every((c) => c.state === "ready")).toBe(true);
  });

  // `reconnect` re-reads every card of the provider through the gather's
  // `pooled()` (concurrency 4), not one at a time; a serial loop over a
  // lapsed root with 30 books is 60 sequential file reads.
  it("reads every card concurrently, not one at a time", async () => {
    for (const key of ["a", "b", "c", "d", "e"]) {
      seedCache(`local:${key}`, key);
    }
    const releases: (() => void)[] = [];
    let started = 0;
    const gated = gatedReadableContent("X", releases);
    readFileLocal.mockImplementation((r, path) => {
      if (path === "/document-properties.json") started++;
      return gated(r, path);
    });
    ensureLocalRoot.mockResolvedValue(ref("local", "root"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));
    started = 0;
    releases.length = 0;

    let donePromise!: Promise<void>;
    act(() => {
      donePromise = result.current.reconnect(ref("local", "a"));
    });

    // Five cards, concurrency 4: four properties-file reads are in flight
    // together, where a serial loop would show one.
    await waitFor(() => expect(started).toBeGreaterThanOrEqual(4));
    expect(started).toBeLessThanOrEqual(5);
    for (const release of releases.splice(0)) release();

    // Concurrency 4 admits the fifth item's properties read once one of the
    // first four completes; it is released too, or it hangs and corrupts
    // every later test.
    await waitFor(() => expect(started).toBe(5));
    for (const release of releases.splice(0)) release();

    await act(async () => {
      await donePromise;
    });
  });

  it("leaves the card blocked when the picker is cancelled", async () => {
    seedCache("local:a", "A");
    // The card's own permission lapsed with the root's, so the gather leaves
    // it blocked rather than re-reading, and possibly dropping, it.
    canAccessLocal.mockResolvedValue("needs-gesture");
    ensureLocalRoot.mockResolvedValue(null);
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    await act(async () => {
      await result.current.reconnect(ref("local", "a"));
    });

    const card = result.current.cards[0];
    expect(card?.state).toBe("blocked");
    expect(card?.content?.title).toBe("A");
  });
});

describe("adopt / drop / forget", () => {
  it("adopt adds a new card, reads it, and writes its membership through to the server", async () => {
    readFileLocal.mockImplementation(readableContent("New Project"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    await act(async () => {
      await result.current.adopt(ref("local", "b", "New Project"));
    });

    expect(result.current.cards.map((c) => c.ref.key)).toContain("b");
    // `adopt` reads the project, and the read's card lands on the mirror row.
    expect(libraryRows("u1").find((r) => r.key === "b")?.card).toBeDefined();
    // The membership mirror is the shelf's source of truth. The row is
    // written only once the read has said which book this is; until
    // then a concurrent gather's merge sees the loading card.
    expect(libraryRows("u1").some((r) => r.key === "b")).toBe(true);
    expect(
      Object.values(profileDoc("u1").library).some(
        (r) => r.provider === "local" && r.key === "b" && r.removedAt === null,
      ),
    ).toBe(true);
  });

  it("relocate moves the row instead of replacing it, and keeps its history", async () => {
    // A move between backends copies the folder, uuid and all, so the two
    // refs name one book. The row moves rather than being tombstoned and
    // replaced, so the book keeps its `openedAt` through a storage decision.
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    readFileDrive.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns("connected")));
    await waitFor(() => expect(result.current.listing).toBe(false));
    const openedAt = libraryRows("u1")[0].openedAt;

    // The copy on the other side carries the same id, as a real one does.
    // `readableContent` keys the id on the folder, so this ref's read is
    // spelled out.
    readFileDrive.mockImplementation((_r: ProjectRef, path: string) => {
      if (path === "/document-properties.json") {
        const props = defaultProperties("A");
        return Promise.resolve(
          serializeProperties({
            ...props,
            document: { ...props.document, id: bookId("a") },
          }),
        );
      }
      return Promise.resolve(
        serializeStructure({ version: STRUCTURE_VERSION, children: [] }),
      );
    });

    let moved = false;
    await act(async () => {
      moved = await result.current.relocate(
        ref("local", "a"),
        ref("drive", "folder-9", "A"),
      );
    });

    expect(moved).toBe(true);
    const rows = libraryRows("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(bookId("a"));
    expect(rows[0].provider).toBe("drive");
    expect(rows[0].key).toBe("folder-9");
    // The part that does not move.
    expect(rows[0].openedAt).toBe(openedAt);
    expect(result.current.cards.map((c) => c.ref.key)).toEqual(["folder-9"]);
  });

  it("relocate changes nothing when the copy cannot be read", async () => {
    // The read comes first, and a refusal leaves the card and the row naming
    // the old place, which is still there. That is what lets a move to Local
    // trash the Drive original afterwards.
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns("connected")));
    await waitFor(() => expect(result.current.listing).toBe(false));

    readFileDrive.mockRejectedValue(new Error("half-copied"));
    let moved = true;
    await act(async () => {
      moved = await result.current.relocate(
        ref("local", "a"),
        ref("drive", "folder-9", "A"),
      );
    });

    expect(moved).toBe(false);
    expect(libraryRows("u1")[0].provider).toBe("local");
    expect(result.current.cards.map((c) => c.ref.key)).toEqual(["a"]);
  });

  it("adopt claims no membership for a folder it cannot read", async () => {
    // The sweep's rule, on the flow a writer drives by hand: a card appears,
    // because the read is worth showing, and no row is written, because there
    // is no identity to write one under.
    canAccessLocal.mockResolvedValue("needs-gesture");
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    await act(async () => {
      await result.current.adopt(ref("local", "b", "New Project"));
    });

    expect(result.current.cards[0]?.state).toBe("blocked");
    expect(libraryRows("u1").some((r) => r.key === "b")).toBe(false);
  });

  it("forgetting a card with no row is a no-op, and so is its undo", async () => {
    // The shelf can hold a card the mirror does not: a candidate mid-adopt, a
    // row a pull has just tombstoned. With no identity to name, there is
    // nothing to remove and nothing to put back.
    readFileLocal.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    let restore: () => void = () => {};
    act(() => {
      restore = result.current.forget(ref("local", "ghost"));
    });
    act(() => restore());

    expect(libraryRows("u1").some((r) => r.key === "ghost")).toBe(false);
  });

  it("drop removes the card, its cache entry, and its membership", async () => {
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    act(() => result.current.drop(ref("local", "a")));

    expect(result.current.cards).toEqual([]);
    expect(libraryRows("u1").some((r) => r.key === "a")).toBe(false);
    expect(
      Object.values(profileDoc("u1").library).some(
        (r) => r.provider === "local" && r.key === "a" && r.removedAt !== null,
      ),
    ).toBe(true);
  });

  it("forget removes the row — membership and remembered content — and the restore closure re-adds both", async () => {
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    let restore: () => void = () => {};
    act(() => {
      restore = result.current.forget(ref("local", "a"));
    });
    expect(result.current.cards).toEqual([]);
    // One row carries the membership and the remembered content, and
    // forgetting takes the row; the tombstone clears the card in the profile
    // too. The undo closure carries the content back.
    expect(libraryRows("u1").find((r) => r.key === "a")).toBeUndefined();

    act(() => restore());
    expect(result.current.cards.map((c) => c.ref.key)).toEqual(["a"]);
    expect(libraryRows("u1").find((r) => r.key === "a")?.card?.title).toBe("A");
  });
});

describe("refreshContent — the content-only post-pull refresh", () => {
  it("applies a newer row card to a card without re-reading its provider", async () => {
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));
    await waitFor(() => expect(result.current.cards[0].state).toBe("ready"));
    readFileLocal.mockClear();

    // A newer card lands on the row as a merge with another device leaves
    // it: a `rememberCard` under a `cachedAt` newer than the gather's read.
    const v2 = defaultProperties("A v2");
    rememberCard(
      "u1",
      { ...v2, document: { ...v2.document, id: bookId("a") } },
      { version: STRUCTURE_VERSION, children: [] },
      new Date(Date.now() + 60_000).toISOString(),
    );

    act(() => result.current.refreshContent());

    expect(result.current.cards[0].content?.title).toBe("A v2");
    // The state is untouched: this is decoration, not a new verdict.
    expect(result.current.cards[0].state).toBe("ready");
    expect(result.current.cards[0].fresh).toBe(false);
    // No provider read for a change that touched no membership and no file
    // this device needs to read again.
    expect(readFileLocal).not.toHaveBeenCalled();
  });

  it("keeps every unchanged card's reference — nothing repaints", async () => {
    seedCache("local:a", "A");
    seedCache("local:b", "B");
    readFileLocal.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));
    await waitFor(() => expect(result.current.cards[0].state).toBe("ready"));

    const before = result.current.cards;

    act(() => result.current.refreshContent());

    // The array reference survives too, since the refresh is idempotent:
    // nothing draws differently, so nothing repaints, and the reveal bridge
    // needs no "did content change" flag of its own.
    expect(result.current.cards).toBe(before);
    expect(result.current.cards[0]).toBe(before[0]);
    expect(result.current.cards[1]).toBe(before[1]);
  });
});

describe("markSynced / unpair", () => {
  it("markSynced flags a card optimistically, ahead of the next gather", async () => {
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    act(() => result.current.markSynced("book-a"));

    // The set is books, not addresses.
    expect(result.current.synced.has("book-a")).toBe(true);
  });

  it("does nothing for a project the shelf cannot name", async () => {
    // Each of these starts from an address and needs an identity to act on.
    // A card the mirror does not hold, such as a stale click or a
    // row a pull has just tombstoned, has none, and guessing one from the
    // folder lets a second book inherit a first one's pairing.
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    expect(await result.current.checkNow(ref("local", "ghost"))).toBeNull();
    await act(async () => {
      await result.current.unpair(ref("local", "ghost"));
      await result.current.resolve("book-ghost", "local");
    });
    expect(result.current.synced.has("book-ghost")).toBe(false);
  });

  it("skips the sync check for a pairing whose book left the shelf", async () => {
    // A pairing record outliving its row: the writer forgot a synced project
    // on this device while the record stayed. The sweep has an identity and
    // no address to compare against, so it skips; a local ref made from the
    // pairing's key would match the folder name only by coincidence.
    await pair("book-not-on-this-shelf", {
      providerId: "drive",
      key: "folder-1",
    });
    const { result } = renderHook(() => useProjects("u1", conns("connected")));

    await waitFor(() => expect(result.current.listing).toBe(false));
    expect(checkSyncSpy).not.toHaveBeenCalled();
  });

  it("unpair clears the synced flag", async () => {
    seedCache("local:a", "A");
    await pair(bookId("a"), { providerId: "drive", key: "folder-1" });
    readFileLocal.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns("connected")));
    await waitFor(() =>
      expect(result.current.synced.has(bookId("a"))).toBe(true),
    );

    await act(async () => {
      await result.current.unpair(ref("local", "a"));
    });

    expect(result.current.synced.has(bookId("a"))).toBe(false);
  });
});

// A paired project's background sync check runs only after the pooled card
// reads settle. Fired eagerly, the checks compete with the reads for the
// browser's per-host connection budget and hold cards at "loading" far
// longer than the reads take.
describe("checkSync is deferred until the card reads have settled", () => {
  it("does not start a background sync check while a card read is still in flight", async () => {
    seedCache("local:a", "Paired Project");
    await pair(bookId("a"), { providerId: "drive", key: "folder-1" });
    const normalRead = readableContent("Paired Project");
    let releaseRead: (() => void) | null = null;
    let reads = 0;
    readFileLocal.mockImplementation((refArg: ProjectRef, path: string) => {
      reads++;
      if (reads === 1) return normalRead(refArg, path);
      // The second read (`document-structure.yaml`) hangs until released.
      return new Promise<string>((resolve) => {
        releaseRead = () => {
          void normalRead(refArg, path).then(resolve);
        };
      });
    });

    const { result } = renderHook(() => useProjects("u1", conns("connected")));

    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    // The card read is still gated, so `checkSync` has not started.
    expect(checkSyncSpy).not.toHaveBeenCalled();

    const release = releaseRead as (() => void) | null;
    if (release) release();

    await waitFor(() => expect(result.current.listing).toBe(false));
    await waitFor(() => expect(checkSyncSpy).toHaveBeenCalled());
  });
});

// `rescan`, `forget` and `reconnect` keep their identity across a card-state
// change that does not touch them. A gather is N reads and N `setCards`
// calls, and every card holding one of these as a prop would re-render with
// each, defeating `React.memo` on `ProjectCard`.
describe("rescan/forget/reconnect keep their identity across a real cards-array change", () => {
  it("rescan's, forget's, and reconnect's identity all survive a card read landing (revalidate)", async () => {
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));
    const cardsBefore = result.current.cards;

    const before = {
      rescan: result.current.rescan,
      forget: result.current.forget,
      reconnect: result.current.reconnect,
    };

    // `revalidate` runs `update()`, a `setCards` write building a new array,
    // both before the read (state "loading") and after it lands: a real
    // cards-array change, which a re-render with the same array reference
    // would not exercise.
    await act(async () => {
      await result.current.revalidate({
        providerId: "local",
        key: "a",
        name: "A",
        openedAt: "",
      });
    });
    expect(result.current.cards).not.toBe(cardsBefore);

    expect(result.current.rescan).toBe(before.rescan);
    expect(result.current.forget).toBe(before.forget);
    expect(result.current.reconnect).toBe(before.reconnect);
  });
});

// The Properties window writes a book with a remote through its working
// copy, and the queue carries it to the remote later. Re-reading the
// card from the bare provider in between would paint the remote's older
// facts back onto the shelf; `through` reads it where the write landed.
describe("revalidate through the storage a write went through", () => {
  it("reads the card from the given storage, not the bare provider", async () => {
    seedCache("local:a", "A");
    readFileLocal.mockImplementation(readableContent("A"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));
    const bareReads = readFileLocal.mock.calls.length;

    const workingCopy = stubProvider(
      "local",
      "device",
      vi.fn(async () => true),
      vi.fn(readableContent("Retitled")),
    );
    await act(async () => {
      await result.current.revalidate(ref("local", "a", "A"), workingCopy);
    });

    expect(result.current.cards[0].content?.title).toBe("Retitled");
    expect(readFileLocal.mock.calls.length).toBe(bareReads);
  });
});

// Properties and Export open a book by the card's id, so a card the shelf
// has just adopted must carry it.
describe("an adopted card carries its book's id", () => {
  it("after adopt", async () => {
    readFileLocal.mockImplementation(readableContent("New Project"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    await act(async () => {
      await result.current.adopt(ref("local", "b", "New Project"));
    });

    const adopted = result.current.cards.find((c) => c.ref.key === "b");
    expect(adopted?.id).toBe(bookId("b"));
  });

  it("after a sweep", async () => {
    listLocalProjects.mockResolvedValue([
      ref("local", "fresh-folder", "Fresh Folder"),
    ]);
    readFileLocal.mockImplementation(readableContent("Fresh Folder"));
    const { result } = renderHook(() => useProjects("u1", conns()));
    await waitFor(() => expect(result.current.listing).toBe(false));

    await act(async () => result.current.scanLocal());

    const swept = result.current.cards.find(
      (c) => c.ref.key === "fresh-folder",
    );
    expect(swept?.id).toBe(bookId("fresh-folder"));
  });
});

// A save in the working copy reaches Drive only when the queue drains. A
// gather that read the bare Drive folder would paint the card from before the
// save and write that older card back to the row and the profile.
describe("the gather reads a book through its working copy", () => {
  it("shows and remembers what the working copy holds, not the bare remote", async () => {
    seedCache("drive:d1", "Before");
    readFileDrive.mockImplementation(readableContent("Stale"));
    const workingCopy = stubProvider(
      "drive",
      "remote",
      vi.fn(async () => "granted"),
      vi.fn(readableContent("Saved")),
    );
    const dispose = vi.fn();
    openProjectStorage.mockImplementation(async () => ({
      storage: workingCopy,
      dispose,
    }));

    const { result } = renderHook(() => useProjects("u1", conns("connected")));

    await waitFor(() =>
      expect(result.current.cards[0]?.content?.title).toBe("Saved"),
    );
    expect(openProjectStorage).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "drive", key: "d1" }),
      bookId("d1"),
    );
    expect(readFileDrive).not.toHaveBeenCalled();
    expect(libraryRows("u1")[0].card?.title).toBe("Saved");
    expect(dispose).toHaveBeenCalled();
  });
});

// The banner's reconnect and a revalidate without `through` re-read a book
// after its connection came back, which is when the queue still owes the
// remote the saves made while it was away. They read where the gather reads.
describe("reconnect and revalidate read a book through its working copy", () => {
  function driveBookWithQueuedSave() {
    seedCache("drive:d1", "Before");
    readFileDrive.mockImplementation(readableContent("Stale"));
    const workingCopy = stubProvider(
      "drive",
      "remote",
      vi.fn(async () => "granted"),
      vi.fn(readableContent("Saved")),
    );
    openProjectStorage.mockImplementation(async () => ({
      storage: workingCopy,
      dispose: () => {},
    }));
  }

  it("reconnect", async () => {
    driveBookWithQueuedSave();
    const { result } = renderHook(() => useProjects("u1", conns("connected")));
    await waitFor(() =>
      expect(result.current.cards[0]?.content?.title).toBe("Saved"),
    );

    await act(async () => {
      await result.current.reconnect(ref("drive", "d1"));
    });

    expect(result.current.cards[0].content?.title).toBe("Saved");
    expect(readFileDrive).not.toHaveBeenCalled();
    expect(libraryRows("u1")[0].card?.title).toBe("Saved");
  });

  it("revalidate without through", async () => {
    driveBookWithQueuedSave();
    const { result } = renderHook(() => useProjects("u1", conns("connected")));
    await waitFor(() =>
      expect(result.current.cards[0]?.content?.title).toBe("Saved"),
    );

    await act(async () => {
      await result.current.revalidate(ref("drive", "d1"));
    });

    expect(result.current.cards[0].content?.title).toBe("Saved");
    expect(readFileDrive).not.toHaveBeenCalled();
    expect(libraryRows("u1")[0].card?.title).toBe("Saved");
  });
});
