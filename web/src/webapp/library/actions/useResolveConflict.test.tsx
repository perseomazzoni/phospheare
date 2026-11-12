// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import {
  renderAction,
  resetShelfFakes,
  shelfDoubles,
  tearDownShelf,
} from "./shelfActions.fixture";
import { useResolveConflict } from "./useResolveConflict";

vi.mock(
  "react-i18next",
  async () => (await import("./shelfActions.fixture")).mocks.i18n,
);
vi.mock(
  "../../../storage",
  async () => (await import("./shelfActions.fixture")).mocks.storage,
);

function renderActions() {
  const doubles = shelfDoubles();
  const hook = renderAction(({ failure }) =>
    useResolveConflict({
      resolve: doubles.api.resolve,
      toasts: doubles.toasts,
      failure,
    }),
  );
  return { hook, ...doubles };
}

beforeEach(resetShelfFakes);
afterEach(tearDownShelf);

describe("resolve", () => {
  it("resolves and says which side won", async () => {
    const { hook, api, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.resolve("local-key", "Project", "local");
    });

    // The banner names the book; the hook looks the address up itself.
    expect(api.resolve).toHaveBeenCalledWith("local-key", "local");
    expect(toasts.post).toHaveBeenCalledWith("sync.resolved");
    expect(hook.result.current.resolving).toBeNull();
  });

  it("fails the banner rather than guessing when resolve fails", async () => {
    const { hook, api, toasts } = renderActions();
    api.resolve.mockRejectedValue(new Error("boom"));

    await act(async () => {
      await hook.result.current.resolve("local-key", "Project", "remote");
    });

    expect(toasts.post).not.toHaveBeenCalled();
    expect(hook.result.current.shelfError).toBe("sync.resolveFailed");
    expect(hook.result.current.resolving).toBeNull();
  });

  it.each([
    ["remote", "sync.remoteUnsettled"],
    ["local", "sync.localUnsettled"],
  ] as const)(
    "says why keeping the %s copy was refused when it is not complete",
    async (keep, message) => {
      const { hook, api, toasts } = renderActions();
      api.resolve.mockRejectedValue(
        Object.assign(new Error("unsettled"), { code: "winner-unsettled" }),
      );

      await act(async () => {
        await hook.result.current.resolve("local-key", "Project", keep);
      });

      expect(toasts.post).not.toHaveBeenCalled();
      expect(hook.result.current.shelfError).toBe(message);
    },
  );
});
