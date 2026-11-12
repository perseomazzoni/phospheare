// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NotFoundPage from "./NotFoundPage";
import { FaultHomeProvider } from "./faultHome";

// Pins that an address leading nowhere says so, and leads back to where the
// writer belongs, instead of moving them to the home page.

afterEach(() => cleanup());

describe("the not-found page", () => {
  it("says the page was not found and leads a writer to the Library", () => {
    render(
      <FaultHomeProvider value={() => "library"}>
        <NotFoundPage />
      </FaultHomeProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Page not found",
    );
    expect(
      screen
        .getByRole("link", { name: "Back to the Library" })
        .getAttribute("href"),
    ).toBe("/app");
  });

  it("leads to the home page when the root names no other way back", () => {
    render(<NotFoundPage />);
    expect(
      screen
        .getByRole("link", { name: "Back to the homepage" })
        .getAttribute("href"),
    ).toBe("/");
  });
});
