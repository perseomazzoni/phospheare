// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { holdOpenWork, writeOpenWork } from "./openWork";

afterEach(() => vi.useRealTimers());

describe("preserving open work", () => {
  it("reports a save failure rather than authorizing a destructive transition", async () => {
    const release = holdOpenWork(async () => false);
    try {
      expect(await writeOpenWork()).toBe(false);
    } finally {
      release();
    }
  });
  it("treats a timeout as unpreserved work", async () => {
    vi.useFakeTimers();
    const release = holdOpenWork(() => new Promise(() => {}));
    try {
      const result = writeOpenWork();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await result).toBe(false);
    } finally {
      release();
    }
  });
  it("reports a rejected write without discarding the holder", async () => {
    const release = holdOpenWork(async () => {
      throw new Error("No space");
    });
    try {
      expect(await writeOpenWork()).toBe(false);
    } finally {
      release();
    }
  });
  it("confirms when every holder resolves without refusing", async () => {
    const release = holdOpenWork(async () => undefined);
    try {
      expect(await writeOpenWork()).toBe(true);
    } finally {
      release();
    }
  });
});
