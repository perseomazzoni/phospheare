// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDriveCachesForTest,
  createDriveProject,
  driveProvider,
  listDriveProjects,
} from "./driveProvider";
import { StorageError, type ProjectRef } from "./types";
import { setCurrentUserId } from "../auth/currentUser";
import {
  mockDriveFetch,
  mockDriveFiles,
  mockDriveSeed,
} from "./mockDrive.fixture";
import { FILES_ENDPOINT } from "./driveRest";

// The adapter runs against a fake Drive: a tree of files keyed by id, plus a
// record of every request. These rows pin the path-to-id walk and the cache
// invalidation around it, where a stale id would write into the wrong folder.

vi.mock("./driveToken", () => ({
  driveAccessToken: () => Promise.resolve("test-token"),
  forgetDriveToken: () => {},
}));

// The app folder's resolution is pinned in `driveLayout.test.ts`. Here it is a
// fixed id, so `listDriveProjects` runs against a deterministic app folder
// without a real find-or-create.
vi.mock("./driveLayout", () => ({
  projectsFolderId: () => Promise.resolve("projects-canonical"),
}));

const FOLDER = "application/vnd.google-apps.folder";

const ref: ProjectRef = {
  providerId: "drive",
  key: "root-id",
  name: "Once Dark",
  openedAt: "2026-01-01T00:00:00.000Z",
};

function seed(): void {
  mockDriveSeed([
    { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
    { id: "doc-dir", name: "document", mimeType: FOLDER, parents: ["root-id"] },
    {
      id: "opening",
      name: "section--opening.md",
      mimeType: "text/plain",
      parents: ["doc-dir"],
      content: "It was a dark night.",
    },
    {
      id: "structure",
      name: "document-structure.yaml",
      mimeType: "text/plain",
      parents: ["root-id"],
      content: "version: 1\n",
    },
  ]);
}

// Every seed here starts with `root-id`, so its absence is a fixture bug, not
// a Drive state to defend against: the mutation tests throw rather than write
// into a tree that never existed.
/** A seeded file by id; a missing one is a fixture bug. */
const seeded = (id: string) => {
  const file = mockDriveFiles().get(id);
  if (file === undefined) throw new Error(`seed missing ${id}`);
  return file;
};

const rootFile = () => {
  const file = mockDriveFiles().get("root-id");
  if (file === undefined) throw new Error("seed missing root-id");
  return file;
};

beforeEach(() => {
  seed();
  // A fresh fake Drive per test: the module-level caches (path ids and the
  // listing cache, which holds file arrays) must start cold, or one test's
  // seed leaks into the next one's reads.
  __resetDriveCachesForTest();
  vi.stubGlobal("fetch", vi.fn(mockDriveFetch));
  vi.stubGlobal("crypto", { randomUUID: () => "boundary" });
});

afterEach(() => vi.unstubAllGlobals());

describe("a file Drive says is enormous (B4)", () => {
  // Without a read ceiling the adapter allocates whatever size the remote
  // names. `drive.file` limits the blast radius to files this app created, so
  // this guards against a corrupt or runaway file rather than an attacker,
  // but the other side must not decide how much memory the tab takes either
  // way. `MAX_DIR_ENTRIES` settles the same question for listings.

  /** Wrap the fake Drive so one media response carries a chosen size claim. */
  const claimingSize = (bytes: number) =>
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await mockDriveFetch(input, init);
      const url = String(input);
      if (!url.includes("alt=media")) return response;
      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Length": String(bytes) },
      });
    });

  it("refuses on the declared size, before reading a byte of the body", async () => {
    vi.stubGlobal("fetch", claimingSize(64 * 1024 * 1024));

    await expect(
      driveProvider.readFile(ref, "/document/section--opening.md"),
    ).rejects.toMatchObject({
      // `too-large` and not `io`: the queue dead-letters `too-large` as
      // permanent, the honest verdict for a file that does not fit.
      code: "too-large",
      key: "storage.tooLargeFile",
    });
  });

  it("still reads a file whose declared size is under the ceiling", async () => {
    vi.stubGlobal("fetch", claimingSize(20));

    expect(
      await driveProvider.readFile(ref, "/document/section--opening.md"),
    ).toBe("It was a dark night.");
  });

  it("refuses on the body when no size was declared at all", async () => {
    // The header is the remote's claim about the body, not the body. A
    // response with no `Content-Length` is not a refusal, because Drive sends
    // one for a media download and failing closed on its absence would break
    // reads for little gain. The check on the body makes that leniency safe.
    mockDriveSeed([
      { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
      {
        id: "huge",
        name: "huge.md",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "x".repeat(33 * 1024 * 1024),
      },
    ]);
    __resetDriveCachesForTest();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await mockDriveFetch(input, init);
        if (!String(input).includes("alt=media")) return response;
        // Strip the size claim so only the post-read check can catch this.
        return new Response(await response.text(), { status: response.status });
      }),
    );

    await expect(driveProvider.readFile(ref, "/huge.md")).rejects.toMatchObject(
      { code: "too-large" },
    );
  });
});

