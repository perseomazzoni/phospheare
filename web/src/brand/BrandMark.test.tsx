// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BrandMark } from "./BrandMark";
import { MARK_HEIGHT, MARK_WIDTH } from "./mark";
import { HOLE_PATH } from "./mark";
import { allThemes } from "../theme";
import webappCss from "../webapp/webapp.css?raw";

afterEach(cleanup);

describe("BrandMark", () => {
  it("draws the figure and the spark, hidden from assistive tech", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg.brand-mark");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".brand-mark-figure")).not.toBeNull();
    expect(container.querySelector(".brand-mark-spark")).not.toBeNull();
  });

  it("keeps the traced frame's proportions at any height", () => {
    const { container } = render(<BrandMark size={64} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("height")).toBe("64");
    expect(Number(svg?.getAttribute("width"))).toBeCloseTo(
      (64 * MARK_WIDTH) / MARK_HEIGHT,
    );
  });

  // The logo is the same for everyone. No look a theme picks may
  // reach the mark, and the mark's own colours may name no theme token, only
  // the page's colour scheme.
  it("is not styled by any theme", async () => {
    for (const theme of allThemes()) {
      const sheet = await theme.sheet();
      expect(sheet, theme.id).not.toMatch(/brand-mark/);
      expect(sheet, theme.id).not.toMatch(/app-logo/);
    }
  });

  it("takes its colours from the colour scheme alone", () => {
    const css = webappCss;
    const rule = (name: string) => {
      const at = css.indexOf(`.${name} {`);
      return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
    };
    for (const name of ["brand-mark-figure", "brand-mark-spark"]) {
      expect(rule(name)).toMatch(/light-dark\(/);
      expect(rule(name)).not.toMatch(/var\(--/);
    }
  });

  // A broken page's mark: the spark is drawn, so it can go out, and
  // the figure is cut by a mask holding the spark's core.
  it("draws a spark that goes out over a hole in the chest", () => {
    const { container } = render(<BrandMark out />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toBe("brand-mark brand-mark-out");
    const figure = container.querySelector(".brand-mark-figure");
    const mask = container.querySelector("mask");
    expect(figure?.getAttribute("mask")).toBe(`url(#${mask?.id})`);
    expect(mask?.querySelector(".brand-mark-hole")?.getAttribute("d")).toBe(
      HOLE_PATH,
    );
    expect(container.querySelector(".brand-mark-spark")).not.toBeNull();
  });

  it("gives each broken mark its own mask", () => {
    const { container } = render(
      <>
        <BrandMark out />
        <BrandMark out />
      </>,
    );
    const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("cuts nothing from a lit mark", () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector("mask")).toBeNull();
    expect(
      container.querySelector(".brand-mark-figure")?.hasAttribute("mask"),
    ).toBe(false);
  });
});
