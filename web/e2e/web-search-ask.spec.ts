// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Searches wait on the writer ──────────────────────────────────────────────
//
// The ask is where a query leaves the machine, so its guarantees are pinned
// where layout, focus, timers and clicks are real. Nothing is sent
// until the writer presses Search on an ask visible for its arming window;
// the writer's edit is what leaves; Don't search sends nothing; the Ask buttons
// bring a writer with the dock shut to the ask without letting the opening
// press land on Search; a slowed search waits visibly before its Retry.
//
// Two stand-ins, both at the network edge: `page.route` answers for the
// writer's Ollama (a model that proposes one search, then answers) and for
// Wikipedia's search API, which the browser calls directly, so nothing reaches
// Wikipedia. What reaches the search URL is the evidence, because it is the
// one place a query leaves.

import { expect, test, type Page, type Request } from "@playwright/test";
import {
  openSignedInProject,
  skipWithoutLocalFolders,
} from "./signedInProject";
import { stableBox } from "./probe";
import { QUERY_MAX } from "../src/ai/domain/webText";
import en from "../src/locales/en.json" with { type: "json" };
import it from "../src/locales/it.json" with { type: "json" };

const MODEL = "e2e:latest";
const PROPOSED = "Capture of Rome 1870";
// The book is in English, so the search goes to the English edition.
const SEARCH_ROUTE = (url: URL) =>
  url.hostname === "en.wikipedia.org" &&
  url.pathname === "/w/rest.php/v1/search/page";

function ndjson(...records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

/**
 * A model that proposes its searches, one by default, then answers once it
 * has results. `proposals` and `context` serve the several-search ask;
 * the single-search rows take the defaults. The default window is
 * the app's own (`DEFAULT_CONTEXT_TOKENS`): a smaller one cannot hold the
 * assistant's instructions and evidence, and the run is refused before it
 * starts (`limitsFor`).
 */
async function stubModel(
  page: Page,
  answer = "Rome was taken in September 1870.",
  { proposals = [PROPOSED], context = 16_384 } = {},
) {
  await page.route("http://localhost:11434/api/tags", (route) =>
    route.fulfill({
      json: { models: [{ name: MODEL, digest: "e2e-digest" }] },
    }),
  );
  await page.route("http://localhost:11434/api/show", (route) =>
    route.fulfill({
      json: {
        capabilities: ["completion", "tools"],
        model_info: { "llama.context_length": context },
      },
    }),
  );
  await page.route("http://localhost:11434/api/chat", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      messages?: Array<{ role: string }>;
    };
    const answered = body.messages?.some((one) => one.role === "tool");
    return route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: answered
        ? ndjson({ message: { content: answer }, done: true })
        : ndjson({
            message: {
              content: "",
              tool_calls: proposals.map((query) => ({
                function: { name: "web_search", arguments: { query } },
              })),
            },
            done: true,
          }),
    });
  });
}

/** Wikipedia's search, answering or refusing; records every call. */
async function stubSearch(
  page: Page,
  answer: (call: number) => {
    status: number;
    headers?: Record<string, string>;
    json: object;
  },
) {
  const calls: Request[] = [];
  await page.route(SEARCH_ROUTE, (route) => {
    calls.push(route.request());
    const { status, headers, json } = answer(calls.length);
    return route.fulfill({
      status,
      // A cross-origin answer shows its `Retry-After` to the page only when
      // the header is exposed.
      headers: { "Access-Control-Expose-Headers": "Retry-After", ...headers },
      json,
    });
  });
  return calls;
}

/** One page found, in the shape the search API answers with. */
const FOUND_PAGE = {
  id: 1,
  key: "Capture_of_Rome",
  title: "Capture of Rome",
  excerpt: "The capture of Rome on 20 September 1870 ended the Papal States.",
};

const FOUND = { status: 200, json: { pages: [FOUND_PAGE] } };

/** The query a search carried, from its URL. */
const queryOf = (call: Request | undefined) =>
  call ? new URL(call.url()).searchParams.get("q") : undefined;

