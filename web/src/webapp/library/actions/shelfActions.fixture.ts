// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { cleanup, renderHook } from "@testing-library/react";
import {
  StorageError,
  type ProjectRef,
  type StorageProvider,
} from "../../../storage/types";
import type { IconName } from "../../../ui/icons";
import { addToLibrary } from "../../../profile/profileSync";
import type { CardContent } from "../../../profile/profileStore";
import { setCurrentUserId } from "../../../auth/currentUser";
import type { Toasts } from "../../../ui/overlay/Toast";
import type { Connections } from "../../../storage";
import type { ProjectCard as Card } from "../useProjects";
import type { LibraryCardsApi } from "./shelfActions";
import { useActionError, type ActionFailure } from "./useActionError";
import { useCopyJob, type CopyJob } from "./useCopyJob";

// The action hooks run against controllable pieces: the storage barrel is
// stubbed as in `useProjects.test.tsx`, the copy, retitle and scaffold work is
// one mock each, and the sync pairing runs for real against fake IndexedDB,
// the only place "paired" is knowable, so the synced-card flows prove it.
//
// A test file mocks a module with the stand-in from `mocks`, imported inside
// the `vi.mock` factory, so every file shares these doubles. Nothing this
// file imports reaches a mocked module, or the factory would import it
// mid-evaluation.

// Hoisted, not a fresh arrow per `useTranslation()` call: the real library
// keeps `t` stable across renders, and a reallocating mock would invalidate
// every `useCallback` that depends on `t`, including those the identity rows
// pin.
export const t = (key: string) => key;
// The pairing, the synced set and the conflict banner all key on the
// project's own id, and the mirror turns a card's address into one.
// The shelf is stubbed, so this stands in for it, as a delegate rather than a
// factory, so the sync-loss row can make the mirror answer null mid-flight.
export const projectIdFor = vi.fn();

export const readFileLocal = vi.fn();
export const existsLocal = vi.fn();
export const writeFileLocal = vi.fn();
export const readFileDrive = vi.fn();
export const createDriveProject = vi.fn();
export const createLocalProject = vi.fn();
export const trashProject = vi.fn();
export const projectsFolderId = vi.fn().mockResolvedValue("projects-root");

function stubProvider(
  id: string,
  over: Partial<StorageProvider> = {},
): StorageProvider {
  return {
    id,
    kind: "device",
    label: () => id,
    icon: "mark" as IconName,
    isAvailable: () => true,
    reopenProject: async () => true,
    canAccess: async () => "granted" as const,
    listDir: async () => [],
    exists: async () => true,
    readFile: async () => "",
    writeFile: async () => {},
    createDir: async () => {},
    renameFile: async () => {},
    moveFile: async () => {},
    removeFile: async () => {},
    fingerprintFile: async () => ({ hash: "fake" }),
    fingerprintDir: async () => new Map(),
    ...over,
  };
}

export const localProviderFake = stubProvider("local", {
  readFile: (ref, path) => readFileLocal(ref, path),
  exists: (ref, path) => existsLocal(ref, path),
  writeFile: (ref, path, content) => writeFileLocal(ref, path, content),
});
// The remote fake carries `trashProject` and declares itself remote: binning
// a project goes through the port, not a `trashProject` import, so
// the spy lives where a real adapter would put it.
export const driveProviderFake = stubProvider("drive", {
  kind: "remote",
  readFile: (ref, path) => readFileDrive(ref, path),
  trashProject: (...args: unknown[]) => trashProject(...args),
});

export const copyProjectMock = vi.fn();
// The Properties window's two moves and the storage they run over.
// The working copy is a stand-in object: the rows pin that the hook writes
// through it, re-reads the card through it, and releases it.
export const readProjectFactsMock = vi.fn();
export const saveProjectFactsMock = vi.fn();
export const workingCopy = { id: "working-copy" } as unknown as StorageProvider;
export const disposeStorage = vi.fn();
export const openProjectStorageMock = vi.fn();
export const duplicateProjectMock = vi.fn();
export const scaffoldProjectMock = vi.fn();
// The queue's drain is a stand-in; its store runs for real against fake
// IndexedDB, so a row appended there is work the move must see as owed.
export const drainAllMock = vi.fn();
export const retryNowMock = vi.fn();
export const settledMock = vi.fn();

