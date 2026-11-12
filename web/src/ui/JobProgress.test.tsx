// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import JobProgress from "./JobProgress";

// Pins `JobProgress`, a job's own progress face.

afterEach(() => {
  cleanup();
});

const states = () =>
  [...document.querySelectorAll(".ui-job-seg")].map((seg) =>
    seg.getAttribute("data-state"),
  );

describe("JobProgress", () => {
  it("draws one segment per step and names the running one", () => {
    render(<JobProgress steps={["Folder", "Files", "Card"]} current={1} />);
    expect(states()).toEqual(["done", "current", "upcoming"]);
    expect(screen.getByText("Files")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
  });

  it("shows a counter beside the step only when there is one", () => {
    const { rerender } = render(
      <JobProgress steps={["Folder", "Files"]} current={1} />,
    );
    expect(document.querySelector(".ui-job-count")).toBeNull();
    rerender(
      <JobProgress steps={["Folder", "Files"]} current={1} detail="12 of 80" />,
    );
    expect(screen.getByText("12 of 80")).toBeTruthy();
  });
});
