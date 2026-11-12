// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Release, ReleaseMemory } from "./application/checkForRelease";

// Per device, not per writer: a release is a fact about the program on this
// computer. A private window, a blocked origin or a full quota throws on
// access; then nothing is remembered, and the check asks on each visit.

const CHECK_KEY = "release:check";
const DISMISSED_KEY = "release:dismissed";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept: the next visit asks the feed again.
  }
}

function isRelease(value: unknown): value is Release {
  const r = value as Release | null;
  return typeof r?.tag === "string" && typeof r?.url === "string";
}

export const localReleaseMemory: ReleaseMemory = {
  lastCheck() {
    const raw = read(CHECK_KEY);
    if (raw === null) return null;
    try {
      const { at, release } = JSON.parse(raw) as {
        at?: unknown;
        release?: unknown;
      };
      if (typeof at !== "number" || !Number.isFinite(at)) return null;
      return { at, release: isRelease(release) ? release : null };
    } catch {
      return null;
    }
  },

  rememberCheck(at, release) {
    write(CHECK_KEY, JSON.stringify({ at, release }));
  },

  dismissed() {
    return read(DISMISSED_KEY);
  },

  dismiss(tag) {
    write(DISMISSED_KEY, tag);
  },
};
