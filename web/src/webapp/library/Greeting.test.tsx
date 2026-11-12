// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import Greeting from "./Greeting";
import { typeDuration } from "./typeSchedule";

const TEXT = "Hey Test, here's your library!";

/** No reduced-motion preference, so the typing runs. */
function normalMotion(reduce = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduce })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  normalMotion();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const chars = () => document.querySelectorAll(".greet-char");
const shown = () => document.querySelectorAll('.greet-char[data-on="1"]');
const caret = () => document.querySelector(".greet-caret");

describe("Greeting", () => {
  // The whole sentence at once, however far the typing has got, so a screen
  // reader does not hear letters arriving one by one.
  it("announces the whole sentence from the first frame", () => {
    const { container } = render(<Greeting text={TEXT} />);
    expect(container.querySelector("h1")?.getAttribute("aria-label")).toBe(
      TEXT,
    );
  });

  // The string is not sliced: slicing grows the box on every tick, and a
  // greeting that re-wraps while it types is worse than no animation.
  it("renders every character before any of them has landed", () => {
    render(<Greeting text={TEXT} />);
    expect(chars()).toHaveLength(Array.from(TEXT).length);
    expect(shown()).toHaveLength(0);
  });

  it("writes the sentence out over its schedule", () => {
    render(<Greeting text={TEXT} />);
    act(() => void vi.advanceTimersByTime(typeDuration(TEXT) + 50));
    expect(shown()).toHaveLength(Array.from(TEXT).length);
  });

  it("puts the caret between what is written and what is not", () => {
    render(<Greeting text={TEXT} />);
    act(() => void vi.advanceTimersByTime(100));
    const written = shown().length;
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThan(Array.from(TEXT).length);

    // Everything before the caret is on, everything after it is off.
    const all = [...document.querySelectorAll(".greet-char, .greet-caret")];
    // The caret is rendered from the first frame, between the written and the
    // unwritten letters.
    const theCaret = caret();
    if (theCaret === null) throw new Error("greeting rendered no caret");
    const at = all.indexOf(theCaret);
    expect(
      all.slice(0, at).every((el) => el.getAttribute("data-on") === "1"),
    ).toBe(true);
    expect(
      all.slice(at + 1).every((el) => el.getAttribute("data-on") === "0"),
    ).toBe(true);
  });

  it("puts the caret away once the sentence lands", () => {
    render(<Greeting text={TEXT} />);
    expect(caret()?.getAttribute("data-done")).toBe("0");
    act(() => void vi.advanceTimersByTime(typeDuration(TEXT) + 50));
    expect(caret()?.getAttribute("data-done")).toBe("1");
  });

  // Library re-renders on every shelf update, and the sentence does not
  // restart mid-word each time a card finishes loading.
  it("does not start over when its parent re-renders", () => {
    const { rerender } = render(<Greeting text={TEXT} />);
    act(() => void vi.advanceTimersByTime(200));
    const written = shown().length;

    rerender(<Greeting text={TEXT} className="lib-title" />);
    expect(shown().length).toBe(written);
  });

  it("starts over for a different greeting", () => {
    const { rerender } = render(<Greeting text={TEXT} />);
    act(() => void vi.advanceTimersByTime(typeDuration(TEXT) + 50));

    rerender(<Greeting text="Welcome back, Test!" />);
    expect(shown()).toHaveLength(0);
  });

  // The app renders under StrictMode, which mounts, tears down and re-mounts
  // every effect. A guard that skips the second run leaves every character at
  // opacity 0, and only this row sees it, because Testing Library does not
  // wrap in StrictMode by default.
  it("still writes itself under StrictMode", () => {
    render(
      <StrictMode>
        <Greeting text={TEXT} />
      </StrictMode>,
    );
    act(() => void vi.advanceTimersByTime(typeDuration(TEXT) + 50));
    expect(shown()).toHaveLength(Array.from(TEXT).length);
    expect(caret()?.getAttribute("data-done")).toBe("1");
  });

  it("is simply there when motion is refused", () => {
    cleanup();
    normalMotion(true);
    render(<Greeting text={TEXT} />);
    expect(shown()).toHaveLength(Array.from(TEXT).length);
    expect(caret()?.getAttribute("data-done")).toBe("1");
  });
});
