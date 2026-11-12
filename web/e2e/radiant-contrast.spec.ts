// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { settleAnimations } from "./probe";
import {
  openDockFace,
  openFirstLight,
  openVisionProject,
  type DockFace,
} from "./visionProject";

// Radiant's text holds WCAG 1.4.3 wherever it stands: every visible text on
// the Library, Settings, the section with a row and a Part under the hand,
// the palette, a row's menu, the history and the Dock's four faces, against
// the ground it is drawn on, washes composited. The sheet is the shell's
// `::before`, so a text inside its box stands on it. The prose is the
// palette's own test; a disabled control and an aria-hidden mark are exempt.
//
// Faded text counts: the opacities of the text's element and of every
// ancestor multiply, and the text colour is blended that far toward its
// ground before the ratio is taken. Only text no one can see is skipped. The
// blend treats the ground as unfaded, which is exact when the faded element
// draws no background of its own, as a dimmed label does. The auditor's own
// row at the end proves it flags what it should.

test.use({ timezoneId: "UTC", locale: "en-US" });

/** A text under its minimum, as the auditor reports it. */
interface Finding {
  ratio: number;
  need: number;
  text: string;
  selector: string;
  color: string;
  /** The product of the opacities from the text's element to the root. */
  opacity: number;
}

/**
 * Every text on the page under its minimum. Passed whole to `page.evaluate`,
 * so it closes over nothing.
 */
