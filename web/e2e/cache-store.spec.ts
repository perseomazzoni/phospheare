// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The working copy against a real origin private file system: whether a real
// engine accepts the names `opfsCacheStore.ts` generates, what an interrupted
// write leaves behind, and whether an entry survives a reload, which jsdom
// cannot answer. Every refusal, miss semantic, exception-to-code mapping and
// eviction response is pinned in `src/storage/cache/opfsCacheStore.test.ts`,
// which counts toward the coverage gate. Nothing whose failure loses or
// corrupts the writer's bytes rests on this file alone.
//
// It needs no account, no stack and no token, only a browser and an origin,
// so it does not self-skip: a skip that fired on Chromium would silently
// erase the spec. It exercises the module as Vite serves it in dev, never the
// shipped bundle.
//
// `reuseExistingServer: true` means it may run against a developer's own
// dev server with real data, so:
//   1. It confines itself to `cache/<a test id no account can mint>/`, and
//      never calls `dropOtherUserCaches` or removes `cache/` itself; either
//      would delete a real writer's cached prose.
//   2. It runs on a blank dev-server page rather than inside the app, so there
//      is one copy of the module's bound-user state.

import { expect, test } from "@playwright/test";

/**
 * A user id no real account can hold, since identity issues auto-increment
 * integers, while still inside `cacheRoot.ts`'s `SAFE_ID` alphabet.
 */
const TEST_USER = "e2e-cache-user";

/** The dev server's port, as `playwright.config.ts` starts it. */
const DEV_PORT = 5173;

/** A blank page on the dev-server origin: an origin is all OPFS needs. */
async function blankOrigin(page: import("@playwright/test").Page) {
  await page.goto(`http://localhost:${DEV_PORT}/robots.txt`);
}

/** Removes only this spec's own directory, never `cache/` or another user's. */
async function wipe(page: import("@playwright/test").Page) {
  await page.evaluate(async (user) => {
    const root = await navigator.storage.getDirectory();
    const cache = await root
      .getDirectoryHandle("cache", { create: false })
      .catch(() => null);
    await cache?.removeEntry(user, { recursive: true }).catch(() => {});
  }, TEST_USER);
}

/**
 * The adapter as `primeCache` stashes it on `window.__openCache`.
 *
 * The page bodies are real functions passed to `page.evaluate`, which
 * Playwright injects over CDP outside the page's policy. Strings run through
 * `new Function` fail under the app's `script-src 'self'`, and adding
 * `'unsafe-eval'` to the dev policy would hide a real `new Function` creeping
 * into app code during development. The module namespace cannot cross
 * Playwright's serialization boundary, so the adapter is stashed rather than
 * returned.
 */
type PageCache = {
  write(path: string, text: string): Promise<{ hash: string }>;
  read(path: string): Promise<{ text: string; hash: string } | null>;
  dropProject(): Promise<void>;
};

type CachePage = typeof globalThis & { __openCache: () => PageCache };

async function primeCache(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(async (user) => {
    // Paths the dev server serves, held in variables so the type checker
    // does not try to resolve them on disk.
    const authPath = "/src/auth/currentUser.ts";
    const storePath = "/src/storage/cache/opfsCacheStore.ts";
    const auth = (await import(
      /* @vite-ignore */ authPath
    )) as typeof import("../src/auth/currentUser");
    auth.setCurrentUserId(user);
    const store = (await import(
      /* @vite-ignore */ storePath
    )) as typeof import("../src/storage/cache/opfsCacheStore");
    (window as unknown as CachePage).__openCache = () =>
      store.openCacheStore({
        id: "A Book — with an awkward name/…",
        remote: { providerId: "drive", key: "folder-1" },
      }) as unknown as PageCache;
  }, TEST_USER);
}

test.beforeEach(async ({ page }) => {
  await blankOrigin(page);
  // At the start as well as the end: OPFS outlives the test that wrote it,
  // `workers: 1` shares one origin across the file, and an `afterEach` does
  // not run when a test crashes.
  await wipe(page);
});

