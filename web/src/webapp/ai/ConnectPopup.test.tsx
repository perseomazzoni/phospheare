// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import ConnectPopup from "./ConnectPopup";

// The approval window holds no session, no key and no verifier: it hands the
// vendor's `{code, state}` to the asking tab and forgets it. It
// says "Approved", and closes, only once the asking tab acknowledges.
const deliver = vi.fn();

vi.mock("../../ai/host/openrouterConnection", () => ({
  deliverCallback: (...args: unknown[]) => deliver(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let replaceState: ReturnType<typeof vi.spyOn>;

function at(search: string) {
  window.history.pushState(null, "", `/app/connect/openrouter${search}`);
}

/** Lets the handover's promise settle and React render what it says. */
const settle = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  deliver.mockReset();
  deliver.mockResolvedValue(true);
  replaceState = vi.spyOn(window.history, "replaceState");
  vi.spyOn(window, "close").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.pushState(null, "", "/");
});

describe("the approval window", () => {
  it("says where the writer is going while it has no answer", () => {
    at("");

    render(<ConnectPopup />);

    expect(screen.getByText("connect.workingTitle")).toBeTruthy();
    expect(screen.getByText("connect.workingBody")).toBeTruthy();
    expect(deliver).not.toHaveBeenCalled();
    expect(screen.queryByText("connect.close")).toBeNull();
  });

  it("hands code and state to the asking tab", async () => {
    at("?code=the-code&state=the-state");

    render(<ConnectPopup />);
    await settle();

    expect(deliver).toHaveBeenCalledWith({
      state: "the-state",
      code: "the-code",
    });
    expect(screen.getByText("connect.returnedTitle")).toBeTruthy();
  });

  it("says Approved only once the asking tab acknowledges", async () => {
    let acknowledge: (acknowledged: boolean) => void = () => {};
    deliver.mockReturnValue(
      new Promise<boolean>((resolve) => {
        acknowledge = resolve;
      }),
    );
    at("?code=the-code&state=the-state");

    render(<ConnectPopup />);
    await settle();
    act(() => void vi.advanceTimersByTime(1_000));

    expect(screen.queryByText("connect.returnedTitle")).toBeNull();
    expect(window.close).not.toHaveBeenCalled();

    acknowledge(true);
    await settle();
    expect(screen.getByText("connect.returnedTitle")).toBeTruthy();
  });

  it("hands a refusal on as a state with no code, and says it was declined", async () => {
    // The vendor returns with a state and no code when the writer declines;
    // the asking tab ends its flow on it.
    at("?state=the-state");

    render(<ConnectPopup />);
    await settle();
    act(() => void vi.advanceTimersByTime(5_000));

    expect(deliver).toHaveBeenCalledWith({ state: "the-state", code: null });
    expect(screen.getByText("connect.declinedTitle")).toBeTruthy();
    expect(screen.getByText("connect.declinedBody")).toBeTruthy();
    expect(screen.queryByText("connect.returnedTitle")).toBeNull();
    expect(window.close).not.toHaveBeenCalled();
    expect(screen.getByText("connect.close")).toBeTruthy();
  });

  it("clears the address before it hands the answer on", () => {
    let clearedFirst = false;
    deliver.mockImplementation(() => {
      clearedFirst = replaceState.mock.calls.length > 0;
      return Promise.resolve(true);
    });
    at("?code=the-code&state=the-state");

    render(<ConnectPopup />);

    // A code left in the address reaches the history and any referer.
    expect(clearedFirst).toBe(true);
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/app/connect/openrouter");
  });

  it("closes itself once the answer is acknowledged", async () => {
    at("?code=the-code&state=the-state");

    render(<ConnectPopup />);
    await settle();
    expect(window.close).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(400));
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  it("stays open and says so when no tab acknowledges the answer", async () => {
    deliver.mockResolvedValue(false);
    at("?code=the-code&state=the-state");

    render(<ConnectPopup />);
    await settle();
    act(() => void vi.advanceTimersByTime(5_000));

    // A window that vanishes having done nothing reads as one that worked.
    expect(screen.getByText("connect.failedTitle")).toBeTruthy();
    expect(screen.getByText("connect.lostBody")).toBeTruthy();
    expect(window.close).not.toHaveBeenCalled();
    expect(screen.getByText("connect.close")).toBeTruthy();
  });

  it("hands a single-use code on once, whatever React does with effects", async () => {
    at("?code=the-code&state=the-state");

    render(
      <StrictMode>
        <ConnectPopup />
      </StrictMode>,
    );
    await settle();

    expect(deliver).toHaveBeenCalledTimes(1);
    // The remount does not lose the acknowledgement.
    expect(screen.getByText("connect.returnedTitle")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(400));
    expect(window.close).toHaveBeenCalledTimes(1);
  });
});
