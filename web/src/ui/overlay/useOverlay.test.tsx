// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import Scrim from "./Scrim";
import { __resetOverlays } from "./useOverlay";

// ── What Escape reaches ──────────────────────────────────────────────────────
//
// Escape closes the innermost layer only, and a layer that refuses to be
// dismissed swallows it. Both are claims about reach, which `preventDefault`
// cannot make true: it cancels the default and lets the key travel on.
//
// Every panel that answers Escape on the window sits underneath: the revision
// rail, the snapshot comparison, the find panel. A dialog over any of them must
// not also trigger theirs. These listeners stand where those panels
// listen.

afterEach(() => {
  cleanup();
  __resetOverlays();
});

/** A listener where every one of the app's panels listens: window, bubble. */
function panelBelow() {
  const heard = vi.fn();
  window.addEventListener("keydown", heard);
  return {
    heard,
    stop: () => window.removeEventListener("keydown", heard),
  };
}

const escape = () =>
  act(() => {
    fireEvent.keyDown(document, { key: "Escape" });
  });

describe("the overlay stack's Escape", () => {
  it("closes the top layer and does not reach the panel underneath", () => {
    const onClose = vi.fn();
    render(
      <Scrim open dismissible onClose={onClose} label="A dialog">
        <button>ok</button>
      </Scrim>,
    );
    const below = panelBelow();

    escape();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(below.heard).not.toHaveBeenCalled();
    below.stop();
  });

  it("is swallowed by a layer that refuses to be dismissed", () => {
    const onClose = vi.fn();
    render(
      <Scrim open dismissible={false} onClose={onClose} label="Saving">
        <p>working</p>
      </Scrim>,
    );
    const below = panelBelow();

    escape();

    // Nothing closes, and nothing underneath hears it: a modal exists to
    // prevent reaching past it.
    expect(onClose).not.toHaveBeenCalled();
    expect(below.heard).not.toHaveBeenCalled();
    below.stop();
  });

  it("reaches the panel again once the last layer is gone", () => {
    const view = render(
      <Scrim open dismissible onClose={() => {}} label="A dialog">
        <button>ok</button>
      </Scrim>,
    );
    const below = panelBelow();

    view.rerender(
      <Scrim open={false} dismissible onClose={() => {}} label="A dialog">
        <button>ok</button>
      </Scrim>,
    );
    escape();

    // The swallow belongs to the layer, not to the app: with the stack empty
    // the rail's own Escape works.
    expect(below.heard).toHaveBeenCalledTimes(1);
    below.stop();
  });

  it("leaves keys that are not Escape alone", () => {
    render(
      <Scrim open dismissible onClose={() => {}} label="A dialog">
        <button>ok</button>
      </Scrim>,
    );
    const below = panelBelow();

    act(() => {
      fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    });

    // Undo still belongs to the engine. Only Escape is the stack's business.
    expect(below.heard).toHaveBeenCalledTimes(1);
    below.stop();
  });
});

// ── A layer turning non-dismissible ──────────────────────────────────────────
//
// The flag is read live, not once at push. The summary dialog opens
// dismissible while a model is chosen and turns non-dismissible when the run
// starts; a flag read at push would let the backdrop close it mid-run, and
// the unmount would cancel the summary.

describe("a layer whose dismissible flag changes while it is open", () => {
  function held(dismissible: boolean, onClose: () => void) {
    return (
      <Scrim open dismissible={dismissible} onClose={onClose} label="Working">
        <p>working</p>
      </Scrim>
    );
  }

  it("stops answering Escape and the backdrop the moment it turns", () => {
    const onClose = vi.fn();
    const view = render(held(true, onClose));
    view.rerender(held(false, onClose));

    escape();
    const scrim = document.querySelector(".ui-scrim");
    if (!(scrim instanceof HTMLElement)) throw new Error("no scrim");
    fireEvent.mouseDown(scrim);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("answers them again once it turns back", () => {
    const onClose = vi.fn();
    const view = render(held(false, onClose));
    view.rerender(held(true, onClose));

    escape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── Inert with layers stacked ────────────────────────────────────────────────
//
// Every overlay under the shell puts the same background out of reach. A
// dialog opened from inside a sheet shares it, so closing the dialog must
// leave it out of reach while the sheet is still open.

describe("the background behind stacked layers", () => {
  function layers(outer: boolean, inner: boolean, app: HTMLElement) {
    const background = () => [app];
    return (
      <>
        <Scrim
          open={outer}
          onClose={() => {}}
          label="Sheet"
          inertTargets={background}
        >
          <button>sheet</button>
        </Scrim>
        <Scrim
          open={inner}
          onClose={() => {}}
          label="Alert"
          inertTargets={background}
        >
          <button>alert</button>
        </Scrim>
      </>
    );
  }

  it("stays inert until the last layer over it closes", () => {
    const app = document.createElement("div");
    document.body.append(app);
    const view = render(layers(true, true, app));
    expect(app.inert).toBe(true);

    view.rerender(layers(true, false, app));
    expect(app.inert, "the sheet is still open over it").toBe(true);

    view.rerender(layers(false, false, app));
    expect(app.inert).toBe(false);
    app.remove();
  });
});

// ── Escape during IME composition ────────────────────────────────────────────
//
// With an IME, Escape cancels the candidate being composed. That key belongs
// to the IME: the dialog holding the field stays open, and the field keeps
// what was typed.

describe("Escape while an IME is composing", () => {
  it("leaves the layer open", () => {
    const onClose = vi.fn();
    render(
      <Scrim open dismissible onClose={onClose} label="A dialog">
        <input />
      </Scrim>,
    );

    act(() => {
      fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