/**
 * Stops the page's `Date` where it stands, with the timers still running, and
 * answers that instant. The ask's arming reads `Date.now`, so a press after
 * this lands inside the arming window however long the click takes to arrive
 * on a loaded machine.
 */
async function freezeDate(page: Page): Promise<number> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(now);
  return now;
}

/**
 * Moves the page's clock past the ask's arming window (`ASK_ARM_MS`,
 * 500 ms), so the next press is armed without waiting the window out:
 * arming has no visible state to wait on.
 *
 * The window restarts whenever the ask's actions come into view, which an
 * intersection observer reports. The clock moves only once a fresh observer
 * sees them in view: observers report in the order they were made, so the
 * ask's own report, and its restart, has run by then.
 */
async function pastArming(page: Page): Promise<void> {
  const now = await page.evaluate(
    () =>
      new Promise<number>((done, fail) => {
        const actions = document.querySelector(".ai-ask .ai-finding-actions");
        if (!actions) return fail(new Error("pastArming: no ask on the page"));
        const observer = new IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          done(Date.now());
        });
        observer.observe(actions);
      }),
  );
  await page.clock.setSystemTime(now + 700);
}

async function askAQuestion(
  page: Page,
  line = "When was Rome taken?",
  beforeSend: () => Promise<unknown> = async () => {},
) {
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Enlighten!" })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  const emptyNewChat = page.locator(".ai-empty button", {
    hasText: "New chat",
  });
  if ((await emptyNewChat.count()) > 0) await emptyNewChat.first().click();
  else await page.getByRole("button", { name: "New chat" }).click();
  await page.getByRole("menuitem").first().click();
  // The model button's title is the chat's chosen model. A choice is saved with
  // the chat before a question can go to it, so the question waits for the
  // title.
  const control = page.getByRole("button", { name: "Model for this chat" });
  await expect(control).toBeVisible();
  if ((await control.getAttribute("title")) !== MODEL) {
    await control.click();
    await page.getByRole("menuitem", { name: MODEL }).click();
  }
  await expect(control).toHaveAttribute("title", MODEL);
  const composer = page.getByRole("textbox", { name: "Enlighten!" });
  await composer.fill(line);
  await beforeSend();
  await composer.press("Enter");
  return page.locator(".ai-ask");
}

