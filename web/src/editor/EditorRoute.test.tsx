// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";

// `waitFor` defaults to a 1000ms deadline, and the waits in this file are the
// longest chains in the suite: a provider read, React's effects, then an
// engine transition. Under a full parallel run that deadline measures how
// busy the machine is. Only the deadline widens: every wait
// polls the engine's own state rather than sleeping, so no assertion weakens.
// Vitest's own `testTimeout` is 5000, so 3000 keeps a hang failing as a clean
// assertion rather than as a test timeout.
configure({ asyncUtilTimeout: 3000 });

// The key, plus any interpolated params as `name=value` pairs, so a test can
// assert which names reached a string, not only that it did.
//
// Hoisted alongside the mock and handed out as the same reference on every
// call, as real `react-i18next` keeps its `t` stable across renders. A mock
// that reallocates it turns an effect's `[..., t, ...]` dependency into one
// that never stops re-firing; `EditorRoute`'s `lastSave` effect then spins
// into an endless toast-posting render loop.
const { mockT, mockI18n } = vi.hoisted(() => ({
  mockT: (key: string, params?: Record<string, string>) =>
    params
      ? `${key}:${Object.entries(params)
          .map(([name, value]) => `${name}=${value}`)
          .join(",")}`
      : key,
  // The always-mounted revision rail formats its step stamp with the
  // writer's language, so the mock names one.
  mockI18n: { language: "en" },
}));
// The restore reads the queue through these three services. The lost
// set is empty unless a row fills it.
const restore = {
  lost: new Set<string>() as ReadonlySet<string>,
  stale: false,
  forgetLostAt: vi.fn<(place: unknown, path: string) => Promise<void>>(
    async () => {},
  ),
};
const restoreServices: EditorServices = {
  ...inertServices,
  useLostPaths: () => restore.lost,
  readStale: () => restore.stale,
  forgetLostAt: (place, path) => restore.forgetLostAt(place, path),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: mockI18n }),
}));
// `DocumentTree` reads `ProjectContext` and does heavy tree work, so it is
// stubbed; the editor itself renders for real. The stub keeps the props it
// was last rendered with, so a row can press what the shell hands the panel
// (the fold, the peek) without the panel's own tree.
const treeProps = vi.hoisted(() => ({
  current: {} as {
    onToggleCollapse?: () => void;
    onPeek?: (on: boolean) => void;
    peek?: boolean;
  },
}));
vi.mock("./tree/DocumentTree", () => ({
  default: (props: typeof treeProps.current) => {
    treeProps.current = props;
    return null;
  },
}));

import { editorBooted, EditorScreen, Workspace } from "./EditorRoute";
import { EditorServicesProvider, inertServices } from "./services/context";
import type { EditorServices } from "./services/port";
import type { EvidenceTargets } from "./assistant/evidenceOpener";
import { assistantTestStub } from "./assistant/assistantStub.fixture";
import type { Assistant } from "../ai";
import { AuthProvider } from "../auth/AuthContext";
import { EditorEngine } from "./views/engine";
import { DOCK_ID, MIN_DOCK_W, MAX_DOCK_W } from "./components/Dock";
import { MAX_PANEL_W, PANEL_W, RAIL_PANEL_W } from "./useNarrow";
import type { ResolvedPrefs } from "./writingPreferences";
import {
  ProjectProvider,
  useProjectActions,
  useProjectState,
} from "./ProjectContext";
import {
  DEFAULT_FILES,
  FakeProvider,
  PROPS,
  STRUCTURE,
  seedProps,
} from "./project.fixture";
import { filePath, STRUCTURE_FILE } from "../project/naming";
import { CommentsService } from "./comments/application/comments";
import { writeComments } from "./comments/domain/codec";
import { CommentsProvider } from "./comments/host/comments";

// jsdom does not implement client-rect measurement, and the editor's
// caret-blink bookkeeping calls it, so it gets the empty answer jsdom implies.
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
// Nor does it scroll. The palette keeps its highlighted row in view, which is
// a real behaviour with no meaning in a layout engine that has no viewport.
Element.prototype.scrollIntoView = () => {};

// The whole writing surface mounts for nearly every test in this file, and it
// accumulates a caret timer per mount. Under the gate's parallel load a render
// can outlast the vitest default, and under `--coverage` the v8
// instrumentation slows the surface several times over, as in
// `referenceEditor.test.tsx`. The save-failure row is the slowest: a failed
// write leaves the ember mark in place while the surface keeps settling.
vi.setConfig({ testTimeout: 60000 });

const projectRef = {
  providerId: "local" as const,
  key: "proj",
  name: "Proj",
  openedAt: "",
};

/**
 * The workspace behind a real data router, which is also what the leaving
 * guard needs: `useBlocker` only exists inside one, and throws outside.
 * The project settings are held in state the way the bridge holds them, so a
 * flip of autosave exercises the real wiring — including the
 * cancel-an-in-flight-save path.
 *
 * Autosave is a writing preference set in a panel this harness does
 * not render, so the button below stands in for it: the same prop changing
 * under `Workspace`, as the panel's write produces in production.
 */
function WorkspaceHost({
  engine,
  saveActiveFile,
  initial,
  onGoToDesk,
}: {
  engine: EditorEngine;
  saveActiveFile: () => Promise<boolean>;
  initial: ResolvedPrefs;
  onGoToDesk?: () => void;
}) {
  const [current, setCurrent] = useState(initial);
  return (
    <>
      <button
        data-testid="flip-autosave"
        onClick={() =>
          setCurrent((now) => ({ ...now, autosave: !now.autosave }))
        }
      />
      <Workspace
        engine={engine}
        projectRef={projectRef}
        activeFile="section--hello.md"
        // The bar speaks the node's display name, handed down as `openTitle`
        // and never derived from a file name; the leaving dialog needs it too.
        openTitle="hello"
        saveActiveFile={saveActiveFile}
        onGoToDesk={onGoToDesk}
        settings={current}
      />
    </>
  );
}

/** One route for the workspace, one for the Library the titlebar links to. */
function route(element: ReactNode) {
  return createMemoryRouter(
    [
      { path: "/", element },
      { path: "/app", element: <div>The Library</div> },
    ],
    { initialEntries: ["/"] },
  );
}

function make(
  over: {
    autosave?: boolean;
    autosaveDelay?: number;
    user?: {
      name: string | null;
      email: string;
      avatarUrl: string | null;
    } | null;
    onGoToDesk?: () => void;
    /** Under `StrictMode`, as `main.tsx` mounts the app: it runs updaters
     * twice, during render, which is where a side effect in one shows. */
    strict?: boolean;
    /** What the save answers; a failed write is `false`. */
    saveOk?: boolean;
  } = {},
) {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const saveActiveFile = vi.fn().mockResolvedValue(over.saveOk ?? true);
  const initial: ResolvedPrefs = {
    ...settings,
    autosave: over.autosave ?? settings.autosave,
    autosaveDelay: over.autosaveDelay ?? settings.autosaveDelay,
  };
  const router = route(
    <WorkspaceHost
      engine={engine}
      saveActiveFile={saveActiveFile}
      initial={initial}
      onGoToDesk={over.onGoToDesk}
    />,
  );
  const provider = (
    <EditorServicesProvider
      // The titlebar's face comes from the route's services, as it does in
      // the app.
      value={{ ...restoreServices, useFace: () => over.user ?? null }}
    >
      <RouterProvider router={router} />
    </EditorServicesProvider>
  );
  const view = render(
    over.strict ? <StrictMode>{provider}</StrictMode> : provider,
  );
  return { engine, saveActiveFile, view, router };
}

// The project's resolved settings as the bridge would hand them down — defaults
// for a project that has never been configured.
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

const title = () => screen.getByText("titlebar.back");

// jsdom's own `MutationObserver` never delivers a callback, and the fold
// behaviour leans on one to watch the bar's subpanels. A fake stands in so
// the integration (a `data-bar-panel` opening keeps the shell lifted) can be
// driven; the test hands it the mutation a real browser would report.
/**
 * jsdom's own, kept for the one row that needs a commit-time callback.
 */
const RealMO = globalThis.MutationObserver;
class FakeMO {
  static instances: FakeMO[] = [];
  callback: MutationCallback;
  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeMO.instances.push(this);
  }
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("MutationObserver", FakeMO);
  FakeMO.instances = [];
  // The back-control nudge is one per session; a fresh session per test, so the
  // suite never inherits a visit that already learned the back control.
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Unconditionally, not in a `finally`. A test that times out never reaches
  // its own cleanup, and a faked clock left installed breaks every later test
  // in this file.
  vi.useRealTimers();
});

// The comments can be put away altogether, with no margin drawn and no room
// kept for one, and walked from one to the next.
describe("the margin's comments, from the shell", () => {
  async function withComments(
    over: { hidden?: boolean; threads?: boolean } = {},
  ) {
    const files = new Map<string, string>();
    if (over.threads !== false)
      files.set(
        "EL1",
        writeComments({
          threads: [
            {
              id: "t1",
              state: "open",
              anchor: { quote: "world", prefix: "Hello ", suffix: "" },
              entries: [
                {
                  id: "e1",
                  author: { kind: "writer" },
                  at: "2026-10-05T10:00:00.000Z",
                  body: "Which world?",
                },
              ],
            },
          ],
          dismissed: [],
        }),
      );
    const service = new CommentsService({
      store: {
        read: async (id) => {
          const text = files.get(id);
          return text === undefined
            ? { kind: "missing" }
            : { kind: "text", text };
        },
        write: async (id, text) => void files.set(id, text),
      },
      now: () => "2026-10-05T10:00:00.000Z",
      newId: () => "new",
    });
    await service.load(["EL1"]);
    const engine = new EditorEngine();
    engine.open("Hello world");
    const onCommentsHidden = vi.fn();
    render(
      <CommentsProvider service={service}>
        <RouterProvider
          router={route(
            <Workspace
              engine={engine}
              projectRef={projectRef}
              activeFile="section--hello.md"
              saveActiveFile={vi.fn().mockResolvedValue(true)}
              settings={settings}
              dock={{
                provider: {
                  listDir: async () => [],
                  readFile: async () => "",
                } as never,
                activeNode: { id: "EL1", title: "hello" },
              }}
              commentsHidden={over.hidden ?? false}
              onCommentsHidden={onCommentsHidden}
            />,
          )}
        />
      </CommentsProvider>,
    );
    return { onCommentsHidden };
  }
  const shell = () => document.querySelector(".editor-shell") as HTMLElement;
  const openPalette = async () => {
    fireEvent.click(screen.getByRole("button", { name: "titlebar.palette" }));
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "palette.label" }),
      ).toBeTruthy(),
    );
  };

  it("draws the margin and asks for its room while a comment is shown", async () => {
    await withComments();
    await waitFor(() =>
      expect(document.querySelector(".cm-layer")).toBeTruthy(),
    );
    expect(shell().getAttribute("data-margin")).toBe("1");
    expect(
      screen
        .getByRole("button", { name: "toolbar.comments" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "toolbar.nextComment" }),
    ).toBeTruthy();
  });

  it("puts the comments away: no margin, no room, no walk, and remembers it", async () => {
    const { onCommentsHidden } = await withComments();
    await waitFor(() =>
      expect(document.querySelector(".cm-layer")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "toolbar.comments" }));
    expect(document.querySelector(".cm-layer")).toBeNull();
    expect(shell().getAttribute("data-margin")).toBe("0");
    expect(
      screen.queryByRole("button", { name: "toolbar.nextComment" }),
    ).toBeNull();
    expect(onCommentsHidden).toHaveBeenCalledWith(true);
  });

  it("opens put away when the project left them so, and the palette brings them back", async () => {
    const { onCommentsHidden } = await withComments({ hidden: true });
    expect(document.querySelector(".cm-layer")).toBeNull();
    expect(shell().getAttribute("data-margin")).toBe("0");
    await openPalette();
    expect(screen.queryByText("toolbar.nextComment")).toBeNull();
    fireEvent.click(screen.getByText("toolbar.showComments"));
    await waitFor(() =>
      expect(document.querySelector(".cm-layer")).toBeTruthy(),
    );
    expect(onCommentsHidden).toHaveBeenCalledWith(false);
  });

  it("offers the walk in the palette only with a comment on a passage", async () => {
    await withComments();
    await waitFor(() => expect(shell().getAttribute("data-margin")).toBe("1"));
    await openPalette();
    expect(screen.getByText("toolbar.hideComments")).toBeTruthy();
    expect(screen.getByText("toolbar.previousComment")).toBeTruthy();
    expect(screen.getByText("toolbar.nextComment")).toBeTruthy();
    cleanup();
    await withComments({ threads: false });
    expect(shell().getAttribute("data-margin")).toBe("0");
    expect(
      screen.queryByRole("button", { name: "toolbar.nextComment" }),
    ).toBeNull();
    // The toggle itself stays: there is a margin to put away or bring back.
    expect(
      screen.getByRole("button", { name: "toolbar.comments" }),
    ).toBeTruthy();
  });
});

