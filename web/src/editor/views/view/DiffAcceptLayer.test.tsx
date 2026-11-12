// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import DiffAcceptLayer from "./DiffAcceptLayer";
import type { EditorEngine } from "../engine";
import type { Hunk } from "../../engine";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// `DiffAcceptLayer` resolves `hunk.para` through the filtered paragraph list
// the highlighter uses (`getParagraphs`), never raw `editor.children`
// indexing: a non-block element among the paragraphs (an overlay marker, a
// stray wrapper) would desync the two index spaces. jsdom lays
// nothing out and every rect reads 0, so each paragraph's rect is stubbed to
// show which element was picked.

afterEach(() => cleanup());

function hunk(para: number): Hunk {
  return {
    id: 1,
    kind: "replace",
    block: false,
    para,
    merged: { from: 0, to: 1 },
    left: { para, from: 0, to: 1 },
    right: { para, from: 0, to: 1 },
  };
}

function mockEngine(hunks: Hunk[]): EditorEngine {
  return {
    inSnapshotDiff: true,
    diffDirection: "adoptedWithSelected",
    diffHunks: hunks,
    subscribe: () => () => {},
  } as unknown as EditorEngine;
}

describe("DiffAcceptLayer", () => {
  it("resolves hunk.para against the filtered paragraph list, not a raw DOM-child index desynced by a stray sibling", async () => {
    // `hunk.para === 2` names the engine's third real paragraph, "three".
    // Raw `editor.children[2]` would hit "two", because of the non-block
    // `.stray-marker` between "one" and "two".
    const engine = mockEngine([hunk(2)]);

    const surface = document.createElement("div");
    surface.className = "editor-surface";
    document.body.appendChild(surface);

    // The layer and `.editor` commit in the same React pass as siblings, as
    // in `EditorCore` (`.editor-surface` holding both). The layer's effect
    // runs synchronously on mount and bails if `.editor` is absent, and
    // `.editor`'s content is filled imperatively afterwards, as in the real
    // timing: the editor's first paint lands in a parent effect the child's
    // synchronous measure cannot see, so the row relies on the settle
    // re-measure.
    render(
      <>
        <DiffAcceptLayer engine={engine} />
        <div className="editor" />
      </>,
      { container: surface },
    );
    const editor = surface.querySelector<HTMLElement>(".editor") as HTMLElement;

    editor.innerHTML =
      "<p>one</p><div class='stray-marker'></div><p>two</p><p>three</p>";

    const two = editor.querySelectorAll("p")[1] as HTMLElement;
    const three = editor.querySelectorAll("p")[2] as HTMLElement;
    // Distinct, far-apart rects: jsdom lays out nothing, so they are the only
    // way to tell which element the layer anchored its measurement to.
    two.getBoundingClientRect = () => ({ bottom: 111, right: 111 }) as DOMRect;
    three.getBoundingClientRect = () =>
      ({ bottom: 999, right: 999 }) as DOMRect;

    // The measure effect's settle runs on a macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const wrap = surface.querySelector<HTMLElement>(".df-accept-wrap");
    expect(wrap).not.toBeNull();
    // Anchored to "three" (bottom 999), never "two" (bottom 111). The
    // `BUTTON_W` offset is fixed, so `top`, from `bottom` alone, tells the
    // two apart.
    expect(wrap?.style.top).toBe("999px");

    document.body.removeChild(surface);
  });
});
