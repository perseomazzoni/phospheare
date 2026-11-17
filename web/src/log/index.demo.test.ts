// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as real from "./index";
import * as demo from "./index.demo";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the demo site's log", () => {
  it("has every export of the log", () => {
    expect(Object.keys(demo).sort()).toEqual(Object.keys(real).sort());
    expect(Object.keys(demo.appLog).sort()).toEqual(
      Object.keys(real.appLog).sort(),
    );
  });

  it("makes, keeps and shows no line", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    const echo = vi.spyOn(console, "info").mockImplementation(() => {});
    const uninstall = demo.installLog();
    demo.appLog.info("app", "The app started.");
    demo.appLog.warn("sync", "A change did not reach its destination.");
    demo.appLog.error(
      "fault",
      "A failure.",
      demo.describeError(new Error("x")),
    );
    demo.appLog.leave();
    demo.appLog.restore();
    await demo.appLog.flush();
    await demo.appLog.prune();
    await demo.appLog.clear();
    uninstall();
    expect(await demo.appLog.read()).toEqual([]);
    expect(demo.describeError(new Error("A private sentence."))).toEqual({});
    expect(open).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(echo).not.toHaveBeenCalled();
    echo.mockRestore();
  });
});
