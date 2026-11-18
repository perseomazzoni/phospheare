// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { START_MS } from "./start";

// Pins the demo site as it is served (`build:demo`, the `demo-site` project
// under `E2E_DEMO=1`): the landing sends a visitor to the download, not to a
// sign-in; every address of the full program is "not found"; the demo opens
// with its "nothing is saved" notice; the site serves its own two legal
// texts and the third-party licences; each page has its own file, so a host
// that serves files only answers it, and every other address is a 404; the
// text pages carry their text before any script runs, and the browser takes
// over that HTML only when it renders the same; and
// no request leaves the site's origin while the browser keeps nothing that
// outlives the tab.

const REPOSITORY = "https://github.com/perseomazzoni/phospheare";
const QUICKSTART = `${REPOSITORY}#quickstart-for-everyone`;

/** Every request for an origin other than the site's while the page is open. */
function offsite(page: Page, site: string | undefined): string[] {
  const origin = new URL(site ?? "").origin;
  const seen: string[] = [];
  page.on("request", (sent) => {
    const url = new URL(sent.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.origin !== origin) seen.push(sent.url());
  });
  return seen;
}

test("the landing offers the Quickstart and the demo, and no sign-in", async ({
  page,
  baseURL,
}) => {
  const away = offsite(page, baseURL);
  await page.goto("/");
  const downloads = page.getByRole("link", {
    name: "Install it on your computer",
  });
  await expect(downloads).toHaveCount(2);
  for (const link of await downloads.all())
    await expect(link).toHaveAttribute("href", QUICKSTART);
  await expect(page.getByText("Log in with Google")).toHaveCount(0);
  await expect(page.getByText("Continue without an account")).toHaveCount(0);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(0);

  const legal = page.locator(".landing-foot").getByRole("link");
  await expect(legal.filter({ hasText: "Legal notice" })).toHaveAttribute(
    "href",
    "/legal",
  );
  await expect(legal.filter({ hasText: "Privacy" })).toHaveAttribute(
    "href",
    "/privacy",
  );
  await expect(legal.filter({ hasText: "Use and licence" })).toHaveCount(0);
  // The warranty band is named by a text the site keeps, not by a key.
  await expect(
    page.getByRole("region", { name: "Legal notice" }),
  ).toContainText("Warranty and liability");
  expect(away).toEqual([]);
});

test("every address of the full program is not found", async ({ page }) => {
  for (const path of [
    "/app",
    "/app/settings",
    "/app/editor/a-project",
    "/app/project/x",
    "/app/connect/openrouter",
    "/terms",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
      path,
    ).toBeVisible();
  }
});

test("each page answers on its own and every other address is a 404", async ({
  request,
}) => {
  for (const path of [
    "/",
    "/app/editor/demo",
    "/app/editor/demo/?lang=it",
    "/legal",
    "/privacy/",
    "/LICENSE.txt",
    "/third-party-notices.txt",
  ]) {
    const answer = await request.get(path);
    expect(answer.status(), path).toBe(200);
  }
  // The not-found page is the site's own page, whose router says so.
  for (const path of [
    "/app",
    "/app/editor/a-project",
    "/terms",
    "/assets/missing.js",
  ]) {
    const answer = await request.get(path);
    expect(answer.status(), path).toBe(404);
    expect(await answer.text(), path).toContain('<div id="root">');
  }
});

