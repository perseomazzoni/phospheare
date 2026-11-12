// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import {
  createFaultHandling,
  type Page,
  type ReloadMemory,
} from "./handleFault";
import type { Fault } from "../domain/fault";

// Pins who reports a failure and when the tab reloads by itself: only for a
// stale build, once per window, and never when the reload cannot be
// remembered.

function setUp({
  last = null as number | null,
  stores = true,
  online = true,
} = {}) {
  const reporter = { report: vi.fn() };
  let held = last;
  const memory: ReloadMemory = {
    last: () => held,
    mark: vi.fn((at: number) => {
      if (stores) held = at;
      return stores;
    }),
  };
  const page: Page = {
    reload: vi.fn(),
    online: () => online,
    path: () => "/app/project/abc",
    now: () => 100_000,
  };
  return {
    handling: createFaultHandling({ reporter, memory, page }),
    reporter,
    memory,
    page,
  };
}

const stale: Fault = { kind: "stale-build" };
const unexpected: Fault = { kind: "unexpected" };

describe("fault handling", () => {
  it("reports the thrown value with its kind, site and path", () => {
    const { handling, reporter } = setUp();
    const error = new TypeError("Importing a module script failed.");

    handling.report(error, "react", "\n    at EditorRoute");

    expect(reporter.report).toHaveBeenCalledWith(error, {
      site: "react",
      kind: "stale-build",
      path: "/app/project/abc",
      componentStack: "\n    at EditorRoute",
    });
  });

  it("reads a failure with the page's connectivity", () => {
    const error = new TypeError("Importing a module script failed.");
    expect(setUp({ online: false }).handling.read(error).kind).toBe(
      "unreachable",
    );
  });

  it("reloads once for a stale build, and remembers it", () => {
    const { handling, memory, page } = setUp();

    expect(handling.reloadsItself(stale)).toBe(true);
    expect(handling.reloadOnce(stale)).toBe(true);
    expect(memory.mark).toHaveBeenCalledWith(100_000);
    expect(page.reload).toHaveBeenCalledTimes(1);

    expect(handling.reloadsItself(stale)).toBe(false);
    expect(handling.reloadOnce(stale)).toBe(false);
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload for a stale build met again inside the window", () => {
    const { handling, page } = setUp({ last: 99_000 });
    expect(handling.reloadsItself(stale)).toBe(false);
    expect(handling.reloadOnce(stale)).toBe(false);
    expect(page.reload).not.toHaveBeenCalled();
  });

  it("does not reload when the reload cannot be remembered", () => {
    const { handling, page } = setUp({ stores: false });
    expect(handling.reloadOnce(stale)).toBe(false);
    expect(page.reload).not.toHaveBeenCalled();
  });

  it("never reloads by itself for any other kind", () => {
    const { handling, page } = setUp();
    expect(handling.reloadsItself(unexpected)).toBe(false);
    expect(handling.reloadOnce(unexpected)).toBe(false);
    expect(page.reload).not.toHaveBeenCalled();
  });

  it("reloads when asked", () => {
    const { handling, page } = setUp();
    handling.reload();
    expect(page.reload).toHaveBeenCalledTimes(1);
  });
});
