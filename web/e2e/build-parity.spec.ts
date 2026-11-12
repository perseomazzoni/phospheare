// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The build paints what the source says. Each page is opened twice, from the
// dev server, which serves the CSS as written, and from the build, whose CSS
// Lightning CSS has lowered, merged and minified; every element's computed
// style must match. A lowering the browsers cannot read shows here as a
// difference, as `light-dark()` rewritten into variables nothing defines (a
// black logo) and a `backdrop-filter` dropped for its `-webkit-` copy (no
// frost) did.
//
// It runs only with `E2E_BUILD=1`, where the dev server starts beside the
// preview (`playwright.config.ts`). The greeting is the one random text, so
// `Math.random` is seeded the same in both, and the clock starts at the same
// time.

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { settleAnimations } from "./probe";
import { WRITER_ID, signIn } from "./session";
import { openFirstLight, openVisionProject } from "./visionProject";

const DEV_ORIGIN = "http://localhost:5173";

test.skip(
  process.env.E2E_BUILD !== "1" || !!process.env.PLAYWRIGHT_BASE_URL,
  "compares the build with the dev server, which only an E2E_BUILD run starts",
);

const PROPS = [
  "display",
  "visibility",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "width",
  "height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "color",
  "background-color",
  "background-image",
  "fill",
  "stroke",
  "opacity",
  "border-top-color",
  "border-top-width",
  "border-top-style",
  "border-bottom-color",
  "border-bottom-width",
  "border-left-color",
  "border-right-color",
  "border-radius",
  "box-shadow",
  "outline-color",
  "outline-style",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-transform",
  "text-decoration-line",
  "text-decoration-thickness",
  "text-decoration-color",
  "text-align",
  "text-shadow",
  "transform",
  "filter",
  "backdrop-filter",
  "mask-image",
  "clip-path",
  "color-scheme",
  "accent-color",
  "caret-color",
  "gap",
  "flex-direction",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "overflow-x",
  "overflow-y",
  "white-space",
  "cursor",
  "pointer-events",
  "--dots-hot",
  "--dots-c1",
];

type Styles = Record<string, Record<string, string>>;

/** Every element's computed `PROPS`, keyed by its path from `body`. */
function styles(page: Page): Promise<Styles> {
  return page.evaluate((props) => {
    const out: Record<string, Record<string, string>> = {};
    const key = (el: Element): string => {
      const parts: string[] = [];
      for (
        let e: Element | null = el;
        e && e !== document.documentElement;
        e = e.parentElement
      ) {
        const parent = e.parentElement;
        const cls = e.getAttribute("class")?.trim().split(/\s+/).join(".");
        // A portal's place among `body`'s children depends on the order the
        // two servers load its module, so it is keyed by its class alone.
        const at =
          parent && parent !== document.body
            ? `[${[...parent.children].indexOf(e)}]`
            : "";
        parts.unshift(`${e.tagName.toLowerCase()}${cls ? "." + cls : ""}${at}`);
      }
      return parts.join(">");
    };
    for (const el of [
      document.documentElement,
      ...document.querySelectorAll("body *"),
    ]) {
      if (el.closest("script, style, noscript")) continue;
      const cs = getComputedStyle(el);
      const rec: Record<string, string> = {};
      for (const p of props) rec[p] = cs.getPropertyValue(p).trim();
      out[key(el) || "html"] = rec;
    }
    return out;
  }, PROPS);
}

/** The differences between the two maps, one line per kind, worst first. */
function differences(dev: Styles, build: Styles, page: string): string[] {
  const kinds = new Map<string, string[]>();
  const add = (kind: string, where: string) =>
    kinds.set(kind, [...(kinds.get(kind) ?? []), where]);
  for (const [el, a] of Object.entries(dev)) {
    const b = build[el];
    if (!b) {
      add("only in the dev server", el);
      continue;
    }
    for (const p of PROPS)
      if (a[p] !== b[p]) add(`${p}: dev ${a[p]} | build ${b[p]}`, el);
  }
  for (const el of Object.keys(build))
    if (!dev[el]) add("only in the build", el);
  return [...kinds]
    .sort((x, y) => y[1].length - x[1].length)
    .map(
      ([kind, at]) =>
        `${page} [${at.length}] ${kind}\n    ${at.slice(0, 3).join("\n    ")}`,
    );
}