/** The stand-in for each mocked module, by the module's last path segment. */
export const mocks = {
  i18n: {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
  },
  projectId: {
    projectIdFor: (...args: unknown[]) => projectIdFor(...args),
  },
  storage: {
    StorageError,
    localProvider: localProviderFake,
    driveProvider: driveProviderFake,
    getProvider: (id: string) =>
      id === "local"
        ? localProviderFake
        : id === "drive"
          ? driveProviderFake
          : null,
    createDriveProject: (...args: unknown[]) => createDriveProject(...args),
    createLocalProject: (...args: unknown[]) => createLocalProject(...args),
    projectsFolderId: (...args: unknown[]) => projectsFolderId(...args),
  },
  transfer: {
    copyProject: (...args: unknown[]) => copyProjectMock(...args),
  },
  editFacts: {
    FACTS_UNREADABLE: "facts-unreadable",
    readProjectFacts: (...args: unknown[]) => readProjectFactsMock(...args),
    saveProjectFacts: (...args: unknown[]) => saveProjectFactsMock(...args),
  },
  projectStorage: {
    openProjectStorage: (...args: unknown[]) => openProjectStorageMock(...args),
  },
  duplicate: {
    duplicateProject: (...args: unknown[]) => duplicateProjectMock(...args),
  },
  scaffold: {
    scaffoldProject: (...args: unknown[]) => scaffoldProjectMock(...args),
  },
  remoteQueue: {
    drainAll: (...args: unknown[]) => drainAllMock(...args),
    retryNow: (...args: unknown[]) => retryNowMock(...args),
    settled: (...args: unknown[]) => settledMock(...args),
  },
};

export const ref = (
  providerId: string,
  key: string,
  name = key,
): ProjectRef => ({
  providerId,
  key,
  name,
  openedAt: "2026-07-28T10:00:00.000Z",
});

export const card = (over: Partial<Card> = {}): Card => ({
  id: "book-a",
  ref: ref("local", "a", "a"),
  state: "ready",
  content: null,
  fresh: true,
  problem: null,
  ...over,
});

export const copyOk = { copied: 3, total: 3, cancelled: false };
export const copyCancelled = { copied: 2, total: 5, cancelled: true };

export const driveRef = ref("drive", "d1", "New Project");
export const localRef = ref("local", "l1", "Project");

/**
 * The id the double's `adopt` writes for a project: the shape a real read
 * produces, cut to what these rows need.
 */
export const idFor = (ref: ProjectRef) => uuidOf(`id-${ref.key}`);

/**
 * A stable uuid per name: the profile keys rows by the project uuid and drops
 * any other id.
 */
