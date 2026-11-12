// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The snapshot face in a browser ───────────────────────────────────────────
//
// The dock's snapshot face is a table of the open node's saved moments. The
// split divider, the dock over the paper and the camera toggle in the bar are
// what jsdom cannot prove. This spec drives the demo (`/app/editor/demo`) on
// the comparison node, whose fixture carries two snapshots, and pins the
// snapshot rows: the camera opens the dock on the snapshot face, the table
// lists newest first with the tick on the adopted row, [+] copies the adopted
// file at xy max+1 and opens the title field, adopting swaps the pointer and
// lands the editor in the new file, and selecting the older snapshot puts the
// editor into the read-only diff with the marks on screen.
//
// The demo fixture is in memory and resets on every reload, so each test
// starts from the same book.

import { expect, test, type Page } from "@playwright/test";
import {
  DEMO_COMPARISON,
  DEMO_SAME_LINE,
} from "../src/storage/demoFixtureAnchors";
import { DEMO_GLOBAL, settleTransitions } from "./probe";

async function openComparisonNode(page: Page) {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  // The fixture's `lastOpened` node, whose adopted file is the `.01`. Every
  // name comes from `demoFixtureAnchors.ts`, so no fixture string is written
  // out in this spec.
  await page.locator(".dt-label", { hasText: DEMO_COMPARISON.section }).click();
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.adoptedOnlyPhrase,
  );
}

async function openSnapshotFace(page: Page) {
  await page.getByRole("button", { name: "Snapshots" }).click();
  await expect(page.locator(".snap-table")).toBeVisible();
}

test("the camera opens the dock on the snapshot face, newest first, tick on adopted", async ({
  page,
}) => {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  // Newest first: the adopted `.01` row above the earlier one.
  const titles = page.locator(".snap-row .snap-title");
  await expect(titles).toHaveCount(2);
  await expect(titles.nth(0)).toHaveText(DEMO_COMPARISON.adoptedRow);
  await expect(titles.nth(1)).toHaveText(DEMO_COMPARISON.earlierRow);
  await expect(
    page.locator(".snap-row").nth(0).locator(".snap-tick"),
  ).toBeVisible();
  // The preview at rest shows the adopted snapshot's text.
  await expect(page.locator(".snap-preview-body")).toContainText(
    DEMO_COMPARISON.adoptedOnlyPhrase,
  );
});

test("selecting the older snapshot shows the read-only diff with the marks", async ({
  page,
}) => {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.earlierRow })
    .click();
  // The editor enters the comparing mode: read-only, marked, captioned.
  await expect(page.locator(".editor")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-diff",
    "1",
  );
  await expect(page.locator(".editor mark.df-deleted").first()).toBeVisible();
  // The snapshot comparison owns the screen: no command bar over the
  // comparison, and no caret, because the caret marks where the next keystroke
  // lands and the accept is a click. The paper click refocuses the surface, so
  // the row pins the rule rather than the blur the row click caused.
  await expect(page.locator(".ui-bar")).toHaveCount(0);
  await page.locator(".editor").click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".fake-cursor")).toBeHidden();
  // The merged text keeps the deleted words on screen.
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.earlierWord,
  );
  await expect(page.locator(".comparing-bar")).toBeVisible();
  // Clicking the adopted row returns to editing.
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.adoptedRow })
    .click();
  await expect(page.locator(".editor")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(page.locator(".editor mark.df-deleted")).toHaveCount(0);
  // The bar returns with the editing surface.
  await expect(page.locator(".ui-bar")).toHaveCount(1);
});

test("the comparison's legend and lenses stay above the dock and take the pointer", async ({
  page,
}) => {
  // At 1020 the open dock reaches under the legend card's right end. The
  // card and the lenses outrank every panel (the dock at 115, the structure
  // panel at 105, the engaged chrome at 130), so where the dock meets the
  // card the pointer lands on the card, and each lens is its own target.
  await page.setViewportSize({ width: 1020, height: 800 });
  await openComparisonNode(page);
  await openSnapshotFace(page);
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.earlierRow })
    .click();
  await expect(page.locator(".comparing-bar")).toBeVisible();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  await settleTransitions(page);

  const hits = await page.evaluate(() => {
    const card = document.querySelector(".comparing-bar")!;
    const a = card.getBoundingClientRect();
    const b = document.querySelector(".ed-dock")!.getBoundingClientRect();
    const x = Math.max(a.left, b.left);
    const y = Math.max(a.top, b.top);
    const meet =
      Math.min(a.right, b.right) > x && Math.min(a.bottom, b.bottom) > y;
    const at = document.elementFromPoint(x + 4, y + 4);
    return {
      meet,
      card: !!at?.closest(".comparing-bar"),
      dock: !!at?.closest(".ed-dock"),
      lenses: [...document.querySelectorAll(".comparing-select")].map((el) => {
        const r = el.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
          el
        );
      }),
    };
  });
  expect(hits).toEqual({
    meet: true,
    card: true,
    dock: false,
    lenses: [true, true],
  });
});

