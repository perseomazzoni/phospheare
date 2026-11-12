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
  waitFor,
} from "@testing-library/react";
import { EditorEngine } from "../../views/engine";
import { CommentsService, type CommentStore } from "../application/comments";
import { readComments, writeComments } from "../domain/codec";
import type { CommentsFile, Thread } from "../domain/model";
import { CommentsProvider } from "../host/comments";
import { createRef } from "react";
import Margin, {
  selectedPlacement,
  stepTo,
  type CommentDraft,
  type MarginWalk,
} from "./Margin";
import type { ReplyState } from "./ThreadCard";

// Pins the margin beside the prose: which form it takes, what each form
// offers, and that every action reaches the comments file through the
// service. jsdom lays nothing out, so the room right of the prose is whatever
// the test's boxes say: none by default, giving markers, or a wide surface
// for cards.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "count" in options
        ? `${key}:${String(options.count)}`
        : options && "name" in options
          ? `${key}:${String(options.name)}`
          : key,
    i18n: { language: "en" },
  }),
}));

// The theme sets the comments as notes only where a test asks it to.
const chrome = vi.hoisted(() => ({ notes: false }));
vi.mock("../../../theme/editor", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../theme/editor")>();
  // Held once, as the theme holds it: the margin measures again whenever it
  // changes.
  const cards = {
    comments: "cards",
    underBar: "slide",
    dockTabs: "track",
    panel: "float",
    spineGroups: "close",
    barCentre: "prose",
  } as const;
  const frame = { ...cards, comments: "notes" as const };
  return {
    ...real,
    useFrameOptions: () => (chrome.notes ? frame : cards),
  };
});

afterEach(() => {
  cleanup();
  chrome.notes = false;
});

// jsdom's Range measures nothing; the margin falls back to the paragraph's
// box when a range has no rects, which is the path these tests take.
if (!("getClientRects" in Range.prototype))
  Object.defineProperty(Range.prototype, "getClientRects", {
    value: () => [],
  });

const NODE = "EL1";
const TEXT = "The storm came.\n\nThe gate held.";
const PERSONAS = [{ id: "wren", name: "Wren", color: "#155393" }];
const AT = "2026-10-05T10:00:00.000Z";

function thread(
  id: string,
  over: Partial<Thread> & { by?: Thread["entries"][number]["author"] } = {},
): Thread {
  const { by = { kind: "writer" }, ...rest } = over;
  return {
    id,
    state: "open",
    anchor: { quote: "storm", prefix: "The ", suffix: " came." },
    entries: [{ id: `${id}-e`, author: by, at: AT, body: `Body ${id}` }],
    ...rest,
  };
}

function memory(initial?: CommentsFile | string) {
  const files = new Map<string, string>();
  if (initial !== undefined)
    files.set(
      NODE,
      typeof initial === "string" ? initial : writeComments(initial),
    );
  const store: CommentStore = {
    async read(nodeId) {
      const text = files.get(nodeId);
      return text === undefined ? { kind: "missing" } : { kind: "text", text };
    },
    async write(nodeId, text) {
      files.set(nodeId, text);
    },
  };
  return {
    store,
    stored(): CommentsFile {
      const read = readComments(files.get(NODE) ?? "");
      if (!read.ok) throw new Error("damaged");
      return read.file;
    },
  };
}