test.describe("the web search ask", () => {
  test.beforeEach(async ({ page, browserName }) => {
    skipWithoutLocalFolders(browserName);
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubModel(page);
    await openSignedInProject(page);
  });

  test("sends nothing until an armed Search, and sends the writer's edit", async ({
    page,
  }) => {
    const calls = await stubSearch(page, () => FOUND);
    let frozen = 0;
    const ask = await askAQuestion(page, undefined, async () => {
      frozen = await freezeDate(page);
    });
    await expect(ask).toBeVisible();
    const field = ask.getByRole("textbox", { name: "Search Wikipedia for" });
    await expect(field).toHaveValue(PROPOSED);
    // The ask takes no focus on arrival.
    await expect(field).not.toBeFocused();

    // A press inside the arming window is dropped, never queued: the ask
    // stays, and once the armed search below is answered it is the only one
    // that left.
    await ask.getByRole("button", { name: "Search", exact: true }).click();
    await expect(field).toHaveValue(PROPOSED);

    // Past the arming window: its 500 ms plus a margin.
    await page.clock.setFixedTime(frozen + 700);
    await field.fill("Breach of Porta Pia");
    await ask.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".ai-ask")).toHaveCount(0);
    await expect(
      page.getByText("Rome was taken in September 1870."),
    ).toBeVisible();
    expect(calls.map(queryOf)).toEqual(["Breach of Porta Pia"]);
    // The trace keeps the attempt: the engine and the quoted query.
    await page.locator(".ai-trace summary").last().click();
    const row = page.locator(".ai-trace-row.is-web").last();
    await expect(row).toContainText("Searched Wikipedia for");
    await expect(row.locator("q bdi")).toHaveText("Breach of Porta Pia");
    // The trace flows at its full height: no box scrolls inside the
    // transcript's own scroll, which does the following.
    const trace = page.locator(".ai-trace").last();
    const boxes = await trace
      .locator(".ai-trace-body, .ai-trace-thought")
      .evaluateAll((els) =>
        els.map((el) => {
          const css = getComputedStyle(el);
          return {
            maxHeight: css.maxHeight,
            overflowY: css.overflowY,
            fits: el.scrollHeight <= el.clientHeight,
          };
        }),
      );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes)
      expect(box).toEqual({
        maxHeight: "none",
        overflowY: "visible",
        fits: true,
      });
  });

  test("Don't search sends nothing, and the foot says so", async ({ page }) => {
    const calls = await stubSearch(page, () => FOUND);
    const ask = await askAQuestion(page);
    await ask.getByRole("button", { name: "Don't search" }).click();
    await expect(
      page.getByText("Rome was taken in September 1870."),
    ).toBeVisible();
    expect(calls).toHaveLength(0);
    await expect(page.locator(".ai-turn-facts").last()).toContainText(
      "Answered without a web search",
    );
  });

  test("the bar's Ask button brings a writer with the dock shut to an unarmed ask", async ({
    page,
  }) => {
    const calls = await stubSearch(page, () => FOUND);
    const ask = await askAQuestion(page);
    await expect(ask).toBeVisible();
    await page.getByRole("button", { name: "Close" }).first().click();
    await expect(page.locator(".ed-dock")).not.toHaveAttribute(
      "data-open",
      "1",
    );

    const control = page.locator(".bar-stack").getByRole("button", {
      name: "Enlighten! — a search is waiting for you",
    });
    await expect(control).toHaveAttribute("data-attention", "1");
    const frozen = await freezeDate(page);
    await control.click();
    await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
    // The press straight after the reveal lands inside the arming window and
    // sends nothing.
    const search = page
      .locator(".ai-ask")
      .getByRole("button", { name: "Search", exact: true });
    await search.click();
    await expect(search).toBeVisible();
    // The Ask button is plain again: the face is in view.
    await expect(
      page.locator(".bar-stack").getByRole("button", { name: "Enlighten!" }),
    ).not.toHaveAttribute("data-attention", "1");
    // Pressed again once armed, the ask sends one search. Once it is
    // answered, it is the only one that left, so the first press sent
    // nothing and queued nothing.
    await page.clock.setFixedTime(frozen + 700);
    await search.click();
    await expect(
      page.getByText("Rome was taken in September 1870."),
    ).toBeVisible();
    expect(calls.map(queryOf)).toEqual([PROPOSED]);
  });

  test("a slowed search waits, visibly, then retries the same query", async ({
    page,
  }) => {
    const calls = await stubSearch(page, (call) =>
      call === 1
        ? {
            status: 429,
            headers: { "Retry-After": "2" },
            json: { httpCode: 429 },
          }
        : FOUND,
    );
    const ask = await askAQuestion(page);
    await expect(ask).toBeVisible();
    await pastArming(page);
    await ask.getByRole("button", { name: "Search", exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);

    const retry = page.locator(".ai-ask").getByRole("button", {
      name: "Try again",
    });
    await expect(retry).toBeVisible();
    await expect(retry).toBeDisabled();
    await expect(page.locator(".ai-ask .ai-lede")).toContainText(
      "You can try again at",
    );
    await expect(retry).toBeEnabled({ timeout: 10_000 });
    await expect(page.locator(".ai-ask .ai-lede")).toContainText(
      "You can try again now.",
    );
    await retry.click();
    await expect.poll(() => calls.length).toBe(2);
    expect(queryOf(calls[1])).toBe(queryOf(calls[0]));
    await expect(
      page.getByText("Rome was taken in September 1870."),
    ).toBeVisible();
  });
});

// ── Several searches stay read-only ──────────────────────────────────────────
//
// Several proposed searches are shown whole, as text, with one Search and an
// Edit that opens the fields. Real layout adds to the jsdom rows:
// nothing clips a query, because the writer approves the whole text that
// leaves; Tab reaches Edit last; Edit's keyboard activation lands the writer
// in the first field; and the swap moves neither Search nor Don't search
// sideways.