test("selecting another snapshot replaces the diff — never the stale first one", async ({
  page,
}) => {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  // A third snapshot, created as a copy of the adopted text: comparing it
  // against the adopted snapshot is an empty diff, so any marks left over
  // from the first pair show a stale diff.
  await page.getByRole("button", { name: "New snapshot" }).click();
  await page.locator(".snap-add-input").fill(DEMO_COMPARISON.nextRow);
  await page.keyboard.press("Enter");
  await expect(page.locator(".snap-row .snap-title")).toHaveCount(3);
  // The older snapshot's diff is up, with marks on the prose.
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.earlierRow })
    .click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-diff",
    "1",
  );
  await expect(page.locator(".editor mark.df-deleted").first()).toBeVisible();
  // Selecting the newest snapshot while that diff is still up replaces the
  // pair: identical texts leave no marks, and the caption names the new one.
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.nextRow })
    .click();
  await expect(page.locator(".editor mark.df-deleted")).toHaveCount(0);
  await expect(page.locator(".comparing-bar")).toBeVisible();
  await expect(page.locator(".editor")).not.toContainText(
    DEMO_COMPARISON.earlierWord,
  );
});

test("closing the dock returns the editor to normal status", async ({
  page,
}) => {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.earlierRow })
    .click();
  await expect(page.locator(".editor")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(page.locator(".comparing-bar")).toBeVisible();
  // Whatever shut the face, the editor comes back: editable, un-carded,
  // unmarked.
  await page.getByRole("button", { name: "Close the dock" }).click();
  await expect(page.locator(".editor")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(page.locator(".comparing-bar")).toHaveCount(0);
  await expect(page.locator(".editor mark.df-deleted")).toHaveCount(0);
  // The face's state ends with the face: reopening shows no stale selection.
  await page.getByRole("button", { name: "Snapshots" }).click();
  await expect(page.locator(".snap-row .snap-title")).toHaveCount(2);
  await expect(
    page.locator(".snap-row").nth(0).locator(".snap-tick"),
  ).toBeVisible();
});

test("[+] adds a snapshot at xy max+1 with the title field open", async ({
  page,
}) => {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  await page.getByRole("button", { name: "New snapshot" }).click();
  // The fresh row's field is focused; its placeholder names the default.
  const input = page.locator(".snap-add-input");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("placeholder", DEMO_COMPARISON.nextRow);
  await page.keyboard.press("Enter");
  await expect(page.locator(".snap-row .snap-title")).toHaveCount(3);
  // The adopted snapshot does not change: the tick stays on "The Storm 2",
  // the middle row under the fresh, newest snapshot.
  await expect(
    page.locator(".snap-row").nth(1).locator(".snap-tick"),
  ).toBeVisible();
  await expect(
    page.locator(".snap-row").nth(0).locator(".snap-tick"),
  ).toHaveCount(0);
});

test("adopting a snapshot swaps the pointer and lands the editor in the new file", async ({
  page,
}) => {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  // The older row's Adopt button is revealed on hover.
  const older = page.locator(".snap-row").nth(1);
  await older.hover();
  await older.getByRole("button", { name: "Adopt" }).click();
  // The tick moves to the older row, the newly adopted snapshot.
  await expect(older.locator(".snap-tick")).toBeVisible();
  await expect(
    page.locator(".snap-row").nth(0).locator(".snap-tick"),
  ).toHaveCount(0);
  // The editor holds the newly adopted file's text.
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.earlierWord,
  );
});

