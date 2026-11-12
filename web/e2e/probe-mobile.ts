// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Probes for the mobile suite: whether the page scrolls sideways, whether
// anything interactive is smaller than a fingertip, whether iOS zooms when a
// field takes focus, and whether focus and names are present.
//
// Every probe returns what it found rather than asserting inside itself, so a
// spec can pin an exact set of known offenders instead of a bare "none".

import { expect, type Page } from "@playwright/test";
import { settleTransitions, stableBox } from "./probe";

/** The tap floor in CSS pixels: Apple's HIG minimum. */
export const MIN_TAP = 44;

/**
 * The field font floor in CSS pixels. Below it iOS Safari zooms the page when
 * the field takes focus, with no way back but a pinch: a platform rule.
 */
export const MIN_INPUT_FONT = 16;

export interface Offender {
  /** A stable-enough handle for a human reading the failure. */
  label: string;
  width: number;
  height: number;
}

/**
 * Elements whose box is smaller than `min` in either axis.
 *
 * Hidden and zero-area elements are excluded: a control that is not on screen
 * is a reachability question, not a size one.
 */
export async function smallTapTargets(
  page: Page,
  min = MIN_TAP,
  /** Scope the sweep to a surface (a selector). The whole page otherwise. */
  rootSelector?: string,
): Promise<Offender[]> {
  return await page.evaluate(
    ({ minSize, rootSelector: root }) => {
      const selector =
        'button, a[href], [role="button"], summary, input, select, textarea, [tabindex]:not([tabindex="-1"])';
      // Layout snaps to device pixels, and on a fractional ratio that lands a
      // hair under the CSS number: a control laid out at 44px measures
      // 43.999996 on the Pixel 7's 2.625. One device pixel of slack asks
      // whether the control has its designed size, not how the rasteriser
      // rounded.
      const slack = 1 / (window.devicePixelRatio || 1);
      const out: { label: string; width: number; height: number }[] = [];
      const roots: Element[] = root
        ? [...document.querySelectorAll(root)]
        : [document.documentElement];
      // A scoped sweep whose root matches nothing is an instrument failure,
      // not an empty answer; returning [] would be a silent pass.
      if (root && roots.length === 0)
        throw new Error(`smallTapTargets: no element matches "${root}"`);
      for (const scope of roots)
        for (const el of scope.querySelectorAll<HTMLElement>(selector)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const style = getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none")
            continue;
          if (r.width >= minSize - slack && r.height >= minSize - slack)
            continue;
          const label =
            el.getAttribute("aria-label") ??
            el.getAttribute("title") ??
            el.textContent?.trim().slice(0, 24) ??
            "";
          out.push({
            label: `${el.tagName.toLowerCase()}.${el.className || "-"} "${label}"`,
            width: Math.round(r.width),
            height: Math.round(r.height),
          });
        }
      return out;
    },
    { minSize: min, rootSelector },
  );
}

/** Focusable text fields whose computed font-size triggers the iOS zoom. */
export async function smallInputFonts(
  page: Page,
  min = MIN_INPUT_FONT,
): Promise<{ label: string; fontSize: number }[]> {
  return await page.evaluate((minPx) => {
    const out: { label: string; fontSize: number }[] = [];
    const fields = document.querySelectorAll<HTMLElement>(
      'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]',
    );
    for (const el of fields) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(size) || size >= minPx) continue;
      out.push({
        label: `${el.tagName.toLowerCase()}.${el.className || "-"}`,
        fontSize: size,
      });
    }
    return out;
  }, min);
}

/**
 * How far the page itself scrolls sideways, in CSS pixels; 0 when it does
 * not. Only the document's own overflow counts: an element with
 * `overflow-x: auto`, such as the command bar, is a scroller doing its job.
 */
export async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return Math.max(0, el.scrollWidth - el.clientWidth);
  });
}

/** The width of the prose column, which is the whole product on a phone. */
export async function proseWidth(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const p = document.querySelector(".editor")?.firstElementChild;
    return p ? Math.round(p.getBoundingClientRect().width) : 0;
  });
}

/** Whether this context presents as a touch device. */
export async function isCoarsePointer(page: Page): Promise<boolean> {
  return await page.evaluate(
    () =>
      matchMedia("(pointer: coarse)").matches &&
      matchMedia("(hover: none)").matches,
  );
}

