// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The assistant against intercepted Ollama ─────────────────────────────────
//
// The demo's Assistant answers from the static demo model and reaches no
// real model. The assistant rows run on a signed-in local project
// (`signedInProject.ts`) and skip on engines without the File System Access
// API; the first describe pins the demo and needs no writer.
//
// `page.route` stands in for the writer's local runtime. These specs prove
// the wiring (send, stream, Stop, the model button, chat switching), not real
// model behaviour or loopback CORS, which the qualification run in
// `CONTRIBUTING.md` covers.

import { expect, test, type Page } from "@playwright/test";
import en from "../src/locales/en.json" with { type: "json" };
import { stableBox } from "./probe";
import {
  openSignedInProject,
  skipWithoutLocalFolders,
} from "./signedInProject";

const MODEL = "e2e:latest";
// A real Ollama id long enough to fill the bar beside the Mode, and to be
// wider than the run's line at the dock's floor.
const LONG_MODEL = "hf.co/bartowski/Llama-3.1-8B-Instruct-GGUF:Q4_K_M";
const LONG_TITLE =
  "Notes on the second act, where the brother comes back from the city and nobody tells him about the house";
// No connection record is seeded: the record is keyed by the writer's id,
// and with none stored the default endpoint applies.

function ndjson(...records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

// An answer whose turn carries a footer of facts: its token counts and time.
const ANSWER_WITH_FACTS = ndjson({
  message: { content: "It is doing two jobs." },
  done: true,
  prompt_eval_count: 9,
  eval_count: 4,
  total_duration: 2_000_000,
});

async function openAsk(page: Page) {
  await openSignedInProject(page);
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Enlighten!" })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
}

async function stubOllama(page: Page, body: string | null, model = MODEL) {
  await page.route("http://localhost:11434/api/tags", (route) =>
    route.fulfill({
      json: { models: [{ name: model, digest: "e2e-digest" }] },
    }),
  );
  // The app's own default window (`DEFAULT_CONTEXT_TOKENS`): a smaller one
  // cannot hold the assistant's instructions and evidence, and the run is
  // refused before it starts (`limitsFor`).
  await page.route("http://localhost:11434/api/show", (route) =>
    route.fulfill({
      json: {
        capabilities: ["completion", "tools"],
        model_info: { "llama.context_length": 16_384 },
      },
    }),
  );
  await page.route("http://localhost:11434/api/chat", (route) => {
    if (body === null) return new Promise<never>(() => undefined);
    return route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body,
    });
  });
}

/**
 * Chooses the model this chat answers with, at the model button. Idempotent: a
 * new chat inherits the most recent chat's model, so a second call in a row is
 * a no-op.
 */
async function chooseModel(page: Page, model = MODEL) {
  const control = page.getByRole("button", { name: "Model for this chat" });
  if ((await control.textContent()) === model) return;
  await control.click();
  await page.getByRole("menuitem", { name: model }).click();
  await expect(control).toHaveText(model);
}

async function newChat(page: Page, model = MODEL) {
  // The empty state's button and the `+` beside the composer open the same
  // shared menu.
  const emptyNewChat = page.locator(".ai-empty button", {
    hasText: "New chat",
  });
  if ((await emptyNewChat.count()) > 0) await emptyNewChat.first().click();
  else await page.getByRole("button", { name: "New chat" }).click();
  await page.getByRole("menuitem").first().click();
  await chooseModel(page, model);
}

/** Sends one question from the composer. */
async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Enlighten!" });
  await composer.fill(text);
  await composer.press("Enter");
}

/**
 * Drags the dock's grip until the dock is about `width` wide, as a writer
 * widens it. The dock opens at its 340px floor.
 */
