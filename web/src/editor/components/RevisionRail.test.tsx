// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { EditorEngine } from "../views/engine";
import { DeltaTimeline } from "../engine/adapters/delta";
import RevisionRail from "./RevisionRail";

// The revision rail's wiring: the toggle, the wheel grammar applied to the
// engine's preview walk (the buffer never moves), the chip's two exits
// (Cancel always, Revert off-Now), Esc/paper/typing as the plain close, the
// ↑/↓ keyboard voice, the file-switch close, and the markers' honesty (the
// fork-tick only when a parked future exists). The dim and the hollow caret
// are CSS; the `data-timeline` attribute they key off is what these tests
// assert.

// The real `t` from i18next is stable across renders — the mock must be too,
// or a hook whose identity depends on `t` re-creates itself every render.
const t = (key: string) => key;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));

// The rail's state lives in the shell (the bar's history button is a
// sibling), so the harness owns it the same way `EditorRoute` does: the open
// prop and the two callbacks it hands the rail.
function Harness({
  engine,
  shell,
  activeFile,
}: {
  engine: EditorEngine;
  shell: HTMLElement;
  activeFile: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <RevisionRail
      engine={engine}
      activeFile={activeFile}
      shellRef={{ current: shell }}
      open={open}
      onToggle={() => setOpen((now) => !now)}
      onClose={() => setOpen(false)}
    />
  );
}

/** Build the rail's DOM home and render it around an engine. */
function mount(engine: EditorEngine) {
  const shell = document.createElement("div");
  shell.className = "editor-shell";
  const surface = document.createElement("div");
  surface.className = "editor-surface";
  const editor = document.createElement("div");
  editor.className = "editor";
  surface.appendChild(editor);
  shell.appendChild(surface);
  document.body.appendChild(shell);
  const view = render(
    <Harness engine={engine} shell={shell} activeFile="section--storm.md" />,
  );
  return { engine, shell, surface, view };
}

function make() {
  const engine = new EditorEngine();
  engine.open("The storm");
  engine.type("!"); // "!The storm" — step 1
  engine.updateSelection({
    anchor: { para: 0, offset: 2 },
    focus: { para: 0, offset: 2 },
  });
  engine.type("x"); // "!Txhe storm" — step 2 (the cursor gap breaks the burst)
  return mount(engine);
}

/** An engine whose timeline carries no stamps — a pre-timestamp journal
 * hydrated as-is, so `peekTimestamp` answers null. The rail must walk and
 * simply show no label. */
