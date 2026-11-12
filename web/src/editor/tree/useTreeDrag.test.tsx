// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTreeDrag } from "./useTreeDrag";
import { snapshotFileName, toSlug } from "../../project/naming";
import type {
  DocNode,
  DocumentStructure,
  PartNode,
  SectionNode,
} from "../../project/types";

// ── The drag gesture's end conditions ────────────────────────────────────────
//
// Where the insertion line goes is the question of `dropTarget.ts` and is
// pinned in its own suite. This one pins the other half, how a gesture ends,
// because that is where the structure is written.
//
// The gesture has three endings and they are not the same ending: a release
// commits, Escape abandons, and a cancel abandons, so a gesture the writer
// never completed moves or bins nothing. Every pin here is paired with its
// matched control — a pin that only proves "nothing happened" passes just as
// well when the whole gesture is broken.
//
// jsdom measures nothing, so each element carries its own rect: rows are 22px
// tall from the top of the content, the scroller is taller than
// the pointer ever reaches (auto-scroll stays out of these tests), and the bin
// sits far below the last row.

afterEach(() => cleanup());

const ROW_H = 22;

function section(id: string, name: string): SectionNode {
  return {
    kind: "section",
    id,
    title: name,
    adopted: snapshotFileName("section", toSlug(name), id, 0),
    snapshots: [
      {
        file: snapshotFileName("section", toSlug(name), id, 0),
        title: name,
        created: "",
      },
    ],
  };
}

function doc(children: DocNode[]): DocumentStructure {
  return { version: 1, children };
}

/** Three root Sections — the simplest document a move can be wrong in. */
const FLAT = doc([
  section("EL1", "one"),
  section("EL2", "two"),
  section("EL3", "three"),
]);

