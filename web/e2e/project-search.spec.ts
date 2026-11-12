// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The panel's project search reads the prose, the reference documents and the
// conversations, and a hit is a place rather than a file. The feature is a
// chain of asynchronous reads through the storage port feeding a regex scan
// feeding a render, each link mocked away in a component test, so this pins
// that the chain runs, in order, against a real book.
//
// Conversations are not covered here: the demo book has none, and adding one
// would change a fixture visitors see. `project/search.test.ts` and
// `editor/components/GlobalSearch.test.tsx` pin the chat path.

import { expect, test, type Page } from "@playwright/test";
import { settleTransitions } from "./probe";
import { START_MS } from "./start";

/** The panel's find field, morphed open and ready for a query. */
async function search(page: Page, query: string) {
  const field = page.getByPlaceholder("Find a name or a phrase…");
  await field.click();
  await field.fill(query);
  return field;
}

/** The two bodies against the box they share, and the head's line. */
function faces(page: Page) {
  return page.evaluate(() => {
    const body = (sel: string) => {
      const el = document.querySelector(sel)!;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        x: r.x,
        width: r.width,
        visibility: s.visibility,
        inFlow: s.display !== "none" && r.width > 0,
      };
    };
    const box = document.querySelector(".dt-bodies")!.getBoundingClientRect();
    const root = document.querySelector(".dt-root")!;
    return {
      box: { x: box.x },
      tree: body(".dt-tree-body"),
      results: body(".dt-search"),
      row: {
        x: document.querySelector(".dt-find-row")!.getBoundingClientRect().x,
      },
      lineStart:
        root.getBoundingClientRect().x +
        parseFloat(getComputedStyle(root).paddingLeft),
      shapeOpacity: getComputedStyle(document.querySelector(".dt-ident")!)
        .opacity,
    };
  });
}

async function openBook(page: Page) {
  await page.goto("/app/editor/demo");
  await expect(page.locator(".doc-tree")).toBeVisible({ timeout: START_MS });
}

test("a phrase in the prose is found, quoted, and marked", async ({ page }) => {
  await openBook(page);
  await search(page, "school");

  // Its own heading, under the structure's: a name hit and a prose hit are two
  // different answers to "where is this", and the panel says which.
  const group = page
    .locator(".dt-search-group")
    .filter({ has: page.getByRole("heading", { name: "In the text" }) });
  await expect(group).toBeVisible();

  // The group quotes the writer's own lines and marks the words inside them,
  // one line per occurrence, under the Part or Section that holds them.
  // A prose hit that does not show the prose adds nothing to the
  // tree.
  const first = group.locator(".dt-search-occurrence").first();
  await expect(first).toBeVisible();
  // The search folds case, since the writer is recalling, not transcribing,
  // and the row marks the text found in its own capitalisation, never the
  // query.
  await expect(first.locator(".dt-search-excerpt mark")).toHaveText(
    /^school$/i,
  );
});

test("a hit in the prose lands on the words, not just the file", async ({
  page,
}) => {
  await openBook(page);
  await search(page, "school");

  // From the body-text group: a reference document's row quotes its contents
  // too, and opens the dock rather than the prose.
  const source = page
    .locator(".dt-search-group")
    .filter({ has: page.getByRole("heading", { name: "In the text" }) })
    .locator(".dt-search-source")
    .last();
  const quote = source.locator(".dt-search-occurrence").first();
  const quoted = await quote.textContent();
  await quote.click();

  // The surface finds the words again for itself: the query travels, never an
  // offset, because the panel counts characters in raw markdown and the
  // engine in a parsed document.
  const current = page.locator("mark.hl-search-current");
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("school");
  await expect(current).toBeInViewport();

  // The mark is on the line the writer clicked, not on the heading over it: a
  // body group is many rows.
  const marked = page.locator(".dt-search-row.active");
  await expect(marked).toHaveCount(1);
  await expect(marked).toHaveClass(/dt-search-occurrence/);
  await expect(marked).toHaveText(quoted ?? "");
});

test("marks nothing at all before the writer has opened anything", async ({
  page,
}) => {
  // A reference document is about no node, and nothing is open yet; the two
  // absences must not compare equal and mark every reference row as the open
  // one.
  await openBook(page);
  await search(page, "school");
  await expect(page.locator(".dt-search-row.active")).toHaveCount(0);
});

test("a reference document is found by what is in it, not only by its name", async ({
  page,
}) => {
  await openBook(page);
  await search(page, "sentient");

  // `other-sentient-beings` answers by name and gets no excerpt, since the
  // title already explains the match.
  const byName = page
    .locator(".dt-search-row")
    .filter({ hasText: "other-sentient-beings" });
  await expect(byName).toHaveCount(1);
  await expect(byName.locator(".dt-search-excerpt")).toHaveCount(0);

  // The guidebook's logline answers by its contents, and quotes them. The
  // compiled spaces draw only catalogue sections, and the demo
  // fixture follows that rule.
  const byText = page
    .locator(".dt-search-row")
    .filter({ hasText: "logline" })
    .first();
  await expect(byText.locator(".dt-search-excerpt mark")).toHaveText(
    "sentient",
  );
});