export function uuidOf(name: string): string {
  let hex = "";
  for (let seed = 0; hex.length < 32; seed++) {
    let h = 0x811c9dc5 ^ seed;
    for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    hex += (h >>> 0).toString(16).padStart(8, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A card the profile accepts: `addToLibrary` reduces it through
 * `asCardContent`.
 */
const CARD: CardContent = {
  id: "",
  title: "Once Dark",
  type: "Novel",
  words: 0,
  parts: 0,
  sections: 0,
  goal: null,
  perNode: [],
  structure: { version: 1, children: [] },
  updatedAt: "2026-01-01T00:00:00.000Z",
  cachedAt: "2026-01-01T00:00:00.000Z",
};

/** The shelf, the toasts, the router and the connections an action uses. */
export function shelfDoubles() {
  const api = {
    // The real `adopt` reads the project and writes its card into the library
    // mirror before it resolves (`read` then `rememberCard`), and the flows
    // that navigate afterwards take the address from that row, since the URL
    // is the book's id, not its folder. A double that resolved without
    // writing would let every "... and opens it" row pass against a flow that
    // navigates nowhere.
    adopt: vi.fn(async (ref: ProjectRef) => {
      addToLibrary(
        "u1",
        {
          id: idFor(ref),
          provider: ref.providerId,
          key: ref.key,
          name: ref.name,
        },
        { ...CARD, id: idFor(ref) },
      );
    }),
    drop: vi.fn(),
    // The real `relocate` writes the row at its new address under the id it
    // already had, because the book is the same and only its place changed;
    // the flows that navigate afterwards read that row.
    relocate: vi.fn(async (from: ProjectRef, to: ProjectRef) => {
      addToLibrary(
        "u1",
        {
          id: idFor(from),
          provider: to.providerId,
          key: to.key,
          name: to.name,
        },
        { ...CARD, id: idFor(from) },
      );
      return true;
    }),
    forget: vi.fn(() => () => {}),
    revalidate: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
    unpair: vi.fn(async () => {}),
    checkNow: vi.fn<LibraryCardsApi["checkNow"]>(),
    markSynced: vi.fn(),
    scanLocal: vi.fn(async () => 0),
    rescan: vi.fn(),
  };
  // Each toast gets its id, as `useToasts` hands one back.
  let toastId = 0;
  const toasts = {
    post: vi.fn<Toasts["post"]>(() => (toastId += 1)),
    dismiss: vi.fn(),
  };
  const navigate = vi.fn();
  // The local connection's verbs, wired to the flows' mocks: choose picks a
  // folder, forget drops the handle.
  const localConnect = vi.fn(async () => true);
  const localDisconnect = vi.fn(async () => {});
  const connections = {
    drive: { state: "unset", resolved: true },
    local: {
      state: "connected",
      resolved: true,
      connect: localConnect,
      disconnect: localDisconnect,
    },
  } as unknown as Connections;
  return { api, toasts, navigate, connections, localConnect, localDisconnect };
}

/**
 * Renders one action hook with the shelf's failure banner and copy window it
 * reports to, as `Library` composes them: the hook's own members, then
 * `shelfError` and `copy`.
 */
export function renderAction<T extends object>(
  use: (shared: { failure: ActionFailure; copyJob: CopyJob }) => T,
) {
  return renderHook(() => {
    const failure = useActionError();
    const copyJob = useCopyJob();
    return {
      ...use({ failure, copyJob }),
      shelfError: failure.error,
      copy: copyJob.copy,
    };
  });
}

/** Fresh browser stores and fresh doubles, before every row. */
export function resetShelfFakes() {
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
  setCurrentUserId("u1");

  readFileLocal.mockReset();
  existsLocal.mockReset().mockResolvedValue(true);
  writeFileLocal.mockReset().mockResolvedValue(undefined);
  readFileDrive.mockReset();
  createDriveProject.mockReset();
  createLocalProject.mockReset();
  trashProject.mockReset().mockResolvedValue(undefined);
  projectsFolderId.mockReset().mockResolvedValue("projects-root");
  copyProjectMock.mockReset();
  readProjectFactsMock.mockReset();
  saveProjectFactsMock.mockReset();
  disposeStorage.mockReset();
  openProjectStorageMock
    .mockReset()
    .mockResolvedValue({ storage: workingCopy, dispose: disposeStorage });
  duplicateProjectMock.mockReset();
  scaffoldProjectMock.mockReset().mockResolvedValue(undefined);
  drainAllMock.mockReset().mockResolvedValue(undefined);
  retryNowMock.mockReset().mockResolvedValue(undefined);
  settledMock.mockReset().mockResolvedValue(undefined);
  projectIdFor
    .mockReset()
    .mockImplementation((ref: { key: string }) => `book-${ref.key}`);
}

export function tearDownShelf() {
  cleanup();
  vi.unstubAllGlobals();
}