/**
 * One command on the editor's palette, by the label the writer reads. A
 * `CommandBoard` cell carries no trailing metadata, so its accessible name is
 * the label. Scoped to the board, so a command that also names a bar
 * action (Bold, Save) cannot match the chrome behind the scrim.
 */
export function paletteCommand(page: Page, name: string) {
  return page.locator(".board").getByRole("button", { name, exact: true });
}

/** The demo editor, open on a Section, with no account and no picker. */
export async function openDemoEditor(page: Page): Promise<void> {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor").first()).toBeVisible();
}

/**
 * Opens the structure panel the way a writer on the current plane does, and
 * waits until it is open, so a test that measures it does not pass for the
 * wrong reason.
 *
 * Above 720 the panel rests as a 52px rail and its own "Widen the panel"
 * opens it. On the phone there is no rail, since a phone cannot spare the
 * width and a rail covers the bar's leftmost slot, and the panel is a modal
 * sheet opened from the command bar.
 */
export async function openStructurePanel(page: Page): Promise<void> {
  const phone =
    (await page.locator(".editor-shell").getAttribute("data-phone")) === "1";
  if (phone) {
    // Tapped, as on a phone: a click hovers, and the hover opens the button's
    // tooltip, which a phone writer never sees.
    await page.getByRole("button", { name: "Project structure" }).tap();
    await expect(page.locator(".doc-tree-sheet")).toBeVisible();
    return;
  }
  await page.getByRole("button", { name: "Widen the panel" }).first().click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "0");
  // `data-rail` is React state and flips at once, while the panel's width
  // animates from the 52px rail to 248 afterwards, so geometry read right
  // after the attribute measures the rail. The wait is for the box to stop.
  await stableBox(page, ".doc-tree");
}

/** One text-bearing element, as the type probe reports it. */
export interface TypeSample {
  label: string;
  fontSize: number;
}

/**
 * Every size the chrome draws a word at, on whatever is on screen.
 *
 * Only elements that own a non-empty text node count: a container's
 * `font-size` is inherited whether or not a glyph is painted with it, so a
 * wrapper with a stale declaration would be a false positive.
 *
 * Excluded: the prose, whose size the writer sets and which is not chrome;
 * `.dock-read`, since a reference document and a snapshot's preview are read,
 * not operated, as their rule in `editor.css` states; `.desk-last`, the
 * Desk's quotation of the writer's last line at prose size; and fields, whose
 * 16px floor against the iOS zoom outranks the two sizes.
 */
export async function uiTypeSizes(page: Page): Promise<TypeSample[]> {
  return await page.evaluate(() => {
    const out: { label: string; fontSize: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (
        el.closest(
          ".editor, .desk-last, .dock-read, input, textarea, [contenteditable='true']",
        )
      )
        continue;
      // A heading is hierarchy, not density: a dialog's title says which room
      // the writer is in, so headings are outside the two-size rule.
      if (/^h[1-6]$/i.test(el.tagName)) continue;
      const owns = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && /\S/.test(n.textContent ?? ""),
      );
      if (!owns) continue;
      const r = el.getBoundingClientRect();
      // Two pixels, not zero: a screen-reader live region is a 1x1 clipped box
      // carrying real text at an inherited size, and nothing meant to be seen
      // is one pixel tall.
      if (r.width < 2 || r.height < 2) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // A tooltip at rest is laid out and transparent, and on a coarse pointer
      // it stays so, so its size is not one the phone draws a word at.
      if (parseFloat(style.opacity) === 0) continue;
      out.push({
        label: `${el.tagName.toLowerCase()}.${el.className || "-"}`,
        fontSize: parseFloat(style.fontSize),
      });
    }
    return out;
  });
}

/**
 * Focusable elements whose focus cannot be seen, walked with the Tab key.
 *
 * Reading the stylesheet cannot answer it: a rule like
 * `.dock-resize:focus-visible` declares `outline: none` while its replacement
 * sits on `:focus-visible::before`, and a suppression with a replacement looks
 * the same as one without. A scripted `el.focus()` cannot either: the element
 * then matches neither `:focus-visible` nor `:focus`, so every control reads
 * as having no indicator.
 *
 * So this drives the real key. Every candidate's paint is banked while nothing
 * is focused, then Tab walks the page and each stop is compared against its
 * own baseline. Pseudo-elements are part of the comparison: this app puts
 * most of its indicators there.
 */
