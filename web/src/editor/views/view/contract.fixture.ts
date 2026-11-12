// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
//
// The writing view contract: what a compliant view must do. A new view
// (reading mode, manuscript, an AI drafting surface) is verified against the
// same rows as the shipped ones, so adding one cannot quietly stop typing
// from reaching the engine or a search from reaching the surface.
//
// It takes a `make(props)` factory rather than a component, because the
// contract is that any view handed the same props behaves the same. The suite
// runs against the `ScrollView` and `TypewriterView` adapters.
//
// Not asserted here: the docked-station invariant and the focus-dim paint.
// jsdom cannot measure layout, so both are real-browser checks: the station
// one is the Playwright probe in `e2e/station-probe.spec.ts`, and the dim one
// is style that exists only with `CSS.highlights`, which jsdom lacks.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import type { ReactElement } from "react";
import { EditorEngine } from "../engine";
import type { WritingViewProps } from "./port";
import { propsFor } from "./viewProps.fixture";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// jsdom has no client-rect measurement and no `scrollIntoView`. The editor's
// fake-caret bookkeeping and search-match scrolling call both.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () =>
  ({
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
Element.prototype.scrollIntoView = () => {};

const searched = {
  query: null,
  currentIndex: 0,
  caseSensitive: false,
  wholeWord: false,
  hyphensJoinWords: false,
};

const firstTextNode = (el: HTMLElement) => {
  const p = el.querySelector("p");
  if (p === null) throw new Error("view contract: no <p> in the surface");
  return p.firstChild as Text;
};

function selectIn(el: HTMLElement, start: number, end?: number) {
  const text = firstTextNode(el);
  const domSel = window.getSelection();
  domSel?.removeAllRanges();
  const range = document.createRange();
  range.setStart(text, start);
  if (end !== undefined) range.setEnd(text, end);
  else range.collapse(true);
  domSel?.addRange(range);
}

const beforeInput = (
  el: HTMLElement,
  init: InputEventInit & { dataTransfer?: DataTransfer },
) => {
  const ev = new InputEvent("beforeinput", init);
  (ev as unknown as { dataTransfer?: DataTransfer }).dataTransfer =
    init.dataTransfer;
  fireEvent(el, ev);
};

/** Fire a `paste` ClipboardEvent with the OS clipboard's two flavors. */
const paste = (el: HTMLElement, data: { html?: string; plain?: string }) => {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: {
      getData: (t: string) =>
        t === "text/html" ? (data.html ?? "") : (data.plain ?? ""),
      setData: () => {},
    },
  });
  fireEvent(el, ev);
};

/**
 * The rows every view must satisfy. Labeled with the adapter pair it runs
 * against, so a failure says which view broke the contract.
 */