describe("workspace wiring", () => {
  it("renders the editor surface with the open file title", () => {
    make();
    expect(title()).toBeTruthy();
    // The titlebar carries the node's display name: the bridge resolves it to
    // `openTitle` rather than letting the file name speak for the writer.
    expect(screen.getByText("hello")).toBeTruthy();
  });

  // The crumb names the open node as the structure panel does: a Section's
  // page glyph and number, a Part's number alone.
  it("marks the open node in the crumb as the structure panel does", () => {
    const crumb = (openMark: {
      kind: "part" | "section";
      number: number | null;
    }) => {
      const engine = new EditorEngine();
      engine.open("Hello world");
      render(
        <RouterProvider
          router={route(
            <Workspace
              engine={engine}
              projectRef={projectRef}
              activeFile="section--hello.md"
              openTitle="LEV"
              openMark={openMark}
              saveActiveFile={vi.fn().mockResolvedValue(true)}
              settings={settings}
            />,
          )}
        />,
      );
      return document.querySelector(".titlebar-file") as HTMLElement;
    };
    const section = crumb({ kind: "section", number: 1 });
    expect(section.querySelector(".dt-file-icon")).toBeTruthy();
    expect(section.querySelector(".titlebar-idx")?.textContent).toBe("01");
    expect(section.querySelector(".titlebar-name")?.textContent).toBe("LEV");
    cleanup();
    const part = crumb({ kind: "part", number: 2 });
    expect(part.querySelector(".dt-file-icon")).toBeNull();
    expect(part.querySelector(".titlebar-idx")?.textContent).toBe("02");
    cleanup();
    // A Part inside another carries no number, in the panel or here.
    const nested = crumb({ kind: "part", number: null });
    expect(nested.querySelector(".titlebar-idx")).toBeNull();
  });

  it("registers the evidence openers with the AI composition root", async () => {
    const engine = new EditorEngine();
    engine.open("Hello world");
    const targets: EvidenceTargets[] = [];
    const router = route(
      <Workspace
        engine={engine}
        projectRef={projectRef}
        activeFile="section--hello.md"
        saveActiveFile={vi.fn().mockResolvedValue(true)}
        settings={settings}
        registerEvidence={(registered) => targets.push(registered)}
      />,
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(targets).toHaveLength(1));
    // The openers themselves: a manuscript arrival and a reference document.
    // The arrival paints, which a registered opener alone does not prove,
    // and paints as evidence, not as a search hit.
    act(() => targets[0]?.arrive("section--hello.md", "Hello", 0));
    await waitFor(() =>
      expect(document.querySelector("mark.hl-evidence")?.textContent).toBe(
        "Hello",
      ),
    );
    expect(document.querySelector("mark.hl-search-current")).toBeNull();
    // The writer's first edit puts the assistant's mark down.
    act(() => engine.type("x"));
    await waitFor(() =>
      expect(document.querySelector("mark.hl-evidence")).toBeNull(),
    );
    targets[0]?.openDocument("character--maren.md");
    expect(targets).toHaveLength(1);
  });

  // The ordinal reaches the painter, so a repeated quote is marked at the
  // place the anchor cited, and only there.
  it("paints an evidence arrival at the occurrence it names", async () => {
    const engine = new EditorEngine();
    engine.open("No. She ran to the door. No.");
    const targets: EvidenceTargets[] = [];
    const router = route(
      <Workspace
        engine={engine}
        projectRef={projectRef}
        activeFile="section--hello.md"
        saveActiveFile={vi.fn().mockResolvedValue(true)}
        settings={settings}
        registerEvidence={(registered) => targets.push(registered)}
      />,
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(targets).toHaveLength(1));
    act(() => targets[0]?.arrive("section--hello.md", "No.", 1));
    await waitFor(() =>
      expect(document.querySelectorAll("mark.hl-evidence")).toHaveLength(1),
    );
    // The second "No.": the text the painter left unmarked before it is the
    // sentence it follows. The first "No." has nothing before it.
    const mark = document.querySelector("mark.hl-evidence");
    expect(mark?.previousSibling?.textContent).toBe(
      "No. She ran to the door. ",
    );
  });

  it("wears the project's prose size, and restyles the moment it changes", () => {
    const engine = new EditorEngine();
    engine.open("Hello world");
    const saveActiveFile = vi.fn().mockResolvedValue(true);
    const surface = () =>
      document.querySelector(".editor-surface") as HTMLElement;
    const at = (proseSize: number) => (
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            saveActiveFile={saveActiveFile}
            settings={{
              proseSize: proseSize as ResolvedPrefs["proseSize"],
              typewriter: false,
              focus: "off",
              smoothCaret: false,
              autosave: false,
              autosaveDelay: 30,
              henosis: false,
              henosisAfter: 5,
              henosisFade: 10,
              henosisPause: 10,
            }}
          />,
        )}
      />
    );
    const view = render(at(17));
    expect(surface().style.getPropertyValue("--prose-size")).toBe("17px");

    // A live preference change is a new props object from the provider, and
    // the surface follows it in the same render, because the picker moved.
    view.rerender(at(21));
    expect(surface().style.getPropertyValue("--prose-size")).toBe("21px");
    cleanup();
  });

  // The field is mounted at all times and clipped while the segment is a
  // circle: that is what makes opening it a morph rather than a swap, and it
  // is why this asserts on the panel's state rather than on the input existing.
  it("Ctrl+F opens find and Escape closes it", () => {
    make();
    const panel = () => document.querySelectorAll(".ed-drop")[1];

    expect(panel().getAttribute("data-open")).toBe("0");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(panel().getAttribute("data-open")).toBe("1");
    expect(screen.getByPlaceholderText("search.placeholder")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel().getAttribute("data-open")).toBe("0");
  });

  it("the open shortcut is gone: Ctrl+O changes nothing, Ctrl+S saves the active file", () => {
    const { saveActiveFile } = make();
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(saveActiveFile).toHaveBeenCalledTimes(1);
  });

  it("autosaves after a quiet editing burst, on a project that has it on", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { engine, saveActiveFile } = make({ autosave: true });
      act(() => engine.type("x"));
      expect(saveActiveFile).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(settings.autosaveDelay * 1000);
      });
      expect(saveActiveFile).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves on beforeunload when the buffer is dirty", () => {
    const { engine, saveActiveFile } = make();
    act(() => engine.type("x"));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(saveActiveFile).toHaveBeenCalled();
  });
});