test("each text page carries its text, title and address before any script", async ({
  request,
}) => {
  for (const [path, heading, address] of [
    ["/", "From the start, through rewrites", "/"],
    ["/legal/", "Legal notice", "/legal/"],
    ["/privacy/", "Privacy notice", "/privacy/"],
  ]) {
    const html = await (await request.get(path)).text();
    expect(html, path).toMatch(
      /<div id="root" data-prerendered="[^"]+"><[a-z]/,
    );
    expect(html, path).toContain(heading);
    expect(html, path).toMatch(
      new RegExp(`<link rel="canonical" href="https://[^"]+${address}" />`),
    );
    expect(html, path).not.toMatch(/<script(?![^>]*\bsrc=)/);
  }
  const landing = await (await request.get("/")).text();
  const legal = await (await request.get("/legal/")).text();
  expect(landing.match(/<title>[^<]*<\/title>/)?.[0]).not.toBe(
    legal.match(/<title>[^<]*<\/title>/)?.[0],
  );
  // The demo editor is the program, not text to index.
  const demo = await (await request.get("/app/editor/demo/")).text();
  expect(demo).toContain('<div id="root"></div>');
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain("/privacy/</loc>");
});

/**
 * The landing's DOM in a form two renders of one page share: attributes
 * sorted, classes sorted, styles as the browser reads them, text joined.
 * What only the build writes is left out: `#root`'s state, React's image
 * preload, the `useId` values and a `selected` attribute React writes as
 * markup but sets as a property in the browser.
 */
async function landingShape(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const out: string[] = [];
    const walk = (el: Element, depth: number) => {
      if (el instanceof HTMLLinkElement && el.rel === "preload") return;
      const attrs = [...el.attributes]
        .filter(
          (a) => !["style", "data-prerendered", "selected"].includes(a.name),
        )
        .map((a) => {
          const value =
            a.name === "class"
              ? a.value.split(/\s+/).sort().join(" ")
              : a.value.replace(/_[rR]_[0-9a-z]+_/g, "_id_");
          return `${a.name}=${JSON.stringify(value)}`;
        })
        .sort();
      if (el instanceof HTMLElement && el.getAttribute("style") !== null)
        attrs.push(`style=${JSON.stringify(el.style.cssText)}`);
      out.push(`${"  ".repeat(depth)}<${el.tagName} ${attrs.join(" ")}>`);
      let text = "";
      const flush = () => {
        if (text.trim()) out.push(`${"  ".repeat(depth + 1)}${text.trim()}`);
        text = "";
      };
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
        else if (node instanceof Element) {
          flush();
          walk(node, depth + 1);
        }
      }
      flush();
    };
    walk(document.getElementById("root")!, 0);
    return out.join("\n").replace(/\s+/g, " ");
  });
}

test("the hydrated landing is the page the browser renders from nothing", async ({
  browser,
  baseURL,
}) => {
  // The same bundle twice, at the same fixed time: once on the build's
  // HTML, once with that HTML taken out, as the site served it before the
  // prerender. A value the build cannot know (a browser feature, the
  // platform) shows here as a difference, since the production build keeps
  // a mismatched attribute without a word.
  const shapes: string[] = [];
  for (const strip of [false, true]) {
    const context = await browser.newContext({ locale: "en-GB" });
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-18T10:00:00Z") });
    if (strip)
      await page.route(`${baseURL}/`, async (route) => {
        const answer = await route.fetch();
        const body = (await answer.text()).replace(
          /<div id="root" data-prerendered="[^"]*">[\s\S]*<\/div>(\s*<\/body>)/,
          '<div id="root"></div>$1',
        );
        expect(body).not.toContain("data-prerendered");
        await route.fulfill({ response: answer, body });
      });
    await page.goto("/");
    await page.locator("h1").waitFor();
    await page.clock.runFor(4000);
    shapes.push(await landingShape(page));
    await context.close();
  }
  expect(shapes[0].length).toBeGreaterThan(10_000);
  expect(shapes[0]).toBe(shapes[1]);
});

