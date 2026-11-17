// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../domain/line";
import { KEEP_MS } from "../domain/retention";
import {
  createLogger,
  describe as describeError,
  type LineStash,
  type LogStore,
  type StoredLine,
} from "./logger";

/** A store in memory, which records what the logger asks of it. */
function memoryStore() {
  const lines: StoredLine[] = [];
  const store = {
    lines,
    appends: 0,
    prunes: [] as number[],
    fail: false,
    append: vi.fn(async (batch: readonly StoredLine[]) => {
      if (store.fail) throw new Error("quota");
      store.appends++;
      lines.push(...batch);
    }),
    read: vi.fn(async (): Promise<LogEntry[]> => {
      if (store.fail) throw new Error("closed");
      return lines.map((l) => l.entry);
    }),
    prune: vi.fn(async (before: number) => {
      if (store.fail) throw new Error("closed");
      store.prunes.push(before);
    }),
    clear: vi.fn(async () => {
      lines.length = 0;
    }),
  };
  return store satisfies LogStore;
}

function setUp(account: string | null = "acc-1") {
  const store = memoryStore();
  const timers: (() => void)[] = [];
  const echo = vi.fn();
  const log = createLogger({
    store,
    now: () => 1_000_000,
    account: () => account,
    known: () => [{ value: "Ada Lovelace", as: "[user]" }],
    later: (run) => timers.push(run),
    echo,
  });
  const tick = () => timers.splice(0).forEach((run) => run());
  return { store, log, tick, echo };
}

function memoryStash() {
  let held: StoredLine[] = [];
  return {
    get held() {
      return held;
    },
    save: (lines: readonly StoredLine[]) => void (held = [...held, ...lines]),
    take: () => held.splice(0),
  } satisfies LineStash & { held: StoredLine[] };
}

describe("the logger as the page goes", () => {
  it("puts what waits and what the store has not confirmed in the stash", async () => {
    const store = memoryStore();
    let answer: () => void = () => {};
    store.append.mockImplementationOnce(
      (batch) =>
        new Promise<void>((resolve) => {
          answer = () => {
            store.lines.push(...batch);
            resolve();
          };
        }),
    );
    const stash = memoryStash();
    const log = createLogger({
      store,
      now: () => 1,
      account: () => null,
      known: () => [],
      later: () => {},
      stash,
    });
    log.error("fault", "A failure: crash.");
    log.info("app", "The tab was left.");
    log.leave();
    expect(stash.held.map((l) => l.entry.message)).toEqual([
      "A failure: crash.",
      "The tab was left.",
    ]);
    await vi.waitFor(() => expect(store.append).toHaveBeenCalled());
    answer();
    await log.flush();
    // Taken back at the next start, before anything that start writes.
    const next = createLogger({
      store: memoryStore(),
      now: () => 2,
      account: () => null,
      known: () => [],
      later: () => {},
      stash,
    });
    next.restore();
    next.info("app", "The app started.");
    expect((await next.read()).map((e) => e.message)).toEqual([
      "A failure: crash.",
      "The tab was left.",
      "The app started.",
    ]);
    expect(stash.held).toEqual([]);
  });

  it("writes what waits as usual with no stash, and a clear empties the stash", async () => {
    const { store, log } = setUp();
    log.info("app", "The tab was left.");
    log.leave();
    await log.flush();
    expect(store.lines).toHaveLength(1);

    const stash = memoryStash();
    stash.save([{ entry: store.lines[0].entry, size: 1 }]);
    const withStash = createLogger({
      store: memoryStore(),
      now: () => 1,
      account: () => null,
      known: () => [],
      later: () => {},
      stash,
    });
    await withStash.clear();
    expect(stash.held).toEqual([]);
  });

  it("survives a stash that refuses", () => {
    const log = createLogger({
      store: memoryStore(),
      now: () => 1,
      account: () => null,
      known: () => [],
      later: () => {},
      stash: {
        save: () => {
          throw new Error("quota");
        },
        take: () => {
          throw new Error("blocked");
        },
      },
    });
    log.info("app", "The tab was left.");
    expect(() => log.leave()).not.toThrow();
    expect(() => log.restore()).not.toThrow();
  });
});

