// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { preferences as visitorPreferences } from "./compose.demo";

// Pins that a visitor's preferences answer as the synced profile does with
// no writer signed in: no one, the fallback, and nothing kept.

describe("a visitor's preferences", () => {
  it("name no writer and never report a change of writer", () => {
    const listener = vi.fn();
    expect(visitorPreferences.userId()).toBeNull();
    const stop = visitorPreferences.onUserChange(listener);
    stop();
    expect(listener).not.toHaveBeenCalled();
  });

  it("read every preference as its fallback and keep no write", () => {
    visitorPreferences.setPref("language", "it");
    expect(visitorPreferences.getPref("language", null)).toBeNull();
    expect(visitorPreferences.getPref("proseSize", 19)).toBe(19);
  });
});
