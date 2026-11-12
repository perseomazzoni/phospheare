// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useForwarders } from "./useForwarders";

afterEach(cleanup);

// The memoised rows of the structure panel act through these:
// a row that skipped a render must still reach the panel as it is now.

describe("useForwarders", () => {
  it("keeps the same functions while the handlers behind them change", () => {
    const heard: string[] = [];
    const { result, rerender } = renderHook(
      ({ tag }: { tag: string }) =>
        useForwarders({ onOpen: (id: string) => heard.push(`${tag}:${id}`) }),
      { initialProps: { tag: "first" } },
    );
    const first = result.current;
    rerender({ tag: "second" });
    expect(result.current).toBe(first);
    expect(result.current.onOpen).toBe(first.onOpen);
    // The old forwarder calls the newest handler.
    first.onOpen("S2");
    expect(heard).toEqual(["second:S2"]);
  });

  it("passes the arguments through and returns the handler's answer", () => {
    const { result } = renderHook(() =>
      useForwarders({ add: (a: number, b: number) => a + b }),
    );
    expect(result.current.add(2, 3)).toBe(5);
  });
});