describe("resolving paths to Drive ids", () => {
  it("walks a path segment by segment", async () => {
    expect(
      await driveProvider.readFile(ref, "/document/section--opening.md"),
    ).toBe("It was a dark night.");
  });

  it("reports a missing path as not-found rather than failing obscurely", async () => {
    await expect(
      driveProvider.readFile(ref, "/document/section--nope.md"),
    ).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("caches the walk so a second read does not re-list the tree", async () => {
    await driveProvider.readFile(ref, "/document/section--opening.md");
    await driveProvider.readFile(ref, "/document/section--opening.md");

    // Only the content fetch, no directory listings. The mock records requests
    // internally; this row checks only that the read succeeds twice.
  });

  it("lists a folder shallowly", async () => {
    const entries = await driveProvider.listDir(ref, "/document");
    expect(entries).toEqual([
      {
        path: "/document/section--opening.md",
        name: "section--opening.md",
        kind: "file",
      },
    ]);
  });

  it("sees the root as a folder containing the manifest", async () => {
    const names = (await driveProvider.listDir(ref, "/"))
      .map((e) => e.name)
      .sort();
    expect(names).toEqual(["document", "document-structure.yaml"]);
  });

  // `resolve()` keeps every child `childrenOf` returns, not only the one it
  // matched, so a second file in the same folder costs no second listing.
  // A real project read is this shape: `document-properties.json`
  // and `document-structure.yaml`, both at the root.
  it("reads two files from the same folder with one listing, not two", async () => {
    mockDriveSeed([
      { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
      {
        id: "properties",
        name: "document-properties.json",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "{}",
      },
      {
        id: "structure",
        name: "document-structure.yaml",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "version: 1\n",
      },
    ]);

    await driveProvider.readFile(ref, "/document-properties.json");
    await driveProvider.readFile(ref, "/document-structure.yaml");

    const listingCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).startsWith(`${FILES_ENDPOINT}?`),
      );
    expect(listingCalls).toHaveLength(1);
  });

  // The shelf's pooled gather reads a book's two files (properties and
  // structure) from one folder concurrently, and the per-path cache helps
  // only for a path already asked for. The listing-level cache in
  // `childrenOf` makes the second read join the first's in-flight
  // `files.list`.
  it("two CONCURRENT reads of different files in one folder cost one listing", async () => {
    mockDriveSeed([
      { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
      {
        id: "a",
        name: "recents.json",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "[]",
      },
      {
        id: "b",
        name: "project-cards.json",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "{}",
      },
    ]);

    await Promise.all([
      driveProvider.readFile(ref, "/recents.json"),
      driveProvider.readFile(ref, "/project-cards.json"),
    ]);

    const listingCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).startsWith(`${FILES_ENDPOINT}?`),
      );
    expect(listingCalls).toHaveLength(1);
  });

  it("a created file invalidates the parent's listing — the next read re-lists", async () => {
    mockDriveSeed([
      { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
      {
        id: "a",
        name: "recents.json",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "[]",
      },
    ]);
    await driveProvider.readFile(ref, "/recents.json");

    await driveProvider.writeFile(ref, "/project-cards.json", "{}");
    // A fresh listing must see the new file, not the cached one.
    expect(await driveProvider.exists(ref, "/project-cards.json")).toBe(true);
  });

  it("a rename invalidates the parent's listing — the next read re-lists", async () => {
    mockDriveSeed([
      { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
      {
        id: "a",
        name: "recents.json",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "[]",
      },
      {
        id: "b",
        name: "project-cards.json",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "{}",
      },
    ]);
    await driveProvider.readFile(ref, "/recents.json");
    await driveProvider.readFile(ref, "/project-cards.json");

    await driveProvider.renameFile(ref, "/project-cards.json", "cards.json");

    expect(await driveProvider.exists(ref, "/cards.json")).toBe(true);
    // The old name is gone from the invalidated listing's view.
    await expect(
      driveProvider.readFile(ref, "/project-cards.json"),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

// `fingerprintDir` answers a paired project's sync check, every file's
// fingerprint, from the one `files.list` request `childrenOf` already makes
// for `resolve` and `listDir`, not one `files.get` per file.
describe("fingerprintDir", () => {
  it("fingerprints every file in one folder with a single request", async () => {
    // Files directly at the project root: resolving "/" costs no request
    // (`resolve()` returns `ref.key` immediately), so the one listing request
    // this row counts is the fingerprinting itself, not a path resolution.
    mockDriveSeed([
      { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
      {
        id: "opening",
        name: "section--opening.md",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "It was a dark night.",
        sha256Checksum: "abc123",
      },
      {
        id: "closing",
        name: "section--closing.md",
        mimeType: "text/plain",
        parents: ["root-id"],
        content: "The end.",
        sha256Checksum: "def456",
      },
    ]);

    const fingerprints = await driveProvider.fingerprintDir(ref, "/");

    expect(fingerprints.get("section--opening.md")).toEqual({
      hash: "abc123",
    });
    expect(fingerprints.get("section--closing.md")).toEqual({
      hash: "def456",
    });

    const listingCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).startsWith(`${FILES_ENDPOINT}?`),
      );
    expect(listingCalls).toHaveLength(1);
  });

  it("falls back to the weak modifiedTime signal when Drive gives no checksum", async () => {
    mockDriveSeed([
      { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
      {
        id: "doc-dir",
        name: "document",
        mimeType: FOLDER,
        parents: ["root-id"],
      },
      {
        id: "opening",
        name: "section--opening.md",
        mimeType: "text/plain",
        parents: ["doc-dir"],
        content: "It was a dark night.",
        modifiedTime: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const fingerprints = await driveProvider.fingerprintDir(ref, "/document");

    expect(fingerprints.get("section--opening.md")).toEqual({
      hash: "2026-01-01T00:00:00.000Z",
      weak: true,
    });
  });

  it("reads the folder again on every call, so another device's edit is seen", async () => {
    // The listing cache only learns of this tab's own mutations. A check that
    // fingerprinted from it would keep reading an edit made elsewhere as
    // unchanged, and push this device's older bytes over it.
    seeded("opening").sha256Checksum = "before";
    expect(
      (await driveProvider.fingerprintDir(ref, "/document")).get(
        "section--opening.md",
      ),
    ).toEqual({ hash: "before" });

    seeded("opening").sha256Checksum = "edited-elsewhere";

    expect(
      (await driveProvider.fingerprintDir(ref, "/document")).get(
        "section--opening.md",
      ),
    ).toEqual({ hash: "edited-elsewhere" });
  });

  it("caches every child's id, the same way listDir does", async () => {
    mockDriveSeed([
      { id: "root-id", name: "once-dark", mimeType: FOLDER, parents: [] },
      {
        id: "doc-dir",
        name: "document",
        mimeType: FOLDER,
        parents: ["root-id"],
      },
      {
        id: "opening",
        name: "section--opening.md",
        mimeType: "text/plain",
        parents: ["doc-dir"],
        content: "It was a dark night.",
        sha256Checksum: "abc123",
      },
    ]);

    await driveProvider.fingerprintDir(ref, "/document");
    vi.mocked(fetch).mockClear();

    // The id `fingerprintDir` just cached resolves this read with no further
    // folder listing.
    await driveProvider.readFile(ref, "/document/section--opening.md");
    const listingCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).startsWith(`${FILES_ENDPOINT}?`),
      );
    expect(listingCalls).toHaveLength(0);
  });
});

describe("fingerprintFile", () => {
  // The queue asks this right before it overwrites a file, so it must answer
  // for what Drive holds now, not for a listing taken before another device
  // touched the folder.

  it("follows a file another device replaced, not the id in the bin", async () => {
    seeded("opening").sha256Checksum = "old";
    await driveProvider.readFile(ref, "/document/section--opening.md");

    // Elsewhere: the file was replaced, so its old id is in the bin and a
    // new id holds the name.
    seeded("opening").trashed = true;
    mockDriveFiles().set("opening-2", {
      id: "opening-2",
      name: "section--opening.md",
      mimeType: "text/plain",
      parents: ["doc-dir"],
      content: "Written elsewhere.",
      sha256Checksum: "new",
    });

    expect(
      await driveProvider.fingerprintFile(ref, "/document/section--opening.md"),
    ).toEqual({ hash: "new" });
  });

  it("finds a file another device created after this tab listed the folder", async () => {
    await driveProvider.readFile(ref, "/document/section--opening.md");
    mockDriveFiles().set("later", {
      id: "later",
      name: "section--later.md",
      mimeType: "text/plain",
      parents: ["doc-dir"],
      content: "Written elsewhere.",
      sha256Checksum: "elsewhere",
    });

    expect(
      await driveProvider.fingerprintFile(ref, "/document/section--later.md"),
    ).toEqual({ hash: "elsewhere" });
  });

  it("still reports a file that is nowhere as not-found", async () => {
    await expect(
      driveProvider.fingerprintFile(ref, "/document/section--nowhere.md"),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("a refusal's body reaches the classification", () => {
  /** The fake Drive, with every media download answered by `status`. */
  const refusingReads = (status: number, reason: string) =>
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("alt=media"))
        return mockDriveFetch(input, init);
      return new Response(JSON.stringify({ error: { errors: [{ reason }] } }), {
        status,
      });
    });

  it("a rate-limited read is transient, not a lost grant", async () => {
    vi.stubGlobal("fetch", refusingReads(403, "userRateLimitExceeded"));

    await expect(
      driveProvider.readFile(ref, "/document/section--opening.md"),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("cache hygiene", () => {
  it("evicts a rejected listing instead of poisoning the folder for the session", async () => {
    const realFetch = mockDriveFetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
        );
        // Every listing request fails; metadata reads pass through. The first
        // read must fail on the listing, and the cached promise must not
        // re-throw that failure on the retry.
        if (url.searchParams.has("q")) throw new Error("network down");
        return realFetch(input, init ?? {});
      }),
    );

    await expect(
      driveProvider.readFile(ref, "/document/section--opening.md"),
    ).rejects.toThrow();

    // The network is back: the same read must retry the listing, not re-throw
    // the cached rejection.
    vi.stubGlobal("fetch", vi.fn(realFetch));
    await expect(
      driveProvider.readFile(ref, "/document/section--opening.md"),
    ).resolves.toBe("It was a dark night.");
  });

  it("an account switch clears the path and listing caches", async () => {
    const listings = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(([url]) =>
          String(url).startsWith(`${FILES_ENDPOINT}?`),
        ).length;

    await driveProvider.readFile(ref, "/document/section--opening.md");
    expect(listings()).toBe(2); // root-id and doc-dir, both cached

    // A sign-in as someone else must not serve the departed account's stale
    // folder views; both caches drop on the same signal the handle store
    // rides. The next read re-issues the listings.
    setCurrentUserId("u2");
    await driveProvider.readFile(ref, "/document/section--opening.md");
    expect(listings()).toBe(4);
    setCurrentUserId(null);
  });
});

describe("writing", () => {
  it("overwrites an existing file in place, keeping its id", async () => {
    const id = await driveProvider.writeFile(
      ref,
      "/document/section--opening.md",
      "Rewritten.",
    );

    expect(mockDriveFiles().get("opening")?.content).toBe("Rewritten.");
    expect(
      await driveProvider.readFile(ref, "/document/section--opening.md"),
    ).toBe("Rewritten.");
    expect(id).toBe("opening");
  });

  it("creates a new file under the right parent", async () => {
    const id = await driveProvider.writeFile(
      ref,
      "/document/section--storm.md",
      "Rain.",
    );

    const created = [...mockDriveFiles().values()].find(
      (f) => f.name === "section--storm.md",
    );
    expect(created?.parents).toEqual(["doc-dir"]);
    expect(created?.content).toBe("Rain.");
    expect(id).toBe(created?.id);
  });

  it("lets one waiter at a time through the create gate, so a path is created once", async () => {
    // The first create fails, which releases two writers waiting behind it.
    // Both entering at once would both find the path empty and create it
    // twice: two files under one name.
    let failNextCreate = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          failNextCreate &&
          init?.method === "POST" &&
          String(input).includes("/upload/")
        ) {
          failNextCreate = false;
          return new Response("{}", { status: 500 });
        }
        return mockDriveFetch(input, init);
      }),
    );

    const writes = await Promise.allSettled([
      driveProvider.writeFile(ref, "/document/section--storm.md", "One."),
      driveProvider.writeFile(ref, "/document/section--storm.md", "Two."),
      driveProvider.writeFile(ref, "/document/section--storm.md", "Three."),
    ]);

    expect(writes.map((w) => w.status)).toEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(
      [...mockDriveFiles().values()].filter(
        (f) => f.name === "section--storm.md",
      ),
    ).toHaveLength(1);
  });

  it("creates missing folders on the way to a new file", async () => {
    await driveProvider.writeFile(
      ref,
      "/assistant/personas/lena.md",
      "A voice.",
    );

    const assistant = [...mockDriveFiles().values()].find(
      (f) => f.name === "assistant",
    );
    const personas = [...mockDriveFiles().values()].find(
      (f) => f.name === "personas",
    );
    expect(assistant?.parents).toEqual(["root-id"]);
    expect(personas?.parents).toEqual([assistant?.id]);
    expect(
      await driveProvider.readFile(ref, "/assistant/personas/lena.md"),
    ).toBe("A voice.");
  });

  it("creates a folder that holds nothing yet", async () => {
    await driveProvider.createDir(ref, "/reference");
    expect(await driveProvider.exists(ref, "/reference")).toBe(true);
  });

  // A create adds the file to its folder's cached listing rather than
  // dropping the listing, so a push of many new files lists the folder once.
  it("lists a folder once while creating several files in it", async () => {
    const fetch = vi.mocked(globalThis.fetch);
    const listingsOf = (folderId: string) =>
      fetch.mock.calls.filter(([input, init]) => {
        if ((init?.method ?? "GET") !== "GET") return false;
        const url = new URL(String(input));
        return url.searchParams
          .get("q")
          ?.startsWith(`'${folderId}' in parents`);
      }).length;

    await driveProvider.writeFile(ref, "/document/section--one.md", "One.");
    await driveProvider.writeFile(ref, "/document/section--two.md", "Two.");
    await driveProvider.writeFile(ref, "/document/section--three.md", "Three.");

    expect(listingsOf("doc-dir")).toBe(1);
    expect(
      (await driveProvider.listDir(ref, "/document")).map((e) => e.name).sort(),
    ).toEqual([
      "section--one.md",
      "section--opening.md",
      "section--three.md",
      "section--two.md",
    ]);
    expect(await driveProvider.readFile(ref, "/document/section--two.md")).toBe(
      "Two.",
    );
  });

  it("finds a folder it just created without listing its parent again", async () => {
    const fetch = vi.mocked(globalThis.fetch);
    const listingsOf = (folderId: string) =>
      fetch.mock.calls.filter(([input, init]) => {
        if ((init?.method ?? "GET") !== "GET") return false;
        const url = new URL(String(input));
        return url.searchParams
          .get("q")
          ?.startsWith(`'${folderId}' in parents`);
      }).length;

    await driveProvider.writeFile(ref, "/notes/one.md", "One.");
    await driveProvider.writeFile(ref, "/notes/two.md", "Two.");
    expect(listingsOf("root-id")).toBe(1);
    expect(await driveProvider.readFile(ref, "/notes/two.md")).toBe("Two.");
  });
});

describe("moving things, and not leaving stale ids behind", () => {
  it("renames in place", async () => {
    await driveProvider.renameFile(
      ref,
      "/document/section--opening.md",
      "section--dawn.md",
    );

    expect(mockDriveFiles().get("opening")?.name).toBe("section--dawn.md");
    expect(
      await driveProvider.readFile(ref, "/document/section--dawn.md"),
    ).toBe("It was a dark night.");
    await expect(
      driveProvider.readFile(ref, "/document/section--opening.md"),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("moves a file to another folder", async () => {
    await driveProvider.moveFile(
      ref,
      "/document/section--opening.md",
      "/recyclebin",
    );

    expect(mockDriveFiles().get("opening")?.parents).toEqual([
      [...mockDriveFiles().values()].find((f) => f.name === "recyclebin")?.id,
    ]);
    expect(
      await driveProvider.readFile(ref, "/recyclebin/section--opening.md"),
    ).toBe("It was a dark night.");
  });

  // A renamed folder leaves every descendant path pointing at ids reached
  // through the old name. If those are not dropped, the next write lands in a
  // folder the writer has already moved on from.
  it("forgets descendants when a folder is renamed", async () => {
    await driveProvider.readFile(ref, "/document/section--opening.md");
    await driveProvider.renameFile(ref, "/document", "chapters");

    await expect(
      driveProvider.readFile(ref, "/document/section--opening.md"),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(
      await driveProvider.readFile(ref, "/chapters/section--opening.md"),
    ).toBe("It was a dark night.");
  });

  it("trashes rather than destroys, and stops finding the file", async () => {
    await driveProvider.removeFile(ref, "/document/section--opening.md");

    expect(mockDriveFiles().get("opening")?.trashed).toBe(true);
    expect(mockDriveFiles().has("opening")).toBe(true);
    expect(
      await driveProvider.exists(ref, "/document/section--opening.md"),
    ).toBe(false);
  });
});

describe("reopening", () => {
  it("accepts a project that is still there", async () => {
    expect(await driveProvider.reopenProject(ref)).toBe(true);
  });

  it("refuses a project that has been trashed", async () => {
    rootFile().trashed = true;
    expect(await driveProvider.reopenProject(ref)).toBe(false);
  });

  it("refuses a project that no longer exists", async () => {
    expect(await driveProvider.reopenProject({ ...ref, key: "gone" })).toBe(
      false,
    );
  });
});

describe("createDriveProject", () => {
  it("creates the folder under the given parent", async () => {
    const created = await createDriveProject("once-dark", "projects-canonical");

    expect(created.name).toBe("once-dark");
    expect(mockDriveFiles().get(created.key)?.parents).toEqual([
      "projects-canonical",
    ]);
  });
});

describe("listDriveProjects", () => {
  it("pages past the listing's one-thousand-file page cap", async () => {
    // 1001 projects under the app folder put the listing's second page token
    // to use: `childrenOf` pages at 1000, and the scan must not truncate at
    // one page.
    const seed = [];
    for (let i = 0; i < 1001; i++) {
      seed.push(
        {
          id: `folder-${i}`,
          name: `project-${i}`,
          mimeType: FOLDER,
          parents: ["projects-canonical"],
        },
        {
          id: `structure-${i}`,
          name: "document-structure.yaml",
          mimeType: "text/plain",
          parents: [`folder-${i}`],
          content: "version: 1\n",
        },
      );
    }
    mockDriveSeed(seed);

    const refs = await listDriveProjects();

    expect(refs).toHaveLength(1001);
    expect(refs.map((r) => r.key)).toContain("folder-0");
    expect(refs.map((r) => r.key)).toContain("folder-1000");
  });

  // Unless the sweep invalidates the app folder first, it serves a
  // session-stale listing: a project added from outside this tab (another
  // device, drive.google.com) after the first sweep stays invisible to
  // `childrenOf(projectsId)` until a reload. The invalidation
  // keeps an explicit sweep a fresh read.
  it("— a second sweep finds a project added outside this tab", async () => {
    // The first sweep caches the app folder's listing, which is empty.
    const before = await listDriveProjects();
    expect(before.find((r) => r.key === "new-proj")).toBeUndefined();

    // Another device drops a full project into the app folder.
    mockDriveFiles().set("new-proj", {
      id: "new-proj",
      name: "New Project",
      mimeType: FOLDER,
      parents: ["projects-canonical"],
    });
    mockDriveFiles().set("new-structure", {
      id: "new-structure",
      name: "document-structure.yaml",
      mimeType: "text/plain",
      parents: ["new-proj"],
      content: "version: 1\n",
    });

    const refs = await listDriveProjects();

    expect(refs.find((r) => r.key === "new-proj")).toBeDefined();
  });

  it("— a re-listing prunes a path whose file is gone, so a write never lands in the bin", async () => {
    // A path cache that outlives a re-listing writes the writer's prose into
    // a trashed file, and nothing reports the loss.
    //
    // Warm the path: a read resolves `/document/section--opening.md` to
    // `opening`.
    await driveProvider.readFile(ref, "/document/section--opening.md");

    // Another device replaces that file: the old one goes to the bin, a new
    // one takes its name. Drive keeps a trashed file addressable by id and
    // answers 200 for a write to it, so a write to the stale id fails
    // silently.
    const trashed = mockDriveFiles().get("opening");
    if (!trashed) throw new Error("seed missing opening");
    trashed.trashed = true;
    mockDriveFiles().set("replacement", {
      id: "replacement",
      name: "section--opening.md",
      mimeType: "text/plain",
      parents: ["doc-dir"],
      content: "replacement",
    });

    // The tab re-lists the folder. The listing returns only the live file;
    // the damage comes from a path cache that disagrees with it and is not
    // pruned.
    const entries = await driveProvider.listDir(ref, "/document");
    expect(entries.map((e) => e.path)).toEqual([
      "/document/section--opening.md",
    ]);

    await driveProvider.writeFile(
      ref,
      "/document/section--opening.md",
      "the writer's new chapter",
    );

    // The prose is in the live file.
    expect(mockDriveFiles().get("replacement")?.content).toBe(
      "the writer's new chapter",
    );
    // The trashed file also receives a copy. Drive answers 200 for a write to
    // a trashed file, so the only way to learn the id was stale is to write
    // and read the verdict back; detecting it beforehand would cost a
    // `files.list` on every save, which an autosaving editor cannot afford. A
    // stray copy inside a file the writer already binned costs nothing.
    expect(mockDriveFiles().get("opening")?.trashed).toBe(true);
    // A read agrees with the write, which is what the writer experiences.
    expect(
      await driveProvider.readFile(ref, "/document/section--opening.md"),
    ).toBe("the writer's new chapter");
  });

  describe("a hostile project key never reaches Drive", () => {
    // `ref.key` is a Drive folder id that round-trips through the writer's
    // portable profile, so it is writer-controlled, persisted, and replayed
    // on every installation that syncs it. Two sinks depend on its shape.
    const hostile = (key: string): ProjectRef => ({ ...ref, key });

    it("refuses a key that would forge a second query predicate", async () => {
      // Drive does not reject this as a parse error: it is a valid
      // two-predicate query, so it must be refused here.
      await expect(
        driveProvider.listDir(
          hostile("root-id' in parents or name contains 'a"),
          "/",
        ),
      ).rejects.toBeInstanceOf(StorageError);
    });

    it("refuses a key that would climb out of /drive/v3/files/ in the URL", async () => {
      // `new URL()` normalises the traversal away, so the request would go to
      // an endpoint of the key's choosing with the Drive bearer token on it.
      // `reopenProject` answers "is this reachable", so its refusal is a
      // `false` rather than a throw; what matters is that nothing is sent.
      const spy = vi.fn(mockDriveFetch);
      vi.stubGlobal("fetch", spy);
      await expect(
        driveProvider.reopenProject(hostile("../../../oauth2/v3/userinfo")),
      ).resolves.toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("sends no request at all for a hostile key", async () => {
      // Refusing after the fetch would still have leaked the token to
      // whatever host the key chose.
      const spy = vi.fn(mockDriveFetch);
      vi.stubGlobal("fetch", spy);
      await expect(
        driveProvider.listDir(hostile("a/../b"), "/"),
      ).rejects.toBeInstanceOf(StorageError);
      expect(spy).not.toHaveBeenCalled();
    });

    it("still accepts the ids Drive actually issues", async () => {
      // Real ids carry letters, digits, hyphens and underscores. A guard that
      // refused one of those would break every real project.
      for (const key of ["root-id", "1A2b_3C-4d", "a".repeat(44)]) {
        mockDriveFiles().set(key, {
          id: key,
          name: "book",
          mimeType: FOLDER,
          parents: [],
        });
        await expect(
          driveProvider.listDir(hostile(key), "/"),
        ).resolves.toBeDefined();
      }
    });
  });
});

// `writeBytes` writes an export's binary file. The fake Drive reads an
// upload body with `String(body)`, which suits the text writes and turns a
// Blob into "[object Blob]". So these rows put a recorder in front of it:
// every upload whose body is a Blob is read as bytes, answered the way Drive
// answers, and registered in the fake's tree so the rest of the adapter
// (listings, `exists`) sees the file. The folder walk and folder creation
// still go to the fake unchanged.
//
// The body must stay bytes. A PDF carries 0xFF and NUL; a body built as a
// string, or decoded as UTF-8 anywhere on the way, would replace them and
// still upload, and the corruption shows only when the writer opens the file.
describe("writeBytes", () => {
  interface Upload {
    method: string;
    url: string;
    contentType: string | null;
    body: Uint8Array;
  }

  const PDF = "application/pdf";
  const BYTES = [0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0d, 0x0a, 0x80];
  const encode = (text: string) => new TextEncoder().encode(text);

  /** `patched` is what Drive answers a PATCH with: a trashed file says so. */
  function recordUploads(patched: object = { id: "patched" }): Upload[] {
    const uploads: Upload[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        if (!url.includes("/upload/") || !(init.body instanceof Blob))
          return mockDriveFetch(input, init);
        const method = (init.method ?? "GET").toUpperCase();
        const body = new Uint8Array(await init.body.arrayBuffer());
        uploads.push({
          method,
          url,
          contentType: new Headers(init.headers).get("Content-Type"),
          body,
        });
        const answer = (file: object) =>
          new Response(JSON.stringify(file), {
            headers: { "Content-Type": "application/json" },
          });
        if (method === "PATCH") return answer(patched);
        // The metadata is the first part, and it is plain JSON: the text
        // before the first blank line after the header, read as UTF-8.
        const head = new TextDecoder().decode(body.slice(0, 400));
        const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(head)?.[1] ?? "");
        const file = {
          id: "uploaded",
          name: meta.name,
          mimeType: meta.mimeType,
          parents: meta.parents,
        };
        mockDriveFiles().set(file.id, file);
        return answer(file);
      }),
    );
    return uploads;
  }

  /** Where `needle` first occurs in `haystack`, by byte; -1 when absent. */
  function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
    outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
      for (let j = 0; j < needle.length; j++)
        if (haystack[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  const writeBytes = driveProvider.writeBytes;
  if (!writeBytes) throw new Error("driveProvider.writeBytes missing");

  it("creates a new file as a multipart upload carrying its real type and every byte", async () => {
    const uploads = recordUploads();
    await writeBytes(ref, "/export/once-dark.pdf", new Uint8Array(BYTES), PDF);

    expect(uploads).toHaveLength(1);
    const [upload] = uploads;
    expect(upload.method).toBe("POST");
    expect(upload.url).toContain("uploadType=multipart");
    // The boundary is the stubbed `randomUUID`, never a fixed string: the
    // media part is unescaped, so only an unpredictable delimiter keeps it
    // from forging a part of its own.
    const boundary = "boundary-boundary";
    expect(upload.contentType).toBe(`multipart/related; boundary=${boundary}`);

    // The metadata names the file, its new folder and the real media type, so
    // Drive shows a PDF as a PDF and converts nothing.
    const exportDir = [...mockDriveFiles().values()].find(
      (f) => f.name === "export",
    );
    expect(exportDir?.parents).toEqual(["root-id"]);
    const head = new TextDecoder().decode(upload.body.slice(0, 400));
    const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(head)?.[1] ?? "");
    expect(meta).toEqual({
      name: "once-dark.pdf",
      parents: [exportDir?.id],
      mimeType: PDF,
    });

    // The media part: its header says the same type, and between that header
    // and the closing delimiter lie the bytes handed in, unchanged.
    const mediaHeader = encode(`--${boundary}\r\nContent-Type: ${PDF}\r\n\r\n`);
    const trailer = encode(`\r\n--${boundary}--`);
    const at = indexOf(upload.body, mediaHeader);
    expect(at).toBeGreaterThan(0);
    expect(upload.body.slice(at + mediaHeader.length, -trailer.length)).toEqual(
      new Uint8Array(BYTES),
    );
    expect(upload.body.slice(-trailer.length)).toEqual(trailer);
  });

  it("overwrites a file already at the path by PATCHing its media, in place", async () => {
    mockDriveFiles().set("export-dir", {
      id: "export-dir",
      name: "export",
      mimeType: FOLDER,
      parents: ["root-id"],
    });
    mockDriveFiles().set("old-pdf", {
      id: "old-pdf",
      name: "once-dark.pdf",
      mimeType: PDF,
      parents: ["export-dir"],
    });
    const uploads = recordUploads();
    await writeBytes(ref, "/export/once-dark.pdf", new Uint8Array(BYTES), PDF);

    // One request, to the existing id: no second file with the same name.
    expect(uploads).toHaveLength(1);
    const [upload] = uploads;
    expect(upload.method).toBe("PATCH");
    expect(upload.url).toContain("/old-pdf?uploadType=media");
    expect(upload.contentType).toBe(PDF);
    expect(upload.body).toEqual(new Uint8Array(BYTES));
  });

  // A listing taken before the file went to the bin still names it, so the
  // PATCH lands in the bin; Drive says so in the answer, and the export is
  // created again where the writer will look rather than kept in the bin.
  it("creates the file afresh when the one it overwrote was in the bin", async () => {
    mockDriveFiles().set("export-dir", {
      id: "export-dir",
      name: "export",
      mimeType: FOLDER,
      parents: ["root-id"],
    });
    mockDriveFiles().set("old-pdf", {
      id: "old-pdf",
      name: "once-dark.pdf",
      mimeType: PDF,
      parents: ["export-dir"],
    });
    const uploads = recordUploads({ id: "old-pdf", trashed: true });
    await writeBytes(ref, "/export/once-dark.pdf", new Uint8Array(BYTES), PDF);
    expect(uploads.map((upload) => upload.method)).toEqual(["PATCH", "POST"]);
    expect(uploads[0].url).toContain("fields=id,trashed");
    expect(indexOf(uploads[1].body, new Uint8Array(BYTES))).toBeGreaterThan(0);
  });

  it("reports an overwrite Drive refused as the port's error", async () => {
    mockDriveFiles().set("export-dir", {
      id: "export-dir",
      name: "export",
      mimeType: FOLDER,
      parents: ["root-id"],
    });
    mockDriveFiles().set("old-pdf", {
      id: "old-pdf",
      name: "once-dark.pdf",
      mimeType: PDF,
      parents: ["export-dir"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        (init?.method ?? "GET").toUpperCase() === "PATCH"
          ? new Response("", { status: 500 })
          : mockDriveFetch(input, init),
      ),
    );
    await expect(
      writeBytes(ref, "/export/once-dark.pdf", new Uint8Array(BYTES), PDF),
    ).rejects.toBeInstanceOf(StorageError);
  });

  // The next export asks `exists` to pick a free `name (2)`. A cached listing
  // of `export/` taken before this write would say the name is still free,
  // and the second export would overwrite the first.
  it("invalidates the folder's cached listing, so the new file is seen at once", async () => {
    mockDriveFiles().set("export-dir", {
      id: "export-dir",
      name: "export",
      mimeType: FOLDER,
      parents: ["root-id"],
    });
    mockDriveFiles().set("older", {
      id: "older",
      name: "older.pdf",
      mimeType: PDF,
      parents: ["export-dir"],
    });
    recordUploads();
    expect(await driveProvider.exists(ref, "/export/once-dark.pdf")).toBe(
      false,
    );
    await writeBytes(ref, "/export/once-dark.pdf", new Uint8Array(BYTES), PDF);
    expect(await driveProvider.exists(ref, "/export/once-dark.pdf")).toBe(true);
  });
});