async function mount(
  initial: CommentsFile | string | undefined,
  options: {
    wide?: boolean;
    text?: string;
    draft?: CommentDraft | null;
    caret?: { para: number; offset: number };
    replyState?: (id: string) => ReplyState | undefined;
    covered?: number;
  } = {},
) {
  const walk = createRef<MarginWalk>();
  const files = memory(initial);
  let n = 0;
  const service = new CommentsService({
    store: files.store,
    now: () => AT,
    newId: () => `new${++n}`,
  });
  await service.load([NODE]);
  const engine = new EditorEngine();
  engine.open(options.text ?? TEXT);
  if (options.caret)
    engine.updateSelection({ anchor: options.caret, focus: options.caret });
  const surface = document.createElement("div");
  const editor = document.createElement("div");
  for (const line of (options.text ?? TEXT).split("\n\n")) {
    const p = document.createElement("p");
    p.textContent = line;
    editor.appendChild(p);
  }
  surface.appendChild(editor);
  document.body.appendChild(surface);
  if (options.wide) {
    const box = (right: number) => () =>
      ({
        top: 0,
        left: 0,
        right,
        bottom: 0,
        width: right,
        height: 0,
      }) as DOMRect;
    surface.getBoundingClientRect = box(1000);
    editor.getBoundingClientRect = box(400);
  }
  const onDraftDone = vi.fn();
  const onWriterEntry = vi.fn();
  const props = {
    engine,
    editor,
    surface,
    nodeId: NODE,
    personas: PERSONAS,
    onDraftDone,
    onWriterEntry,
    replyState: options.replyState,
    covered: options.covered,
    walk,
  };
  const view = render(
    <CommentsProvider service={service}>
      <Margin {...props} draft={options.draft ?? null} />
    </CommentsProvider>,
  );
  const redraw = (draft: CommentDraft | null) =>
    view.rerender(
      <CommentsProvider service={service}>
        <Margin {...props} draft={draft} />
      </CommentsProvider>,
    );
  return {
    service,
    files,
    engine,
    editor,
    onDraftDone,
    onWriterEntry,
    redraw,
    walk,
  };
}

const file = (...threads: Thread[]): CommentsFile => ({
  threads,
  dismissed: [],
});
const button = (name: string) => screen.getByRole("button", { name });
const card = (label = "comments.threadLabel") =>
  screen.getByRole("article", { name: label });

describe("a step through the comments", () => {
  const at = (para: number, start: number) => ({
    para,
    start,
    endPara: para,
    end: start + 3,
  });
  const order = [
    { id: "a", at: at(0, 4) },
    { id: "b", at: at(1, 0) },
    { id: "c", at: at(1, 9) },
  ];

  it("goes from the thread brought forward, round at either end", () => {
    const caret = { para: 0, offset: 0 };
    expect(stepTo(order, "b", caret, 1)).toBe("c");
    expect(stepTo(order, "c", caret, 1)).toBe("a");
    expect(stepTo(order, "b", caret, -1)).toBe("a");
    expect(stepTo(order, "a", caret, -1)).toBe("c");
  });

  it("goes from the caret when no thread is forward", () => {
    expect(stepTo(order, null, { para: 1, offset: 4 }, 1)).toBe("c");
    expect(stepTo(order, null, { para: 1, offset: 4 }, -1)).toBe("b");
    // Past the last, Next goes round; before the first, Previous does.
    expect(stepTo(order, null, { para: 2, offset: 0 }, 1)).toBe("a");
    expect(stepTo(order, null, { para: 0, offset: 0 }, -1)).toBe("c");
    // A thread gone from the order is no place to start from.
    expect(stepTo(order, "gone", { para: 0, offset: 5 }, 1)).toBe("b");
  });

  it("goes nowhere with nothing to go to", () => {
    expect(stepTo([], null, { para: 0, offset: 0 }, 1)).toBeNull();
  });
});

