// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { newerRelease, versionLabel } from "./version";

// The cases of `desktop/internal/domain/version_test.go`, so the app and the
// desktop program order releases the same way.

describe("newerRelease", () => {
  it.each([
    ["v1.4.0", "1.3.9", true, true],
    ["v1.3.0", "v1.3.0", false, true],
    ["v1.2.0", "1.10.0", false, true],
    ["v2.0.0-rc.1", "1.9.9", true, true],
    ["v1.0.0", "dev", false, false],
    ["v1.3.0", "1.3.0-rc.2", true, true],
    ["v1.3.0-rc.2", "1.3.0", false, true],
    ["v1.3.0-rc.2", "1.3.0-rc.1", true, true],
    ["v1.3.0-rc.10", "1.3.0-rc.9", true, true],
    ["v1.3.0-rc.1", "1.3.0-beta.4", true, true],
    ["v1.3.0-rc.1.1", "1.3.0-rc.1", true, true],
    ["v1.3.0-1", "1.3.0-alpha", false, true],
    ["v1.3.0+build.5", "1.3.0", false, true],
    ["v1.3.0-", "1.2.0", false, false],
    ["v1.3", "1.2.0", false, false],
    ["v1.x.0", "1.2.0", false, false],
  ])("%s against %s", (latest, current, newer, known) => {
    expect(newerRelease(latest, current)).toEqual({ newer, known });
  });
});

describe("versionLabel", () => {
  it("drops the tag's v", () => {
    expect(versionLabel("v1.2.0")).toBe("1.2.0");
    expect(versionLabel("1.2.0-rc.1")).toBe("1.2.0-rc.1");
  });
});
