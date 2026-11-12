// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, type Locator, type Page } from "@playwright/test";
import {
  openDockFace,
  openFirstLight,
  openVisionProject,
} from "../../e2e/visionProject";
import { bookFiles } from "../../e2e/fixtures/vision/onceDark";
import { CONTINUITY_EXTRA, LANDING_EXTRA } from "./seed";

// ── The screens the landing page shows ───────────────────────────────────────
//
// Each is reached by real clicks from "Once Dark", the way a writer reaches
// it, in whichever theme family and variant the capture asks for.

export type Variant = "light" | "dark";

export interface Surface {
  id: string;
  viewport: { width: number; height: number };
  /** A phone: touch and the mobile flag. */
  phone?: boolean;
  /**
   * One step of a sequence the landing plays in turn: the hand stays where
   * `go` left it, on the control it hovers, and is drawn there.
   */
  pointing?: boolean;
  /**
   * The part of the screen the landing shows: left, top, width and height,
   * as fractions of the viewport. The picture holds that part alone, so a
   * visitor downloads no pixel the page does not show.
   */
  crop?: Crop;
  go: (page: Page, family: string, variant: Variant) => Promise<unknown>;
}

export type Crop = readonly [number, number, number, number];

/** The area a surface is captured from, in CSS pixels. */
export function areaOf({ viewport, crop = [0, 0, 1, 1] }: Surface) {
  const [x, y, w, h] = crop;
  return {
    x: Math.round(viewport.width * x),
    y: Math.round(viewport.height * y),
    width: Math.round(viewport.width * w),
    height: Math.round(viewport.height * h),
  };
}

/** Device pixels per CSS pixel: sharp on a high-density screen. */
export const DPR = 2;

const DESKTOP = { width: 1280, height: 800 };
/** Room for the Dock or the margin beside a page that still reads. */
export const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/**
 * The book's properties with the panels left at other widths, as a writer
 * who dragged them would leave them: a slimmer structure panel, a wider Dock.
 */
function laidOut(ui: Record<string, unknown>): Record<string, string> {
  const props = JSON.parse(bookFiles("section")["document-properties.json"]);
  props.ui = { ...props.ui, ...ui };
  return { "document-properties.json": JSON.stringify(props) };
}

export const DOCKED = laidOut({ structureWidth: 260, dockWidth: 600 });
export const MARGIN = laidOut({ structureWidth: 260 });

const open = (
  page: Page,
  family: string,
  variant: Variant,
  more: Record<string, string> = {},
) =>
  openVisionProject(page, {
    variant,
    text: "section",
    family: family as "matte",
    extra: { ...LANDING_EXTRA, ...more },
  });

export async function section(
  page: Page,
  family: string,
  variant: Variant,
  more?: Record<string, string>,
) {
  await open(page, family, variant, more);
  await openFirstLight(page, { save: false });
  await page.waitForTimeout(300);
}

