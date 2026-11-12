// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The Vision fixture holds the design's numbers ────────────────────────────
//
// Vision's look is compared with its reference design state by state, and a
// difference in what the book holds would read as a difference in how it is
// drawn. These rows pin the book first: every count, date, name and line the
// design prints, read off the app whatever theme draws it. They assert
// content, never a look.

import { expect, test, type Page, type Request } from "@playwright/test";
import { settleAnimations } from "./probe";
import {
  askForSearch,
  openDockFace,
  openFirstLight,
  openVisionProject,
  type VisionStubs,
} from "./visionProject";
import { LIVE_QUERY, MARKER, P3 } from "./fixtures/vision/onceDark";

test.use({
  timezoneId: "UTC",
  locale: "en-US",
  viewport: { width: 1198, height: 723 },
});

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "the local folder needs the File System Access API",
);

let stubs: VisionStubs;

/** Calls to the hosts the stubs answer, from the request to its answer. */
const inFlight = new Set<Request>();

test.beforeEach(({ page }) => {
  inFlight.clear();
  const watched = (request: Request) => {
    const url = new URL(request.url());
    return (
      url.hostname === "openrouter.ai" ||
      url.hostname.endsWith(".wikipedia.org") ||
      url.pathname.startsWith("/identity/")
    );
  };
  page.on("request", (request) => {
    if (watched(request)) inFlight.add(request);
  });
  const done = (request: Request) => inFlight.delete(request);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
});

async function noStrayCalls(page: Page) {
  // Read once the page is at rest and every call it has made has been
  // answered, so a late call is already in the list.
  await settleAnimations(page);
  await expect.poll(() => inFlight.size).toBe(0);
  expect(stubs.unexpected).toEqual([]);
  expect(stubs.searches).toEqual([]);
}

test("the Desk: where the writer left off, the ledger and the thread", async ({
  page,
}) => {
  stubs = await openVisionProject(page, { variant: "light", text: "desk" });
  const desk = page.locator(".desk");
  await expect(desk).toBeVisible({ timeout: 20_000 });
  await expect(desk.locator(".desk-eyebrow").first()).toContainText(
    "Ki — Void",
  );
  await expect(desk.locator(".desk-eyebrow").first()).toContainText(
    "The First Light",
  );
  await expect(desk.locator(".desk-last-line")).toContainText(P3);
  const ledger = desk.locator(".desk-ledger");
  await expect(ledger).toContainText("since Tuesday");
  await expect(ledger).toContainText("+152");
  await expect(ledger).toContainText("6 sections");
  await expect(ledger).toContainText("Tue 21:14");
  // The figure, however it is grouped: grouping is a look, not content.
  await expect(ledger).toContainText(/1,?826 total/);
  const thread = desk.locator(".desk-thread");
  await expect(thread).toContainText("The First Light");
  await expect(thread).toContainText(MARKER);
  await noStrayCalls(page);
});

test("Contents: the Parts, the Sections and their counts", async ({ page }) => {
  stubs = await openVisionProject(page, { variant: "light", text: "section" });
  const tree = page.locator(".doc-tree");
  for (const name of [
    "Ki — Void",
    "The Dark",
    "The First Light",
    "Shō — The Spark",
    "Ten — The Flame",
    "The Memory of Water",
    "The Flame",
    "Ketsu — Earthlings",
  ])
    await expect(tree.getByText(name, { exact: true }).first()).toBeVisible();
  // Collapsed as the design draws it: Shō's Sections are not on screen.
  await expect(
    tree.getByText("All Living Beings", { exact: true }),
  ).toBeHidden();
  // The counts are read from the rows' text, wherever the theme shows them.
  // A row counts its own file's words, so a Part row here says nothing about
  // its Sections; the Parts' totals are pinned on the Desk's spine instead.
  const text = await tree.innerText();
  for (const n of ["412", "221", "198", "203", "280"])
    expect(text).toContain(n);
  await expect(
    page.getByRole("img", { name: /Once Dark/ }).first(),
  ).toBeVisible();
  const spine = await page.locator(".desk").innerText();
  for (const n of ["633", "512", "401", "280"]) expect(spine).toContain(n);
  await noStrayCalls(page);
});

