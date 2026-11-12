// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "./platform";

// The platform contract, against the browser adapter on each OS branch: the
// labels derive from the user agent, and the answers are stable. The adapter
// reads the user agent once per module, so each case loads a fresh copy
// under its own navigator.

async function platformFor(userAgent: string): Promise<Platform> {
  vi.resetModules();
  vi.stubGlobal("navigator", { userAgent });
  return (await import("../adapters/browser")).browserPlatform;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const branches = [
  {
    name: "a Mac",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15",
    mac: true,
    labels: ["⌘", "⌃", "⇧", "⌥"],
  },
  {
    name: "an iPad",
    userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)",
    mac: true,
    labels: ["⌘", "⌃", "⇧", "⌥"],
  },
  {
    name: "Windows",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0",
    mac: false,
    labels: ["Ctrl", "Ctrl", "Shift", "Alt"],
  },
  {
    name: "Linux",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
    mac: false,
    labels: ["Ctrl", "Ctrl", "Shift", "Alt"],
  },
];

describe.each(branches)("the browser platform on $name", (branch) => {
  const labelsOf = (platform: Platform) => [
    platform.modLabel(),
    platform.ctrlLabel(),
    platform.shiftLabel(),
    platform.altLabel(),
  ];

  it("labels the keys for its OS", async () => {
    const platform = await platformFor(branch.userAgent);
    expect(platform.isMac()).toBe(branch.mac);
    expect(labelsOf(platform)).toEqual(branch.labels);
  });

  it("keeps its answer once read", async () => {
    const platform = await platformFor(branch.userAgent);
    const first = platform.isMac();
    vi.stubGlobal("navigator", { userAgent: "something else entirely" });
    for (let i = 0; i < 3; i++) {
      expect(platform.isMac()).toBe(first);
      expect(labelsOf(platform)).toEqual(branch.labels);
    }
  });
});
