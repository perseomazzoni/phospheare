// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

// The reference editor's edit session lives in the shell (`Workspace`), so
// its guards (switching a reference file, switching the dock face, closing
// the dock, saving) are shell behaviour. These render `Workspace` directly
// and drive the shelf opens through a stubbed tree. A file of its own keeps
// `EditorRoute.test.tsx` out of the same worker: the writing surface
// accumulates a caret timer per mount, and dozens of mounts in one worker
// starve the polling `waitFor` relies on.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("./tree/DocumentTree", () => ({
  default: ({
    onOpenReference,
  }: {
    onOpenReference: (fileName: string) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onOpenReference("character--maren.md")}
      >
        tree.open-maren
      </button>
      <button
        type="button"
        onClick={() => onOpenReference("character--other.md")}
      >
        tree.open-other
      </button>
    </div>
  ),
}));

import { Workspace } from "./EditorRoute";
import { assistantTestStub } from "./assistant/assistantStub.fixture";
import type { Assistant } from "../ai";
import { EditorEngine } from "./views/engine";
import type { ResolvedPrefs } from "./writingPreferences";

// This file renders the whole writing surface for each test. Under the gate's
// parallel load a render or an async read can outlast the vitest default, and
// under `--coverage` the v8 instrumentation slows the surface by several
// times. A whole file's mounts in one worker starve the polling waits,
// so the budget sits above the waits' own deadlines.
vi.setConfig({ testTimeout: 120000 });

// jsdom does not measure or scroll, and the writing surface asks both for its
// caret bookkeeping, so these give the empty answers jsdom implies.
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

const projectRef = {
  providerId: "local" as const,
  key: "proj",
  name: "Proj",
  openedAt: "",
};

const settings: ResolvedPrefs = {
  proseSize: 19,
  typewriter: false,
  focus: "off",
  smoothCaret: false,
  autosave: false,
  autosaveDelay: 30,
  henosis: false,
  henosisAfter: 5,
  henosisFade: 10,
  henosisPause: 10,
};

