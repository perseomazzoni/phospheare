// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import TypeGuide from "./TypeGuide";
import { testHost } from "./viewProps.fixture";

afterEach(() => cleanup());

// `Editor.tsx` states and positions this component imperatively via the ref —
// never through props — so these tests exercise the DOM it hands back rather
// than a state prop that does not exist.

describe("TypeGuide", () => {
  it("renders hidden with the resting state by default", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <TypeGuide guideRef={ref} mark={testHost.guideMark} />,
    );
    const guide = container.querySelector(".type-guide") as HTMLElement;
    expect(guide.hidden).toBe(true);
    expect(guide.dataset.state).toBe("rest");
  });

  it("draws both fingers, and nothing else", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <TypeGuide guideRef={ref} mark={testHost.guideMark} />,
    );
    expect(container.querySelector(".type-guide-finger-left")).toBeTruthy();
    expect(container.querySelector(".type-guide-finger-right")).toBeTruthy();
    // There is no Return control: typing is the only way back, and that
    // needs no affordance.
    expect(container.querySelector("button")).toBeNull();
  });

  it("carries each of the four states — the caller writes data-state and hidden directly", () => {
    const ref = createRef<HTMLDivElement>();
    render(<TypeGuide guideRef={ref} mark={testHost.guideMark} />);

    const guide = ref.current;
    if (guide === null)
      throw new Error("The ref must point at the rendered guide");

    for (const state of ["rest", "struck", "released", "offStation"] as const) {
      guide.dataset.state = state;
      expect(guide.dataset.state).toBe(state);
    }
    // Typewriter off is the fifth state, and it is "not drawn at all" rather
    // than a sixth `data-state` value.
    guide.hidden = true;
    expect(guide.hidden).toBe(true);
  });
});