/**
 * One search exactly at the cap: the longest query, so the widest text the
 * read-only face must draw whole.
 */
const LONG = `${"Breccia di Porta Pia e presa di Roma ".repeat(4)}`
  .slice(0, QUERY_MAX - 6)
  .concat(" 1870!")
  .slice(0, QUERY_MAX);

/** A query at the cap with no space in it, as a page's address would be. */
const UNBROKEN = "Presa_di_Roma_1870_".repeat(8).slice(0, QUERY_MAX);

test.describe("the several-search ask", () => {
  test.beforeEach(async ({ page, browserName }) => {
    skipWithoutLocalFolders(browserName);
    await page.setViewportSize({ width: 1280, height: 800 });
    // A roomy model, so the fit before the ask never refuses two searches.
    await stubModel(page, undefined, {
      proposals: [PROPOSED, LONG],
      context: 32_768,
    });
    await openSignedInProject(page);
  });

  test("shows each search whole as text, and sends both as shown", async ({
    page,
  }) => {
    const calls = await stubSearch(page, () => FOUND);
    const ask = await askAQuestion(page);
    await expect(ask).toBeVisible();
    await expect(ask.getByRole("textbox")).toHaveCount(0);
    const shown = ask.locator(".ai-ask-query q bdi");
    await expect(shown).toHaveText([PROPOSED, LONG]);
    // Nothing clips or rewrites a query: no overflow, clamp or cap, no hidden
    // run, no unwrapped line and no change of case, because the words shown
    // are the words sent.
    for (const query of await ask.locator(".ai-ask-query").all()) {
      const style = await query.evaluate((one) => {
        const css = getComputedStyle(one);
        return {
          overflow: css.overflow,
          textOverflow: css.textOverflow,
          maxHeight: css.maxHeight,
          clamp: css.getPropertyValue("-webkit-line-clamp"),
          whiteSpace: css.whiteSpace,
          textTransform: css.textTransform,
          fits: one.scrollWidth <= one.clientWidth,
        };
      });
      expect(style).toEqual({
        overflow: "visible",
        textOverflow: "clip",
        maxHeight: "none",
        clamp: "none",
        whiteSpace: "normal",
        textTransform: "none",
        fits: true,
      });
    }
    await pastArming(page);
    await ask.getByRole("button", { name: "Search", exact: true }).click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls.map(queryOf).sort()).toEqual([PROPOSED, LONG].sort());
  });

  test("wraps a query with no space in it inside the ask", async ({ page }) => {
    // A query need not have a space to break at: a model can propose a
    // page's address or a run of joined words. It wraps where it must
    // rather than run past the ask's edge.
    await stubModel(page, undefined, {
      proposals: [PROPOSED, UNBROKEN],
      context: 32_768,
    });
    await stubSearch(page, () => FOUND);
    const ask = await askAQuestion(page);
    await expect(ask.locator(".ai-ask-query q bdi")).toHaveText([
      PROPOSED,
      UNBROKEN,
    ]);
    const query = ask.locator(".ai-ask-query").last();
    const drawn = await query.evaluate((one) => ({
      lines: Math.round(
        one.getBoundingClientRect().height /
          parseFloat(getComputedStyle(one).lineHeight),
      ),
      fits: one.scrollWidth <= one.clientWidth,
    }));
    expect(drawn.lines).toBeGreaterThan(1);
    expect(drawn.fits).toBe(true);
    const edge = (await ask.boundingBox())!;
    const text = (await query.boundingBox())!;
    expect(text.x + text.width).toBeLessThanOrEqual(edge.x + edge.width);
  });

  test("reaches Edit last, opens it by keyboard into the first field, and moves no button sideways", async ({
    page,
  }) => {
    const calls = await stubSearch(page, () => FOUND);
    const ask = await askAQuestion(page);
    await expect(ask).toBeVisible();
    const search = ask.getByRole("button", { name: "Search", exact: true });
    const decline = ask.getByRole("button", { name: "Don't search" });
    const edit = ask.getByRole("button", { name: "Edit these searches" });
    await expect(edit).toHaveText("Edit");
    const label = await stableBox(page, ".ai-ask .ui-input-label");
    const before = {
      search: await stableBox(page, ".ai-ask .ui-btn-soft"),
      decline: await stableBox(
        page,
        ".ai-ask .ai-finding-actions .ui-btn-link",
      ),
    };

    await search.focus();
    await page.keyboard.press("Tab");
    await expect(decline).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(edit).toBeFocused();
    await page.keyboard.press("Enter");

    const fields = ask.getByRole("textbox");
    await expect(fields).toHaveCount(2);
    await expect(fields.first()).toBeFocused();
    await expect(fields.first()).toHaveValue(PROPOSED);
    await expect(edit).toHaveCount(0);
    expect(calls).toHaveLength(0);

    // The legend takes the label's place; the buttons keep their x.
    const legend = await stableBox(page, ".ai-ask legend");
    expect(Math.abs(legend.y - label.y)).toBeLessThanOrEqual(1);
    const after = {
      search: await stableBox(page, ".ai-ask .ui-btn-soft"),
      decline: await stableBox(
        page,
        ".ai-ask .ai-finding-actions .ui-btn-link",
      ),
    };
    expect(after.search.x).toBe(before.search.x);
    expect(after.decline.x).toBe(before.decline.x);
  });
});