beforeEach(() => {
  // The back-control nudge is one per session; a fresh session per test.
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the reference editor", () => {
  // A minimal in-memory provider in the shape the shell hands the dock. It
  // answers every read with the one reference the shelf opens, and records
  // what the shell writes, the one storage fact these tests assert.
  /**
   * `withAssistant` for the rows about the Ask face, which exists only where
   * an Assistant does.
   */
  function makeRef(
    files: string[] = [],
    withAssistant: boolean | Assistant = false,
  ) {
    const writeFile = vi.fn(async () => undefined);
    const provider = {
      listDir: async () =>
        files.map((name) => ({
          path: `/reference/${name}`,
          name,
          kind: "file" as const,
        })) as never[],
      readFile: async () => "# Maren\n",
      exists: async () => false,
      writeFile,
    };
    const engine = new EditorEngine();
    engine.open("Hello world");
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <Workspace
              engine={engine}
              projectRef={projectRef}
              activeFile="section--hello.md"
              // The bridge resolves these from the open file's node; the
              // fixture names them the same way, so the bar and the dock speak
              // the display name and key the conversation by the id.
              openTitle="hello"
              saveActiveFile={vi.fn().mockResolvedValue(true)}
              settings={settings}
              dock={
                {
                  provider,
                  activeNode: { id: "EL1", title: "hello" },
                  assistant:
                    withAssistant === true
                      ? assistantTestStub()
                      : withAssistant || null,
                } as never
              }
            />
          ),
        },
        { path: "/app", element: <div>The Library</div> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    return { engine, writeFile, router };
  }

  // Open the reference from the shelf and enter edit mode. A non-default draft
  // leaves it dirty; the default draft ('# Maren\n') is clean.
  //
  // Both waits sit on the thing being asserted (the textarea), not on a
  // button press: under the coverage run's load the editor's mount can
  // outlast a synchronous read right after the click.
  async function openMarenAndEdit(draft = "# Maren\n\nChanged.") {
    fireEvent.click(screen.getByText("tree.open-maren"));
    const edit = await screen.findByText("dock.edit", undefined, {
      timeout: 5000,
    });
    fireEvent.click(edit);
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: draft },
    });
  }

  it("saves the draft to the reference file, not the section", async () => {
    const { writeFile } = makeRef();
    await openMarenAndEdit("# Maren\n\nHer eyes are grey.");
    fireEvent.click(screen.getByText("dock.save"));
    await waitFor(
      () =>
        expect(writeFile).toHaveBeenCalledWith(
          projectRef,
          "/reference/character--maren.md",
          "# Maren\n\nHer eyes are grey.",
        ),
      { timeout: 5000 },
    );
  });

  it("asks before switching to another reference file with a dirty draft", async () => {
    makeRef();
    await openMarenAndEdit();
    fireEvent.click(screen.getByText("tree.open-other"));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "dock.discardEditTitle",
    );
    fireEvent.click(screen.getByText("dock.discardEditConfirm"));
    await waitFor(
      () =>
        expect(document.querySelector(".dock-meta")?.textContent).toContain(
          "other",
        ),
      { timeout: 5000 },
    );
  });

  it("switches reference files quietly when the draft is clean", async () => {
    makeRef();
    // Editing with no change made: nothing at stake, no question.
    await openMarenAndEdit("# Maren\n");
    fireEvent.click(screen.getByText("tree.open-other"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(
      () =>
        expect(document.querySelector(".dock-meta")?.textContent).toContain(
          "other",
        ),
      { timeout: 5000 },
    );
  });

  // The two faces share the dock but not their reading position: a
  // character open on Reference does not follow the writer to Notes, nor a
  // note back.
  it("keeps each face's selection to itself", async () => {
    makeRef();
    // A character open on Reference.
    fireEvent.click(screen.getByText("tree.open-maren"));
    await waitFor(
      () =>
        expect(document.querySelector(".dock-meta")?.textContent).toContain(
          "maren",
        ),
      { timeout: 5000 },
    );

    // A fold left open on Reference survives the tab switch. The panel
    // unmounts with the face, so the shell holds the set and the remount
    // renders it already open, with no replayed fold animation.
    fireEvent.click(screen.getByText("reference.group.world"));
    const worldCard = () =>
      screen
        .getByText("reference.group.world")
        .closest("section") as HTMLElement;
    expect(worldCard().getAttribute("data-open")).toBe("1");

    // Notes has no selection of its own: its own empty line, not Maren.
    fireEvent.click(screen.getByRole("button", { name: "dock.notes" }));
    await waitFor(
      () => expect(screen.getByText("dock.pickNote")).toBeTruthy(),
      { timeout: 5000 },
    );
    expect(document.querySelector(".dock-meta")).toBeNull();

    // Reference still holds its own selection, the character, and coming
    // back restores it rather than the note face's empty state.
    fireEvent.click(screen.getByRole("button", { name: "dock.reference" }));
    await waitFor(
      () =>
        expect(document.querySelector(".dock-meta")?.textContent).toContain(
          "maren",
        ),
      { timeout: 5000 },
    );
    expect(worldCard().getAttribute("data-open")).toBe("1");
  });

  // Opening a reference document never asks about a half-edited note: the
  // draft is not at stake.
  it("does not ask about a note's dirty draft when a reference document opens", async () => {
    makeRef(["notes--alpha.md"]);
    // A character on Reference first, so the dock is open and named.
    fireEvent.click(screen.getByText("tree.open-maren"));
    await waitFor(
      () =>
        expect(document.querySelector(".dock-meta")?.textContent).toContain(
          "maren",
        ),
      { timeout: 5000 },
    );

    // A note, opened on its own face and half-edited.
    fireEvent.click(screen.getByRole("button", { name: "dock.notes" }));
    fireEvent.click(
      await screen.findByText("alpha", undefined, { timeout: 5000 }),
    );
    fireEvent.click(
      await screen.findByText("dock.edit", undefined, { timeout: 5000 }),
    );
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "changed note" },
    });

    // Back on Reference, opening another section does not ask: the dirty
    // draft belongs to the other face.
    fireEvent.click(screen.getByRole("button", { name: "dock.reference" }));
    await waitFor(
      () =>
        expect(document.querySelector(".dock-meta")?.textContent).toContain(
          "maren",
        ),
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByText("tree.open-other"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(
      () =>
        expect(document.querySelector(".dock-meta")?.textContent).toContain(
          "other",
        ),
      { timeout: 5000 },
    );

    // The note's draft waits, untouched, for its own face.
    fireEvent.click(screen.getByRole("button", { name: "dock.notes" }));
    await waitFor(
      () =>
        expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
          "changed note",
        ),
      { timeout: 5000 },
    );
  });

  // The session is one, so entering the editor from the other face is an
  // exit that destroys the dirty draft. The face switch itself
  // is safe, but pressing Edit is not, and the shell owns every
  // exit that could destroy a draft, so it asks here too.
  it("asks before entering the editor over a dirty draft held by the other face", async () => {
    makeRef(["notes--alpha.md"]);
    // A note, opened on its own face and half-edited.
    fireEvent.click(screen.getByRole("button", { name: "dock.notes" }));
    fireEvent.click(
      await screen.findByText("alpha", undefined, { timeout: 5000 }),
    );
    fireEvent.click(
      await screen.findByText("dock.edit", undefined, { timeout: 5000 }),
    );
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "changed note" },
    });

    // Over to Reference, a safe face switch, and open a character.
    fireEvent.click(screen.getByRole("button", { name: "dock.reference" }));
    fireEvent.click(screen.getByText("tree.open-maren"));
    await waitFor(
      () =>
        expect(document.querySelector(".dock-meta")?.textContent).toContain(
          "maren",
        ),
      { timeout: 5000 },
    );

    // Pressing Edit replaces the note's session, so it asks first.
    fireEvent.click(
      await screen.findByText("dock.edit", undefined, { timeout: 5000 }),
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "dock.discardEditTitle",
    );
    fireEvent.click(screen.getByText("dock.discardEditConfirm"));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy(), {
      timeout: 5000,
    });
  });

  // The confirm path lands the writer on the file it starts editing: the
  // reader only shows an editor for the file its face holds, so a session
  // started on a file the face does not hold is invisible.
  it("lands on the new note when adding one confirms away another's draft", async () => {
    const { writeFile } = makeRef(["notes--alpha.md"]);
    // A dirty note, then a second note added on the same face.
    fireEvent.click(screen.getByRole("button", { name: "dock.notes" }));
    fireEvent.click(
      await screen.findByText("alpha", undefined, { timeout: 5000 }),
    );
    fireEvent.click(
      await screen.findByText("dock.edit", undefined, { timeout: 5000 }),
    );
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "changed note" },
    });
    fireEvent.click(screen.getByLabelText("reference.addNewNote"));
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "beta" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(
      () =>
        expect(writeFile).toHaveBeenCalledWith(
          projectRef,
          "/reference/notes--beta.md",
          "",
        ),
      { timeout: 5000 },
    );
    // The guard asks; confirming lands on B's editor, not A's read mode.
    fireEvent.click(
      await screen.findByText("dock.discardEditConfirm", undefined, {
        timeout: 5000,
      }),
    );
    await waitFor(
      () =>
        expect(document.querySelector(".dock-meta")?.textContent).toContain(
          "beta",
        ),
      { timeout: 5000 },
    );
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("asks before switching the face to Ask with a dirty draft", async () => {
    makeRef([], true);
    await openMarenAndEdit();
    // The assistant toggle routes through the same guarded face switch.
    fireEvent.click(screen.getByRole("button", { name: "toolbar.assistant" }));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "dock.discardEditTitle",
    );
    fireEvent.click(screen.getByText("dock.discardEditConfirm"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before the selection bubble's Ask leaves a dirty draft", async () => {
    makeRef([], true);
    await openMarenAndEdit();
    const prose = document.querySelector(".editor") as HTMLElement;
    const node = prose.firstChild?.firstChild ?? prose.firstChild;
    if (node === null) throw new Error("The prose must have a node to select");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 5);
    // jsdom measures nothing, and the workspace offers no bubble over a
    // zero-width selection. The size goes on the prototype because the
    // selection hands back a range of its own, not this one.
    const measure = vi
      .spyOn(Range.prototype, "getBoundingClientRect")
      .mockReturnValue({
        left: 100,
        top: 200,
        right: 220,
        bottom: 220,
        width: 120,
        height: 20,
      } as DOMRect);
    try {
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      fireEvent.click(await screen.findByText("bubble.ask"));
    } finally {
      measure.mockRestore();
    }
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "dock.discardEditTitle",
    );
  });

  it("reveals the waiting chat only once the face has switched", async () => {
    // A search waits: the bar's Ask button is marked, and pressing it would
    // bring the writer to the chat that holds it. With a dirty draft the switch
    // is a question first, and a cancel leaves the writer's chat alone.
    const assistant = assistantTestStub({
      pendingSearch: {
        askId: "ask-1",
        engine: { kind: "wikipedia" },
        kind: "first",
        rows: [{ rowId: "r0", query: "Porta Pia", bookWords: false }],
      },
    });
    makeRef([], assistant);
    await openMarenAndEdit();
    const control = () =>
      screen.getByRole("button", { name: "toolbar.assistantWaiting" });
    fireEvent.click(control());
    const prompt = screen.getByRole("alertdialog");
    fireEvent.click(within(prompt).getByText("confirm.cancel"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(vi.mocked(assistant.revealPendingSearch)).not.toHaveBeenCalled();
    fireEvent.click(control());
    fireEvent.click(screen.getByText("dock.discardEditConfirm"));
    expect(vi.mocked(assistant.revealPendingSearch)).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft when the dock closes — closing is folding, not losing", async () => {
    makeRef();
    await openMarenAndEdit();
    fireEvent.click(screen.getByLabelText("dock.close"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByText("tree.open-maren"));
    expect(
      ((await screen.findByRole("textbox")) as HTMLTextAreaElement).value,
    ).toBe("# Maren\n\nChanged.");
  });

  it("cancelling a dirty draft asks first, then drops the session", async () => {
    makeRef();
    await openMarenAndEdit();
    // The editor's Cancel with a dirty draft is a question, not a quiet exit.
    fireEvent.click(screen.getByText("confirm.cancel"));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "dock.discardEditTitle",
    );
    fireEvent.click(screen.getByText("dock.discardEditConfirm"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Back in read mode, with the draft gone and nothing written.
    await screen.findByText("dock.edit", undefined, { timeout: 5000 });
  });

  it("guards leaving the project with a dirty reference draft, naming the reference", async () => {
    const { router } = makeRef();
    await openMarenAndEdit();
    fireEvent.click(screen.getByText("titlebar.back"));
    const dialog = screen.getByRole("alertdialog");
    // The reference draft, not the section, is at stake: the dialog carries
    // the reference-specific body key. The `t` mock returns the key without
    // interpolating its title, so the name itself is not assertible.
    expect(dialog.textContent).toContain("leave.bodyReference");
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    // The reference file was written and the writer left for the Library. The
    // router's pathname and the destination's first paint can land in separate
    // frames under React 19's commit timing, so both are awaited.
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"), {
      timeout: 5000,
    });
    expect(
      await screen.findByText("The Library", undefined, { timeout: 5000 }),
    ).toBeTruthy();
  });
});
