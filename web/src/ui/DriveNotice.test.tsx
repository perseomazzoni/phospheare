// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DriveNotice from "./DriveNotice";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// Pins the notice for a revoked Drive grant. `user.driveConnected` is the
// writer record's note, and Google never tells the app about a revocation, so
// without the notice a grant revoked mid-session leaves the card, the editor
// and Settings disagreeing about the connection.

describe("when it appears", () => {
  it("says so when Drive refuses a grant the app is still claiming", () => {
    render(<DriveNotice lapsed claimed />);
    expect(screen.getByText("app.driveLapsed")).toBeTruthy();
  });

  it("says nothing while Drive is honouring the grant", () => {
    render(<DriveNotice lapsed={false} claimed />);
    expect(screen.queryByText("app.driveLapsed")).toBeNull();
  });

  it("says nothing to a writer who never connected Drive", () => {
    // With no connection to restore, a notice naming one points at a setting
    // that does not apply. This is also the sign-out case: the claim drops
    // first, and the latch does not outlive it.
    render(<DriveNotice lapsed claimed={false} />);
    expect(screen.queryByText("app.driveLapsed")).toBeNull();
  });
});

describe("what it is", () => {
  it("is an alert, not an attention: nothing improves until the writer acts", () => {
    const { container } = render(<DriveNotice lapsed claimed />);
    const notice = container.querySelector(".drive-notice");
    // `DeviceNotice`'s offline face clears itself when the connection
    // returns; a revoked grant does not come back on its own. The quieter tone
    // would give the two equal weight in the column that shows both.
    expect(notice?.getAttribute("data-tone")).toBe("alert");
  });

  it("carries no live region of its own — the column announces for it", () => {
    // No pill in `StatusNotice` owns a live region: permanent regions in `App`
    // outlive every pill and announce for them, because a region mounted with
    // its first content is unreliably announced. A region here
    // would double every announcement.
    const { container } = render(<DriveNotice lapsed claimed />);
    const notice = container.querySelector(".drive-notice");
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute("role")).toBeNull();
    expect(notice?.getAttribute("aria-live")).toBeNull();
  });

  it("carries no control: the writer cannot dismiss or act on it from here", () => {
    // A standing status is not something to interact with over the
    // manuscript, so the column is `pointer-events: none`. The notice
    // clears itself once Drive accepts a request again.
    const { container } = render(<DriveNotice lapsed claimed />);
    const notice = container.querySelector(".drive-notice");
    expect(notice?.querySelectorAll("button, a, input").length).toBe(0);
  });
});
