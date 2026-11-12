// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import RootFault from "./RootFault";

// Pins the last boundary: a failure above the router, in the providers or the
// notice column, ends on a page instead of a blank one.

vi.mock("../compose", async () => {
  const { createFaultHandling } = await import("../application/handleFault");
  return {
    faults: createFaultHandling({
      reporter: { report: () => {} },
      memory: { last: () => null, mark: () => true },
      page: {
        reload: () => {},
        online: () => true,
        path: () => "/",
        now: () => 1,
      },
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Throws(): never {
  throw new Error("useAuth must be used inside an AuthProvider");
}

describe("the root fault boundary", () => {
  it("renders its children while nothing fails", () => {
    render(
      <RootFault>
        <p>the app</p>
      </RootFault>,
    );
    expect(screen.getByText("the app")).toBeTruthy();
  });

  it("replaces a failed tree with the page, and leads home", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RootFault>
        <Throws />
      </RootFault>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Something went wrong",
    );
    expect(document.body.textContent).not.toMatch(/AuthProvider/);
    expect(
      screen
        .getByRole("link", { name: "Back to the homepage" })
        .getAttribute("href"),
    ).toBe("/");
  });
});
