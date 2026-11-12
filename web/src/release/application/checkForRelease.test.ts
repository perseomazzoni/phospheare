// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import {
  CHECK_EVERY_MS,
  createReleaseCheck,
  type Release,
  type ReleaseFeed,
  type ReleaseMemory,
} from "./checkForRelease";

const V2: Release = { tag: "v2.0.0", url: "https://example.test/v2.0.0" };
const DAY = CHECK_EVERY_MS;

function memory(): ReleaseMemory & {
  check: { at: number; release: Release | null } | null;
  closed: string | null;
} {
  return {
    check: null,
    closed: null,
    lastCheck() {
      return this.check;
    },
    rememberCheck(at, release) {
      this.check = { at, release };
    },
    dismissed() {
      return this.closed;
    },
    dismiss(tag) {
      this.closed = tag;
    },
  };
}

function setup(answer: () => Promise<Release | null>, current = "1.0.0") {
  const mem = memory();
  const feed: ReleaseFeed = { latest: vi.fn(answer) };
  let clock = 10 * DAY;
  const check = createReleaseCheck({
    feed,
    memory: mem,
    current,
    now: () => clock,
  });
  return {
    mem,
    feed,
    check,
    ask: () => check.newer(),
    later: (ms: number) => (clock += ms),
  };
}

describe("the release check", () => {
  it("offers a release newer than the build", async () => {
    const { ask, mem } = setup(async () => V2);
    expect(await ask()).toEqual(V2);
    expect(mem.check).toEqual({ at: 10 * DAY, release: V2 });
  });

  it("offers nothing when the build is current or newer", async () => {
    expect(await setup(async () => V2, "2.0.0").ask()).toBeNull();
    expect(await setup(async () => V2, "2.1.0").ask()).toBeNull();
  });

  it("offers nothing when the build's version cannot be ordered", async () => {
    expect(await setup(async () => V2, "dev").ask()).toBeNull();
  });

  it("offers nothing when no release is published", async () => {
    expect(await setup(async () => null).ask()).toBeNull();
  });

  it("asks the feed at most once a day", async () => {
    const { ask, feed, later } = setup(async () => V2);
    await ask();
    later(DAY - 1);
    expect(await ask()).toEqual(V2);
    expect(feed.latest).toHaveBeenCalledTimes(1);
    later(1);
    await ask();
    expect(feed.latest).toHaveBeenCalledTimes(2);
  });

  it("shares one ask between callers that ask while it is in flight", async () => {
    let answer: (release: Release) => void = () => {};
    const { ask, feed } = setup(
      () => new Promise<Release>((resolve) => (answer = resolve)),
    );
    const first = ask();
    const second = ask();
    answer(V2);
    expect(await Promise.all([first, second])).toEqual([V2, V2]);
    expect(feed.latest).toHaveBeenCalledTimes(1);
  });

  it("asks again when the remembered ask is in the future", async () => {
    const { ask, feed, mem } = setup(async () => V2);
    mem.check = { at: 20 * DAY, release: null };
    expect(await ask()).toEqual(V2);
    expect(feed.latest).toHaveBeenCalledTimes(1);
  });

  it("counts a failed ask as the day's ask", async () => {
    const { ask, feed, mem } = setup(async () => {
      throw new Error("unreachable");
    });
    expect(await ask()).toBeNull();
    expect(mem.check).toEqual({ at: 10 * DAY, release: null });
    await ask();
    expect(feed.latest).toHaveBeenCalledTimes(1);
  });

  it("stops offering a dismissed release, and offers the next one", async () => {
    let answer = V2;
    const { ask, check, later } = setup(async () => answer);
    check.dismiss(V2);
    expect(await ask()).toBeNull();
    answer = { tag: "v2.1.0", url: "https://example.test/v2.1.0" };
    later(DAY);
    expect(await ask()).toEqual(answer);
  });
});
