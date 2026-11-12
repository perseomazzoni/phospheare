// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Meter, { meterStage } from "./Meter";

// The workspace has no global test setup, so a suite that renders cleans up
// after itself.
afterEach(() => cleanup());

describe("the meter's scale", () => {
  it("climbs normal, ok, warning, danger, error at the scale's own thresholds", () => {
    expect(
      [0, 0.39, 0.4, 0.59, 0.6, 0.79, 0.8, 0.94, 0.95, 1].map(meterStage),
    ).toEqual([
      "normal",
      "normal",
      "ok",
      "ok",
      "warning",
      "warning",
      "danger",
      "danger",
      "error",
      "error",
    ]);
  });
});

describe("Meter", () => {
  it("closes a ring by the share, from twelve o'clock", () => {
    const { container } = render(<Meter shape="ring" share={0.25} />);
    const fill = container.querySelector("circle.ui-meter-fill");
    const whole = Number(fill?.getAttribute("stroke-dasharray"));
    expect(Number(fill?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      whole * 0.75,
    );
    expect(fill?.getAttribute("transform")).toBe("rotate(-90 12 12)");
  });

  it("fills a bar across, on the stage's colour", () => {
    const { container } = render(<Meter shape="bar" share={0.65} />);
    const bar = container.querySelector(".ui-meter");
    expect(bar?.classList.contains("is-warning")).toBe(true);
    expect(bar?.querySelector<HTMLElement>(".ui-meter-fill")?.style.width).toBe(
      "65%",
    );
  });

  it("never draws past its track, whatever it is handed", () => {
    const { container } = render(
      <>
        <Meter shape="bar" share={1.4} />
        <Meter shape="bar" share={-1} />
        <Meter shape="bar" share={Number.NaN} />
      </>,
    );
    expect(
      [...container.querySelectorAll<HTMLElement>(".ui-meter-fill")].map(
        (node) => node.style.width,
      ),
    ).toEqual(["100%", "0%", "0%"]);
  });

  it("is a picture a screen reader skips: the words beside it carry the fact", () => {
    const { container } = render(
      <>
        <Meter shape="ring" share={0.5} />
        <Meter shape="bar" share={0.5} />
      </>,
    );
    for (const node of container.querySelectorAll(".ui-meter"))
      expect(node.getAttribute("aria-hidden")).toBe("true");
  });
});