describe("the margin", () => {
  it("draws nothing without a service or a node", () => {
    const engine = new EditorEngine();
    const { container } = render(
      <Margin
        engine={engine}
        editor={null}
        surface={null}
        nodeId={NODE}
        personas={[]}
        draft={null}
        onDraftDone={() => undefined}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("marks each passage at the edge when there is no room for cards", async () => {
    await mount(
      file(
        thread("mine"),
        thread("ghost", {
          state: "proposed",
          by: { kind: "persona", id: "wren" },
          anchor: { quote: "gate", prefix: "The ", suffix: " held." },
        }),
        thread("hers", { by: { kind: "editor", name: "Mara" } }),
        thread("lost", { by: { kind: "persona", id: "gone" } }),
      ),
    );
    expect(document.querySelector(".cm-layer")?.getAttribute("data-mode")).toBe(
      "markers",
    );
    expect(button("comments.markerLabel:comments.you")).toBeTruthy();
    // An editor's marker names the editor, and one whose persona is gone
    // says someone wrote it, as their cards' bylines do.
    expect(
      button("comments.markerLabel:Mara").getAttribute("data-face"),
    ).toBeNull();
    expect(button("comments.markerLabel:comments.unknownAuthor")).toBeTruthy();
    const wren = button("comments.markerLabel:Wren");
    expect(wren.getAttribute("data-state")).toBe("proposed");
    // A persona's marker is its own face, in its colour; the writer's thread
    // keeps the plain dot.
    expect(wren.getAttribute("data-face")).toBe("1");
    const face = wren.querySelector(".cm-face") as HTMLElement;
    expect(face.textContent).toBe("W");
    expect(face.style.background).toBe("rgb(21, 83, 147)");
    expect(
      button("comments.markerLabel:comments.you").querySelector(".cm-face"),
    ).toBeNull();

    // A marker opens its thread in a panel, and Escape closes it.
    fireEvent.click(wren);
    const panel = screen.getByRole("dialog", { name: "comments.panelLabel" });
    expect(panel.textContent).toContain("Body ghost");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    // The chapter's own marker opens what belongs to the chapter.
    fireEvent.click(button("comments.chapterMarker:0"));
    expect(button("comments.onChapter")).toBeTruthy();
    fireEvent.click(button("comments.close"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a new comment in the panel on a phone-sized margin", async () => {
    const { onDraftDone, service } = await mount(file(), {
      draft: { placement: { para: 1, start: 4, endPara: 1, end: 8 } },
    });
    const panel = screen.getByRole("dialog", { name: "comments.panelLabel" });
    expect(panel.querySelector(".cm-quote")?.textContent).toBe("gate");
    fireEvent.change(panel.querySelector("textarea") as HTMLTextAreaElement, {
      target: { value: "Which gate?" },
    });
    fireEvent.click(button("comments.add"));
    await waitFor(() => expect(service.fileOf(NODE)?.threads).toHaveLength(1));
    expect(service.fileOf(NODE)?.threads[0].anchor?.quote).toBe("gate");
    expect(onDraftDone).toHaveBeenCalled();
  });

  // The open dock covers the surface's right, so the room ends where the
  // dock begins and no card is drawn under it.
  it("keeps to the room the open dock leaves, and draws dots when it leaves none", async () => {
    // jsdom's window is 1024 wide; a dock covering 500 of it begins at 524,
    // leaving 108px beside the prose's right edge at 400.
    await mount(file(thread("mine")), {
      wide: true,
      covered: 500,
      draft: { placement: { para: 1, start: 4, endPara: 1, end: 8 } },
    });
    expect(document.querySelector(".cm-layer")?.getAttribute("data-mode")).toBe(
      "markers",
    );
    // The panel stands beside the dock, not under it.
    const panel = screen.getByRole("dialog", { name: "comments.panelLabel" });
    expect(panel.style.right).toBe("516px");
  });

  it("lays cards beside the prose when there is room, the chapter's own first", async () => {
    await mount(
      file(
        thread("mine"),
        thread("chapter", { anchor: null }),
        thread("done", { state: "resolved" }),
      ),
      { wide: true },
    );
    const layer = document.querySelector(".cm-layer");
    expect(layer?.getAttribute("data-mode")).toBe("cards");
    const slots = [...document.querySelectorAll(".cm-slot")];
    expect(slots.map((slot) => slot.getAttribute("data-slot"))).toEqual([
      "chapter",
      "mine",
    ]);
    // The resolved fold away, and open on asking.
    expect(document.body.textContent).not.toContain("Body done");
    fireEvent.click(button("comments.resolvedCount:1"));
    expect(document.body.textContent).toContain("Body done");
  });

  it("sets the comments as notes in the theme's column, ruled beside the prose", async () => {
    chrome.notes = true;
    await mount(file(thread("mine")), { wide: true });
    const layer = document.querySelector(".cm-layer");
    expect(layer?.getAttribute("data-mode")).toBe("notes");
    // The rule stands the gap right of the prose's edge at 400; the notes
    // stand inside it, the inset in.
    const rule = document.querySelector<HTMLElement>(".cm-rule");
    expect(rule?.style.left).toBe("428px");
    const slot = document.querySelector<HTMLElement>(
      '.cm-slot[data-slot="mine"]',
    );
    expect(slot?.style.left).toBe("443px");
    expect(slot?.style.width).toBe("165px");
  });

  it("follows the prose when the shell restyles around it, as a drag does", async () => {
    chrome.notes = true;
    const { editor } = await mount(file(thread("mine")), { wide: true });
    const rule = () => document.querySelector<HTMLElement>(".cm-rule");
    expect(rule()?.style.left).toBe("428px");
    // The panel dragged 80 wider: the prose moves, its width kept, and the
    // only word of it is the shell's new style.
    editor.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 80,
        right: 480,
        bottom: 0,
        width: 400,
        height: 0,
      }) as DOMRect;
    document.body.style.setProperty("--panel-w", "340px");
    await waitFor(() => expect(rule()?.style.left).toBe("508px"));
  });

  it("gives the notes up for marks when the column has no room", async () => {
    chrome.notes = true;
    // 108px beside the prose, short of the column's 208.
    await mount(file(thread("mine")), { wide: true, covered: 500 });
    expect(document.querySelector(".cm-layer")?.getAttribute("data-mode")).toBe(
      "markers",
    );
    expect(document.querySelector(".cm-rule")).toBeNull();
  });

  it("starts a comment on a passage, and tells the editor the writer wrote", async () => {
    const { service, onDraftDone, onWriterEntry } = await mount(file(), {
      wide: true,
      draft: { placement: { para: 0, start: 3, endPara: 0, end: 10 } },
    });
    const draft = document.querySelector(".cm-draft") as HTMLElement;
    // The passage is shown as the writer chose it, edge spaces and all.
    expect(draft.querySelector(".cm-quote")?.textContent).toBe(" storm ");
    fireEvent.change(draft.querySelector("textarea") as HTMLTextAreaElement, {
      target: { value: "@Wren is this right?" },
    });
    fireEvent.click(button("comments.add"));
    await waitFor(() => expect(onWriterEntry).toHaveBeenCalled());
    const [opened] = service.fileOf(NODE)?.threads ?? [];
    // The anchor marks the word, not the spaces around it.
    expect(opened.anchor).toMatchObject({ quote: "storm", prefix: "The " });
    expect(onWriterEntry).toHaveBeenCalledWith(
      NODE,
      expect.objectContaining({ id: opened.id }),
      expect.objectContaining({ body: "@Wren is this right?" }),
    );
    expect(onDraftDone).toHaveBeenCalled();
  });

  // A passage can run across paragraphs, and is kept whole.
  it("starts a comment on a passage that runs across paragraphs", async () => {
    const { service } = await mount(file(), {
      wide: true,
      draft: { placement: { para: 0, start: 4, endPara: 1, end: 8 } },
    });
    const draft = document.querySelector(".cm-draft") as HTMLElement;
    expect(draft.querySelector(".cm-quote")?.textContent).toBe(
      "storm came.\nThe gate",
    );
    fireEvent.change(draft.querySelector("textarea") as HTMLTextAreaElement, {
      target: { value: "Too quick." },
    });
    fireEvent.click(button("comments.add"));
    await waitFor(() =>
      expect(service.fileOf(NODE)?.threads[0]?.anchor).toEqual({
        quote: "storm came.\nThe gate",
        prefix: "The ",
        suffix: " held.",
      }),
    );
  });

  it("reads a selection in reading order, whichever way it was dragged", () => {
    const engine = new EditorEngine();
    engine.open(TEXT);
    engine.updateSelection({
      anchor: { para: 1, offset: 8 },
      focus: { para: 0, offset: 4 },
    });
    const at = selectedPlacement(engine);
    expect(at).toEqual({ para: 0, start: 4, endPara: 1, end: 8 });
    engine.updateSelection({
      anchor: { para: 1, offset: 2 },
      focus: { para: 1, offset: 2 },
    });
    expect(selectedPlacement(engine)).toBeNull();
  });

  it("opens no comment on a passage of nothing but spaces", async () => {
    const { service, onDraftDone } = await mount(file(), {
      wide: true,
      text: "One.   Two.",
      draft: { placement: { para: 0, start: 4, endPara: 0, end: 7 } },
    });
    fireEvent.change(
      document.querySelector("textarea") as HTMLTextAreaElement,
      {
        target: { value: "Here?" },
      },
    );
    fireEvent.click(button("comments.add"));
    expect(onDraftDone).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.fileOf(NODE)?.threads).toEqual([]);
  });

  it("comments on the chapter as a whole", async () => {
    const { service } = await mount(file(), { wide: true });
    fireEvent.click(button("comments.onChapter"));
    // Cancelled once, then written.
    fireEvent.click(button("comments.cancel"));
    fireEvent.click(button("comments.onChapter"));
    fireEvent.change(
      document.querySelector("textarea") as HTMLTextAreaElement,
      {
        target: { value: "The middle sags." },
      },
    );
    fireEvent.click(button("comments.add"));
    await waitFor(() => expect(service.fileOf(NODE)?.threads).toHaveLength(1));
    expect(service.fileOf(NODE)?.threads[0].anchor).toBeNull();
  });

  it("keeps a ghost, then resolves and reopens it, through the file", async () => {
    const { files } = await mount(
      file(
        thread("ghost", {
          state: "proposed",
          by: { kind: "persona", id: "wren" },
        }),
      ),
      { wide: true },
    );
    fireEvent.click(card("comments.ghostLabel"));
    fireEvent.click(button("comments.keep"));
    await waitFor(() => expect(files.stored().threads[0].state).toBe("open"));
    fireEvent.click(button("comments.resolve"));
    await waitFor(() =>
      expect(files.stored().threads[0].state).toBe("resolved"),
    );
    fireEvent.click(button("comments.resolvedCount:1"));
    fireEvent.click(card());
    fireEvent.click(button("comments.reopen"));
    await waitFor(() => expect(files.stored().threads[0].state).toBe("open"));
  });

  it("replies in a thread, and the editor hears the writer's entry", async () => {
    const { files, onWriterEntry } = await mount(file(thread("mine")), {
      wide: true,
      replyState: () => ({ writing: "Wren" }),
    });
    expect(screen.getByRole("status").textContent).toBe(
      "comments.writing:Wren",
    );
    fireEvent.click(card());
    fireEvent.click(button("comments.reply"));
    fireEvent.change(
      document.querySelector("textarea") as HTMLTextAreaElement,
      {
        target: { value: "Agreed." },
      },
    );
    fireEvent.click(button("comments.send"));
    await waitFor(() =>
      expect(files.stored().threads[0].entries).toHaveLength(2),
    );
    expect(onWriterEntry).toHaveBeenCalledWith(
      NODE,
      expect.objectContaining({ id: "mine" }),
      expect.objectContaining({ body: "Agreed." }),
    );
  });

  it("dismisses a ghost from its panel, and the panel closes", async () => {
    const { files } = await mount(
      file(
        thread("ghost", {
          state: "proposed",
          by: { kind: "persona", id: "wren" },
        }),
      ),
    );
    fireEvent.click(button("comments.markerLabel:Wren"));
    fireEvent.click(button("comments.dismiss"));
    await waitFor(() => expect(files.stored().threads).toEqual([]));
    expect(files.stored().dismissed).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an orphan with its words, and re-attaches it to the selection", async () => {
    const { engine, files } = await mount(
      file(
        thread("lost", {
          anchor: { quote: "vanished words", prefix: "", suffix: "" },
        }),
      ),
      { wide: true },
    );
    const lost = card();
    expect(lost.getAttribute("data-orphan")).toBe("1");
    expect(lost.textContent).toContain("vanished words");
    fireEvent.click(lost);
    expect(
      screen.queryByRole("button", { name: "comments.reattach" }),
    ).toBeNull();
    act(() => {
      engine.updateSelection({
        anchor: { para: 1, offset: 4 },
        focus: { para: 1, offset: 8 },
      });
    });
    fireEvent.click(button("comments.reattach"));
    await waitFor(() =>
      expect(files.stored().threads[0].anchor?.quote).toBe("gate"),
    );
  });

  it("brings forward the comment whose passage holds the caret", async () => {
    await mount(file(thread("mine")), {
      wide: true,
      caret: { para: 0, offset: 6 },
    });
    expect(card().getAttribute("data-active")).toBe("1");
  });

  // Previous and Next go from one comment to the next without hunting for
  // them down the page.
  it("walks to the next and previous comment, opening each where the margin is dots", async () => {
    const scrolled: Element[] = [];
    const was = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const { walk } = await mount(
        file(
          thread("mine"),
          thread("ghost", {
            state: "proposed",
            by: { kind: "persona", id: "wren" },
            anchor: { quote: "gate", prefix: "The ", suffix: " held." },
          }),
        ),
        { caret: { para: 0, offset: 0 } },
      );
      const shown = () =>
        screen.getByRole("dialog", { name: "comments.panelLabel" }).textContent;
      // From the caret, before both: the first in reading order.
      act(() => walk.current?.step(1));
      expect(shown()).toContain("Body mine");
      expect(scrolled[scrolled.length - 1]?.textContent).toBe(
        "The storm came.",
      );
      act(() => walk.current?.step(1));
      expect(shown()).toContain("Body ghost");
      expect(scrolled[scrolled.length - 1]?.textContent).toBe("The gate held.");
      // Round at the end, and back again.
      act(() => walk.current?.step(1));
      expect(shown()).toContain("Body mine");
      act(() => walk.current?.step(-1));
      expect(shown()).toContain("Body ghost");
    } finally {
      Element.prototype.scrollIntoView = was;
    }
  });

  it("brings the walked-to card forward when there is room for cards", async () => {
    Element.prototype.scrollIntoView ??= () => undefined;
    const { walk } = await mount(
      file(
        thread("mine"),
        thread("other", {
          anchor: { quote: "gate", prefix: "The ", suffix: " held." },
        }),
      ),
      { wide: true, caret: { para: 0, offset: 0 } },
    );
    const active = () =>
      document
        .querySelector('.cm-card[data-active="1"]')
        ?.textContent?.includes("Body other");
    act(() => walk.current?.step(-1));
    expect(active()).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("writes a passage's new place with the file's next change", async () => {
    // The stored context says "The storm came."; the text reads "Then the
    // storm came.", so the anchor is found again, and noted.
    const { files } = await mount(
      file(
        thread("mine"),
        thread("ghost", {
          state: "proposed",
          by: { kind: "persona", id: "wren" },
          anchor: null,
        }),
      ),
      { wide: true, text: "Then the storm came.\n\nThe gate held." },
    );
    fireEvent.click(card("comments.ghostLabel"));
    fireEvent.click(button("comments.keep"));
    await waitFor(() =>
      expect(
        files.stored().threads.find((one) => one.id === "mine")?.anchor?.prefix,
      ).toBe("Then the "),
    );
  });

  it("says when the comments file cannot be read, and offers nothing to write", async () => {
    await mount("{ not a comments file", { wide: true });
    expect(screen.getByRole("alert").textContent).toBe("comments.damaged");
    expect(
      screen.queryByRole("button", { name: "comments.onChapter" }),
    ).toBeNull();
  });

  it("starts a chapter comment from the bubble when there is no passage", async () => {
    const { redraw, onDraftDone } = await mount(file(), { wide: true });
    redraw({ placement: null });
    expect(document.querySelectorAll(".cm-draft")).toHaveLength(1);
    fireEvent.click(button("comments.cancel"));
    expect(onDraftDone).toHaveBeenCalled();
  });
});

describe("the margin across a chapter switch and a refused write", () => {
  // Two chapters, each with its own comments file and its own text.
  async function twoChapters(
    files: Record<string, CommentsFile>,
    store?: Partial<CommentStore>,
  ) {
    const texts = new Map(
      Object.entries(files).map(([id, f]) => [id, writeComments(f)]),
    );
    const service = new CommentsService({
      store: {
        async read(nodeId) {
          const text = texts.get(nodeId);
          return text === undefined
            ? { kind: "missing" }
            : { kind: "text", text };
        },
        async write(nodeId, text) {
          texts.set(nodeId, text);
        },
        ...store,
      },
      now: () => AT,
      newId: () => "new1",
    });
    await service.load(Object.keys(files));
    const engine = new EditorEngine();
    const surface = document.createElement("div");
    const editor = document.createElement("div");
    surface.appendChild(editor);
    document.body.appendChild(surface);
    const box = (right: number) => () =>
      ({
        top: 0,
        left: 0,
        right,
        bottom: 0,
        width: right,
        height: 0,
      }) as DOMRect;
    surface.getBoundingClientRect = box(1000);
    editor.getBoundingClientRect = box(400);
    const show = (text: string) => {
      editor.replaceChildren(
        ...text.split("\n\n").map((line) => {
          const p = document.createElement("p");
          p.textContent = line;
          return p;
        }),
      );
    };
    const onDraftDone = vi.fn();
    const ui = (nodeId: string, draft: CommentDraft | null = null) => (
      <CommentsProvider service={service}>
        <Margin
          engine={engine}
          editor={editor}
          surface={surface}
          nodeId={nodeId}
          personas={PERSONAS}
          draft={draft}
          onDraftDone={onDraftDone}
        />
      </CommentsProvider>
    );
    return { service, engine, show, ui, onDraftDone, texts };
  }

  // The engine holds the new chapter's text before the margin hears of the
  // new node, as the project opens a file and then names it active.
  it("places the new chapter's threads against the new chapter's text", async () => {
    const { service, engine, show, ui } = await twoChapters({
      A: file(),
      B: file(
        thread("b", {
          anchor: { quote: "storm", prefix: "A ", suffix: " broke." },
        }),
      ),
    });
    engine.open("The storm came.");
    show("The storm came.");
    const moved = vi.spyOn(service, "noteMoved");
    const view = render(ui("A"));
    act(() => {
      engine.open("A storm broke.");
      show("A storm broke.");
    });
    view.rerender(ui("B"));
    expect(moved).not.toHaveBeenCalled();
    expect(document.querySelector('.cm-slot[data-slot="b"]')).not.toBeNull();
  });

  it("drops the chapter's half-written comment when the chapter changes", async () => {
    const { engine, show, ui } = await twoChapters({ A: file(), B: file() });
    engine.open("The storm came.");
    show("The storm came.");
    const view = render(ui("A"));
    fireEvent.click(button("comments.onChapter"));
    fireEvent.change(
      document.querySelector("textarea") as HTMLTextAreaElement,
      { target: { value: "About chapter A." } },
    );
    act(() => {
      engine.open("The gate held.");
      show("The gate held.");
    });
    view.rerender(ui("B"));
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("anchors a new comment on the passage chosen, though the text moved since", async () => {
    const { service, engine, show, ui } = await twoChapters({ A: file() });
    engine.open(TEXT);
    show(TEXT);
    render(ui("A", { placement: { para: 1, start: 4, endPara: 1, end: 8 } }));
    // The writer types ahead of the passage before sending the comment.
    act(() => {
      engine.updateSelection({
        anchor: { para: 1, offset: 0 },
        focus: { para: 1, offset: 0 },
      });
      engine.type("Then ");
    });
    fireEvent.change(
      document.querySelector("textarea") as HTMLTextAreaElement,
      { target: { value: "Which gate?" } },
    );
    fireEvent.click(button("comments.add"));
    await waitFor(() => expect(service.fileOf("A")?.threads).toHaveLength(1));
    expect(service.fileOf("A")?.threads[0].anchor).toMatchObject({
      quote: "gate",
      suffix: " held.",
    });
  });

  it("brings a card forward when the caret is clicked into its passage", async () => {
    const { engine, show, ui } = await twoChapters({ A: file(thread("mine")) });
    engine.open(TEXT);
    show(TEXT);
    render(ui("A"));
    await waitFor(() =>
      expect(
        document.querySelector('.cm-slot[data-slot="mine"]'),
      ).not.toBeNull(),
    );
    expect(card().getAttribute("data-active")).not.toBe("1");
    act(() =>
      engine.updateSelection({
        anchor: { para: 0, offset: 6 },
        focus: { para: 0, offset: 6 },
      }),
    );
    expect(card().getAttribute("data-active")).toBe("1");
  });

  it("keeps a comment the file refused, open and as typed", async () => {
    const { engine, show, ui, onDraftDone } = await twoChapters(
      { A: file() },
      {
        async write() {
          throw new Error("offline");
        },
      },
    );
    engine.open(TEXT);
    show(TEXT);
    const view = render(ui("A"));
    fireEvent.click(button("comments.onChapter"));
    const typed = () => document.querySelector("textarea")?.value;
    fireEvent.change(
      document.querySelector("textarea") as HTMLTextAreaElement,
      { target: { value: "The middle sags." } },
    );
    fireEvent.click(button("comments.add"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(typed()).toBe("The middle sags.");

    // A comment on a passage is kept the same way.
    fireEvent.click(button("comments.cancel"));
    view.rerender(
      ui("A", { placement: { para: 1, start: 4, endPara: 1, end: 8 } }),
    );
    fireEvent.change(
      document.querySelector(".cm-draft textarea") as HTMLTextAreaElement,
      { target: { value: "Which gate?" } },
    );
    fireEvent.click(button("comments.add"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onDraftDone).not.toHaveBeenCalled();
    expect(typed()).toBe("Which gate?");
  });

  it("keeps a reply the file refused, open and as typed", async () => {
    const { engine, show, ui } = await twoChapters(
      { A: file(thread("mine")) },
      {
        async write() {
          throw new Error("offline");
        },
      },
    );
    engine.open(TEXT);
    show(TEXT);
    render(ui("A"));
    fireEvent.click(card());
    fireEvent.click(button("comments.reply"));
    fireEvent.change(
      document.querySelector("textarea") as HTMLTextAreaElement,
      { target: { value: "Agreed." } },
    );
    fireEvent.click(button("comments.send"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("textarea")?.value).toBe("Agreed.");
  });
});

describe("what moves the margin", () => {
  // With Smooth caret on, the caret's spring is a transition that ends on
  // every keystroke. The margin listens for any transition that may have
  // moved the prose; the caret's own is not one of them.
  it("re-measures for a transition that moved the page, not for the caret's", async () => {
    await mount(file());
    const frame = vi.spyOn(window, "requestAnimationFrame");
    const caret = document.createElement("div");
    caret.className = "fake-cursor";
    document.body.appendChild(caret);
    caret.dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(frame).not.toHaveBeenCalled();
    const dock = document.createElement("aside");
    document.body.appendChild(dock);
    dock.dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(frame).toHaveBeenCalledTimes(1);
    frame.mockRestore();
    caret.remove();
    dock.remove();
  });
});