test("the index costs nothing until the writer asks for it", async ({
  page,
}) => {
  // The index is lazy because on a cold remote, reading every file in a book
  // before anyone types is a burst against a rate limit. The demo's provider
  // is in memory, so this pins the observable half: no result until a query
  // exists, and results once one does.
  await openBook(page);
  await expect(page.locator(".dt-search-row")).toHaveCount(0);
  await expect(page.locator(".dt-tree-body")).toBeVisible();

  const field = await search(page, "school");
  await expect(page.locator(".dt-search-occurrence").first()).toBeVisible();

  // Clearing empties the list but keeps the face: the face is raised by the
  // find being open, not by a query, so an empty open find shows the
  // invitation, and leaving the field hands the tree back.
  await field.fill("");
  await expect(page.locator(".dt-search-row")).toHaveCount(0);
  await expect(page.locator(".dt-search-invite")).toBeVisible();
  await expect(page.locator(".dt-tree-body")).toBeHidden();

  await field.blur();
  await expect(page.locator(".dt-tree-body")).toBeVisible();
});

test("the face comes up empty, and the shape gives up the line", async ({
  page,
}) => {
  // Opening is its own state: clicking the field raises the results face on
  // an invitation and starts the sweep, so the book is usually read by the
  // first keystroke.
  //
  // The find shares the head's line, so the head keeps its height and the
  // spine gives up its width to the field. The spine is measured, since the
  // head's height alone passes on a panel where nothing moved.
  await openBook(page);
  const head = page.locator(".dt-head");
  const shape = page.locator(".dt-ident");
  await expect(head).toHaveAttribute("data-finding", "0");

  const field = page.getByPlaceholder("Find a name or a phrase…");
  // 40: 8px of padding either side of the 24px box the panel's trailing
  // column agrees on. The assertion is that the head is drawn.
  const line = (await head.boundingBox())?.height ?? 0;
  expect(line).toBeGreaterThan(30);
  expect((await shape.boundingBox())?.width ?? 0).toBeGreaterThan(100);

  // At rest the results wait off the right, still laid out.
  await settleTransitions(page);
  const rest = await faces(page);
  expect(rest.tree).toMatchObject({ x: rest.box.x, visibility: "visible" });
  expect(rest.results.x).toBeGreaterThanOrEqual(rest.tree.x + rest.tree.width);
  expect(rest.results).toMatchObject({ visibility: "hidden", inFlow: true });

  await field.click();
  await expect(page.locator(".dt-search-invite")).toBeVisible();
  await expect(page.locator(".dt-search-row")).toHaveCount(0);
  await expect(page.locator(".dt-tree-body")).toBeHidden();
  await expect(head).toHaveAttribute("data-finding", "1");
  await expect
    .poll(async () => (await shape.boundingBox())?.width ?? 0)
    .toBeLessThan(12);
  // The line itself does not move, so the results begin where the tree did.
  expect((await head.boundingBox())?.height ?? 0).toBeCloseTo(line, 0);

  // The two bodies slide past each other in one box, so neither leaves the
  // flow: the tree goes out to the left, laid out but hidden, and the results
  // stand where it stood.
  await settleTransitions(page);
  const finding = await faces(page);
  expect(finding.tree.x + finding.tree.width).toBeLessThanOrEqual(
    finding.box.x,
  );
  expect(finding.tree).toMatchObject({ visibility: "hidden", inFlow: true });
  expect(finding.results).toMatchObject({
    x: finding.box.x,
    visibility: "visible",
  });
  // The shape gives up the whole line, the air beside it included, so the
  // field opens from the head's own leading edge.
  expect(finding.shapeOpacity).toBe("0");
  expect(finding.row.x).toBeCloseTo(finding.lineStart, 0);

  // On the way out the field folds and the shape returns.
  await field.blur();
  await expect(head).toHaveAttribute("data-finding", "0");
  await expect(page.locator(".dt-tree-body")).toBeVisible();
  await expect
    .poll(async () => (await shape.boundingBox())?.width ?? 0)
    .toBeGreaterThan(100);
});