function boxed(el: HTMLElement, top: number, bottom: number): HTMLElement {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom,
      left: 0,
      right: 248,
      x: 0,
      y: top,
      width: 248,
      height: bottom - top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

/** The panel's DOM, measured: a scroller, three rows, and a bin below them. */
function panel() {
  const scroller = boxed(document.createElement("div"), 0, 400);
  const content = boxed(document.createElement("div"), 0, 3 * ROW_H);
  for (const [i, id] of ["EL1", "EL2", "EL3"].entries()) {
    const row = document.createElement("div");
    row.dataset.row = id;
    boxed(row, i * ROW_H, (i + 1) * ROW_H);
    content.append(row);
  }
  scroller.append(content);
  const bin = boxed(document.createElement("div"), 300, 340);
  document.body.append(scroller, bin);
  return {
    scrollRef: { current: scroller },
    contentRef: { current: content },
    binRef: { current: bin },
  };
}

/** Only `button` and the coordinates are read out of the React event. */
const press = (clientX: number, clientY: number) =>
  ({ button: 0, clientX, clientY }) as ReactPointerEvent;

const pointer = (type: string, clientX: number, clientY: number) =>
  new MouseEvent(type, { clientX, clientY, cancelable: true, bubbles: true });

function setup() {
  const refs = panel();
  const handlers = {
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    onDrop: vi.fn(),
    onBinDrop: vi.fn(),
    onRestore: vi.fn(),
  };
  const { result } = renderHook(() =>
    useTreeDrag({
      structure: FLAT,
      expanded: new Set<string>(),
      ...refs,
      ...handlers,
    }),
  );

  /**
   * Press on the first row and drag to `(x, y)`, which is far enough to arm
   * the gesture. Ends nothing — the caller chooses the ending.
   */
  const dragTo = (x: number, y: number) => {
    act(() => result.current.startDrag(press(10, 5), "EL1", "one", "section"));
    act(() => void window.dispatchEvent(pointer("pointermove", x, y)));
  };
  const end = (type: "pointerup" | "pointercancel") =>
    act(() => void window.dispatchEvent(pointer(type, 0, 0)));

  return { result, handlers, dragTo, end };
}

/** Below the last row's midpoint: the gap after EL3, at the root's depth. */
const AFTER_LAST = { x: 10, y: 60 };
/** Inside the bin's box — for a tree drag, the delete target. */
const OVER_BIN = { x: 10, y: 320 };

describe("useTreeDrag — how a gesture ends", () => {
  it("commits the move when the pointer is released", () => {
    const { handlers, dragTo, end } = setup();
    dragTo(AFTER_LAST.x, AFTER_LAST.y);
    end("pointerup");
    expect(handlers.onDrop).toHaveBeenCalledWith(["EL1"], {
      containerId: null,
      index: 3,
      depth: 0,
    });
  });

  // The difference between the two endings: the setup is byte-for-byte the
  // test above's, and only the last event differs.
  it("abandons the move when the gesture is cancelled", () => {
    const { handlers, dragTo, end } = setup();
    dragTo(AFTER_LAST.x, AFTER_LAST.y);
    end("pointercancel");
    expect(handlers.onDrop).not.toHaveBeenCalled();
  });

  it("removes the node when the pointer is released over the bin", () => {
    const { result, handlers, dragTo, end } = setup();
    dragTo(OVER_BIN.x, OVER_BIN.y);
    expect(result.current.binArmed).toBe(true);
    end("pointerup");
    expect(handlers.onBinDrop).toHaveBeenCalledWith("EL1");
  });

  // The other half, and the worse of the two: a cancel over the bin must not
  // unlink the node.
  it("does not remove the node when the gesture is cancelled over the bin", () => {
    const { result, handlers, dragTo, end } = setup();
    dragTo(OVER_BIN.x, OVER_BIN.y);
    expect(result.current.binArmed).toBe(true);
    end("pointercancel");
    expect(handlers.onBinDrop).not.toHaveBeenCalled();
  });

  it("clears the drag's own chrome whichever way it ends", () => {
    const { result, dragTo, end } = setup();
    dragTo(AFTER_LAST.x, AFTER_LAST.y);
    expect(result.current.draggingId).toBe("EL1");
    expect(result.current.ghost).not.toBeNull();
    end("pointercancel");
    expect(result.current.draggingId).toBeNull();
    expect(result.current.ghost).toBeNull();
    expect(result.current.indicator).toBeNull();
    expect(result.current.binArmed).toBe(false);
  });

  // A press that never travelled is a click; the row's own onClick owns it.
  it("writes nothing when a press never passes the threshold", () => {
    const { result, handlers, end } = setup();
    act(() => result.current.startDrag(press(10, 5), "EL1", "one", "section"));
    act(() => void window.dispatchEvent(pointer("pointermove", 12, 6)));
    expect(result.current.draggingId).toBeNull();
    end("pointerup");
    expect(handlers.onDrop).not.toHaveBeenCalled();
    expect(handlers.onBinDrop).not.toHaveBeenCalled();
  });

  it("ignores a press that is not the primary button", () => {
    const { result, handlers, end } = setup();
    act(() =>
      result.current.startDrag(
        { button: 2, clientX: 10, clientY: 5 } as ReactPointerEvent,
        "EL1",
        "one",
        "section",
      ),
    );
    act(
      () =>
        void window.dispatchEvent(
          pointer("pointermove", AFTER_LAST.x, AFTER_LAST.y),
        ),
    );
    end("pointerup");
    expect(result.current.draggingId).toBeNull();
    expect(handlers.onDrop).not.toHaveBeenCalled();
  });
});

// ── A group in the air ───────────────────────────────────────────────────────
// Several selected rows drag as one group.

describe("useTreeDrag — a group drag", () => {
  /** Press on the first row carrying `group`, and drag to `(x, y)`. */
  const groupTo = (
    ctx: ReturnType<typeof setup>,
    group: readonly string[],
    x: number,
    y: number,
  ) => {
    act(() =>
      ctx.result.current.startDrag(
        press(10, 5),
        "EL1",
        "one",
        "section",
        "tree",
        undefined,
        group,
      ),
    );
    act(() => void window.dispatchEvent(pointer("pointermove", x, y)));
  };

  it("drops every id it carries, and holds them all in the air", () => {
    const ctx = setup();
    groupTo(ctx, ["EL1", "EL2"], AFTER_LAST.x, AFTER_LAST.y);
    expect(ctx.result.current.draggingIds).toEqual(["EL1", "EL2"]);
    ctx.end("pointerup");
    expect(ctx.handlers.onDrop).toHaveBeenCalledWith(["EL1", "EL2"], {
      containerId: null,
      index: 3,
      depth: 0,
    });
    expect(ctx.result.current.draggingIds).toEqual([]);
  });

  // The bin removes one node; a group dropped there must not remove any —
  // nor fall through to a move.
  it("never arms the bin", () => {
    const ctx = setup();
    groupTo(ctx, ["EL1", "EL2"], OVER_BIN.x, OVER_BIN.y);
    expect(ctx.result.current.binArmed).toBe(false);
    ctx.end("pointerup");
    expect(ctx.handlers.onBinDrop).not.toHaveBeenCalled();
    expect(ctx.handlers.onDrop).not.toHaveBeenCalled();
  });

  it("reads a group that leaves out the grabbed row as the row alone", () => {
    const ctx = setup();
    groupTo(ctx, ["EL2", "EL3"], AFTER_LAST.x, AFTER_LAST.y);
    ctx.end("pointerup");
    expect(ctx.handlers.onDrop).toHaveBeenCalledWith(["EL1"], {
      containerId: null,
      index: 3,
      depth: 0,
    });
  });
});

// ── A folded Part ────────────────────────────────────────────────────────────
// A folded Part's children stay in the document inside `.dt-children`, which
// is zero-height but still lays them out over the rows below. The drop math
// reads only the rows on screen, so the gap under the pointer is the one the
// writer sees.

describe("useTreeDrag — a folded Part", () => {
  function part(id: string, name: string, children: DocNode[]): PartNode {
    return { ...section(id, name), kind: "part", children };
  }

  /** Four root Parts; the first is folded over one Section. */
  const FOLDED = doc([
    part("EL1", "one", [section("EL5", "inside")]),
    part("EL2", "two", []),
    part("EL3", "three", []),
    part("EL4", "four", []),
  ]);

  function foldedPanel() {
    const scroller = boxed(document.createElement("div"), 0, 400);
    const content = boxed(document.createElement("div"), 0, 4 * ROW_H);
    const row = (id: string, top: number) => {
      const el = document.createElement("div");
      el.dataset.row = id;
      return boxed(el, top, top + ROW_H);
    };
    const children = document.createElement("div");
    children.className = "dt-children";
    // The folded child lays out where the next Part's row is.
    children.append(row("EL5", ROW_H));
    content.append(row("EL1", 0), children);
    for (const [i, id] of ["EL2", "EL3", "EL4"].entries())
      content.append(row(id, (i + 1) * ROW_H));
    scroller.append(content);
    document.body.append(scroller);
    return {
      scrollRef: { current: scroller },
      contentRef: { current: content },
    };
  }

  it("drops into the gap the writer sees, not one shifted by hidden rows", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useTreeDrag({
        structure: FOLDED,
        expanded: new Set<string>(),
        ...foldedPanel(),
        onExpand: vi.fn(),
        onCollapse: vi.fn(),
        onDrop,
      }),
    );
    // Press on EL2, then hold over the top half of EL4: the gap between EL3
    // and EL4.
    act(() => result.current.startDrag(press(10, 30), "EL2", "two", "part"));
    act(() => void window.dispatchEvent(pointer("pointermove", 10, 70)));
    expect(result.current.indicator).toEqual({ top: 3 * ROW_H, depth: 0 });
    act(() => void window.dispatchEvent(pointer("pointerup", 0, 0)));
    expect(onDrop).toHaveBeenCalledWith(["EL2"], {
      containerId: null,
      index: 3,
      depth: 0,
    });
  });
});
