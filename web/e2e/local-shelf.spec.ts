// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./session";
import { pastTheWelcome } from "./signedInProject";
// The banner copy is read from the locale file, never copied into the spec, so
// a reword cannot fail this row as a shelf bug. The assertion
// still proves the banner rendered.
// The `with { type: "json" }` attribute is required: Playwright loads specs
// as real ESM, where a bare JSON import is a TypeError rather than a warning.
import en from "../src/locales/en.json" with { type: "json" };
import { PRODUCT } from "../src/product";

// The local shelf in a real Chromium against the real File System Access API.
// Unit tests with fake handles cannot catch a probe the real API rejects, such
// as `getFileHandle("/document-structure.yaml")` where a bare name is required,
// which skipped every book and left the shelf empty.
//
// The picker cannot be automated, so `showDirectoryPicker` is stubbed at init
// to return an OPFS (Origin Private File System) subfolder. That is a real
// `FileSystemDirectoryHandle` with real semantics: slash names rejected,
// structured-cloneable into IndexedDB, permission "granted".
//
// The Library sits behind the writer gate, so every row signs in as a local
// writer first (`session.ts`).
//
// Two navigation facts the tests are written around:
//   - The Library is the index of `/app`. `/app/library` is not a route; it
//     falls through the catch-all to `/` and bounces back as `/app`.
//   - A Playwright context starts with clean storage, but an `addInitScript`
//     runs on every navigation, so anything it wiped would be wiped again
//     under the reload steps these tests perform.

const ROOT = "phospheare-e2e-root";

/** Wipe the e2e root, then seed one real book directly in it. */
async function seedBook(
  page: Page,
  title = "The Lantern Keeper",
): Promise<void> {
  await page.evaluate(
    async ({ root, title }) => {
      const base = await navigator.storage.getDirectory();
      await base.removeEntry(root, { recursive: true }).catch(() => {});
      const top = await base.getDirectoryHandle(root, { create: true });
      const book = await top.getDirectoryHandle("the-lantern-keeper", {
        create: true,
      });
      const write = async (name: string, content: string) => {
        const handle = await book.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      };
      await write(
        "document-properties.json",
        JSON.stringify({ document: { title } }),
      );
      await write(
        "snapshots-catalogue.json",
        JSON.stringify({ snapshots: {}, binned: {} }),
      );
      await write("document-structure.yaml", "document: []\n");
    },
    { root: ROOT, title },
  );
}

/**
 * Signs in and stubs the picker; every test starts here. Both go on before
 * any navigation so the boot never sees an anonymous frame. Nothing else is
 * pre-seeded, because a context starts clean and this script fires on every
 * navigation.
 */
async function boot(page: Page): Promise<void> {
  await signIn(page);
  await page.addInitScript(
    ({ root }) => {
      // The app's `pickFolder` reads `window.showDirectoryPicker` at call
      // time, so a real OPFS handle stands in for the native picker's result.
      // A pick always grants in a real browser, so the model flips to
      // "granted" before the walk, which the patched `getDirectoryHandle` in
      // `stubPermissions` would otherwise block. That is how the picker
      // unlocks even a browser-held denial.
      // The same stub serves "Show the folder": its `startIn` is
      // recorded so the reveal row can assert where the dialog
      // opened, at the book when the grant holds and at the root when it
      // lapsed.
      window.showDirectoryPicker = async (opts?: DirectoryPickerOptions) => {
        const perm = (
          window as unknown as {
            __phosphearePerm?: { permission: string; requested: number };
          }
        ).__phosphearePerm;
        if (perm) {
          perm.permission = "granted";
          try {
            sessionStorage.setItem("phospheare-e2e-perm", JSON.stringify(perm));
          } catch {
            // The window copy still governs this document.
          }
        }
        const rec = (
          window as unknown as {
            __phosphearePicker?: { calls: number; lastStartIn: string | null };
          }
        ).__phosphearePicker;
        if (rec) {
          rec.calls += 1;
          rec.lastStartIn =
            typeof opts?.startIn === "object" ? opts.startIn.name : null;
        }
        const base = await navigator.storage.getDirectory();
        return base.getDirectoryHandle(root, { create: true });
      };
    },
    { root: ROOT },
  );
}