async function widenDock(page: Page, width: number) {
  const view = page.viewportSize();
  if (!view) throw new Error("no viewport");
  const grip = await stableBox(page, ".dock-resize");
  const y = grip.y + grip.height / 2;
  await page.mouse.move(grip.x + grip.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(view.width - width, y, { steps: 8 });
  await page.mouse.up();
}

// ── The demo answers from the demo model ─────────────────────────────────────
//
// On `/app/editor/demo` every way in leads to an Assistant whose only model is
// the static demo model. The row checks the four places a writer
// reaches it from, then sends twice: each answer is a different fixed reply,
// ends with the disclaimer, and no request leaves for a device model,
// OpenRouter or Wikipedia.
test.describe("the demo", () => {
  test("offers Enlighten! everywhere and answers with a static reply", async ({
    page,
  }) => {
    const outbound: string[] = [];
    page.on("request", (sent) => {
      const url = sent.url();
      const host = new URL(url).hostname;
      if (
        url.includes(":11434/") ||
        host === "openrouter.ai" ||
        host.endsWith(".wikipedia.org")
      )
        outbound.push(url);
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app/editor/demo");
    await page.getByRole("button", { name: "Continue writing" }).click();
    await expect(page.locator(".editor p").first()).toBeVisible();

    // The palette: its Places group names the places there are.
    await page.getByRole("button", { name: "Palette" }).click();
    const board = page.locator(".board");
    await expect(
      board.getByRole("button", { name: "Enlighten!", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(board).toHaveCount(0);

    // The bubble: a real drag over real words, so the bubble is up with its
    // selection-bound verbs before the Ask among them is looked for.
    await page.locator(".editor p").first().click();
    await page.keyboard.type("A quiet window here");
    const word = await page.evaluate(() => {
      const para = document.querySelector(".editor p") as HTMLElement;
      const node = para.firstChild as Text;
      const range = document.createRange();
      range.setStart(node, 8);
      range.setEnd(node, 14);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    });
    await page.mouse.move(word.x + 2, word.y + word.h / 2);
    await page.mouse.down();
    await page.mouse.move(word.x + word.w - 2, word.y + word.h / 2);
    await page.mouse.up();
    const bubble = page.getByRole("toolbar", { name: "Selection" });
    await expect(bubble.getByText("Enlighten!")).toBeVisible();
    await page.keyboard.press("Escape");

    // The bar's spark opens the dock on the Ask face, the fourth tab.
    await page
      .locator(".bar-stack")
      .getByRole("button", { name: "Enlighten!" })
      .click();
    await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
    await expect(page.locator(".dock-head .ui-bar-track button")).toHaveCount(
      4,
    );

    // A first chat starts on the demo model with nothing chosen.
    await page.locator(".ai-empty button", { hasText: "New chat" }).click();
    await page.getByRole("menuitem").first().click();
    await expect(
      page.getByRole("button", { name: "Model for this chat" }),
    ).toHaveText("ShAIne");

    const composer = page.getByRole("textbox", { name: "Enlighten!" });
    const answers = page.locator(".msg-assistant .msg-body");
    // The reply streams a word at a time, and a busy two-core runner renders
    // each word slowly enough that the whole reply outlasts the default wait.
    const streamed = { timeout: 20_000 };
    await composer.fill("Is this opening working?");
    await composer.press("Enter");
    await expect(answers.nth(0)).toContainText(
      en.dock.demoModel.reply1,
      streamed,
    );
    await expect(answers.nth(0).locator("em").last()).toHaveText(
      en.dock.demoModel.disclaimer,
    );
    await composer.fill("And the dialogue?");
    await composer.press("Enter");
    await expect(answers.nth(1)).toContainText(
      en.dock.demoModel.reply2,
      streamed,
    );
    await expect(answers.nth(1).locator("em").last()).toHaveText(
      en.dock.demoModel.disclaimer,
    );

    expect(outbound).toEqual([]);
  });
});

test.describe("the assistant", () => {
  test.beforeEach(async ({ page, browserName }) => {
    skipWithoutLocalFolders(browserName);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("streams an answer into the transcript", async ({ page }) => {
    await stubOllama(
      page,
      ndjson(
        { message: { content: "It is doing " }, done: false },
        {
          message: { content: "two jobs." },
          done: true,
          prompt_eval_count: 9,
          eval_count: 4,
          total_duration: 2_000_000,
        },
      ),
    );
    await openAsk(page);
    await newChat(page);
    const composer = page.getByRole("textbox", { name: "Enlighten!" });
    await composer.fill("Is this line doing too much?");
    await composer.press("Enter");
    await expect(page.locator(".msg-assistant .msg-body")).toContainText(
      "two jobs.",
    );
    // The foot is transient state only, with no permanent model or path
    // chrome.
    await expect(page.locator(".dock-foot")).toHaveCount(0);
  });

  test("renders an answer as markdown, and refuses the markup in it", async ({
    page,
  }) => {
    // The unit tests assert the renderer's output; this asserts what a real
    // DOM does with it: the strong tag is live, the script tag never becomes
    // an element, and nothing in the page throws.
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await stubOllama(
      page,
      ndjson({
        message: {
          content:
            "**Two jobs.**\n\n<script>window.__pwned = 1</script>\n\n[docs](https://ok.example/)",
        },
        done: true,
      }),
    );
    await openAsk(page);
    await newChat(page);
    const composer = page.getByRole("textbox", { name: "Enlighten!" });
    await composer.fill("Is this line doing too much?");
    await composer.press("Enter");

    await expect(page.locator(".msg-assistant .msg-body strong")).toHaveText(
      "Two jobs.",
    );
    await expect(page.locator(".msg-assistant script")).toHaveCount(0);
    expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
    const link = page.locator(".msg-assistant .dock-read a");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(link).toHaveAttribute("target", "_blank");
    expect(errors).toEqual([]);
  });

  test("Stop interrupts a hanging model and keeps the turn", async ({
    page,
  }) => {
    await stubOllama(page, null);
    await openAsk(page);
    await newChat(page);
    const composer = page.getByRole("textbox", { name: "Enlighten!" });
    await composer.fill("Wait for it");
    await composer.press("Enter");
    const stop = page.getByRole("button", { name: "Stop" });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(stop).toHaveCount(0);
    await expect(page.locator(".msg-assistant")).toBeVisible();
  });

  test("the model button lists models, and never opens AI settings", async ({
    page,
  }) => {
    // This button chooses a model, and the app's settings set one up.
    // One button that is two controls depending on state could
    // take a writer out of the conversation, so the row pins that the AI
    // settings sheet does not open.
    await stubOllama(page, ndjson({ message: { content: "ok" }, done: true }));
    await openAsk(page);
    await newChat(page);

    const control = page.getByRole("button", { name: "Model for this chat" });
    await expect(control).toHaveText(MODEL);
    await control.click();
    await expect(page.getByRole("menuitem", { name: MODEL })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI assistant" }),
    ).toHaveCount(0);
    // The project is still open behind it.
    await expect(page.locator(".editor p").first()).toBeAttached();
  });

  test("sets an answer at the chat's ramp, its headings above its text", async ({
    page,
  }) => {
    // The answer borrows the reference reader's classes, whose type is sized
    // for that reader's smaller body. The answer reads at the chat's own
    // size, and each heading stays above the text it introduces.
    await stubOllama(
      page,
      ndjson({
        message: { content: "# One\n\n## Two\n\n### Three\n\nThe text." },
        done: true,
      }),
    );
    await openAsk(page);
    await newChat(page);
    await send(page, "How is it shaped?");
    const answer = page.locator(".msg-assistant .dock-read");
    await expect(answer.locator("p")).toHaveText("The text.");

    const type = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            size: parseFloat(style.fontSize),
            leading: parseFloat(style.lineHeight),
          };
        });
    const text = await type(".msg-assistant .dock-read p");
    expect(text).toEqual(await type(".msg-assistant"));
    const h1 = await type(".msg-assistant .dock-read h1");
    const h2 = await type(".msg-assistant .dock-read h2");
    const h3 = await type(".msg-assistant .dock-read h3");
    expect(h1.size).toBeGreaterThan(h2.size);
    expect(h2.size).toBeGreaterThan(h3.size);
    expect(h3.size).toBeGreaterThanOrEqual(text.size);
  });

  test("gives an answer the whole width the writer dragged open", async ({
    page,
  }) => {
    // The dock is a drag handle, so a measure on the answer would override
    // the width the writer just chose and leave a band of empty panel. At a
    // wide dock the answer still meets both edges of the transcript.
    await stubOllama(
      page,
      ndjson({ message: { content: "Short, and set wide." }, done: true }),
    );
    await openAsk(page);
    await newChat(page);
    await send(page, "How wide is it?");
    await expect(page.locator(".msg-assistant .msg-body")).toContainText(
      "set wide.",
    );
    await widenDock(page, 760);
    await stableBox(page, ".ed-dock");

    const read = await page.locator(".ai-messages").evaluate((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const left = box.left + el.clientLeft + parseFloat(style.paddingLeft);
      const width =
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const answer = el
        .querySelector(".msg-assistant .msg-body")!
        .getBoundingClientRect();
      return {
        left,
        width,
        answer: { left: answer.left, width: answer.width },
      };
    });
    expect(read.width).toBeGreaterThan(600);
    expect(Math.abs(read.answer.left - read.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(read.answer.width - read.width)).toBeLessThanOrEqual(0.5);
  });

  test("sizes a question to its words, capped against the transcript, on the writer's side", async ({
    page,
  }) => {
    // The writer's words sit on one side and the answers on the other, so
    // the column's shape says who is speaking. The cap is a share of the
    // transcript, which the dock's drag resizes, so it holds at any width. An
    // unbroken token wraps inside the cap, and a Shift+Enter break is kept.
    await stubOllama(page, ndjson({ message: { content: "ok" }, done: true }));
    await openAsk(page);
    await newChat(page);
    await widenDock(page, 600);
    await stableBox(page, ".ed-dock");
    const questions = [
      "Short?",
      `https://example.org/${"a".repeat(240)}`,
      "One line\nand the next",
    ];
    for (const [i, question] of questions.entries()) {
      await send(page, question);
      await expect(page.locator(".msg-assistant")).toHaveCount(i + 1);
      await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
    }

    const read = await page.locator(".ai-messages").evaluate((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const left = box.left + el.clientLeft + parseFloat(style.paddingLeft);
      const width =
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const bubbles = [...el.querySelectorAll(".msg-you .msg-body")].map(
        (body) => {
          const rect = body.getBoundingClientRect();
          const css = getComputedStyle(body);
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            lines:
              (body.clientHeight -
                parseFloat(css.paddingTop) -
                parseFloat(css.paddingBottom)) /
              parseFloat(css.lineHeight),
            spills: body.scrollWidth > body.clientWidth,
          };
        },
      );
      return { left, right: left + width, width, bubbles };
    });
    const [short, token, broken] = read.bubbles;
    for (const bubble of read.bubbles) {
      expect(Math.abs(bubble.right - read.right)).toBeLessThanOrEqual(0.5);
      expect(bubble.spills).toBe(false);
    }
    expect(short!.width).toBeLessThan(read.width * 0.5);
    expect(Math.round(short!.lines)).toBe(1);
    expect(Math.abs(token!.width - read.width * 0.9)).toBeLessThanOrEqual(1);
    expect(token!.lines).toBeGreaterThan(1.5);
    expect(broken!.width).toBeLessThan(read.width * 0.9);
    expect(Math.round(broken!.lines)).toBe(2);
  });

  test("lays out an answer's bold-only item as any other item", async ({
    page,
  }) => {
    // A reference template reads a bold-only item as a form's question: no
    // bullet, out past the list's edge, a heading's gap above it. In an
    // answer it is a model writing `- **tired**`, and stays an item.
    await stubOllama(
      page,
      ndjson({
        message: {
          content: "- tired\n- worn\n\nOr:\n\n- **tired**\n- **worn**",
        },
        done: true,
      }),
    );
    await openAsk(page);
    await newChat(page);
    await send(page, "Which word?");
    const lists = page.locator(".msg-assistant .dock-read ul");
    await expect(lists).toHaveCount(2);
    await expect(lists.nth(1).locator("strong")).toHaveCount(2);

    const items = (nth: number) =>
      lists.nth(nth).evaluate((list) => {
        const [first, second] = [...list.children].map((item) =>
          item.getBoundingClientRect(),
        );
        return {
          indent: first!.left - list.getBoundingClientRect().left,
          gap: second!.top - first!.bottom,
          markers: [...list.children].map(
            (item) => getComputedStyle(item).listStyleType,
          ),
        };
      });
    const plain = await items(0);
    const bold = await items(1);
    expect(plain.indent).toBeGreaterThan(0);
    // A model answers in lists, and items with nothing between them arrive as
    // one slab, so an answer's items stand apart.
    expect(plain.gap).toBeGreaterThan(0);
    expect(bold.indent).toBeCloseTo(plain.indent, 1);
    expect(bold.gap).toBeCloseTo(plain.gap, 1);
    expect(bold.markers).toEqual(plain.markers);
  });

  test("holds the live line in an answer to one line, cutting only its words", async ({
    page,
  }) => {
    // The line sits right above the composer while the transcript follows
    // the stream, so a line that wrapped would push the prose. A long model
    // name makes the words wider than the dock's floor holds.
    await stubOllama(page, null, LONG_MODEL);
    await openAsk(page);
    await newChat(page, LONG_MODEL);
    await send(page, "Wait for it");
    const line = page.locator(".msg-assistant .ai-activity");
    await expect(line.locator(".ai-activity-label")).toContainText(LONG_MODEL);

    const read = await line.evaluate((el) => {
      const part = (selector: string) => {
        const node = el.querySelector(selector)!;
        return {
          box: node.getBoundingClientRect(),
          cut: node.scrollWidth > node.clientWidth,
        };
      };
      return {
        line: el.getBoundingClientRect(),
        leading: parseFloat(getComputedStyle(el).lineHeight),
        label: part(".ai-activity-label"),
        ends: getComputedStyle(el.querySelector(".ai-activity-label")!)
          .textOverflow,
        dots: part(".ui-dots"),
        clock: part(".ai-elapsed"),
      };
    });
    expect(read.line.height).toBeLessThan(read.leading * 1.5);
    expect(read.label.cut).toBe(true);
    expect(read.ends).toBe("ellipsis");
    expect(read.dots.cut).toBe(false);
    expect(read.clock.cut).toBe(false);
    expect(read.clock.box.right).toBeLessThanOrEqual(read.line.right + 0.5);
  });

  test("holds two lines for a run's words when no answer here holds them", async ({
    page,
  }) => {
    // A run with no turn in the open chat says what it is doing on a line
    // under the transcript. Its words change every few seconds and wrap at a
    // narrow dock, so the line holds two lines whether or not the second is
    // used, and the transcript above it does not move as they change.
    await stubOllama(page, null);
    await openAsk(page);
    await newChat(page);
    await send(page, "Wait for it");
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    // A second chat: the run goes on in the first, and no turn here holds
    // its line.
    await page.getByRole("button", { name: "New chat" }).click();
    await page.getByRole("menuitem").first().click();
    const line = page.locator(".ai-activity-row .ai-activity");
    await expect(line.locator(".ai-activity-label")).toBeVisible();

    const read = await line.evaluate((el) => ({
      line: el.getBoundingClientRect().height,
      words: el.querySelector(".ai-activity-label")!.getBoundingClientRect()
        .height,
      leading: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(read.words).toBeLessThan(read.leading * 1.5);
    expect(read.line).toBeCloseTo(2 * read.leading, 0);
  });

  test("names a long model in full and on one line", async ({ page }) => {
    // The tail of a model id is where its size lives, so a cut id names a
    // model nobody has. Where the bar has room for it, a long id shows whole.
    await stubOllama(
      page,
      ndjson({ message: { content: "ok" }, done: true }),
      LONG_MODEL,
    );
    await openAsk(page);
    await newChat(page, LONG_MODEL);
    await widenDock(page, 560);
    await expect(page.locator(".ai-model-name")).toBeVisible();

    const read = await page.locator(".ai-chatbar").evaluate((bar) => {
      const control = bar.querySelector(".ai-model-button")!;
      const name = control.querySelector(".ai-model-name")!;
      return {
        bar: bar.getBoundingClientRect(),
        control: control.getBoundingClientRect(),
        controlCut: control.scrollWidth > control.clientWidth,
        name: name.getBoundingClientRect(),
        nameCut: name.scrollWidth > name.clientWidth,
        size: parseFloat(getComputedStyle(name).fontSize),
      };
    });
    expect(read.nameCut).toBe(false);
    expect(read.controlCut).toBe(false);
    expect(read.name.height).toBeLessThan(read.size * 2);
    expect(read.control.right).toBeLessThanOrEqual(read.bar.right + 0.5);
  });

  test("never draws the Mode over a long model's button", async ({ page }) => {
    // How long the name is decides where it gives way, so the switch to
    // "model" is measured. A switch at a fixed width let the Mode's box shrink
    // below its captions, and "Standard" was painted over the name. A reading
    // on the bar takes room too, so the widths are walked with and without.
    await stubOllama(
      page,
      ndjson({
        message: { content: "ok" },
        done: true,
        prompt_eval_count: 9,
        eval_count: 4,
      }),
      LONG_MODEL,
    );
    await openAsk(page);
    await newChat(page, LONG_MODEL);

    const walk = async (with_: string) => {
      for (const width of [440, 460, 480, 500, 520, 560, 720]) {
        await widenDock(page, width);
        await stableBox(page, ".ai-model-button");
        const read = await page.locator(".ai-chatbar").evaluate((bar) => {
          const box = (sel: string) =>
            bar.querySelector(sel)!.getBoundingClientRect();
          const ends = [...bar.querySelectorAll(".ai-mode-end")];
          return {
            bar: bar.getBoundingClientRect().right,
            mode: box(".ai-mode"),
            standard: ends[ends.length - 1].getBoundingClientRect(),
            control: box(".ai-model-button"),
          };
        });
        const at = `dock ${width}, ${with_}`;
        expect(read.standard.right, at).toBeLessThanOrEqual(
          read.mode.right + 0.5,
        );
        expect(read.standard.right, at).toBeLessThanOrEqual(read.control.left);
        expect(read.control.right, at).toBeLessThanOrEqual(read.bar + 0.5);
      }
    };
    await walk("no reading");
    await send(page, "Is this line doing too much?");
    await expect(page.locator(".ai-chatbar .ai-reading").first()).toBeVisible();
    await walk("a reading");
  });

  test("keeps the last message and the jump button clear of the asking stack", async ({
    page,
  }) => {
    // The asking stack floats over the transcript's foot. The scroller's
    // bottom padding lets the last message scroll out from under it, and
    // lifts the sticky jump button to sit 8px above it, centred on the
    // transcript.
    await stubOllama(
      page,
      ndjson({
        message: {
          content: Array.from({ length: 40 }, (_, i) => `Line ${i}.`).join(
            "\n\n",
          ),
        },
        done: true,
      }),
    );
    await openAsk(page);
    await newChat(page);
    await send(page, "A long one, please.");
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
    const messages = page.locator(".ai-messages");

    // The stack grows once the answer lands, and the padding follows it, so
    // the end of the transcript is read after the stack has settled.
    const asking = await stableBox(page, ".ai-asking");
    // The transcript is not shortened to make room for the stack: it keeps
    // the stage's whole height and runs on beneath it.
    const floor = await page.locator(".ai-stage").evaluate((stage) => {
      const bottom = (el: Element) => el.getBoundingClientRect().bottom;
      return {
        stage: bottom(stage),
        messages: bottom(stage.querySelector(".ai-messages")!),
        asking: bottom(stage.querySelector(".ai-asking")!),
      };
    });
    expect(Math.abs(floor.messages - floor.stage)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(floor.asking - floor.stage)).toBeLessThanOrEqual(0.5);
    const clearance = await messages.evaluate(async (el, top) => {
      el.scrollTo(0, el.scrollHeight);
      await new Promise((done) => requestAnimationFrame(done));
      const last = [...el.querySelectorAll(".msg")].pop()!;
      return top - last.getBoundingClientRect().bottom;
    }, asking.y);
    expect(clearance).toBeGreaterThanOrEqual(0);

    await messages.evaluate((el) => el.scrollTo(0, 0));
    await expect(page.locator(".ai-jump")).toBeVisible();
    const jump = await stableBox(page, ".ai-jump");
    const stack = await stableBox(page, ".ai-asking");
    expect(Math.abs(jump.y + jump.height - (stack.y - 8))).toBeLessThanOrEqual(
      1,
    );
    const middle = await messages.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.left + el.clientLeft + el.clientWidth / 2;
    });
    expect(Math.abs(jump.x + jump.width / 2 - middle)).toBeLessThanOrEqual(1);
  });

  test("grows the composer with its question, with nothing scrolled out of it", async ({
    page,
  }) => {
    // No ceiling and no scrollbar: a scroll track in the field draws as a
    // number stepper on Windows and hides the writer's own sentence.
    await stubOllama(page, ndjson({ message: { content: "ok" }, done: true }));
    await openAsk(page);
    await newChat(page);
    const composer = page.getByRole("textbox", { name: "Enlighten!" });
    await composer.fill(
      Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join("\n"),
    );
    const read = () =>
      composer.evaluate((el) => ({
        height: el.clientHeight,
        scroll: el.scrollHeight,
        leading: parseFloat(getComputedStyle(el).lineHeight),
      }));
    await expect
      .poll(async () => {
        const field = await read();
        return field.height >= 10 * field.leading;
      })
      .toBe(true);
    const field = await read();
    expect(field.scroll).toBeLessThanOrEqual(field.height);
  });

  test("gives the question the whole row, and keeps the field's height when the caret arrives", async ({
    page,
  }) => {
    // Nothing stands beside the field: the row keeps the 14px gutter and the
    // pill fills the rest, so the question has the panel's width at the
    // dock's floor. A field that grew on focus would offer room for a
    // question not yet asked.
    await stubOllama(page, ndjson({ message: { content: "ok" }, done: true }));
    await openAsk(page);
    await newChat(page);

    const row = await page.locator(".ai-composer-row").evaluate((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const pill = el.querySelector(".composer")!.getBoundingClientRect();
      return {
        left: box.left + parseFloat(style.paddingLeft),
        right: box.right - parseFloat(style.paddingRight),
        gutters: [style.paddingLeft, style.paddingRight],
        pill: { left: pill.left, right: pill.right },
      };
    });
    expect(row.gutters).toEqual(["14px", "14px"]);
    expect(Math.abs(row.pill.left - row.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(row.pill.right - row.right)).toBeLessThanOrEqual(0.5);

    const composer = page.getByRole("textbox", { name: "Enlighten!" });
    await composer.blur();
    await page.mouse.move(0, 0);
    const resting = await stableBox(page, ".composer textarea");
    await composer.focus();
    await expect(composer).toBeFocused();
    const focused = await stableBox(page, ".composer textarea");
    expect(focused.height).toBe(resting.height);
  });

  test("centres the composer's buttons on one line, and keeps them on the last as it grows", async ({
    page,
  }) => {
    // The resting row is taller than the 30px buttons, so bottom-aligning
    // them there would leave room above and none below. Once the field
    // grows, the buttons stay with the line being written.
    await stubOllama(page, ndjson({ message: { content: "ok" }, done: true }));
    await openAsk(page);
    await newChat(page);
    const composer = page.getByRole("textbox", { name: "Enlighten!" });
    const read = () =>
      page.locator(".composer").evaluate((pill) => {
        const box = (selector: string) => {
          const rect = pill.querySelector(selector)!.getBoundingClientRect();
          return { middle: rect.top + rect.height / 2, bottom: rect.bottom };
        };
        return {
          field: box("textarea"),
          menu: box(".ai-composer-menu"),
          send: box(".ai-stop"),
        };
      });

    await expect(page.locator(".composer")).toHaveAttribute("data-grown", "0");
    await stableBox(page, ".composer textarea");
    const resting = await read();
    for (const button of [resting.menu, resting.send]) {
      expect(
        Math.abs(button.middle - resting.field.middle),
      ).toBeLessThanOrEqual(0.5);
    }

    await composer.fill("One\nTwo\nThree\nFour");
    await expect(page.locator(".composer")).toHaveAttribute("data-grown", "1");
    await stableBox(page, ".composer textarea");
    const grown = await read();
    for (const button of [grown.menu, grown.send]) {
      expect(Math.abs(button.bottom - grown.field.bottom)).toBeLessThanOrEqual(
        0.5,
      );
    }
  });

  test("rings the new-chat button and Stop when the keyboard lands on them", async ({
    page,
  }) => {
    // A hover with no focus state shows to a pointer and hides from the
    // keyboard that has just landed on the button.
    await stubOllama(page, null);
    await openAsk(page);
    await newChat(page);
    await send(page, "Wait for it");
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

    const tabTo = async (selector: string) => {
      for (let i = 0; i < 80; i++) {
        if (
          await page.evaluate(
            (sel) => document.activeElement?.matches(sel) ?? false,
            selector,
          )
        )
          return;
        await page.keyboard.press("Tab");
      }
      throw new Error(`Tab never reaches ${selector}`);
    };
    const ring = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          outline:
            style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
          shadow: style.boxShadow !== "none",
        };
      });
    for (const selector of [".ai-new-chat", ".ai-stop"]) {
      await tabTo(selector);
      const drawn = await ring(selector);
      expect(drawn.outline || drawn.shadow, selector).toBe(true);
    }
  });

  test("keeps the chat bar to one line at the dock's floor", async ({
    page,
  }) => {
    // The bar holds the readings, the Mode and the model's button. As the dock
    // narrows they give way in that order rather than wrapping, so the
    // composer above never moves as the bar fills. A long model and a
    // reading make the floor the hardest width.
    await stubOllama(
      page,
      ndjson({
        message: { content: "ok" },
        done: true,
        prompt_eval_count: 9,
        eval_count: 4,
      }),
      LONG_MODEL,
    );
    await openAsk(page);
    await newChat(page, LONG_MODEL);
    await send(page, "Is this line doing too much?");
    await expect(page.locator(".ai-chatbar .ai-reading").first()).toBeVisible();
    await stableBox(page, ".ai-model-button");

    const read = await page.locator(".ai-chatbar").evaluate((bar) => {
      const parts = [
        ...bar.querySelectorAll(".ai-reading, .ai-mode, .ai-model-button"),
      ].map((el) => el.getBoundingClientRect());
      const style = getComputedStyle(bar);
      return {
        width: bar.getBoundingClientRect().width,
        parts: parts.length,
        lowestTop: Math.max(...parts.map((part) => part.top)),
        highestBottom: Math.min(...parts.map((part) => part.bottom)),
        tallest: Math.max(...parts.map((part) => part.height)),
        inner:
          bar.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom),
      };
    });
    expect(read.width).toBeLessThan(360);
    expect(read.parts).toBeGreaterThanOrEqual(3);
    expect(read.lowestTop).toBeLessThan(read.highestBottom);
    expect(read.inner).toBeLessThanOrEqual(read.tallest + 0.5);
  });

  test("cuts a long chat name in the head and in the chats list, never sideways", async ({
    page,
  }) => {
    // In the head the name takes at most 60% of the row, so at a wide dock
    // a long name does not become the whole line, and the ellipsis is on the
    // text inside the button. In the list a row gives way to its actions
    // button, so the list never scrolls sideways.
    await stubOllama(page, ndjson({ message: { content: "ok" }, done: true }));
    await openAsk(page);
    await newChat(page);
    await widenDock(page, 760);
    await page.getByLabel("Chats").click();
    await page.locator(".ai-switcher-more").first().click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const rename = page.locator(".ai-rename");
    await rename.getByLabel("Chat title").fill(LONG_TITLE);
    await rename.getByRole("button", { name: "Save" }).click();

    const list = page.locator(".ai-switcher-list");
    await expect(list).toContainText(LONG_TITLE);
    const rows = await list.evaluate((el) => {
      const right =
        el.getBoundingClientRect().left + el.clientLeft + el.clientWidth;
      return {
        sideways: el.scrollWidth > el.clientWidth,
        controls: [...el.querySelectorAll(".ai-switcher-more")].map(
          (control) => control.getBoundingClientRect().right - right,
        ),
      };
    });
    expect(rows.sideways).toBe(false);
    for (const past of rows.controls) expect(past).toBeLessThanOrEqual(0.5);
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);

    const head = await page.locator(".ai-chathead").evaluate((el) => {
      const style = getComputedStyle(el);
      const text = el.querySelector(".ai-chat-title-text")!;
      return {
        room:
          el.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        title: el.querySelector(".ai-chat-title")!.getBoundingClientRect()
          .width,
        cut: text.scrollWidth > text.clientWidth,
        ends: getComputedStyle(text).textOverflow,
      };
    });
    expect(head.title).toBeLessThanOrEqual(head.room * 0.6 + 0.5);
    expect(head.cut).toBe(true);
    expect(head.ends).toBe("ellipsis");
  });

  test("keeps each chat's draft while switching", async ({ page }) => {
    await stubOllama(page, ndjson({ message: { content: "ok" }, done: true }));
    await openAsk(page);
    await newChat(page);
    const composer = page.getByRole("textbox", { name: "Enlighten!" });
    await composer.fill("draft one");
    await newChat(page);
    await expect(composer).toHaveValue("");
    await composer.fill("draft two");
    await page.getByLabel("Chats").click();
    // A new chat is named for its kind; the open one is listed first, so the
    // last of the two is the chat holding the first draft.
    await page
      .locator(".ai-switcher-row .ai-switcher-open", {
        hasText: en.dock.chatKind.general,
      })
      .last()
      .click();
    await expect(composer).toHaveValue("draft one");
  });

  test("sets the drafting room's first question on the composer's gutter", async ({
    page,
  }) => {
    // The question is a group above the field, not one of the quiet lines,
    // so the rule that insets those does not reach it. Its words and its
    // buttons start and end where the chat bar's and the composer row's do.
    await stubOllama(page, null);
    await openAsk(page);
    const emptyNewChat = page.locator(".ai-empty button", {
      hasText: "New chat",
    });
    if ((await emptyNewChat.count()) > 0) await emptyNewChat.first().click();
    else await page.getByRole("button", { name: "New chat" }).click();
    await page.getByRole("menuitem", { name: "Drafting" }).click();
    await expect(page.locator(".ai-need")).toBeVisible();

    const gutters = await page.locator(".ai-asking").evaluate((asking) => {
      const inner = (el: Element) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          left:
            box.left +
            parseFloat(style.borderLeftWidth) +
            parseFloat(style.paddingLeft),
          right:
            box.right -
            parseFloat(style.borderRightWidth) -
            parseFloat(style.paddingRight),
        };
      };
      const edges = (selector: string) => {
        const found = asking.querySelectorAll(selector);
        if (found.length === 0) throw new Error(`no ${selector}`);
        return [...found].map((el) => {
          const box = el.getBoundingClientRect();
          return { left: box.left, right: box.right };
        });
      };
      return {
        bar: inner(asking.querySelector(":scope > .ai-chatbar")!),
        row: inner(asking.querySelector(":scope > .ai-composer-row")!),
        question: edges(".ai-need > *"),
      };
    });

    expect(gutters.question.length).toBeGreaterThanOrEqual(2);
    expect(gutters.row).toEqual(gutters.bar);
    for (const line of gutters.question) {
      expect(Math.abs(line.left - gutters.row.left)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(line.right - gutters.row.right)).toBeLessThanOrEqual(0.5);
    }
  });

  test("shows a turn's facts to the keyboard, not only to a pointer", async ({
    page,
  }) => {
    // Under a mouse the facts wait for a hover. A keyboard that lands in the
    // answer has no hover, so focus inside the turn shows them too.
    await stubOllama(page, ANSWER_WITH_FACTS);
    await openAsk(page);
    await newChat(page);
    await send(page, "Is this line doing too much?");
    const meta = page.locator(".msg-assistant .ai-turn-meta");
    await expect(meta).toBeAttached();
    await page.mouse.move(0, 0);
    await expect(meta).toHaveCSS("opacity", "0");

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Shift+Tab");
      if (
        await page.evaluate(
          () => !!document.activeElement?.closest(".msg-assistant"),
        )
      )
        break;
    }
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest(".msg-assistant"),
      ),
    ).toBe(true);
    await expect(meta).toHaveCSS("opacity", "1");
  });

  test("keeps an open turn's facts lit with no hover and no focus", async ({
    page,
  }) => {
    // A control that fades while its contents are on screen reads as
    // belonging to something else, so an open footer stays lit after the
    // pointer and the focus have both left it.
    await stubOllama(page, ANSWER_WITH_FACTS);
    await openAsk(page);
    await newChat(page);
    await send(page, "Is this line doing too much?");
    const meta = page.locator(".msg-assistant details.ai-turn-meta");
    await meta.locator("> summary").click();
    await expect(meta).toHaveAttribute("open", "");
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.mouse.move(0, 0);
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest(".msg-assistant"),
      ),
    ).toBe(false);
    await expect(meta).toHaveCSS("opacity", "1");
  });
});

