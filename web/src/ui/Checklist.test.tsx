// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Checklist, { type ChecklistStep } from "./Checklist";

// Pins `Checklist`, the steps that tick themselves (the Library's storage
// setup).

afterEach(() => cleanup());

const steps: ChecklistStep[] = [
  {
    id: "a",
    name: "Local",
    note: "A folder",
    doneNote: "Novels",
    done: true,
    actions: <button>Choose</button>,
  },
  {
    id: "b",
    name: "Remote",
    note: "An account",
    done: false,
    actions: <button>Connect</button>,
    later: <button>Also connect</button>,
  },
];

const draw = (flash?: number) =>
  render(
    <Checklist title="Where" steps={steps} doneLabel="Done" flash={flash} />,
  );

describe("Checklist", () => {
  // A done step says what was settled and offers nothing more to do.
  it("swaps a done step's note and actions for what was settled", () => {
    draw();
    expect(screen.getByText("Novels")).toBeTruthy();
    expect(screen.queryByText("A folder")).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose" })).toBeNull();
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  });

  // The tick is drawn, so a screen reader is told in words.
  it("reads a done step as done", () => {
    draw();
    const [first, second] = screen.getAllByRole("listitem");
    expect(first.textContent).toContain("Local, Done");
    expect(first.dataset.done).toBe("1");
    expect(second.textContent).not.toContain("Done");
  });

  // A locked control pressed twice points twice: a new value replays it.
  it("flashes the steps not done, again on every new value", () => {
    const { rerender } = draw(1);
    const flashes = () => document.querySelectorAll(".ui-checklist-flash");
    expect(flashes()).toHaveLength(1);
    expect(flashes()[0].closest("li")?.dataset.done).toBeUndefined();
    const first = flashes()[0];
    rerender(
      <Checklist title="Where" steps={steps} doneLabel="Done" flash={2} />,
    );
    expect(flashes()[0]).not.toBe(first);
  });

  it("draws no flash until one is asked for", () => {
    draw();
    expect(document.querySelector(".ui-checklist-flash")).toBeNull();
  });

  it("keeps every step drawn when each one is needed", () => {
    draw();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Also connect" })).toBeNull();
  });
});

describe("Checklist where one step is enough", () => {
  const drawOne = (list: ChecklistStep[]) =>
    render(
      <Checklist title="Where" steps={list} doneLabel="Done" oneIsEnough />,
    );

  it("draws every step while nothing is done", () => {
    drawOne(steps.map((step) => ({ ...step, done: false })));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Choose" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Also connect" })).toBeNull();
  });

  // The first tick completes the list: the title and the done step stay, and
  // the other shrinks to its way in.
  it("keeps only the done step once one is done", () => {
    drawOne(steps);
    expect(screen.getByRole("heading", { name: "Where" })).toBeTruthy();
    const [only, ...rest] = screen.getAllByRole("listitem");
    expect(rest).toHaveLength(0);
    expect(only.textContent).toContain("Novels");
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.getByRole("button", { name: "Also connect" })).toBeTruthy();
  });

  it("offers no way in once every step is done", () => {
    drawOne(steps.map((step) => ({ ...step, done: true })));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Also connect" })).toBeNull();
  });

  // A place that exists but cannot be used here stays drawn with its reason
  // and offers nothing, and never completes the list.
  it("draws an unavailable step dimmed, with its reason and no controls", () => {
    drawOne([
      { ...steps[0], done: false },
      { ...steps[1], unavailable: "Needs an account" },
    ]);
    const [, remote] = screen.getAllByRole("listitem");
    expect(remote.getAttribute("data-unavailable")).toBe("1");
    expect(remote.querySelector(".ui-reason")?.textContent).toBe(
      "Needs an account",
    );
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("keeps an unavailable step's name and reason below a complete list", () => {
    drawOne([steps[0], { ...steps[1], unavailable: "Needs an account" }]);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Also connect" })).toBeNull();
    const left = document.querySelector(".ui-checklist-unavailable");
    expect(left?.textContent).toBe("Remote · Needs an account");
    expect(left?.querySelector(".ui-reason")?.textContent).toBe(
      "Needs an account",
    );
  });
});
