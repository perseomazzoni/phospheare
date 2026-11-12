// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./session";
import { START_MS } from "./start";

// A signed-in project, for the rows the demo cannot carry. The demo's
// Assistant answers from the static demo model alone, so a row about
// a real model's wiring, or about what a writer's own book holds, needs a
// project opened by a writer. The bridge builds an Assistant for any open
// writer with a project ready (`EditorRoute.tsx`); its models are the device
// runtime and any connected remote provider, and a row stubs whichever it
// talks to.
//
// It repeats `local-shelf.spec.ts`'s route in miniature rather than importing
// it: that file's picker stub also carries the permission model and the
// reveal recorder its rows assert against, and importing a spec file
// registers its tests in the importer. Both share the shape (an OPFS folder
// standing in for the native picker, a book that survives the strict open
// pipeline), so a change to a local book's layout lands in both.

/** The OPFS folder that stands in for the writer's local root. */
export const LOCAL_ROOT = "phospheare-e2e-ai-root";

/** The book's title, as its card names it, and its folder in the root. */
export const BOOK_TITLE = "Once Dark";
export const BOOK_FOLDER = "once-dark";

/** The Section the rows open, its file, and the one line of prose it holds. */
export const SECTION = "Opening";
export const SECTION_FILE = "section--opening.EL2.00.md";
export const PROSE = "The house had been empty for a year.";