// ── The sources ──────────────────────────────────────────────────────────────
//
// What the answer cites is drawn as a number and a row that opens the url the
// search returned. A link the model wrote itself, which a page it
// read could have chosen, is words and nothing else, on screen and on the
// clipboard, so it cannot carry the book off the machine. The answer below
// does both: it cites `web:1` the way the note asks, and it writes a link
// whose query string carries the book.
const MODEL_LINK = "https://evil.example/collect?q=chapter-one";
const CITING = `Rome was taken in 1870 (web:1). See [the full story](${MODEL_LINK}).`;

test.describe("the sources", () => {
  test.beforeEach(async ({ page, browserName }) => {
    skipWithoutLocalFolders(browserName);
    await page.setViewportSize({ width: 1280, height: 800 });
    // What Copy writes, kept where the row can read it: a real clipboard
    // read needs a permission prompt no headless run can answer.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as unknown as { copied?: string }).copied = text;
          },
        },
      });
    });
    await stubModel(page, CITING);
    await openSignedInProject(page);
  });

  test("a cited result is a number and a row; the model's own link is words", async ({
    page,
  }) => {
    await stubSearch(page, () => FOUND);
    const ask = await askAQuestion(page);
    await expect(ask).toBeVisible();
    await pastArming(page);
    await ask.getByRole("button", { name: "Search", exact: true }).click();

    const answer = page.locator(".msg-assistant").last();
    await expect(answer.locator(".dock-read")).toContainText(
      "Rome was taken in 1870",
    );
    // The chat is the app's one long-form reading surface, so an answer reads
    // at the chat's 14/1.7 rather than the interface's 13/1.62, and the
    // reader's classes it borrows do not bring their ramp with them.
    for (const selector of [".msg-assistant", ".msg-assistant .dock-read p"])
      expect(
        await page
          .locator(selector)
          .last()
          .evaluate((el) => {
            const css = getComputedStyle(el);
            return `${css.fontSize}/${css.lineHeight}`;
          }),
        selector,
      ).toBe("14px/23.8px");
    // The marker sits on the word, and is not a control.
    await expect(answer.locator("sup.ai-web-mark")).toHaveText("1");
    // The model's link is its words: no anchor in the answer at all.
    await expect(answer.locator(".dock-read")).toContainText("the full story");
    await expect(answer.locator(".dock-read a")).toHaveCount(0);

    // The row opens the url the search returned in a new tab, with no opener
    // and no referrer.
    const list = answer.getByRole("list", { name: "Web sources" });
    const row = list.getByRole("link");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute(
      "href",
      "https://en.wikipedia.org/wiki/Capture_of_Rome",
    );
    await expect(row).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(row).toHaveAttribute("target", "_blank");
    await expect(row).toHaveAccessibleName(
      /Capture of Rome.*en\.wikipedia\.org opens in a new tab/,
    );

    // The copy is the screen's words and the app's own source line, with no
    // url the model chose.
    await answer.getByRole("button", { name: "Copy" }).click();
    const copied = await page.evaluate(
      () => (window as unknown as { copied?: string }).copied ?? "",
    );
    expect(copied).toContain("Rome was taken in 1870[1]. See the full story.");
    expect(copied).toContain(
      "[1] Capture of Rome · https://en.wikipedia.org/wiki/Capture_of_Rome",
    );
    expect(copied).not.toContain("evil.example");
  });
});