describe("panel independence (feature 9)", () => {
  const shell = () => document.querySelector(".editor-shell");

  // The structure panel and the dock expand and collapse independently, so
  // opening the dock never buries the panel's tree under the bar the dock
  // pushes over it.
  it("a wide window starts with the structure panel expanded", () => {
    make();
    expect(shell()?.getAttribute("data-narrow")).toBe("0");
    expect(shell()?.getAttribute("data-rail")).toBe("0");
  });

  it("opening the dock does not fold the structure panel", () => {
    make();
    // Opened by the camera, a button every workspace has. The spark exists
    // only with an Assistant, and this row is about the dock, not
    // about asking.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "toolbar.snapshot" }));
    });
    expect(shell()?.getAttribute("data-dock")).toBe("1");
    expect(shell()?.getAttribute("data-rail")).toBe("0");
  });

  // A window that starts narrow opens the panel folded, the compact view
  // being that window's natural first sight, but the fold is the writer's own
  // state, seeded once from the width and not re-imposed by it.
  it("a window that starts narrow opens with the structure panel folded", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      make();
      expect(shell()?.getAttribute("data-narrow")).toBe("1");
      expect(shell()?.getAttribute("data-rail")).toBe("1");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("fold engagement — the bar over the panels", () => {
  const shell = () => document.querySelector(".editor-shell");

  it("pins the bar where it stood while engaged, and lets it re-centre after", () => {
    // At rest the bar centres on the prose; engaged, it holds still, so a
    // fold opening grows it rightwards instead of sliding the controls left
    // of the fold out from under the pointer. jsdom lays nothing out,
    // so the stack's and the row's boxes are handed in.
    vi.useFakeTimers();
    try {
      make();
      const stack = document.querySelector(".bar-stack") as HTMLElement;
      const row = document.querySelector(".bar-row") as HTMLElement;
      const box = (left: number) => () =>
        ({ left, right: left, top: 0, bottom: 0 }) as DOMRect;
      stack.getBoundingClientRect = box(348);
      row.getBoundingClientRect = box(0);
      const pin = () => row.style.getPropertyValue("--bar-pin");
      expect(pin()).toBe("");
      const bar = document.querySelector(".ui-bar") as HTMLElement;
      fireEvent.pointerEnter(bar);
      expect(pin()).toBe("348px");
      // Pinned, the bar may use the row's margin, which `editor.css` keys on
      // this attribute.
      expect(stack.getAttribute("data-pinned")).toBe("1");
      // Wherever the stack's box goes while engaged, the pin does not chase
      // it: chasing is the movement the pin exists to stop.
      stack.getBoundingClientRect = box(300);
      fireEvent.pointerOver(bar);
      expect(pin()).toBe("348px");
      // Two beats on the way out: the folds collapse first, as the
      // engagement ends at the 200ms intent and the pin holds, and only after
      // the stack's own ease does the bar re-centre.
      // The wait is a fold's own collapse, read from its computed style.
      (
        stack.querySelector(".ed-fold") as HTMLElement
      ).style.transitionDuration = "0.22s";
      fireEvent.pointerLeave(bar);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(shell()?.getAttribute("data-fold-engaged")).toBe("0");
      expect(pin()).toBe("348px");
      act(() => {
        vi.advanceTimersByTime(219);
      });
      expect(pin()).toBe("348px");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(pin()).toBe("");
      expect(stack.getAttribute("data-pinned")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes the pin the instant the pointer enters, before the engagement lands", () => {
    // A fold under an entering pointer widens on its latch, and the
    // engagement reaches the shell an effect later, when the centring may
    // already have pushed the bar left. So the stack pins on its own pointer
    // entry, and the engagement never re-measures a held pin.
    make();
    const stack = document.querySelector(".bar-stack") as HTMLElement;
    const row = document.querySelector(".bar-row") as HTMLElement;
    let left = 348;
    stack.getBoundingClientRect = () => ({ left }) as DOMRect;
    row.getBoundingClientRect = () => ({ left: 0 }) as DOMRect;
    act(() => {
      fireEvent.pointerEnter(stack);
    });
    expect(row.style.getPropertyValue("--bar-pin")).toBe("348px");
    left = 330;
    fireEvent.pointerEnter(document.querySelector(".ui-bar") as HTMLElement);
    expect(row.style.getPropertyValue("--bar-pin")).toBe("348px");
  });

  it("keeps the pin when the writer comes back before the bar has re-centred", () => {
    vi.useFakeTimers();
    try {
      make();
      const stack = document.querySelector(".bar-stack") as HTMLElement;
      const row = document.querySelector(".bar-row") as HTMLElement;
      stack.getBoundingClientRect = () => ({ left: 348 }) as DOMRect;
      row.getBoundingClientRect = () => ({ left: 0 }) as DOMRect;
      // The wait is a fold's own collapse, read from its computed style.
      (
        stack.querySelector(".ed-fold") as HTMLElement
      ).style.transitionDuration = "0.22s";
      const pin = () => row.style.getPropertyValue("--bar-pin");
      const bar = document.querySelector(".ui-bar") as HTMLElement;
      fireEvent.pointerEnter(bar);
      fireEvent.pointerLeave(bar);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      // Back inside the release window: the pending release is cancelled, so
      // the bar does not ease home under the returning pointer.
      fireEvent.pointerEnter(bar);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(pin()).toBe("348px");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lifts the shell the moment the bar is engaged, and drops it when the engagement ends", () => {
    vi.useFakeTimers();
    try {
      make();
      expect(shell()?.getAttribute("data-fold-engaged")).toBe("0");
      // The lift follows the bar's engagement, not a fold opening: the bar
      // lies over the panels the moment a writer reaches for it.
      const bar = document.querySelector(".ui-bar") as HTMLElement;
      fireEvent.pointerEnter(bar);
      expect(shell()?.getAttribute("data-fold-engaged")).toBe("1");
      fireEvent.pointerLeave(bar);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(shell()?.getAttribute("data-fold-engaged")).toBe("0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the bar lifted while a subpanel is open, even with the pointer away", () => {
    make();
    const shell = () => document.querySelector(".editor-shell");
    const fireMutations = () =>
      FakeMO.instances.forEach((mo) =>
        mo.callback([], {} as unknown as MutationObserver),
      );
    const chars = () =>
      screen.getByRole("button", { name: "toolbar.specialChars" });
    expect(shell()?.getAttribute("data-fold-engaged")).toBe("0");
    // The pointer never touches the bar; the panel alone holds it up. The
    // click commits `data-open` when the first act settles, so the observer
    // is fired in a second one; the DOM before the flush is the state before
    // the panel existed.
    act(() => {
      fireEvent.click(chars());
    });
    act(() => {
      fireMutations();
    });
    expect(shell()?.getAttribute("data-fold-engaged")).toBe("1");
    act(() => {
      fireEvent.click(chars());
    });
    act(() => {
      fireMutations();
    });
    expect(shell()?.getAttribute("data-fold-engaged")).toBe("0");
  });

  it("opens special characters without updating find mid-render", () => {
    // Opening the characters panel closes find, outside the `setCharsOpen`
    // updater: React runs updaters while the shell renders, so a close inside
    // one fires `FindPanel`'s own setState during the shell's render.
    //
    // Under `StrictMode`, as the app runs: it replays updaters during render,
    // so a side effect lands inside one every time. Outside it, React mostly
    // runs an updater eagerly at dispatch, and the side effect hides.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      make({ strict: true });
      act(() => {
        fireEvent.click(
          screen.getByRole("button", { name: "toolbar.specialChars" }),
        );
      });
      const midRender = error.mock.calls.filter((call) =>
        String(call[0]).includes("while rendering a different component"),
      );
      expect(midRender).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });
});

describe("autosave", () => {
  it("never schedules on a project that has it off", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { engine, saveActiveFile } = make();
      act(() => engine.type("x"));
      act(() => {
        vi.advanceTimersByTime(settings.autosaveDelay * 1000);
      });
      expect(saveActiveFile).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours the project's delay", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { engine, saveActiveFile } = make({
        autosave: true,
        autosaveDelay: 5,
      });
      act(() => engine.type("x"));
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(saveActiveFile).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(saveActiveFile).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("flipping the switch off cancels a save already in flight", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { engine, saveActiveFile } = make({ autosave: true });
      act(() => engine.type("x"));
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(saveActiveFile).not.toHaveBeenCalled();
      // The master switch outranks a debounce that is already waiting, or a
      // save the writer switched autosave off to avoid would fire anyway.
      fireEvent.click(screen.getByTestId("flip-autosave"));
      act(() => {
        vi.advanceTimersByTime(settings.autosaveDelay * 1000);
      });
      expect(saveActiveFile).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // A debounce belongs to the file it was scheduled for. Left running across
  // a switch, it fires a save after the buffer has become another file, or
  // an emptied one.
  function switchingHost(engine: EditorEngine, save: () => Promise<boolean>) {
    return function Host() {
      const [file, setFile] = useState("section--hello.md");
      return (
        <>
          <button
            data-testid="open-other"
            onClick={() => {
              engine.open("Another file");
              setFile("section--other.md");
            }}
          />
          <button
            data-testid="retarget"
            onClick={() => setFile("section--renamed.md")}
          />
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile={file}
            openTitle="hello"
            saveActiveFile={save}
            settings={{ ...settings, autosave: true }}
          />
        </>
      );
    };
  }

  it("a file switch cancels the debounce of the file left behind", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const engine = new EditorEngine();
      engine.open("Hello world");
      const saveActiveFile = vi.fn().mockResolvedValue(true);
      const Host = switchingHost(engine, saveActiveFile);
      render(<RouterProvider router={route(<Host />)} />);
      act(() => engine.type("x"));
      fireEvent.click(screen.getByTestId("open-other"));
      act(() => {
        vi.advanceTimersByTime(settings.autosaveDelay * 1000);
      });
      expect(saveActiveFile).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a rename of the open file keeps its unsaved text on the debounce", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const engine = new EditorEngine();
      engine.open("Hello world");
      const saveActiveFile = vi.fn().mockResolvedValue(true);
      const Host = switchingHost(engine, saveActiveFile);
      render(<RouterProvider router={route(<Host />)} />);
      act(() => engine.type("x"));
      fireEvent.click(screen.getByTestId("retarget"));
      act(() => {
        vi.advanceTimersByTime(settings.autosaveDelay * 1000);
      });
      expect(saveActiveFile).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turning it on schedules the next edit", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { engine, saveActiveFile } = make();
      fireEvent.click(screen.getByTestId("flip-autosave"));
      act(() => engine.type("x"));
      act(() => {
        vi.advanceTimersByTime(settings.autosaveDelay * 1000);
      });
      expect(saveActiveFile).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── The leaving guard ────────────────────────────────────────────────────────
//
// The same three-answer dialog that guards a section switch guards the way
// out of the project: routing away with a dirty buffer is blocked until the
// writer answers. Autosave on or off does not change which boundary this is.

describe("the leaving guard", () => {
  it("leaves quietly when the buffer is clean", () => {
    const { router } = make();
    fireEvent.click(screen.getByText("titlebar.back"));
    expect(router.state.location.pathname).toBe("/app");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before leaving with a dirty buffer, and Stay stays", () => {
    const { engine, router } = make();
    act(() => engine.type("x"));
    fireEvent.click(screen.getByText("titlebar.back"));
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "leave.stay" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(router.state.location.pathname).toBe("/");
    expect(engine.hasChanges).toBe(true);
  });

  it("Skip abandons the buffer on purpose", () => {
    const { engine, saveActiveFile, router } = make();
    act(() => engine.type("x"));
    fireEvent.click(screen.getByText("titlebar.back"));
    fireEvent.click(screen.getByRole("button", { name: "leave.skip" }));
    expect(router.state.location.pathname).toBe("/app");
    expect(saveActiveFile).not.toHaveBeenCalled();
    expect(engine.hasChanges).toBe(true);
  });

  it("Save writes the buffer before leaving", async () => {
    const { engine, saveActiveFile, router } = make();
    act(() => engine.type("x"));
    fireEvent.click(screen.getByText("titlebar.back"));
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(saveActiveFile).toHaveBeenCalled();
  });

  it("a save that failed does not look like a departure", async () => {
    const { engine, saveActiveFile, router } = make();
    saveActiveFile.mockResolvedValueOnce(false);
    act(() => engine.type("x"));
    fireEvent.click(screen.getByText("titlebar.back"));
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/");
    expect(engine.hasChanges).toBe(true);
  });
});

// ── The titlebar's right cluster ─────────────────────────────────────────────
//
// The palette has a visible way in besides Ctrl/Cmd+K, which nothing
// announces, and the shortcut sheet that would teach it is reached by `?`
// alone. These pin the route, not the styling: the button exists at rest, it
// opens the palette, and it carries its own shortcut on its face so using it
// teaches the faster way.

describe("the titlebar's right cluster", () => {
  it("offers the palette a pointer route, with its shortcut on the face", () => {
    make();
    const commands = screen.getByRole("button", { name: "titlebar.palette" });
    // The chip is the teaching half: a writer who presses this three times
    // stops needing to.
    expect(commands.textContent).toContain("Ctrl K");
  });

  it("opens the palette when pressed", async () => {
    make();
    expect(screen.queryByRole("dialog", { name: "palette.label" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "titlebar.palette" }));
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "palette.label" }),
      ).toBeTruthy(),
    );
  });

  it("draws no account face when nobody is signed in", () => {
    // The demo route reaches the editor with no account at all, and a
    // placeholder there would be a claim about a session that does not exist.
    make();
    expect(document.querySelector(".ed-account")).toBeNull();
  });

  // The account face is a fact, not a control: it wears the writer's initial
  // and opens nothing. The second row pins the absence, so a menu cannot grow
  // back unnoticed.
  it("wears the writer's initial", () => {
    make({
      user: { name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
    });
    const account = screen.getByRole("img", {
      name: "library.accountFor:email=ada@example.com",
    });
    expect(account.textContent).toContain("A");
  });

  it("is a fact, not a control — the face is not pressable and opens nothing", async () => {
    make({
      user: { name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
    });
    // Not a button, and not focusable: a control that looks pressable and
    // answers no press is worse than no control.
    expect(
      screen.queryByRole("button", {
        name: "library.accountFor:email=ada@example.com",
      }),
    ).toBeNull();
    const account = document.querySelector(".ed-account");
    expect(account?.tagName).toBe("SPAN");
    expect(account?.getAttribute("tabindex")).toBeNull();
    expect(account?.getAttribute("aria-haspopup")).toBeNull();

    // Pressing it anyway reaches nothing. `findByRole` would wait for a menu
    // that is never coming, so the row asserts the settled absence instead.
    fireEvent.click(account as Element);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});

// ── The way back to the library ──────────────────────────────────────────────
//
// The back control is the one affordance that always answers "how do I leave".
// It is a real route out, so it earns the same leaving guard as every other
// exit, and it carries the one-time teaching nudge.

describe("the crumb's project name", () => {
  const crumb = () =>
    screen.getByRole("button", { name: projectRef.name }) as HTMLButtonElement;

  it("is a control, and goes to the Desk", () => {
    // The crumb reads as a path (library / project / file), and every
    // segment goes somewhere. The project's name goes to the Desk, the view
    // of the whole of it.
    const onGoToDesk = vi.fn();
    make({ onGoToDesk });
    expect(crumb().className).toContain("titlebar-project");
    expect(crumb().getAttribute("title")).toBe("titlebar.toDesk");
    fireEvent.click(crumb());
    expect(onGoToDesk).toHaveBeenCalledTimes(1);
  });

  it("still reads as the path when nothing is wired to it", () => {
    // `Workspace` is rendered bare by these harnesses, with no provider to
    // ask for `closeFile`. The crumb is the writer's sense of place before it
    // is a control, so it draws either way.
    make();
    expect(crumb().textContent).toBe(projectRef.name);
    fireEvent.click(crumb());
  });
});

describe("the way back to the library", () => {
  const back = () =>
    screen.getByRole("link", { name: "titlebar.backToLibrary" });

  it("renders first in the titlebar, named for what it does", () => {
    make();
    expect(back().getAttribute("aria-label")).toBe("titlebar.backToLibrary");
  });

  it("leaves quietly through the back control when the buffer is clean", () => {
    const { router } = make();
    fireEvent.click(back());
    expect(router.state.location.pathname).toBe("/app");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before leaving through the back control with a dirty buffer", () => {
    const { engine, router } = make();
    act(() => engine.type("x"));
    fireEvent.click(back());
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("teaches the back control once per session, then stays quiet", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      make();
      // The caption is mounted and the session now remembers.
      const caption = () => document.querySelector(".titlebar-return-nudge");
      expect(caption()).toBeTruthy();
      expect(sessionStorage.getItem("backNudge")).toBe("1");
      // A macrotask in it fades in; after its stay it fades out again.
      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(caption()?.getAttribute("data-on")).toBe("1");
      act(() => {
        vi.advanceTimersByTime(3600);
      });
      expect(caption()?.getAttribute("data-on")).toBe("0");
      cleanup();
      // A second visit in the same session: no caption, no glow.
      make();
      expect(caption()).toBeNull();
      expect(back().getAttribute("data-nudge")).toBe("0");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── The save state ───────────────────────────────────────────────────────────
//
// Six states in one box. The transient ones are held here rather than derived,
// because `engine.hasChanges` goes false the instant the write lands and there
// would be nothing left to confirm with.

const saveChip = () => document.querySelector(".ed-save") as HTMLButtonElement;

/**
 * Mirrors `ProjectContext.saveActiveFile`: every call updates `lastSave`,
 * including the one `runSave` makes on itself. The `lastSave` effect is the
 * only poster of the failed-save toast, so a mock that resolves
 * `false` without touching `lastSave` cannot exercise that path.
 */
function FailingSaveWorkspace({ engine }: { engine: EditorEngine }) {
  const [lastSave, setLastSave] = useState<{
    ok: boolean;
    at: number;
    error: string | null;
  } | null>(null);
  const saveActiveFile = useCallback(async () => {
    setLastSave({ ok: false, at: Date.now(), error: null });
    return false;
  }, []);
  return (
    <Workspace
      engine={engine}
      projectRef={projectRef}
      activeFile="section--hello.md"
      saveActiveFile={saveActiveFile}
      lastSave={lastSave}
      settings={settings}
    />
  );
}

describe("the save state", () => {
  it("rests as a status, not a button", () => {
    make();
    expect(saveChip().dataset.state).toBe("clean");
    expect(saveChip().disabled).toBe(true);
  });

  it("turns to something the writer can act on the moment they type", () => {
    const { engine } = make();
    act(() => engine.type("x"));
    expect(saveChip().dataset.state).toBe("dirty");
    expect(saveChip().disabled).toBe(false);
  });

  // Only the confirmation is asserted here, not the settle that follows it.
  //
  // The settle is a `setTimeout` inside an awaited write, and neither clock
  // reaches it cheaply: a faked one has to flush the promise before the timer
  // it schedules exists, which hangs under coverage instrumentation, and a
  // real one costs ten seconds, because the mounted workspace churns for the
  // whole wait.
  it("confirms a write", async () => {
    const { engine, saveActiveFile } = make();
    act(() => engine.type("x"));
    await act(async () => {
      fireEvent.click(saveChip());
    });
    expect(saveActiveFile).toHaveBeenCalledOnce();
    expect(saveChip().dataset.state).toBe("saved");
  });

  // A confirmation that stays is a status; a failure that goes misleads.
  it("holds the mark when a write does not land", async () => {
    const engine = new EditorEngine();
    engine.open("Hello world");
    const saveActiveFile = vi.fn().mockResolvedValue(false);
    render(
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            saveActiveFile={saveActiveFile}
            settings={settings}
          />,
        )}
      />,
    );
    act(() => engine.type("x"));
    // The failed state lands after the write promise resolves and the surface
    // settles; `await act(...)` would wait for every frame of that settle,
    // which under coverage can outlast the test. Polling for the state does
    // not depend on the surface going quiet.
    fireEvent.click(saveChip());
    await waitFor(() => expect(saveChip().dataset.state).toBe("failed"), {
      timeout: 30000,
    });
    expect(saveChip().dataset.state).toBe("failed");
    expect(saveChip().disabled).toBe(false);
  });

  it("a failed write says so in words, not only in the chip's colour", async () => {
    // The chip alone cannot carry this on a phone: below the narrow
    // breakpoint `.ed-save-label` is `display: none` and `failed` shares its
    // ember with `dirty`, so the chip is a wordless dot.
    const engine = new EditorEngine();
    engine.open("Hello world");
    render(
      <RouterProvider
        router={route(<FailingSaveWorkspace engine={engine} />)}
      />,
    );
    act(() => engine.type("x"));
    fireEvent.click(saveChip());

    await waitFor(() => expect(saveChip().dataset.state).toBe("failed"), {
      timeout: 30000,
    });
    // The standing fact, in words, wherever the chip's word is hidden.
    await waitFor(() =>
      expect(
        document.querySelector(".status-notice[data-tone='alert']")
          ?.textContent,
      ).toContain("toolbar.notSaved"),
    );
  });

  it("and the reason arrives as a toast that does not stay", async () => {
    // The toast carries why and leaves after a few seconds; the notice
    // carries that and stays until a write lands. They are two surfaces,
    // because a single one would have to choose between saying the cause and
    // outliving it.
    const engine = new EditorEngine();
    engine.open("Hello world");
    render(
      <RouterProvider
        router={route(<FailingSaveWorkspace engine={engine} />)}
      />,
    );
    act(() => engine.type("x"));
    fireEvent.click(saveChip());

    await waitFor(() => expect(saveChip().dataset.state).toBe("failed"), {
      timeout: 30000,
    });
    await waitFor(() =>
      expect(document.querySelector(".ui-toasts")?.textContent).toContain(
        "toolbar.notSaved",
      ),
    );
  });

  // Only the `lastSave` effect posts the failed-save toast, so a failed
  // explicit save announces its cause once. Only a mock that
  // updates `lastSave`, as `ProjectContext.saveActiveFile` does, can see a
  // duplicate.
  it("announces a failed save once, not twice", async () => {
    const engine = new EditorEngine();
    engine.open("Hello world");
    render(
      <RouterProvider
        router={route(<FailingSaveWorkspace engine={engine} />)}
      />,
    );
    act(() => engine.type("x"));
    fireEvent.click(saveChip());

    await waitFor(() => expect(saveChip().dataset.state).toBe("failed"), {
      timeout: 30000,
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".ui-toast").length).toBe(1),
    );
  });

  it("— an undo/redo walk back onto the saved state clears the chip, not just the buffer", async () => {
    // Type, save, undo, redo is an identity for the document, which
    // `session.test.ts` pins in the engine. This is the shell
    // half: the save chip's dirty-state subscription has a route back out of
    // "dirty", so a redo that restores the saved buffer clears the chip.
    // `make()`'s default mock resolves `true` without touching the engine;
    // this row needs `hasChanges` to go false as the real `saveActiveFile`
    // makes it, by calling `engine.markSaved(text)`.
    const engine = new EditorEngine();
    engine.open("Hello world");
    const saveActiveFile = vi.fn(async () => {
      engine.markSaved(engine.save());
      return true;
    });
    render(
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            saveActiveFile={saveActiveFile}
            settings={settings}
          />,
        )}
      />,
    );
    act(() => engine.type("x"));
    expect(saveChip().dataset.state).toBe("dirty");
    await act(async () => {
      fireEvent.click(saveChip());
    });
    expect(saveActiveFile).toHaveBeenCalledOnce();
    expect(saveChip().dataset.state).toBe("saved");
    act(() => engine.undo());
    expect(saveChip().dataset.state).toBe("dirty");
    expect(saveChip().textContent).toContain("toolbar.unsaved");
    act(() => engine.redo());
    // Back to the saved state's own resting shape — non-actionable, and
    // naming the write that already happened, never "Unsaved" again.
    expect(saveChip().dataset.state).not.toBe("dirty");
    expect(saveChip().disabled).toBe(true);
    expect(saveChip().textContent).not.toContain("toolbar.unsaved");
  });

  it("is absent with no file open, rather than a control that does nothing", () => {
    const engine = new EditorEngine();
    render(
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile={null}
            saveActiveFile={vi.fn().mockResolvedValue(true)}
            settings={settings}
          />,
        )}
      />,
    );
    expect(document.querySelector(".ed-save")).toBeNull();
  });
});

// ── The keyboard ─────────────────────────────────────────────────────────────
//
// Every binding reaches the engine from the shell, so a control the bar folds
// behind a hover is still one keystroke away.

describe("the keyboard reaches every folded control", () => {
  const mod = { ctrlKey: true, metaKey: false };

  it("sets a block type without opening the fold", () => {
    const { engine } = make();
    fireEvent.keyDown(window, { key: "1", altKey: true, ...mod });
    expect(engine.currentBlockType).toBe("h1");
    fireEvent.keyDown(window, { key: "3", altKey: true, ...mod });
    expect(engine.currentBlockType).toBe("paragraph");
  });

  it("aligns without opening the fold", () => {
    const { engine } = make();
    fireEvent.keyDown(window, { key: "c", altKey: true, ...mod });
    expect(engine.currentAlignment).toBe("center");
    fireEvent.keyDown(window, { key: "j", altKey: true, ...mod });
    expect(engine.currentAlignment).toBe("justify");
  });

  // Mod+1 belongs to the left guillemet, and Mod+Alt+1 does not take it,
  // because the matcher is exact.
  it("leaves the plain modifier binding alone", () => {
    const { engine } = make();
    const before = engine.currentBlockType;
    fireEvent.keyDown(window, { key: "1", ...mod });
    expect(engine.currentBlockType).toBe(before);
  });

  it("opens the shortcut sheet from ? and closes it", () => {
    make();
    fireEvent.keyDown(window, { key: "?" });
    expect(
      screen.getByRole("heading", { name: "shortcuts.title" }),
    ).toBeTruthy();
  });

  it("does not open the sheet while the writer is typing one", () => {
    make();
    const prose = document.querySelector(".editor") as HTMLElement;
    fireEvent.keyDown(prose, { key: "?", target: prose });
    expect(
      screen.queryByRole("heading", { name: "shortcuts.title" }),
    ).toBeNull();
  });

  it("opens the shortcut sheet from the titlebar's keyboard button", () => {
    make();
    fireEvent.click(screen.getByRole("button", { name: "shortcuts.title" }));
    expect(
      screen.getByRole("heading", { name: "shortcuts.title" }),
    ).toBeTruthy();
  });

  // The editor draws `CommandBoard`; `.palette` is the Library's search.
  it("opens the command palette", () => {
    make();
    fireEvent.keyDown(window, { key: "k", ...mod });
    expect(document.querySelector(".board")).toBeTruthy();
    expect(document.querySelectorAll(".board-cell").length).toBeGreaterThan(10);
  });

  it("runs a command from the palette", () => {
    const { engine } = make();
    fireEvent.keyDown(window, { key: "k", ...mod });
    const cells = [
      ...document.querySelectorAll(".board-cell"),
    ] as HTMLElement[];
    const bold = cells.find((c) => c.textContent?.includes("toolbar.bold"));
    if (bold === undefined)
      throw new Error("The palette should list the bold command");
    fireEvent.click(bold);
    expect(engine.isBold).toBe(true);
  });
});

// ── The selection bubble ─────────────────────────────────────────────────────
//
// The bubble's own geometry and buttons are tested beside it. What is wired
// here is the seam: one `selectionchange` listener feeds both the repetition
// highlight and the bubble, and the bubble's two commands reach across the
// workspace to the find field and the dock.

describe("what a selection offers", () => {
  /** Put a real selection over the prose and let the shared debounce settle. */
  function selectProse(text = "Hello") {
    const prose = document.querySelector(".editor") as HTMLElement;
    const node = prose.firstChild?.firstChild ?? prose.firstChild;
    if (node === null)
      throw new Error("The prose must have a node to place the selection on");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(text.length, node.textContent?.length ?? 0));
    // jsdom measures nothing, and a zero-width rect is how the workspace
    // tells "there is no selection" from "there is one", so this one has a
    // size.
    range.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 200,
        right: 220,
        bottom: 220,
        width: 120,
        height: 20,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;

    const selection = window.getSelection();
    if (selection === null)
      throw new Error("jsdom must expose a Selection to exercise the bubble");
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
      vi.advanceTimersByTime(200);
    });
  }

  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }),
  );

  it("offers the bubble over a selection, and takes it away on the next keystroke", () => {
    make();
    selectProse();
    expect(document.querySelector(".ui-bubble")).toBeTruthy();

    // On the keystroke, not after it: a writer retyping the word they selected
    // has already answered the question the bubble was asking.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(document.querySelector(".ui-bubble")).toBeNull();
  });

  it("takes it away on Escape", () => {
    make();
    selectProse();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector(".ui-bubble")).toBeNull();
  });

  it("hands the selection to find, which opens seeded with it", () => {
    make();
    selectProse();
    act(() => {
      fireEvent.click(screen.getByText("bubble.everyOne"));
    });
    const field = document.querySelector(
      ".ui-bar-find input",
    ) as HTMLInputElement;
    expect(field.value).toBe("Hello");
    expect(document.querySelector(".ui-bubble")).toBeNull();
  });

  it("every one over a repeated word switches the registers without crashing", () => {
    // The route-level wiring pin. The fixture needs a repeated word ("cat
    // cat"), since "Hello world" forms no repetition candidate.
    // `selectProse`'s offset-0 start works here because the engine anchor
    // syncs from the dispatched `selectionchange` in jsdom. Two registers
    // over one word make the highlight pass throw `IndexSizeError`; the gate
    // and the floor make it a clean register switch.
    const engine = new EditorEngine();
    engine.open("cat cat");
    render(
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            saveActiveFile={vi.fn().mockResolvedValue(true)}
            settings={settings}
            dock={{
              provider: {
                listDir: async () => [],
                readFile: async () => "",
              } as never,
            }}
          />,
        )}
      />,
    );
    selectProse("cat");
    // Selection alone: the repetition register paints the other occurrence.
    expect(document.querySelectorAll("mark.hl-repetition").length).toBe(1);

    act(() => {
      fireEvent.click(screen.getByText("bubble.everyOne"));
    });
    // The register switch: repetition marks gone, the seeded search's marks
    // in their place, the field seeded, and no throw.
    expect(document.querySelectorAll("mark.hl-repetition").length).toBe(0);
    expect(
      document.querySelectorAll("mark.hl-search, mark.hl-search-current")
        .length,
    ).toBe(2);
    const field = document.querySelector(
      ".ui-bar-find input",
    ) as HTMLInputElement;
    expect(field.value).toBe("cat");
  });

  it("hands the selection to the assistant, which opens quoting it", () => {
    // This row needs the dock, which exists only when the project layer has
    // handed the workspace a provider, and an Assistant, without which the
    // bubble offers no Ask at all.
    const engine = new EditorEngine();
    engine.open("Hello world");
    render(
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            saveActiveFile={vi.fn().mockResolvedValue(true)}
            settings={settings}
            dock={{
              provider: {
                listDir: async () => [],
                readFile: async () => "",
              } as never,
              assistant: assistantTestStub(),
            }}
          />,
        )}
      />,
    );

    selectProse();
    act(() => {
      fireEvent.click(screen.getByText("bubble.ask"));
    });
    expect(document.querySelector(".ui-bubble")).toBeNull();
    // The dock is the workspace's, and it opens on the face that was asked for.
    expect(document.querySelector(".ed-dock")?.getAttribute("data-open")).toBe(
      "1",
    );
  });

  // The workspace's own gate, not the bubble's. The twin is the
  // row above, whose Assistant makes Ask the way to the dock.
  it("offers no Ask on a selection when there is no Assistant", () => {
    const engine = new EditorEngine();
    engine.open("Hello world");
    render(
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            saveActiveFile={vi.fn().mockResolvedValue(true)}
            settings={settings}
            dock={{
              provider: {
                listDir: async () => [],
                readFile: async () => "",
              } as never,
              assistant: null,
            }}
          />,
        )}
      />,
    );

    selectProse();
    expect(document.querySelector(".ui-bubble")).toBeTruthy();
    expect(screen.getByText("bubble.everyOne")).toBeTruthy();
    expect(screen.queryByText("bubble.ask")).toBeNull();
  });

  // ── The prose context menu ─────────────────────────────────────────────────

  function rightClickOnProse() {
    const prose = document.querySelector(".editor") as HTMLElement;
    act(() => {
      // A mouse, stated: `contextmenu` carries no pointer type, so the shell
      // reads the press that came before it. Every case below is a right
      // click.
      fireEvent.pointerDown(prose, { pointerType: "mouse" });
      fireEvent.contextMenu(prose, { clientX: 150, clientY: 210 });
    });
  }

  it("opens the clipboard menu over a selection and keeps the bubble up", () => {
    make();
    selectProse();
    rightClickOnProse();

    expect(document.querySelector(".ui-menu.ui-menu-inverse")).toBeTruthy();
    expect(screen.getByText("toolbar.cut")).toBeTruthy();
    expect(screen.getByText("toolbar.searchWeb")).toBeTruthy();
    // The two surfaces coexist over a selection.
    expect(document.querySelector(".ui-bubble")).toBeTruthy();
  });

  // The native callout is the only touch route to Cut, Copy, Paste and
  // Select All: the editor has no toolbar for them, and its shortcuts need a
  // modifier a soft keyboard cannot produce. A mouse's menu in its place
  // would carry `<kbd>` labels for keys the device does not have.
  it("leaves a long press to the platform, and opens nothing of its own", () => {
    make();
    const prose = document.querySelector(".editor") as HTMLElement;
    act(() => {
      fireEvent.pointerDown(prose, { pointerType: "touch" });
    });
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 150,
      clientY: 210,
    });
    act(() => {
      prose.dispatchEvent(event);
    });

    // Not only "no menu": the event comes out unprevented, because
    // `preventDefault` is what suppresses the callout.
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector(".ui-menu.ui-menu-inverse")).toBeNull();
  });

  it("still answers a mouse on a device that also has a finger", () => {
    make();
    const prose = document.querySelector(".editor") as HTMLElement;
    act(() => {
      // The finger came first, and then the mouse. The rule is about the
      // gesture, not about the device: a touch-screen laptop keeps both.
      fireEvent.pointerDown(prose, { pointerType: "touch" });
      fireEvent.pointerDown(prose, { pointerType: "mouse" });
      fireEvent.contextMenu(prose, { clientX: 150, clientY: 210 });
    });
    expect(document.querySelector(".ui-menu.ui-menu-inverse")).toBeTruthy();
  });

  it("disables cut and copy when nothing is selected", () => {
    make();
    rightClickOnProse();

    const cut = screen.getByText("toolbar.cut").closest("button");
    const copy = screen.getByText("toolbar.copy").closest("button");
    expect(cut?.disabled).toBe(true);
    expect(copy?.disabled).toBe(true);
  });

  it("searches the selection, unformatted, in a new tab", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    make();
    selectProse();
    rightClickOnProse();

    act(() => {
      fireEvent.click(screen.getByText("toolbar.searchWeb"));
    });
    expect(openSpy).toHaveBeenCalledWith(
      "https://www.google.com/search?q=Hello",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});