// The current record shape, with snapshots keyed by node id in the catalogue
// rather than inline in the yaml: a seed in any other shape fails the strict
// open.
const BOOK_PROPERTIES = JSON.stringify({
  schemaVersion: 1,
  document: {
    // A real uuid: it is the project's address (`editor/path.ts`). It differs
    // from `local-shelf.spec.ts`'s so the two fixtures are never one library
    // row.
    id: "5d0f3b1e-7a2c-4e8f-9b61-2c4d8e0a9f13",
    title: "Once Dark",
    type: "Novel",
    structure: "threeact",
    language: "en",
    goal: 4800,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  sync: null,
  ui: { expanded: ["EL1"], lastOpened: null },
  stats: {
    words: 0,
    parts: 0,
    sections: 0,
    countedAt: "2026-01-01T00:00:00.000Z",
    perNode: [],
  },
});

const BOOK_CATALOGUE = JSON.stringify({
  snapshots: {
    EL1: [
      {
        file: "part--act_one.EL1.00.md",
        title: "Act One 1",
        created: "2026-01-01T00:00:00.000Z",
      },
    ],
    EL2: [
      {
        file: "section--opening.EL2.00.md",
        title: "Opening 1",
        created: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
  binned: {},
});

const BOOK_STRUCTURE = [
  "# Phospheare — document structure",
  "version: 1",
  "document:",
  "  - id: EL1",
  '    part: "Act One"',
  "    adopted: part--act_one.EL1.00.md",
  "    children:",
  "      - id: EL2",
  '        section: "Opening"',
  "        adopted: section--opening.EL2.00.md",
].join("\n");

/**
 * Skips the running test unless the browser can hold a local project. Call it
 * first in a test or its `beforeEach`.
 */
export function skipWithoutLocalFolders(browserName: string): void {
  // The route is a local project, which needs the File System Access API; the
  // OPFS stand-in below needs `createWritable`, which only Chromium carries.
  // The WebKit profiles keep every demo row and skip only the rows that need
  // a local project.
  test.skip(
    browserName !== "chromium",
    "a local project needs the File System Access API, which only Chromium has",
  );
}

/**
 * Presses the welcome's "Show my projects" when the welcome is the face
 * drawn, and waits for `shelf` either way. When a mapped folder's cards land
 * before the welcome is latched (`useWelcomeLatch`), the shelf is drawn
 * without it.
 */
export async function pastTheWelcome(
  page: Page,
  shelf: Locator,
): Promise<void> {
  const show = page.getByRole("button", { name: "Show my projects" });
  await expect(show.or(shelf).first()).toBeVisible({ timeout: 15_000 });
  if (await show.isVisible()) await show.click();
  await expect(shelf.first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Signs in as a local writer, maps an OPFS folder holding one book as the
 * local root, and opens the book and its one Section.
 *
 * Ends where `/app/editor/demo` plus "Continue writing" ends, with prose on
 * screen, the bar up and the dock closed, but with the writer's Assistant
 * behind it: the device runtime is its only model, and no remote provider is
 * connected.
 *
 * Every call to Ollama, OpenRouter or Wikipedia that the row does not stub
 * itself is refused at the context, so no request leaves the machine. A
 * row's own `page.route` stubs take precedence over these.
 */
export async function openSignedInProject(page: Page): Promise<void> {
  await refuseOutside(page);
  await signIn(page);
  await stubLocalPicker(page);

  await page.goto("/app");
  const choose = page.getByRole("button", { name: "Choose local folder" });
  await expect(choose).toBeVisible({ timeout: START_MS });
  await seedLocalBook(page);
  await choose.click();
  // The card's own link, as a writer reaches the book.
  const link = page.getByRole("link", { name: BOOK_TITLE });
  await pastTheWelcome(page, link);
  await link.click();
  await openSection(page);
}

/**
 * Stubs the native folder picker. It cannot be automated, so the stub
 * returns an OPFS folder: a real directory handle, structured-cloneable into
 * IndexedDB like the picker's, and always granted. Call it before the first
 * `goto`.
 */
export async function stubLocalPicker(page: Page): Promise<void> {
  await page.addInitScript(
    ({ root }) => {
      window.showDirectoryPicker = async () => {
        const base = await navigator.storage.getDirectory();
        return base.getDirectoryHandle(root, { create: true });
      };
    },
    { root: LOCAL_ROOT },
  );
}

/**
 * Writes the book into the local root, emptied first. It runs on the app's
 * own origin, since OPFS exists only under a secure one. The context's OPFS
 * starts empty, so a row that starts "no chat yet" means it.
 */
export async function seedLocalBook(page: Page): Promise<void> {
  await page.evaluate(
    async ({ root, folder, file, properties, catalogue, structure, prose }) => {
      const base = await navigator.storage.getDirectory();
      await base.removeEntry(root, { recursive: true }).catch(() => {});
      const top = await base.getDirectoryHandle(root, { create: true });
      const book = await top.getDirectoryHandle(folder, { create: true });
      const write = async (
        dir: FileSystemDirectoryHandle,
        name: string,
        content: string,
      ) => {
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      };
      await write(book, "document-properties.json", properties);
      await write(book, "snapshots-catalogue.json", catalogue);
      await write(book, "document-structure.yaml", structure);
      const doc = await book.getDirectoryHandle("document", { create: true });
      await write(doc, "part--act_one.EL1.00.md", "# Act One\n");
      await write(doc, file, `${prose}\n`);
    },
    {
      root: LOCAL_ROOT,
      folder: BOOK_FOLDER,
      file: SECTION_FILE,
      properties: BOOK_PROPERTIES,
      catalogue: BOOK_CATALOGUE,
      structure: BOOK_STRUCTURE,
      prose: PROSE,
    },
  );
}

/**
 * From the book's editor route, opens its one Section and waits for the
 * prose.
 */
export async function openSection(page: Page): Promise<void> {
  // On a desk the Section opens through the structure panel: the Desk's entry
  // animation re-triggers while the open pipeline's stats backfill lands, so
  // its button never settles. On the phone plane the Desk fills the screen
  // and the panel's button is in a bar the Desk has not raised, so the Desk's
  // own "Continue writing" is the way in, as on the demo.
  await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 20_000 });
  if (
    (await page.locator(".editor-shell").getAttribute("data-phone")) === "1"
  ) {
    await page
      .getByRole("button", { name: "Continue writing" })
      .click({ timeout: 20_000 });
  } else {
    const section = page.getByRole("button", { name: SECTION, exact: true });
    await expect(section).toBeVisible({ timeout: 20_000 });
    await section.click();
  }
  await expect(page.locator(".editor p").getByText(PROSE)).toBeVisible({
    timeout: 15_000,
  });
}

/** Refuses the device runtime and both remote hosts at the context. */
export async function refuseOutside(page: Page): Promise<void> {
  const context = page.context();
  await context.route("http://localhost:11434/**", (route) =>
    route.abort("connectionrefused"),
  );
  await context.route(
    (url) =>
      url.hostname === "openrouter.ai" ||
      url.hostname.endsWith(".wikipedia.org"),
    (route) => route.abort("connectionrefused"),
  );
}
