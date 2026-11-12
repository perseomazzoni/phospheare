// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A Local+Synced project loses its connection mid-session: the writer's save
// still reaches the book's folder on this device, the Remote Storage copy
// stays as it was while the connection is down, and the queued write arrives
// there once the connection returns. Both sides are read back as bytes, never
// inferred from the save indicator.
//
// Remote Storage is `mockDrive.fixture.ts`, the in-memory Drive the unit
// suites run the real provider against, served here at the context to the
// page's own `fetch`. Every byte the page sends to Drive lands in it, and the
// spec reads it from Node. The access token comes from a stubbed identity
// route, so the run needs no identity service and no Google account.
//
// The pairing is made the way a writer makes it, through the card's "Sync to
// Remote Storage", so the manifest's baselines are the ones the app wrote.
//
// Out of reach here: a real Drive's checksums (the fake answers no
// `sha256Checksum` or `modifiedTime`, so every baseline is weak), a reload
// while offline (no service worker serves the app), and which of the `online`
// event and the queue's own retry timer delivered the write; the unit suite
// for `src/project/sync/remoteQueue.ts` covers the timing.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import en from "../src/locales/en.json" with { type: "json" };
import {
  mockDriveFetch,
  mockDriveFiles,
  mockDriveSeed,
} from "../src/storage/mockDrive.fixture";
import { signIn, WRITER_ID } from "./session";
import {
  BOOK_FOLDER,
  BOOK_TITLE,
  LOCAL_ROOT,
  PROSE,
  SECTION_FILE,
  openSection,
  pastTheWelcome,
  refuseOutside,
  seedLocalBook,
  skipWithoutLocalFolders,
  stubLocalPicker,
} from "./signedInProject";
import { START_MS } from "./start";

/** What the writer adds while the connection is down. */
const ADDED = " Nobody had told the lamps.";

/**
 * The account `session.ts` signs in, with a Remote Storage grant. `signIn`
 * writes its own record only when none is there, so this one, registered
 * first, is the one the app reads.
 */
async function withRemoteStorageGrant(page: Page): Promise<void> {
  await page.addInitScript((id) => {
    if (localStorage.getItem("accounts") !== null) return;
    localStorage.setItem(
      "accounts",
      JSON.stringify([
        {
          id,
          createdAt: "2026-01-01T00:00:00.000Z",
          google: {
            iss: "https://accounts.google.com",
            sub: "e2e-google-writer",
            email: "writer@example.test",
            emailVerified: true,
            name: "E2E Writer",
            picture: null,
          },
          drive: {
            connectionId: "e2e-connection",
            sub: "e2e-google-writer",
            email: "writer@example.test",
            scopes: ["https://www.googleapis.com/auth/drive.file"],
            connectedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ]),
    );
  }, WRITER_ID);
  await page.route("**/identity/google/token", (route) =>
    route.fulfill({
      json: { accessToken: "e2e-access-token", expiresIn: 3600 },
    }),
  );
}

/**
 * Serves Drive from the in-memory fake. `link.up` false refuses every request
 * the way a lost connection does, whether or not the browser's own offline
 * emulation reaches requests a route intercepts.
 */
async function serveRemoteStorage(
  context: BrowserContext,
): Promise<{ up: boolean }> {
  mockDriveSeed([]);
  const link = { up: true };
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE",
  };
  await context.route("https://www.googleapis.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (!link.up) return route.abort("internetdisconnected");
    const answer = await mockDriveFetch(request.url(), {
      method: request.method(),
      body: request.postData() ?? undefined,
    });
    await route.fulfill({
      status: answer.status,
      headers: {
        ...cors,
        "content-type": answer.headers.get("content-type") ?? "text/plain",
      },
      body: await answer.text(),
    });
  });
  return link;
}

/**
 * The Section's bytes in the book's folder on this device, or `null` when the
 * read met a write in progress: Chromium refuses to read a file whose
 * writable is closing (`NotReadableError`), and the caller polls again.
 */
