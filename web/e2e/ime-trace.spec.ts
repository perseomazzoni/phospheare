// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a real IME composition does: whether `compositionend` fires before or
// after the browser writes the final text and whether its `data` carries it,
// which `inputType`s arrive, in what order and whether cancelable, and what
// range a re-composition of the word under the caret covers. jsdom has no
// IME; CDP's `Input.imeSetComposition` drives a real composition through the
// same path GBoard uses.
//
// Two rows assert that composed text reaches the file as one undo step, since
// the screen can show text the file never receives. The other two print a
// trace and assert that a composition happened and that its text reached the
// file, never the order of the events, so a browser that changes its
// ordering shows as a changed trace rather than a failure elsewhere.

import { expect, test, type Page } from "@playwright/test";
import { DEMO_GLOBAL } from "./probe";

interface TraceEntry {
  type: string;
  inputType?: string;
  data: string | null;
  cancelable?: boolean;
  isComposing?: boolean;
  /** The editable's text at the moment the event fired. */
  domText: string;
  /** What `getTargetRanges()` reported, as offsets into the block's text. */
  ranges?: string;
}

/**
 * Records every composition and input event on the editable, with the DOM's
 * text when the event fired, which shows whether an event precedes or
 * follows the browser's own write.
 */
async function installRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector(".editor") as HTMLElement;
    const trace: TraceEntry[] = [];
    (window as unknown as { __imeTrace: TraceEntry[] }).__imeTrace = trace;
    const note = (e: Event) => {
      const ie = e as InputEvent & { isComposing?: boolean };
      trace.push({
        type: e.type,
        inputType: ie.inputType,
        data: ie.data ?? null,
        cancelable: e.cancelable,
        isComposing: ie.isComposing,
        domText: el.textContent ?? "",
        ranges: ie.getTargetRanges
          ? JSON.stringify(
              ie.getTargetRanges().map((r) => [r.startOffset, r.endOffset]),
            )
          : "n/a",
      });
    };
    for (const t of [
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "beforeinput",
      "input",
    ]) {
      // Capture phase: the editor's own listeners must not be able to hide an
      // event from the trace by stopping propagation.
      el.addEventListener(t, note, true);
    }
  });
}

/** A token no fixture prose contains, so "is it on disk" is unambiguous. */
const MARKER = "ZZCOMPOSEDZZ";

const readTrace = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __imeTrace: TraceEntry[] }).__imeTrace,
  );

/**
 * What reaches disk: the demo provider's in-memory files, read back out. The
 * DOM showing the composed text proves nothing, since the two can disagree,
 * and the engine is not exposed on the page.
 */
const docFiles = (page: Page) =>
  page.evaluate((global) => {
    const demo = (
      window as unknown as Record<
        string,
        { files: Map<string, string> } | undefined
      >
    )[global];
    return [...(demo?.files.entries() ?? [])]
      .filter(([path]) => path.startsWith("/document/"))
      .map(([, body]) => body)
      .join("\0");
  }, DEMO_GLOBAL);

/** Empties the open Section, so the file holds only the test's text. */
async function clearSection(page: Page): Promise<void> {
  await page.locator(".editor").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
}

function printTrace(label: string, trace: TraceEntry[], tail: string): void {
  console.log(
    `\n=== ${label} ===\n` +
      trace
        .map(
          (e) =>
            `${e.type.padEnd(17)} inputType=${(e.inputType ?? "-").padEnd(22)}` +
            ` data=${(JSON.stringify(e.data) ?? "").padEnd(9)}` +
            ` cancelable=${String(e.cancelable).padEnd(5)}` +
            ` isComposing=${String(e.isComposing).padEnd(5)}` +
            ` ranges=${e.ranges} dom=${JSON.stringify(e.domText)}`,
        )
        .join("\n") +
      `\n${tail}\n`,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
});

test("the composition event trace, printed", async ({ page }) => {
  await clearSection(page);
  await installRecorder(page);

  const cdp = await page.context().newCDPSession(page);
  // Three composition steps then a commit: the shape of a swipe-typed word.
  for (const [text, at] of [
    ["n", 1],
    ["ni", 2],
    ["nih", 3],
  ] as const) {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: at,
      selectionEnd: at,
    });
  }
  await cdp.send("Input.insertText", { text: "你好" });

  const trace = await readTrace(page);
  const dom = await page.locator(".editor").textContent();
  await page.keyboard.press("Control+s");
  const onDisk = (await docFiles(page)).includes("你好");
  printTrace(
    "composition trace",
    trace,
    `DOM: ${JSON.stringify(dom)}   composed text on disk: ${onDisk}`,
  );

  // The trace is the artifact; that a composition happened and that its text
  // reached the file is asserted, not the order of the events.
  expect(trace.some((e) => e.type === "compositionstart")).toBe(true);
  expect(trace.some((e) => e.type === "compositionend")).toBe(true);
  expect(onDisk).toBe(true);
});

test("composed text reaches the file", async ({ page }) => {
  await clearSection(page);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "zzc",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await cdp.send("Input.insertText", { text: MARKER });

  await expect(page.locator(".editor")).toHaveText(MARKER);
  // The screen agreeing proves nothing; the file is the fact.
  await page.keyboard.press("Control+s");
  await expect.poll(() => docFiles(page)).toContain(MARKER);
});

test("a whole composition is ONE undo step", async ({ page }) => {
  await clearSection(page);

  const cdp = await page.context().newCDPSession(page);
  // Composition steps and a commit. If each were its own history step, one
  // undo would walk back a single keystroke instead of removing the word.
  for (const [text, at] of [
    ["z", 1],
    ["zz", 2],
    ["zzc", 3],
  ] as const) {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: at,
      selectionEnd: at,
    });
  }
  await cdp.send("Input.insertText", { text: MARKER });
  await expect(page.locator(".editor")).toHaveText(MARKER);

  await page.keyboard.press("Control+z");
  await expect(page.locator(".editor")).toHaveText("");
  await page.keyboard.press("Control+s");
  await expect.poll(() => docFiles(page)).not.toContain(MARKER);
});

test("re-composing a word the caret lands inside", async ({ page }) => {
  await clearSection(page);
  await page.keyboard.type("The brown dog");
  await expect(page.locator(".editor")).toHaveText("The brown dog");
  await installRecorder(page);

  // With the caret in the middle of "brown", a phone keyboard starts a fresh
  // composition over the existing word, and the range it covers decides
  // whether the word is garbled.
  await page.evaluate(() => {
    const block = document.querySelector(".editor")
      ?.firstElementChild as HTMLElement;
    const node = block.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 7);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "black",
    selectionStart: 5,
    selectionEnd: 5,
  });
  await cdp.send("Input.insertText", { text: "black" });

  const trace = await readTrace(page);
  const dom = await page.locator(".editor").textContent();
  await page.keyboard.press("Control+s");
  const onDisk = (await docFiles(page)).includes("black");
  printTrace(
    "re-composition trace",
    trace,
    `DOM: ${JSON.stringify(dom)}   composed text on disk: ${onDisk}`,
  );
  // Which range the browser composes over is the trace's to show; that the
  // composed word is on screen and in the file is asserted.
  expect(trace.some((e) => e.type === "compositionstart")).toBe(true);
  expect(dom).toContain("black");
  expect(onDisk).toBe(true);
});