// ── The gap under a question ─────────────────────────────────────────────────
//
// Under a question sits one held row, then 8px, so a question sits closer to
// its own answer than that answer to the next question and the pair reads as
// one turn. Two facts are pinned where layout is real:
//
// - The row is held. A run withdraws the pencil and the row keeps its
//   height, so the answer above does not move. Under a coarse pointer the
//   pencil is the 44px tap floor, which is why both pointers are measured.
// - The pairing: question to answer is smaller than answer to next question.
//   The answer ends at its last visible line. Under a mouse the footer is
//   invisible at rest; under touch the `(hover: none)` rule shows it, so
//   there the answer ends at its footer.
//
// Gaps are measured inside the transcript, a top minus a bottom, so a
// transcript that scrolls to follow the new question cannot move them.
async function measureTurnGaps(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await stubOllama(
    page,
    ndjson({ message: { content: "An answer." }, done: true }),
  );
  await openAsk(page);
  await newChat(page);
  const composer = page.getByRole("textbox", { name: "Enlighten!" });
  await composer.fill("First question?");
  await composer.press("Enter");
  await expect(page.locator(".msg-assistant .msg-body")).toContainText(
    "An answer.",
  );
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  const inside = async () => {
    const question = await stableBox(page, ".msg-you .msg-body");
    const answer = await stableBox(page, ".msg-assistant");
    return answer.y - (question.y + question.height);
  };
  const atRest = await inside();

  // The next answer never comes, so the run, and the withdrawn pencil, lasts
  // as long as the measurement needs.
  await page.unroute("http://localhost:11434/api/chat");
  await stubOllama(page, null);
  await composer.fill("Second question?");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  const running = await inside();

  const footer = page.locator(".msg-assistant .ai-turn-meta").first();
  const footerShown =
    (await footer.evaluate((el) => getComputedStyle(el).opacity)) !== "0";
  const last = await stableBox(
    page,
    footerShown ? ".msg-assistant .ai-turn-meta" : ".msg-assistant .msg-body",
  );
  const next = await stableBox(page, ".msg-assistant + .msg-you .msg-body");
  const between = next.y - (last.y + last.height);
  return { atRest, running, between };
}

