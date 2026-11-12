// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
//
// Pins what `ScrollView` does beyond the shared view contract. The contract's
// rows are the behaviours the shell depends on; these rows are the ones a
// view may change freely, and the ones that must change with the view, which
// the pinned DOM records.

import { afterEach, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { runViewContract } from "../contract.fixture";
import { ScrollView } from "./scroll";
import { EditorEngine } from "../../engine";
import { propsFor } from "../viewProps.fixture";

runViewContract((props) => <ScrollView {...props} />, "ScrollView");

afterEach(cleanup);

it("declares itself data-view=scroll on the surface", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(<ScrollView {...propsFor(engine)} />);
  expect(
    view.container.querySelector(".editor-surface")?.getAttribute("data-view"),
  ).toBe("scroll");
});

it("wears the desk stand-in under the data-desk gate", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(
    <ScrollView {...propsFor(engine)} desk={<div className="scroll-desk" />} />,
  );
  expect(view.container.querySelector(".scroll-desk")).toBeTruthy();
});

it("renders the comparing mode: read-only surface, merged doc, marks", () => {
  const engine = new EditorEngine();
  engine.open("the old house stood empty");
  engine.enterDiff("the house stood empty");
  const view = render(<ScrollView {...propsFor(engine)} />);
  const editor = view.container.querySelector(".editor") as HTMLElement;
  const surface = view.container.querySelector(".editor-surface");
  // The surface is read-only and declares the mode for the stylesheet. The
  // attribute is on the surface, whose descendants are the caret, the guide
  // and the editor; on the editor, no selector could reach the first two.
  expect(editor.getAttribute("contenteditable")).toBe("false");
  expect(surface?.getAttribute("data-diff")).toBe("1");
  // The merged doc is on screen: the deleted word is back, struck.
  expect(editor.textContent).toBe("the old house stood empty");
  expect(editor.querySelector("mark.df-deleted")?.textContent).toBe(" old");
  // Returning to the adopted text restores editing and clears the marks.
  engine.exitDiff();
  const again = render(<ScrollView {...propsFor(engine)} />);
  const editor2 = again.container.querySelector(".editor") as HTMLElement;
  const surface2 = again.container.querySelector(".editor-surface");
  expect(editor2.getAttribute("contenteditable")).toBe("true");
  expect(surface2?.hasAttribute("data-diff")).toBe(false);
  expect(editor2.querySelector("mark.df-deleted")).toBeNull();
});

it("renders one hover-hidden Accept button per hunk in the comparing mode", async () => {
  const engine = new EditorEngine();
  engine.open("the old house stood empty");
  engine.enterDiff("the house stood empty");
  const view = render(<ScrollView {...propsFor(engine)} />);
  // The layer measures on the frame after the editor's first paint (the
  // paint is a parent effect; the layer's measure is a child effect).
  await waitFor(() =>
    expect(view.container.querySelectorAll(".df-accept")).toHaveLength(1),
  );
  const buttons = view.container.querySelectorAll(".df-accept");
  // Hidden until the pointer arms its hunk or the keyboard focuses it. The
  // reveal class is the state; the e2e rows pin pixel positions.
  expect(buttons[0].classList.contains("revealed")).toBe(false);
  // The tag is chrome, never inside the editable.
  expect(view.container.querySelector(".editor .df-accept")).toBeNull();
});

it("carries the hunk's kind so the tag takes the change's hue", async () => {
  const engine = new EditorEngine();
  engine.open("the old house stood empty");
  engine.enterDiff("the house stood empty");
  const view = render(<ScrollView {...propsFor(engine)} />);
  await waitFor(() =>
    expect(view.container.querySelectorAll(".df-accept")).toHaveLength(1),
  );
  // The tag forwards the hunk's kind as `data-kind`; the stylesheet paints
  // `[data-kind="delete"]` with the deletion's tokens and every other kind
  // (insert, replace) with the addition's, since a replacement accepts into
  // the new text.
  expect(
    view.container.querySelector(".df-accept")?.getAttribute("data-kind"),
  ).toBe("delete");
  // The tag is part of the wash: no bridge element, since it sits flush
  // under the wash (the e2e rows pin the alignment), and no chrome.
  expect(view.container.querySelector(".df-accept-bridge")).toBeNull();
});

it("clicking Accept applies exactly that hunk as one undoable step", async () => {
  const engine = new EditorEngine();
  engine.open("the old house stood empty");
  engine.enterDiff("the house stood empty");
  const view = render(<ScrollView {...propsFor(engine)} />);
  const before = engine.commonmark;
  let button: Element | null = null;
  await waitFor(() => {
    button = view.container.querySelector(".df-accept");
    expect(button).not.toBeNull();
  });
  if (!button) throw new Error("no Accept button rendered");
  fireEvent.click(button);
  expect(engine.commonmark).toBe("the house stood empty");
  expect(engine.commonmark).not.toBe(before);
  // One undoable step: one undo returns to the original.
  engine.undo();
  expect(engine.commonmark).toBe(before);
});