export async function invisibleFocus(
  page: Page,
  maxStops = 40,
): Promise<Offender[]> {
  const PAINT = `(el, pseudo) => { const s = getComputedStyle(el, pseudo); return [s.outlineStyle,s.outlineWidth,s.outlineColor,s.boxShadow,s.backgroundColor,s.backgroundImage,s.borderColor,s.color,s.opacity,s.transform].join("|"); }`;

  // Bank every candidate's unfocused paint, keyed by an index stamped onto the
  // node so a stop can find its own baseline again.
  await page.evaluate(
    ({ paintSrc }) => {
      const paintOf = eval(paintSrc) as (el: Element, p?: string) => string;
      // The element, its pseudo-elements and two ancestors: this app puts
      // indicators on `::before` (the dock's grip bar) and on a wrapper via
      // `:focus-within` (`.dt-find` sinks its background while the input
      // inside declares `outline: none`). Reading only the focused element
      // calls both a missing indicator.
      const paint = (el: Element) => {
        const parts: string[] = [];
        let node: Element | null = el;
        for (let up = 0; node && up < 3; up++, node = node.parentElement) {
          parts.push(
            paintOf(node),
            paintOf(node, "::before"),
            paintOf(node, "::after"),
          );
        }
        return parts.join("~");
      };
      const selector =
        'button, a[href], [role="button"], [role="separator"], input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const store = new Map<string, string>();
      let n = 0;
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const key = String(n++);
        el.dataset.a11yProbe = key;
        store.set(key, paint(el));
      }
      (window as unknown as { __a11yBase: Map<string, string> }).__a11yBase =
        store;
    },
    { paintSrc: PAINT },
  );

  const found: Offender[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press("Tab");
    // Settled before reading: many of these indicators are transitioned, and a
    // computed style read on the same tick returns the value in flight, so a
    // field that visibly grows on focus reads as unchanged.
    await settleTransitions(page);
    const stop = await page.evaluate(
      ({ paintSrc }) => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const key = el.dataset.a11yProbe;
        if (key === undefined) return null;
        const paintOf = eval(paintSrc) as (e: Element, p?: string) => string;
        const paint = (e: Element) => {
          const parts: string[] = [];
          let node: Element | null = e;
          for (let up = 0; node && up < 3; up++, node = node.parentElement) {
            parts.push(
              paintOf(node),
              paintOf(node, "::before"),
              paintOf(node, "::after"),
            );
          }
          return parts.join("~");
        };
        const base = (
          window as unknown as { __a11yBase: Map<string, string> }
        ).__a11yBase.get(key);
        const r = el.getBoundingClientRect();
        return {
          key,
          changed: base !== paint(el),
          label: `${el.tagName.toLowerCase()}.${el.className || "-"} "${
            el.getAttribute("aria-label") ??
            el.textContent?.trim().slice(0, 24) ??
            ""
          }"`,
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      },
      { paintSrc: PAINT },
    );
    if (!stop) continue;
    if (seen.has(stop.key)) break; // the ring closed; every stop has been seen
    seen.add(stop.key);
    if (!stop.changed)
      found.push({
        label: stop.label,
        width: stop.width,
        height: stop.height,
      });
  }
  return found;
}

/**
 * Focusable elements with no accessible name.
 *
 * To a screen reader an icon-only control is a button called nothing, and
 * tooltips never appear on touch, so on a phone the glyph is the whole label.
 *
 * An approximation of the accessibility tree: `aria-label`, a resolvable
 * `aria-labelledby`, `title`, the element's own text, and an associated or
 * wrapping `<label>`. That is every naming route this codebase uses, so
 * anything reported has none of them.
 */
export async function namelessControls(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const selector =
      'button, a[href], [role="button"], [role="separator"], input:not([type="hidden"]), select, textarea';
    const named = (el: Element): boolean => {
      if (el.getAttribute("aria-label")?.trim()) return true;
      const by = el.getAttribute("aria-labelledby");
      if (
        by &&
        by
          .split(/\s+/)
          .some((id) => document.getElementById(id)?.textContent?.trim())
      )
        return true;
      if (el.getAttribute("title")?.trim()) return true;
      if ((el.textContent ?? "").trim()) return true;
      const id = el.getAttribute("id");
      if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
        return true;
      if (el.closest("label")) return true;
      return false;
    };
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") continue;
      if (named(el)) continue;
      out.push(`${el.tagName.toLowerCase()}.${el.className || "-"}`);
    }
    return out;
  });
}