test("the open Section: the text, the save at 14:32 and the two comments", async ({
  page,
}) => {
  stubs = await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  const editor = page.locator(".editor");
  await expect(editor).toContainText("This awareness spread slowly");
  await expect(editor).toContainText("waiting for enough eyes to see it.");
  await expect(editor).not.toContainText("???");
  // The shell: the frame's default panel, which the writer never dragged,
  // and the frame's middle prose step, which the writer never changed.
  const [panel, prose] = await page.evaluate(() =>
    ["--panel-w", "--prose-size"].map((name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    ),
  );
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "style",
    new RegExp(`--panel-w: ${panel}`),
  );
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "style",
    new RegExp(`--prose-size: ${prose}`),
  );
  // The comments stand in the margin as notes, Mara's first.
  const notes = page.locator(
    '.cm-layer[data-mode="notes"] .cm-slot:not([data-slot="chapter"])',
  );
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(0)).toContainText("Mara");
  await expect(notes.nth(0)).toContainText(
    "This is the turn of the whole Part. Slow it down?",
  );
  await expect(notes.nth(1)).toContainText(
    "Check the elephant line against the notes.",
  );
  await noStrayCalls(page);
});

test("the Dock's Reference, Notes and Snapshot faces", async ({ page }) => {
  stubs = await openVisionProject(page, { variant: "light", text: "section" });
  // No save: it would restamp the adopted snapshot with today's date.
  await openFirstLight(page, { save: false });
  const dock = page.locator(".ed-dock");

  await openDockFace(page, "reference");
  for (const label of [
    "Guidebook",
    "Worldbuilding",
    "Characters",
    "Summaries",
    "Logline",
    "Animals",
    "Humans",
    "Other Sentient Beings",
    "Visitors",
  ])
    await expect(dock.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(dock).toContainText(
    "the dog, home; the elephant, its dead; the whale, its young.",
  );
  await expect(dock.locator(".ref-row-ai.barred")).toHaveCount(1);

  await openDockFace(page, "notes");
  for (const title of [
    "Visitors arrive late",
    "The river bridge",
    "Names of the animals",
  ])
    await expect(dock.getByText(title, { exact: true }).first()).toBeVisible();
  await expect(dock).toContainText("The water carries the memory");

  await openDockFace(page, "snapshot");
  const table = dock.locator(".snap-table");
  for (const row of [
    "The morning it clicked",
    "Before the turn",
    "First pass",
    "Opening lines",
  ])
    await expect(table).toContainText(row);
  for (const rel of ["1 ahead", "1 back", "2 back"])
    await expect(table).toContainText(rel);
  for (const when of [
    "10/11/26, 9:18 AM",
    "10/10/26, 6:40 PM",
    "10/9/26, 6:02 PM",
    "10/8/26, 7:55 AM",
  ])
    await expect(table).toContainText(when);
  await expect(dock.locator(".snap-preview")).toContainText(
    "A child, who had never been asked",
  );
  await noStrayCalls(page);
});

test("the Assistant: Nova's chat, the plan, the facts and a search waiting", async ({
  page,
}) => {
  stubs = await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  await openDockFace(page, "ask");
  const dock = page.locator(".ed-dock");
  await expect(dock.locator(".ai-chathead")).toContainText("Nova");
  await expect(dock).toContainText("The turn in “The First Light”");
  await expect(dock).toContainText(
    "Does the second paragraph earn the turn, or am I rushing it?",
  );
  await expect(dock).toContainText("It earns it, but it arrives too fast.");
  await expect(dock).toContainText("Slow the turn in “The First Light”");
  // The figures and the age, however they are spelled: that is a look.
  await expect(dock).toContainText(/2,?140 tokens/);
  await expect(dock).toContainText(/1,?820 in \/ 320 out/);
  await expect(dock).toContainText(/2 min(utes)? ago/);
  await expect(dock.locator(".ai-chatbar")).toContainText("$3.20 left");
  await expect(dock.locator(".ai-chatbar")).toContainText(
    "anthropic/claude-sonnet-5.5",
  );

  await askForSearch(page);
  await expect(
    page.locator(".ai-ask textarea, .ai-ask input").first(),
  ).toHaveValue(LIVE_QUERY);
  expect(stubs.chats.length).toBeGreaterThan(0);
  await noStrayCalls(page);
});