test.describe("the gap under a question, under a mouse", () => {
  test.beforeEach(async ({ browserName }) => {
    skipWithoutLocalFolders(browserName);
  });

  test("holds while a run goes, and pairs the question with its answer", async ({
    page,
  }) => {
    const { atRest, running, between } = await measureTurnGaps(page);
    expect(running).toBe(atRest);
    expect(atRest).toBeLessThan(between);
  });
});

test.describe("the gap under a question, under a touch pointer", () => {
  test.use({ hasTouch: true });

  test.beforeEach(async ({ browserName }) => {
    skipWithoutLocalFolders(browserName);
  });

  test("a run starting does not move the answer above it", async ({ page }) => {
    const { atRest, running } = await measureTurnGaps(page);
    expect(running).toBe(atRest);
  });

  test("shows a turn's facts at rest, with no hover to summon them", async ({
    page,
  }) => {
    // A thumb cannot hover, so the facts a mouse finds on hover are present
    // from the start.
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubOllama(page, ANSWER_WITH_FACTS);
    await openAsk(page);
    await newChat(page);
    await send(page, "Is this line doing too much?");
    const meta = page.locator(".msg-assistant .ai-turn-meta");
    await expect(meta).toBeAttached();
    await page.mouse.move(0, 0);
    await expect(meta).toHaveCSS("opacity", "1");
  });

  // The pencil sits beside the bubble here, not in a 44px row under it, so
  // the question stays nearer its own answer than the previous one.
  test("pairs the question with its answer", async ({ page }) => {
    const { atRest, between } = await measureTurnGaps(page);
    expect(atRest).toBeLessThan(between);
  });
});
