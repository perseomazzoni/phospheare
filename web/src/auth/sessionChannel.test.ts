// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { announceSession, onSession } from "./sessionChannel";

// jsdom has no `BroadcastChannel`. This stand-in matches the one in
// `connectChannel.test.ts`: a message reaches every other channel object,
// including ones in the same tab, which is the case the `ending` guard in
// `AuthContext` exists for.
class FakeChannel {
  static open: FakeChannel[] = [];
  static closed = 0;

  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(readonly name: string) {
    FakeChannel.open.push(this);
  }

  postMessage(data: unknown): void {
    for (const other of FakeChannel.open) {
      if (other === this || other.name !== this.name) continue;
      for (const listen of other.listeners)
        listen({ data } as unknown as MessageEvent);
    }
  }

  addEventListener(_: string, handler: (event: MessageEvent) => void): void {
    this.listeners.add(handler);
  }

  removeEventListener(_: string, handler: (event: MessageEvent) => void): void {
    this.listeners.delete(handler);
  }

  close(): void {
    FakeChannel.closed += 1;
    FakeChannel.open = FakeChannel.open.filter((one) => one !== this);
  }
}

function install() {
  FakeChannel.open = [];
  FakeChannel.closed = 0;
  vi.stubGlobal("BroadcastChannel", FakeChannel);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the session channel", () => {
  it("carries who signed out and whether they left or cleaned, and nothing else", () => {
    install();
    const heard: unknown[] = [];
    const stop = onSession((signal) => heard.push(signal));

    announceSession({ kind: "signed-out", userId: "u1" });
    announceSession({ kind: "signed-in", userId: "u1" });
    announceSession({ kind: "signed-in", userId: "u2" });
    announceSession({ kind: "left", userId: "u2" });

    expect(heard).toEqual([
      { kind: "signed-out", userId: "u1" },
      { kind: "signed-in", userId: "u1" },
      { kind: "signed-in", userId: "u2" },
      { kind: "left", userId: "u2" },
    ]);
    stop();
  });

  it("is named neutrally, like everything the browser keeps", () => {
    install();
    announceSession({ kind: "signed-in", userId: "u1" });
    // Opened and closed in one call, under the requested name.
    expect(FakeChannel.closed).toBe(1);

    const stop = onSession(() => {});
    expect(FakeChannel.open.map((one) => one.name)).toEqual(["session"]);
    stop();
  });

  it("ignores a message whose shape it does not recognise", () => {
    install();
    const heard: unknown[] = [];
    const stop = onSession((signal) => heard.push(signal));

    // Another tab on another build, or anything else on the channel. A stale
    // shape is skipped rather than turned into a sign-out.
    const sender = new FakeChannel("session");
    sender.postMessage(null);
    sender.postMessage("signed-out");
    sender.postMessage({ kind: "signed-out", userId: 7 });
    sender.postMessage({ kind: "signed-out", userId: "" });
    sender.postMessage({ kind: "vanished", userId: "u1" });
    sender.postMessage({ kind: "signed-in" });
    sender.postMessage({ kind: "signed-in", userId: "" });

    expect(heard).toEqual([]);
    stop();
  });

  it("passes on only the fields it knows", () => {
    install();
    const heard: unknown[] = [];
    const stop = onSession((signal) => heard.push(signal));

    new FakeChannel("session").postMessage({
      kind: "signed-in",
      userId: "u1",
      extra: "dropped",
    });

    expect(heard).toEqual([{ kind: "signed-in", userId: "u1" }]);
    stop();
  });

  it("stops listening and releases the channel when unsubscribed", () => {
    install();
    const heard: unknown[] = [];
    const stop = onSession((signal) => heard.push(signal));

    stop();
    announceSession({ kind: "signed-in", userId: "u1" });

    expect(heard).toEqual([]);
    // Released, not merely muted: nothing of it is left open.
    expect(FakeChannel.open).toEqual([]);
  });

  it("is a no-op where the browser has no channel at all", () => {
    // Each tab still finds out from its own next request; a throw here would
    // turn a missing convenience into a failed sign-out.
    vi.stubGlobal("BroadcastChannel", undefined);

    expect(() =>
      announceSession({ kind: "signed-in", userId: "u1" }),
    ).not.toThrow();

    const stop = onSession(() => {
      throw new Error("must never be called");
    });
    expect(() => stop()).not.toThrow();
  });

  it("is a no-op where opening the channel throws", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new Error("blocked");
        }
      },
    );

    expect(() =>
      announceSession({ kind: "signed-in", userId: "u1" }),
    ).not.toThrow();
    expect(() => onSession(() => {})()).not.toThrow();
  });

  it("swallows a refusal to post from a window mid-teardown", () => {
    install();
    vi.spyOn(FakeChannel.prototype, "postMessage").mockImplementation(() => {
      throw new Error("closing");
    });

    expect(() =>
      announceSession({ kind: "signed-in", userId: "u1" }),
    ).not.toThrow();
    expect(FakeChannel.closed).toBe(1);
  });
});
