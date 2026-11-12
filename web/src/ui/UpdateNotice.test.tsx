// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import UpdateNotice from "./UpdateNotice";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// Pins "A newer version is ready": it says so only when shown, and reloads
// only when pressed, since the tab may hold unsaved work.

describe("the update notice", () => {
  it("says nothing until a newer build is known", () => {
    render(<UpdateNotice shown={false} onReload={() => {}} />);
    expect(screen.queryByText("fault.updateNotice")).toBeNull();
  });

  it("says a newer version is ready, as attention", () => {
    const { container } = render(<UpdateNotice shown onReload={() => {}} />);
    expect(screen.getByText("fault.updateNotice")).toBeTruthy();
    expect(
      container.querySelector(".update-notice")?.getAttribute("data-tone"),
    ).toBe("attention");
  });

  it("reloads only when its control is pressed", () => {
    const onReload = vi.fn();
    render(<UpdateNotice shown onReload={onReload} />);
    expect(onReload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("fault.updateNoticeAction"));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
