// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
// Pins the back gesture with more than one layer open, as when the writing
// preferences sheet sits over the structure sheet. Back closes the
// innermost layer and only that one, and closing a layer another way leaves
// the one beneath it alone.
//
// `history.back()` is stubbed to dispatch `popstate`, which is what it does.
// jsdom's history is one object shared by every test in the file, so tests
// against it would depend on what ran before them. Stubbing the one platform
// call keeps the module's own logic under test (the stack, the self-pop
// count, the mark on the entry). `pushState` stays real, since nothing here
// depends on where it lands.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackCloses } from "./useBackCloses";

let back: ReturnType<typeof vi.fn>;
let realBack: PropertyDescriptor;

beforeEach(() => {
  realBack = Object.getOwnPropertyDescriptor(window.history, "back") ?? {
    value: History.prototype.back,
    configurable: true,
    writable: true,
  };
  back = vi.fn(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  Object.defineProperty(window.history, "back", {
    configurable: true,
    writable: true,
    value: back,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window.history, "back", realBack);
});

/** The platform's own gesture, which is a `popstate` and nothing else. */
function pressBack() {
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Layer({ open, close }: { open: boolean; close: () => void }) {
  useBackCloses(open, close);
  return null;
}

/**
 * One layer closing while another opens in the same render, as
 * `CommandBoard.run` does with `onClose()` then `command.run()`: one handler
 * closes the board and opens the layer behind it, batched into one commit.
 */
function Handoff({
  from,
  onFrom,
  onTo,
}: {
  from: boolean;
  onFrom: () => void;
  onTo: () => void;
}) {
  return (
    <>
      <Layer open={from} close={onFrom} />
      <Layer open={!from} close={onTo} />
    </>
  );
}

/** Two layers, opened and closed independently, as a sheet over a sheet is. */
function Stack({
  outer,
  inner,
  onOuter,
  onInner,
}: {
  outer: boolean;
  inner: boolean;
  onOuter: () => void;
  onInner: () => void;
}) {
  return (
    <>
      <Layer open={outer} close={onOuter} />
      <Layer open={inner} close={onInner} />
    </>
  );
}

describe("useBackCloses", () => {
  it("closes the layer instead of leaving the page", () => {
    const close = vi.fn();
    render(<Layer open close={close} />);
    expect(window.history.state).toMatchObject({
      layer: true,
    });

    act(() => pressBack());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the layer is shut", () => {
    const close = vi.fn();
    render(<Layer open={false} close={close} />);
    act(() => pressBack());
    expect(close).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it("puts its entry back when the layer closes some other way", async () => {
    const close = vi.fn();
    const { rerender } = render(<Layer open close={close} />);

    // Closed by its own button, not by back, so the pushed entry is popped;
    // left, it would be a back step that does nothing visible. The pop is
    // offered on a microtask so a same-tick replacement can claim the entry
    // instead, so a real close needs one tick to land.
    await act(async () => {
      rerender(<Layer open={false} close={close} />);
    });
    expect(back).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("back reaches only the innermost of two open layers", () => {
    const onOuter = vi.fn();
    const onInner = vi.fn();
    render(<Stack outer inner onOuter={onOuter} onInner={onInner} />);

    act(() => pressBack());
    expect(onInner).toHaveBeenCalledTimes(1);
    expect(onOuter, "one press closed two layers").not.toHaveBeenCalled();
  });

  it("closing the inner layer some other way leaves the outer one open", () => {
    // The outer layer ignores the pop an inner layer's teardown makes; it
    // must not close along with the layer above it.
    const onOuter = vi.fn();
    const onInner = vi.fn();
    const { rerender } = render(
      <Stack outer inner onOuter={onOuter} onInner={onInner} />,
    );

    act(() => {
      rerender(
        <Stack outer inner={false} onOuter={onOuter} onInner={onInner} />,
      );
    });
    expect(back).toHaveBeenCalledTimes(1);
    expect(onInner).not.toHaveBeenCalled();
    expect(onOuter).not.toHaveBeenCalled();

    // The outer layer still answers back afterwards: swallowing the synthetic
    // pop does not disarm it.
    act(() => pressBack());
    expect(onOuter).toHaveBeenCalledTimes(1);
  });

  it("reads the current close, not the one it mounted with", () => {
    // Callers pass inline arrows. `open` is the effect's only dependency,
    // because the teardown navigates and a per-render re-run would step back
    // once a render; a ref keeps the handler from going stale.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Layer open close={first} />);
    rerender(<Layer open close={second} />);

    act(() => pressBack());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("hands its entry to a layer that opens in the same commit, instead of popping under it", async () => {
    // The board closes and a layer opens in one handler. An immediate
    // `history.back()` from the closing teardown is processed after the new
    // layer pushes its entry, so the pop would land on the new entry and
    // close the layer the tick it opened.
    const onFrom = vi.fn();
    const onTo = vi.fn();
    const { rerender } = render(<Handoff from onFrom={onFrom} onTo={onTo} />);
    expect(window.history.state).toMatchObject({
      layer: true,
    });

    await act(async () => {
      rerender(<Handoff from={false} onFrom={onFrom} onTo={onTo} />);
    });

    // No navigation: the new layer claims the old one's entry instead of
    // pushing a second, so the deferred pop has nothing to land on.
    expect(back).not.toHaveBeenCalled();
    expect(onFrom).not.toHaveBeenCalled();
    expect(onTo).not.toHaveBeenCalled();

    // After the handoff exactly one layer answers back: the new one.
    act(() => pressBack());
    expect(onTo).toHaveBeenCalledTimes(1);
    expect(onFrom).not.toHaveBeenCalled();
  });

  it("two layers closing together leave no pop to eat the next layer's back", async () => {
    // A real `history.back()` lands as a `popstate` task after the commit,
    // by which time both teardowns have run. Rotating a phone past the
    // breakpoint closes the panel and the dock in one render.
    const pending: Array<() => void> = [];
    back.mockImplementation(() => {
      pending.push(() => window.dispatchEvent(new PopStateEvent("popstate")));
    });
    const onOuter = vi.fn();
    const onInner = vi.fn();
    const { rerender } = render(
      <Stack outer inner onOuter={onOuter} onInner={onInner} />,
    );

    await act(async () => {
      rerender(
        <Stack
          outer={false}
          inner={false}
          onOuter={onOuter}
          onInner={onInner}
        />,
      );
    });
    expect(back).toHaveBeenCalledTimes(2);
    act(() => {
      for (const pop of pending.splice(0)) pop();
    });
    expect(onOuter).not.toHaveBeenCalled();
    expect(onInner).not.toHaveBeenCalled();

    const next = vi.fn();
    render(<Layer open close={next} />);
    act(() => pressBack());
    expect(
      next,
      "a stale self-pop swallowed the first back",
    ).toHaveBeenCalledTimes(1);
  });
});
