// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

const installed: (() => void)[] = [];

afterEach(() => {
  installed.splice(0).forEach((uninstall) => uninstall());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the app's log", () => {
  it("records the start, each change of account, and the account on each line", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    // Fake timers would stop the fake IndexedDB too; the prune's timer is
    // found and run by hand instead.
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const { installLog, appLog } = await import("./compose");
    const { setCurrentUserId } = await import("../auth/currentUser");
    const prune = vi.spyOn(appLog, "prune");
    installed.push(installLog());
    setCurrentUserId("acc-1");
    setCurrentUserId(null);
    const later = timeout.mock.calls.find(([, ms]) => ms === 5000);
    expect(later).toBeDefined();
    (later?.[0] as () => void)();
    expect(prune).toHaveBeenCalledOnce();
    const lines = await appLog.read();
    expect(lines.map((e) => [e.area, e.message, e.account])).toEqual([
      ["app", "The app started.", null],
      ["account", "An account is open.", "acc-1"],
      ["account", "No account is open.", null],
    ]);
    expect(lines[0].fields).toHaveProperty("version");
  });

  it("keeps deeper stacks once started", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const limit = (Error as { stackTraceLimit?: number }).stackTraceLimit;
    const { installLog } = await import("./compose");
    installed.push(installLog());
    expect((Error as { stackTraceLimit?: number }).stackTraceLimit).toBe(50);
    (Error as { stackTraceLimit?: number }).stackTraceLimit = limit;
  });

  it("removes the open account's name, emails and Google ids from each line", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.clear();
    const { appLog, accountValues } = await import("./compose");
    const { setCurrentUserId } = await import("../auth/currentUser");
    const { saveWriter } = await import("../writers/registry");
    const { newWriter } = await import("../writers/domain/writer");
    saveWriter({
      ...newWriter(
        "acc-g",
        {
          iss: "https://accounts.google.com",
          sub: "109876543210",
          email: "ada@example.org",
          emailVerified: true,
          name: "Ada Lovelace",
          picture: "https://lh3.example/a/photo",
        },
        new Date(0),
      ),
      drive: {
        connectionId: "conn-secret-1",
        sub: "109876543210",
        email: "ada.drive@example.net",
        scopes: [],
        connectedAt: "1970-01-01T00:00:00.000Z",
      },
    });
    expect(accountValues()).toEqual([]);
    setCurrentUserId("acc-g");
    appLog.warn(
      "test",
      "Lovelace wrote as Ada Lovelace from ada.drive@example.net",
      {
        who: "109876543210",
        photo: "https://lh3.example/a/photo",
        grant: "conn-secret-1",
      },
    );
    const [line] = (await appLog.read()).filter((e) => e.area === "test");
    expect(line.message).toBe("[name] wrote as [name] from [email]");
    expect(line.fields).toEqual({
      who: "[user]",
      photo: "[user]",
      grant: "[secret]",
    });
    expect(line.account).toBe("acc-g");
    setCurrentUserId(null);
    localStorage.clear();
  });

  it("keeps what waits when the tab goes, and writes it at the next start", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.clear();
    const first = await import("./compose");
    const uninstall = first.installLog();
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("pagehide"));
    uninstall();
    // The page is gone before its store answers: the lines wait in the stash.
    expect(localStorage.getItem("writer-log:unwritten")).toContain(
      "The tab was left.",
    );

    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
    const next = await import("./compose");
    installed.push(next.installLog());
    const lines = await next.appLog.read();
    expect(lines.map((e) => e.message)).toEqual([
      "The app started.",
      "The browser is offline.",
      "The browser is online.",
      "The tab was left.",
      "The app started.",
    ]);
    expect(Object.keys(lines[0].fields)).toEqual(
      expect.arrayContaining(["browser", "window", "language"]),
    );
    expect(localStorage.getItem("writer-log:unwritten")).toBeNull();
  });
});
