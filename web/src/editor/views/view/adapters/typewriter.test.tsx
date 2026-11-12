// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
//
// Pins `TypewriterView`, the scroll view's sibling under the same contract,
// with the station as its scroller and the guide and feed as its own chrome.
// These rows pin the view-specific DOM (`data-view`, the guide, the feeds);
// `station.test.ts` and `typewriterScroller.test.ts` pin the station itself.

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { runViewContract } from "../contract.fixture";
import { TypewriterView } from "./typewriter";
import { EditorEngine } from "../../engine";
import { propsFor } from "../viewProps.fixture";

afterEach(() => cleanup());

runViewContract((props) => <TypewriterView {...props} />, "TypewriterView");

it("declares itself data-view=typewriter on the surface", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(<TypewriterView {...propsFor(engine)} />);
  expect(
    view.container.querySelector(".editor-surface")?.getAttribute("data-view"),
  ).toBe("typewriter");
});

it("draws the type guide beside the prose", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(<TypewriterView {...propsFor(engine)} />);
  // The guide renders; jsdom cannot see its station line.
  expect(view.container.querySelector(".type-guide")).toBeTruthy();
});

it("keeps the guide chevrons visible when the editor blurs (fixes.md #15)", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(<TypewriterView {...propsFor(engine)} />);
  const editable = view.container.querySelector(
    "[contenteditable]",
  ) as HTMLElement;
  const guide = view.container.querySelector(".type-guide") as HTMLElement;
  // Focus reveals the guide (`updateFakeCaret` paints it on the active
  // path), and blur leaves it in place: the station exists to be seen, even
  // while the writer's attention is in the tree or the find field.
  editable.focus();
  expect(guide.hidden).toBe(false);
  editable.blur();
  expect(guide.hidden).toBe(false);
});

it("hides the fake caret when focus is really lost (fixes.md #15)", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(<TypewriterView {...propsFor(engine)} />);
  const editable = view.container.querySelector(
    "[contenteditable]",
  ) as HTMLElement;
  const caret = view.container.querySelector(".fake-cursor") as HTMLElement;
  editable.focus();
  // jsdom measures no caret rect, so the core cannot paint the caret itself;
  // the row simulates the imperative paint, then blurs and expects it gone.
  caret.hidden = false;
  editable.blur();
  expect(caret.hidden).toBe(true);
});

it("hides the fake caret when focus moves to a field the writer types into (fixes.md #15)", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(<TypewriterView {...propsFor(engine)} />);
  const editable = view.container.querySelector(
    "[contenteditable]",
  ) as HTMLElement;
  const caret = view.container.querySelector(".fake-cursor") as HTMLElement;
  const field = document.createElement("input");
  document.body.appendChild(field);
  editable.focus();
  caret.hidden = false;
  // A real focus move: the editor blurs to the field, and the caret no
  // longer suggests typing will land in prose.
  field.focus();
  expect(caret.hidden).toBe(true);
  field.remove();
});

it("re-claims focus from chrome when the editor blurs (fixes.md #15)", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  // The core's blur guard measures against the shell: chrome inside it has
  // its focus re-claimed, and a portalled overlay outside it does not.
  const shell = document.createElement("div");
  shell.className = "editor-shell";
  document.body.appendChild(shell);
  const view = render(<TypewriterView {...propsFor(engine)} />, {
    container: shell,
  });
  const editable = view.container.querySelector(
    "[contenteditable]",
  ) as HTMLElement;
  const button = document.createElement("button");
  shell.appendChild(button);
  editable.focus();
  editable.dispatchEvent(new FocusEvent("blur", { relatedTarget: button }));
  expect(document.activeElement).toBe(editable);
  shell.remove();
});

it("leaves focus with a dock control it was clicked to (fixes.md #15)", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  // The dock is inside the shell, as on the wide plane, so only its own
  // exception keeps the focus where it went.
  const shell = document.createElement("div");
  shell.className = "editor-shell";
  document.body.appendChild(shell);
  const view = render(<TypewriterView {...propsFor(engine)} />, {
    container: shell,
  });
  const editable = view.container.querySelector(
    "[contenteditable]",
  ) as HTMLElement;
  const dock = document.createElement("aside");
  dock.className = "ed-dock";
  const tick = document.createElement("button");
  dock.appendChild(tick);
  shell.appendChild(dock);
  editable.focus();
  // Watched rather than read back: jsdom settles the real move after the
  // blur, whatever the handler asks for.
  const reclaim = vi.spyOn(editable, "focus");
  editable.dispatchEvent(new FocusEvent("blur", { relatedTarget: tick }));
  expect(reclaim).not.toHaveBeenCalled();
  shell.remove();
});

it("does not steal focus from a field the writer must type into (fixes.md #15)", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(<TypewriterView {...propsFor(engine)} />);
  const editable = view.container.querySelector(
    "[contenteditable]",
  ) as HTMLElement;
  const field = document.createElement("input");
  document.body.appendChild(field);
  editable.focus();
  // A real focus move, so `relatedTarget` is the field the blur reports.
  field.focus();
  expect(document.activeElement).toBe(field);
  field.remove();
});

it("sets the paper-feed depths on the surface while mounted", () => {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(<TypewriterView {...propsFor(engine)} />);
  const surface = view.container.querySelector(
    ".editor-surface",
  ) as HTMLElement;
  expect(surface.style.getPropertyValue("--feed-top")).toBeTruthy();
  expect(surface.style.getPropertyValue("--feed-bottom")).toBeTruthy();
});