// ── The structure panel's width ──────────────────────────────────────────────
//
// The shell emits `--panel-w` whole: the writer's dragged width and the
// fold's 52 are the same number in the same place, because an inline custom
// property beats any stylesheet rule. The panel itself is stubbed in this
// file, so these pin the emission and the adoption; the grip and its drag
// are pinned in `DocumentTree.test.tsx`, where the panel is real.

describe("the structure panel's width", () => {
  const shell = () => document.querySelector(".editor-shell") as HTMLElement;
  const panelW = () => shell().style.getPropertyValue("--panel-w");

  function renderPanel(structureWidth: number | null = null) {
    const engine = new EditorEngine();
    engine.open("Hello world");
    render(
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            saveActiveFile={vi.fn().mockResolvedValue(true)}
            settings={settings}
            structureWidth={structureWidth}
            onStructureResize={vi.fn()}
          />,
        )}
      />,
    );
  }

  it("opens at the shipped default when the project has no width of its own", () => {
    renderPanel();
    expect(panelW()).toBe(`${PANEL_W}px`);
  });

  it("adopts the width this project last left", () => {
    renderPanel(420);
    expect(panelW()).toBe("420px");
  });

  // A hand-edited properties file is not a promise. The clamp is applied where
  // the width is used, never where it is stored.
  it("clamps an adopted width into the panel's real limits", () => {
    renderPanel(5000);
    expect(panelW()).toBe(`${MAX_PANEL_W}px`);
  });

  // The fold wins while it is folded, and does not consume the width it
  // covers: the rail is a different view, not a narrower panel.
  it("emits the rail's width while folded, and keeps the writer's underneath", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      renderPanel(420);
      expect(shell().getAttribute("data-rail")).toBe("1");
      expect(panelW()).toBe(`${RAIL_PANEL_W}px`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The peek draws the folded panel wide over the prose. The face changes
  // (`data-rail` goes to 0, so the wide view shows) and the layout does not:
  // `--panel-w` still reserves the rail's 52, which keeps the prose, the bar
  // and the gutter where they were.
  it("draws a peek at the writer's width without moving the rail's layout", () => {
    renderPanel(420);
    act(() => treeProps.current.onToggleCollapse?.());
    expect(shell().getAttribute("data-rail")).toBe("1");
    act(() => treeProps.current.onPeek?.(true));
    expect(shell().getAttribute("data-rail")).toBe("0");
    expect(shell().getAttribute("data-peek")).toBe("1");
    expect(treeProps.current.peek).toBe(true);
    expect(panelW()).toBe(`${RAIL_PANEL_W}px`);
    expect(shell().style.getPropertyValue("--panel-open-w")).toBe("420px");

    act(() => treeProps.current.onPeek?.(false));
    expect(shell().getAttribute("data-rail")).toBe("1");
    expect(shell().getAttribute("data-peek")).toBe("0");
  });

  it("pins a peeked panel open when the collapse control is pressed", () => {
    renderPanel(420);
    act(() => treeProps.current.onToggleCollapse?.());
    act(() => treeProps.current.onPeek?.(true));
    act(() => treeProps.current.onToggleCollapse?.());
    expect(shell().getAttribute("data-peek")).toBe("0");
    expect(shell().getAttribute("data-rail")).toBe("0");
    expect(panelW()).toBe("420px");
    // The peek it ended does not come back on the next fold.
    act(() => treeProps.current.onToggleCollapse?.());
    expect(shell().getAttribute("data-peek")).toBe("0");
    expect(shell().getAttribute("data-rail")).toBe("1");
  });

  // The narrow plane peeks, since a panel that cannot stand beside the full
  // measure most needs one there. The phone does not: it has a sheet,
  // not a rail. The window starts narrow, so the panel starts folded.
  it("peeks on the narrow plane, and not on the phone", () => {
    const planes = (phone: boolean) =>
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("1015.98") || (phone && query.includes("720")),
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    try {
      planes(false);
      renderPanel(420);
      expect(shell().getAttribute("data-narrow")).toBe("1");
      expect(shell().getAttribute("data-rail")).toBe("1");
      act(() => treeProps.current.onPeek?.(true));
      expect(shell().getAttribute("data-peek")).toBe("1");
      expect(panelW()).toBe(`${RAIL_PANEL_W}px`);
      cleanup();

      planes(true);
      renderPanel(420);
      expect(shell().getAttribute("data-phone")).toBe("1");
      act(() => treeProps.current.onPeek?.(true));
      expect(shell().getAttribute("data-peek")).toBe("0");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // An unfolded panel has nothing to peek at.
  it("ignores a peek while the panel is unfolded", () => {
    renderPanel(420);
    act(() => treeProps.current.onPeek?.(true));
    expect(shell().getAttribute("data-peek")).toBe("0");
  });
});

// ── The dock's resize ────────────────────────────────────────────────────────
//
// The dock is one surface with two faces and one width; the shell wears that
// width as `--dock-w`, so the panel and the measure's re-centre follow the
// same number. These tests drive the handle's pointer and keyboard paths and
// check the number that reaches the shell, and that the persist lands once
// per drag, on release, never per frame.

describe("the dock resize (feature 12)", () => {
  const shell = () => document.querySelector(".editor-shell") as HTMLElement;
  const dockW = () => shell().style.getPropertyValue("--dock-w");
  const handle = () => document.querySelector(".dock-resize") as HTMLElement;

  // A 1920 window, where the product's own limits are what bind: jsdom's
  // 1024 default is a small window, whose reach caps the dock at 720 and so
  // would hide the ceiling these rows pin. The rows that are about
  // the window set their own width.
  const setWindowWidth = (w: number) =>
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: w,
    });
  let jsdomWidth = 0;
  beforeEach(() => {
    jsdomWidth = window.innerWidth;
    setWindowWidth(1920);
  });
  afterEach(() => setWindowWidth(jsdomWidth));

  function renderDock(
    opts: {
      dockWidth?: number | null;
      onDockResize?: (width: number) => void;
    } = {},
  ) {
    const engine = new EditorEngine();
    engine.open("Hello world");
    const onDockResize = opts.onDockResize ?? vi.fn();
    render(
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            saveActiveFile={vi.fn().mockResolvedValue(true)}
            settings={settings}
            dockWidth={opts.dockWidth ?? null}
            onDockResize={onDockResize}
            dock={{
              provider: {
                listDir: async () => [],
                readFile: async () => "",
              } as never,
            }}
          />,
        )}
      />,
    );
    // The palette's Reference entry opens the dock: this suite sizes the
    // dock, whichever face it wears. The bar's spark exists only with an
    // Assistant, and the camera's face needs a project layer this
    // harness does not mount.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, metaKey: false });
    const reference = [...document.querySelectorAll(".board-cell")].find(
      (cell) => cell.textContent?.includes("dock.reference"),
    ) as HTMLElement | undefined;
    if (!reference) throw new Error("The palette should offer Reference");
    act(() => {
      fireEvent.click(reference);
    });
    return { engine, onDockResize };
  }

  it("starts at the default width, with a handle to drag", () => {
    renderDock();
    expect(dockW()).toBe(`${MIN_DOCK_W}px`);
    expect(handle()).toBeTruthy();
    expect(handle().getAttribute("aria-orientation")).toBe("vertical");
  });

  it("points at the dock it sizes, and tracks the width it is set to", () => {
    // The splitter contract's other half, through the real shell: the width
    // the handle announces is the one the shell is wearing, and the element
    // it names exists. A dangling `aria-controls` fails nothing on its own.
    renderDock({ dockWidth: 420 });
    expect(handle().getAttribute("aria-controls")).toBe(DOCK_ID);
    expect(document.getElementById(DOCK_ID)).toBe(
      document.querySelector(".ed-dock"),
    );
    expect(handle().getAttribute("aria-valuenow")).toBe("420");
    expect(handle().getAttribute("aria-valuemin")).toBe(String(MIN_DOCK_W));
    expect(handle().getAttribute("aria-valuemax")).toBe(String(MAX_DOCK_W));

    // The value moves; one that only described the seed would report the
    // width the writer started from for the rest of the session.
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle().getAttribute("aria-valuenow")).toBe("444");
  });

  it("drags the dock wider live, and persists exactly once on release", () => {
    const { onDockResize } = renderDock();
    fireEvent.pointerDown(handle(), { button: 0, clientX: 500 });
    // Two moves, two widths: the shell re-centres on every frame of the drag.
    // Against the seed rather than as literals, because the seed is the
    // floor.
    fireEvent.pointerMove(window, { clientX: 460 });
    expect(dockW()).toBe(`${MIN_DOCK_W + 40}px`);
    fireEvent.pointerMove(window, { clientX: 420 });
    expect(dockW()).toBe(`${MIN_DOCK_W + 80}px`);
    // No write in flight: the persist is the release, not the drag.
    expect(onDockResize).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    expect(dockW()).toBe(`${MIN_DOCK_W + 80}px`);
    expect(onDockResize).toHaveBeenCalledTimes(1);
    expect(onDockResize).toHaveBeenCalledWith(MIN_DOCK_W + 80);
  });

  it("clamps the drag to the dock floor and ceiling", () => {
    const { onDockResize } = renderDock();
    fireEvent.pointerDown(handle(), { button: 0, clientX: 500 });
    fireEvent.pointerMove(window, { clientX: -5000 });
    fireEvent.pointerUp(window);
    expect(dockW()).toBe(`${MAX_DOCK_W}px`);
    expect(onDockResize).toHaveBeenLastCalledWith(MAX_DOCK_W);

    fireEvent.pointerDown(handle(), { button: 0, clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 5000 });
    fireEvent.pointerUp(window);
    expect(dockW()).toBe(`${MIN_DOCK_W}px`);
    expect(onDockResize).toHaveBeenLastCalledWith(MIN_DOCK_W);
  });

  it("nudges by arrow keys and jumps to the limits, persisting each step", () => {
    const { onDockResize } = renderDock();
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(dockW()).toBe(`${MIN_DOCK_W + 24}px`);
    expect(onDockResize).toHaveBeenCalledTimes(1);
    expect(onDockResize).toHaveBeenCalledWith(MIN_DOCK_W + 24);
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(dockW()).toBe(`${MIN_DOCK_W}px`);
    fireEvent.keyDown(handle(), { key: "End" });
    expect(dockW()).toBe(`${MAX_DOCK_W}px`);
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(dockW()).toBe(`${MIN_DOCK_W}px`);
  });

  it("adopts the width the project remembered, clamped to the dock limits", () => {
    renderDock({ dockWidth: 480 });
    expect(dockW()).toBe("480px");

    cleanup();
    renderDock({ dockWidth: 9000 });
    expect(dockW()).toBe(`${MAX_DOCK_W}px`);
  });

  // ── The window has the last word ───────────────────────────────────────────
  //
  // The dock is drawn no wider than the window's reach, never over the
  // structure panel, while the width the writer chose is kept, so a bigger
  // window gives it back. The drag sticks, once, at the widest dock beside
  // which the whole measure stays visible.

  it("draws the dock no wider than the window lets it reach, and gives the width back", () => {
    // 1100: reach = 1100 − 8 − (8 + 248 + 40) = 796.
    setWindowWidth(1100);
    const { onDockResize } = renderDock({ dockWidth: MAX_DOCK_W });
    expect(dockW()).toBe("796px");
    expect(handle().getAttribute("aria-valuemax")).toBe("796");
    // Only drawn narrower: nothing was persisted on the writer's behalf.
    expect(onDockResize).not.toHaveBeenCalled();

    act(() => {
      setWindowWidth(1920);
      window.dispatchEvent(new Event("resize"));
    });
    expect(dockW()).toBe(`${MAX_DOCK_W}px`);
  });

  it("sticks the drag where the dock starts to cover the measure, then lets go", () => {
    // 1920: fit = 1920 − 296 − 680 − 40 = 904. From the 340 floor, a pointer
    // 564px left asks for 904, the detent itself.
    const { onDockResize } = renderDock();
    fireEvent.pointerDown(handle(), { button: 0, clientX: 600 });
    fireEvent.pointerMove(window, { clientX: 36 });
    expect(dockW()).toBe("904px");
    // Through the band, the edge is back under the pointer.
    fireEvent.pointerMove(window, { clientX: -6 });
    expect(dockW()).toBe("946px");
    fireEvent.pointerUp(window);
    expect(onDockResize).toHaveBeenLastCalledWith(946);
  });

  it("stops an arrow step on the detent as it crosses it", () => {
    renderDock({ dockWidth: 890 });
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(dockW()).toBe("904px");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(dockW()).toBe("928px");
  });

  // ── An interrupted drag ────────────────────────────────────────────────────
  //
  // An interrupted drag has two halves that pull in opposite directions. The
  // teardown commits nothing, or a width settles into whatever project is
  // open when the stray release lands. The drag's holder is
  // still told, or its state is never turned off: `data-resizing-dock="1"`, the
  // dead transitions, `user-select: none` on the shell, and a latched
  // `resizingRef` that stops a persisted width being adopted.
  //
  // `onResizeCancel` satisfies both: it carries no width, so it cannot
  // persist, and it fires on the teardown, so the drag ends.
  //
  // The plane flip is the real trigger: on the phone plane the dock moves
  // inside the Scrim, which unmounts it while the pointer is still down.
  it("— leaves its drag state when the panel unmounts mid-drag", () => {
    const subs = new Map<string, Set<() => void>>();
    let phone = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return query.includes("720") ? phone : false;
      },
      addEventListener: (_t: string, fn: () => void) => {
        if (!subs.has(query)) subs.set(query, new Set());
        subs.get(query)?.add(fn);
      },
      removeEventListener: (_t: string, fn: () => void) =>
        subs.get(query)?.delete(fn),
    }));
    try {
      const { onDockResize } = renderDock();
      fireEvent.pointerDown(handle(), { button: 0, clientX: 500 });
      fireEvent.pointerMove(window, { clientX: 460 });
      expect(shell().getAttribute("data-resizing-dock")).toBe("1");

      // The window becomes a phone with the pointer still down.
      act(() => {
        phone = true;
        subs.forEach((set) => set.forEach((fn) => fn()));
      });
      expect(shell().getAttribute("data-phone")).toBe("1");

      // A drag that never ended is not a drag that ended somewhere: nothing
      // is persisted, and the shell is not left mid-drag either.
      fireEvent.pointerUp(window);
      expect(onDockResize).not.toHaveBeenCalled();
      expect(shell().getAttribute("data-resizing-dock")).toBe("0");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── The snapshot comparison and the face ─────────────────────────────────────
//
// The dock's snapshot face drives the engine's read-only comparison. A
// second selection replaces the comparison and never keeps showing the first
// snapshot's diff, and closing the face returns the editor to normal status,
// whatever shut it. `session.test.ts` pins the engine-level contract; these
// are the shell's wiring pins (the reads, the enter and exit calls, the
// caption).

//
// This block waits longer than the file's 3000. One `click a
// snapshot row → provider read → engine transition → React flush` chain
// takes about 140ms with a worker to itself, and under the full suite's
// load it outlasts 3000ms; nothing else in the file is this long a chain.
// Every wait below polls the state it asserts, so a longer
// budget lets no wrong answer through. The per-test timeout goes up with it,
// because an `asyncUtilTimeout` above vitest's own 5000 would turn a hang
// into a test timeout instead of a clean assertion.
describe("the snapshot comparison and the face", { timeout: 20_000 }, () => {
  beforeEach(() => configure({ asyncUtilTimeout: 10_000 }));
  afterEach(() => configure({ asyncUtilTimeout: 3000 }));

  /** The workspace with a real dock and the Storm fixture: the open node
   * carries two snapshots, so the face has rows to choose from. The project's
   * own `PROPS` point `lastOpened` at EL2 (Opening); this harness needs the
   * Storm open, so the fixture's id is overridden before it is written, and
   * the writer resumes it from the Desk, since a fresh open restores nothing
   * by itself. */
  async function renderWithSnapshots(
    over: {
      autosave?: boolean;
      autosaveDelay?: number;
      /** For the rows about the Ask face, which exists only with one. */
      assistant?: boolean;
    } = {},
  ) {
    const provider = new FakeProvider();
    seedProps(
      provider,
      PROPS.replace('"lastOpened": "EL2"', '"lastOpened": "EL3"'),
    );
    provider.files.set(STRUCTURE_FILE, STRUCTURE);
    for (const [path, content] of Object.entries(DEFAULT_FILES))
      provider.files.set(path, content);
    const engine = new EditorEngine();
    engine.open(DEFAULT_FILES[filePath("section--the_storm.EL3.01.md")]);
    const saveActiveFile = vi.fn().mockResolvedValue(true);
    const resume: { opened?: Promise<void> } = {};
    const view = render(
      <RouterProvider
        router={route(
          <ProjectProvider
            engine={engine}
            provider={provider}
            projectKey="demo-key"
          >
            <AutoResume
              file="section--the_storm.EL3.01.md"
              onStarted={(opened) => (resume.opened = opened)}
            />
            <Workspace
              engine={engine}
              projectRef={{
                providerId: "fake",
                key: "demo-key",
                name: "Demo",
                openedAt: "",
              }}
              activeFile="section--the_storm.EL3.01.md"
              openTitle="The Storm"
              saveActiveFile={saveActiveFile}
              settings={{
                ...settings,
                autosave: over.autosave ?? settings.autosave,
                autosaveDelay: over.autosaveDelay ?? settings.autosaveDelay,
              }}
              dock={{
                provider,
                activeNode: { id: "EL3", title: "The Storm" },
                assistant: over.assistant ? assistantTestStub() : null,
              }}
            />
          </ProjectProvider>,
        )}
      />,
    );
    // The shell is handed the Storm as its open file from the first render,
    // but the project opens it only when this resume lands, and `engine.open`
    // wipes whatever is on screen, a comparison included. So
    // nothing starts until the file is open: the resume's own promise, not a
    // guess at how long it takes. It starts once the project is ready, which
    // takes renders, so React's queued work is flushed turn by turn, never by
    // a timer a row on fake timers could not advance, and then the open is
    // awaited.
    for (let turn = 0; !resume.opened; turn++) {
      if (turn === 100) throw new Error("the fixture's resume never started");
      await act(async () => {});
    }
    await act(async () => {
      await resume.opened;
    });
    return { provider, engine, view, saveActiveFile };
  }

  /** The writer's Desk resume, auto-played once the folder is ready, since a
   *  fresh open restores nothing by itself. Effect-driven, never
   *  timer-driven, so it also works under fake timers. */
  function AutoResume({
    file,
    onStarted,
  }: {
    file: string;
    /** Handed the open's promise, so the fixture can await it landing. */
    onStarted?: (opened: Promise<void>) => void;
  }) {
    const { openFile } = useProjectActions();
    const { status } = useProjectState();
    const fired = useRef(false);
    useEffect(() => {
      if (status === "ready" && !fired.current) {
        fired.current = true;
        onStarted?.(openFile(file));
      }
    }, [status, file, openFile, onStarted]);
    return null;
  }

  /** The bar's camera toggle (Mod+Shift+D) opens the dock on the snapshot
   * face, and the face settles with the fixture's two rows. The shortcut
   * listeners live on `window`, so the dispatch does too. */
  async function openSnapshotFace() {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "d",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".snap-row").length).toBe(2),
    );
  }

  const snapshotTitle = (index: number) =>
    document.querySelectorAll(".snap-title")[index] as HTMLElement;

  it("a second selection replaces the comparison — never the stale first diff", async () => {
    const { engine } = await renderWithSnapshots();
    await openSnapshotFace();
    // A third snapshot through the ghost-row flow: its text equals the
    // adopted file, so comparing it produces an empty diff, an unmistakable
    // replacement of the first snapshot's marks.
    fireEvent.click(screen.getByTitle("snapshots.addNewSnapshot"));
    const input = await screen.findByLabelText("The Storm 3");
    fireEvent.change(input, { target: { value: "The Storm 3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(document.querySelectorAll(".snap-title").length).toBe(3),
    );
    // Select the older snapshot: the diff is up, with marks on the prose.
    fireEvent.click(snapshotTitle(2));
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    expect(
      document.querySelectorAll(".editor mark.df-deleted").length,
    ).toBeGreaterThan(0);
    // Select the newest snapshot while the first diff is still up: the pair
    // is replaced, and identical texts leave no marks at all.
    fireEvent.click(snapshotTitle(0));
    await waitFor(() =>
      expect(document.querySelectorAll(".editor mark.df-deleted").length).toBe(
        0,
      ),
    );
    expect(engine.isInDiff).toBe(true);
  });

  // The DOM follows `engine.isInDiff` one React render later, so a wait on
  // the engine flag followed by a synchronous DOM read can read a render it
  // never waited for under load. Both waits are on the thing
  // being asserted. The engine flag is asserted inside the same block, so the
  // group retries together instead of one fact vouching for another.
  it("closing the face returns the editor to normal status", async () => {
    const { engine } = await renderWithSnapshots();
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1));
    await waitFor(() => {
      expect(engine.isInDiff).toBe(true);
      expect(document.querySelector(".comparing-question")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "dock.close" }));
    // Normal status: the caption card is gone, the prose is editable again,
    // and the face's transient state is cleared with the face, leaving no
    // stale selection to reopen.
    await waitFor(() => {
      expect(engine.isInDiff).toBe(false);
      expect(document.querySelector(".comparing-question")).toBeNull();
      expect(
        document.querySelector(".editor")?.getAttribute("contenteditable"),
      ).toBe("true");
      expect(document.querySelector(".snap-table")).toBeNull();
    });
  });

  it("— a comparison whose read fails still clears the pressed row", async () => {
    const { provider, engine } = await renderWithSnapshots();
    await openSnapshotFace();
    // The compared file vanishes between the selection and the read (a
    // deleted snapshot, a synced-away file): the shell's catch exits the diff
    // but never routes through `handleCompare(null)`, so it bumps the exit
    // counter itself, and the pressed row clears even though the comparison
    // never opened.
    const original = provider.readFile.getMockImplementation();
    provider.readFile.mockImplementation(async (ref, path) => {
      if (path === filePath("section--the_storm.EL3.00.md"))
        throw new Error("gone");
      return (await original?.(ref, path)) ?? "";
    });
    fireEvent.click(snapshotTitle(1)); // The Storm 1 — the compared file
    await waitFor(() => expect(engine.isInDiff).toBe(false));
    // The row does not stay highlighted over a comparison that never opened.
    await waitFor(() =>
      expect(document.querySelector(".snap-row.selected")).toBeNull(),
    );
  });

  // The panel reports "nothing compared" as its rows arrive, and the shell
  // does not treat that echo as a comparison exited from outside, which
  // would unpress a row pressed before the echo returns. The
  // face opens outside `act` here, as RTL's own waits run, so its renders
  // are scheduled rather than flushed, and the observer (jsdom's own, since
  // this file stubs the global) presses in the microtask after the commit
  // that drew the rows, inside the echo's window every time.
  it("— a row pressed as the face draws it opens its comparison", async () => {
    const { engine } = await renderWithSnapshots();
    let clicked = false;
    const observer = new RealMO(() => {
      const title = document.querySelectorAll(".snap-title")[1] as
        HTMLElement | undefined;
      if (clicked || !title) return;
      clicked = true;
      fireEvent.click(title);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "d",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
      await waitFor(() => expect(clicked).toBe(true));
      await waitFor(() => expect(engine.isInDiff).toBe(true));
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
      observer.disconnect();
    }
  });

  it("— the completed pair says so: the legend collapses into the completion line", async () => {
    const { engine } = await renderWithSnapshots();
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1)); // the older snapshot, "The Storm 1"
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    // Accepting every hunk empties the comparison and the completion line
    // takes over: the pair is done and the card says so. The counter that
    // gates it survives accepts and grain switches. The pair's
    // identity lives in the table's selection; the completion is the bare
    // sentence, and the legend describes marks that are gone, so it
    // collapses with them.
    for (let guard = 0; guard < 50 && engine.diffHunks.length > 0; guard++) {
      engine.acceptHunk(engine.diffHunks[0]);
    }
    expect(engine.acceptsThisComparison).toBeGreaterThan(0);
    expect(engine.diffHunks.length).toBe(0);
    await waitFor(() => {
      const line = document.querySelector(".comparing-question");
      expect(line?.textContent).toContain("snapshots.allAccepted");
    });
    // The legend rows are gone, with nothing left to explain, and the
    // question keys are not in the completion line.
    expect(document.querySelector(".comparing-legend")).toBeNull();
    const line = document.querySelector(".comparing-question");
    expect(line?.textContent).not.toContain("snapshots.questionAdoptedFirst");
    expect(line?.textContent).not.toContain("snapshots.questionSelectedFirst");
    expect(line?.textContent).not.toContain("snapshots.removedAdoptedFirst");
    expect(line?.textContent).not.toContain("snapshots.addedAdoptedFirst");
  });

  it("accepting a hunk never writes the file, never touches the yaml, and the accepted text survives exit", async () => {
    // An accept changes the in-memory adopted snapshot only; the write waits
    // for the normal autosave or the Save button, and the accept path never
    // touches `document-structure.yaml`. On exit, accepted changes stay, like
    // manual edits.
    const { provider, engine, view, saveActiveFile } =
      await renderWithSnapshots();
    const adoptedPath = filePath("section--the_storm.EL3.01.md");
    const adoptedBefore = provider.files.get(adoptedPath);
    const structureBefore = provider.files.get(STRUCTURE_FILE);
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1)); // the older snapshot (.00)
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    let button: Element | null = null;
    await waitFor(() => {
      button = view.container.querySelector(".df-accept");
      expect(button).not.toBeNull();
    });
    if (!button) throw new Error("no Accept button rendered");
    const before = engine.commonmark;
    fireEvent.click(button);
    expect(engine.commonmark).not.toBe(before);
    // Nothing reached the provider: no file write, no yaml write, no save.
    expect(provider.files.get(adoptedPath)).toBe(adoptedBefore);
    expect(provider.files.get(STRUCTURE_FILE)).toBe(structureBefore);
    expect(saveActiveFile).not.toHaveBeenCalled();
    // Closing the face keeps the accepted text: ordinary edits, ordinary
    // exit, the buffer still dirty like any manual edit.
    fireEvent.click(screen.getByRole("button", { name: "dock.close" }));
    await waitFor(() => expect(engine.isInDiff).toBe(false));
    expect(engine.commonmark).not.toBe(before);
    expect(
      document.querySelector(".editor")?.getAttribute("contenteditable"),
    ).toBe("true");
  });

  it("accepts stay suspended from autosave while comparing, and exiting re-schedules it", async () => {
    // The `runSave` gate holds every write while a comparison is up: an
    // autosave landing mid-comparison would rewrite the adopted file and
    // shift the diff's base under the writer. The accept's doc-notify arms
    // the debounce, the gate holds it, and exiting re-arms it so the write
    // lands.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { engine, saveActiveFile } = await renderWithSnapshots({
        autosave: true,
      });
      // Flush the mount's async chain (structure read → the face's rows).
      await act(async () => {});
      await act(async () => {});
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "d",
            ctrlKey: true,
            shiftKey: true,
          }),
        );
      });
      await act(async () => {});
      fireEvent.click(snapshotTitle(1));
      // The compared file read resolves on the microtask queue.
      await act(async () => {});
      expect(engine.isInDiff).toBe(true);
      // The Accept layer settles on its macrotask — a fake timer.
      act(() => {
        vi.advanceTimersByTime(0);
      });
      const button = document.querySelector(".df-accept");
      if (!button) throw new Error("no Accept button rendered");
      fireEvent.click(button);
      expect(engine.commonmark).not.toBe(
        "It came in from the west, without warning.\n",
      );
      // The armed debounce fires, and the comparison gate holds the write.
      act(() => {
        vi.advanceTimersByTime(settings.autosaveDelay * 1000);
      });
      expect(saveActiveFile).not.toHaveBeenCalled();
      // Exiting the diff re-arms the debounce; the write lands.
      fireEvent.click(screen.getByRole("button", { name: "dock.close" }));
      await act(async () => {});
      expect(engine.isInDiff).toBe(false);
      act(() => {
        vi.advanceTimersByTime(settings.autosaveDelay * 1000);
      });
      expect(saveActiveFile).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the comparing bar carries the direction and grain selects above the legend — and the rail shows none", async () => {
    const { engine } = await renderWithSnapshots();
    await openSnapshotFace();
    // No comparison, no bar.
    expect(document.querySelector(".comparing-bar")).toBeNull();
    fireEvent.click(snapshotTitle(1));
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    const bar = document.querySelector(".comparing-bar");
    expect(bar).toBeTruthy();
    // The two lens selects ride side by side at the top of the card,
    // direction on the left and grain on the right, both native selects with
    // their aria-labels.
    const direction = screen.getByLabelText("snapshots.direction");
    const grain = screen.getByLabelText("snapshots.granularity");
    expect(bar?.querySelector(".comparing-question")).toBeTruthy();
    expect(
      direction.compareDocumentPosition(grain) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The legend answers the default direction: the adopted-first question
    // and the two colour keys (the red and green swatches).
    const question = bar?.querySelector(".comparing-question");
    expect(question?.textContent).toContain("snapshots.questionAdoptedFirst");
    const legends = bar?.querySelectorAll(".comparing-legend");
    expect(legends?.length).toBe(2);
    expect(bar?.querySelector(".comparing-swatch-del")).toBeTruthy();
    expect(bar?.querySelector(".comparing-swatch-add")).toBeTruthy();
    // The way out rides the instruments' row, right of the second dropdown,
    // outside the legend card.
    expect(document.querySelector(".comparing-exit")?.textContent).toContain(
      "snapshots.escHint",
    );
    // The rail's walk shows no bar: the lenses belong to the snapshot
    // comparison only, and the rail never takes the direction or the aim.
    engine.enterHistoryDiff();
    await waitFor(() => expect(engine.inHistoryDiff).toBe(true));
    expect(document.querySelector(".comparing-bar")).toBeNull();
  });

  it("switching either lens re-diffs the open comparison in place, independently", async () => {
    const { engine } = await renderWithSnapshots();
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1));
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    const direction = screen.getByLabelText(
      "snapshots.direction",
    ) as HTMLSelectElement;
    const grain = screen.getByLabelText(
      "snapshots.granularity",
    ) as HTMLSelectElement;
    // The default reads from the controlled engine state.
    expect(direction.value).toBe("adoptedWithSelected");
    expect(grain.value).toBe("word");
    fireEvent.change(direction, {
      target: { value: "selectedWithAdopted" },
    });
    await waitFor(() =>
      expect(engine.diffDirection).toBe("selectedWithAdopted"),
    );
    // The legend follows the lens: the question and both colour entries
    // switch to the selected-first reading.
    expect(
      document.querySelector(".comparing-question")?.textContent.toLowerCase(),
    ).toContain("snapshots.questionselectedfirst".toLowerCase());
    const legendTexts = () =>
      [...document.querySelectorAll(".comparing-legend")].map(
        (n) => n.textContent ?? "",
      );
    expect(legendTexts()[0]).toContain("snapshots.removedSelectedFirst");
    expect(legendTexts()[1]).toContain("snapshots.addedSelectedFirst");
    fireEvent.change(grain, { target: { value: "word" } });
    await waitFor(() => expect(engine.diffGranularity).toBe("word"));
    // The two lenses are independent within a pass.
    expect(engine.diffDirection).toBe("selectedWithAdopted");
    expect(engine.diffGranularity).toBe("word");
    // A grain switch re-diffs in place but leaves the direction's legend up.
    expect(legendTexts()[0]).toContain("snapshots.removedSelectedFirst");
    expect(legendTexts()[1]).toContain("snapshots.addedSelectedFirst");
  });

  it("handleCompare resets both lenses per comparison — a lens is per-pass", async () => {
    const { engine } = await renderWithSnapshots();
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1));
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    // Walk both lenses away from their defaults.
    fireEvent.change(screen.getByLabelText("snapshots.direction"), {
      target: { value: "selectedWithAdopted" },
    });
    fireEvent.change(screen.getByLabelText("snapshots.granularity"), {
      target: { value: "word" },
    });
    await waitFor(() =>
      expect(engine.diffDirection).toBe("selectedWithAdopted"),
    );
    // A fresh comparison (return to editing, then select the same snapshot
    // again) starts at the defaults; the lenses never persist into the next
    // pass.
    fireEvent.click(snapshotTitle(0)); // the adopted row: return to editing
    await waitFor(() => expect(engine.isInDiff).toBe(false));
    fireEvent.click(snapshotTitle(1));
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    expect(engine.diffDirection).toBe("adoptedWithSelected");
    expect(engine.diffGranularity).toBe("word");
  });

  // ── The two reviews ────────────────────────────────────────────────────────
  //
  // The snapshot comparison and the history walk are the review surfaces,
  // and they take the whole screen: the command bar stands down in both, and
  // opening one review exits the other. `session.test.ts` pins the engine's
  // own exclusion; these are the shell's halves: the bar gate, and the
  // history button exiting a comparison that is up instead of refusing the
  // press.

  // Every DOM check after a review opens or closes waits for the DOM, not for
  // the engine. The engine's flags flip inside its own call, and the shell
  // re-renders only on the notify that follows (`forceUpdate`), so for one
  // render the flag says "in the comparison" while the screen shows the frame
  // before it.
  const bar = () => document.querySelector(".ui-bar");

  it("stands the command bar down while the snapshot comparison is up, and brings it back on exit", async () => {
    const { engine } = await renderWithSnapshots();
    expect(bar()).toBeTruthy();
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1));
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    await waitFor(() => expect(bar()).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "dock.close" }));
    await waitFor(() => expect(engine.isInDiff).toBe(false));
    await waitFor(() => expect(bar()).toBeTruthy());
  });

  it("stands the command bar down while the history walk is up, and brings it back when the walk closes", () => {
    const { engine } = make();
    expect(bar()).toBeTruthy();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "h",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(
      document.querySelector(".editor-shell")?.getAttribute("data-timeline"),
    ).toBe("1");
    expect(bar()).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(
      document.querySelector(".editor-shell")?.getAttribute("data-timeline"),
    ).toBeNull();
    expect(bar()).toBeTruthy();
    expect(engine.inHistoryDiff).toBe(false);
  });

  it("opening the history walk exits a snapshot comparison that is up", async () => {
    const { engine } = await renderWithSnapshots();
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1));
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    await waitFor(() => expect(bar()).toBeNull());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "h",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    await waitFor(() => expect(engine.inHistoryDiff).toBe(true));
    expect(engine.inSnapshotDiff).toBe(false);
    await waitFor(() =>
      expect(
        document.querySelector(".editor-shell")?.getAttribute("data-timeline"),
      ).toBe("1"),
    );
    // The walk that took the screen keeps the bar down.
    expect(bar()).toBeNull();
    // The dock folds as the walk opens, because the walk owns the screen:
    // opening the history view closes the dock, here one left open on the
    // Snapshot tab.
    expect(document.querySelector(".ed-dock")?.getAttribute("data-open")).toBe(
      "0",
    );
  });

  it("opening the history walk closes a dock left open on the Ask face", async () => {
    const { engine } = await renderWithSnapshots({ assistant: true });
    fireEvent.click(screen.getByRole("button", { name: "toolbar.assistant" }));
    expect(document.querySelector(".ed-dock")?.getAttribute("data-open")).toBe(
      "1",
    );
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "h",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(
      document.querySelector(".editor-shell")?.getAttribute("data-timeline"),
    ).toBe("1");
    // The dock closed as the walk opened, whichever face it wore.
    expect(document.querySelector(".ed-dock")?.getAttribute("data-open")).toBe(
      "0",
    );
    void engine;
  });

  it("opening a snapshot comparison closes a history walk that is open", async () => {
    const { engine } = await renderWithSnapshots();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "h",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(
      document.querySelector(".editor-shell")?.getAttribute("data-timeline"),
    ).toBe("1");
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1));
    await waitFor(() => expect(engine.inSnapshotDiff).toBe(true));
    expect(engine.inHistoryDiff).toBe(false);
    await waitFor(() =>
      expect(
        document.querySelector(".editor-shell")?.getAttribute("data-timeline"),
      ).toBeNull(),
    );
    // The comparison that took the screen keeps the bar down.
    expect(bar()).toBeNull();
  });

  it("— the find query survives the reviews, and Ctrl+F reopens with it", async () => {
    // The reviews unmount the whole bar, and with it the find panel's query
    // state — the shell re-seeds the remount from what the panel reported
    // when it died, so a live search is not lost to a comparison.
    const { engine } = await renderWithSnapshots();
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const field = () =>
      screen.getByPlaceholderText("search.placeholder") as HTMLInputElement;
    fireEvent.change(field(), { target: { value: "west" } });
    expect(field().value).toBe("west");
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1));
    await waitFor(() => expect(engine.isInDiff).toBe(true));
    // The comparison owns the screen — the find field is gone with the bar.
    await waitFor(() => expect(bar()).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "dock.close" }));
    await waitFor(() => expect(engine.isInDiff).toBe(false));
    await waitFor(() => expect(bar()).toBeTruthy());
    // Ctrl+F reopens the field with the query the writer was running.
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(field().value).toBe("west");
  });

  it("— the history button wins over an in-flight comparison read", async () => {
    // The comparison read is async (a file read that resolves after the
    // click). Pressing the history button inside that window is the later
    // action and must win: the landing read must not open the comparison
    // behind the rail and slam it shut through the latch.
    const { engine } = await renderWithSnapshots();
    await openSnapshotFace();
    fireEvent.click(snapshotTitle(1));
    // The read has not resolved — no comparison up yet.
    expect(engine.inSnapshotDiff).toBe(false);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "h",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(
      document.querySelector(".editor-shell")?.getAttribute("data-timeline"),
    ).toBe("1");
    // Let the stale read land — the rail keeps the screen.
    await act(async () => {});
    expect(engine.inSnapshotDiff).toBe(false);
    expect(engine.inHistoryDiff).toBe(true);
    expect(
      document.querySelector(".editor-shell")?.getAttribute("data-timeline"),
    ).toBe("1");
  });
});

