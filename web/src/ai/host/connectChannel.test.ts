// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { announceConnect, onConnect, openChannel } from "./connectChannel";

// jsdom has no `BroadcastChannel`, so the tests install a minimal one that
// keeps its defining property: a message reaches the other subscribers, which
// is why the module does not use `postMessage`.
class FakeChannel {
  static open: FakeChannel[] = [];
  static closed = 0;

  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(readonly name: string) {
    FakeChannel.open.push(this);
  }

  postMessage(data: unknown): void {
    for (const other of FakeChannel.open) {
      if (other === this) continue;
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
});

describe("the connection channel", () => {
  it("carries a provider and a verdict, and nothing else", () => {
    install();
    const heard: unknown[] = [];
    const stop = onConnect((signal) => heard.push(signal));

    announceConnect({ providerId: "a-provider", ok: true });

    // The exact shape is the contract: no code, no key, no account. Anything
    // more would make the channel something that has to be trusted, and it is
    // designed not to be.
    expect(heard).toEqual([{ providerId: "a-provider", ok: true }]);
    stop();
  });

  it("ignores a message whose shape it does not recognise", () => {
    install();
    const heard: unknown[] = [];
    const stop = onConnect((signal) => heard.push(signal));

    // A message of another shape, as from a tab on a different build, is
    // skipped rather than turned into a refresh for provider `undefined`.
    const sender = new FakeChannel("provider-connections");
    sender.postMessage({ providerId: 7, ok: true });
    sender.postMessage({ providerId: "a-provider" });
    sender.postMessage(null);

    expect(heard).toEqual([]);
    stop();
  });

  it("stops listening and releases the channel when unsubscribed", () => {
    install();
    const heard: unknown[] = [];
    const stop = onConnect((signal) => heard.push(signal));

    stop();
    announceConnect({ providerId: "a-provider", ok: true });

    expect(heard).toEqual([]);
    expect(FakeChannel.closed).toBeGreaterThan(0);
  });

  it("is a no-op where the browser has no channel at all", () => {
    // Not an error: the credential is stored either way, and only the
    // opener's immediate refresh is lost. A throw would turn a missing
    // convenience into a failed connection.
    vi.stubGlobal("BroadcastChannel", undefined);

    expect(() => announceConnect({ providerId: "a", ok: true })).not.toThrow();

    const stop = onConnect(() => {
      throw new Error("must never be called");
    });

    expect(() => stop()).not.toThrow();
  });

  it("answers no channel when the constructor throws", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new DOMException("refused", "SecurityError");
        }
      },
    );

    expect(openChannel("openrouter-callback")).toBeNull();
    expect(() => announceConnect({ providerId: "a", ok: true })).not.toThrow();
    expect(() => onConnect(() => {})()).not.toThrow();
  });
});