it("shows no Accept buttons in the rail's walk", () => {
  const engine = new EditorEngine();
  engine.open("one");
  engine.type(" two");
  engine.markSaved(engine.save());
  engine.enterHistoryDiff();
  engine.walkHistory(-1); // walked — decorations exist, but the rail never accepts
  const view = render(<ScrollView {...propsFor(engine)} />);
  expect(view.container.querySelector(".df-accept")).toBeNull();
});

it("— a formatting-only step of the rail walk paints its mark", () => {
  // The walk's only change is the block face (a heading to paragraph swap),
  // where no word changes and the token merge finds nothing. The block face
  // is part of the block identity, so the step surfaces as one
  // whole-paragraph change and the walked paragraph is marked on screen.
  const engine = new EditorEngine();
  engine.open("A heading");
  engine.setBlockType("h1");
  engine.markSaved(engine.save());
  engine.enterHistoryDiff();
  engine.walkHistory(-1);
  expect(engine.diffDecorations).toEqual([
    { para: 0, from: 0, to: 9, kind: "inserted" },
  ]);
  const view = render(<ScrollView {...propsFor(engine)} />);
  expect(view.container.querySelector("mark.df-inserted")?.textContent).toBe(
    "A heading",
  );
});

it("— an Accept click lands even when the recalc removes the button between pointerdown and mouseup", async () => {
  // The accept applies synchronously and the doc notify repaints, so a
  // button mounted inside a paragraph could be replaced between pointerdown
  // and mouseup and the click would never fire. The tag lives in a sibling
  // layer that `patchDocument` never touches, so the click completes and
  // applies one op. jsdom does not synthesize a click from an untrusted
  // mouseup, so the row fires the click itself; the Playwright rows pin the
  // real pointer gesture.
  const engine = new EditorEngine();
  engine.open("the old house stood empty");
  engine.enterDiff("the house stood empty");
  const view = render(<ScrollView {...propsFor(engine)} />);
  let button: Element | null = null;
  await waitFor(() => {
    button = view.container.querySelector(".df-accept");
    expect(button).not.toBeNull();
  });
  if (!button) throw new Error("no Accept button rendered");
  const before = engine.commonmark;
  fireEvent.click(button);
  expect(engine.commonmark).not.toBe(before);
  // Exactly one undoable op: one undo returns to the original.
  engine.undo();
  expect(engine.commonmark).toBe(before);
});

it("— a grain switch clears the placed tags before any click", async () => {
  const engine = new EditorEngine();
  engine.open("one x two y three");
  engine.enterDiff("one a two b three");
  const view = render(<ScrollView {...propsFor(engine)} />);
  await waitFor(() =>
    expect(
      view.container.querySelectorAll(".df-accept").length,
    ).toBeGreaterThan(0),
  );
  // A grain switch mid-comparison leaves no tag pointing at a hunk that no
  // longer exists; a stale tag over a new wash would make its click a
  // silent no-op.
  engine.setDiffGranularity("paragraph");
  await waitFor(() => {
    const tags = view.container.querySelectorAll<HTMLElement>(".df-accept");
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const id = Number(tag.dataset.hunkId);
      expect(engine.diffHunks.some((h) => h.id === id)).toBe(true);
    }
  });
});

it("the direction lens re-diffs without losing the reading position, and the Accept affordance follows the lens", async () => {
  // The paper is the reading surface, so a lens switch never snaps the
  // scroll to the top mid-pass. Accept is offered only in the
  // Adopted to Selected reading; the other direction is a pure comparison
  // whose washes carry no affordance. The tags leave with the lens, on the
  // same doc notify the grain switch uses, so none is stranded.
  const engine = new EditorEngine();
  engine.open("the old house stood empty");
  engine.enterDiff("the new house stood empty");
  const view = render(<ScrollView {...propsFor(engine)} />);
  await waitFor(() =>
    expect(
      view.container.querySelectorAll(".df-accept").length,
    ).toBeGreaterThan(0),
  );
  const surface = view.container.querySelector(
    ".editor-surface",
  ) as HTMLElement;
  surface.scrollTop = 42;
  // Flipping the direction swaps the struck and the green sides, and the
  // accept affordance leaves with the lens.
  act(() => engine.setDiffDirection("selectedWithAdopted"));
  expect(engine.diffDecorations.some((d) => d.kind === "deleted")).toBe(true);
  // The scroll position survived the switch.
  expect(surface.scrollTop).toBe(42);
  // No Accept in the read-only reading, and none stranded from before.
  expect(view.container.querySelectorAll(".df-accept").length).toBe(0);
  // Back to the actionable reading: the tags return and map to the current
  // hunk set.
  act(() => engine.setDiffDirection("adoptedWithSelected"));
  const tags = view.container.querySelectorAll<HTMLElement>(".df-accept");
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) {
    const id = Number(tag.dataset.hunkId);
    expect(engine.diffHunks.some((h) => h.id === id)).toBe(true);
  }
});