test("the resting find stands in the column of every row's menu, at its size", async ({
  page,
}) => {
  // Every control in the panel's trailing column, the row menus and the
  // region head's add among them, is one box on one centre line. The find's
  // glass is centred in its resting circle, so the circle shares both, or the
  // glass sits outboard of every ⋮ beneath it. The head's trailing inset and
  // the find's basis are built from one size, and a second copy of it lets
  // the two drift apart.
  await openBook(page);
  await settleTransitions(page);
  const [find, more] = await Promise.all(
    [".dt-find", ".dt-more"].map(async (selector) => {
      const b = (await page.locator(selector).first().boundingBox())!;
      return { width: b.width, centre: b.x + b.width / 2 };
    }),
  );
  expect(more.width).toBe(24);
  expect(find.width).toBe(more.width);
  expect(Math.abs(find.centre - more.centre)).toBeLessThanOrEqual(0.5);
});

test("the back control collapses the field, even from an empty one", async ({
  page,
}) => {
  // The box stays open through `:focus-within`, a stylesheet rule no
  // component test applies. The back control holds the caret through its own
  // click, since a blur arriving first would move the button out from under
  // the pointer, so it must release it afterwards or the field stands open
  // over a tree it does not filter. An empty field shows it most plainly.
  await openBook(page);
  const field = page.getByPlaceholder("Find a name or a phrase…");
  const back = page.getByRole("button", { name: "Back to the contents" });

  // The box, `.dt-find`, morphs; the input inside is absolutely positioned
  // with 57px of padding for the sigil and the tail, so it keeps its width
  // and is clipped when the box is a circle. The row's content is therefore
  // 0px wide, and the resting circle is as wide as the head line's control
  // box only because the row's basis is that box rather than its content.
  const box = page.locator(".dt-find");
  const circle = await page
    .locator(".dt-root")
    .evaluate((el) =>
      parseFloat(getComputedStyle(el).getPropertyValue("--bar-act")),
    );
  expect(circle).toBeGreaterThan(0);
  await settleTransitions(page);
  expect((await box.boundingBox())?.width).toBe(circle);

  await field.click();
  await expect(page.locator(".dt-search-invite")).toBeVisible();
  expect((await box.boundingBox())?.width ?? 0).toBeGreaterThan(100);

  await back.click();
  await expect(page.locator(".dt-tree-body")).toBeVisible();
  await expect.poll(async () => (await box.boundingBox())?.width).toBe(circle);
});

test("the results follow an edit the writer saves while they are on screen", async ({
  page,
}) => {
  // The list is live. Every write in this editor goes through one storage
  // port, so the panel hears the write itself rather than relying on each
  // writer to raise a signal.
  await openBook(page);
  await page.getByRole("button", { name: "The Dark", exact: true }).click();
  await expect(page.locator(".editor")).toBeVisible();

  const field = await search(page, "zebra");
  await expect(page.locator(".dt-moving-none")).toBeVisible();

  // Typed into the prose and saved; the find is not touched again.
  await page.locator(".editor").click();
  await page.keyboard.type(" zebra ");
  await page.keyboard.press("Control+s");

  await expect(page.locator(".dt-search-occurrence")).toHaveCount(1);
  await expect(page.locator(".dt-search-excerpt mark").first()).toHaveText(
    "zebra",
  );
  await expect(field).toHaveValue("zebra");
});

test("lists every occurrence a Section holds, and lands on the one clicked", async ({
  page,
}) => {
  // The panel lists every match it finds, each one somewhere the writer can
  // go.
  await openBook(page);
  await search(page, "darkness");

  const source = page
    .locator(".dt-search-group")
    .filter({ has: page.getByRole("heading", { name: "In the text" }) })
    .locator(".dt-search-source")
    .first();
  await expect(source.locator(".dt-search-tally")).toHaveText("3");
  await expect(source.locator(".dt-search-occurrence")).toHaveCount(3);

  // The second one: the ordinal travels with the query, so the writer arrives
  // where they pointed rather than at the top of the file.
  await source.locator(".dt-search-occurrence").nth(1).click();
  await expect(page.locator("mark.hl-search-current")).toBeInViewport();
});

test("clearing the field puts the writer back where they started", async ({
  page,
}) => {
  // The × ends the whole feature, including the marks it left in the prose:
  // a highlight that outlives its search has nothing on screen to explain or
  // dismiss it.
  await openBook(page);
  const field = await search(page, "darkness");

  await page
    .locator(".dt-search-group")
    .filter({ has: page.getByRole("heading", { name: "In the text" }) })
    .locator(".dt-search-occurrence")
    .first()
    .click();
  await expect(page.locator("mark.hl-search-current")).toBeVisible();

  await field.fill("");
  await expect(page.locator("mark.hl-search")).toHaveCount(0);
  await expect(page.locator("mark.hl-search-current")).toHaveCount(0);
  await expect(page.locator(".dt-search-row")).toHaveCount(0);

  // With the marks gone, the panel shows the invitation until the writer
  // leaves the field, because the find is still open.
  await field.blur();
  await expect(page.locator(".dt-tree-body")).toBeVisible();
});