// ── The verify command ───────────────────────────────────────────────────────
//
// `/verify` checks a claim end to end: the model proposes a search as
// a structured answer (`format` on Ollama), the writer approves it, and the
// judge weighs what came back in the request that carries tool messages. The
// verdict, the source with the words it was quoted for, and the fix after
// the list are measured as relations, never pixels.

const CLAIM = "Rome was taken in 1871";
const EXCERPT_QUOTE = "on 20 September 1870 ended the Papal States";

interface Judged {
  verdict: string;
  sources: Array<{ id: string; stance: string; quote: string }>;
  reasoning: string;
  fix: string;
}

const IMPLAUSIBLE: Judged = {
  verdict: "implausible",
  sources: [{ id: "web:1", stance: "contradicts", quote: EXCERPT_QUOTE }],
  reasoning: "The source dates the capture to 1870, not 1871 web:1.",
  fix: "Rome was taken in 1870.",
};

/** A model that proposes `queries` as a structured answer, then judges. */
async function stubVerify(
  page: Page,
  judged: Judged,
  { tools = true, queries = [PROPOSED] } = {},
) {
  await page.route("http://localhost:11434/api/tags", (route) =>
    route.fulfill({
      json: { models: [{ name: MODEL, digest: "e2e-digest" }] },
    }),
  );
  await page.route("http://localhost:11434/api/show", (route) =>
    route.fulfill({
      json: {
        capabilities: tools ? ["completion", "tools"] : ["completion"],
        model_info: { "llama.context_length": 32_768 },
      },
    }),
  );
  const asked: string[] = [];
  await page.route("http://localhost:11434/api/chat", (route) => {
    const body = route.request().postData() ?? "{}";
    asked.push(body);
    const { messages } = JSON.parse(body) as {
      messages?: Array<{ role: string }>;
    };
    const judging = messages?.some((one) => one.role === "tool");
    return route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson({
        message: {
          content: JSON.stringify(judging ? judged : { queries }),
        },
        done: true,
      }),
    });
  });
  return asked;
}

/** The space between the foot of `above` and the head of `below`, in px. */
async function gapUnder(page: Page, above: string, below: string) {
  const top = await stableBox(page, above);
  const under = await stableBox(page, below);
  return Math.round((under.y - (top.y + top.height)) * 10) / 10;
}

/** What the page's Copy wrote, kept where a row can read it. */
const copiedText = (page: Page) =>
  page.evaluate(() => (window as unknown as { copied?: string }).copied ?? "");