export function runViewContract(
  make: (props: WritingViewProps) => ReactElement,
  label: string,
): void {
  describe(`the writing view contract — ${label}`, () => {
    afterEach(() => cleanup());

    /** A fresh engine and view; `surface()` and `editable()` find its nodes. */
    function mount(doc: string, extra: Partial<WritingViewProps> = {}) {
      const engine = new EditorEngine();
      engine.open(doc);
      const view = render(make(propsFor(engine, extra)));
      const surface = () =>
        view.container.querySelector(".editor-surface") as HTMLElement | null;
      const editable = () =>
        view.container.querySelector("[contenteditable]") as HTMLElement | null;
      return { engine, ...view, surface, editable };
    }

    it("renders the engine document on an editable surface that wears the prose size", () => {
      const { surface, editable } = mount("Hello world");
      expect(surface()).toBeTruthy();
      expect(editable()?.textContent).toBe("Hello world");
      expect(editable()?.getAttribute("contenteditable")).toBe("true");
      // The writer proofreads, not the browser: a spellcheck squiggle would
      // fight the engine's own marks on the same pixels.
      expect(editable()?.getAttribute("spellcheck")).toBe("false");
      // The shell's value lands on the surface the view owns.
      expect(surface()?.getAttribute("style")).toContain("--prose-size: 19px");
    });

    it("restores the engine selection into the DOM on mount", () => {
      const { editable } = mount("Hello world");
      // `focus` alone leaves the caret at the element boundary, where a
      // collapsed range has no client rects in a real browser and cannot be
      // measured, docked or blinked. The mount must put the caret inside the
      // prose; the Playwright probe's settle sees nothing when it does not.
      const sel = window.getSelection();
      expect(sel?.rangeCount).toBe(1);
      // The editable surface is the row's premise; a missing one fails here
      // with a real message instead of asserting through a `!`.
      const editableEl = editable();
      if (editableEl === null)
        throw new Error("view contract: editable surface missing");
      expect(sel?.getRangeAt(0).startContainer).toBe(firstTextNode(editableEl));
    });

    it("wears the writer’s chosen size, and only that", () => {
      const { surface } = mount("Hello world", { proseSize: 21 });
      expect(surface()?.getAttribute("style")).toContain("--prose-size: 21px");
      expect(surface()?.getAttribute("style")).not.toContain("19px");
    });

    it("draws the chosen step at the pixels the theme's scale gives it", () => {
      const { surface } = mount("Hello world", {
        proseSize: 19,
        proseScale: { 17: 15, 19: 17, 21: 19 },
      });
      expect(surface()?.getAttribute("style")).toContain("--prose-size: 17px");
    });

    it("routes typing and enter through beforeinput, and paste through the paste event", () => {
      const { engine, editable } = mount("Hello world");
      const el = editable();
      if (el === null)
        throw new Error("view contract: editable surface missing");
      selectIn(el, 11);
      beforeInput(el, { inputType: "insertText", data: "!" });
      expect(engine.commonmark).toBe("Hello world!");

      // The engine restores the DOM caret to the paragraph end after typing,
      // so Enter needs no re-selection, and one would fight the `char-fade-in`
      // span the view wrapped the typed character in.
      beforeInput(el, { inputType: "insertParagraph" });
      // The document grew past the original line; how the engine separates
      // paragraphs (single or double newline) is its business, not the view's.
      expect(engine.commonmark.startsWith("Hello world!")).toBe(true);
      expect(engine.commonmark.length).toBeGreaterThan("Hello world!".length);

      // The ClipboardEvent owns paste, not beforeinput, which carries only the
      // plain half of the clipboard.
      paste(el, { plain: " pasted" });
      expect(engine.commonmark).toContain("pasted");
    });

    it("wraps each typed character in the fade-in span (fixes.md #7)", () => {
      const { editable } = mount("Hello world");
      const el = editable();
      if (el === null)
        throw new Error("view contract: editable surface missing");
      selectIn(el, 11);
      beforeInput(el, { inputType: "insertText", data: "!" });
      // The engine's typing hint (`cursorBefore` + `typedText`) is what the
      // core uses to find the just-typed character and wrap it in
      // `.char-fade-in`, so this row pins the mechanism that the CSS in
      // `editorCss.test.ts` makes visible.
      const fade = el.querySelector(".char-fade-in");
      expect(fade).toBeTruthy();
      expect(fade?.textContent).toBe("!");
    });

    it("springs the caret ahead when a character lands and smooth caret is on (fixes.md #7)", () => {
      const { surface, editable } = mount("Hello world", { smoothCaret: true });
      const el = editable();
      if (el === null)
        throw new Error("view contract: editable surface missing");
      selectIn(el, 11);
      beforeInput(el, { inputType: "insertText", data: "!" });
      // The core drops `.caret-bounce` synchronously, before the deferred
      // re-measure moves the caret, so a keystroke's spring is visible the
      // moment the character lands, and not on arrow-key or scroll moves.
      const caret = surface()?.querySelector(".fake-cursor");
      expect(caret?.classList.contains("caret-bounce")).toBe(true);
    });

    it("keeps the caret still when smooth caret is off — the default (fixes.md #7)", () => {
      const { surface, editable } = mount("Hello world");
      const el = editable();
      if (el === null)
        throw new Error("view contract: editable surface missing");
      selectIn(el, 11);
      beforeInput(el, { inputType: "insertText", data: "!" });
      // Off by default: a project that never asked for the spring gets an
      // instant caret, not a bouncy one.
      const caret = surface()?.querySelector(".fake-cursor");
      expect(caret?.classList.contains("caret-bounce")).toBe(false);
    });

    it("syncs the logical selection from a DOM selection", () => {
      const { engine, editable } = mount("Hello world");
      const el = editable();
      if (el === null)
        throw new Error("view contract: editable surface missing");
      selectIn(el, 6, 8);
      document.dispatchEvent(new Event("selectionchange"));
      expect(engine.selection).toEqual({
        anchor: { para: 0, offset: 6 },
        focus: { para: 0, offset: 8 },
      });
    });

    it("applies search highlights when a search is active", () => {
      const { editable } = mount("Hello world", {
        search: { ...searched, query: "world", currentIndex: 0 },
      });
      const current = editable()?.querySelector("mark.hl-search-current");
      expect(current?.textContent).toBe("world");
    });

    it("highlights repetitions of the selected word", () => {
      const { editable } = mount("Hello world world", {
        selection: {
          text: "world",
          exactText: "world",
          showRepetitions: true,
        },
      });
      // The engine selection still sits at the start of the paragraph, so both
      // occurrences count as repetitions of the (hypothetical) selected one.
      expect(editable()?.querySelectorAll("mark.hl-repetition").length).toBe(2);
    });

    it("routes command shortcuts through the engine at the synced selection", () => {
      const { engine, editable } = mount("Hello world");
      const el = editable();
      if (el === null)
        throw new Error("view contract: editable surface missing");
      selectIn(el, 5, 8);
      fireEvent.keyDown(el, { key: "b", ctrlKey: true });
      // The shortcut itself is `shortcuts.ts`'s business; the view's share is
      // that a command key reaches the engine with the DOM selection synced.
      expect(engine.isBold).toBe(true);
    });

    it("marks the selected occurrence as the current search hit", () => {
      const { editable } = mount("Hello world", {
        search: { ...searched, query: "o", currentIndex: 1 },
      });
      // One current, and the other hits stay plain: the index must reach the
      // highlight pass, not only the query.
      const current = editable()?.querySelector("mark.hl-search-current");
      expect(current?.textContent).toBe("o");
      expect(editable()?.querySelectorAll("mark.hl-search").length).toBe(1);
    });

    it("renders the fake caret in the surface, ready for the blink", () => {
      const { surface, editable } = mount("Hello world");
      // jsdom cannot show the blink; the contract is that the overlay node
      // exists inside the surface, positioned by the rect reads the
      // strategies use.
      expect(surface()?.querySelector(".fake-cursor")).toBeTruthy();
      expect(editable()).toBeTruthy();
    });

    it("renders the desk stand-in beside the editor, never instead of it", () => {
      const { container, editable } = mount("Hello world", {
        desk: createElement("div", { className: "contract-desk" }),
      });
      expect(container.querySelector(".contract-desk")).toBeTruthy();
      // Mounted and hidden by the `data-desk` CSS gate, not unmounted:
      // remounting would throw away the engine parse.
      expect(editable()?.getAttribute("contenteditable")).toBe("true");
    });

    it("frames the prose before and after it in the surface, never inside it", () => {
      const { surface, editable } = mount("Hello world", {
        frame: {
          head: createElement("div", { className: "contract-head" }),
          foot: createElement("div", { className: "contract-foot" }),
        },
      });
      const head = surface()?.querySelector(":scope > .contract-head");
      const foot = surface()?.querySelector(":scope > .contract-foot");
      const prose = editable();
      if (!head || !foot || !prose)
        throw new Error("the frame's head, its foot or the prose is missing");
      expect(prose.contains(head) || prose.contains(foot)).toBe(false);
      expect(
        head.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        prose.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("hands the gutter the editor and the surface it lives on", () => {
      let captured: [HTMLElement | null, HTMLElement | null] = [null, null];
      const engine = new EditorEngine();
      engine.open("Hello world");
      const { container, rerender } = render(make(propsFor(engine)));
      const surface = container.querySelector(".editor-surface") as HTMLElement;
      const editable = container.querySelector(
        "[contenteditable]",
      ) as HTMLElement;
      rerender(
        make(
          propsFor(engine, {
            gutter: (editor, surfaceEl) => {
              captured = [editor, surfaceEl];
              return null;
            },
          }),
        ),
      );
      expect(captured[0]).toBe(editable);
      expect(captured[1]).toBe(surface);
    });
  });
}