// ── Accepting individual changes ─────────────────────────────────────────────
//
// Each hunk of the comparison carries a hover-revealed Accept button in the
// right margin. A click applies that hunk alone as an ordinary undoable edit,
// the diff recomputes, and exiting the comparison keeps the accepted changes.
// The comparison fixture diffs in three hunks: the revised word inside the
// opening paragraph, and the two adopted-only paragraphs as block deletes,
// since the earlier draft holds only the opening. The demo's provider is in
// memory and resets on every reload.

async function enterComparisonDiff(page: Page) {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.earlierRow })
    .click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-diff",
    "1",
  );
  // The grain dropdown defaults to By word. The accept rows pin word-grain
  // semantics, so the explicit switch keeps them independent of the default.
  // It lives in the comparing bar, which appears with the diff.
  await page.getByLabel("Granularity").selectOption({ label: "By word" });
  // At least one hunk; the revised word is the first.
  await expect(page.locator(".df-accept").first()).toHaveCount(1);
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.earlierWord,
  );
}

test("hovering a diff hunk reveals its Accept button; leaving hides it", async ({
  page,
}) => {
  await enterComparisonDiff(page);
  const button = page.locator(".df-accept").first();
  // At rest the button is unrevealed (opacity 0, pointer-events none). The
  // reveal class is the state under test; the fade belongs to the CSS.
  await expect(button).not.toHaveClass(/revealed/);
  // The reveal follows the pointer's rest over the hunk (an 80ms intent);
  // Playwright's hover leaves the pointer still, so the button fades in.
  await page.locator(".editor .df-hunk").first().hover();
  await expect(button).toHaveClass(/revealed/);
  // The pointer moves to a lower, unmarked paragraph, clear of the tree panel
  // and of any hunk, and the button hides.
  await page
    .locator(".editor p")
    .nth(1)
    .hover({ position: { x: 300, y: 5 } });
  await expect(button).not.toHaveClass(/revealed/);
});

test("the Accept tag is part of the wash — flush below its tail, right edge aligned, chrome-free", async ({
  page,
}) => {
  await enterComparisonDiff(page);
  const tag = await page.locator(".df-accept").first().boundingBox();
  expect(tag).not.toBeNull();
  if (!tag) throw new Error("no box");
  // The tag grows from the wash's tail, the end of the hunk's last line. The
  // hunk's bounding box takes its right edge from the longest line, so a
  // multiline hunk with a shorter last line would leave the tag floating
  // beside the wash; the last line's own box is measured.
  const tail = await page
    .locator(".editor .df-hunk")
    .first()
    .evaluate((el) => {
      const rects = el.getClientRects();
      if (rects.length === 0) {
        const b = el.getBoundingClientRect();
        return { right: b.right, bottom: b.bottom };
      }
      const last = rects[rects.length - 1];
      return { right: last.right, bottom: last.bottom };
    });
  // The tag's top edge sits flush at the tail line's bottom, neither
  // overlapping the wash nor floating below it, and its right edge at the
  // tail's end, so the tag and the wash read as one surface.
  expect(Math.abs(tag.y - tail.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(tag.x + tag.width - tail.right)).toBeLessThanOrEqual(1);
  // The tag is chrome-free: no border, no radius, and the wash's background
  // made opaque, with no alpha, so nothing behind it shows through.
  const style = await page
    .locator(".df-accept")
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        border: cs.borderTopWidth,
        radius: cs.borderRadius,
        bg: cs.backgroundColor,
      };
    });
  expect(style.border).toBe("0px");
  expect(style.radius).toBe("0px");
  expect(style.bg).toMatch(/^rgb\(/);
  // The label is the lowercase word "accept".
  await expect(page.locator(".df-accept").first()).toHaveText("accept");
  // The wash's resting ground before any hover. The first hunk is a
  // replacement whose marks mix the deletion's red and the addition's green,
  // so the first mark is read.
  const restingMarkBg = await page
    .locator(".editor .df-hunk mark")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  // The wash lights with the hunk: hovering the band reveals the tag and
  // takes the tag's hover ground, so hunk and tag act as one control.
  await page.locator(".editor .df-hunk").first().hover();
  await expect(page.locator(".df-accept").first()).toHaveClass(/revealed/);
  const washWhileHunkHovered = await page
    .locator(".editor .df-hunk mark")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(washWhileHunkHovered).not.toBe(restingMarkBg);
  // Moving the pointer onto the tag keeps the wash on the same ground and
  // deepens the tag's own background. The ground transitions over `--t-tap`
  // (110ms), so the assertion polls the wash until it settles; a fixed sleep
  // would read a mid-transition colour and fail on timing, not behaviour.
  await page.locator(".df-accept").first().hover();
  await expect
    .poll(() =>
      page
        .locator(".editor .df-hunk mark")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe(washWhileHunkHovered);
  // The tag's own background is polled, not sampled once. The
  // poll above cannot serve as the wait: the hunk hover already lit the wash,
  // so its condition holds on the first sample and it returns at once. A
  // single read then lands in the hover's frame, before the tag's own
  // `--t-tap` transition has moved.
  const acceptTag = page.locator(".df-accept").first();
  await expect
    .poll(() =>
      acceptTag.evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .not.toBe(style.bg);
  expect(
    await acceptTag.evaluate((el) => getComputedStyle(el).fontWeight),
  ).toBe("560");
});

test("clicking Accept applies exactly that hunk — one undo step, marks recalculated", async ({
  page,
}) => {
  await enterComparisonDiff(page);
  const buttonsBefore = await page.locator(".df-accept").count();
  // The comparison's source is the selected, older snapshot: the first hunk
  // replaces the adopted word with the earlier draft's. Accepting it removes
  // the struck word and one button; the other hunks' marks stay.
  const button = page.locator(".df-accept").first();
  // Hovering the hunk arms it, revealing its button; the click then
  // auto-waits for the reveal and lands on the button.
  await page.locator(".editor .df-hunk").first().hover();
  await button.click();
  await expect(page.locator(".df-accept")).toHaveCount(buttonsBefore - 1);
  await expect(page.locator(".editor")).not.toContainText(
    DEMO_COMPARISON.adoptedWord,
  );
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.earlierWord,
  );
  await expect(page.locator(".editor mark.df-deleted").first()).toBeVisible();
  // One undoable step: Mod+Z reverses the accept and the marks return;
  // Mod+Shift+Z re-applies it. The button holds focus after the click, so
  // the editor takes the keyboard first.
  await page.locator(".editor").click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.adoptedWord,
  );
  await expect(page.locator(".df-accept")).toHaveCount(buttonsBefore);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".editor")).not.toContainText(
    DEMO_COMPARISON.adoptedWord,
  );
  await expect(page.locator(".df-accept")).toHaveCount(buttonsBefore - 1);
});

