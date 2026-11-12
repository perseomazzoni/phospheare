// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FindHandle } from "../components/FindPanel";
import { useBarPanels } from "./useBarPanels";

/** The hook with a stand-in `FindPanel` that reports as the real one does. */
function mount() {
  const view = renderHook(() => useBarPanels());
  let open = false;
  const handle = {
    isOpen: () => open,
    open: vi.fn(() => {
      open = true;
      view.result.current.reportFindOpen(true);
    }),
    close: vi.fn(() => {
      open = false;
      view.result.current.reportFindOpen(false);
    }),
  };
  view.result.current.find.current = handle as unknown as FindHandle;
  return { view, handle, panels: () => view.result.current };
}

afterEach(cleanup);

describe("useBarPanels", () => {
  it("closes find when the character keys open", () => {
    const { panels, handle } = mount();
    act(() => panels().openFind());
    expect(panels().findOpen).toBe(true);
    act(() => panels().openCharacters());
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(panels().findOpen).toBe(false);
    expect(panels().charsOpen).toBe(true);
  });

  it("closes the character keys when find opens, by any way in", () => {
    const { panels } = mount();
    act(() => panels().toggleCharacters());
    expect(panels().charsOpen).toBe(true);
    act(() => panels().openFind("storm"));
    expect(panels().charsOpen).toBe(false);

    act(() => panels().openCharacters());
    // The bar's own field opens find inside `FindPanel`, so only the report
    // reaches the hook.
    act(() => panels().reportFindOpen(true));
    expect(panels().charsOpen).toBe(false);
  });

  it("seeds find with the query it is given", () => {
    const { panels, handle } = mount();
    act(() => panels().openFind("storm"));
    expect(handle.open).toHaveBeenCalledWith("storm");
  });

  it("toggles find and the character keys", () => {
    const { panels, handle } = mount();
    act(() => panels().toggleFind());
    expect(panels().findOpen).toBe(true);
    act(() => panels().toggleFind());
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(panels().findOpen).toBe(false);

    act(() => panels().toggleCharacters());
    act(() => panels().toggleCharacters());
    expect(panels().charsOpen).toBe(false);
  });

  it("opens and closes the sheet and the palette", () => {
    const { panels } = mount();
    act(() => panels().openSheet());
    expect(panels().sheetOpen).toBe(true);
    act(() => panels().closeSheet());
    expect(panels().sheetOpen).toBe(false);

    act(() => panels().openPalette("board"));
    expect(panels().palette).toBe("board");
    act(() => panels().closePalette());
    expect(panels().palette).toBeNull();
  });
});