// ── The hold on entry ────────────────────────────────────────────────────────
//
// Entering a project puts no editable page in front of the writer until the
// project has loaded and a Section or Part is opened. Two
// mechanisms carry it: `EditorBoot` keeps the whole chrome behind the
// skeleton while the open pipeline runs, and the bridge's bare stand-in keeps
// the surface in desk mode for settled states that have no Desk to build.

describe("the hold on entry", () => {
  /** A provider-backed EditorScreen: the route as the app really mounts it. */
  function makeProject(over: { grant?: boolean; stall?: boolean } = {}) {
    const fake = new FakeProvider();
    fake.grant = over.grant ?? true;
    for (const [path, content] of Object.entries(DEFAULT_FILES))
      fake.files.set(path, content);
    seedProps(fake, PROPS);
    fake.files.set(STRUCTURE_FILE, STRUCTURE);
    if (over.stall) {
      // The open pipeline's first read never comes back — status stays at
      // "loading" for as long as this test needs to look at the hold.
      fake.readFile = vi.fn(() => new Promise<string>(() => {}));
    }
    const router = route(<EditorScreen provider={fake} projectKey="proj" />);
    // The real bridge is what these mount, and the bridge reads who is signed
    // in for the titlebar's face — `useAuth` throws outside a provider, and in
    // production there is always one. With no stored token the provider
    // settles straight to anonymous and makes no request, so this costs a
    // wrapper and nothing else.
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
    return { fake };
  }

  it("editorBooted admits every settled status and holds loading/idle", () => {
    expect(editorBooted("idle")).toBe(false);
    expect(editorBooted("loading")).toBe(false);
    expect(editorBooted("ready")).toBe(true);
    expect(editorBooted("invalid")).toBe(true);
    expect(editorBooted("error")).toBe(true);
  });

  it("a project still loading shows the skeleton, not an editable page", () => {
    makeProject({ stall: true });
    expect(screen.getByRole("status", { name: "app.loading" })).toBeTruthy();
    expect(document.querySelector(".editor-shell")).toBeNull();
    expect(document.querySelector(".editor-surface")).toBeNull();
  });

  it("a lapsed permission renders the chrome (its card lives in the tree), prose held", async () => {
    makeProject({ grant: false });
    await waitFor(() =>
      expect(document.querySelector(".editor-shell")).toBeTruthy(),
    );
    const surface = document.querySelector(".editor-surface");
    expect(surface?.getAttribute("data-desk")).toBe("1");
    expect(document.querySelector(".ed-boot-standin")).toBeTruthy();
  });

  it("a refused folder renders the chrome, prose held behind the stand-in", async () => {
    // A project with a damaged structure file: the open settles at
    // "invalid" — the tree speaks, but there is no Desk to build.
    const fake = new FakeProvider();
    for (const [path, content] of Object.entries(DEFAULT_FILES))
      fake.files.set(path, content);
    seedProps(fake, PROPS);
    fake.files.set(STRUCTURE_FILE, "version: 1\nnot: [valid\n");
    const router = route(<EditorScreen provider={fake} projectKey="proj" />);
    // Same reason as the helper above: the bridge reads auth for the
    // titlebar's face, and production always has a provider over it.
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(document.querySelector(".editor-shell")).toBeTruthy(),
    );
    const surface = document.querySelector(".editor-surface");
    expect(surface?.getAttribute("data-desk")).toBe("1");
    expect(document.querySelector(".ed-boot-standin")).toBeTruthy();
  });
});