test("exiting the comparison keeps the accepted changes as ordinary edits", async ({
  page,
}) => {
  await enterComparisonDiff(page);
  const button = page.locator(".df-accept").first();
  await page.locator(".editor .df-hunk").first().hover();
  await button.click();
  await expect(page.locator(".editor")).not.toContainText(
    DEMO_COMPARISON.adoptedWord,
  );
  // Closing the dock ends the comparison: no marks, no buttons, editable.
  // The accepted earlier word stays and the unaccepted paragraphs are
  // untouched.
  await page.getByRole("button", { name: "Close the dock" }).click();
  await expect(page.locator(".editor")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(page.locator(".editor mark")).toHaveCount(0);
  await expect(page.locator(".df-accept")).toHaveCount(0);
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.earlierWord,
  );
  await expect(page.locator(".editor")).not.toContainText(
    DEMO_COMPARISON.adoptedWord,
  );
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.adoptedOnlyPhrase,
  );
  // After the comparison, the accepted changes undo like any other edit in
  // the history.
  await page.locator(".editor").click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.adoptedWord,
  );
});

test("the saved file on disk contains only prose — no accept metadata", async ({
  page,
}) => {
  await enterComparisonDiff(page);
  const button = page.locator(".df-accept").first();
  await page.locator(".editor .df-hunk").first().hover();
  await button.click();
  // Saves are suspended while the comparison is up, because an autosave
  // mid-comparison would shift the diff's base. After the diff closes, a
  // normal save writes the accepted buffer to the adopted file.
  await page.getByRole("button", { name: "Close the dock" }).click();
  await expect(page.locator(".editor")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await page.locator(".editor").click();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".editor")).toContainText(
    DEMO_COMPARISON.earlierWord,
  );
  // The anchor is passed in as an argument: this callback runs in the page,
  // where the spec's Node-side imports do not exist.
  const onDisk = await page.evaluate(
    ([adoptedFile, global]) => {
      const files = (
        window as unknown as Record<string, { files: Map<string, string> }>
      )[global].files;
      const entry = [...files.entries()].find(([path]) =>
        path.endsWith(adoptedFile),
      );
      return entry ? entry[1] : null;
    },
    [DEMO_COMPARISON.adoptedFile, DEMO_GLOBAL] as const,
  );
  expect(onDisk).toContain(DEMO_COMPARISON.earlierWord);
  expect(onDisk).toContain(DEMO_COMPARISON.adoptedOnlyPhrase);
  expect(onDisk).not.toContain(DEMO_COMPARISON.adoptedWord);
  // No button, marker or review metadata reaches the file.
  expect(onDisk).not.toMatch(/df-|Accept|mark|accept/i);
});

