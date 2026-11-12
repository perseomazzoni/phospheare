// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EditorSkeleton from "./EditorSkeleton";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// The skeleton is the editor's shape before the editor exists, so opening a
// project reads as the editor arriving rather than as a generic wait. The
// command bar has no stand-in, because an empty bar reads as a broken one.

describe("EditorSkeleton", () => {
  it("draws the editor's furniture - panel with dots and measure, no bar", () => {
    render(<EditorSkeleton />);
    expect(document.querySelector(".ed-skeleton-panel")).toBeTruthy();
    expect(document.querySelector(".ed-skeleton-bar")).toBeNull();
    expect(document.querySelector(".ed-skeleton-measure")).toBeTruthy();
  });

  // The tree's own loading figure: three moving dots inside the panel.
  it("carries the loading dots in the structure panel", () => {
    render(<EditorSkeleton />);
    const panel = document.querySelector(".ed-skeleton-panel");
    const dots = panel?.querySelector(".ui-dots");
    expect(dots).toBeTruthy();
    expect(dots?.querySelectorAll("i").length).toBe(3);
  });

  // A stack of identical bars reads as a table; prose has a ragged right edge.
  it("stands in for prose rather than for rows", () => {
    render(<EditorSkeleton />);
    const widths = [
      ...document.querySelectorAll(".ed-skeleton-measure .ui-skeleton"),
    ].map((line) => (line as HTMLElement).style.width);
    expect(widths.length).toBeGreaterThan(2);
    expect(new Set(widths).size).toBeGreaterThan(1);
  });

  // Announced once: the dots are the wait, and the measure is decoration.
  it("says what it is waiting for, exactly once", () => {
    render(<EditorSkeleton />);
    const statuses = screen.getAllByRole("status");
    expect(statuses.length).toBe(1);
    expect(statuses[0].getAttribute("aria-label")).toBe("app.loading");
  });
});
