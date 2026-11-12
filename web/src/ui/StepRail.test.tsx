// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import StepRail from "./StepRail";

// Pins `StepRail`, the wizards' progress rail.

afterEach(() => {
  cleanup();
});

const states = () =>
  [...document.querySelectorAll(".ui-step-dot")].map((dot) =>
    dot.getAttribute("data-state"),
  );

describe("StepRail", () => {
  it("draws one station per step, and no words: the heading asks the step", () => {
    const { container } = render(<StepRail count={3} current={1} />);
    expect(states()).toEqual(["done", "current", "upcoming"]);
    // No "2 / 3" count either: the fill is the confirmation.
    expect(container.textContent).toBe("");
  });

  it("fills the current station's share of the track", () => {
    render(<StepRail count={5} current={2} />);
    // The style engine does the arithmetic: 2 of 4 stations is half the track.
    const fill = document.querySelector<HTMLElement>(".ui-steps-fill");
    expect(fill?.style.width).toBe("calc(0.5 * (100% - 4px))");
  });

  it("leaves a tail over the track the spark crossed, once per move, either way", () => {
    const { rerender } = render(<StepRail count={5} current={1} />);
    const comet = () => document.querySelector<HTMLElement>(".ui-steps-comet");
    // Standing still, there is no tail.
    expect(comet()).toBeNull();
    rerender(<StepRail count={5} current={3} />);
    expect(comet()?.dataset.dir).toBe("on");
    // Moving on draws a tail, and the fill follows it in.
    expect(document.querySelector<HTMLElement>(".ui-steps")?.dataset.dir).toBe(
      "on",
    );
    expect(comet()?.style.left).toBe("calc(2px + 0.25 * (100% - 4px))");
    expect(comet()?.style.width).toBe("calc(0.5 * (100% - 4px))");
    // A second move draws a new tail, not the first one stretched.
    const first = comet();
    rerender(<StepRail count={5} current={2} />);
    expect(comet()).not.toBe(first);
    expect(comet()?.dataset.dir).toBe("back");
    expect(document.querySelector<HTMLElement>(".ui-steps")?.dataset.dir).toBe(
      "back",
    );
    expect(comet()?.style.left).toBe("calc(2px + 0.5 * (100% - 4px))");
    expect(document.querySelectorAll(".ui-steps-comet")).toHaveLength(1);
  });

  // The export's Pages step comes and goes with the format, so a rail can be
  // one step long for a moment; dividing by zero would draw `NaN`.
  it("never divides by zero on a one-step rail", () => {
    render(<StepRail count={1} current={0} />);
    const fill = document.querySelector<HTMLElement>(".ui-steps-fill");
    expect(fill?.style.width).toBe("calc(0 * (100% - 4px))");
  });
});