/**
 * Models a browser's directory permission. OPFS handles are
 * always granted, so a lapsed grant cannot be reproduced without it.
 *
 * The patch owns `queryPermission` and `requestPermission` for every directory
 * handle and keeps its state where the spec can reach it.
 * `window.__phosphearePerm.permission` moves between granted, prompt and
 * denied; `requested` counts request attempts, which the mount must never
 * raise. A "denied" state is sticky like Chrome's: requests resolve denied
 * without prompting again. Requests honour transient user activation, the
 * custody the production guard enforces.
 */
async function stubPermissions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // The model lives in sessionStorage because an `addInitScript` fires on
    // every navigation: a plain variable would reset to "granted" each time
    // the spec deep-links into the editor.
    const load = (): { permission: string; requested: number } => {
      try {
        const raw = sessionStorage.getItem("phospheare-e2e-perm");
        if (raw) return JSON.parse(raw);
      } catch {
        // A sandboxed context can refuse storage; start fresh.
      }
      return { permission: "granted", requested: 0 };
    };
    const save = (): void => {
      try {
        sessionStorage.setItem("phospheare-e2e-perm", JSON.stringify(state));
      } catch {
        // The spec's assertions degrade, not the app.
      }
    };
    const state = load();
    (
      window as unknown as {
        __phosphearePerm: typeof state;
      }
    ).__phosphearePerm = state;
    // The picker recorder for the reveal specs.
    (
      window as unknown as {
        __phosphearePicker: { calls: number; lastStartIn: string | null };
      }
    ).__phosphearePicker = { calls: 0, lastStartIn: null };
    FileSystemDirectoryHandle.prototype.queryPermission =
      async function queryPermission(): Promise<PermissionState> {
        return state.permission as PermissionState;
      };
    FileSystemDirectoryHandle.prototype.requestPermission =
      async function requestPermission(): Promise<PermissionState> {
        state.requested += 1;
        save();
        if (!navigator.userActivation.isActive) return "denied";
        // Chrome remembers a block and never prompts again until site
        // settings reset it; the blocked rows depend on that.
        if (state.permission === "denied") return "denied";
        state.permission = "granted";
        save();
        return "granted";
      };
    // A lapsed grant makes real handle walks throw `NotAllowedError`; OPFS
    // handles never lapse, so the model throws instead. That drives the
    // reveal's fallback: `projectHandleFor` returns null and `startIn` is the
    // root.
    const walk = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
    FileSystemDirectoryHandle.prototype.getDirectoryHandle =
      async function getDirectoryHandle(
        this: FileSystemDirectoryHandle,
        name: string,
        opts?: { create?: boolean },
      ): Promise<FileSystemDirectoryHandle> {
        if (state.permission !== "granted" && !opts?.create)
          throw new DOMException("Blocked", "NotAllowedError");
        return walk.call(this, name, opts);
      };
  });
}

/** Flip the modelled grant from the test, surviving later navigations. */
async function lapseGrant(page: Page, to: "prompt" | "denied"): Promise<void> {
  await page.evaluate((to) => {
    const perm = (
      window as unknown as {
        __phosphearePerm: { permission: string; requested: number };
      }
    ).__phosphearePerm;
    perm.permission = to;
    try {
      sessionStorage.setItem("phospheare-e2e-perm", JSON.stringify(perm));
    } catch {
      // The window copy still governs this document.
    }
  }, to);
}

