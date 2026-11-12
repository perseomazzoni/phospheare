// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { createUpdateReady } from "./updateReady";

// Pins when "A newer version is ready" speaks: after a chunk failed, and
// never while a fault page already says it.

describe("update ready", () => {
  it("is quiet until a chunk fails, then speaks and tells its listeners", () => {
    const ready = createUpdateReady();
    const listener = vi.fn();
    ready.subscribe(listener);

    expect(ready.showing()).toBe(false);
    ready.mark();
    expect(ready.showing()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    ready.mark();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is quiet while a fault page is on screen", () => {
    const ready = createUpdateReady();
    ready.mark();

    const first = ready.pageShown();
    const second = ready.pageShown();
    expect(ready.showing()).toBe(false);

    first();
    first();
    expect(ready.showing()).toBe(false);
    second();
    expect(ready.showing()).toBe(true);
  });

  it("stops telling a listener that unsubscribed", () => {
    const ready = createUpdateReady();
    const listener = vi.fn();
    ready.subscribe(listener)();
    ready.mark();
    expect(listener).not.toHaveBeenCalled();
  });
});
