// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Widen, { unmappedOf, widenState } from "./Widen";

afterEach(cleanup);

describe("unmappedOf", () => {
  it("counts only a recognised unmapped reason, in the answer's order", () => {
    // Replayed from a chat file: a reason can be anything, and only a
    // summary-shaped gap is one a summary can close.
    expect(
      unmappedOf([
        { sourceId: "node:a", reason: "unmapped" },
        { sourceId: "node:b", reason: "too-large" },
        { sourceId: "node:c", reason: { unmapped: true } },
        { sourceId: "node:d", reason: "unmapped" },
      ]),
    ).toEqual(["node:a", "node:d"]);
  });
});

describe("widenState", () => {
  // The whole domain: nothing skipped, some still missing, none missing.
  it.each([
    [[], [], null],
    [[], ["node:a"], null],
    [["node:a", "node:b"], ["node:b"], "summarise"],
    [["node:a"], [], "outOfDate"],
  ] as const)("%j with %j missing is %s", (unmapped, missing, state) => {
    expect(widenState(unmapped, missing)).toBe(state);
  });
});

describe("Widen", () => {
  it("says the transit before the button, and both only with a button", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <Widen
        note="Note."
        transit="Transit."
        action="Map again"
        onOpen={onOpen}
      />,
    );
    const transit = screen.getByText("Transit.");
    const control = screen.getByRole("button", { name: "Map again" });
    expect(
      transit.compareDocumentPosition(control) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(control);
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(<Widen note="Note." transit="Transit." action="Map again" />);
    // The note is the answer's record and stays; the line describes a click.
    expect(screen.getByText("Note.")).toBeTruthy();
    expect(screen.queryByText("Transit.")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // What no click can widen comes first, its own paragraph, so the button's
  // note stays beside the button it counts for.
  it("says what cannot be widened first, and alone when nothing can", () => {
    const { rerender } = render(
      <Widen
        blocked="Blocked."
        note="Note."
        transit="Transit."
        action="Map again"
        onOpen={vi.fn()}
      />,
    );
    const blocked = screen.getByText("Blocked.");
    expect(blocked.tagName).toBe("P");
    expect(
      blocked.compareDocumentPosition(screen.getByText("Note.")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    rerender(<Widen blocked="Blocked." transit="Transit." />);
    expect(screen.getByText("Blocked.")).toBeTruthy();
    expect(screen.queryByText("Transit.")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