test("— adjacent same-line tags are independently reachable", async ({
  page,
}) => {
  // The same-line fixture puts two replace hunks a kept word apart on one
  // line. Each tag is reachable on its own: arming its hunk reveals it and
  // the click applies that hunk alone. A hidden tag is pointer-events none,
  // so the later tag never covers the earlier one's pointer.
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page
    .locator(".dt-row", { hasText: DEMO_SAME_LINE.part })
    .locator(".dt-chevron")
    .click();
  await page.locator(".dt-label", { hasText: DEMO_SAME_LINE.section }).click();
  await expect(page.locator(".editor")).toContainText(
    DEMO_SAME_LINE.adoptedLine,
  );
  await page.getByRole("button", { name: "Snapshots" }).click();
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_SAME_LINE.earlierRow })
    .click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-diff",
    "1",
  );
  // The adjacency is a word-grain case, so the lens switches to By word
  // first.
  await page.getByLabel("Granularity").selectOption({ label: "By word" });
  await expect(page.locator(".df-accept")).toHaveCount(2);
  // The first tag applies the first word's replace; the second stays.
  const first = page.locator(".df-accept").first();
  await page.locator(".editor .df-hunk").first().hover();
  await first.click();
  await expect(page.locator(".editor")).toContainText(
    DEMO_SAME_LINE.firstWord.earlier,
  );
  await expect(page.locator(".editor")).toContainText(
    DEMO_SAME_LINE.secondWord.adopted,
  );
  await expect(page.locator(".df-accept")).toHaveCount(1);
  // After an undo, the second tag applies the second word; the first stays.
  await page.locator(".editor").click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".df-accept")).toHaveCount(2);
  const second = page.locator(".df-accept").nth(1);
  await page.locator(".editor .df-hunk").nth(1).hover();
  await second.click();
  await expect(page.locator(".editor")).toContainText(
    DEMO_SAME_LINE.secondWord.earlier,
  );
  await expect(page.locator(".editor")).toContainText(
    DEMO_SAME_LINE.firstWord.adopted,
  );
});

// ── Diff granularity and orientation ─────────────────────────────────────────
//
// The comparing bar over the paper carries the direction lens, which picks
// the side that is the spine, and the grain dropdown: By word (the default),
// By sentence, By paragraph. The rows carry relative-position badges, the
// legend card reads the lens, and the pair's identity lives in the table's
// selection. The same-line fixture holds two snapshots whose closing lines
// differ by two words around a kept word: two hunks by word, which the
// paragraph grain collapses to a single whole-paragraph replace.

async function enterSameLineDiff(page: Page) {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  // This node sits under a Part the demo starts collapsed, and only the
  // chevron expands one. `demoFixtureAnchors.test.ts` pins that the Part is
  // absent from the fixture's `expanded` list, so this step cannot become a
  // no-op.
  await page
    .locator(".dt-row", { hasText: DEMO_SAME_LINE.part })
    .locator(".dt-chevron")
    .click();
  await page.locator(".dt-label", { hasText: DEMO_SAME_LINE.section }).click();
  await expect(page.locator(".editor")).toContainText(
    DEMO_SAME_LINE.adoptedLine,
  );
  await page.getByRole("button", { name: "Snapshots" }).click();
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_SAME_LINE.earlierRow })
    .click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-diff",
    "1",
  );
}

test("the grain dropdown re-diffs the comparison — the default is By word", async ({
  page,
}) => {
  await enterSameLineDiff(page);
  // The default lens is By word: the two replaces a kept word apart appear.
  await expect(page.locator(".df-accept")).toHaveCount(2);
  // By paragraph makes the whole paragraph a single replace.
  await page.getByLabel("Granularity").selectOption({ label: "By paragraph" });
  await expect(page.locator(".df-accept")).toHaveCount(1);
  // Back to By word, the lens re-expands.
  await page.getByLabel("Granularity").selectOption({ label: "By word" });
  await expect(page.locator(".df-accept")).toHaveCount(2);
});