function findLowContrast(): Finding[] {
  const parse = (c: string) => {
    const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    const k = c.startsWith("color(") ? 255 : 1;
    return {
      r: m[0] * k,
      g: m[1] * k,
      b: m[2] * k,
      a: m.length > 3 ? m[3] : 1,
    };
  };
  const over = (
    top: { r: number; g: number; b: number; a: number },
    bot: { r: number; g: number; b: number },
  ) => ({
    r: top.r * top.a + bot.r * (1 - top.a),
    g: top.g * top.a + bot.g * (1 - top.a),
    b: top.b * top.a + bot.b * (1 - top.a),
  });
  const lum = (c: { r: number; g: number; b: number }) =>
    [c.r, c.g, c.b]
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const shell = document.querySelector(".editor-shell");
  const sheetBox = shell
    ? (() => {
        const cs = getComputedStyle(shell, "::before");
        if (cs.content === "none" || cs.content === "") return null;
        const W = innerWidth,
          H = innerHeight;
        return {
          l: parseFloat(cs.left),
          t: parseFloat(cs.top),
          r: W - parseFloat(cs.right),
          b: H - parseFloat(cs.bottom),
          bg: parse(cs.backgroundColor),
        };
      })()
    : null;
  // A filled control may be lit by a gradient over a transparent colour;
  // each of its stops is a ground the text must hold on.
  const stops = (image: string) =>
    image.includes("gradient(")
      ? (image.match(/(?:rgba?|color)\([^()]*\)/g) ?? []).map(parse)
      : [];
  const ground = (el: Element, x: number, y: number) => {
    const layers: ReturnType<typeof parse>[] = [];
    let lit: ReturnType<typeof parse>[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const bg = parse(getComputedStyle(e).backgroundColor);
      const image = stops(getComputedStyle(e).backgroundImage);
      if (bg.a < 1 && image.length && image.every((c) => c.a >= 1)) {
        lit = image;
        break;
      }
      if (bg.a > 0) layers.push(bg);
      if (bg.a >= 1) break;
      if (
        e === shell &&
        sheetBox &&
        x >= sheetBox.l &&
        x <= sheetBox.r &&
        y >= sheetBox.t &&
        y <= sheetBox.b
      ) {
        layers.push({ ...sheetBox.bg, a: 1 });
        break;
      }
    }
    const bases = lit.length ? lit : [{ r: 255, g: 255, b: 255 }];
    return bases.map((base) => {
      let c = { r: base.r, g: base.g, b: base.b };
      for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
      return c;
    });
  };
  const selectorOf = (el: Element) =>
    el.tagName.toLowerCase() +
    (el.id ? `#${el.id}` : "") +
    [...el.classList].map((c) => `.${c}`).join("");

  const out: Finding[] = [];
  const seen = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.trim();
    if (!text) continue;
    const el = n.parentElement!;
    if (
      el.closest(
        "[aria-hidden='true'], :disabled, [aria-disabled='true'], .editor",
      )
    )
      continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight)
      continue;
    // A 1px box clipped to nothing is the screen-reader-only pattern
    // (`.ui-visually-hidden`): no pixel of the text is drawn.
    if (r.width <= 1 && r.height <= 1) continue;
    // `visibility` inherits, so the text's own element answers for its
    // ancestors; `display: none` anywhere above leaves no box, caught above.
    // Opacity does not inherit, so it is multiplied up the tree.
    const own = getComputedStyle(el);
    if (own.visibility !== "visible") continue;
    let opacity = 1;
    for (let e: Element | null = el; e; e = e.parentElement)
      opacity *= parseFloat(getComputedStyle(e).opacity);
    // Fully transparent text is not drawn; anything above it is seen.
    if (opacity < 0.01) continue;
    const fg = parse(own.color);
    const ratio = Math.min(
      ...ground(el, r.x + r.width / 2, r.y + r.height / 2).map((bg) => {
        const drawn = over({ ...fg, a: fg.a * opacity }, bg);
        const [a, b] = [lum(drawn), lum(bg)];
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }),
    );
    const size = parseFloat(own.fontSize),
      weight = Number(own.fontWeight);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      const selector = selectorOf(el);
      const key = `${selector}|${own.color}|${Math.round(ratio * 100)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ratio: Math.round(ratio * 100) / 100,
        need,
        text: text.slice(0, 28),
        selector,
        color: own.color,
        opacity: Math.round(opacity * 1000) / 1000,
      });
    }
  }
  return out;
}

/**
 * Every text on the page under its minimum, one line each, once the page has
 * come to rest: a fade still running would be audited at whatever opacity it
 * had reached. Looping animations never finish, so they are not waited for.
 */
async function audit(page: Page, where: string) {
  await settleAnimations(page);
  const bad = (await page.evaluate(findLowContrast)).map(
    (f) =>
      `${f.ratio.toFixed(2)} < ${f.need}  "${f.text}"  ${f.selector}  ${f.color}` +
      (f.opacity < 1 ? `  at opacity ${f.opacity}` : ""),
  );
  expect.soft(bad, where).toEqual([]);
}

/** What each Dock face shows once its row is open, so the audit reads it. */
const FACE_SHOWN: Record<DockFace, (dock: Locator) => Locator> = {
  ask: (dock) => dock.locator(".ai-chathead"),
  reference: (dock) => dock.getByText("the dog, home;").first(),
  notes: (dock) => dock.getByText("The water carries the memory").first(),
  snapshot: (dock) => dock.locator(".snap-preview"),
};

for (const variant of ["light", "dark"] as const) {
  test(`the Library and Settings hold 4.5:1 (${variant})`, async ({ page }) => {
    await page.setViewportSize({ width: 1198, height: 723 });
    await openVisionProject(page, {
      variant,
      text: "section",
      family: "radiant",
      stayInLibrary: true,
    });
    await audit(page, `${variant} library`);
    await page.goto("/app/settings");
    await page.getByRole("button", { name: "Close settings" }).waitFor();
    for (const tab of [
      "How it looks",
      "Where words live",
      "How you write",
      "Set up your AI",
      "Who you are",
      "About",
    ]) {
      const button = page.getByRole("button", { name: tab, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-current", "true");
      await audit(page, `${variant} settings ${tab}`);
    }
  });
  test(`the editor holds 4.5:1 (${variant})`, async ({ page }) => {
    await page.setViewportSize({ width: 1198, height: 723 });
    await openVisionProject(page, {
      variant,
      text: "section",
      family: "radiant",
    });
    await openFirstLight(page);
    await page.mouse.move(600, 715);
    await audit(page, `${variant} section`);
    await page.locator(".dt-row.dt-section:not(.active)").first().hover();
    await audit(page, `${variant} section, row hovered`);
    await page.locator(".dt-row.dt-part").first().hover();
    await audit(page, `${variant} section, Part hovered`);
    await page.getByRole("button", { name: "Palette" }).click();
    await expect(page.locator(".board")).toBeVisible();
    await audit(page, `${variant} palette`);
    await page.keyboard.press("Escape");
    // A row's ⋮ arrives with the pointer.
    await page.locator(".dt-row", { hasText: "The Dark" }).first().hover();
    await page.getByRole("button", { name: "Actions for “The Dark”" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await audit(page, `${variant} row menu`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "History" }).click();
    await expect(
      page.getByRole("button", { name: "Step to an older revision" }),
    ).toBeVisible();
    await audit(page, `${variant} history`);
    await page.keyboard.press("Escape");
    for (const face of ["ask", "reference", "notes", "snapshot"] as const) {
      await openDockFace(page, face);
      await expect(FACE_SHOWN[face](page.locator(".ed-dock"))).toBeVisible();
      await audit(page, `${variant} dock ${face}`);
    }
  });
}

test("the auditor flags faint and faded text, and passes what holds", async ({
  page,
}) => {
  // Black text on white and every shade named here are worked out by hand
  // against the WCAG formula; the auditor runs on nothing but these rows.
  await page.setContent(`
    <body style="margin:0;background:#fff;font:16px sans-serif">
      <p id="faint" style="color:#aaa">faint grey, 2.32:1</p>
      <p id="faded" style="color:#595959;opacity:0.5">
        7:1 alone, under 3:1 at half opacity
      </p>
      <div style="opacity:0.8">
        <div style="opacity:0.8">
          <p id="nested" style="color:#444">9.7:1 alone, 3.6:1 at 0.64</p>
        </div>
      </div>
      <div style="opacity:0.8">
        <p id="once" style="color:#444">5.5:1 at 0.8, which holds</p>
      </div>
      <p id="solid" style="color:#333">the control, 12.6:1</p>
      <p id="gone" style="color:#eee;opacity:0">not drawn at all</p>
      <p id="hidden" style="color:#eee;visibility:hidden">hidden, not drawn</p>
      <p id="unseen" style="color:#eee;position:absolute;width:1px;height:1px;
        overflow:hidden;clip-path:inset(50%)">for a screen reader only</p>
    </body>
  `);
  const flagged = await page.evaluate(findLowContrast);
  const by = (id: string) => flagged.find((f) => f.selector === `p#${id}`);

  expect(by("faint")?.ratio).toBeCloseTo(2.32, 1);
  expect(by("faded")?.opacity).toBe(0.5);
  expect(by("faded")?.ratio).toBeLessThan(3);
  expect(by("nested")?.opacity).toBeCloseTo(0.64, 3);
  expect(by("nested")?.ratio).toBeCloseTo(3.6, 1);
  expect(flagged.map((f) => f.selector).sort()).toEqual([
    "p#faded",
    "p#faint",
    "p#nested",
  ]);
});
