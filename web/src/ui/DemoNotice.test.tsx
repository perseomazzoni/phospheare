// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DemoNotice, { DEMO_NOTICE_REGION_ID } from "./DemoNotice";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// Pins the demo's "nothing here is saved": said on each open until closed,
// with the download only where the root gives one.

describe("the demo notice", () => {
  it("says nothing is saved, as attention, with no download by default", () => {
    const { container } = render(<DemoNotice />);
    expect(screen.getByText("demoNotice.body")).toBeTruthy();
    expect(
      container.querySelector(".demo-notice")?.getAttribute("data-tone"),
    ).toBe("attention");
    expect(screen.queryByText("demoNotice.download")).toBeNull();
  });

  it("links the download when the root gives one", () => {
    render(<DemoNotice downloadUrl="https://example.org/releases" />);
    const link = screen.getByRole("link", { name: "demoNotice.download" });
    expect(link.getAttribute("href")).toBe("https://example.org/releases");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("speaks through the root's region while shown, and empties it when closed", () => {
    const region = document.createElement("span");
    region.id = DEMO_NOTICE_REGION_ID;
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
    try {
      render(<DemoNotice downloadUrl="https://example.org/releases" />);
      expect(region.textContent).toBe(
        "demoNotice.body demoNotice.reset demoNotice.download",
      );
      fireEvent.click(screen.getByRole("button", { name: "demoNotice.close" }));
      expect(region.textContent).toBe("");
    } finally {
      region.remove();
    }
  });

  it("goes when closed, and comes back on the next open", () => {
    const first = render(<DemoNotice />);
    fireEvent.click(screen.getByRole("button", { name: "demoNotice.close" }));
    expect(screen.queryByText("demoNotice.body")).toBeNull();
    first.unmount();

    render(<DemoNotice />);
    expect(screen.getByText("demoNotice.body")).toBeTruthy();
  });
});