function onDevice(page: Page): Promise<string | null> {
  return page.evaluate(
    async ({ root, book, file }) => {
      const base = await navigator.storage.getDirectory();
      const dir = await (
        await (await base.getDirectoryHandle(root)).getDirectoryHandle(book)
      ).getDirectoryHandle("document");
      try {
        return await (await (await dir.getFileHandle(file)).getFile()).text();
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotReadableError")
          return null;
        throw error;
      }
    },
    { root: LOCAL_ROOT, book: BOOK_FOLDER, file: SECTION_FILE },
  );
}

/** The Section's bytes in Remote Storage, or `null` before it has a copy. */
function inRemoteStorage(): string | null {
  const copies = [...mockDriveFiles().values()].filter(
    (f) => f.name === SECTION_FILE && !f.trashed,
  );
  if (copies.length > 1)
    throw new Error(`Remote Storage holds ${copies.length} copies of the file`);
  return copies[0]?.content ?? null;
}

test.beforeEach(({ browserName }) => skipWithoutLocalFolders(browserName));

test("a save made offline reaches the device at once and Remote Storage on reconnect", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await refuseOutside(page);
  await withRemoteStorageGrant(page);
  await signIn(page);
  await stubLocalPicker(page);
  const link = await serveRemoteStorage(context);

  // Remote Storage is already set up, so the welcome offers the device's
  // folder as a second place, and the press is the picker.
  await page.goto("/app");
  const addLocal = page.getByRole("button", {
    name: en.library.setup.addLocal,
  });
  await expect(addLocal).toBeVisible({ timeout: START_MS });
  await seedLocalBook(page);
  await addLocal.click();
  const card = page.getByRole("link", { name: BOOK_TITLE });
  await pastTheWelcome(page, card);

  // Pair the book from its card, as a writer does.
  await page.getByRole("button", { name: `Actions for ${BOOK_TITLE}` }).click();
  await page.getByRole("menuitem", { name: en.library.syncToDrive }).click();
  await page
    .getByRole("dialog", { name: en.library.syncConfirmTitle })
    .getByRole("button", { name: en.library.syncConfirmConfirm })
    .click();
  // The toast names the book by its folder; the sentence after the name is
  // enough to find it.
  await expect(
    page.getByText(en.library.syncStarted.split("{{name}}")[1]),
  ).toBeVisible({ timeout: 20_000 });
  // The copy is the premise: Remote Storage holds the Section as the device
  // does before anything goes offline.
  expect(inRemoteStorage()).toBe(`${PROSE}\n`);

  await card.click();
  await openSection(page);
  const paragraph = page.locator(".editor p").getByText(PROSE);

  // Every request to Remote Storage that failed, whichever of the browser's
  // offline mode and the route refused it.
  const refused: string[] = [];
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).hostname === "www.googleapis.com")
      refused.push(request.url());
  });
  link.up = false;
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

  // A request already in flight when the connection dropped is not this
  // write's.
  refused.length = 0;
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(ADDED);
  await page.keyboard.press("Control+s");

  // The device's folder holds the new words while the connection is down.
  await expect
    .poll(() => onDevice(page), { timeout: 15_000 })
    .toContain(`${PROSE}${ADDED}`);
  // Remote Storage still holds the copy from before: nothing reached it.
  expect(inRemoteStorage()).toBe(`${PROSE}\n`);

  // The queue tried and was refused, so what arrives later is the queued
  // write delivered again, not a first attempt that waited for the network.
  await expect
    .poll(() => refused.length, {
      message: "the queue should have tried Remote Storage while offline",
    })
    .toBeGreaterThan(0);
  expect(inRemoteStorage()).toBe(`${PROSE}\n`);

  link.up = true;
  await context.setOffline(false);

  // No press and no reload: the reconnection alone drains the queue.
  await expect
    .poll(inRemoteStorage, { timeout: 30_000 })
    .toContain(`${PROSE}${ADDED}`);
  // Both sides hold the same bytes once the drain has run.
  await expect.poll(() => onDevice(page)).toBe(inRemoteStorage());
});