describe("the logger", () => {
  it("batches lines and writes them together", async () => {
    const { store, log, tick } = setUp();
    log.info("app", "The app started.", { version: "1.0" });
    log.warn("sync", "A change did not reach its destination.");
    expect(store.appends).toBe(0);
    tick();
    await log.flush();
    expect(store.appends).toBe(1);
    expect(store.lines.map((l) => l.entry.message)).toEqual([
      "The app started.",
      "A change did not reach its destination.",
    ]);
  });

  it("writes an error at once", async () => {
    const { store, log } = setUp();
    log.error("fault", "A failure: crash.");
    await log.flush();
    expect(store.appends).toBe(1);
  });

  it("redacts the message and the text fields, and keeps the account", async () => {
    const { store, log, echo } = setUp();
    log.error("identity", "Ada Lovelace at ada@example.test", {
      call: "/session?code=xyz",
      status: 503,
      gone: null,
      unset: undefined,
    });
    await log.flush();
    const { entry, size } = store.lines[0];
    expect(entry).toMatchObject({
      at: 1_000_000,
      level: "error",
      area: "identity",
      message: "[user] at [email]",
      account: "acc-1",
      fields: { call: "/session?code=[secret]", status: 503 },
    });
    expect(Object.keys(entry.fields)).toEqual(["call", "status"]);
    expect(size).toBeGreaterThan(entry.message.length);
    expect(echo).toHaveBeenCalledWith(entry);
  });

  it("names no account before one is open", async () => {
    const { store, log } = setUp(null);
    log.error("app", "Early.");
    await log.flush();
    expect(store.lines[0].entry.account).toBeNull();
  });

  it("loses lines a failing store refuses, and goes on", async () => {
    const { store, log } = setUp();
    store.fail = true;
    log.error("app", "Lost.");
    await expect(log.flush()).resolves.toBeUndefined();
    await expect(log.read()).resolves.toEqual([]);
    await expect(log.prune()).resolves.toBeUndefined();
    store.fail = false;
    log.error("app", "Kept.");
    await log.flush();
    expect(store.lines.map((l) => l.entry.message)).toEqual(["Kept."]);
  });

  it("drops old lines every few hundred lines and when asked", async () => {
    const { store, log, tick } = setUp();
    for (let i = 0; i < 500; i++) log.info("app", `Line ${i}.`);
    tick();
    await log.flush();
    expect(store.prunes).toEqual([1_000_000 - KEEP_MS]);
    await log.prune();
    expect(store.prunes).toHaveLength(2);
  });

  it("reads what waits too, and clears everything", async () => {
    const { store, log } = setUp();
    log.info("app", "Waiting.");
    expect((await log.read()).map((e) => e.message)).toEqual(["Waiting."]);
    log.info("app", "Not yet written.");
    await log.clear();
    expect(store.lines).toEqual([]);
    await log.flush();
    expect(store.lines).toEqual([]);
  });

  it("describes what was thrown", () => {
    const error = new TypeError("bad");
    error.stack = "TypeError: bad\n    at run (app.js:1:2)";
    expect(describeError(error)).toEqual({
      error: "TypeError: bad",
      stack: "    at run (app.js:1:2)",
    });
    const bare = new Error("no stack");
    bare.stack = undefined;
    expect(describeError(bare)).toEqual({ error: "Error: no stack" });
    expect(describeError(new RangeError(""))).toMatchObject({
      error: "RangeError",
    });
    expect(describeError("plain")).toEqual({ error: "plain" });
  });

  it("keeps out what a JSON parse failure quotes of the text", () => {
    let thrown: unknown;
    try {
      JSON.parse("Hello my novel begins");
    } catch (error) {
      thrown = error;
    }
    const fields = describeError(thrown);
    expect(fields.error).toBe("SyntaxError");
    expect(JSON.stringify(fields)).not.toContain("Hello");
  });

  it("keeps the string code an error carries", () => {
    const refused = Object.assign(new Error("The window was closed."), {
      name: "PlatformError",
      code: "flow-cancelled",
    });
    refused.stack = undefined;
    expect(describeError(refused)).toEqual({
      error: "PlatformError: The window was closed.",
      code: "flow-cancelled",
    });
    const numbered = Object.assign(new Error("old"), { code: 8 });
    numbered.stack = undefined;
    expect(describeError(numbered)).toEqual({ error: "Error: old" });
  });

  it("keeps a stack's frames and drops the message it repeats", () => {
    const error = new Error("first line\nsecond line names a draft");
    error.stack =
      "Error: first line\nsecond line names a draft\n    at a (x.js:1:1)\n    at b (x.js:2:2)";
    expect(describeError(error).stack).toBe(
      "    at a (x.js:1:1)\n    at b (x.js:2:2)",
    );
    // Firefox and Safari write no header; the frames stay as they are.
    error.stack = "a@x.js:1:1\nb@x.js:2:2";
    expect(describeError(error).stack).toBe("a@x.js:1:1\nb@x.js:2:2");
  });

  it("logs a loggable error's own fields, never its message", () => {
    class PathError extends Error {
      constructor() {
        super("Could not save /My Novel/document/chapter-one.md.");
        this.name = "PathError";
        this.stack = `PathError: ${this.message}\n    at save (x.js:1:1)`;
      }
      toLog() {
        return { code: "io" };
      }
    }
    const fields = describeError(new PathError());
    expect(fields).toEqual({
      error: "PathError",
      code: "io",
      stack: "    at save (x.js:1:1)",
    });
    expect(JSON.stringify(fields)).not.toContain("Novel");
    // A stack with no frame is only the header, which holds the message.
    const bare = new PathError();
    bare.stack = `PathError: ${bare.message}`;
    expect(describeError(bare)).toEqual({ error: "PathError", code: "io" });
  });

  // The app builds for ES2020, whose types have no `cause` option and no
  // AggregateError, so the tests set both as the engine does.
  const caused = <E extends Error>(error: E, cause: unknown): E =>
    Object.assign(error, { cause });

  it("follows the causes, nearest first, as far as three", () => {
    const below = caused(
      new Error("b"),
      caused(new Error("c"), new Error("d")),
    );
    below.stack = "Error: b\n    at below (x.js:2:2)";
    const first = caused(new TypeError("a"), below);
    first.stack = "TypeError: a\n    at top (x.js:1:1)";
    const fields = describeError(first);
    expect(fields.cause).toBe("Error: b ← Error: c ← Error: d");
    expect(fields.causeStack).toBe("    at below (x.js:2:2)");
    const four = caused(
      new Error("top"),
      caused(
        new Error("1"),
        caused(new Error("2"), caused(new Error("3"), "4")),
      ),
    );
    expect(describeError(four).cause).toBe("Error: 1 ← Error: 2 ← Error: 3");
  });

  it("names the errors inside an AggregateError", () => {
    const all = Object.assign(new Error("all failed"), {
      name: "AggregateError",
      errors: [
        new Error("one"),
        new TypeError("two"),
        "three",
        new Error("four"),
      ],
    });
    expect(describeError(all).errors).toBe(
      "Error: one | TypeError: two | three",
    );
  });

  it("names a thrown value that is not an Error by its kind and codes", () => {
    expect(describeError(new Event("error")).error).toBe("Event (type error)");
    expect(
      describeError({ status: 503, message: "a private sentence" }).error,
    ).toBe("Object (status 503)");
    expect(describeError(Object.create(null)).error).toBe("Object");
    expect(describeError(42).error).toBe("42");
    expect(describeError(undefined).error).toBe("undefined");
  });
});