async function resume(page: Page, family: string, variant: Variant) {
  await open(page, family, variant);
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(
    page.locator(".editor").getByText("Small acts, yes.", { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
}

async function library(page: Page, family: string, variant: Variant) {
  await openVisionProject(page, {
    variant,
    text: "section",
    family: family as "matte",
    extra: LANDING_EXTRA,
    stayInLibrary: true,
  });
}

/** A row of the Dock's open face, by its text. */
const dockRow = (page: Page, text: string) =>
  page.locator(".ed-dock").getByText(text, { exact: true }).first();

/**
 * Hovers a control for real, so it wears its hover state, and draws the
 * hand there: a screenshot has no pointer of its own.
 */
async function pointAt(page: Page, target: Locator) {
  await target.hover();
  const box = await target.boundingBox();
  if (!box) throw new Error("pointAt: the target has no box");
  const x = box.x + Math.min(box.width * 0.4, 48);
  const y = box.y + box.height * 0.6;
  await page.mouse.move(x, y);
  await page.evaluate(
    ([left, top]) => {
      document.getElementById("shot-pointer")?.remove();
      const hand = document.createElement("div");
      hand.id = "shot-pointer";
      hand.style.cssText = `position:fixed;left:${left}px;top:${top}px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 2px rgb(0 0 0 / 0.45))`;
      hand.innerHTML =
        '<svg width="18" height="24" viewBox="0 0 18 24"><path d="M1.5 1.5v18l4.6-4.4 3.3 7.4 3.2-1.4-3.3-7.3h6.4z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      document.body.append(hand);
    },
    [x, y],
  );
  await page.waitForTimeout(300);
}

/**
 * The editor with Henosis at one of its states, as `useHenosis` sets it.
 * `fading` is an animation, which a still capture catches at its start, so
 * each fading step holds the controls at the opacity the fade has reached.
 */
const henosis =
  (state: "off" | "fading" | "full", reached = 1) =>
  async (page: Page, family: string, variant: Variant) => {
    await section(page, family, variant);
    if (state !== "off")
      await page.evaluate(
        ([value, opacity]) => {
          const shell = document.querySelector<HTMLElement>(".editor-shell")!;
          shell.setAttribute("data-henosis", String(value));
          if (value === "fading")
            for (const part of shell.querySelectorAll<HTMLElement>(
              ".doc-tree, .dt-collapse, .chrome, .cm-layer, .save-gutter",
            )) {
              part.style.animation = "none";
              part.style.opacity = String(opacity);
            }
        },
        [state, reached] as const,
      );
    await page.waitForTimeout(800);
  };

/** Two Sections of Ki ticked in the structure panel, ready to move. */
async function ticked(page: Page, family: string, variant: Variant) {
  await section(page, family, variant, MARGIN);
  for (const title of ["The Dark", "The First Light"])
    await page
      .getByRole("checkbox", { name: `Select “${title}”` })
      .check({ force: true });
  await page.waitForTimeout(300);
}

const treeRow = (page: Page, title: string) =>
  page
    .getByRole("treegrid")
    .getByRole("row")
    .filter({ hasText: title })
    .first();

/** The ticked Sections' row menu, open. */
async function moveMenu(page: Page, family: string, variant: Variant) {
  await ticked(page, family, variant);
  const row = treeRow(page, "The First Light");
  await row.hover();
  await row.locator(".dt-more").click();
}

/** The places the ticked Sections can go, shown in the panel. */
async function landings(page: Page, family: string, variant: Variant) {
  await moveMenu(page, family, variant);
  await page.getByRole("menuitem", { name: "Move…" }).click();
}

const MOVE_TARGET = "After “The Memory of Water”";

/** The persona dialog, open from the Dock's chat. */
async function personaDialog(page: Page, family: string, variant: Variant) {
  await section(page, family, variant, DOCKED);
  await openDockFace(page, "ask");
  await page.locator(".ai-persona").click();
  await expect(page.locator(".ai-persona-dialog")).toBeVisible();
}

const personaRow = (page: Page, name: string) =>
  page
    .locator(".ai-persona-dialog .ai-persona-option")
    .filter({ hasText: name })
    .first();

/** The dialog with Spark picked, its reading approaches listed. */
async function sparkPicked(page: Page, family: string, variant: Variant) {
  await personaDialog(page, family, variant);
  await personaRow(page, "Spark").click();
  await page.waitForTimeout(300);
}

/** A sequence keeps one frame on every step. */
const STRUCTURE_CROP: Crop = [0, 0, 0.72, 0.8];
const PERSONAS_CROP: Crop = [0.335, 0.15, 0.33, 0.7];

export const SURFACES: Surface[] = [
  { id: "section", viewport: DESKTOP, go: section },
  {
    id: "autosave",
    viewport: DESKTOP,
    crop: [0.006, 0.53, 0.235, 0.24],
    go: async (page, f, v) => {
      await section(page, f, v);
      await page.getByRole("button", { name: "Writing preferences" }).click();
      await expect(
        page.getByRole("checkbox", { name: "Autosave", exact: true }),
      ).toBeVisible();
    },
  },
  { id: "desk", viewport: DESKTOP, go: open },
  // Henosis as it happens: the controls in view, then fading as the writer
  // keeps writing, then gone.
  { id: "henosis-1", viewport: DESKTOP, go: henosis("off") },
  { id: "henosis-2", viewport: DESKTOP, go: henosis("fading", 0.7) },
  { id: "henosis-3", viewport: DESKTOP, go: henosis("fading", 0.4) },
  { id: "henosis-4", viewport: DESKTOP, go: henosis("fading", 0.1) },
  { id: "henosis-5", viewport: DESKTOP, go: henosis("full") },
  // Moving two Sections at once: ticked, Move…, where they can go, moved.
  {
    id: "structure-1",
    viewport: WIDE,
    crop: STRUCTURE_CROP,
    pointing: true,
    go: async (page, f, v) => {
      await ticked(page, f, v);
      const row = treeRow(page, "The First Light");
      await row.hover();
      await pointAt(page, row.locator(".dt-more"));
    },
  },
  {
    id: "structure-2",
    viewport: WIDE,
    crop: STRUCTURE_CROP,
    pointing: true,
    go: async (page, f, v) => {
      await moveMenu(page, f, v);
      await pointAt(page, page.getByRole("menuitem", { name: "Move…" }));
    },
  },
  {
    id: "structure-3",
    viewport: WIDE,
    crop: STRUCTURE_CROP,
    pointing: true,
    go: async (page, f, v) => {
      await landings(page, f, v);
      await pointAt(page, page.getByRole("button", { name: MOVE_TARGET }));
    },
  },
  {
    id: "structure-4",
    viewport: WIDE,
    crop: STRUCTURE_CROP,
    go: async (page, f, v) => {
      await landings(page, f, v);
      await page.getByRole("button", { name: MOVE_TARGET }).click();
      await page.waitForTimeout(600);
    },
  },
  {
    id: "reference",
    viewport: WIDE,
    crop: [0.578, 0.045, 0.417, 0.73],
    go: async (page, f, v) => {
      await section(page, f, v, DOCKED);
      await openDockFace(page, "reference");
      await dockRow(page, "Mirai").click();
      // The reader at the inner life, where the template asks its hardest
      // questions and the answers sit under them.
      await page
        .locator(".ed-dock")
        .getByText("The deep wound — the ghost:", { exact: false })
        .first()
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "summaries",
    viewport: WIDE,
    crop: [0.58, 0.08, 0.415, 0.55],
    go: async (page, f, v) => {
      await section(page, f, v, DOCKED);
      await openDockFace(page, "reference");
      await page
        .locator(".ed-dock")
        .getByRole("button", { name: /^Summaries \d/ })
        .click();
      await dockRow(page, "The First Light").click();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "comments",
    viewport: WIDE,
    crop: [0.235, 0.405, 0.715, 0.325],
    go: async (page, f, v) => {
      await section(page, f, v, MARGIN);
      // The thread Spark answered, made the active one.
      await page
        .getByRole("article", { name: "Comment" })
        .filter({ hasText: "@Spark" })
        .click();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "letter",
    viewport: WIDE,
    crop: [0.578, 0.045, 0.417, 0.67],
    go: async (page, f, v) => {
      await section(page, f, v, DOCKED);
      await openDockFace(page, "ask");
      // The revision plan the letter ends in, unfolded above it.
      await page
        .locator(".ed-dock")
        .getByText(/^Revision plan/)
        .click();
      await page.waitForTimeout(400);
    },
  },
  // Choosing an editor: the pointer runs down the editors and each face
  // shows as it passes, Spark is picked, then one of Spark's reading
  // approaches.
  ...["Phos", "Nova", "Spark"].map((name, index): Surface => ({
    id: `personas-${index + 1}`,
    viewport: WIDE,
    crop: PERSONAS_CROP,
    pointing: true,
    go: async (page, f, v) => {
      await personaDialog(page, f, v);
      await pointAt(page, personaRow(page, name));
    },
  })),
  {
    id: "personas-4",
    viewport: WIDE,
    crop: PERSONAS_CROP,
    pointing: true,
    go: async (page, f, v) => {
      await sparkPicked(page, f, v);
      await pointAt(page, personaRow(page, "Spark"));
    },
  },
  {
    id: "personas-5",
    viewport: WIDE,
    crop: PERSONAS_CROP,
    pointing: true,
    go: async (page, f, v) => {
      await sparkPicked(page, f, v);
      await pointAt(
        page,
        page.locator(".ai-persona-focus .ai-persona-option").nth(1),
      );
    },
  },
  {
    id: "continuity",
    viewport: WIDE,
    crop: [0.578, 0.045, 0.417, 0.385],
    go: async (page, f, v) => {
      await section(page, f, v, { ...DOCKED, ...CONTINUITY_EXTRA });
      await openDockFace(page, "ask");
      await expect(
        page
          .locator(".ed-dock")
          .getByText("Mirai and the river", { exact: true }),
      ).toBeVisible();
    },
  },
  { id: "phone", viewport: PHONE, phone: true, go: resume },
  { id: "phone-desk", viewport: PHONE, phone: true, go: open },
  { id: "phone-library", viewport: PHONE, phone: true, go: library },
];