for (const [locale, kept] of [
  ["en-GB", true],
  ["it-IT", false],
] as const) {
  test.describe(locale, () => {
    test.use({ locale });

    test(`the landing ${kept ? "keeps" : "replaces"} the build's HTML, with no error`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      // The build's first element, held before any script runs: React keeps
      // it when it hydrates, and drops it when it renders from nothing.
      await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
          const held = window as { builtFirst?: Element | null };
          held.builtFirst = document.getElementById("root")?.firstElementChild;
        });
      });
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        locale.slice(0, 2),
      );
      await expect(page.locator("h1")).toBeVisible();
      const stillThere = await page.evaluate(
        () =>
          (window as { builtFirst?: Element | null }).builtFirst?.isConnected ??
          false,
      );
      expect(stillThere).toBe(kept);
      expect(errors).toEqual([]);
    });
  });
}

test("the demo says nothing is saved, with the Quickstart, until closed", async ({
  page,
  baseURL,
}) => {
  const away = offsite(page, baseURL);
  await page.goto("/app/editor/demo");
  const notice = page.locator(".demo-notice");
  await expect(notice).toContainText("This is a demo: nothing is saved.", {
    timeout: START_MS,
  });
  await expect(
    notice.getByRole("link", { name: /build the program on your computer/ }),
  ).toHaveAttribute("href", QUICKSTART);

  // The long notice lies in the titlebar's band and stays clear of its right
  // cluster: its dismiss or its link over Palette would catch that click.
  const pill = await notice.boundingBox();
  const cluster = await page.locator(".titlebar-right").boundingBox();
  expect(pill!.x + pill!.width).toBeLessThan(cluster!.x);

  await notice.getByRole("button", { name: "Close" }).click();
  await expect(notice).toHaveCount(0);

  await page.getByRole("button", { name: "Continue writing" }).click();
  await page.locator(".editor p").first().click();
  await page.keyboard.type("A line no one keeps.");
  await expect(page.locator(".editor")).toContainText("A line no one keeps.");

  // A reload brings back the sample novel, and the notice.
  await page.reload();
  await expect(page.locator(".demo-notice")).toBeVisible();
  await expect(page.getByText("A line no one keeps.")).toHaveCount(0);

  const kept = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    cookies: document.cookie,
    databases: (await indexedDB.databases()).map((db) => db.name),
  }));
  expect(kept).toEqual({ local: [], cookies: "", databases: [] });
  expect(away).toEqual([]);
});

test("the site serves its own legal texts and the licences", async ({
  page,
  request,
}) => {
  const width = 390;
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/legal");
  await expect(
    page.getByRole("heading", { name: "2. Nothing is saved" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "/third-party-notices.txt" }),
  ).toHaveAttribute("href", "/third-party-notices.txt");
  await expect(
    page.getByRole("link", { name: "/LICENSE.txt" }),
  ).toHaveAttribute("href", "/LICENSE.txt");
  const version = process.env.VERSION?.trim();
  const source = version
    ? `${REPOSITORY}/archive/refs/tags/v${version}.tar.gz`
    : REPOSITORY;
  await expect(
    page
      .locator("#notice-license")
      .getByRole("link", { name: source, exact: true }),
  ).toHaveAttribute("href", source);
  const licence = await request.get("/LICENSE.txt");
  expect(licence.ok()).toBe(true);
  expect(await licence.text()).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
  const licenceRight = await page
    .locator("#notice-license")
    .evaluate((section) => section.getBoundingClientRect().right);
  expect(licenceRight).toBeLessThanOrEqual(width);
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: "2. The host's access logs" }),
  ).toBeVisible();
  await expect(
    page.locator("#privacy-contact").getByRole("link"),
  ).toHaveAttribute("href", "mailto:contact@oncedark.studio");

  const notices = await request.get("/third-party-notices.txt");
  expect(notices.ok()).toBe(true);
  const text = await notices.text();
  expect(text).toMatch(/^# Third-party notices/);
  expect(text).not.toContain("## Desktop program (Go)");

  // The install icons are not in the build.
  for (const icon of [
    "/icon-192.png",
    "/icon-512.png",
    "/apple-touch-icon.png",
  ]) {
    const answer = await request.get(icon);
    expect(answer.status(), icon).toBe(404);
  }
});