test.describe("/verify", () => {
  test.beforeEach(async ({ browserName, page }) => {
    skipWithoutLocalFolders(browserName);
    // A real clipboard read needs a permission prompt no headless run can
    // answer, so the write is kept on the page instead.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as unknown as { copied?: string }).copied = text;
          },
        },
      });
    });
  });

  test("a claim, its one approved search, and the verdict it earned", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubVerify(page, IMPLAUSIBLE);
    await openSignedInProject(page);
    const calls = await stubSearch(page, () => FOUND);
    const ask = await askAQuestion(page, `/verify ${CLAIM}`);
    await expect(ask).toBeVisible();
    await expect(
      ask.getByRole("textbox", { name: "Search Wikipedia for" }),
    ).toHaveValue(PROPOSED);
    expect(calls).toHaveLength(0);
    await pastArming(page);
    await ask.getByRole("button", { name: "Search", exact: true }).click();

    const answer = page.locator(".msg-assistant").last();
    const verdict = answer.locator(".ai-verify .ai-verdict");
    await expect(verdict).toHaveText("Implausible");
    await expect(verdict.locator("svg.ai-mark.is-none")).toHaveCount(1);
    // The verdict settled something, so no Wikipedia hint.
    await expect(answer.locator(".ai-verify .dock-hint")).toHaveCount(0);
    await expect(answer.locator(".dock-read")).toContainText(
      "The source dates the capture to 1870",
    );
    // The reasoning stands 10px under the verdict.
    expect(await gapUnder(page, ".ai-verify", ".ai-verify + .dock-read")).toBe(
      10,
    );
    await expect(answer.locator(".dock-read sup.ai-web-mark")).toHaveText("1");
    const row = answer.locator(".ai-web-sources li");
    await expect(row).toHaveCount(1);
    await expect(row.locator(".ai-web-quote q bdi")).toHaveText(EXCERPT_QUOTE);
    await expect(row.locator(".ai-web-quote bdi")).toHaveAttribute(
      "lang",
      "en",
    );
    await expect(answer.locator(".ai-findings .ai-finding-head")).toHaveText(
      "Suggested fix",
    );
    await expect(answer.locator(".ai-findings .ai-finding-body")).toHaveText(
      IMPLAUSIBLE.fix,
    );
    // Exactly the approved query left, once.
    expect(calls.map(queryOf)).toEqual([PROPOSED]);

    await answer.getByRole("button", { name: "Copy" }).click();
    expect(await copiedText(page)).toBe(
      [
        "Implausible",
        "The source dates the capture to 1870, not 1871[1].",
        `[1] Capture of Rome · https://en.wikipedia.org/wiki/Capture_of_Rome\n    “${EXCERPT_QUOTE}”`,
        `Suggested fix\n${IMPLAUSIBLE.fix}`,
      ].join("\n\n"),
    );
  });

  test("a model that cannot read a search is refused before anything", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const asked = await stubVerify(page, IMPLAUSIBLE, { tools: false });
    await openSignedInProject(page);
    const calls = await stubSearch(page, () => FOUND);
    const ask = await askAQuestion(page, `/verify ${CLAIM}`);
    // The words go back to the field, and nothing was written or sent.
    const composer = page.getByRole("textbox", { name: "Enlighten!" });
    await expect(composer).toHaveValue(`/verify ${CLAIM}`);
    await expect(page.locator(".msg")).toHaveCount(0);
    await expect(ask).toHaveCount(0);
    expect(calls).toHaveLength(0);
    expect(asked).toHaveLength(0);
  });

  test("an unsettled verdict carries its hint 4px under it, the reasoning 10px under both", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubVerify(page, {
      verdict: "inconclusive",
      sources: [],
      reasoning: "The result does not say when Rome was taken.",
      fix: "",
    });
    await openSignedInProject(page);
    await stubSearch(page, () => FOUND);
    const ask = await askAQuestion(page, `/verify ${CLAIM}`);
    await expect(ask).toBeVisible();
    await pastArming(page);
    await ask.getByRole("button", { name: "Search", exact: true }).click();

    // Wikipedia alone was searched, so the verdict says what it could not
    // reach. The hint belongs to the verdict and sits close under it; the
    // reasoning is the next block.
    const hint = page.locator(".ai-verify > .dock-hint");
    await expect(hint).toHaveText(en.dock.verify.wikipediaLimit);
    expect(
      await gapUnder(
        page,
        ".ai-verify > .ai-verdict",
        ".ai-verify > .dock-hint",
      ),
    ).toBe(4);
    expect(await gapUnder(page, ".ai-verify", ".ai-verify + .dock-read")).toBe(
      10,
    );
  });

  const LONG_EXCERPT =
    "The capture of Rome on 20 September 1870 was the final event of the long process of Italian unification known as the Risorgimento, marking both the final defeat of the Papal States under Pope Pius IX and the unification of the Italian peninsula under King Victor Emmanuel II";
  // The longest a stored quote may be, cut from the page's own words.
  const LONGEST_QUOTE = [...LONG_EXCERPT].slice(0, 200).join("");

  for (const [plane, viewport] of [
    ["desktop", { width: 1280, height: 800 }],
    ["the phone plane", { width: 320, height: 800 }],
  ] as const)
    test(`a long quote wraps whole at the title's x, the fix 10px under it, on ${plane}`, async ({
      page,
    }) => {
      // The dock is opened where its button is, then the page is set to the
      // plane being measured: the geometry is the stylesheet's media rule.
      await page.setViewportSize({ width: 1280, height: 800 });
      await stubVerify(page, {
        ...IMPLAUSIBLE,
        sources: [{ id: "web:1", stance: "contradicts", quote: LONGEST_QUOTE }],
      });
      await openSignedInProject(page);
      await stubSearch(page, () => ({
        status: 200,
        json: { pages: [{ ...FOUND_PAGE, excerpt: `${LONG_EXCERPT}.` }] },
      }));
      const ask = await askAQuestion(page, `/verify ${CLAIM}`);
      await expect(ask).toBeVisible();
      await pastArming(page);
      await ask.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page.locator(".ai-web-quote q bdi")).toHaveText(
        LONGEST_QUOTE,
      );
      await page.setViewportSize(viewport);
      await expect(page.locator(".ai-web-quote")).toBeVisible();

      const title = await stableBox(page, ".ai-web-source > span[title]");
      const q = await stableBox(page, ".ai-web-quote > q");
      expect(Math.abs(q.x - title.x)).toBeLessThanOrEqual(0.5);
      // Whole: several lines, nothing hidden, nothing clamped or capped, on
      // the quote and on the row that holds it. A quote is the evidence for
      // the verdict, so it is never cut.
      const whole = () =>
        page.locator(".ai-web-quote > q").evaluate((one) =>
          [one, one.parentElement as Element].map((el) => {
            const css = getComputedStyle(el);
            return {
              lines: Math.round(
                el.getBoundingClientRect().height /
                  parseFloat(getComputedStyle(one).lineHeight),
              ),
              overflow: css.overflow,
              textOverflow: css.textOverflow,
              maxHeight: css.maxHeight,
              clamp: css.getPropertyValue("-webkit-line-clamp"),
              nowrap: css.whiteSpace === "nowrap",
              fits:
                el.scrollWidth <= el.clientWidth &&
                el.scrollHeight <= el.clientHeight,
            };
          }),
        );
      const uncut = {
        overflow: "visible",
        textOverflow: "clip",
        maxHeight: "none",
        clamp: "none",
        nowrap: false,
        fits: true,
      };
      for (const box of await whole()) {
        expect(box).toMatchObject(uncut);
        expect(box.lines).toBeGreaterThan(1);
      }

      const row = await stableBox(page, ".ai-web-sources > li:last-child");
      const fix = await stableBox(page, ".ai-findings");
      expect(Math.abs(fix.y - (row.y + row.height) - 10)).toBeLessThanOrEqual(
        1,
      );

      // The verdict words in each language stay on one line: the real word,
      // set into the real line, under the real stylesheet.
      const lines = await page.locator(".ai-verdict > strong").evaluate(
        (strong, words) =>
          words.map((word) => {
            strong.textContent = word;
            return Math.round(
              strong.getBoundingClientRect().height /
                parseFloat(getComputedStyle(strong).lineHeight),
            );
          }),
        // The words are read from the locale files, never copied, so a
        // reword cannot leave the row measuring a stale word.
        [en, it].flatMap((file) => Object.values(file.dock.verify.verdict)),
      );
      expect(lines).toHaveLength(8);
      expect(lines.every((count) => count === 1)).toBe(true);

      // A quote with no space in it, as a page's address or a table cell
      // can be, wraps where it must rather than run past the row.
      await page
        .locator(".ai-web-quote q bdi")
        .evaluate((bdi, run) => (bdi.textContent = run), "x".repeat(200));
      for (const box of await whole()) {
        expect(box).toMatchObject(uncut);
        expect(box.lines).toBeGreaterThan(1);
      }
    });
});