function makeTsless() {
  const seed = new DeltaTimeline();
  const writer = new EditorEngine({ history: seed });
  writer.open("The storm");
  writer.type("!");
  const raw = JSON.parse(seed.exportJournal() as string) as {
    nodes: Record<string, { ts?: unknown }>;
  };
  for (const n of Object.values(raw.nodes)) delete n.ts;
  const journal = JSON.stringify(raw);
  const tsless = new DeltaTimeline();
  tsless.importJournal(journal);
  const engine = new EditorEngine({ history: tsless });
  engine.open("!The storm", { journal });
  return mount(engine);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const openRail = () =>
  fireEvent.keyDown(window, { key: "h", ctrlKey: true, shiftKey: true });

const wheel = (surface: HTMLElement, deltaY: number, deltaMode = 1) =>
  fireEvent.wheel(surface, { deltaY, deltaMode });

describe("the revision rail", () => {
  it("is zero chrome until Ctrl+Shift+H asks for it, then carries the state attribute", () => {
    const { shell, view } = make();
    expect(shell.hasAttribute("data-timeline")).toBe(false);
    expect(view.container.querySelector(".rev-rail")).toBeNull();
    openRail();
    expect(shell.getAttribute("data-timeline")).toBe("1");
    expect(view.container.querySelector(".rev-rail")).not.toBeNull();
  });

  it("the wheel previews — wheel-up walks older, wheel-down toward Now, the buffer never moves", () => {
    const { engine, surface } = make();
    openRail();
    expect(engine.commonmark).toBe("!Txhe storm");
    wheel(surface, -3); // one notch up: preview the "x" step
    expect(engine.historyWalkDepth).toBe(1);
    expect(engine.commonmark).toBe("!Txhe storm");
    wheel(surface, -3);
    expect(engine.historyWalkDepth).toBe(2); // the root — no further walk
    wheel(surface, -3);
    expect(engine.historyWalkDepth).toBe(2);
    wheel(surface, 3); // back down toward Now
    expect(engine.historyWalkDepth).toBe(1);
    wheel(surface, 3);
    expect(engine.historyWalkDepth).toBe(0);
    // There is no redo region: a wheel-down at Now does nothing.
    wheel(surface, 3);
    expect(engine.historyWalkDepth).toBe(0);
    expect(engine.commonmark).toBe("!Txhe storm");
  });

  it("the marker hollows off-Now and fills back at Now", () => {
    const { surface, view } = make();
    openRail();
    const atNow = view.container.querySelector(".rev-rail-head");
    expect(atNow?.className).not.toContain("rev-rail-head-walking");
    wheel(surface, -3);
    const walked = view.container.querySelector(".rev-rail-head");
    expect(walked?.className).toContain("rev-rail-head-walking");
    wheel(surface, 3);
    const back = view.container.querySelector(".rev-rail-head");
    expect(back?.className).not.toContain("rev-rail-head-walking");
  });

  it("a wheel on the paper never scrolls it — the event is swallowed in capture", () => {
    const { surface, view } = make();
    openRail();
    let reachedEditor = false;
    surface.addEventListener(
      "wheel",
      () => {
        reachedEditor = true;
      },
      { capture: false },
    );
    wheel(surface, -3);
    expect(reachedEditor).toBe(false);
    expect(view.container.querySelector(".rev-rail-head")).not.toBeNull();
  });

  it("Esc closes without changes — the walk never touched the buffer", () => {
    const { engine, shell, surface, view } = make();
    openRail();
    wheel(surface, -3);
    expect(engine.historyWalkDepth).toBe(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(engine.historyWalkDepth).toBe(0);
    expect(engine.commonmark).toBe("!Txhe storm");
    expect(shell.hasAttribute("data-timeline")).toBe(false);
    expect(view.container.querySelector(".rev-rail")).toBeNull();
  });

  it("a printable keystroke closes without eating the keystroke", () => {
    const { shell } = make();
    openRail();
    fireEvent.keyDown(window, { key: "x" });
    expect(shell.hasAttribute("data-timeline")).toBe(false);
    // The keystroke itself was not prevented: the editor's handler owns it.
  });

  it("a file switch closes the rail", () => {
    const { engine, shell, view } = make();
    openRail();
    expect(shell.hasAttribute("data-timeline")).toBe(true);
    view.rerender(
      <Harness
        engine={engine}
        shell={shell}
        activeFile="section--elsewhere.md"
      />,
    );
    expect(shell.hasAttribute("data-timeline")).toBe(false);
  });

  it("the fork-tick appears only when a parked future exists, with the parked tooltip", () => {
    const { engine, surface, view } = make();
    engine.undo();
    engine.type("The sun"); // parks the "!" future
    openRail();
    const fork = view.container.querySelector(".rev-rail-fork");
    expect(fork).not.toBeNull();
    expect(fork?.getAttribute("title")).toBe("history.parkedTooltip");
    void surface;
  });

  it("a plain timeline shows no fork-tick", () => {
    const { engine, view } = make();
    openRail();
    expect(view.container.querySelector(".rev-rail-fork")).toBeNull();
    void engine;
  });

  it("the head marker's title is the next step's label, with the fallbacks", () => {
    const { engine, view } = make();
    engine.open("cat cat");
    engine.replaceAll(
      "cat",
      "dog",
      { caseSensitive: false, wholeWord: false },
      false,
      "Replace all",
    );
    openRail();
    expect(
      view.container.querySelector(".rev-rail-head")?.getAttribute("title"),
    ).toBe("history.undoTooltip");
  });
});

describe("the rail's chip — the two exits", () => {
  it("Cancel always, Revert only off-Now", () => {
    const { surface, view } = make();
    openRail();
    expect(screen.getByRole("button", { name: "confirm.cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "history.revert" })).toBeNull();
    wheel(surface, -3);
    expect(screen.getByRole("button", { name: "history.revert" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "confirm.cancel" })).toBeTruthy();
    void view;
  });

  it("Revert to here applies the walked state as ONE undoable step and closes", () => {
    const { engine, shell, surface, view } = make();
    openRail();
    wheel(surface, -3); // previewing "!The storm"
    fireEvent.click(screen.getByRole("button", { name: "history.revert" }));
    expect(engine.inHistoryDiff).toBe(false);
    expect(engine.commonmark).toBe("!The storm");
    expect(shell.hasAttribute("data-timeline")).toBe(false);
    // One step: Ctrl+Z walks the whole restore back to the tip.
    engine.undo();
    expect(engine.commonmark).toBe("!Txhe storm");
    void view;
  });

  it("Cancel closes without changes", () => {
    const { engine, shell, surface, view } = make();
    openRail();
    wheel(surface, -3);
    fireEvent.click(screen.getByRole("button", { name: "confirm.cancel" }));
    expect(engine.inHistoryDiff).toBe(false);
    expect(engine.commonmark).toBe("!Txhe storm");
    expect(shell.hasAttribute("data-timeline")).toBe(false);
    void view;
  });

  it("↑ and ↓ walk the preview — the keyboard voice, the caret never travels", () => {
    const { engine, surface, view } = make();
    openRail();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(engine.historyWalkDepth).toBe(1);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(engine.historyWalkDepth).toBe(2);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(engine.historyWalkDepth).toBe(1);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(engine.historyWalkDepth).toBe(0);
    // Strictly look-back: ↓ at Now does nothing.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(engine.historyWalkDepth).toBe(0);
    // The buffer never moved under the keyboard either.
    expect(engine.commonmark).toBe("!Txhe storm");
    void surface;
    void view;
  });

  it("an arrow inside another field is that field's caret, not the walk", () => {
    // The tree's search, a rename input — a field outside the paper. While
    // the rail is up its window-capture arrows must not hijack them: the
    // caret would freeze and the preview would step under a writer who was
    // editing a name.
    const { engine, shell, view } = make();
    openRail();
    const input = document.createElement("input");
    shell.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(engine.historyWalkDepth).toBe(0);
    void view;
  });

  it("the exit announce survives the close — the live region stays mounted", () => {
    const { engine, surface, view } = make();
    openRail();
    wheel(surface, -3); // a walk left at a depth
    fireEvent.click(screen.getByRole("button", { name: "confirm.cancel" }));
    // The rail is shut, but the live region it voices through is still in the
    // DOM and carries the return announce — a region that unmounted with the
    // rail would never have spoken it.
    const live = document.querySelector(".rev-live");
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe("history.returnedToNow");
    expect(engine.commonmark).toBe("!Txhe storm");
    void view;
  });
});

describe("the chip's step buttons — the walk without a wheel", () => {
  it("↑ and ↓ walk the preview one step per click, and the bounds show", () => {
    const { engine, view } = make();
    openRail();
    const older = () =>
      screen.getByRole<HTMLButtonElement>("button", {
        name: "history.stepOlder",
      });
    const towardNow = () =>
      screen.getByRole<HTMLButtonElement>("button", {
        name: "history.stepTowardNow",
      });

    // At Now there is nothing toward Now — the down button is disabled; up is
    // live until the walk hits the root.
    expect(towardNow().disabled).toBe(true);
    expect(older().disabled).toBe(false);

    fireEvent.click(older());
    expect(engine.historyWalkDepth).toBe(1);
    fireEvent.click(older());
    expect(engine.historyWalkDepth).toBe(2);
    // At the root there is nothing older — up is disabled now.
    expect(older().disabled).toBe(true);

    fireEvent.click(towardNow());
    expect(engine.historyWalkDepth).toBe(1);
    fireEvent.click(towardNow());
    expect(engine.historyWalkDepth).toBe(0);
    expect(towardNow().disabled).toBe(true);
    // The buffer never moved under the buttons either — the same preview
    // seam the wheel, trackpad and arrows ride.
    expect(engine.commonmark).toBe("!Txhe storm");
    void view;
  });

  it("the step pair is its own element, detached from the exits chip", () => {
    // The ↑/↓ buttons are two single buttons on the left,
    // detached from the Cancel/Accept chip — their own container, separate
    // from the surface that holds the exits. The chip floats to their right,
    // anchored to the pair, so it can grow rightward when the walk leaves Now
    // and Revert joins without shifting the pair at all.
    const { surface, view } = make();
    openRail();
    const steps = view.container.querySelector(".rev-steps") as HTMLElement;
    const chip = view.container.querySelector(".rev-chip") as HTMLElement;
    expect(steps).not.toBeNull();
    expect(chip).not.toBeNull();
    expect(steps.contains(chip)).toBe(false);
    expect(steps.querySelectorAll("button").length).toBe(2);
    // The chip holds only the exits: Cancel at Now, Revert joining off-Now.
    expect(chip.querySelectorAll("button").length).toBe(1);
    wheel(surface, -3);
    expect(chip.querySelectorAll("button").length).toBe(2);
    void surface;
    void view;
  });
});

describe("the rail and the diff modes", () => {
  it("opening the rail enters the history walk, and closing it leaves", () => {
    const { engine, shell, surface } = make();
    openRail();
    expect(engine.inHistoryDiff).toBe(true);
    expect(engine.isInDiff).toBe(true);
    // The displayed doc is the merged comparison — the wheel's step shows
    // the walked state against the newest, and the mode follows it.
    wheel(surface, -3);
    expect(engine.diffDecorations.length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(engine.inHistoryDiff).toBe(false);
    expect(engine.diffDecorations).toEqual([]);
    expect(shell.hasAttribute("data-timeline")).toBe(false);
  });

  it("a snapshot comparison up refuses the walk's toggle — never both", () => {
    const { engine, shell } = make();
    engine.enterDiff("other text");
    openRail();
    // The toggle is refused while the snapshot comparison owns the editor.
    expect(shell.hasAttribute("data-timeline")).toBe(false);
    expect(engine.inSnapshotDiff).toBe(true);
    expect(engine.inHistoryDiff).toBe(false);
  });

  it("a snapshot comparison entering closes an open rail, and leaving it does not re-open the walk", () => {
    const { engine, shell } = make();
    openRail();
    expect(engine.inHistoryDiff).toBe(true);
    // The comparison takes the editor: the rail closes outright,
    // so its wheel can never walk under the merged view.
    act(() => engine.enterDiff("other text"));
    expect(shell.hasAttribute("data-timeline")).toBe(false);
    expect(engine.inHistoryDiff).toBe(false);
    expect(engine.inSnapshotDiff).toBe(true);
    // The comparison ends: the rail stays shut — no silent re-entry into a
    // history walk the writer never asked to resume.
    act(() => engine.exitDiff());
    expect(shell.hasAttribute("data-timeline")).toBe(false);
    expect(engine.isInDiff).toBe(false);
  });

  it("typing closes the rail from any walk depth — the keystroke lands at Now", () => {
    const { engine, shell, surface } = make();
    openRail();
    wheel(surface, -3);
    expect(engine.historyWalkDepth).toBe(1);
    fireEvent.keyDown(window, { key: "x" });
    // The rail lets go; the mode exits (the session lands the keystroke in
    // the real buffer — pinned in the session's own tests); the preview
    // never moved the head, so the buffer is exactly the tip.
    expect(shell.hasAttribute("data-timeline")).toBe(false);
    expect(engine.inHistoryDiff).toBe(false);
    expect(engine.historyWalkDepth).toBe(0);
    expect(engine.commonmark).toBe("!Txhe storm");
  });
});

describe("the walked step's stamp", () => {
  it("the datetime of the walked point appears beside the ball, off-Now", () => {
    const { surface, view } = make();
    openRail();
    expect(view.container.querySelector(".rev-rail-time")).toBeNull();
    wheel(surface, -3);
    const label = view.container.querySelector(".rev-rail-time");
    expect(label).not.toBeNull();
    // The fixed two-line shape: "Tue, 12 Aug 2026\n14:32:12".
    expect(label?.textContent).toMatch(
      /^\w{3}, \d{1,2} \w{3} \d{4}\n\d{2}:\d{2}:\d{2}$/,
    );
    // The label rides the marker's own position — it never lags the ball.
    const head = view.container.querySelector(".rev-rail-head") as HTMLElement;
    const time = label as HTMLElement;
    expect(time.style.top).toBe(head.style.top);
  });

  it("the label goes quiet at Now — the foot's own 'Now' label is the truth", () => {
    const { surface, view } = make();
    openRail();
    wheel(surface, -3);
    expect(view.container.querySelector(".rev-rail-time")).not.toBeNull();
    wheel(surface, 3);
    expect(view.container.querySelector(".rev-rail-time")).toBeNull();
  });

  it("a journal without a timestamp never breaks the walk — the label simply stays away", () => {
    const { engine, surface, view } = makeTsless();
    openRail();
    wheel(surface, -3);
    expect(engine.historyWalkDepth).toBe(1);
    expect(view.container.querySelector(".rev-rail-time")).toBeNull();
  });
});