// ── The autosave timer on unmount ────────────────────────────────────────────

describe("audit findings", () => {
  it("— a pending autosave timer survives unmount and fires against a torn-down route", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { engine, saveActiveFile, view } = make({ autosave: true });
      act(() => engine.type("x")); // schedules the autosave timer
      view.unmount();
      act(() => {
        vi.advanceTimersByTime(settings.autosaveDelay * 1000);
      });
      // The unmount cleanup clears `autosaveRef`'s pending timer as well as
      // `settleRef`'s, so no `runSave()`, and no `saveActiveFile`, fires
      // against a torn-down route.
      expect(saveActiveFile).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── The controls keyed on the Assistant ──────────────────────────────────────
//
// The demo composes no Assistant (`demoAssistant.test.tsx` pins the bridge),
// and every way into one keys on its absence rather than on the route.
// Each row has its twin: the same control, with an Assistant, is
// there, so an absence cannot pass because the control was never drawn.

describe("the controls keyed on the Assistant", () => {
  const noteProvider = {
    listDir: async () => [
      {
        path: "/reference/notes--alpha.md",
        name: "notes--alpha.md",
        kind: "file" as const,
      },
      // A Reference document, for the Reference face's own toggle rows.
      {
        path: "/reference/world--economy.md",
        name: "world--economy.md",
        kind: "file" as const,
      },
    ],
    readFile: async () => "# note\n",
    exists: async () => true,
  } as never;

  /**
   * The workspace with the Assistant held in state, so a row can take it
   * away under a face that is already up — the one way the shell can meet
   * "ask" with nothing behind it.
   */
  function NavigationHost({ initial }: { initial: Assistant | null }) {
    const [assistant, setAssistant] = useState(initial);
    const [engine] = useState(() => {
      const made = new EditorEngine();
      made.open("Hello world");
      return made;
    });
    return (
      <>
        <button type="button" onClick={() => setAssistant(null)}>
          drop the assistant
        </button>
        <button
          type="button"
          onClick={() => setAssistant(initial ?? assistantTestStub())}
        >
          restore the assistant
        </button>
        <Workspace
          engine={engine}
          projectRef={projectRef}
          activeFile="section--hello.md"
          saveActiveFile={async () => true}
          settings={settings}
          dock={{ provider: noteProvider, assistant, onBarSource: vi.fn() }}
        />
      </>
    );
  }

  function renderNavigation(assistant: Assistant | null) {
    render(
      <RouterProvider router={route(<NavigationHost initial={assistant} />)} />,
    );
  }

  function paletteCells(): string[] {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, metaKey: false });
    const cells = [...document.querySelectorAll(".board-cell")].map(
      (cell) => cell.textContent ?? "",
    );
    fireEvent.keyDown(document.activeElement ?? window, { key: "Escape" });
    return cells;
  }

  function runPalette(label: string) {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, metaKey: false });
    const cell = [...document.querySelectorAll(".board-cell")].find((one) =>
      one.textContent?.includes(label),
    ) as HTMLElement | undefined;
    if (!cell) throw new Error(`The palette should offer ${label}`);
    act(() => {
      fireEvent.click(cell);
    });
  }

  const dockTab = (name: string) =>
    document
      .querySelector(".dock-head")
      ?.querySelector(`button[aria-label="${name}"]`) ?? null;

  it("the palette offers Ask with an Assistant", () => {
    renderNavigation(assistantTestStub());
    expect(paletteCells().some((c) => c.includes("toolbar.assistant"))).toBe(
      true,
    );
  });

  it("the palette offers no Ask without one, and keeps the other places", () => {
    renderNavigation(null);
    const cells = paletteCells();
    expect(cells.some((c) => c.includes("toolbar.assistant"))).toBe(false);
    expect(cells.some((c) => c.includes("dock.reference"))).toBe(true);
  });

  it("the dock carries the Ask tab with an Assistant", () => {
    renderNavigation(assistantTestStub());
    runPalette("dock.reference");
    expect(dockTab("dock.ask")).toBeTruthy();
    expect(dockTab("dock.reference")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("the dock carries three tabs without one, Reference pressed", () => {
    renderNavigation(null);
    runPalette("dock.reference");
    expect(dockTab("dock.ask")).toBeNull();
    for (const name of ["dock.reference", "dock.notes", "dock.snapshot"])
      expect(dockTab(name)).toBeTruthy();
    expect(dockTab("dock.reference")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  // The face is derived where it is read, never written back. An Ask face
  // whose Assistant goes away shows Reference, a pressed cell for the fitted
  // thumb to measure, and never the empty "unavailable" panel, while the dock
  // stays where the writer left it.
  it("an Ask face whose Assistant goes away shows Reference, pressed", () => {
    renderNavigation(assistantTestStub());
    fireEvent.click(screen.getByRole("button", { name: "toolbar.assistant" }));
    expect(dockTab("dock.ask")?.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByText("drop the assistant"));

    expect(document.querySelector(".ed-dock")?.getAttribute("data-open")).toBe(
      "1",
    );
    expect(dockTab("dock.ask")).toBeNull();
    expect(dockTab("dock.reference")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByText("dock.assistantUnavailable")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "toolbar.assistant" }),
    ).toBeNull();
  });

  // Never written back: the writer's choice of face outlives a moment with
  // no Assistant, so when it returns they are where they were.
  // An effect that "corrected" the state to Reference would evict them for
  // good.
  it("an Ask face comes back when its Assistant does", () => {
    renderNavigation(assistantTestStub());
    fireEvent.click(screen.getByRole("button", { name: "toolbar.assistant" }));
    fireEvent.click(screen.getByText("drop the assistant"));
    expect(dockTab("dock.reference")?.getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByText("restore the assistant"));

    expect(dockTab("dock.ask")?.getAttribute("aria-pressed")).toBe("true");
  });

  // The Reference face's toggle, gated in the Dock like the notes face's
  // below. `onBarSource` is wired in both rows.
  async function openWorldGroup() {
    runPalette("dock.reference");
    await waitFor(() =>
      expect(screen.getByText("reference.group.world")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("reference.group.world"));
    await waitFor(() =>
      expect(
        document.querySelector('.ref-card[data-open="1"] .ref-row'),
      ).toBeTruthy(),
    );
  }

  it("a Reference row carries the AI toggle with an Assistant", async () => {
    renderNavigation(assistantTestStub());
    await openWorldGroup();
    expect(document.querySelector(".ref-row-ai")).toBeTruthy();
  });

  it("a Reference row carries no AI toggle without one", async () => {
    renderNavigation(null);
    await openWorldGroup();
    expect(document.querySelector(".ref-row-ai")).toBeNull();
  });

  it("a note row carries the AI toggle, and the face its wider track, with an Assistant", async () => {
    renderNavigation(assistantTestStub());
    runPalette("dock.notes");
    await waitFor(() =>
      expect(document.querySelector(".ref-row-ai")).toBeTruthy(),
    );
    expect(
      document.querySelector(".notes-face")?.getAttribute("data-ai-toggle"),
    ).toBe("1");
  });

  it("a note row carries no AI toggle without one, and the face keeps the snapshot's track", async () => {
    // `onBarSource` is handed down: the gate is the Assistant, in the Dock,
    // so a shell that wires the callback cannot draw a toggle for nothing.
    renderNavigation(null);
    runPalette("dock.notes");
    await waitFor(() =>
      expect(document.querySelector(".notes-face .snap-row")).toBeTruthy(),
    );
    expect(document.querySelector(".ref-row-ai")).toBeNull();
    expect(
      document.querySelector(".notes-face")?.hasAttribute("data-ai-toggle"),
    ).toBe(false);
  });
});

// A lost Remote-only change whose file is open in a buffer that still holds
// it is not lost: the editor saves the buffer again, and forgets the loss for
// that path, before the writer has read a word about it.
describe("restoring a lost change from the open buffer", () => {
  afterEach(() => {
    restore.lost = new Set();
    restore.stale = false;
    restore.forgetLostAt.mockClear();
  });

  it("saves the open Section again and forgets its loss", async () => {
    restore.lost = new Set([filePath("section--hello.md")]);
    const { saveActiveFile } = make();
    await waitFor(() => expect(saveActiveFile).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(restore.forgetLostAt).toHaveBeenCalledWith(
        projectRef,
        filePath("section--hello.md"),
      ),
    );
  });

  it("restores nothing from a buffer that was read from the remote", async () => {
    // The buffer holds the remote's older text; re-saving it would clear the
    // notice over a real loss.
    restore.lost = new Set([filePath("section--hello.md")]);
    restore.stale = true;
    const { saveActiveFile } = make();
    await act(async () => {});
    expect(saveActiveFile).not.toHaveBeenCalled();
    expect(restore.forgetLostAt).not.toHaveBeenCalled();
  });

  it("leaves a loss on another file alone", async () => {
    restore.lost = new Set(["document/section--elsewhere.md"]);
    const { saveActiveFile } = make();
    await act(async () => {});
    expect(saveActiveFile).not.toHaveBeenCalled();
  });

  it("does not forget the loss when the save fails", async () => {
    restore.lost = new Set([filePath("section--hello.md")]);
    const { saveActiveFile } = make({ saveOk: false });
    await waitFor(() => expect(saveActiveFile).toHaveBeenCalled());
    await act(async () => {});
    expect(restore.forgetLostAt).not.toHaveBeenCalled();
  });
});
