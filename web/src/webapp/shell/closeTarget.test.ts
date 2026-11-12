// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { closeTarget } from "./closeTarget";

describe("closeTarget", () => {
  it("goes back when the sheet was opened from the Library", () => {
    expect(closeTarget({ fromLibrary: true })).toEqual({ back: true });
  });

  // A deep link, a bookmark, a fresh tab. Going back would leave the writer
  // wherever they were before the app, or on a blank tab.
  it("goes to the shelf when there is nothing behind it", () => {
    expect(closeTarget(null)).toEqual({ to: "/app" });
    expect(closeTarget(undefined)).toEqual({ to: "/app" });
    expect(closeTarget({})).toEqual({ to: "/app" });
  });

  // Location state survives a reload and can hold anything another build put
  // there, so only the exact flag counts.
  it("treats anything but the flag itself as a deep link", () => {
    expect(closeTarget({ fromLibrary: "yes" })).toEqual({ to: "/app" });
    expect(closeTarget({ fromLibrary: 1 })).toEqual({ to: "/app" });
    expect(closeTarget({ fromLibrary: false })).toEqual({ to: "/app" });
    expect(closeTarget("fromLibrary")).toEqual({ to: "/app" });
    expect(closeTarget(["fromLibrary"])).toEqual({ to: "/app" });
    expect(closeTarget(42)).toEqual({ to: "/app" });
  });
});