async function open(
  browser: Browser,
  baseURL: string,
  theme: string,
  scheme: "light" | "dark",
  as: Visit,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    let seed = 1;
    Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  });
  // The project helper starts the clock, signs in and seeds the theme itself.
  if (as === "project") return { context, page };
  await page.clock.install({ time: new Date("2026-10-01T10:00:00Z") });
  if (as === "signed-out") return { context, page };
  await signIn(page);
  await page.addInitScript(
    ({ id, theme }) => {
      if (localStorage.getItem(`profile.${id}`) === null) {
        const at = "2026-10-01T00:00:00.000Z";
        localStorage.setItem(
          `profile.${id}`,
          JSON.stringify({
            doc: {
              v: 1,
              installation: "build-parity",
              prefs: {
                theme: { value: theme, updatedAt: at },
                language: { value: "en", updatedAt: at },
              },
              library: {},
            },
            fileId: null,
            syncedAt: null,
          }),
        );
      }
    },
    { id: WRITER_ID, theme },
  );
  return { context, page };
}

/**
 * How a page is reached: signed out, signed in, or signed in with a book open.
 * A signed-in writer never sees the landing, so it is opened signed out, and
 * its theme follows the system's scheme. The demo editor keeps a theme of its
 * own, so the editor is a seeded book's (`visionProject.ts`).
 */
type Visit = "signed-out" | "signed-in" | "project";

/** The pages compared, each left where it settles. */
const PAGES: {
  name: string;
  as: Visit;
  reach: (
    page: Page,
    family: Family,
    scheme: "light" | "dark",
  ) => Promise<void>;
}[] = [
  {
    name: "landing",
    as: "signed-out",
    reach: async (page) => {
      await page.goto("/");
      await expect(page.locator(".landing-head")).toBeVisible();
    },
  },
  {
    name: "library",
    as: "signed-in",
    reach: async (page) => {
      await page.goto("/app");
      await expect(page.locator(".greet-caret")).toHaveAttribute(
        "data-done",
        "1",
      );
    },
  },
  {
    name: "settings",
    as: "signed-in",
    reach: async (page) => {
      await page.goto("/app/settings");
      await expect(page.getByRole("button", { name: "About" })).toBeVisible();
    },
  },
  {
    name: "editor",
    as: "project",
    reach: async (page, family, variant) => {
      await openVisionProject(page, { variant, text: "section", family });
      await openFirstLight(page, { save: false });
    },
  },
];

type Family = "matte" | "shine" | "radiant" | "vision";

for (const family of ["matte", "shine", "radiant", "vision"] as const)
  for (const scheme of ["light", "dark"] as const) {
    const theme = `${family}-${scheme}`;
    test(`the build paints ${theme} as the source does`, async ({
      browser,
      baseURL,
    }) => {
      // The dev server compiles each module on its first request.
      test.setTimeout(240_000);
      const found: string[] = [];
      for (const { name, as, reach } of PAGES) {
        const dev = await open(browser, DEV_ORIGIN, theme, scheme, as);
        const build = await open(browser, baseURL!, theme, scheme, as);
        await Promise.all([
          reach(dev.page, family, scheme),
          reach(build.page, family, scheme),
        ]);
        if (as !== "signed-out") {
          await expect(dev.page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          await expect(build.page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
        }
        // Fonts land after the first paint, and timers change the page
        // after it, such as the caret starting to blink. Both pages run
        // every timer due in the next second, a budget past the ones that
        // follow a page's arrival, then come to rest, so a page still
        // changing is not read as a page painted differently.
        await Promise.all([
          dev.page.evaluate(() => document.fonts.ready),
          build.page.evaluate(() => document.fonts.ready),
        ]);
        await Promise.all([
          dev.page.clock.runFor(1_000),
          build.page.clock.runFor(1_000),
        ]);
        await Promise.all([
          settleAnimations(dev.page),
          settleAnimations(build.page),
        ]);
        const [a, b] = await Promise.all([
          styles(dev.page),
          styles(build.page),
        ]);
        found.push(...differences(a, b, name));
        await dev.context.close();
        await build.context.close();
      }
      expect(found, found.join("\n")).toEqual([]);
    });
  }