test("at paragraph grain one click swaps the whole paragraph, one undo returns it", async ({
  page,
}) => {
  await enterSameLineDiff(page);
  // This row pins the paragraph grain's whole-paragraph swap; the default is
  // By word, so the coarse lens is selected first.
  await page.getByLabel("Granularity").selectOption({ label: "By paragraph" });
  await expect(page.locator(".df-accept")).toHaveCount(1);
  const tag = page.locator(".df-accept").first();
  await page.locator(".editor .df-hunk").first().hover();
  await tag.click();
  // One accept makes the whole paragraph the compared text.
  await expect(page.locator(".editor")).toContainText(
    DEMO_SAME_LINE.earlierLine,
  );
  await expect(page.locator(".df-accept")).toHaveCount(0);
  // One undo returns the whole adopted paragraph. At paragraph grain the
  // display always shows the compared voice, because the coarse lens marks
  // the paragraph without splicing the old words in, so the return shows in
  // the reappearing accept tag, not the visible text.
  await page.locator(".editor").click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".df-accept")).toHaveCount(1);
});

test("the snapshot rows carry relative-position badges; the adopted row is bare", async ({
  page,
}) => {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  // "The Storm 2" is adopted (no badge); "The Storm 1" sits one file back.
  await expect(
    page.locator(".snap-row").nth(0).locator(".snap-rel"),
  ).toHaveCount(0);
  const older = page.locator(".snap-row").nth(1).locator(".snap-rel");
  await expect(older).toHaveAttribute("data-dir", "back");
  await expect(older).toHaveAttribute("data-count", "1");
});

test("the legend follows the direction lens; the lens resets per pass", async ({
  page,
}) => {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.earlierRow })
    .click();
  // The legend card is up over the read-only diff, and the question answers
  // the default Adopted -> Selected reading.
  await expect(page.locator(".comparing-bar")).toBeVisible();
  const questionText = () =>
    page.locator(".comparing-question").evaluate((el) => el.textContent ?? "");
  const before = await questionText();
  // Flipping the lens swaps the question to the Selected -> Adopted reading.
  // The direction dropdown carries the roles; the pair's identity lives in
  // the table's selection.
  await page
    .getByLabel("Comparison direction")
    .selectOption({ label: "Selected → Adopted" });
  await expect.poll(async () => questionText()).not.toBe(before);
  // The lens is per pass: closing the comparison and re-entering the same pair
  // starts at the default again, so a writer who prefers the other reading
  // flips it on every entry.
  await page.getByRole("button", { name: "Close the dock" }).click();
  await expect(page.locator(".editor")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await page.getByRole("button", { name: "Snapshots" }).click();
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.earlierRow })
    .click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-diff",
    "1",
  );
  await expect(page.getByLabel("Comparison direction")).toHaveValue(
    "adoptedWithSelected",
  );
});

test("the direction dropdown flips the display — the adopted manuscript becomes the spine", async ({
  page,
}) => {
  await openComparisonNode(page);
  await openSnapshotFace(page);
  await page
    .locator(".snap-row .snap-title", { hasText: DEMO_COMPARISON.earlierRow })
    .click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-diff",
    "1",
  );
  await page.getByLabel("Granularity").selectOption({ label: "By word" });
  // By default the selected snapshot's text is the spine, and the
  // adopted-only word is struck.
  await expect(page.locator(".editor mark.df-deleted").first()).toContainText(
    DEMO_COMPARISON.adoptedWord,
  );
  // In the chronological reading the adopted manuscript is the spine: the
  // earlier draft's word is struck and the adopted's additions are green.
  await page
    .getByLabel("Comparison direction")
    .selectOption({ label: "Selected → Adopted" });
  await expect(page.locator(".editor mark.df-deleted").first()).toContainText(
    DEMO_COMPARISON.earlierWord,
  );
  await expect(page.locator(".editor mark.df-inserted").first()).toContainText(
    DEMO_COMPARISON.adoptedWord,
  );
});