// A book that survives the strict open pipeline, so the reconnect flow ends in
// an open editor: one Part holding one Section, every file on disk. Snapshot
// records live in `snapshots-catalogue.json` keyed by node id; a seed with
// inline `snapshots:` blocks in the yaml fails the strict reconcile.
const BOOK_PROPERTIES = JSON.stringify({
  schemaVersion: 1,
  document: {
    // A real uuid, not `doc-1`: this id is the project's address
    // (`editor/path.ts`), and the shelf's link is checked to be a uuid that
    // cannot be mistaken for a folder name.
    id: "110602fd-b26c-4bb4-8d3f-8446b74cdf48",
    title: "The Lantern Keeper",
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

test("a mapped local folder shows its books on the shelf, across a reload", async ({
  page,
}) => {
  await boot(page);

  await page.goto("/app");
  await expect(
    page.getByRole("button", { name: "Choose local folder" }),
  ).toBeVisible();

  // Seed on the app's own origin: OPFS exists only under a secure origin, and
  // `about:blank` has none.
  await seedBook(page);

  // Map the folder: the stub returns the OPFS root holding the books directly.
  await page.getByRole("button", { name: "Choose local folder" }).click();
  // The folder holds a book, so the welcome, when it is the face drawn,
  // names what it found and the library is one press past it.
  await pastTheWelcome(page, page.locator("article.project"));

  // The scan surfaces the seeded book; a slash-path probe skips every folder.
  await expect(page.getByText("The Lantern Keeper")).toBeVisible({
    timeout: 15_000,
  });

  // The handle survives a reload in IndexedDB and OPFS permission is granted,
  // so the card cache survives too: the shelf is the cache's truth.
  await page.reload();
  await expect(page.getByText("The Lantern Keeper")).toBeVisible({
    timeout: 15_000,
  });
});

test("a project created while a root is mapped appears on the shelf immediately", async ({
  page,
}) => {
  // Creation is the multi-step wizard, walked to What is it called.
  await boot(page);

  await page.goto("/app");
  await expect(
    page.getByRole("button", { name: "Choose local folder" }),
  ).toBeVisible();

  // Empty the e2e root on the app's own origin, then map the folder.
  await page.evaluate(async (root) => {
    const base = await navigator.storage.getDirectory();
    await base.removeEntry(root, { recursive: true }).catch(() => {});
    await base.getDirectoryHandle(root, { create: true });
  }, ROOT);
  await page.getByRole("button", { name: "Choose local folder" }).click();

  // The mapped root is empty, so the shelf shows the welcome, whose New
  // project unlocks in place once the folder is mapped.
  const start = page.getByRole("button", { name: "New project" });
  await expect(start).not.toHaveAttribute("aria-disabled", "true");
  await start.click();
  // Every wizard question takes its default: How do you start
  // (Blank), Where should it live (local, with a mapped root), the shape, the
  // kind and the genre. The walk stops at the question it ends on rather than
  // counting steps, so a new question does not break it.
  const name = page.getByRole("textbox", { name: "What is it called?" });
  while (!(await name.isVisible()))
    await page.getByRole("button", { name: "Continue" }).click();
  await name.fill("The Ember Coast");
  await page.getByText("Create the folder").click();

  // Creation opens the editor, and the spec waits for it. A reload while the
  // scaffold is writing truncates the structure file mid-write
  // (`createWritable` truncates on open), and the half-written book is dropped
  // as not a project. A writer cannot navigate before the editor exists.
  await page.waitForURL("**/app/project/**", { timeout: 15_000 });

  // The address is the book's, not the folder's. This row watches a project's
  // URL come into existence, so it pins the shape: one segment, a uuid. A
  // provider and folder name in the path would put the storage backend in
  // the writer's address bar.
  expect(new URL(page.url()).pathname).toMatch(
    /^\/app\/project\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

  // The navigation to the project URL is the scaffold-complete gate: the
  // create flow routes there only after the last write lands, so no
  // fixed wait precedes the return to the shelf, and the card assertion polls
  // its own 15s window. The card carries the title the writer typed, not the
  // folder's name. The library now holds a book, so the welcome may be the
  // face drawn first, as on any return with books found.
  await page.goto("/app");
  await pastTheWelcome(
    page,
    page.getByRole("heading", { name: "The Ember Coast" }),
  );
});

test("a removed local project stays gone across reloads until the explicit sweep", async ({
  page,
}) => {
  await boot(page);

  await page.goto("/app");
  await expect(
    page.getByRole("button", { name: "Choose local folder" }),
  ).toBeVisible();
  await seedBook(page);
  await page.getByRole("button", { name: "Choose local folder" }).click();
  // The folder holds a book, so the welcome, when it is the face drawn,
  // names what it found and the library is one press past it.
  await pastTheWelcome(page, page.locator("article.project"));
  await expect(page.getByText("The Lantern Keeper")).toBeVisible({
    timeout: 15_000,
  });

  // Remove from the library: the card menu, the forget action.
  await page
    .getByRole("button", { name: "Actions for The Lantern Keeper" })
    .click();
  await page.getByText("Remove from library").click();

  // The cache is the source of truth: the book stays on disk, and a plain
  // reload does not resurrect it, as with Drive.
  await page.reload();
  await expect(page.getByText("The Lantern Keeper")).not.toBeVisible();

  // With no cards the shelf bar is absent, and the palette carries the same
  // "Find projects on your device" sweep. The explicit sweep brings the book
  // back.
  await page.getByRole("button", { name: "Search everything" }).click();
  await page.getByText("Find projects on your device").click();
  // The sweep reports what it added before the shelf is reachable.
  const found = page.getByRole("dialog", { name: "Projects found" });
  await expect(found).toContainText("The Lantern Keeper", { timeout: 15_000 });
  await found.getByRole("button", { name: "Done" }).click();
  // With no cards the welcome can reopen, naming what the sweep found.
  await pastTheWelcome(page, page.locator("article.project"));
  await expect(page.getByText("The Lantern Keeper")).toBeVisible({
    timeout: 15_000,
  });
});

/**
 * Seeds a shelf holding one readable book and resolves the URL it lives at.
 *
 * The address is the book's own `document.id`, not its provider and folder,
 * so it is read off the card's href the way a writer follows it. The rows
 * that use it test the deep link, not a string the spec built.
 */
async function shelfWithReadyBook(page: Page): Promise<string> {
  await page.goto("/app");
  await expect(
    page.getByRole("button", { name: "Choose local folder" }),
  ).toBeVisible();
  await page.evaluate(
    async ({ root, properties, catalogue, structure }) => {
      const base = await navigator.storage.getDirectory();
      await base.removeEntry(root, { recursive: true }).catch(() => {});
      const top = await base.getDirectoryHandle(root, { create: true });
      const book = await top.getDirectoryHandle("the-lantern-keeper", {
        create: true,
      });
      const write = async (name: string, content: string) => {
        const handle = await book.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      };
      await write("document-properties.json", properties);
      await write("snapshots-catalogue.json", catalogue);
      await write("document-structure.yaml", structure);
      const part = await book.getDirectoryHandle("document", { create: true });
      for (const [name, text] of [
        ["part--act_one.EL1.00.md", "# Act One\n"],
        [
          "section--opening.EL2.00.md",
          "The house had been empty for a year.\n",
        ],
      ] as const) {
        const handle = await part.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
      }
    },
    {
      root: ROOT,
      properties: BOOK_PROPERTIES,
      catalogue: BOOK_CATALOGUE,
      structure: BOOK_STRUCTURE,
    },
  );
  await page.getByRole("button", { name: "Choose local folder" }).click();
  // The folder holds a book, so the welcome, when it is the face drawn,
  // names what it found and the library is one press past it.
  await pastTheWelcome(page, page.locator("article.project"));
  await expect(page.getByText("The Lantern Keeper")).toBeVisible({
    timeout: 15_000,
  });
  // Ready, not merely painted: every pooled read probes `canAccess` first, so
  // a grant flip that lands during the map-flow gather settles the card as
  // remembered, with no link to click. The link must exist before the grant
  // lapses.
  const link = page.getByRole("link", { name: "The Lantern Keeper" });
  await expect(link).toBeVisible({
    timeout: 15_000,
  });
  const href = await link.getAttribute("href");
  if (!href) throw new Error("the shelf card has no address");
  // One segment after `/app/project/`, and a uuid: the storage backend never
  // appears in the writer's address bar. The create row pins the same shape
  // at the moment a URL comes into existence.
  expect(href).toMatch(
    /^\/app\/project\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  return href;
}

test("a lapsed grant holds at the affordance with zero permission requests, and Choose folder is the picker", async ({
  page,
}) => {
  // The pick reopens the project.
  await boot(page);
  await stubPermissions(page);

  const projectUrl = await shelfWithReadyBook(page);

  // A grant lapses between sessions; here it lapses now. The entry is the
  // project URL itself, as a deep link or a reload on the editor route would
  // be: a shelf card settles to blocked when a background read lands after
  // the flip, and a blocked card is not clickable. This row pins the editor's
  // own custody, which the URL reaches directly.
  await lapseGrant(page, "prompt");
  await page.goto(projectUrl);

  // The affordance, not a prompt: the mount asks what is true (`canAccess`)
  // and never fires `requestPermission`, because an unbidden prompt trains
  // browsers into silently denying the site. Nothing requests at all: the
  // picker is the whole re-grant, so the counter stays at zero even after the
  // pick.
  await expect(page.getByText(en.tree.reconnectHint)).toBeVisible({
    timeout: 15_000,
  });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __phosphearePerm: { requested: number } })
          .__phosphearePerm.requested,
    ),
  ).toBe(0);

  // Choose folder is the picker: the stub returns the OPFS root, a fresh
  // handle that is always granted. The affordance clears, the project opens,
  // and the request count stays at zero.
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByText(en.tree.reconnectHint)).toBeHidden({
    timeout: 20_000,
  });
  // The prose exists once a Section is open, reached through the structure
  // panel. The Desk's entry animation re-triggers while the open pipeline's
  // stats backfill lands, so the Desk's button never settles.
  await expect(
    page.getByRole("button", { name: "Opening", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Opening", exact: true }).click();
  // In the editor: the Desk quotes the same line and can still be on the
  // page as the Section opens.
  await expect(
    page.locator(".editor").getByText("The house had been empty for a year."),
  ).toBeVisible({ timeout: 15_000 });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __phosphearePerm: { requested: number } })
          .__phosphearePerm.requested,
    ),
  ).toBe(0);
});

