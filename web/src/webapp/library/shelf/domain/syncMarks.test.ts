// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { SyncCheckResult } from "../../../../project/sync/check";
import { withConflict, withSynced, withoutSynced } from "./syncMarks";

const result = (conflict: boolean) =>
  ({ verdict: { conflict } }) as unknown as SyncCheckResult;

describe("withConflict", () => {
  it("adds a real conflict and deletes on null or a clean verdict", () => {
    const empty = new Map<string, SyncCheckResult>();
    const one = withConflict(empty, "p", result(true));
    expect(one.has("p")).toBe(true);
    expect(withConflict(one, "p", null).has("p")).toBe(false);
    expect(withConflict(one, "p", result(false)).has("p")).toBe(false);
  });

  it("returns the same map when a delete changes nothing", () => {
    const empty = new Map<string, SyncCheckResult>();
    expect(withConflict(empty, "p", null)).toBe(empty);
  });
});

describe("the synced marks", () => {
  it("add and remove, returning the same set when nothing changes", () => {
    const empty = new Set<string>();
    const one = withSynced(empty, "p");
    expect(one.has("p")).toBe(true);
    expect(withSynced(one, "p")).toBe(one);
    expect(withoutSynced(one, "p").has("p")).toBe(false);
    expect(withoutSynced(empty, "p")).toBe(empty);
  });
});