test("the diff washes read red and green in every state, per theme", async ({
  page,
}) => {
  // Deletions read red and additions green in every state, resting wash,
  // struck text, tag ground and hover, in each theme. The theme
  // button in the tree foot cycles the ring; the demo boots on the still dark
  // default whatever the system asks for.
  await page.emulateMedia({ colorScheme: "light" });
  await enterSameLineDiff(page);
  await page.getByLabel("Granularity").selectOption({ label: "By word" });
  // The first same-line hunk is one replace holding the deleted adopted word
  // and the inserted earlier one, so a single hunk shows both washes.
  const washed = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  // The deleted/inserted text colours are plain per-theme tokens, read once.
  const coloured = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).color);
  // The hover wash transitions over `--t-tap` (110ms), so the reads poll for
  // the settled colour instead of catching a mid-transition frame.
  const hovered = (selector: string, expected: string) =>
    expect
      .poll(() =>
        page
          .locator(selector)
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .toBe(expected);
  const expected = [
    {
      theme: "matte-dark",
      del: "rgba(214, 96, 86, 0.16)",
      add: "rgba(74, 160, 110, 0.16)",
      delText: "rgb(227, 141, 134)",
      addText: "rgb(109, 185, 142)",
      tagGround: "rgb(32, 46, 43)",
      delHover: "rgb(69, 56, 60)",
      addHover: "rgb(52, 65, 62)",
    },
    {
      theme: "matte-light",
      del: "rgba(190, 70, 60, 0.14)",
      add: "rgba(35, 140, 85, 0.14)",
      delText: "rgb(142, 57, 49)",
      addText: "rgb(24, 98, 62)",
      tagGround: "rgb(193, 208, 198)",
      delHover: "rgb(193, 182, 178)",
      addHover: "rgb(175, 189, 180)",
    },
  ];
  for (const t of expected) {
    await expect(page.locator(".editor mark.df-deleted").first()).toBeVisible();
    await expect(await washed(".editor mark.df-deleted")).toBe(t.del);
    await expect(await washed(".editor mark.df-inserted")).toBe(t.add);
    // The deletion reads red in its text as well as its wash, and the accept
    // tag rests on the addition's green, because accepting a replacement
    // adopts the new text.
    await expect(await coloured(".editor mark.df-deleted")).toBe(t.delText);
    await expect(await coloured(".editor mark.df-inserted")).toBe(t.addText);
    // The accept tag's ground transitions over `--t-tap` when the diff first
    // mounts, like the hover wash, so it is polled the same way rather than
    // read once in a mid-transition frame.
    await expect
      .poll(() =>
        page
          .locator(".df-accept")
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .toBe(t.tagGround);
    // The hover state keeps the red and green family: the wash lights with
    // the hunk in the theme's hue.
    await page.locator(".editor .df-hunk").first().hover();
    await hovered(".editor mark.df-deleted", t.delHover);
    await hovered(".editor mark.df-inserted", t.addHover);
    // Flip to the theme's other variant.
    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: "Light or dark" }).click();
  }
});

// ── Every offered hunk is reachable ──────────────────────────────────────────
//
// A comparison that shows a hunk lets the writer reach it, whatever produced
// the hunk. Arming an Accept means hovering its hunk, and a
// zero-width box takes no pointer, so a hunk of one invisible character, such
// as a file's terminating newline kept in its last paragraph, would count
// toward the total and never be revealed or applied. The row pins the
// property across both fixtures rather than one case.

test("every hunk the comparison offers is reachable", async ({ page }) => {
  for (const enter of [enterComparisonDiff, enterSameLineDiff]) {
    await enter(page);
    const hunks = page.locator(".editor .df-hunk");
    const count = await hunks.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await hunks.nth(i).boundingBox();
      const text = await hunks.nth(i).textContent();
      // A hunk with no width cannot be hovered, so its Accept can never be
      // armed. Height alone is not enough: the pointer needs both axes.
      expect(
        box,
        `hunk ${i} (${JSON.stringify(text)}) has no box`,
      ).not.toBeNull();
      expect(
        box!.width,
        `hunk ${i} (${JSON.stringify(text)}) is ${box!.width}px wide — no pointer can arm it`,
      ).toBeGreaterThan(0);
    }

    // The tags match the hunks one for one: a tag with no hunk is a button
    // pointing at nothing.
    await expect(page.locator(".df-accept")).toHaveCount(count);
  }
});
