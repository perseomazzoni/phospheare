// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, type Page, type Route } from "@playwright/test";
import { WRITER_ID, signIn } from "./session";
import {
  BOOK_FOLDER,
  BOOK_ID,
  CLOCK_START,
  LIVE_QUERY,
  LIVE_QUESTION,
  MODEL_ID,
  SAVE_AT,
  bookFiles,
  noteTimes,
  type FirstLightText,
} from "./fixtures/vision/onceDark";

// ── Opening "Once Dark" as Vision's design shows it ──────────────────────────
//
// The route `signedInProject.ts` takes (an OPFS folder standing in for the
// native picker, the card's own link, the structure panel's row), for a local
// writer whose preferences and OpenRouter key are seeded before the first
// script runs.
//
// OpenRouter is answered at the network edge: the key's reading, the model
// catalogue and the chat stream. Every other call to openrouter.ai, to
// Wikipedia or to `/identity/` is answered here and recorded as unexpected, so
// nothing leaves the machine, and a spec can assert that nothing tried to.
//
// The specs that use this set `timezoneId: "UTC"` and `locale: "en-US"`: the
// fixture's stamps are UTC and the design's dates are en-US.

const ROOT = "phospheare-e2e-vision-root";
const OPENROUTER = "https://openrouter.ai/api/v1";

/** The writer: the title bar's avatar is their initial, "T". */
const WRITER_NAME = "Tess";

/** The key the vault holds; only the stubs below ever see it. */
const KEY = "sk-or-v1-e2e-vision";

/**
 * The key as OpenRouter describes it (`GET /api/v1/key`): a $5.00 monthly
 * limit with $1.80 spent, so $3.20 is left.
 */
const KEY_INFO = {
  data: {
    label: "",
    limit: 5,
    limit_remaining: 3.2,
    limit_reset: "monthly",
    include_byok_in_limit: true,
    usage: 1.8,
    usage_daily: 0,
    usage_weekly: 0.4,
    usage_monthly: 1.8,
    byok_usage: 0,
    byok_usage_daily: 0,
    byok_usage_weekly: 0,
    byok_usage_monthly: 0,
    is_free_tier: false,
    is_management_key: false,
    is_provisioning_key: false,
    expires_at: "2026-12-31T23:59:00.000Z",
  },
};

/**
 * The model's context window. The chat bar's context reading is the
 * request's token estimate over this figure, so the reading the design prints
 * (42%) holds only for this window and the request the app builds.
 */
export const CONTEXT_TOKENS = 200_000;

export interface VisionOptions {
  variant: "light" | "dark";
  /** Which of the design's pictures of "The First Light" to seed. */
  text: FirstLightText;
  /**
   * The theme family, Vision by default. Matte and Shine open the same book
   * for the check that Vision leaves them unchanged, Radiant for its own.
   */
  family?: "vision" | "matte" | "shine" | "radiant";
  /**
   * Stops on the Library with the book's card shown, before the editor has
   * opened it and stamped it as edited now.
   */
  stayInLibrary?: boolean;
  /**
   * More files for the book's folder, by path inside it, written over the
   * fixture's own where a path is the same.
   */
  extra?: Record<string, string>;
}

export interface VisionStubs {
  /**
   * Calls to openrouter.ai, Wikipedia or `/identity/` that no stub answers, as
   * method and URL without its query: the spec asserts none.
   */
  unexpected: string[];
  /** Bodies the chat route received. */
  chats: unknown[];
  /** Calls to a search: none, since the ask is never pressed. */
  searches: string[];
}

