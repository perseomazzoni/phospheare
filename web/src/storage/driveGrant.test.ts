// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  driveGrantLapsed,
  noteDriveAccepted,
  noteDriveRefused,
  resetDriveGrant,
  useDriveGrantLapsed,
} from "./driveGrant";

// Pins the latch itself: it holds, clears, and reaches a component that is
// watching. Which refusals reach it is pinned where that is decided, in
// `driveRest.test.ts` and `driveToken.test.ts`.

beforeEach(() => {
  resetDriveGrant();
});
afterEach(() => {
  cleanup();
  resetDriveGrant();
});

describe("the Drive grant latch", () => {
  it("starts clear, because nothing has asked Drive anything yet", () => {
    expect(driveGrantLapsed()).toBe(false);
  });

  it("holds a refusal, so one 401 is enough to stop claiming the connection", () => {
    noteDriveRefused();
    expect(driveGrantLapsed()).toBe(true);
  });

  it("clears on the first accepted call, which is what makes reconnecting self-healing", () => {
    noteDriveRefused();
    noteDriveAccepted();
    expect(driveGrantLapsed()).toBe(false);
  });

  it("clears on sign-out, so the next account is not greeted by this one's refusal", () => {
    noteDriveRefused();
    resetDriveGrant();
    expect(driveGrantLapsed()).toBe(false);
  });
});

describe("what a watching component sees", () => {
  it("re-renders on the refusal, so the notice appears without a navigation", () => {
    const { result } = renderHook(() => useDriveGrantLapsed());
    expect(result.current).toBe(false);

    act(() => {
      noteDriveRefused();
    });
    // The latch is set from inside a `fetch`, outside anything React knows
    // about. Without the store's own notification the value would be correct,
    // nothing on screen would change, and no other assertion in the suite
    // would fail.
    expect(result.current).toBe(true);

    act(() => {
      noteDriveAccepted();
    });
    expect(result.current).toBe(false);
  });

  it("is a latch and not a counter: many refusals still clear on one accept", () => {
    const { result } = renderHook(() => useDriveGrantLapsed());

    // A stalled queue retries, and every retry fails the same way, so the
    // refused count is whatever the queue happened to be holding. The writer
    // then reconnects once. A tally rather than a latch would keep the notice
    // past the fix by however many writes were waiting, telling the writer to
    // reconnect an account they just reconnected.
    act(() => {
      noteDriveRefused();
      noteDriveRefused();
      noteDriveRefused();
    });
    expect(result.current).toBe(true);

    act(() => {
      noteDriveAccepted();
    });
    expect(result.current).toBe(false);
  });
});
