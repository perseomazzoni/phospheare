// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import Toast from "./Toast";
import type { UndoableAction } from "../ProjectContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const action: UndoableAction = {
  code: "removed",
  title: "opening",
  undo: () => Promise.resolve(),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("names the change and offers the undo", () => {
    render(<Toast action={action} onUndo={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("toast.removed");
    expect(screen.getByRole("button", { name: "toast.undo" })).toBeTruthy();
  });

  it("undo calls through", () => {
    const onUndo = vi.fn();
    render(<Toast action={action} onUndo={onUndo} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "toast.undo" }));
    expect(onUndo).toHaveBeenCalled();
  });

  it("dismisses itself after the lifetime", () => {
    const onDismiss = vi.fn();
    render(<Toast action={action} onUndo={() => {}} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(7999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("re-arms the countdown when another action takes its place", () => {
    const onDismiss = vi.fn();
    const view = render(
      <Toast action={action} onUndo={() => {}} onDismiss={onDismiss} />,
    );
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    view.rerender(
      <Toast
        action={{
          code: "moved",
          title: "the storm",
          undo: () => Promise.resolve(),
        }}
        onUndo={() => {}}
        onDismiss={onDismiss}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
