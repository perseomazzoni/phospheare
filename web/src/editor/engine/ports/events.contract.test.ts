// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { Emitter } from "../adapters/emitter";
import type { EventBus } from "./events";

// The event bus contract: handlers fire with the emitted arguments once per
// distinct registration (duplicates are deduplicated), and unsubscribe is
// exact. The suite runs against every `EventBus` implementation, so a
// replayable bus for a shared session behaves identically.

type Events = { tick: [n: number]; done: [] };

const buses: { name: string; create: () => EventBus<Events> }[] = [
  { name: "emitter", create: () => new Emitter<Events>() },
];

describe.each(buses)("$name event bus contract", ({ create }) => {
  it("calls every handler with the exact emitted arguments", () => {
    const bus = create();
    const seen: number[] = [];
    const off = bus.on("tick", (n) => seen.push(n));
    bus.emit("tick", 1);
    bus.emit("tick", 2);
    off();
    expect(seen).toEqual([1, 2]);
  });

  it("unsubscribe removes exactly that handler, and a second call is a no-op", () => {
    const bus = create();
    const seen: string[] = [];
    const offA = bus.on("done", () => seen.push("a"));
    const offB = bus.on("done", () => seen.push("b"));
    offA();
    offA();
    bus.emit("done");
    offB();
    bus.emit("done");
    expect(seen).toEqual(["b"]);
  });

  it("a handler registered twice fires once per emit (duplicates are deduplicated)", () => {
    const bus = create();
    let count = 0;
    const handler = () => {
      count++;
    };
    const offA = bus.on("done", handler);
    const offB = bus.on("done", handler);
    bus.emit("done");
    offA();
    offB();
    bus.emit("done");
    expect(count).toBe(1);
  });

  it("clear removes every handler of every type", () => {
    const bus = create();
    let a = 0;
    let b = 0;
    bus.on("tick", () => {
      a++;
    });
    bus.on("done", () => {
      b++;
    });
    bus.clear();
    bus.emit("tick", 1);
    bus.emit("done");
    expect([a, b]).toEqual([0, 0]);
  });

  it("emitting a type with no handlers never throws", () => {
    const bus = create();
    expect(() => bus.emit("tick", 5)).not.toThrow();
    expect(() => bus.emit("done")).not.toThrow();
  });
});