/** An SSE body of `frames`, one `data:` line each, ended by `[DONE]`. */
function sse(...frames: unknown[]): string {
  const lines = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`);
  return `${lines.join("")}data: [DONE]\n\n`;
}

/**
 * Seeds the writer's portable preferences (`profile.<writerId>`), only when
 * absent, and a remembered OpenRouter key: the choice to remember it, and the
 * identity service's answer when the app opens the sealed key
 * (`identityVault.ts`).
 */
async function seedWriter(page: Page, opts: VisionOptions): Promise<void> {
  await page.route("**/identity/credentials/openrouter.key/open", (route) =>
    route.fulfill({ json: { value: KEY } }),
  );
  const at = "2026-10-01T00:00:00.000Z";
  const prefs = {
    theme: {
      value: `${opts.family ?? "vision"}-${opts.variant}`,
      updatedAt: at,
    },
    language: { value: "en", updatedAt: at },
  };
  await page.addInitScript(
    ({ id, prefs }) => {
      const seed = (name: string, value: unknown) => {
        if (localStorage.getItem(name) !== null) return;
        localStorage.setItem(
          name,
          typeof value === "string" ? value : JSON.stringify(value),
        );
      };
      seed(`profile.${id}`, {
        doc: { v: 1, installation: "e2e-vision", prefs, library: {} },
        fileId: null,
        syncedAt: null,
      });
      seed(`openrouter.remember.${id}`, "1");
    },
    { id: WRITER_ID, prefs },
  );
}

/** Answers OpenRouter, and records every other call that would leave. */
async function stubOutside(page: Page): Promise<VisionStubs> {
  const stubs: VisionStubs = { unexpected: [], chats: [], searches: [] };

  // No model on the writer's machine: the app looks for a local Ollama, and
  // the design shows OpenRouter alone, so the probe finds nothing there.
  await page.route("http://localhost:11434/**", (route) =>
    route.abort("connectionrefused"),
  );

  // Registered first, so every route below, and `signIn`'s
  // `/identity/session`, wins over it. Any origin for `/identity/`, so the same stubs serve the
  // regression lane's second server.
  await page.route(
    (url) =>
      url.hostname === "openrouter.ai" ||
      url.hostname.endsWith(".wikipedia.org") ||
      url.pathname.startsWith("/identity/"),
    (route) => {
      const url = new URL(route.request().url());
      stubs.unexpected.push(
        `${route.request().method()} ${url.origin}${url.pathname}`,
      );
      return route.fulfill({ status: 404, json: {} });
    },
  );

  await page.route(`${OPENROUTER}/key`, (route) =>
    route.fulfill({ json: KEY_INFO }),
  );

  await page.route(`${OPENROUTER}/models`, (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: MODEL_ID,
            name: MODEL_ID,
            context_length: CONTEXT_TOKENS,
            architecture: { output_modalities: ["text"] },
            supported_parameters: [
              "tools",
              "structured_outputs",
              "temperature",
            ],
            top_provider: { max_completion_tokens: 8192 },
          },
        ],
      },
    }),
  );

  // The model reads the open Section, then proposes one search and stops, so
  // the ask waits on the writer inside the live answer, where the design
  // draws it: under the steps so far, and flagged, since the query repeats
  // the Section's title from the text the run read.
  //
  // A provider search is a chat completion too, sent without `stream`; it is
  // recorded and refused, since the fixture has no results.
  await page.route(`${OPENROUTER}/chat/completions`, (route: Route) => {
    const body = route.request().postDataJSON() as { stream?: boolean };
    if (body.stream !== true) {
      stubs.searches.push(route.request().url());
      return route.fulfill({ status: 503, json: {} });
    }
    stubs.chats.push(body);
    const call =
      stubs.chats.length === 1
        ? {
            id: "live-read",
            name: "read_source",
            arguments: { sourceId: "node:EL6" },
          }
        : {
            id: "live-search",
            name: "web_search",
            arguments: { query: LIVE_QUERY },
          };
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse(
        {
          id: "gen-e2e",
          model: MODEL_ID,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    index: 0,
                    id: call.id,
                    type: "function",
                    function: {
                      name: call.name,
                      arguments: JSON.stringify(call.arguments),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
        {
          id: "gen-e2e",
          model: MODEL_ID,
          choices: [],
          usage: { prompt_tokens: 2100, completion_tokens: 40 },
        },
      ),
    });
  });

  // Wikipedia's search, the keyless floor: recorded and refused.
  await page.route(
    (url) =>
      url.hostname.endsWith(".wikipedia.org") &&
      url.pathname === "/w/rest.php/v1/search/page",
    (route) => {
      stubs.searches.push(route.request().url());
      return route.fulfill({ status: 503, json: {} });
    },
  );

  return stubs;
}

/**
 * A note's modified time is the file's, which a seed written now cannot set
 * (OPFS has no way to). The one shim in the fixture: `File.lastModified`
 * answers the design's time for the three note files, and the browser's own for
 * every other file.
 */
async function pinNoteTimes(page: Page): Promise<void> {
  await page.addInitScript((times: Record<string, number>) => {
    const own = Object.getOwnPropertyDescriptor(
      File.prototype,
      "lastModified",
    )!;
    Object.defineProperty(File.prototype, "lastModified", {
      configurable: true,
      get(this: File) {
        return times[this.name] ?? (own.get!.call(this) as number);
      },
    });
  }, noteTimes());
}

/**
 * Signs in as the seeded writer, seeds the book, and opens it on the Desk.
 * Ends with the editor shell up and no Section open.
 */
export async function openVisionProject(
  page: Page,
  opts: VisionOptions,
): Promise<VisionStubs> {
  await page.clock.install({ time: new Date(CLOCK_START) });
  const stubs = await stubOutside(page);
  await pinNoteTimes(page);
  await signIn(page, WRITER_NAME);
  await seedWriter(page, opts);
  await page.addInitScript((root: string) => {
    window.showDirectoryPicker = async () => {
      const base = await navigator.storage.getDirectory();
      return base.getDirectoryHandle(root, { create: true });
    };
  }, ROOT);

  await page.goto("/app");
  const choose = page.getByRole("button", { name: "Choose local folder" });
  await expect(choose).toBeVisible({ timeout: 15_000 });
  await page.evaluate(
    async ({ root, folder, files }) => {
      const base = await navigator.storage.getDirectory();
      await base.removeEntry(root, { recursive: true }).catch(() => {});
      const top = await base.getDirectoryHandle(root, { create: true });
      const book = await top.getDirectoryHandle(folder, { create: true });
      for (const [path, content] of Object.entries(files)) {
        const parts = path.split("/");
        let dir = book;
        for (const name of parts.slice(0, -1))
          dir = await dir.getDirectoryHandle(name, { create: true });
        const handle = await dir.getFileHandle(parts.at(-1)!, { create: true });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      }
    },
    {
      root: ROOT,
      folder: BOOK_FOLDER,
      files: { ...bookFiles(opts.text), ...opts.extra },
    },
  );
  await choose.click();
  // The folder holds a book, so the welcome names what it found and the
  // library is one press past it.
  // A phone can reach the shelf first, so the press is made only if the
  // welcome is the one drawn.
  const show = page.getByRole("button", { name: "Show my projects" });
  const link = page.getByRole("link", { name: "Once Dark" });
  await expect(show.or(link).first()).toBeVisible({ timeout: 15_000 });
  if (await show.isVisible()) await show.click();

  await expect(link).toBeVisible({ timeout: 15_000 });
  if (opts.stayInLibrary) return stubs;
  await link.click();
  await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(BOOK_ID));
  return stubs;
}

/**
 * Opens "The First Light" from the structure panel, puts the caret where the
 * design draws it (after "A dog hopes to return home."), and saves at 14:32, so
 * the bar reads "Saved · 14:32". The save is a real one: a letter typed and
 * taken back, then the bar's save, so the text on disk is unchanged.
 *
 * `save: false` leaves the bar at its bare "Saved". The design prints both a
 * save at 14:32 and the adopted snapshot's last edit on 10 October, which no
 * one session can show: a save restamps the adopted snapshot.
 */
export async function openFirstLight(
  page: Page,
  { save = true }: { save?: boolean } = {},
): Promise<void> {
  await page
    .getByRole("button", { name: "The First Light", exact: true })
    .click();
  const editor = page.locator(".editor");
  await expect(
    editor.getByText("Small acts, yes.", { exact: false }),
  ).toBeVisible({ timeout: 15_000 });

  const spot = await page.evaluate(() => {
    const root = document.querySelector(".editor")!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const needle = "return home.";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      const at = t.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(t, at + needle.length - 1);
      range.setEnd(t, at + needle.length);
      const r = range.getBoundingClientRect();
      return { x: r.right, y: r.top + r.height / 2 };
    }
    return null;
  });
  if (!spot)
    throw new Error("openFirstLight: the caret's place is not on the page");
  await page.mouse.click(spot.x + 0.5, spot.y);
  if (!save) return;

  await page.clock.setSystemTime(new Date(SAVE_AT));
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await page.locator(".ed-save").click();
  // The minute, in whichever clock the locale reads it: the label's format is
  // a look, not content.
  await expect(page.locator(".ed-save-label")).toHaveText(
    /Saved · .*(14:32|02:32\sPM)/,
  );
}

/**
 * Opens the Assistant on the seeded chat and asks the live question; the
 * stubbed model proposes a search, which waits on the writer.
 */
export async function askForSearch(page: Page): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Enlighten!" });
  await composer.fill(LIVE_QUESTION);
  await composer.press("Enter");
  await expect(page.locator(".ai-ask")).toBeVisible({ timeout: 15_000 });
}

export type DockFace = "ask" | "reference" | "notes" | "snapshot";

const FACE_LABEL: Record<DockFace, string> = {
  ask: "Enlighten!",
  reference: "Reference",
  notes: "Notes",
  snapshot: "Snapshot",
};

/**
 * What each face shows open in the design, in the order a writer opens it: the
 * shelves the design draws unfolded (by their head, named with its count), then
 * the row whose text the reader shows.
 */
const FACE_OPENS: Partial<
  Record<DockFace, { shelves?: RegExp[]; row: string }>
> = {
  reference: { shelves: [/^Guidebook \d/, /^Characters \d/], row: "Animals" },
  notes: { row: "The river bridge" },
  snapshot: { row: "The morning it clicked" },
};

/**
 * Opens the Dock on `face` the way a writer does: the bar's button when the
 * Dock is shut (the Assistant's spark, or Snapshots), the panel's buttons for
 * Reference and Notes, then the tab; then the row the design shows open.
 */
export async function openDockFace(page: Page, face: DockFace): Promise<void> {
  const dock = page.locator(".ed-dock");
  if ((await dock.getAttribute("data-open")) !== "1") {
    if (face === "ask")
      await page
        .locator(".bar-stack")
        .getByRole("button", { name: "Enlighten!" })
        .click();
    else if (face === "snapshot")
      await page
        .locator(".bar-stack")
        .getByRole("button", { name: "Snapshots" })
        .click();
    else
      await page
        .locator(".doc-tree")
        .getByRole("button", { name: FACE_LABEL[face], exact: true })
        .click();
    await expect(dock).toHaveAttribute("data-open", "1");
  }
  // The tab only when the button opened another face: the Assistant's tab
  // carries a working mark while a chat loads, and is never still to click.
  // Vision names the Assistant's tab; the other themes call it "Enlighten!".
  const tab = page.locator(".dock-head").getByRole("button", {
    name: face === "ask" ? /^(Enlighten!|Assistant)$/ : FACE_LABEL[face],
    exact: face !== "ask",
  });
  if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
  const opens = FACE_OPENS[face];
  if (!opens) return;
  for (const shelf of opens.shelves ?? []) {
    const head = dock.getByRole("button", { name: shelf });
    if ((await head.getAttribute("aria-expanded")) !== "true")
      await head.click();
  }
  await dock.getByText(opens.row, { exact: true }).first().click();
}
