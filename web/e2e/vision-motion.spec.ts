// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { openFirstLight, openVisionProject } from "./visionProject";

// Vision's leaves ease in and out at the frame's pace: the bar's inked edge
// and shade, and the gold rule laid inside the Dock and the panel. A theme
// switch, under any theme, fades the whole page from the old theme to the
// new.

test.use({ timezoneId: "UTC", locale: "en-US" });

async function open(page: Page, family: "vision" | "matte") {
  await page.setViewportSize({ width: 1198, height: 691 });
  await openVisionProject(page, { variant: "light", text: "section", family });
  await openFirstLight(page);
}

test("Vision's leaves ease in at the frame's pace", async ({ page }) => {
  await open(page, "vision");
  const eased = await page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.transition = "opacity var(--t)";
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    const pace = `${cs.transitionDuration} ${cs.transitionTimingFunction}`;
    probe.remove();
    const read = (selector: string, pseudo?: string) => {
      const style = getComputedStyle(
        document.querySelector(selector)!,
        pseudo ?? null,
      );
      return {
        props: style.transitionProperty,
        paces: style.transitionDuration
          .split(", ")
          .map(
            (d, i) =>
              `${d} ${style.transitionTimingFunction.split(/,\s(?![^(]*\))/)[i]}`,
          ),
      };
    };
    return {
      pace,
      bar: read(".bar-stack .ui-bar"),
      dock: read(".ed-dock", "::after"),
      panel: read(".doc-tree", "::after"),
    };
  });
  expect(eased.bar.props).toBe("border-color, box-shadow");
  expect(eased.dock.props).toBe("opacity");
  expect(eased.panel.props).toBe("opacity");
  for (const part of [eased.bar, eased.dock, eased.panel])
    for (const pace of part.paces) expect(pace).toBe(eased.pace);
});

for (const family of ["vision", "matte"] as const)
  test(`a theme switch fades the page under ${family}`, async ({ page }) => {
    await open(page, family);
    const fade = await page.evaluate(async () => {
      const seen: string[] = [];
      const watch = () => {
        for (const a of document.getAnimations()) {
          const pseudo = (a.effect as KeyframeEffect | null)?.pseudoElement;
          // The root group's own animation moves nothing: the page keeps its size.
          if (pseudo && !pseudo.includes("group"))
            seen.push(`${pseudo} ${(a as CSSAnimation).animationName}`);
        }
      };
      (document.querySelector(".dt-foot-theme") as HTMLElement).click();
      for (let i = 0; i < 20 && seen.length === 0; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        watch();
      }
      return [...new Set(seen)].sort();
    });
    expect(fade).toEqual([
      "::view-transition-new(root) themeFadeIn",
      "::view-transition-old(root) themeFadeOut",
    ]);
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-theme-switching",
      "1",
    );
  });
