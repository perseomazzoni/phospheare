// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConnectionBanner, connectionBannerVisible } from "./connectionBanner";

// Pins the banner's shared shape: it speaks only for the store in view, and
// only with something behind it. The three causes and their copy are covered
// in `Library.test.tsx`.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

describe("connectionBannerVisible", () => {
  it("speaks under the store's own filter and under All", () => {
    expect(connectionBannerVisible("all", "local", true)).toBe(true);
    expect(connectionBannerVisible("local", "local", true)).toBe(true);
  });

  it("never speaks over the other store's shelf", () => {
    expect(connectionBannerVisible("drive", "local", true)).toBe(false);
  });

  it("stays silent with nothing behind it", () => {
    expect(connectionBannerVisible("all", "local", false)).toBe(false);
  });
});

describe("ConnectionBanner", () => {
  const props = {
    connectionId: "local",
    filter: "all" as const,
    behind: true,
    icon: "mark" as const,
    copy: "library.localDisconnectedBanner",
    actionLabel: "library.chooseLocalFolder",
    onAction: vi.fn(),
  };

  it("renders the copy and the one action when its rules pass", () => {
    render(<ConnectionBanner {...props} />);
    expect(screen.getByText("library.localDisconnectedBanner")).toBeTruthy();
    screen.getByRole("button", { name: "library.chooseLocalFolder" }).click();
    expect(props.onAction).toHaveBeenCalled();
  });

  it("renders nothing when the other store is in view", () => {
    render(<ConnectionBanner {...props} filter="drive" />);
    expect(screen.queryByText("library.localDisconnectedBanner")).toBeNull();
  });

  it("renders nothing when nothing is behind it", () => {
    render(<ConnectionBanner {...props} behind={false} />);
    expect(screen.queryByText("library.localDisconnectedBanner")).toBeNull();
  });
});