test.afterEach(async ({ page }) => {
  await wipe(page);
});

test("a real engine accepts the names we generate, and round-trips the bytes", async ({
  page,
}) => {
  // The unit suite proves the segment comes from `[0-9a-f]{64}`; this proves
  // the platform accepts it, from a project key holding a space, an em dash,
  // a slash and an ellipsis.
  const text = "Ch. 1 — “quoted”, é, 😀\r\nand a CRLF\n";
  await primeCache(page);
  const out = await page.evaluate(async (body) => {
    const s = (window as unknown as CachePage).__openCache();
    const w = await s.write("/document/section--opening.EL2.00.md", body);
    const r = await s.read("/document/section--opening.EL2.00.md");
    return { text: r?.text, same: r?.hash === w.hash };
  }, text);
  expect(out.text).toBe(text);
  expect(out.same).toBe(true);
});

test("an entry survives a reload — this is a real file, not a tab's memory", async ({
  page,
}) => {
  await primeCache(page);
  await page.evaluate(async () => {
    await (window as unknown as CachePage)
      .__openCache()
      .write("/document/a.md", "written before the reload");
  });
  await page.reload();
  // The reload discards the stash with the realm, so the page is primed
  // again: the bytes survive, the tab's memory does not.
  await primeCache(page);
  const text = await page.evaluate(async () => {
    const e = await (window as unknown as CachePage)
      .__openCache()
      .read("/document/a.md");
    return e ? e.text : null;
  });
  expect(text).toBe("written before the reload");
});

test("an interrupted write leaves the previous entry intact on this engine", async ({
  page,
}) => {
  // Chromium's `createWritable()` writes to a swap file: the previous entry
  // stays readable during the write, and `abort()` leaves it as it was.
  // `fakeOpfs.fixture.ts` models the pessimistic case, a truncated visible
  // file. The header checksum still matters on this engine: it lets `has()`
  // mean complete, it is the drain's comparison value, and it keeps the
  // adapter independent of one engine's swap-file behaviour.
  await primeCache(page);
  const seen = await page.evaluate(async (user) => {
    const s = (window as unknown as CachePage).__openCache();
    await s.write("/document/a.md", "the good version");
    const root = await navigator.storage.getDirectory();
    const cache = await root.getDirectoryHandle("cache");
    const userDir = await cache.getDirectoryHandle(user);
    // The book's segment, then the remote's copy inside it.
    let seg: FileSystemDirectoryHandle = userDir;
    for (let depth = 0; depth < 2; depth++) {
      const names: string[] = [];
      for await (const k of seg.keys()) names.push(k);
      seg = await seg.getDirectoryHandle(names[0]);
    }
    const dir = await seg.getDirectoryHandle("document");
    const file = await dir.getFileHandle("a.md");
    const writable = await file.createWritable();
    const midWrite = await (await file.getFile()).text();
    await writable.abort();
    const entry = await s.read("/document/a.md");
    return { midWrite, afterMiss: entry === null };
  }, TEST_USER);

  // The previous entry is readable mid-write, header and all…
  expect(seen.midWrite).toContain("the good version");
  // …and an aborted write leaves it readable, not a miss.
  expect(seen.afterMiss).toBe(false);
});

test("dropping the project takes its remote's copy and leaves the user directory", async ({
  page,
}) => {
  await primeCache(page);
  const left = await page.evaluate(async (user) => {
    const s = (window as unknown as CachePage).__openCache();
    await s.write("/document/a.md", "one");
    await s.dropProject();
    const root = await navigator.storage.getDirectory();
    const cache = await root.getDirectoryHandle("cache");
    const userDir = await cache.getDirectoryHandle(user);
    const books: string[] = [];
    for await (const k of userDir.keys()) books.push(k);
    const book = await userDir.getDirectoryHandle(books[0]);
    const copies: string[] = [];
    for await (const k of book.keys()) copies.push(k);
    return { books: books.length, copies };
  }, TEST_USER);

  // The book's segment outlives the copy: the budget sweep evicts it.
  expect(left).toEqual({ books: 1, copies: [] });
});
