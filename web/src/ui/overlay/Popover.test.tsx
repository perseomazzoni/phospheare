// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import Popover from "./Popover";
import { __resetOverlays } from "./useOverlay";

// The workspace has no global test setup, so a suite that renders cleans up
// after itself.
afterEach(() => {
  cleanup();
  __resetOverlays();
});

function mount(onClose = vi.fn()) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  render(
    <Popover
      open
      onClose={onClose}
      anchor={anchor}
      placement="above-start"
      label="Context window"
    >
      <p>1,200 of 8,000 tokens</p>
    </Popover>,
  );
  return { anchor, onClose };
}

const panel = () => document.querySelector<HTMLElement>(".ui-popover");

describe("Popover", () => {
  it("hangs a named, non-modal panel from its trigger, portalled to the page", () => {
    mount();
    expect(panel()?.parentElement).toBe(document.body);
    expect(panel()?.getAttribute("role")).toBe("dialog");
    expect(panel()?.getAttribute("aria-modal")).toBe("false");
    expect(panel()?.getAttribute("aria-label")).toBe("Context window");
    expect(panel()?.dataset.placement).toBe("above-start");
    expect(panel()?.textContent).toBe("1,200 of 8,000 tokens");
  });

  it("leaves focus on the trigger: there is nothing inside to operate", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    anchor.focus();
    render(
      <Popover open onClose={() => {}} anchor={anchor} label="Credit">
        <p>$1.75 left</p>
      </Popover>,
    );
    expect(document.activeElement).toBe(anchor);
  });

  it("closes on Escape", () => {
    const { onClose } = mount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on a press anywhere else, and not on a press inside it", async () => {
    const { onClose } = mount();
    // The away-listener is registered a frame late, so the press that opened
    // the panel cannot also close it.
    await act(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(0))),
    );
    fireEvent.pointerDown(panel() as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("draws nothing while closed", () => {
    render(
      <Popover open={false} onClose={() => {}} anchor={null} label="Credit">
        <p>hidden</p>
      </Popover>,
    );
    expect(panel()).toBeNull();
  });
});