test("even a browser-held denial unlocks via the picker — the click must always win the work back", async ({
  page,
}) => {
  // The pick reopens the project even from a browser-held denial.
  await boot(page);
  await stubPermissions(page);

  const projectUrl = await shelfWithReadyBook(page);

  // The sticky block: the writer blocked the site in the browser. The picker
  // ignores the stored handle's state, so the block is not a dead end.
  await lapseGrant(page, "denied");

  await page.goto(projectUrl);
  await expect(page.getByText(en.tree.reconnectHint)).toBeVisible({
    timeout: 15_000,
  });

  // One click on the picker recovers the work, with no trip to settings.
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(
    page.getByRole("button", { name: "Opening", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
});

test("a cached book with a lapsed grant wears the ember edge, not a link — and the banner's Choose folder recovers it", async ({
  page,
}) => {
  await boot(page);
  await stubPermissions(page);

  // Map the root: the sweep's read fills the card cache, so the book is ready
  // first, as for a writer who has opened it before.
  await shelfWithReadyBook(page);

  // The grant lapses; a reload re-gathers from the cache. The pooled read
  // cannot run, so the card settles to remembered: cached but blocked, and
  // unclickable, so it must carry a visible sign.
  await lapseGrant(page, "prompt");
  await page.reload();
  await expect(page.getByText("The Lantern Keeper")).toBeVisible({
    timeout: 15_000,
  });

  // The stale dim and the ember edge together, no title link, and the
  // shelf banner stating the fact once with Choose folder.
  const card = page.locator("article.project").filter({
    hasText: "The Lantern Keeper",
  });
  await expect(card).toHaveClass(/project-stale/);
  await expect(card).toHaveClass(/project-attention/);
  await expect(card.getByRole("link")).toHaveCount(0);
  // The blocked face is dimmed as well as edged, with the stale rule's 0.62
  // opacity on head, stats and spine.
  await expect(card.locator(".project-head")).toHaveCSS("opacity", "0.62");
  await expect(
    page.getByText(
      en.library.localPermissionBanner.replace("{{product}}", PRODUCT.name),
    ),
  ).toBeVisible();

  // The banner's "Choose folder" is the root-wide pick: one click fills the
  // whole shelf, and the card opens again.
  await page
    .locator(".ui-banner")
    .getByRole("button", { name: "Choose folder" })
    .click();
  await expect(
    card.getByRole("link", { name: "The Lantern Keeper" }),
  ).toBeVisible({
    timeout: 15_000,
  });
});

test("Show the folder opens at the book when granted, and at the root when the grant lapsed", async ({
  page,
}) => {
  await boot(page);
  await stubPermissions(page);

  await shelfWithReadyBook(page);

  const startIn = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __phosphearePicker: { lastStartIn: string | null };
          }
        ).__phosphearePicker.lastStartIn,
    );

  // Granted: the book handle resolves, so the dialog opens inside the book.
  await page
    .getByRole("button", { name: "Actions for The Lantern Keeper" })
    .click();
  await page.getByText(en.library.locateFolder).click();
  await expect.poll(startIn).toBe("the-lantern-keeper");

  // The grant lapses; after a reload the card is blocked. A lapsed grant
  // makes the book handle unobtainable (the model throws on walks, like a
  // real browser), so the reveal falls back to the root, which needs no
  // permission to serve as the dialog's position.
  await lapseGrant(page, "prompt");
  await page.reload();
  await expect(page.getByText("The Lantern Keeper")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator("article.project")).toHaveClass(
    /project-attention/,
  );
  await page
    .getByRole("button", { name: "Actions for The Lantern Keeper" })
    .click();
  await page.getByText(en.library.locateFolder).click();
  await expect.poll(startIn).toBe(ROOT);
});
