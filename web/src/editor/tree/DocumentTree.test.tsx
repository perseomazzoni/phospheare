// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom

// The panel's suite exercises the tree over an open document, whose settings
// block (`ui.lastOpened: "EL2"` in the harness fixture) is the only preference
// in play — the toggles and the size picker bind to that same block.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { memoryProvider } from "../../storage/memoryProvider";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  ProjectProvider,
  useProjectActions,
  useProjectState,
} from "../ProjectContext";
import { ThemeProvider } from "../../theme/ThemeContext";
// Imported for its side effect: the panel's foot names the theme and cycles
// it, and a `ThemeProvider` over an empty registry has no theme to name.
// `theme/index` is where the three shipped themes register themselves, in the
// application and here alike.
import "../../theme";
import DocumentTree, { STRUCTURE_PANEL_ID } from "./DocumentTree";
import { MAX_PANEL_W, MIN_PANEL_W } from "../useNarrow";
import NameInput from "../components/NameInput";
import { EditorEngine } from "../views/engine";
import type { SaveState } from "../saveMark";
import type { ProjectRef, StorageProvider } from "../../storage";
import {
  FakeProvider,
  PROPS,
  STRUCTURE,
  DEFAULT_FILES,
  structureOf,
  propsOf,
  seedRecords,
  seedProps,
  seedFile,
} from "../project.fixture";
import { filePath, STRUCTURE_FILE } from "../../project/naming";
import { pathsTouched } from "../../project/sync/deviceWork";
import { childrenOf } from "../../project/structure";
import type { Assistant } from "../../ai";
import type { ChatTurn } from "../../ai/domain/types";
import { NO_WEB_CITATIONS, webCitations } from "../../ai/domain/webCitations";
import { assistantTestStub } from "../assistant/assistantStub.fixture";
import type { SearchArrival } from "../searchArrival";

vi.mock("react-i18next", () => ({
  // The preferences card's language row reads `i18n.language`, so the mock has
  // to name one, and a region tag ("en-GB", not "en"), because the row
  // splits it to match the picker's bare codes and a mock that never carried a
  // region could not catch that going wrong.
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-GB" },
  }),
}));
// `setLanguage` writes a profile-backed pref and swings i18next under the whole
// tree. What the row owes is the call; what i18next then does is i18next's.
// Replaced whole, not spread over the original: importing the real module
// registers a `currentUser` listener that calls `i18n.changeLanguage` against
// an i18next this suite never initialises, and `setCurrentUserId` in an
// unrelated test then dies inside it. `setLanguage` is the only member this
// component tree imports from it.
const setLanguageMock = vi.hoisted(() => vi.fn());
vi.mock("../../locales/i18n", () => ({ setLanguage: setLanguageMock }));

// ── Geometry ─────────────────────────────────────────────────────────────────
//
// The drag gesture measures rows through `getBoundingClientRect`, which jsdom
// answers with all zeros. The two containers and the rows are stubbed with
// real coordinates so a pointer position means something.

interface RowGeo {
  top: number;
  bottom: number;
}

function stubGeometry(rows: Record<string, RowGeo>): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (!(this instanceof HTMLElement)) return original.call(this);
    const el = this as HTMLElement;
    const box = (top: number, bottom: number) =>
      ({
        left: 0,
        top,
        right: 0,
        bottom,
        width: 0,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const wideBox = (top: number, bottom: number) =>
      ({
        left: 0,
        top,
        right: 200,
        bottom,
        width: 200,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    if (el.classList.contains("dt-scroll")) return box(-50, 250);
    if (el.classList.contains("dt-content")) return box(0, 200);
    if (el.classList.contains("dt-bin")) return wideBox(200, 260);
    if (el.classList.contains("dt-bin-row")) return wideBox(210, 240);
    const row = el.dataset.row;
    if (row && rows[row]) return box(rows[row].top, rows[row].bottom);
    return original.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/** Any ref: `FakeProvider` keys its files by path and ignores this. */
const FAKE_REF: ProjectRef = {
  providerId: "local",
  key: "demo-key",
  name: "Once Dark",
  openedAt: "2026-01-01T00:00:00.000Z",
};

const ROW_GEO = {
  EL1: { top: 0, bottom: 30 },
  EL2: { top: 30, bottom: 60 },
  EL3: { top: 60, bottom: 90 },
  EL4: { top: 90, bottom: 120 },
};

// ── Harness ──────────────────────────────────────────────────────────────────

interface MakeOptions {
  props?: string | null;
  structure?: string | null;
  files?: Record<string, string>;
  before?: (provider: FakeProvider) => void;
  rail?: boolean;
  /** Folded, but drawn wide by the mouse over the rail. */
  peek?: boolean;
  onPeek?: (on: boolean) => void;
  onToggleCollapse?: () => void;
  onOpenNotesTab?: () => void;
  onOpenReferenceTab?: () => void;
  onOpenReference?: (fileName: string) => void;
  onFindInText?: (file: string, query: string, at: number) => void;
  onEndFind?: () => void;
  onOpenChat?: () => void;
  save?: SaveState;
  pendingPaths?: ReadonlySet<string>;
  /** The phone plane's modal, rather than a column beside the prose. */
  sheet?: boolean;
  backTo?: string;
  backLabel?: string;
  /** The panel's width, and the two seams a drag of its grip reports to. */
  width?: number;
  onResize?: (width: number) => void;
  onResizeEnd?: (width: number) => void;
  /**
   * Open a file after the folder loads, like the writer resuming from the
   * Desk. Defaults to the fixture's own last-opened file; `null` lands on a
   * bare Desk (or an invalid fixture).
   */
  open?: string | null;
  /** The composed assistant, which is what lets a row offer its summary. */
  assistant?: Assistant | null;
  /** Where the surface last arrived: a search hit or assistant evidence. */
  arrival?: SearchArrival | null;
}

async function make({
  props = PROPS,
  structure = STRUCTURE,
  files = DEFAULT_FILES,
  before,
  rail = false,
  peek,
  onPeek,
  onToggleCollapse,
  onOpenNotesTab,
  onOpenReferenceTab,
  onOpenReference,
  onFindInText,
  onEndFind,
  onOpenChat,
  save = "clean",
  pendingPaths,
  sheet = false,
  backTo,
  backLabel,
  width,
  onResize,
  onResizeEnd,
  open = "section--opening.EL2.00.md",
  assistant,
  arrival,
}: MakeOptions = {}) {
  const provider = new FakeProvider();
  const ported: { current: StorageProvider | null } = { current: null };
  // The snapshot record lives in properties, so the fixture yaml's own
  // entries move there and the strict reconcile passes. The effective
  // structure is the one that lands on disk (a `files` override wins).
  const effectiveStructure = files[STRUCTURE_FILE] ?? structure;
  if (props !== null && effectiveStructure !== null) {
    seedRecords(provider, props, effectiveStructure);
  } else if (props !== null) {
    seedProps(provider, props);
  }
  if (effectiveStructure !== null)
    provider.files.set("/document-structure.yaml", effectiveStructure);
  for (const [path, content] of Object.entries(files))
    seedFile(provider, path, content);
  before?.(provider);

  const engine = new EditorEngine();
  // The foot names the theme and cycles it, so the panel needs a
  // `ThemeProvider` above it, as in the application. The `MemoryRouter` hosts
  // the invalid state's "Back to your projects" Link.
  const view = render(
    <MemoryRouter>
      <ThemeProvider>
        <ProjectProvider
          engine={engine}
          provider={provider}
          projectKey="demo-key"
        >
          <ResumeButton file={open ?? ""} />
          <PortProbe seen={ported} />
          <DocumentTree
            rail={rail}
            peek={peek}
            onPeek={onPeek}
            onToggleCollapse={onToggleCollapse}
            onOpenNotesTab={onOpenNotesTab}
            onOpenReferenceTab={onOpenReferenceTab}
            onOpenReference={onOpenReference}
            onFindInText={onFindInText}
            onEndFind={onEndFind}
            onOpenChat={onOpenChat}
            save={save}
            pendingPaths={pendingPaths}
            sheet={sheet}
            backTo={backTo}
            backLabel={backLabel}
            width={width}
            onResize={onResize}
            onResizeEnd={onResizeEnd}
            assistant={assistant}
            arrival={arrival}
          />
        </ProjectProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

  if (open) {
    try {
      // The first Part, not the project's name, which is the titlebar's
      // crumb: what says the folder has loaded is that the structure
      // is drawn.
      await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
      fireEvent.click(screen.getByTestId("test-resume"));
    } catch {
      // The fixture never reached "ready" (invalid) — nothing to resume.
    }
  }

  return { provider, ported, engine, view };
}

/**
 * The provider as the app above the port sees it.
 *
 * Not the `FakeProvider` the harness constructed: `ProjectProvider`
 * wraps that one so a write can be observed at the port, and the
 * dock, the reference reader and the notes panel all write through the wrapper
 * rather than the raw double. A test that wrote through the double would be
 * writing where nobody is listening, and would pin nothing.
 */
function PortProbe({ seen }: { seen: { current: StorageProvider | null } }) {
  seen.current = useProjectState().provider;
  return null;
}

/** Write through the port, which is where the panel is listening. */
async function writeThroughPort(
  ported: { current: StorageProvider | null },
  path: string,
  text: string,
) {
  const port = ported.current;
  if (!port) throw new Error("the port probe never rendered");
  await act(async () => {
    await port.writeFile(FAKE_REF, path, text);
  });
}

/**
 * The panel's own "still reading" status (`tree.findReading`), or null once
 * the sweep has landed. It is up from the render that starts a sweep until
 * every source has an entry for that sweep, so its absence means no read of
 * that sweep is still to be made. "Some `.md` was read" is not
 * that: the sweep reads six files at a time, and the rest can land later.
 */
const sweeping = () =>
  screen.queryByRole("status", { name: "tree.findReading" });

/** The writer's Desk resume, as a test button: a fresh open does not
 *  auto-restore. */
function ResumeButton({ file }: { file: string }) {
  const { openFile } = useProjectActions();
  return (
    <button
      data-testid="test-resume"
      onClick={() => void openFile(file)}
      aria-hidden
      tabIndex={-1}
    />
  );
}

// Rows are keyed by the node's id: `data-row` is an id, never a file name.
const row = (id: string) =>
  document.querySelector(`[data-row="${id}"]`) as HTMLElement;
/** The rows that stand for nodes, not the add labels or a landing. */
const nodeRows = () =>
  screen.getAllByRole("row").filter((el) => el.hasAttribute("data-row"));

/**
 * Which of the panel's two bodies is on screen.
 *
 * Both are mounted at all times: they slide past each other, and an element
 * that is not laid out cannot be animated. So the question is which one is
 * on, and `aria-hidden` holds that answer. jsdom applies no stylesheet, so
 * `visibility`, what the browser acts on, is invisible to this file, and the
 * two must never disagree.
 *
 * "nothing" is the state that should not exist: both hidden leaves a panel
 * with a find, a meta block, and no body between them.
 */
/**
 * The panel's find field.
 *
 * Role plus accessible name is the field's whole identity. The results face
 * carries no `tree.findLabel` landmark of its own, so a name query matches one
 * element and no call here falls back to the `.dt-find` class, which says
 * nothing about what the thing is.
 */
const findField = (): HTMLInputElement =>
  screen.getByRole("searchbox", { name: "tree.findLabel" }) as HTMLInputElement;

/** The head, which carries the find on its one line and the swap's boolean. */
const head = (): HTMLElement =>
  document.querySelector(".dt-head") as HTMLElement;

const panelBody = (): "tree" | "results" | "nothing" => {
  const on = (selector: string): boolean => {
    const el = document.querySelector(selector);
    return el !== null && el.getAttribute("aria-hidden") !== "true";
  };
  if (on(".dt-search")) return "results";
  return on(".dt-tree-body") ? "tree" : "nothing";
};

/**
 * Reach one of a row's actions.
 *
 * A row's actions sit behind one always-visible overflow rather than
 * hover-revealed icon buttons, because a phone has no hover. The labels are
 * words rather than glyph titles.
 */
function rowAction(id: string, item: string) {
  fireEvent.click(within(row(id)).getByLabelText("tree.actionsFor"));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => cleanup());

// ── States ───────────────────────────────────────────────────────────────────

describe("tree states", () => {
  it("renders the open document: parts, and the restored sections", async () => {
    // No root label: the project's name is the titlebar's crumb. The
    // head draws the shape, which the row below asserts.
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    expect(screen.getByText("Act Two")).toBeTruthy();
    expect(document.querySelector(".dt-spine")).toBeTruthy();
    // Expanded from the properties file, so Act One's sections are visible.
    expect(screen.getByText("Opening")).toBeTruthy();
    expect(screen.getByText("The Storm")).toBeTruthy();
    expect(nodeRows().length).toBe(4);
    // The last opened file is the current row.
    expect(row("EL2").getAttribute("aria-current")).toBe("true");
  });

  it("remembers a collapsed Part by its chevron state", async () => {
    await make({
      props: PROPS.replace('["EL1"]', '["EL2"]'),
    });
    // The row can render a beat before the restore effect lands, so wait for
    // the remembered shape rather than the row that simply exists.
    await waitFor(() => {
      expect(row("EL1").getAttribute("aria-expanded")).toBe("false");
      // The fixture's Act Two has no children: an empty Part is a toggle
      // like any other, so it is folded with the rest when it is not
      // remembered.
      expect(row("EL4").getAttribute("aria-expanded")).toBe("false");
    });
  });

  // An arrival, the assistant's evidence or a search hit, can open a Section
  // inside a Part the writer had folded, where a row marked active is seen by
  // nobody. The arrival unfolds its way and brings the row into view, without
  // taking focus and without rewriting the writer's saved shape.
  it("unfolds the Part an arrival lands in and brings its row into view", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const { provider } = await make({
        props: PROPS.replace('["EL1"]', '["EL2"]'),
        arrival: {
          kind: "evidence",
          file: "section--opening.EL2.00.md",
          query: "the gate",
        },
      });
      await waitFor(() =>
        expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
      );
      await waitFor(() => expect(scrolled).toContain(row("EL2")));
      expect(document.activeElement).not.toBe(row("EL2"));
      // Transient: the saved shape still has Act One folded.
      const saved = JSON.parse(
        provider.files.get("/document-properties.json") ?? "{}",
      );
      expect(saved.ui.expanded).not.toContain("EL1");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("shows the loading state while the provider is being asked", async () => {
    // The mount's first call is `canAccess`, a query, never a request,
    // so this is where the provider is made to wait. Stalling it holds the
    // panel before any read begins; stalling `listDir` then holds the strict
    // pipeline mid-checks.
    let resolveAccess!: () => void;
    let resolveList!: () => void;
    await make({
      before: (p) => {
        p.canAccess.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveAccess = () => resolve("granted");
            }),
        );
        p.listDir.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveList = () =>
                resolve(
                  Object.keys(DEFAULT_FILES).map((path) => {
                    const name = path.split("/").pop();
                    if (name === undefined)
                      throw new Error(
                        "Fixture path has no trailing segment to name",
                      );
                    return { path, name, kind: "file" as const };
                  }),
                );
            }),
        );
      },
    });
    await act(async () => {
      resolveAccess();
    });
    expect(screen.getByRole("status", { name: "tree.loading" })).toBeTruthy();
    await act(async () => {
      resolveList();
    });
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
  });

  it("shows an empty folder as invalid without a scaffold offer", async () => {
    const { provider } = await make({
      props: null,
      structure: null,
      files: {},
    });
    await waitFor(() =>
      expect(screen.getByText("tree.cannotOpen")).toBeTruthy(),
    );
    // An empty folder is not a project: the reason is writer-shaped, and the
    // only recovery is the exit — "Try again" would re-read identical bytes
    // and land the identical verdict.
    expect(screen.getByText("structure.notAProject")).toBeTruthy();
    expect(screen.queryByText("tree.tryAgain")).toBeNull();
    const back = screen.getByRole("link", {
      name: "titlebar.backToLibrary",
    });
    expect(back.getAttribute("href")).toBe("/app");
    // Creation belongs to the Library: there is no in-place scaffold button,
    // and no files appear while the state stands.
    expect(screen.queryByText("tree.createHere")).toBeNull();
    expect(provider.files.has("/document-structure.yaml")).toBe(false);
  });

  it("lists the problems of a refused folder and try-again re-reads it", async () => {
    // Two entries claiming the same id — both otherwise valid, so the one and
    // only problem is the duplicate.
    const { provider } = await make({
      structure:
        'version: 1\ndocument:\n  - id: EL1\n    part: "A"\n    adopted: part--a.EL1.00.md\n    snapshots:\n      - file: part--a.EL1.00.md\n        title: "A 1"\n        created: "2026-01-01T00:00:00.000Z"\n    children: []\n  - id: EL1\n    part: "B"\n    adopted: part--b.EL1.00.md\n    snapshots:\n      - file: part--b.EL1.00.md\n        title: "B 1"\n        created: "2026-01-01T00:00:00.000Z"\n    children: []\n',
      files: {},
    });
    await waitFor(() =>
      expect(screen.getByText("tree.cannotOpen")).toBeTruthy(),
    );
    expect(screen.getByText("structure.duplicateId")).toBeTruthy();
    provider.files.set("/document-structure.yaml", STRUCTURE);
    for (const [path, content] of Object.entries(DEFAULT_FILES))
      provider.files.set(path, content);
    fireEvent.click(screen.getByText("tree.tryAgain"));
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
  });

  it("shows the reconnect affordance when permission is pending, and reconnects from a click", async () => {
    const { provider } = await make({ before: (p) => (p.grant = false) });
    await waitFor(() =>
      expect(screen.getByText("tree.reconnectHint")).toBeTruthy(),
    );
    provider.grant = true;
    fireEvent.click(screen.getByText("tree.reconnect"));
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
  });

  it("says the browser cannot host the panel at all when unsupported", async () => {
    await make({ before: (p) => (p.available = false) });
    expect(screen.getByText("tree.unsupportedTitle")).toBeTruthy();
  });

  it("shows the empty-document note when the yaml has no nodes", async () => {
    await make({
      structure: "version: 1\ndocument: []\n",
      props: PROPS.replace('["EL1"]', "[]").replace(
        '"lastOpened": "EL2"',
        '"lastOpened": null',
      ),
      files: {},
      before: (p) => p.emptyDirs.add("/document"),
    });
    await waitFor(() =>
      expect(screen.getByText("tree.emptyDocument")).toBeTruthy(),
    );
  });
});

// ── Expansion ────────────────────────────────────────────────────────────────

describe("expansion", () => {
  // The restore effect's render is slow under coverage instrumentation, not
  // wrong, so the per-test budget (60s) sits above the waits' own 30s
  // deadline; a budget equal to the wait's deadline would kill the row at its
  // own timeout.
  it("— a chevron click opens a Part and persists the shape", async () => {
    const { provider } = await make({
      props: PROPS.replace('["EL1"]', '["EL2"]'),
    });
    await waitFor(() => expect(row("EL1")).toBeTruthy(), {
      timeout: 30000,
    });
    expect(row("EL1").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(within(row("EL1")).getByLabelText("tree.expand"));
    await waitFor(
      () => expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
      { timeout: 30000 },
    );
    await waitFor(
      () => {
        const ui = propsOf(provider).ui as { expanded: string[] };
        expect(ui.expanded).toContain("EL1");
      },
      { timeout: 30000 },
    );
  }, 60000);

  // An empty Part is a toggle like any other: it carries the chevron
  // and aria-expanded, and folding it hides its labels. The fixture's Act Two
  // is not remembered as expanded, so it starts folded.
  it("an empty Part is a toggle", async () => {
    await make();
    await waitFor(() => expect(row("EL4")).toBeTruthy());
    expect(within(row("EL4")).getByLabelText("tree.expand")).toBeTruthy();
    expect(row("EL4").getAttribute("aria-expanded")).toBe("false");
    expect(
      within(row("EL1")).queryByLabelText(/tree\.(expand|collapse)/),
    ).toBeTruthy();
  });
});

// ── Opening one file ─────────────────────────────────────────────────────────

describe("opening one file", () => {
  it("clicking a row title opens that file in the engine", async () => {
    const { engine } = await make();
    await waitFor(() => expect(screen.getByText("The Storm")).toBeTruthy());
    fireEvent.click(screen.getByText("The Storm"));
    await waitFor(() =>
      expect(engine.commonmark).toContain("It came in from the west"),
    );
    expect(row("EL3").getAttribute("aria-current")).toBe("true");
  });
});

// ── The keyboard ─────────────────────────────────────────────────────────────

describe("the keyboard", () => {
  const press = (key: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document.activeElement as Element, { key, ...init });
  /** The grid's elements Tab stops on. */
  const stops = () =>
    [
      ...screen
        .getByRole("treegrid")
        .querySelectorAll<HTMLElement>("button, input, [tabindex]"),
    ].filter((el) => el.tabIndex >= 0);

  it("gives the panel one tab stop, on the open Section, which follows focus", async () => {
    await make();
    await waitFor(() => expect(stops()).toEqual([row("EL2")]));
    const storm = within(row("EL3")).getByText("The Storm");
    storm.focus();
    expect(stops()).toEqual([storm]);
  });

  it("walks the rows with Up and Down, and folds and climbs with Left and Right", async () => {
    await make();
    await waitFor(() => expect(stops()).toEqual([row("EL2")]));
    row("EL2").focus();
    press("ArrowDown");
    expect(document.activeElement).toBe(row("EL3"));
    press("ArrowUp");
    expect(document.activeElement).toBe(row("EL2"));
    // Out to the Part, which Left then folds, and Right opens again.
    press("ArrowLeft");
    expect(document.activeElement).toBe(row("EL1"));
    press("ArrowLeft");
    await waitFor(() =>
      expect(row("EL1").getAttribute("aria-expanded")).toBe("false"),
    );
    press("ArrowRight");
    await waitFor(() =>
      expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
    );
    // Right on an open row steps into its controls, the first being the
    // chevron; Left steps back out.
    press("ArrowRight");
    expect(document.activeElement).toBe(
      within(row("EL1")).getByLabelText("tree.collapse"),
    );
    press("ArrowLeft");
    expect(document.activeElement).toBe(row("EL1"));
  });

  it("opens a row's file with Enter", async () => {
    const { engine } = await make();
    await waitFor(() => expect(stops()).toEqual([row("EL2")]));
    row("EL3").focus();
    press("Enter");
    await waitFor(() =>
      expect(engine.commonmark).toContain("It came in from the west"),
    );
    expect(row("EL3").getAttribute("aria-current")).toBe("true");
  });

  it("renames with F2, and leaves the field's keys to the field", async () => {
    await make();
    await waitFor(() => expect(stops()).toEqual([row("EL2")]));
    row("EL3").focus();
    press("F2");
    const field = (await screen.findByDisplayValue(
      "The Storm",
    )) as HTMLInputElement;
    field.focus();
    press("ArrowUp");
    press("Home");
    expect(document.activeElement).toBe(field);
  });

  it("opens the row's actions with Shift+F10", async () => {
    await make();
    await waitFor(() => expect(stops()).toEqual([row("EL2")]));
    row("EL3").focus();
    press("F10", { shiftKey: true });
    const item = await screen.findByRole("menuitem", { name: "tree.rename" });
    // The browser's own menu, which the key raises after it, where focus is
    // by then, stays shut; a right-click later keeps it.
    expect(fireEvent.contextMenu(item)).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(fireEvent.contextMenu(document.body)).toBe(true);
  });
});

// ── Adding, renaming, removing ───────────────────────────────────────────────

describe("adding", () => {
  it("a root add names the field directly from the label, and commits it", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    // The root's own labels are the `.dt-add-row` children of the tree body —
    // distinct from the rows inside the Parts' branches. A populated root
    // holds Parts, so the one legal kind is the Part.
    const rootRow = [
      ...(document.querySelector(".dt-content") as HTMLElement).children,
    ].find((el) => el.classList.contains("dt-add-row")) as HTMLElement;
    expect(rootRow).toBeTruthy();
    fireEvent.click(
      within(rootRow).getByRole("button", { name: "tree.addPart" }),
    );
    const input = await screen.findByLabelText("tree.partName");
    fireEvent.change(input, { target: { value: "Interlude" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Interlude")).toBeTruthy());
    expect(provider.files.has(filePath("part--interlude.EL5.00.md"))).toBe(
      true,
    );
    expect(screen.getByText("toast.added")).toBeTruthy();
  });

  // The labels under the children name their kind, so the naming field
  // opens directly. An empty Part offers both, Section first.
  it("offers + Section and + Part under an empty Part, and either commits", async () => {
    const { provider } = await make({
      // Act Two is an empty Part; remembered as expanded so its labels show.
      props: PROPS.replace('["EL1"]', '["EL1", "EL4"]'),
    });
    await waitFor(() => expect(screen.getByText("Act Two")).toBeTruthy());
    // Scoped to the Part's branch: the labels sit in `.dt-children`, which is
    // a sibling of the row, not a child of it.
    const branch = row("EL4").parentElement as HTMLElement;
    const labels = [...branch.querySelectorAll(".dt-add")]
      .map((el) => el.textContent)
      .filter((text) => text !== null);
    expect(labels).toEqual(["name.kindSection", "name.kindPart"]);
    fireEvent.click(
      within(branch).getByRole("button", { name: "tree.addPart" }),
    );
    const input = await screen.findByLabelText("tree.partName");
    fireEvent.change(input, { target: { value: "Interlude" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const structure = structureOf(provider);
      expect(
        childrenOf(structure, "EL4").some((c) => c.title === "Interlude"),
      ).toBe(true);
    });
  });

  // The Golden Rule again: a Part that already holds Sections can hold nothing
  // else, so its labels name only the one kind — the labels stay, because the
  // writer can keep adding, but they never offer what the container refuses.
  it("offers only the legal kind under a populated Part", async () => {
    await make({
      // Act Two (empty) remembered as expanded so its labels show.
      props: PROPS.replace('["EL1"]', '["EL1", "EL4"]'),
    });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const labels = (id: string) =>
      [...(row(id).parentElement as HTMLElement).querySelectorAll(".dt-add")]
        .map((el) => el.textContent)
        .filter((text) => text !== null);
    // Act One holds Sections; Act Two is empty.
    expect(labels("EL1")).toEqual(["name.kindSection"]);
    expect(labels("EL4")).toEqual(["name.kindSection", "name.kindPart"]);
  });

  // Act Two nested, empty, inside Act One — shared by the rows below.
  const makeNested = () =>
    make({
      structure: `version: 1
document:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
    snapshots:
      - file: part--act_one.EL1.00.md
        title: "Act One 1"
        created: "2026-01-01T00:00:00.000Z"
    children:
      - id: EL4
        part: "Act Two"
        adopted: part--act_two.EL4.00.md
        snapshots:
          - file: part--act_two.EL4.00.md
            title: "Act Two 1"
            created: "2026-01-01T00:00:00.000Z"
        children: []
`,
      props: PROPS.replace('["EL1"]', "[]").replace(
        '"lastOpened": "EL2"',
        '"lastOpened": null',
      ),
      // The structure names two adopted files; validation refuses a node
      // whose file is missing, so both must exist on the fake disk.
      files: {
        [filePath("part--act_one.EL1.00.md")]: "",
        [filePath("part--act_two.EL4.00.md")]: "",
      },
      open: null,
    });

  // A Part nested inside a Part is not auto-expanded (only the top level is),
  // so a nested empty Part starts folded — an ordinary toggle like any other.
  // The chevron is the route to its labels.
  it("a nested empty Part starts folded, and its chevron reveals the labels", async () => {
    await makeNested();
    await waitFor(() => expect(screen.getByText("Act Two")).toBeTruthy());
    // Folded: a real toggle waiting, and the box closed — jsdom applies no
    // stylesheet, so the box being closed is the class, not the visibility.
    expect(row("EL4").getAttribute("aria-expanded")).toBe("false");
    expect(within(row("EL4")).getByLabelText("tree.expand")).toBeTruthy();
    // The keyboard reaches the folded labels from the row: Right opens it
    // and Left folds it again.
    fireEvent.keyDown(row("EL4"), { key: "ArrowRight" });
    await waitFor(() =>
      expect(row("EL4").getAttribute("aria-expanded")).toBe("true"),
    );
    fireEvent.keyDown(row("EL4"), { key: "ArrowLeft" });
    await waitFor(() =>
      expect(row("EL4").getAttribute("aria-expanded")).toBe("false"),
    );
    const box = row("EL4").parentElement?.querySelector(
      ".dt-children",
    ) as HTMLElement;
    expect(box.classList.contains("open")).toBe(false);
    expect(box.querySelectorAll(".dt-add").length).toBe(2);
    fireEvent.click(within(row("EL4")).getByLabelText("tree.expand"));
    // No widened deadline: the fold is not slow, and a late restore undoing
    // the click is the race the next row pins.
    await waitFor(() =>
      expect(row("EL4").getAttribute("aria-expanded")).toBe("true"),
    );
    expect(box.classList.contains("open")).toBe(true);
    const labels = [
      ...(row("EL4").parentElement as HTMLElement).querySelectorAll(".dt-add"),
    ].map((el) => el.textContent);
    expect(labels).toEqual(["name.kindSection", "name.kindPart"]);
  });

  // The shape the writer left is restored as the tree is drawn, not a beat
  // later. In a passive effect the rows would be on screen
  // before the restore ran, a click in that gap would build its set from the
  // unrestored one, and whichever landed last would win. A MutationObserver
  // callback runs in the microtask after the commit that drew the rows,
  // before a passive effect can run, so it clicks inside that gap every time
  // rather than only when the machine is slow.
  it("a chevron clicked the moment the tree is drawn keeps the restored shape", async () => {
    let clicked = false;
    const observer = new MutationObserver(() => {
      const chevron = row("EL4")?.querySelector(".dt-chevron");
      if (clicked || !chevron) return;
      clicked = true;
      fireEvent.click(chevron);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      const { provider } = await makeNested();
      await waitFor(() => expect(clicked).toBe(true));
      await waitFor(() =>
        expect(row("EL4").getAttribute("aria-expanded")).toBe("true"),
      );
      expect(row("EL1").getAttribute("aria-expanded")).toBe("true");
      await waitFor(() => {
        const saved = JSON.parse(
          provider.files.get("/document-properties.json") ?? "{}",
        );
        expect([...saved.ui.expanded].sort()).toEqual(["EL1", "EL4"]);
      });
    } finally {
      observer.disconnect();
    }
  });

  // Folding a Part folds its labels with it — they live inside the box — and
  // opening it brings them back. An empty Part folds the same way.
  it("folds the labels with the Part, and a press while open commits", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const labelsOf = (id: string) =>
      [...(row(id).parentElement as HTMLElement).querySelectorAll(".dt-add")]
        .map((el) => el.textContent)
        .filter((text) => text !== null);
    // Open, so the labels are there.
    expect(labelsOf("EL1")).toEqual(["name.kindSection"]);
    fireEvent.click(within(row("EL1")).getByLabelText("tree.collapse"));
    await waitFor(() =>
      expect(row("EL1").getAttribute("aria-expanded")).toBe("false"),
    );
    // Folded: the labels went inside the fold with the children — jsdom
    // applies no stylesheet, so the box being closed is the class, not the
    // visibility.
    const box = row("EL1").parentElement?.querySelector(
      ".dt-children",
    ) as HTMLElement;
    expect(box.classList.contains("open")).toBe(false);
    expect(box.querySelectorAll(".dt-add").length).toBe(1);
    expect(
      box.contains(
        [...box.querySelectorAll(".dt-add")].find(
          (el) => el.getAttribute("aria-label") === "tree.addSection",
        ) as Element,
      ),
    ).toBe(true);
    fireEvent.click(within(row("EL1")).getByLabelText("tree.expand"));
    await waitFor(() =>
      expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
    );
    expect(labelsOf("EL1")).toEqual(["name.kindSection"]);
    fireEvent.click(
      within(row("EL1").parentElement as HTMLElement).getByRole("button", {
        name: "tree.addSection",
      }),
    );
    const input = await screen.findByLabelText("tree.sectionName");
    fireEvent.change(input, { target: { value: "New Chapter" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("New Chapter")).toBeTruthy());
    expect(
      childrenOf(structureOf(provider), "EL1").some(
        (c) => c.title === "New Chapter",
      ),
    ).toBe(true);
  });

  // An empty Part is a toggle like any other: folding hides its labels inside
  // the box, and the choice persists.
  it("folds an empty Part's labels with it, and remembers the fold", async () => {
    const { provider } = await make({
      // Act Two remembered as expanded, so the fold below is a real choice.
      props: PROPS.replace('["EL1"]', '["EL1", "EL4"]'),
    });
    await waitFor(() => expect(screen.getByText("Act Two")).toBeTruthy());
    const labelsOf = (id: string) =>
      [...(row(id).parentElement as HTMLElement).querySelectorAll(".dt-add")]
        .map((el) => el.textContent)
        .filter((text) => text !== null);
    expect(row("EL4").getAttribute("aria-expanded")).toBe("true");
    expect(labelsOf("EL4")).toEqual(["name.kindSection", "name.kindPart"]);
    fireEvent.click(within(row("EL4")).getByLabelText("tree.collapse"));
    await waitFor(() =>
      expect(row("EL4").getAttribute("aria-expanded")).toBe("false"),
    );
    // Folded: the labels sit inside the closed box — the class, not the
    // visibility, is what jsdom can see.
    const box = row("EL4").parentElement?.querySelector(
      ".dt-children",
    ) as HTMLElement;
    expect(box.classList.contains("open")).toBe(false);
    expect(box.querySelectorAll(".dt-add").length).toBe(2);
    // The fold is a preference: the properties drop Act Two.
    // Read fresh each poll — a captured object would pin the pre-write state.
    const expandedOf = () =>
      (propsOf(provider).ui as { expanded: string[] }).expanded;
    await waitFor(() => expect(expandedOf()).toEqual(["EL1"]));
    fireEvent.click(within(row("EL4")).getByLabelText("tree.expand"));
    await waitFor(() =>
      expect(row("EL4").getAttribute("aria-expanded")).toBe("true"),
    );
    expect(box.classList.contains("open")).toBe(true);
    expect(labelsOf("EL4")).toEqual(["name.kindSection", "name.kindPart"]);
    await waitFor(() => expect(expandedOf()).toContain("EL4"));
  });

  it("keeps the empty project's message and puts + Part before + Section", async () => {
    const { provider } = await make({
      structure: "version: 1\ndocument: []\n",
      props: PROPS.replace('["EL1"]', "[]").replace(
        '"lastOpened": "EL2"',
        '"lastOpened": null',
      ),
      files: {},
      before: (p) => p.emptyDirs.add("/document"),
    });
    await waitFor(() =>
      expect(screen.getByText("tree.emptyDocument")).toBeTruthy(),
    );
    // A brand-new project reaches for its shape first: Part leads, where
    // every other container offers Section first.
    const labels = [...document.querySelectorAll(".dt-add")]
      .map((el) => el.textContent)
      .filter((text) => text !== null);
    expect(labels).toEqual(["name.kindPart", "name.kindSection"]);
    fireEvent.click(screen.getByRole("button", { name: "tree.addSection" }));
    const input = await screen.findByLabelText("tree.sectionName");
    fireEvent.change(input, { target: { value: "First Words" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const structure = structureOf(provider);
      expect(structure.children.some((c) => c.title === "First Words")).toBe(
        true,
      );
    });
  });
});

describe("renaming", () => {
  it("F2 opens the prefilled field and Enter renames", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.keyDown(screen.getByText("Opening"), { key: "F2" });
    const input = await screen.findByLabelText("tree.sectionName");
    expect((input as HTMLInputElement).value).toBe("Opening");
    fireEvent.change(input, { target: { value: "Dawn" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Dawn")).toBeTruthy());
    expect(provider.files.has(filePath("section--dawn.EL2.00.md"))).toBe(true);
    expect(screen.getByText("toast.renamed")).toBeTruthy();
  });
});

describe("removing", () => {
  it("asks before a lone node too, and confirming removes it", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    rowAction("EL2", "tree.remove");
    const dialog = await screen.findByRole("alertdialog");
    // A lone Section's title names the kind — a leaf has no inside-fact to
    // state, and "There's nothing inside it" would read as "no text". The
    // body still names the Recycle bin. Every removal asks, whatever it holds.
    expect(dialog.textContent).toContain("tree.removeConfirmTitleSection");
    expect(dialog.textContent).toContain("tree.removeConfirmBody");
    fireEvent.click(screen.getByRole("button", { name: "bin.moveTo" }));
    await waitFor(() => expect(row("EL2")).toBeNull());
    expect(screen.getByText("toast.removed")).toBeTruthy();
    // Gone from the tree, and into the bin — its title lives on there.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".dt-bin-row")].map((r) => r.textContent),
      ).toEqual(["Opening"]),
    );
  });

  // The emptiness reassurance belongs to an empty Part — a container that
  // happens to be empty — never to a Section, which is a leaf by structure.
  it("asks for an empty Part with the emptiness reassurance", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Act Two")).toBeTruthy());
    rowAction("EL4", "tree.remove");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("tree.removeConfirmTitleEmpty");
    fireEvent.click(screen.getByRole("button", { name: "bin.moveTo" }));
    await waitFor(() => expect(row("EL4")).toBeNull());
  });

  // The count behind "items inside it" is rows, not files: a Part whose own
  // history holds a second snapshot (two files, one row) is still empty to
  // the writer.
  it("does not count its own snapshots as items inside an empty Part", async () => {
    const propsWithTwoVersions = PROPS.replace(
      '"EL4": [{ "file": "part--act_two.EL4.00.md", "title": "Act Two 1", "created": "2026-01-01T00:00:00.000Z" }]',
      '"EL4": [{ "file": "part--act_two.EL4.00.md", "title": "Act Two 1", "created": "2026-01-01T00:00:00.000Z" }, { "file": "part--act_two.EL4.01.md", "title": "Act Two 2", "created": "2026-01-02T00:00:00.000Z" }]',
    );
    await make({
      structure: `version: 1
document:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
    children:
      - id: EL4
        part: "Act Two"
        adopted: part--act_two.EL4.00.md
        children: []
`,
      props: propsWithTwoVersions
        .replace('["EL1"]', "[]")
        .replace('"lastOpened": "EL2"', '"lastOpened": null'),
      // Both snapshot files must exist on disk or validation refuses the open.
      files: {
        [filePath("part--act_one.EL1.00.md")]: "",
        [filePath("part--act_two.EL4.00.md")]: "",
        [filePath("part--act_two.EL4.01.md")]: "",
      },
      open: null,
    });
    await waitFor(() => expect(screen.getByText("Act Two")).toBeTruthy());
    rowAction("EL4", "tree.remove");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("tree.removeConfirmTitleEmpty");
  });

  it("removing a populated Part asks first, and confirming removes it", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    rowAction("EL1", "tree.remove");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("tree.removeConfirmTitle");
    // The body names the Recycle bin — the one place nothing gets deleted.
    expect(dialog.textContent).toContain("tree.removeConfirmBody");
    fireEvent.click(screen.getByRole("button", { name: "bin.moveTo" }));
    await waitFor(() => expect(row("EL1")).toBeNull());
    expect(screen.getByText("toast.removed")).toBeTruthy();
    // The whole subtree sits in the bin as one flat row.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".dt-bin-row")].map((r) => r.textContent),
      ).toEqual(["Act One"]),
    );
  });

  it("undo brings a removed node back", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    rowAction("EL2", "tree.remove");
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "bin.moveTo" }));
    await waitFor(() => expect(row("EL2")).toBeNull());
    fireEvent.click(screen.getByText("toast.undo"));
    await waitFor(() => expect(row("EL2")).toBeTruthy());
    await waitFor(() =>
      expect(document.querySelector(".dt-bin-row")).toBeNull(),
    );
    expect(structureOf(provider).children.some((c) => c.id === "EL1")).toBe(
      true,
    );
  });
});

// ── The head ─────────────────────────────────────────────────────────────────
//
// The head carries no Reload: the panel writes the structure the moment it
// changes and the editor autosaves, so a reload could only cost the writer
// their unsaved buffer to re-read a file nothing else had written.

describe("the head", () => {
  it("does not carry the project's name at all", async () => {
    // The titlebar's crumb carries the name and the route to the Desk, in the
    // line the writer already reads to know where they are, and
    // `EditorRoute.test.tsx` pins the route there. One name, in one
    // place: this row catches a second copy in this head.
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    expect(screen.queryByText("Once Dark")).toBeNull();
    expect(document.querySelector(".dt-project")).toBeNull();
    // The shape stays. It says something the crumb cannot. The word names
    // the region under it.
    expect(document.querySelector(".dt-root .dt-spine")).toBeTruthy();
    expect(
      document.querySelector(".dt-region-head .dt-region-label")?.textContent,
    ).toBe("tree.contents");
  });

  // The panel does not decide its own width. Three things can put it at 52px —
  // the dock, a short window, the writer — and only the shell knows about all
  // three, so the caret reports the ask upward and reads the answer back.
  it("asks the shell to fold the panel, and follows the answer", async () => {
    const onToggleCollapse = vi.fn();
    const { view } = await make({ onToggleCollapse });
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    const caret = screen.getByLabelText("tree.collapsePanel");
    expect(caret.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(caret);
    expect(onToggleCollapse).toHaveBeenCalled();

    view.rerender(
      <MemoryRouter>
        <ThemeProvider>
          <ProjectProvider
            engine={new EditorEngine()}
            provider={new FakeProvider()}
            projectKey="demo-key"
          >
            <DocumentTree rail />
          </ProjectProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("tree.expandPanel")).toBeTruthy(),
    );
  });

  // A theme is chosen in Settings; the foot only flips the one in use between
  // once dark and still dark, and never leaves it.
  it("flips the theme in use between its variants from the foot, naming the one it is on", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    const control = screen.getByLabelText("settings.themeVariant");
    // Nothing is painted until the first choice (`main.tsx` paints in the
    // app), so the theme is read off the page after it.
    const painted = () => document.documentElement.dataset.theme ?? "";
    const first = control.textContent;
    fireEvent.click(control);
    await waitFor(() => expect(control.textContent).not.toBe(first));
    const flipped = painted();
    fireEvent.click(control);
    await waitFor(() => expect(control.textContent).toBe(first));
    expect(painted()).not.toBe(flipped);
    expect(painted().split("-")[0]).toBe(flipped.split("-")[0]);
  });

  // The numbers in the head, on the rail and beside each Part are one fact.
  it("numbers the Parts, and every Section by its place in the book", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    const indices = [...document.querySelectorAll(".dt-idx")].map(
      (n) => n.textContent,
    );
    // Act One (1) open on its two Sections (1, 2); Act Two (2) folded.
    expect(indices).toEqual(["01", "01", "02", "02"]);
  });

  it("the demo provider's foot states that nothing is saved", async () => {
    await make({
      before: (p) => {
        // Identification for the hint, not dispatch: the foot names the
        // in-memory fixture so the writer knows a reload discards edits.
        (p as unknown as { id: string }).id = memoryProvider.id;
      },
    });
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    expect(screen.getByText("storage.demoIsMemory")).toBeTruthy();
  });

  it("a real provider's foot carries no demo hint", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    expect(screen.queryByText("storage.demoIsMemory")).toBeNull();
  });
});

// ── The rail ─────────────────────────────────────────────────────────────────
//
// A different view, not the wide one squeezed. A tree at 52px is a column of
// identical page glyphs; numbers say which Part the writer is in, and the
// Reference button says the reference is still there.

describe("the rail", () => {
  it("numbers the Parts and marks the one holding the open file", async () => {
    await make({ rail: true });
    await waitFor(() =>
      expect(document.querySelector(".dt-rail")).toBeTruthy(),
    );
    const buttons = [...document.querySelectorAll(".dt-rail button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["01", "02"]);
    // The suite opens on a Section inside Act One, so the first Part is current
    // even though the Section itself has no button of its own here.
    expect(buttons[0].getAttribute("aria-current")).toBe("true");
    expect(buttons[1].getAttribute("aria-current")).toBeNull();
  });

  it("widens the panel again from a Part", async () => {
    const onToggleCollapse = vi.fn();
    await make({ rail: true, onToggleCollapse });
    await waitFor(() =>
      expect(document.querySelector(".dt-rail")).toBeTruthy(),
    );
    const buttons = [
      ...document.querySelectorAll(".dt-rail button"),
    ] as HTMLElement[];
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onToggleCollapse).toHaveBeenCalledTimes(2);
  });

  // The project search outlives the fold, and the wide face it left is the
  // results. The rail says so: the magnifier where the Parts were, so a hover
  // or a widen is not a promise of the structure.
  it("shows the search's magnifier instead of the Parts while the find is open", async () => {
    const onToggleCollapse = vi.fn();
    await make({ rail: true, onToggleCollapse });
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    expect(document.querySelector(".dt-rail-find")).toBeNull();

    fireEvent.change(screen.getByLabelText("tree.findLabel"), {
      target: { value: "storm" },
    });
    const rail = document.querySelector(".dt-rail") as HTMLElement;
    const find = rail.querySelector(".dt-rail-find") as HTMLElement;
    expect(find).toBeTruthy();
    expect(find.getAttribute("title")).toBe("tree.findLabel");
    // Nothing else: the Part numbers are gone, the rule under them stays.
    expect(rail.querySelectorAll("button")).toHaveLength(1);
    expect(rail.querySelector("hr")).toBeTruthy();

    // Pressing it widens the panel onto the search.
    fireEvent.click(find);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);

    // And the Parts come back with the tree.
    fireEvent.change(screen.getByLabelText("tree.findLabel"), {
      target: { value: "" },
    });
    fireEvent.blur(screen.getByLabelText("tree.findLabel"));
    await waitFor(() =>
      expect(document.querySelector(".dt-rail-find")).toBeNull(),
    );
    expect(document.querySelectorAll(".dt-rail button").length).toBeGreaterThan(
      1,
    );
  });

  // An open but empty find is still the search face, so it is the magnifier
  // too.
  it("shows the magnifier for an open, empty find", async () => {
    await make({ rail: true });
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    fireEvent.focus(screen.getByLabelText("tree.findLabel"));
    expect(document.querySelector(".dt-rail-find")).toBeTruthy();
  });

  // The gear in the foot survives the rail, so a writer who folded the panel
  // can still reach the settings. The settings card is its own floating
  // surface over the prose, so opening it must not widen the structure panel:
  // the two panels are independent. It renders as a sibling of the panel
  // (outside the clipped aside), not a descendant of it.
  it("opens the settings from the foot while railed, without widening the panel", async () => {
    const onToggleCollapse = vi.fn();
    await make({ rail: true, onToggleCollapse });
    await waitFor(() =>
      expect(document.querySelector(".dt-rail")).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "tree.writingPreferences" }),
    );
    expect(onToggleCollapse).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        document.querySelector(".dt-prefs")?.getAttribute("data-open"),
      ).toBe("1"),
    );
    // The card escaped the clipped panel: it is a sibling of the aside, not a
    // child of it, so the panel's `overflow: hidden` cannot cut it.
    expect(
      document
        .querySelector(".doc-tree")
        ?.contains(document.querySelector(".dt-prefs")),
    ).toBe(false);
  });
});

// ── The peek ─────────────────────────────────────────────────────────────────
//
// A mouse entering the folded rail opens the whole panel floating over the
// prose, and leaving the panel folds it back. The shell owns the state (it
// holds the layout the peek must not move); the panel reports the pointer.

describe("the peek", () => {
  const rail = () => document.querySelector(".dt-rail") as HTMLElement;
  const panel = () => document.querySelector(".doc-tree") as HTMLElement;
  const collapse = () => document.querySelector(".dt-collapse") as HTMLElement;

  async function folded(over: Partial<MakeOptions> = {}) {
    const onPeek = vi.fn();
    await make({ rail: true, onPeek, ...over });
    await waitFor(() => expect(rail()).toBeTruthy());
    return onPeek;
  }

  it("opens when a mouse enters the rail", async () => {
    const onPeek = await folded();
    fireEvent.pointerEnter(rail(), { pointerType: "mouse" });
    expect(onPeek).toHaveBeenCalledWith(true);
  });

  // A finger has no hover to leave with: a peek a tap opened could not end.
  it("does not open for a touch or a pen", async () => {
    const onPeek = await folded();
    fireEvent.pointerEnter(rail(), { pointerType: "touch" });
    fireEvent.pointerEnter(rail(), { pointerType: "pen" });
    expect(onPeek).not.toHaveBeenCalled();
  });

  it("does not open from a panel that is not folded", async () => {
    const onPeek = vi.fn();
    await make({ onPeek });
    await waitFor(() => expect(rail()).toBeTruthy());
    fireEvent.pointerEnter(rail(), { pointerType: "mouse" });
    expect(onPeek).not.toHaveBeenCalled();
  });

  // The foot and the buttons share the folded column but are not the way in.
  it("opens from the rail only, not from the rest of the folded panel", async () => {
    const onPeek = await folded();
    fireEvent.pointerEnter(panel(), { pointerType: "mouse" });
    expect(onPeek).not.toHaveBeenCalled();
  });

  it("folds back when the mouse leaves the panel", async () => {
    const onPeek = await folded({ rail: false, peek: true });
    fireEvent.pointerLeave(panel(), {
      pointerType: "mouse",
      relatedTarget: document.body,
    });
    expect(onPeek).toHaveBeenCalledWith(false);
  });

  // The control rides the floating edge, half over the panel, and is a sibling
  // of it: crossing onto it is not leaving.
  it("stays open while the mouse crosses onto the collapse control and back", async () => {
    const onPeek = await folded({ rail: false, peek: true });
    fireEvent.pointerLeave(panel(), {
      pointerType: "mouse",
      relatedTarget: collapse(),
    });
    fireEvent.pointerLeave(collapse(), {
      pointerType: "mouse",
      relatedTarget: panel(),
    });
    expect(onPeek).not.toHaveBeenCalled();
    fireEvent.pointerLeave(collapse(), {
      pointerType: "mouse",
      relatedTarget: document.body,
    });
    expect(onPeek).toHaveBeenCalledWith(false);
  });

  it("keeps the collapse control saying expand, and pinning open, during a peek", async () => {
    const onToggleCollapse = vi.fn();
    await folded({ rail: false, peek: true, onToggleCollapse });
    expect(collapse().getAttribute("aria-expanded")).toBe("false");
    expect(collapse().getAttribute("aria-label")).toBe("tree.expandPanel");
    fireEvent.click(collapse());
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  // The panel floats at the writer's width without owning it.
  it("offers no grip during a peek", async () => {
    await folded({ rail: false, peek: true });
    expect(document.querySelector(".panel-resize")).toBeNull();
  });

  // ── The narrow plane peeks too ─────────────────────────────────────────────
  //
  // The narrow plane, 721 to 999px, peeks too, and pays for the panel.
  // jsdom's `matchMedia` is the desk; the narrow window is stubbed
  // and put back after each row so no later row inherits it.
  describe("on the narrow plane", () => {
    const realMatchMedia = Object.getOwnPropertyDescriptor(
      window,
      "matchMedia",
    ) as PropertyDescriptor;
    afterEach(() => {
      Object.defineProperty(window, "matchMedia", realMatchMedia);
    });
    /** Narrow and not a phone: only the 1015.98 query answers yes. */
    function narrowWindow() {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          media: query,
          matches: query.includes("1015.98"),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });
    }
    const close = () => document.querySelector(".dt-close") as HTMLElement;

    it("opens from the rail", async () => {
      narrowWindow();
      const onPeek = await folded();
      fireEvent.pointerEnter(rail(), { pointerType: "mouse" });
      expect(onPeek).toHaveBeenCalledWith(true);
    });

    // The head's collapse is the narrow plane's control; a peek is still
    // folded, so it keeps saying expand, and pressing it pins the panel open.
    it("keeps the head's control saying expand during a peek", async () => {
      narrowWindow();
      const onToggleCollapse = vi.fn();
      await folded({ rail: false, peek: true, onToggleCollapse });
      expect(close().getAttribute("aria-expanded")).toBe("false");
      expect(close().getAttribute("aria-label")).toBe("tree.expandPanel");
      fireEvent.click(close());
      expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    });

    // The open panel is a column here, so its width is the writer's to set.
    it("offers the grip on an open panel", async () => {
      narrowWindow();
      await make({ width: 248 });
      await waitFor(() => expect(rail()).toBeTruthy());
      expect(document.querySelector(".panel-resize")).toBeTruthy();
    });
  });

  it("never opens on the phone sheet", async () => {
    const onPeek = await folded({ sheet: true });
    fireEvent.pointerEnter(rail(), { pointerType: "mouse" });
    expect(onPeek).not.toHaveBeenCalled();
  });
});

// ── The Reference and Notes buttons ──────────────────────────────────────────
//
// Two buttons, two faces each: wide they are the word and the count; in the
// rail they morph to the letters R and N with the chevron (the ">" is the
// chevron, not text), doing what the wide face does — the dock's face
// opens, and the panel never widens with it. Reference sits above Notes in the
// rail, the dock's own order.

describe("the Reference and Notes buttons", () => {
  it("opens the notes face from the wide button", async () => {
    const onOpenNotesTab = vi.fn();
    await make({ onOpenNotesTab });
    await waitFor(() =>
      expect(screen.getByText("reference.group.notes")).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "reference.group.notes" }),
    );
    expect(onOpenNotesTab).toHaveBeenCalled();
  });

  it("morphs to N + the chevron in the rail and still opens the notes face", async () => {
    const onOpenNotesTab = vi.fn();
    const onToggleCollapse = vi.fn();
    await make({ rail: true, onOpenNotesTab, onToggleCollapse });
    await waitFor(() =>
      expect(document.querySelector(".dt-rail")).toBeTruthy(),
    );
    const btn = screen.getByRole("button", {
      name: "reference.group.notes",
    });
    // The compact face: the letter N and the chevron — never the word or the
    // count, which would overflow 52px.
    expect(btn.querySelector(".dt-dock-button-glyph")?.textContent).toBe("N");
    expect(btn.querySelector(".dt-dock-button-chevron")).toBeTruthy();
    expect(btn.textContent).not.toContain("reference.group.notes");
    expect(btn.querySelector(".dt-dock-button-count")).toBeNull();
    fireEvent.click(btn);
    expect(onOpenNotesTab).toHaveBeenCalled();
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it("opens the reference face from the wide button", async () => {
    const onOpenReferenceTab = vi.fn();
    await make({ onOpenReferenceTab });
    await waitFor(() =>
      expect(screen.getByText("tree.reference")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "tree.reference" }));
    expect(onOpenReferenceTab).toHaveBeenCalled();
  });

  // The badge is the shelf's documents summed — notes have their own button and
  // their own count, so a note must never appear in both numbers.
  it("counts the shelf's documents, never the notes", async () => {
    await make({
      files: {
        ...DEFAULT_FILES,
        "/reference/guidebook--logline.md": "a",
        "/reference/character--two.md": "b",
        "/reference/arc--three.md": "c",
        "/reference/summary--EL2.md": "d",
        "/reference/world--economy.md": "e",
        "/reference/notes--five.md": "f",
      },
    });
    // The counts come from the folder listing, which lands after the button's
    // label renders, so the wait is on the counts themselves, not on the
    // label; a synchronous read once the label appears races the listing.
    await waitFor(() => {
      const ref = screen.getByRole("button", { name: "tree.reference" });
      expect(ref.querySelector(".dt-dock-button-count")?.textContent).toBe("5");
      const notes = screen.getByRole("button", {
        name: "reference.group.notes",
      });
      expect(notes.querySelector(".dt-dock-button-count")?.textContent).toBe(
        "1",
      );
    });
  });

  it("morphs to R + the chevron in the rail, above Notes, and opens the reference face", async () => {
    const onOpenReferenceTab = vi.fn();
    const onToggleCollapse = vi.fn();
    await make({ rail: true, onOpenReferenceTab, onToggleCollapse });
    await waitFor(() =>
      expect(document.querySelector(".dt-rail")).toBeTruthy(),
    );
    const btn = screen.getByRole("button", { name: "tree.reference" });
    expect(btn.querySelector(".dt-dock-button-glyph")?.textContent).toBe("R");
    expect(btn.querySelector(".dt-dock-button-chevron")).toBeTruthy();
    expect(btn.textContent).not.toContain("tree.reference");
    expect(btn.querySelector(".dt-dock-button-count")).toBeNull();
    // Reference above Notes — the dock's own order.
    const controls = [...document.querySelectorAll(".dt-dock-button")];
    expect(controls.map((d) => d.getAttribute("aria-label"))).toEqual([
      "tree.reference",
      "reference.group.notes",
    ]);
    fireEvent.click(btn);
    expect(onOpenReferenceTab).toHaveBeenCalled();
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });
});

// ── Regions ──────────────────────────────────────────────────────────────────

describe("regions", () => {
  // The structure region is the panel's reason to exist, so its heading is
  // not a toggle: the word is always on, and what folds is the tree under it,
  // row by row (pinned by the collapse tests above).
  it("keeps the structure open: its head is a label, not a toggle", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "tree.contents" })).toBeNull();
    expect(document.querySelector(".dt-region-label")?.textContent).toBe(
      "tree.contents",
    );
    expect(screen.getByRole("treegrid")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "reference.group.notes" }),
    ).toBeTruthy();
  });

  // The head carries no add command: the labels under the tree, the root's
  // own row at the end of the children, are the add affordance, on a
  // populated project as on an empty one.
  it("keeps the add off the head and at the end of the tree", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    const head = document.querySelector(".dt-root") as HTMLElement;
    // No add control of any kind, asked of the controls the tree ships: a
    // probe for a locale key no component produces would pass for the wrong
    // reason.
    expect(head.querySelector(".dt-add")).toBeNull();
    expect(
      within(head).queryByRole("button", { name: "tree.addPart" }),
    ).toBeNull();
    expect(
      within(head).queryByRole("button", { name: "tree.addSection" }),
    ).toBeNull();
    const rootRow = [
      ...(document.querySelector(".dt-content") as HTMLElement).children,
    ].find((el) => el.classList.contains("dt-add-row")) as HTMLElement;
    expect(rootRow).toBeTruthy();
    expect(within(rootRow).getByRole("button", { name: "tree.addPart" }));
  });

  // The panel find matches names and fragments, not prose — no squiggles.
  it("keeps the panel find out of the browser spellchecker", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());
    expect(
      screen.getByLabelText("tree.findLabel").getAttribute("spellcheck"),
    ).toBe("false");
  });
});

// ── The preferences panel ────────────────────────────────────────────────────

describe("the preferences panel", () => {
  const prefs = () => document.querySelector(".dt-prefs") as HTMLElement;
  const gear = () =>
    screen.getByRole("button", { name: "tree.writingPreferences" });

  async function openPrefs() {
    fireEvent.click(gear());
    await waitFor(() => expect(prefs().getAttribute("data-open")).toBe("1"));
    // The outside-press listener registers a frame late so it misses its own
    // opening press; give it that frame before the presses below are judged.
    await act(async () => {});
  }

  // ── The app's language ─────────────────────────────────────────────────────
  //
  // The one row on this card that is not about the open project, and the
  // editor's only route to the setting: the theme is on the foot, the account
  // face carries no menu, and below the app's 720 plane the titlebar —
  // which would otherwise have held one — is not drawn at all.

  it("carries the app's language, endonyms untranslated, apart from the project's own settings", async () => {
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    const picker = screen.getByLabelText(
      "settings.language",
    ) as HTMLSelectElement;
    // Asserted as literals, never `t()` keys, because these are not
    // translated: a writer stranded in a language they cannot read is
    // looking for the word they call their own.
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      "English",
      "Italiano",
    ]);

    // "en-GB" from the mock, matched to the bare "en" option — an unsplit
    // value selects nothing and the row silently shows whichever option came
    // first.
    expect(picker.value).toBe("en");

    // Last, and behind the rule that says it is not one of the settings above
    // it — sliding it against them would claim it is project-scoped.
    expect(picker.closest(".dt-pick")?.className).toContain("dt-pick-apart");
  });

  it("switches the app's language from the card", async () => {
    setLanguageMock.mockClear();
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    fireEvent.change(screen.getByLabelText("settings.language"), {
      target: { value: "it" },
    });
    expect(setLanguageMock).toHaveBeenCalledWith("it");
  });

  it("opens from the gear with the project’s settings, named in words not pixels", async () => {
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    // The three named sizes, with the project's own, the default Medium,
    // pressed.
    expect(
      screen.getByRole("button", { name: "tree.proseSizeSmall" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "tree.proseSizeMedium" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "tree.proseSizeLarge" }),
    ).toBeTruthy();
    // The fixture project's resolved defaults, reported as pressed: smooth
    // caret off (it was never set), typewriter off.
    expect(
      screen
        .getByRole("checkbox", { name: "tree.typewriter" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    // The fixture project never set `focus`, so it resolves to the shipped
    // default — off, same as every other flag in settingsOf.
    expect(
      screen
        .getByRole("button", { name: "tree.focusOff" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("names the focus unit the writer picks, and writes it", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    fireEvent.click(
      screen.getByRole("button", { name: "tree.focusParagraph" }),
    );
    await waitFor(() => {
      const ui = propsOf(provider).ui as { focus?: string };
      expect(ui.focus).toBe("paragraph");
    });
    expect(
      screen
        .getByRole("button", { name: "tree.focusParagraph" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("names the prose size the writer picks, and writes it", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    fireEvent.click(
      screen.getByRole("button", { name: "tree.proseSizeLarge" }),
    );
    await waitFor(() => {
      const ui = propsOf(provider).ui as { proseSize?: number };
      expect(ui.proseSize).toBe(21);
    });
    expect(
      screen
        .getByRole("button", { name: "tree.proseSizeLarge" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("toggles Smooth caret and writes it to the project (fixes.md #7)", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    // Off by default: the project has never asked for the typing spring.
    expect(
      screen
        .getByRole("checkbox", { name: "tree.smoothCaret" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("checkbox", { name: "tree.smoothCaret" }));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { smoothCaret?: boolean };
      expect(ui.smoothCaret).toBe(true);
    });
    expect(
      screen
        .getByRole("checkbox", { name: "tree.smoothCaret" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("closes on a press outside the card, and not on one inside", async () => {
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    // A press inside the card — the typewriter row — leaves it open.
    fireEvent.pointerDown(
      screen.getByRole("checkbox", { name: "tree.typewriter" }),
    );
    await waitFor(() => expect(prefs().getAttribute("data-open")).toBe("1"));

    // A press on the page behind closes it.
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(prefs().getAttribute("data-open")).toBe("0"));
  });

  // The autosave switch is a writing preference, beside its own delay, where
  // a finger reaches both; a switch that opens only after a second of pointer
  // rest is reachable by a mouse that knows to wait and by nothing else.
  it("carries the autosave switch, and reports the project's state", async () => {
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    // On by default; the switch stays reachable so the writer can turn it
    // off as easily.
    expect(
      screen
        .getByRole("checkbox", { name: "toolbar.autosave" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("flipping the switch writes the project's own override", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    fireEvent.click(screen.getByRole("checkbox", { name: "toolbar.autosave" }));

    await waitFor(() => {
      const ui = propsOf(provider).ui as { autosave?: boolean };
      expect(ui.autosave).toBe(false);
    });
    // And the delay it governs goes with it, in the same panel.
    expect(
      screen.queryByRole("combobox", { name: "tree.autosaveEvery" }),
    ).toBeNull();
  });

  it("hides the delay select on a project with autosave off", async () => {
    await make({
      props: PROPS.replace(
        '"lastOpened": "EL2"',
        '"lastOpened": "EL2", "autosave": false',
      ),
    });
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    expect(
      screen.queryByRole("combobox", { name: "tree.autosaveEvery" }),
    ).toBeNull();
  });

  it("shows the delay select on a project with autosave on, and writes a preset step", async () => {
    const { provider } = await make({
      props: PROPS.replace(
        '"lastOpened": "EL2"',
        '"lastOpened": "EL2", "autosave": true, "autosaveDelay": 60',
      ),
    });
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    const delay = screen.getByRole("combobox", {
      name: "tree.autosaveEvery",
    }) as HTMLSelectElement;
    // Sixty seconds is one of the six named steps, shown as its own option.
    expect(delay.value).toBe("60");

    fireEvent.change(delay, { target: { value: "120" } });
    await waitFor(() => {
      const ui = propsOf(provider).ui as { autosaveDelay?: number };
      expect(ui.autosaveDelay).toBe(120);
    });
    expect(delay.value).toBe("120");
  });

  it("shows the default step for a delay the select cannot express", async () => {
    // Ninety seconds is not one of the six steps, so it is nobody's choice,
    // and the select shows the default rather than a value it cannot hold:
    // stale data falls to a default, never to a silent misstatement.
    await make({
      props: PROPS.replace(
        '"lastOpened": "EL2"',
        '"lastOpened": "EL2", "autosave": true, "autosaveDelay": 90',
      ),
    });
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    const delay = screen.getByRole("combobox", {
      name: "tree.autosaveEvery",
    }) as HTMLSelectElement;
    expect(delay.value).toBe("30");
  });

  // Henosis mode: the switch alone. Its two steps are set in Settings, not
  // in this card.
  it("carries the Henosis switch, off, and no steps", async () => {
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    expect(
      screen
        .getByRole("checkbox", { name: "tree.henosis" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("turns Henosis on for the project, still with no steps here", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    fireEvent.click(screen.getByRole("checkbox", { name: "tree.henosis" }));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { henosis?: boolean };
      expect(ui.henosis).toBe(true);
    });
    expect(
      screen.queryByRole("combobox", { name: "tree.henosisAfter" }),
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "tree.henosisFade" }),
    ).toBeNull();
  });
});

// ── Overriding a global Editor Setting ───────────────────────────────────────

describe("overriding a global Editor Setting", () => {
  const prefs = () => document.querySelector(".dt-prefs") as HTMLElement;
  const gear = () =>
    screen.getByRole("button", { name: "tree.writingPreferences" });

  async function openPrefs() {
    fireEvent.click(gear());
    await waitFor(() => expect(prefs().getAttribute("data-open")).toBe("1"));
    await act(async () => {});
  }

  /** A global smooth caret on for the signed-in user, in the profile. */
  function seedGlobalSmoothCaret() {
    localStorage.setItem(
      "profile.u1",
      JSON.stringify({
        doc: {
          v: 1,
          installation: "test-install",
          prefs: {
            smoothCaret: { value: true, updatedAt: "2026-01-01T00:00:00.000Z" },
          },
          library: {},
        },
      }),
    );
  }

  it("a toggle that matches the global default stores nothing (inherits) and is silent", async () => {
    const { setCurrentUserId } = await import("../../auth/currentUser");
    setCurrentUserId("u1");
    seedGlobalSmoothCaret();
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    // The fixture inherits the global: smooth caret is already on, and the
    // panel says so.
    expect(
      screen
        .getByRole("checkbox", { name: "tree.smoothCaret" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    // Toggle off: a real divergence — the project stores the override and the
    // toast speaks once.
    fireEvent.click(screen.getByRole("checkbox", { name: "tree.smoothCaret" }));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { smoothCaret?: boolean | null };
      expect(ui.smoothCaret).toBe(false);
    });
    await waitFor(() =>
      expect(document.querySelector(".dt-toast")).toBeTruthy(),
    );
    // Toggle on again: the value equals the global, so the project stores
    // nothing (inherit) — and the return arms no second toast.
    fireEvent.click(screen.getByRole("checkbox", { name: "tree.smoothCaret" }));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { smoothCaret?: boolean | null };
      expect(ui.smoothCaret).toBeNull();
    });
    expect(document.querySelectorAll(".dt-toast")).toHaveLength(1);
  });

  it("a toggle that diverges from the global default stores the override and toasts", async () => {
    const { setCurrentUserId } = await import("../../auth/currentUser");
    setCurrentUserId("u1");
    seedGlobalSmoothCaret();
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    // Global on → project off is a real divergence: the project stores the
    // override and the toast speaks "for this project only".
    fireEvent.click(screen.getByRole("checkbox", { name: "tree.smoothCaret" }));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { smoothCaret?: boolean | null };
      expect(ui.smoothCaret).toBe(false);
    });
    await waitFor(() =>
      expect(document.querySelector(".dt-toast")?.textContent).toContain(
        "toast.settingOff",
      ),
    );
  });

  // ── The announcement follows the override ──────────────────────────────────
  //
  // The "for this project only" toast follows any override, whatever the
  // control's shape: focus, prose size and the autosave delay announce theirs
  // as the toggles do. The boolean case is pinned above.

  it("prose size announces the override, like the toggles always did", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    // Built-in default is Medium; Large is a real divergence.
    fireEvent.click(
      screen.getByRole("button", { name: "tree.proseSizeLarge" }),
    );
    await waitFor(() => {
      const ui = propsOf(provider).ui as { proseSize?: number | null };
      expect(ui.proseSize).toBe(21);
    });
    await waitFor(() =>
      expect(document.querySelector(".dt-toast")?.textContent).toContain(
        "toast.settingOverride",
      ),
    );
  });

  it("focus announces the override, like the toggles always did", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    // Built-in default is off; line focus is a real divergence.
    fireEvent.click(screen.getByRole("button", { name: "tree.focusLine" }));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { focus?: string | null };
      expect(ui.focus).toBe("line");
    });
    await waitFor(() =>
      expect(document.querySelector(".dt-toast")?.textContent).toContain(
        "toast.settingOverride",
      ),
    );
  });

  it("the autosave delay announces the override, like the toggles always did", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    // The delay exists while autosave is on, which it is by default.
    const picker = await screen.findByLabelText("tree.autosaveEvery");

    const other = [...(picker as HTMLSelectElement).options]
      .map((o) => o.value)
      .find((v) => Number(v) !== 2);
    if (other === undefined)
      throw new Error("The delay picker should offer more than one preset");
    fireEvent.change(picker, { target: { value: other } });

    await waitFor(() => {
      const ui = propsOf(provider).ui as { autosaveDelay?: number | null };
      expect(ui.autosaveDelay).toBe(Number(other));
    });
    await waitFor(() =>
      expect(document.querySelector(".dt-toast")?.textContent).toContain(
        "toast.settingOverride",
      ),
    );
  });

  it("— with no global set, toggling back to the built-in default inherits and stays silent", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    // No globals configured: the built-in default is off, and the fixture's
    // project has no opinion. Toggle on — a real divergence: the project
    // stores the override and the toast speaks once.
    fireEvent.click(screen.getByRole("checkbox", { name: "tree.typewriter" }));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { typewriter?: boolean | null };
      expect(ui.typewriter).toBe(true);
    });
    await waitFor(() =>
      expect(document.querySelector(".dt-toast")).toBeTruthy(),
    );

    // Toggle off, back to the built-in default: that returns to the default,
    // not a project-only divergence, so the project stores nothing (inherit)
    // and no second toast claims otherwise.
    fireEvent.click(screen.getByRole("checkbox", { name: "tree.typewriter" }));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { typewriter?: boolean | null };
      expect(ui.typewriter).toBeNull();
    });
    expect(document.querySelectorAll(".dt-toast")).toHaveLength(1);
  });
});

// ── Unsaved work ─────────────────────────────────────────────────────────────

describe("the row mark", () => {
  /**
   * The settle point of the mark: the open row is known. The labels render
   * before the open file resolves to its row, so waiting for "Opening" alone
   * races the mark, and on a loaded run would take the count a beat early.
   * The silences below wait for it too, or they would pass
   * before there was anything to be silent about.
   */
  async function openRowSettled() {
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-row="EL2"]')
          ?.getAttribute("aria-current"),
      ).toBe("true"),
    );
  }

  it("marks the open Section, and only while there is something to write", async () => {
    await make({ save: "dirty" });
    await openRowSettled();
    const marks = [...document.querySelectorAll(".dt-mark")];
    expect(marks).toHaveLength(1);
    expect(marks[0].closest(".dt-row")?.getAttribute("data-row")).toBe("EL2");
  });

  it("says nothing when the words are where the writer keeps them", async () => {
    // Both silences, and they are the same silence: nothing to
    // write, and written all the way out. A permanent tick on the active row
    // would be furniture in a list the writer scans to navigate, and the bar
    // already carries the confirmation a few pixels away.
    for (const save of ["clean", "saved"] as const) {
      cleanup();
      await make({ save });
      await openRowSettled();
      expect(document.querySelector(".dt-mark")).toBeNull();
    }
  });

  it("marks every row the queue is holding, not only the open one", async () => {
    // The offline case: a writer who loses the connection keeps working,
    // prose in one Section, a drag in another, and every act queues behind
    // the last. Every waiting row is marked, so the rows the writer has just
    // left do not look settled.
    await make({
      save: "saved",
      pendingPaths: new Set([
        filePath("section--opening.EL2.00.md"),
        filePath("part--act_two.EL4.00.md"),
      ]),
    });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());

    const marked = [...document.querySelectorAll(".dt-mark")].map((m) =>
      m.closest(".dt-row")?.getAttribute("data-row"),
    );
    // `EL2` is the open Section and `EL4` is a Part the writer is not in:
    // Parts hold prose too, so a queued Part is marked as well.
    expect(new Set(marked)).toEqual(new Set(["EL2", "EL4"]));
    for (const mark of document.querySelectorAll(".dt-mark"))
      expect(mark.getAttribute("data-state")).toBe("cached");
  });

  it("lets the open row's own state outrank what the queue says about it", async () => {
    // Both facts can be true at once: the buffer holds an unwritten edit and
    // an older copy of the same file is still queued. The buffer wins,
    // because "there is something to write" is the more urgent of the two and
    // it is about the editor rather than about the connection.
    await make({
      save: "dirty",
      pendingPaths: new Set([filePath("section--opening.EL2.00.md")]),
    });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const mark = document.querySelector('.dt-row[data-row="EL2"] .dt-mark');
    expect(mark?.getAttribute("data-state")).toBe("dirty");
  });

  it("still marks a row the writer renamed or moved while the queue held it", async () => {
    // A restructure is as queueable as prose. Those ops name where the file
    // was, and the panel draws rows at where it is, so matching on the op's
    // own path alone would leave every moved row unmarked, the case where a
    // writer most wonders whether the app kept up. `pathsTouched` closes
    // that, and this is its row-level proof.
    await make({
      save: "saved",
      pendingPaths: new Set(
        pathsTouched({
          id: 1,
          userId: "u1",
          ref: { id: "book-1", providerId: "drive", key: "book" },
          op: {
            kind: "rename",
            path: filePath("section--elsewhere.00.md"),
            newName: "section--opening.EL2.00.md",
          },
        }),
      ),
    });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    expect(
      document.querySelector('.dt-row[data-row="EL2"] .dt-mark'),
    ).toBeTruthy();
  });

  it("draws a different mark for each state, rather than one ember dot for all of them", async () => {
    // One ember dot cannot tell "still typing" from "your words did not
    // land". The marks follow the bar's save chip's table, so the two
    // surfaces cannot disagree about where the writer's words are.
    const drawn: (string | null)[] = [];
    for (const save of ["dirty", "cached", "failed"] as const) {
      cleanup();
      await make({ save });
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
      const mark = document.querySelector(".dt-mark");
      expect(mark?.getAttribute("data-state")).toBe(save);
      drawn.push(mark?.innerHTML ?? null);
    }
    expect(drawn.every((d) => d !== null && d.length > 0)).toBe(true);
    expect(new Set(drawn).size).toBe(3);
  });
});

// ── Dragging ─────────────────────────────────────────────────────────────────

describe("dragging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("press, move past the threshold, drop into the gap: the node moves to the end of the Part", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      const { provider } = await make();
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
      // The drag's insertion math reads the expanded set, so the row waits
      // for the restored shape before pressing. The restore commits with the
      // rows (a layout effect); the wait states the precondition,
      // not a race to sit out.
      await waitFor(() =>
        expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
      );

      fireEvent.pointerDown(row("EL2"), {
        button: 0,
        clientX: 20,
        clientY: 40,
      });
      fireEvent.pointerMove(window, { clientX: 23, clientY: 85 });
      // React 19 auto-batches the move-triggered state update; the dragging
      // chrome commits in a later microtask than the event that caused it.
      await waitFor(() => {
        expect(
          document.querySelector(".doc-tree")?.classList.contains("dragging"),
        ).toBe(true);
        expect(document.querySelector(".dt-ghost")?.textContent).toBe(
          "Opening",
        );
        expect(document.querySelector(".dt-drop-line")).toBeTruthy();
      });

      fireEvent.pointerUp(window);
      await waitFor(() => {
        const structure = structureOf(provider);
        const ids = childrenOf(structure, "EL1").map((c) => c.id);
        expect(ids).toEqual(["EL3", "EL2"]);
      });
      expect(document.querySelector(".dt-ghost")).toBeNull();
      expect(screen.getByText("toast.moved")).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("Escape cancels the drag without a write", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      const { provider } = await make();
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
      fireEvent.pointerDown(row("EL2"), {
        button: 0,
        clientX: 20,
        clientY: 40,
      });
      fireEvent.pointerMove(window, { clientX: 23, clientY: 85 });
      expect(document.querySelector(".dt-ghost")).toBeTruthy();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(document.querySelector(".dt-ghost")).toBeNull();
      expect(document.querySelector(".dt-drop-line")).toBeNull();
      const structure = structureOf(provider);
      expect(childrenOf(structure, "EL1").map((c) => c.id)).toEqual([
        "EL2",
        "EL3",
      ]);
    } finally {
      restore();
    }
  });

  it("a press that never passes the threshold was a click, not a drag", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      const { provider } = await make();
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
      fireEvent.pointerDown(row("EL2"), {
        button: 0,
        clientX: 20,
        clientY: 40,
      });
      fireEvent.pointerUp(window);
      expect(document.querySelector(".dt-ghost")).toBeNull();
      expect(
        document.querySelector(".doc-tree")?.classList.contains("dragging"),
      ).toBe(false);
      const structure = structureOf(provider);
      expect(childrenOf(structure, "EL1").map((c) => c.id)).toEqual([
        "EL2",
        "EL3",
      ]);
    } finally {
      restore();
    }
  });
});

// ── Row actions and the finger's route ───────────────────────────────────────
//
// On a phone the tree offers rename, add and remove with no hover, since a
// cluster hidden until hovered is unreachable and F2 is a key no soft
// keyboard has. A finger-scroll of this panel must never reorder a chapter or
// drop it in the bin, so the drag refuses a touch.
//
// These pin the behaviour rather than the CSS. A media query is not testable
// in jsdom, and it is not what the behaviour rests on: the overflow menu
// exists at every pointer, the landings do too, and the drag's refusal is
// keyed on `pointerType`.

describe("a row's actions", () => {
  it("opens the summary from the §, without opening the node", async () => {
    // The § button in the row's trailing cluster (count, §, menu), and the one
    // thing there that is neither a count nor a menu.
    // Two halves have to agree before the button is drawn: the node carries a
    // `summary:` binding and the file is on disk. A marker over a document
    // that does not exist would promise something the writer cannot open.
    const onOpenReference = vi.fn();
    await make({
      onOpenReference,
      // A different Section is open, so "the node was not opened" is a fact
      // this can observe rather than one the harness made true before the
      // click.
      open: "section--the_storm.EL3.01.md",
      structure: STRUCTURE.replace(
        "        adopted: section--opening.EL2.00.md",
        "        adopted: section--opening.EL2.00.md" +
          "\n        summary: summary--EL2.md",
      ),
      files: {
        ...DEFAULT_FILES,
        "/reference/summary--EL2.md": "What happens in the Opening.",
      },
    });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());

    // Find, not get: the button is drawn only once both halves above agree, and
    // the file check lands after the row does, so a synchronous read after
    // the row's text races that second half.
    const control = await within(row("EL2")).findByLabelText(
      "tree.openSummary",
    );
    fireEvent.click(control);
    expect(onOpenReference).toHaveBeenCalledWith("summary--EL2.md");
    // And the row underneath was not opened by the same press: the button stops
    // it, or reaching for a summary would move the writer's whole editor.
    expect(row("EL2").getAttribute("aria-current")).toBeNull();
  });

  it("draws a blank slot where there is nothing behind it", async () => {
    // The slot is mounted either way, so a row's count stays in the same
    // column as its neighbours'. Without it the trailing cluster would shift
    // per row depending on whether that row had been summarised.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const slot = row("EL2").querySelector(".dt-summary");
    expect(slot?.className).toContain("slot");
    expect(slot?.tagName).toBe("SPAN");
  });

  it("offers every action without a hover, in words", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Act One")).toBeTruthy());

    // Present at rest: not revealed, not focused into.
    const more = within(row("EL1")).getByLabelText("tree.actionsFor");
    expect(more.getAttribute("aria-haspopup")).toBe("menu");

    fireEvent.click(more);
    const items = Array.from(
      (await screen.findByRole("menu")).querySelectorAll('[role="menuitem"]'),
    ).map((el) => el.textContent);
    // Adding lives in the always-visible labels under the children; the menu
    // is rename, then move, then remove: naming what they built comes before
    // rearranging it, and Remove is last and stays apart, because a
    // destructive command at the top of a list gets hit on the way to the
    // others. Select sits just ahead
    // of Move, the first step of the same act: tick several, then move them.
    expect(items).toEqual([
      "tree.rename",
      "tree.select",
      "tree.move",
      "tree.remove",
    ]);
  });

  it("keeps Add off the Section's menu, where nothing can be added", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.click(within(row("EL2")).getByLabelText("tree.actionsFor"));
    const items = Array.from(
      (await screen.findByRole("menu")).querySelectorAll('[role="menuitem"]'),
    ).map((el) => el.textContent);
    // The Golden Rule again: nothing goes inside a Section. A menu row that
    // opens onto "you cannot do this" is worse than its absence.
    expect(items).toEqual([
      "tree.rename",
      "tree.select",
      "tree.move",
      "tree.remove",
    ]);
  });
});

// ── A node's summary, from its menu ──────────────────────────────────────────
//
// Every Section and every Part offers "Create summary", or "Update summary"
// once one exists, and the dialog it opens writes it without the chat.

describe("the row's summary action", () => {
  const menuItems = async (id: string) => {
    fireEvent.click(within(row(id)).getByLabelText("tree.actionsFor"));
    return Array.from(
      (await screen.findByRole("menu")).querySelectorAll('[role="menuitem"]'),
    ).map((el) => el.textContent);
  };

  function writer(
    generateSummary = vi.fn(async (): Promise<void> => undefined),
  ) {
    return {
      searchDocuments: () => [],
      listModels: vi.fn(async () => [
        {
          id: "llama3",
          providerId: "ollama",
          label: "llama3",
          kind: "device" as const,
          capabilities: {
            tools: true,
            structuredOutput: true,
            reasoning: false,
          },
        },
      ]),
      summaries: { generate: generateSummary },
      // The rows draw each persona's comment circle in its colour.
      allPersonas: () => [],
    } as unknown as Assistant;
  }

  it("offers Create summary on a Section and on a Part, before Remove", async () => {
    await make({ assistant: writer() });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    expect(await menuItems("EL2")).toEqual([
      "tree.rename",
      "tree.select",
      "tree.move",
      "tree.createSummary",
      "tree.remove",
    ]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await menuItems("EL1")).toContain("tree.createSummary");
  });

  it("says Update once the node has a summary", async () => {
    await make({
      assistant: writer(),
      structure: STRUCTURE.replace(
        "        adopted: section--opening.EL2.00.md",
        "        adopted: section--opening.EL2.00.md" +
          "\n        summary: summary--EL2.md",
      ),
      files: {
        ...DEFAULT_FILES,
        "/reference/summary--EL2.md": "What happens in the Opening.",
      },
    });
    await within(row("EL2")).findByLabelText("tree.openSummary");
    expect(await menuItems("EL2")).toContain("tree.updateSummary");
  });

  it("offers nothing to summarise with when there is no assistant", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    expect(await menuItems("EL2")).not.toContain("tree.createSummary");
  });

  it("writes it through the dialog and opens it when it lands", async () => {
    const generateSummary = vi.fn(async (): Promise<void> => undefined);
    const onOpenReference = vi.fn();
    await make({ assistant: writer(generateSummary), onOpenReference });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    rowAction("EL2", "tree.createSummary");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Opening")).toBeTruthy();
    const create = await within(dialog).findByRole("button", {
      name: "summary.create",
    });
    await waitFor(() => expect(create.hasAttribute("disabled")).toBe(false));
    fireEvent.click(create);

    await waitFor(() =>
      expect(onOpenReference).toHaveBeenCalledWith("summary--EL2.md"),
    );
    expect(generateSummary).toHaveBeenCalledWith(
      "EL2",
      expect.objectContaining({ providerId: "ollama", modelId: "llama3" }),
      expect.any(AbortSignal),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ── Moving without a drag ────────────────────────────────────────────────────
//
// The panel becomes the answer to "where should this go": a landing in every
// gap the node can sit in, drawn at the depth it would land at. The writer
// taps the place they can already see, rather than a written destination.

const landings = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".dt-landing"));

/** A landing's own words — "first in this container", or "after that row". */
const landingLabels = () =>
  landings().map((el) => el.getAttribute("aria-label"));

/**
 * The document's shape as ids, which is what a move changes and
 * nothing else does.
 *
 * Not a JSON dump of the structure: a background pass fills in `contentHash`
 * on every snapshot after mount, so a whole-structure comparison reports a
 * write that has nothing to do with the gesture under test.
 */
const shapeOf = (provider: FakeProvider) =>
  JSON.stringify(
    structureOf(provider).children.map((c) => [
      c.id,
      c.kind === "part" ? c.children.map((x) => x.id) : [],
    ]),
  );

describe("moving a node from the panel", () => {
  it("shows a landing in every legal gap, and none anywhere else", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    // Nothing on screen until a move is asked for. This mode is not a state
    // the panel rests in.
    expect(landings()).toEqual([]);

    rowAction("EL2", "tree.move");
    await waitFor(() => expect(landings().length).toBeGreaterThan(0));
    expect(document.querySelector(".dt-moving")).toBeTruthy();

    // The document is Act One [Opening, The Storm] and an empty Act Two.
    // Moving "Opening" leaves two places it can go, and the list is the
    // whole claim:
    //
    //   * not the root, which holds Parts — the Golden Rule, `canDrop`'s.
    //   * not its own two positions, before and after itself, which are the
    //     same place it already is.
    //   * inside Act One, after The Storm.
    //   * inside Act Two, which is empty and so has one gap and no rows —
    //     the case a between-the-rows drawing would miss entirely.
    expect(landingLabels()).toEqual(["tree.moveAfter", "tree.moveFirst"]);

    // The indent is the container, so it is worth pinning: both sit one step
    // in from a Part, at the depth a Section lives at.
    expect(landings().map((el) => el.style.paddingLeft)).toEqual([
      "30px",
      "30px",
    ]);

    // And the row in the air is marked rather than removed.
    expect(row("EL2").getAttribute("data-moving")).toBe("1");
  });

  it("pressing a landing is the move, with the same toast a drag gets", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());

    rowAction("EL2", "tree.move");
    await waitFor(() => expect(landings().length).toBe(2));
    // The first is "after The Storm", inside Act One.
    fireEvent.click(landings()[0]);

    await waitFor(() => {
      const ids = childrenOf(structureOf(provider), "EL1").map((c) => c.id);
      expect(ids).toEqual(["EL3", "EL2"]);
    });
    // The same write as a drag, so the same safety net.
    expect(screen.getByText("toast.moved")).toBeTruthy();
    // The mode ends with the move; nothing is left in the air.
    expect(landings()).toEqual([]);
  });

  it("reaches an empty Part, which a drag could only do by hovering it open", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());

    rowAction("EL2", "tree.move");
    await waitFor(() => expect(landings().length).toBe(2));
    fireEvent.click(landings()[1]);

    await waitFor(() => {
      expect(childrenOf(structureOf(provider), "EL4").map((c) => c.id)).toEqual(
        ["EL2"],
      );
    });
  });

  it("Escape leaves the move without a write", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const before = shapeOf(provider);

    rowAction("EL2", "tree.move");
    await waitFor(() => expect(landings().length).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(landings()).toEqual([]));
    expect(shapeOf(provider)).toBe(before);
  });

  it("Cancel leaves it too — a phone has no Escape", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    rowAction("EL2", "tree.move");
    await waitFor(() => expect(landings().length).toBeGreaterThan(0));

    fireEvent.click(
      within(document.querySelector(".dt-moving") as HTMLElement).getByText(
        "confirm.cancel",
      ),
    );
    await waitFor(() => expect(landings()).toEqual([]));
  });

  it("raises the face and folds the head the moment the find is opened", async () => {
    // The open is a state of its own. Clicking into the field puts the
    // results face up on its invitation, hides the tree, and folds the
    // project's name and spine away — which is where the room for the list
    // comes from: ~53px in a 248px column is four more occurrences, and the
    // writer is not in any doubt about which project they are in, because they
    // are standing in it.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    expect(panelBody()).toBe("tree");
    expect(head().dataset.finding).toBe("0");

    fireEvent.focus(findField());
    await waitFor(() => expect(panelBody()).toBe("results"));
    expect(document.querySelector(".dt-search-invite")).toBeTruthy();
    expect(head().dataset.finding).toBe("1");
  });

  it("hands the panel back when the writer leaves an empty field", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const field = findField();
    fireEvent.focus(field);
    await waitFor(() => expect(panelBody()).toBe("results"));

    fireEvent.blur(field);
    await waitFor(() => expect(panelBody()).toBe("tree"));
    expect(head().dataset.finding).toBe("0");
  });

  it("keeps the face up when focus leaves a field with a query in it", async () => {
    // Focus leaves this field the moment the writer reaches into the results,
    // and a face that folded when it did would take the list away as the hand
    // went for it.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const field = findField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Act" } });
    await waitFor(() => expect(panelBody()).toBe("results"));

    fireEvent.blur(field);
    expect(panelBody()).toBe("results");
    expect(head().dataset.finding).toBe("1");
  });

  it("reads the project when the find opens, not at the first keystroke", async () => {
    // The sweep starts with the face, so the book has usually been read by the
    // time a query exists. It is the reason the invitation is worth showing at
    // all: the panel is doing something while it stands there.
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const before = provider.readFile.mock.calls.length;

    fireEvent.focus(findField());
    await waitFor(() =>
      expect(provider.readFile.mock.calls.length).toBeGreaterThan(before),
    );
    // The book's own files, not the properties or the structure: the sweep is
    // `sourcesFor`'s list, and every path in it is a document.
    const swept = provider.readFile.mock.calls
      .slice(before)
      .map(([, path]) => path as string);
    expect(swept.length).toBeGreaterThan(1);
    expect(swept.every((path) => path.endsWith(".md"))).toBe(true);
  });

  it("re-reads the book when a file it is searching is written", async () => {
    // The list is live rather than a photograph. A writer who searches a
    // phrase, fixes one of the lines it found and looks back at the panel is
    // reading an answer to their own last question, and it has to be the
    // answer to the book they have now.
    const { provider, ported } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const field = findField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Act" } });
    await waitFor(() => expect(panelBody()).toBe("results"));
    await waitFor(() =>
      expect(
        provider.readFile.mock.calls.some(([, p]) =>
          (p as string).endsWith(".md"),
        ),
      ).toBe(true),
    );
    // The first sweep finished, not merely begun: counted mid-sweep, its own
    // late reads land after `before` and read as a re-sweep.
    await waitFor(() => expect(sweeping()).toBeNull());
    const before = provider.readFile.mock.calls.length;

    // Someone saves a Section — through the same port every writer in this
    // editor goes through, which is why the panel hears about it at all.
    await writeThroughPort(
      ported,
      "/document/section--the_storm.EL3.01.md",
      "the storm again",
    );
    await waitFor(() =>
      expect(provider.readFile.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("re-reads the files written while the find stood empty when the next query is typed, and only them", async () => {
    // With nothing typed there is no answer on screen to be wrong, so the
    // write is not read then. It is remembered: the query typed next answers
    // for the book as it is, not as the sweep found it.
    const { provider, ported } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const field = findField();
    fireEvent.focus(field);
    await waitFor(() =>
      expect(
        provider.readFile.mock.calls.some(([, p]) =>
          (p as string).endsWith(".md"),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(sweeping()).toBeNull());
    const before = provider.readFile.mock.calls.length;

    // Two Sections saved while idle: the second write must not hide the first.
    const written = [
      "/document/section--opening.EL2.00.md",
      "/document/section--the_storm.EL3.01.md",
    ];
    await writeThroughPort(ported, written[0], "the opening again");
    await writeThroughPort(ported, written[1], "the storm again");
    expect(provider.readFile.mock.calls.length).toBe(before);

    fireEvent.change(field, { target: { value: "storm" } });
    await waitFor(() =>
      expect(provider.readFile.mock.calls.length).toBeGreaterThan(before + 1),
    );
    await waitFor(() => expect(sweeping()).toBeNull());
    expect(
      provider.readFile.mock.calls
        .slice(before)
        .map(([, path]) => path as string)
        .sort(),
    ).toEqual(written);
  });

  it("re-reads every file of writes that land in one batch", async () => {
    // A split or a merge writes two Sections back to back; both notices land
    // in one render, and neither may hide the other.
    const { provider, ported } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const field = findField();
    fireEvent.focus(field);
    await waitFor(() => expect(sweeping()).toBeNull());
    const before = provider.readFile.mock.calls.length;

    const written = [
      "/document/section--opening.EL2.00.md",
      "/document/section--the_storm.EL3.01.md",
    ];
    const port = ported.current;
    if (!port) throw new Error("the port probe never rendered");
    await act(async () => {
      await Promise.all([
        port.writeFile(FAKE_REF, written[0], "the opening again"),
        port.writeFile(FAKE_REF, written[1], "the storm again"),
      ]);
    });

    fireEvent.change(field, { target: { value: "storm" } });
    await waitFor(() =>
      expect(provider.readFile.mock.calls.length).toBeGreaterThan(before + 1),
    );
    await waitFor(() => expect(sweeping()).toBeNull());
    expect(
      provider.readFile.mock.calls
        .slice(before)
        .map(([, path]) => path as string)
        .sort(),
    ).toEqual(written);
  });

  it("does not re-read the book because a file it never searches was written", async () => {
    // The undo journal, the properties and the structure all go through the
    // same port and none of them is prose. Without the path check this would
    // be a sweep of the whole project per journal flush, which with autosave
    // on is a sweep a second.
    const { provider, ported } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const field = findField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Act" } });
    await waitFor(() => expect(panelBody()).toBe("results"));
    await waitFor(() =>
      expect(
        provider.readFile.mock.calls.some(([, p]) =>
          (p as string).endsWith(".md"),
        ),
      ).toBe(true),
    );
    // The first sweep finished, not merely begun: counted mid-sweep, its own
    // late reads land after `before` and read as a re-sweep.
    await waitFor(() => expect(sweeping()).toBeNull());
    const before = provider.readFile.mock.calls.length;

    await writeThroughPort(ported, "/document-properties.json", "{}");
    // No tick to wait on. A write the panel searches bumps the session in the
    // render it causes, and the write's own `act` settles that render and the
    // reads it starts — so a re-sweep is either still up here or already in
    // the count, never still to come. Without the path gate the count is 29
    // reads, not 21.
    expect(sweeping()).toBeNull();
    expect(provider.readFile.mock.calls.length).toBe(before);
  });

  it("puts the panel back from the control beside the field", async () => {
    // Closing the find is otherwise done by not doing something —
    // empty the field, then click elsewhere — which is a fine way to leave and
    // a poor way to be told you can. It clears the query as well as closing:
    // a query left in a folded field would come back with the next click.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const field = findField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Act" } });
    await waitFor(() => expect(panelBody()).toBe("results"));

    fireEvent.click(screen.getByLabelText("tree.findBack"));
    await waitFor(() => expect(panelBody()).toBe("tree"));
    expect(head().dataset.finding).toBe("0");
    expect(findField().value).toBe("");
    // And the caret leaves with it. `finding` alone does not collapse the box,
    // since `:focus-within` opens it too, so a back that held the caret would
    // leave a field standing open over a tree it is not filtering, most
    // visibly from an empty field where nothing else holds it there.
    expect(document.activeElement).not.toBe(findField());
  });

  it("collapses the field on the way back even when nothing was typed", async () => {
    // With a query set, emptying the field is what folds the box; with
    // nothing typed, only the caret holds it open, so the back control lets
    // the caret go even though its own click needs it.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.focus(findField());
    await waitFor(() => expect(panelBody()).toBe("results"));

    fireEvent.click(screen.getByLabelText("tree.findBack"));
    await waitFor(() => expect(panelBody()).toBe("tree"));
    expect(document.activeElement).not.toBe(findField());
  });

  it("keeps the back control out of the tab order while the find is shut", async () => {
    // It has no width then — it is a morph, not a mount, so the field slides
    // rather than being shoved by something appearing beside it — and a tab
    // stop on a 0px control is a stop at nothing.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const back = document.querySelector(".dt-find-back") as HTMLElement;
    expect(back.getAttribute("tabindex")).toBe("-1");
    expect(back.getAttribute("aria-hidden")).toBe("true");

    fireEvent.focus(findField());
    await waitFor(() => expect(panelBody()).toBe("results"));
    expect(back.getAttribute("tabindex")).toBeNull();
    expect(back.getAttribute("aria-hidden")).toBeNull();
  });

  it("— a query typed during a move leaves the tree where it is", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    rowAction("EL2", "tree.move");
    await waitFor(() => expect(landings().length).toBeGreaterThan(0));
    expect(panelBody()).toBe("tree");

    // Looking for the destination by name is the obvious next move, and the
    // field is the one control still on screen. The face's mount and the
    // stylesheet's hiding of the tree read one variable, `finding`, on the row
    // and on the mount. Two predicates that disagreed would take the tree away
    // with nothing in its place, and the landings and Cancel with it, because
    // they live inside the tree.
    fireEvent.change(screen.getByLabelText("tree.findLabel"), {
      target: { value: "Act" },
    });
    expect(panelBody()).toBe("tree");
  });

  it("suspends the find during a move rather than folding it away", async () => {
    // The row keeps its height, because losing 30px would jump the tree at
    // the moment the writer is aiming at a landing. And
    // the field shows nothing while it is suspended — an expanded field
    // holding text above a visibly unfiltered tree is a control claiming to do
    // something it is not.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const field = findField();
    fireEvent.change(field, { target: { value: "Act" } });
    await waitFor(() => expect(panelBody()).toBe("results"));

    rowAction("EL2", "tree.move");
    await waitFor(() => expect(landings().length).toBeGreaterThan(0));
    expect(panelBody()).toBe("tree");
    expect(field.value).toBe("");
    expect(document.querySelector(".dt-find")).toBeTruthy();
    expect(document.querySelector('.dt-find[data-query="1"]')).toBeNull();

    // The query was not thrown away, only withheld: cancelling the placement
    // hands it back with its results.
    fireEvent.click(
      within(document.querySelector(".dt-moving") as HTMLElement).getByText(
        "confirm.cancel",
      ),
    );
    await waitFor(() => expect(panelBody()).toBe("results"));
    expect(findField().value).toBe("Act");
  });

  it("refuses edits while it is suspended, rather than swallowing them", async () => {
    // The field displays nothing during a placement, so accepting a keystroke
    // would put the writer's words somewhere they cannot see them.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    rowAction("EL2", "tree.move");
    await waitFor(() => expect(landings().length).toBeGreaterThan(0));

    const field = findField();
    fireEvent.change(field, { target: { value: "Opening" } });
    expect(field.value).toBe("");
    expect(panelBody()).toBe("tree");
  });
});

// ── Several at once ──────────────────────────────────────────────────────────
//
// The fixture is Act One [Opening, The Storm] and an empty Act Two. Ticking
// both Sections leaves one place they can go together, Act Two, which makes
// the panel's answers here precise rather than plural.

/** A row's own box — the tick that adds it to the selection. */
const pickOf = (id: string) =>
  within(row(id)).queryByRole("checkbox", { name: "tree.selectOne" });

const tick = (id: string) => {
  const box = pickOf(id);
  if (!box) throw new Error(`no box on ${id}`);
  fireEvent.click(box);
};

/** The selection bar, when anything is ticked and no move has the panel. */
const selectionBar = () => document.querySelector(".dt-selecting");

describe("ticking rows to move together", () => {
  it("offers a box on every row, then only on rows of the kind ticked first", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    expect(pickOf("EL1")).toBeTruthy();
    expect(pickOf("EL2")).toBeTruthy();
    expect(selectionBar()).toBeNull();

    tick("EL2");
    // A group lands in one container, and a container is one kind: a Part
    // cannot join a selection of Sections, so it is not offered.
    await waitFor(() => expect(pickOf("EL1")).toBeNull());
    expect(pickOf("EL3")).toBeTruthy();
    expect(pickOf("EL2")?.getAttribute("aria-checked")).toBe("true");
    expect(row("EL2").classList.contains("selected")).toBe(true);
    expect(row("EL3").classList.contains("selected")).toBe(false);
    expect(
      document.querySelector(".doc-tree")?.getAttribute("data-selecting"),
    ).toBe("section");
    expect(selectionBar()?.textContent).toContain("tree.selectedSections");
  });

  it("the row menu's Select is the way in that needs no hover", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    rowAction("EL2", "tree.select");
    await waitFor(() => expect(selectionBar()).toBeTruthy());
    expect(row("EL2").classList.contains("selected")).toBe(true);
  });

  it("Clear and Escape both let go of the selection", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    tick("EL2");
    await waitFor(() => expect(selectionBar()).toBeTruthy());
    fireEvent.click(
      within(selectionBar() as HTMLElement).getByRole("button", {
        name: "tree.clearSelection",
      }),
    );
    await waitFor(() => expect(selectionBar()).toBeNull());
    expect(pickOf("EL1")).toBeTruthy();

    tick("EL3");
    await waitFor(() => expect(selectionBar()).toBeTruthy());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(selectionBar()).toBeNull());
  });

  it("Move… lands the group as one block, in the book's order, with one undo", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const before = shapeOf(provider);
    // Ticked against the book's order: The Storm first.
    tick("EL3");
    await waitFor(() => expect(pickOf("EL2")).toBeTruthy());
    tick("EL2");

    fireEvent.click(
      within(selectionBar() as HTMLElement).getByRole("button", {
        name: "tree.move",
      }),
    );
    // Every position inside Act One leaves the pair where it is, and the root
    // holds Parts: Act Two is the one place they can go.
    await waitFor(() => expect(landings().length).toBe(1));
    expect(landingLabels()).toEqual(["tree.moveFirst"]);
    expect(row("EL2").getAttribute("data-moving")).toBe("1");
    expect(row("EL3").getAttribute("data-moving")).toBe("1");
    // The move's banner has the panel; the boxes and the bar give way to it.
    expect(selectionBar()).toBeNull();
    expect(pickOf("EL3")).toBeNull();
    expect(document.querySelector(".dt-moving")?.textContent).toContain(
      "tree.movingSections",
    );

    fireEvent.click(landings()[0]);
    await waitFor(() =>
      expect(childrenOf(structureOf(provider), "EL4").map((c) => c.id)).toEqual(
        ["EL2", "EL3"],
      ),
    );
    expect(childrenOf(structureOf(provider), "EL1")).toEqual([]);
    expect(screen.getByText("toast.movedSections")).toBeTruthy();
    // A group that has landed is done with.
    expect(selectionBar()).toBeNull();

    fireEvent.click(screen.getByText("toast.undo"));
    await waitFor(() => expect(shapeOf(provider)).toBe(before));
  });

  it("Escape during a group's Move… leaves the move and keeps the ticks", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    tick("EL2");
    await waitFor(() => expect(pickOf("EL3")).toBeTruthy());
    tick("EL3");
    fireEvent.click(
      within(selectionBar() as HTMLElement).getByRole("button", {
        name: "tree.move",
      }),
    );
    await waitFor(() => expect(landings().length).toBe(1));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(landings()).toEqual([]));
    expect(selectionBar()?.textContent).toContain("tree.selectedSections");
  });

  it("a ticked row's own Move… carries the group; an unticked row's moves it alone", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    tick("EL2");
    await waitFor(() => expect(selectionBar()).toBeTruthy());

    rowAction("EL3", "tree.move");
    await waitFor(() => expect(landings().length).toBeGreaterThan(0));
    expect(row("EL3").getAttribute("data-moving")).toBe("1");
    expect(row("EL2").getAttribute("data-moving")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "confirm.cancel" }));
    await waitFor(() => expect(landings()).toEqual([]));

    rowAction("EL2", "tree.move");
    await waitFor(() => expect(landings().length).toBeGreaterThan(0));
    expect(row("EL2").getAttribute("data-moving")).toBe("1");
  });

  it("dragging a ticked row carries the group, and names every row in it", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      const { provider } = await make();
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
      await waitFor(() =>
        expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
      );
      const before = shapeOf(provider);
      tick("EL2");
      await waitFor(() => expect(pickOf("EL3")).toBeTruthy());
      tick("EL3");

      fireEvent.pointerDown(row("EL2"), {
        button: 0,
        clientX: 20,
        clientY: 40,
      });
      fireEvent.pointerMove(window, { clientX: 23, clientY: 85 });
      await waitFor(() => {
        // In the book's order, one line each — not just the grabbed title.
        expect(
          [...document.querySelectorAll(".dt-ghost-list > li")].map(
            (li) => li.textContent,
          ),
        ).toEqual(["Opening", "The Storm"]);
        expect(row("EL3").classList.contains("dragging")).toBe(true);
      });
      // Escape is the drag's while it runs: it abandons the drag and leaves
      // the ticks alone.
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() =>
        expect(document.querySelector(".dt-ghost")).toBeNull(),
      );
      expect(shapeOf(provider)).toBe(before);
      expect(selectionBar()).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("dragging an unticked row moves it alone and keeps the ticks", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      const { provider } = await make();
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
      await waitFor(() =>
        expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
      );
      tick("EL3");
      await waitFor(() => expect(selectionBar()).toBeTruthy());

      // The single-drag test's gesture: Opening to after The Storm.
      fireEvent.pointerDown(row("EL2"), {
        button: 0,
        clientX: 20,
        clientY: 40,
      });
      fireEvent.pointerMove(window, { clientX: 23, clientY: 85 });
      await waitFor(() =>
        expect(document.querySelector(".dt-drop-line")).toBeTruthy(),
      );
      expect(document.querySelector(".dt-ghost-list")).toBeNull();
      fireEvent.pointerUp(window);
      await waitFor(() =>
        expect(
          childrenOf(structureOf(provider), "EL1").map((c) => c.id),
        ).toEqual(["EL3", "EL2"]),
      );
      expect(screen.getByText("toast.moved")).toBeTruthy();
      expect(row("EL3").classList.contains("selected")).toBe(true);
    } finally {
      restore();
    }
  });

  it("a press on the box ticks the row and never starts a drag", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      await make();
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
      const box = pickOf("EL2") as HTMLElement;
      fireEvent.pointerDown(box, { button: 0, clientX: 20, clientY: 40 });
      fireEvent.pointerMove(window, { clientX: 23, clientY: 85 });
      expect(document.querySelector(".dt-ghost")).toBeNull();
      fireEvent.pointerUp(window);
      fireEvent.click(box);
      await waitFor(() => expect(selectionBar()).toBeTruthy());
    } finally {
      restore();
    }
  });

  describe("a ticked Part and the Parts inside it", () => {
    // Act One holds two Parts of its own, so ticking it covers both. Act One
    // is open (its id is the props' expanded one), so its children are drawn.
    const NESTED_PARTS = `version: 1
document:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
    snapshots:
      - file: part--act_one.EL1.00.md
        title: "Act One 1"
        created: "2026-01-01T00:00:00.000Z"
    children:
      - id: EL2
        part: "Scene A"
        adopted: part--scene_a.EL2.00.md
        snapshots:
          - file: part--scene_a.EL2.00.md
            title: "Scene A 1"
            created: "2026-01-01T00:00:00.000Z"
        children: []
      - id: EL3
        part: "Scene B"
        adopted: part--scene_b.EL3.00.md
        snapshots:
          - file: part--scene_b.EL3.00.md
            title: "Scene B 1"
            created: "2026-01-01T00:00:00.000Z"
        children: []
  - id: EL4
    part: "Act Two"
    adopted: part--act_two.EL4.00.md
    snapshots:
      - file: part--act_two.EL4.00.md
        title: "Act Two 1"
        created: "2026-01-01T00:00:00.000Z"
    children: []
`;
    const makeNested = () =>
      make({
        structure: NESTED_PARTS,
        // The shared props carry `EL2` and `EL3` as Sections; here they are
        // Parts, with records of their own.
        props: (() => {
          const props = JSON.parse(PROPS);
          const record = (file: string, title: string) => [
            { file, title, created: "2026-01-01T00:00:00.000Z" },
          ];
          props.ui.lastOpened = null;
          props.snapshots.EL2 = record("part--scene_a.EL2.00.md", "Scene A 1");
          props.snapshots.EL3 = record("part--scene_b.EL3.00.md", "Scene B 1");
          return JSON.stringify(props);
        })(),
        files: {
          [filePath("part--act_one.EL1.00.md")]: "",
          [filePath("part--scene_a.EL2.00.md")]: "",
          [filePath("part--scene_b.EL3.00.md")]: "",
          [filePath("part--act_two.EL4.00.md")]: "",
        },
        open: null,
      });

    it("shows the Parts inside it ticked and locked, and moves only the Part", async () => {
      await makeNested();
      await waitFor(() => expect(screen.getByText("Scene A")).toBeTruthy());

      tick("EL1");
      await waitFor(() =>
        expect(pickOf("EL2")?.getAttribute("aria-checked")).toBe("true"),
      );
      expect(pickOf("EL2")?.getAttribute("aria-disabled")).toBe("true");
      expect(pickOf("EL3")?.getAttribute("aria-disabled")).toBe("true");
      expect(row("EL2").classList.contains("selected")).toBe(true);
      // Act Two is beside it, not inside: free to join.
      expect(pickOf("EL4")?.getAttribute("aria-disabled")).toBeNull();
      // One Part is what moves; the ones inside travel with it.
      expect(selectionBar()?.textContent).toContain("tree.selectedParts");

      // A press on a locked box changes nothing.
      fireEvent.click(pickOf("EL2") as HTMLElement);
      expect(pickOf("EL2")?.getAttribute("aria-checked")).toBe("true");

      // A nested Part has no number, so its box stands in its own indent.
      const box = pickOf("EL2")?.closest(".dt-check") as HTMLElement;
      expect(box.parentElement?.classList.contains("dt-row")).toBe(true);
      expect(box.style.left).toBe("19px");
    });

    it("absorbs a Part ticked earlier, and does not bring it back when the outer one is unticked", async () => {
      await makeNested();
      await waitFor(() => expect(screen.getByText("Scene A")).toBeTruthy());

      tick("EL2");
      await waitFor(() => expect(selectionBar()).toBeTruthy());
      tick("EL1");
      await waitFor(() =>
        expect(pickOf("EL2")?.getAttribute("aria-disabled")).toBe("true"),
      );

      tick("EL1");
      // Nothing is left ticked: Scene A was folded into Act One, not kept
      // underneath it to reappear.
      await waitFor(() => expect(selectionBar()).toBeNull());
      expect(row("EL2").classList.contains("selected")).toBe(false);
    });
  });
});

describe("the panel's find answers with the project", () => {
  it("swaps the body for results and hands the tree back when the query clears", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    expect(panelBody()).toBe("tree");

    const field = findField();
    fireEvent.change(field, { target: { value: "Opening" } });
    await waitFor(() => expect(panelBody()).toBe("results"));
    expect(
      [...document.querySelectorAll(".dt-search-row")].some((r) =>
        r.textContent?.startsWith("Opening"),
      ),
    ).toBe(true);

    fireEvent.change(field, { target: { value: "   " } });
    await waitFor(() => expect(panelBody()).toBe("tree"));
  });

  it("says how many matches there are without drawing the number", async () => {
    // The swap is the largest state change in the panel, and it reaches a
    // reader as nothing at all unless something says it. At 248px a painted
    // count would cover the writer's own query, so it is announced only.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "Opening" } });
    await waitFor(() => expect(panelBody()).toBe("results"));
    const live = document.querySelector(".ui-bar-find-live");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.textContent).toBe("tree.findCount");
    expect(live?.querySelector(".ui-visually-hidden")).toBeTruthy();
  });
});

// ── The chats' index ─────────────────────────────────────────────────────────
//
// The assistant cannot say what an answer's searchable text is: that needs
// the renderer's Markdown instance, which lives here. So the panel hands it
// the index builder (`indexText`), and builds the index only while there is
// a query, because each answer is one parse and the tree's memo re-runs on
// every edit with the search shut.

describe("the panel's find over the chats", () => {
  const SEARCHED: ChatTurn = {
    id: "a1",
    role: "assistant",
    text: "Roma cadde (web:1).",
    createdAt: "2026-09-27T00:00:00.000Z",
    outcome: "complete",
    web: [
      {
        callId: "c1",
        engine: { kind: "wikipedia" },
        status: "searched",
        query: "rome",
        results: [
          {
            id: "web:1",
            url: "https://en.wikipedia.org/wiki/Rome",
            title: "Rome",
          },
        ],
      },
    ],
  };

  it("passes the index builder to the chat search", async () => {
    const assistant = assistantTestStub();
    await make({ assistant });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "Roma" } });
    await waitFor(() =>
      expect(vi.mocked(assistant.searchDocuments)).toHaveBeenCalled(),
    );
    const [builder] = vi.mocked(assistant.searchDocuments).mock.calls[0] ?? [];
    // The builder, not a stand-in: an inert turn's citation reads as its
    // number, which only the renderer's parse can give; an identity builder
    // fails this.
    const web = webCitations([SEARCHED]).get("a1");
    const text = builder?.(SEARCHED, {
      titles: new Map(),
      web: web ?? NO_WEB_CITATIONS,
    });
    expect(text).toContain("Roma cadde[1].");
    expect(text).toContain("[1] Rome · en.wikipedia.org");
  });

  it("builds no chat index while the query is blank", async () => {
    // The memo calls `searchDocuments` only while there is a query.
    const assistant = assistantTestStub();
    await make({ assistant });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    const field = findField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "   " } });
    await act(async () => undefined);
    expect(vi.mocked(assistant.searchDocuments)).not.toHaveBeenCalled();
    // And a query does build it, so the absence above is not vacuous.
    fireEvent.change(field, { target: { value: "Opening" } });
    await waitFor(() =>
      expect(vi.mocked(assistant.searchDocuments)).toHaveBeenCalled(),
    );
  });
});

describe("the panel's find reads the writer's own words", () => {
  it("finds a phrase whose file name says nothing about it", async () => {
    // "warning" is in the prose of The Storm's adopted file and in no title
    // anywhere, so only a search of the writer's words finds it.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "warning" } });

    await waitFor(() =>
      expect(document.querySelector(".dt-search-source")).toBeTruthy(),
    );
    const source = document.querySelector(".dt-search-source");
    // The node's name heads the group; the quotations are under it, one for
    // each place the words turn up.
    expect(source?.querySelector(".dt-search-label")?.textContent).toBe(
      "The Storm",
    );
    expect(source?.querySelector(".dt-search-tally")?.textContent).toBe("1");
    // The excerpt is the writer's line, with the words they typed marked
    // inside it at the offsets the search returned.
    const quote = source?.querySelector(".dt-search-occurrence");
    expect(quote?.querySelector(".dt-search-excerpt")?.textContent).toBe(
      "It came in from the west, without warning.",
    );
    expect(quote?.querySelector("mark")?.textContent).toBe("warning");
  });

  it("reads the adopted file, and only that", async () => {
    // "darkening" lives in `section--the_storm.EL3.00.md`, a snapshot the node
    // does not adopt. Searching every snapshot would offer the writer a
    // row leading to a version of the passage they replaced — and would read
    // the whole history of the book to answer one keystroke.
    await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "darkening" } });

    await waitFor(() => expect(panelBody()).toBe("results"));
    expect(document.querySelector(".dt-search-occurrence")).toBeNull();
  });

  it("hands the surface the file, the query and the occurrence", async () => {
    // The panel finds these characters in raw markdown; the engine holds a
    // parsed `Doc`. What travels is the query, the file it was about,
    // which is also the arrival's whole lifetime, and which occurrence was
    // clicked, because the panel lists all of them.
    const onFindInText = vi.fn();
    await make({ onFindInText });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "warning" } });
    await waitFor(() =>
      expect(document.querySelector(".dt-search-occurrence")).toBeTruthy(),
    );

    const row = document.querySelector(".dt-search-occurrence");
    if (!row) throw new Error("no body row");
    fireEvent.click(row);
    expect(onFindInText).toHaveBeenCalledWith(
      "section--the_storm.EL3.01.md",
      "warning",
      0,
    );
  });

  it("ends the whole find when the writer empties the field", async () => {
    // Clearing the box is not "show me the tree again"; it is the writer
    // saying they are done with the feature, so the marks it left in their
    // prose go with it.
    const onEndFind = vi.fn();
    await make({ onEndFind });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "warning" } });
    await waitFor(() => expect(panelBody()).toBe("results"));
    expect(onEndFind).not.toHaveBeenCalled();

    fireEvent.change(findField(), { target: { value: "" } });
    expect(onEndFind).toHaveBeenCalled();
    await waitFor(() => expect(panelBody()).toBe("tree"));
  });

  it("ends an arrival when the query moves, not only when it empties", async () => {
    // An arrival's prose marks belong to the query that made them, so
    // refining "warning" to "warnin" ends them rather than leaving them lit
    // under a panel and a count that answer the new query. The first
    // keystroke into a fresh field does not fire this: there is no arrival
    // whose query equals "".
    const onEndFind = vi.fn();
    await make({ onEndFind });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "warning" } });
    await waitFor(() => expect(panelBody()).toBe("results"));
    expect(onEndFind).not.toHaveBeenCalled();

    fireEvent.change(findField(), { target: { value: "warnin" } });
    // At least once: the field-change rule fires on the keystroke and the
    // deferred-move rule fires again when the lag catches up. The
    // assertion is that the arrival ended, not a count of the messengers.
    expect(onEndFind).toHaveBeenCalled();
  });

  it("Escape with a query in the field performs the back control's act", async () => {
    // Two finds in one editor, one Escape grammar: the in-document find closes
    // mid-query, and the panel's own back control is the mouse's one-act exit —
    // so the keyboard's must be the same act, deterministic in every engine
    // rather than whatever the native search widget happens to do with Esc.
    const onEndFind = vi.fn();
    await make({ onEndFind });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "warning" } });
    await waitFor(() => expect(panelBody()).toBe("results"));

    fireEvent.keyDown(findField(), { key: "Escape" });

    expect(onEndFind).toHaveBeenCalled();
    await waitFor(() => expect(panelBody()).toBe("tree"));
    expect((findField() as HTMLInputElement).value).toBe("");
  });

  it("finds what was said in a chat, and opens that turn", async () => {
    // The chat arrives as the Assistant's document, and a click opens that
    // turn, not merely the Ask face.
    const onOpenChat = vi.fn();
    const assistant = assistantTestStub();
    vi.mocked(assistant.searchDocuments).mockReturnValue([
      {
        chatId: "chat-1",
        turnId: "turn-2",
        title: "Weather talk",
        speaker: "you",
        kind: "general",
        text: "Does the petrichor carry?",
      },
    ]);
    await make({ onOpenChat, assistant });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "petrichor" } });

    await waitFor(() =>
      expect(document.querySelector(".dt-search-quote")).toBeTruthy(),
    );
    const row = document.querySelector(".dt-search-quote");
    if (!row) throw new Error("no chat row");
    // The chat's own title, and who said it in the slot a Section's Part
    // would use, because that is what varies row to row under this heading.
    expect(row.querySelector(".dt-search-label")?.textContent).toBe(
      "Weather talk",
    );
    expect(row.querySelector(".dt-search-where")?.textContent).toBe("dock.you");
    expect(row.querySelector("mark")?.textContent).toBe("petrichor");

    fireEvent.click(row);
    expect(onOpenChat).toHaveBeenCalledWith("chat-1", "turn-2");
  });

  it("says both what a node is called and where its prose says it", async () => {
    // A node whose name matches is listed by the body group too: the body
    // group lists every occurrence, so its row repeats nothing. Names
    // come first, which is the ranking and the only one.
    await make({
      files: {
        ...DEFAULT_FILES,
        [filePath("section--the_storm.EL3.01.md")]:
          "The storm came in from the west, without warning.\n",
      },
    });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "storm" } });

    await waitFor(() => expect(panelBody()).toBe("results"));
    const labels = [...document.querySelectorAll(".dt-search-label")].map(
      (el) => el.textContent,
    );
    // Once under Structure, once as the source of its own quotation.
    expect(labels.filter((l) => l === "The Storm")).toHaveLength(2);
    expect(document.querySelector(".dt-search-occurrence")).toBeTruthy();
  });
});

describe("a finger never drags the tree", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Identical to the mouse drag above in every respect but `pointerType`,
  // which is the whole claim.
  it("a touch pointer does not arm the gesture, and writes nothing", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      const { provider } = await make();
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
      await waitFor(() =>
        expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
      );
      const before = shapeOf(provider);

      fireEvent.pointerDown(row("EL2"), {
        button: 0,
        pointerType: "touch",
        clientX: 20,
        clientY: 40,
      });
      fireEvent.pointerMove(window, { clientX: 23, clientY: 85 });
      fireEvent.pointerUp(window);

      // No ghost, no drop line, and no write: a scroll that moved a chapter
      // would do it silently.
      expect(document.querySelector(".dt-ghost")).toBeNull();
      expect(document.querySelector(".dt-drop-line")).toBeNull();
      expect(shapeOf(provider)).toBe(before);
      expect(screen.queryByText("toast.moved")).toBeNull();
    } finally {
      restore();
    }
  });

  it("a mouse on the same row still drags", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      await make();
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
      await waitFor(() =>
        expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
      );

      // The refusal is about the pointer, not about the tree: a laptop with a
      // touch screen keeps its mouse drag.
      fireEvent.pointerDown(row("EL2"), {
        button: 0,
        pointerType: "mouse",
        clientX: 20,
        clientY: 40,
      });
      fireEvent.pointerMove(window, { clientX: 23, clientY: 85 });
      await waitFor(() =>
        expect(document.querySelector(".dt-ghost")?.textContent).toBe(
          "Opening",
        ),
      );
      fireEvent.pointerUp(window);
    } finally {
      restore();
    }
  });
});

// ── The recycle bin ──────────────────────────────────────────────────────────

describe("the recycle bin", () => {
  // A project that already has `Opening` in the bin: the yaml's `removed:` list
  // records it, and the file lives in `/recyclebin` rather than `document/`.
  const WITH_REMOVED = `# Phospheare — document structure
# The order of this list is the order of the finished document.
# Phospheare rewrites this file when the structure changes; comments below are not preserved.
version: 1
document:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
    snapshots:
      - file: part--act_one.EL1.00.md
        title: "Act One 1"
        created: "2026-01-01T00:00:00.000Z"
    children:
      - id: EL3
        section: "The Storm"
        adopted: section--the_storm.EL3.01.md
        snapshots:
          - file: section--the_storm.EL3.00.md
            title: "The Storm 1"
            created: "2026-01-01T00:00:00.000Z"
          - file: section--the_storm.EL3.01.md
            title: "The Storm 2"
            created: "2026-02-01T00:00:00.000Z"
  - id: EL4
    part: "Act Two"
    adopted: part--act_two.EL4.00.md
    snapshots:
      - file: part--act_two.EL4.00.md
        title: "Act Two 1"
        created: "2026-01-01T00:00:00.000Z"
    children: []
removed:
  - id: EL2
    section: "Opening"
    adopted: section--opening.EL2.00.md
    snapshots:
      - file: section--opening.EL2.00.md
        title: "Opening 1"
        created: "2026-01-01T00:00:00.000Z"
`;
  const files = { ...DEFAULT_FILES };
  delete files[filePath("section--opening.EL2.00.md")];
  files["/recyclebin/section--opening.EL2.00.md"] =
    "The house had been empty for a year.\n";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The bin is empty in most projects, and an empty bin is not a toggle: no
  // caret, no expand affordance — the body stays open as the drop target.
  it("an empty bin is not a toggle: no expand caret", async () => {
    await make();
    await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());
    expect(document.querySelector(".dt-bin-caret")).toBeNull();
    expect(document.querySelector(".dt-bin-head")?.tagName).toBe("DIV");
  });

  it("renders one flat row per removed top-level node, no structure", async () => {
    await make({ structure: WITH_REMOVED, files });
    await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());
    const rows = [...document.querySelectorAll(".dt-bin-row")];
    expect(rows.map((r) => r.textContent)).toEqual(["Opening"]);
    // The bin holds something, so its head is a toggle again.
    expect(document.querySelector(".dt-bin-caret")).toBeTruthy();
  });

  // ── The reference half of the one bin ──────────────────────────────────────
  //
  // `recyclebin/` is one folder holding both sets, so it has one view: two
  // views of it, each missing half of what the writer deleted, is what a
  // writer cannot be asked to hold in their head.
  it("lists a binned reference document beside the removed chapters", async () => {
    const withRef = { ...files };
    withRef["/recyclebin/character--maren.md"] = "# Maren\n";
    await make({ structure: WITH_REMOVED, files: withRef });
    await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());
    fireEvent.click(document.querySelector(".dt-bin-head") as HTMLElement);
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".dt-bin-row")].map(
          (r) => r.querySelector(".dt-bin-title")?.textContent,
        ),
      ).toEqual(["Opening", "maren"]),
    );
    // Both kinds counted, because it is one bin.
    expect(document.querySelector(".dt-bin-n")?.textContent).toBe("2");
    // Grouped by type, so a writer looking for a deleted character looks
    // under Characters rather than through one long list. Headings, not
    // folders: storage is still one flat `recyclebin/`.
    expect(
      [...document.querySelectorAll(".dt-bin-group")].map((g) => g.textContent),
    ).toEqual(["bin.groupStructure", "reference.group.characters"]);
  });

  it("puts a binned reference document back with one press", async () => {
    // One move back into the reference folder, and no landing to choose: a
    // reference document has no slot, which is why its row is a
    // button where a chapter's opens a list of destinations.
    const withRef = { ...files };
    withRef["/recyclebin/character--maren.md"] = "# Maren\n";
    const { provider } = await make({
      structure: WITH_REMOVED,
      files: withRef,
    });
    await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());
    fireEvent.click(document.querySelector(".dt-bin-head") as HTMLElement);
    const row = await waitFor(() => {
      const found = [...document.querySelectorAll(".dt-bin-row")].find((one) =>
        one.textContent?.includes("maren"),
      );
      if (!found) throw new Error("no reference row");
      return found as HTMLElement;
    });
    fireEvent.click(within(row).getByRole("button"));
    await waitFor(() =>
      expect(provider.moveFile).toHaveBeenCalledWith(
        expect.anything(),
        "/recyclebin/character--maren.md",
        "/reference",
      ),
    );
  });

  it("says so when a reference restore is refused, instead of swallowing it", async () => {
    const withRef = { ...files };
    withRef["/recyclebin/character--maren.md"] = "# Maren\n";
    await make({
      structure: WITH_REMOVED,
      files: withRef,
      before: (p) => {
        p.moveFile.mockImplementation(async () => {
          throw new Error("unreachable");
        });
      },
    });
    await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());
    fireEvent.click(document.querySelector(".dt-bin-head") as HTMLElement);
    const row = await waitFor(() => {
      const found = [...document.querySelectorAll(".dt-bin-row")].find((one) =>
        one.textContent?.includes("maren"),
      );
      if (!found) throw new Error("no reference row");
      return found as HTMLElement;
    });
    fireEvent.click(within(row).getByRole("button"));
    await waitFor(() =>
      expect(screen.getByText("reference.restoreFailed")).toBeTruthy(),
    );
  });

  // The drag's twin, and the only route a finger has, since the gesture
  // refuses touch pointers. Same mode as the tree's `Move…`, same landings —
  // a different legality rule underneath (`canRestore`, which also refuses a
  // name already taken), which the writer never has to know.
  it("a bin row puts a node back through the same landings", async () => {
    const { provider } = await make({ structure: WITH_REMOVED, files });
    await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());
    fireEvent.click(document.querySelector(".dt-bin-head") as HTMLElement);

    fireEvent.click(
      within(
        document.querySelector(".dt-bin-row") as HTMLElement,
      ).getByLabelText("bin.restore"),
    );
    await waitFor(() => expect(landings().length).toBeGreaterThan(0));

    // Act One holds only The Storm now, so both of its gaps are open — the
    // node is nowhere yet, so nothing is a no-op.
    expect(landingLabels()).toEqual([
      "tree.moveFirst",
      "tree.moveAfter",
      "tree.moveFirst",
    ]);

    fireEvent.click(landings()[1]);
    await waitFor(() =>
      expect(screen.getByText("toast.restored")).toBeTruthy(),
    );
    const structure = structureOf(provider);
    expect(childrenOf(structure, "EL1").map((c) => c.id)).toEqual([
      "EL3",
      "EL2",
    ]);
    expect(provider.files.has(filePath("section--opening.EL2.00.md"))).toBe(
      true,
    );
    expect(structure.removed).toEqual([]);
  });

  // The unlinked are the footnote of the structure, not its headline: a
  // populated bin opens folded, and the head's caret flips it open.
  it("a populated bin starts collapsed, and the head opens it", async () => {
    await make({ structure: WITH_REMOVED, files });
    await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());
    const bin = document.querySelector(".dt-bin") as HTMLElement;
    const head = document.querySelector(".dt-bin-head") as HTMLElement;
    expect(bin.getAttribute("data-open")).toBe("0");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    expect(bin.getAttribute("data-open")).toBe("1");
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  it("a removal lands in the bin, and undo brings it out again", async () => {
    const { provider } = await make();
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    rowAction("EL2", "tree.remove");
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "bin.moveTo" }));
    await waitFor(() => expect(screen.getByText("toast.removed")).toBeTruthy());
    expect(provider.files.has("/recyclebin/section--opening.EL2.00.md")).toBe(
      true,
    );
    const rows = [...document.querySelectorAll(".dt-bin-row")];
    expect(rows.map((r) => r.textContent)).toEqual(["Opening"]);

    fireEvent.click(screen.getByText("toast.undo"));
    await waitFor(() => expect(screen.queryByText("Opening")).toBeTruthy());
    expect(document.querySelector(".dt-bin-row")).toBeNull();
  });

  it("dragging a tree node onto the bin arms it and deletes on drop", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      const { provider } = await make();
      await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());

      fireEvent.pointerDown(row("EL2"), {
        button: 0,
        clientX: 20,
        clientY: 40,
      });
      fireEvent.pointerMove(window, { clientX: 10, clientY: 230 });
      // Over the bin: no insertion line, and the bin is armed as a delete
      // target.
      expect(document.querySelector(".dt-drop-line")).toBeNull();
      expect(
        document.querySelector(".dt-bin")?.classList.contains("armed"),
      ).toBe(true);

      fireEvent.pointerUp(window);
      // A drop on the bin asks the same question the Remove item would.
      await screen.findByRole("alertdialog");
      fireEvent.click(screen.getByRole("button", { name: "bin.moveTo" }));
      await waitFor(() =>
        expect(screen.getByText("toast.removed")).toBeTruthy(),
      );
      expect(provider.files.has("/recyclebin/section--opening.EL2.00.md")).toBe(
        true,
      );
      expect(
        document.querySelector(".dt-bin")?.classList.contains("armed"),
      ).toBe(false);
    } finally {
      restore();
    }
  });

  it("dragging a bin row onto the tree restores it at the slot", async () => {
    const restore = stubGeometry({
      // The project's own shape: `Opening` is in the bin, so the tree is one
      // row shorter than the shared fixture's geometry assumes.
      EL1: { top: 0, bottom: 30 },
      EL3: { top: 30, bottom: 60 },
      EL4: { top: 60, bottom: 90 },
    });
    try {
      const { provider } = await make({ structure: WITH_REMOVED, files });
      await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());
      // Same deferred-expand timing as the tree-drag test: the bin-restore
      // insertion math flattens the tree as it stands in state, so the expand
      // effect must have committed before the gesture.
      await waitFor(() =>
        expect(row("EL1").getAttribute("aria-expanded")).toBe("true"),
      );
      const binRow = document.querySelector(".dt-bin-row") as HTMLElement;

      fireEvent.pointerDown(binRow, { button: 0, clientX: 10, clientY: 220 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 45 });
      await waitFor(() =>
        expect(document.querySelector(".dt-drop-line")).toBeTruthy(),
      );

      fireEvent.pointerUp(window);
      await waitFor(() =>
        expect(screen.getByText("toast.restored")).toBeTruthy(),
      );
      const structure = structureOf(provider);
      // Dropped after `The Storm` inside Act One — where the pointer aimed.
      expect(childrenOf(structure, "EL1").map((c) => c.id)).toEqual([
        "EL3",
        "EL2",
      ]);
      expect(provider.files.has(filePath("section--opening.EL2.00.md"))).toBe(
        true,
      );
      expect(structure.removed).toEqual([]);
    } finally {
      restore();
    }
  });

  it("a bin drag that lands back on the bin restores nothing", async () => {
    const restore = stubGeometry(ROW_GEO);
    try {
      await make({ structure: WITH_REMOVED, files });
      await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());
      const binRow = document.querySelector(".dt-bin-row") as HTMLElement;

      fireEvent.pointerDown(binRow, { button: 0, clientX: 10, clientY: 220 });
      fireEvent.pointerMove(window, { clientX: 10, clientY: 230 });
      fireEvent.pointerUp(window);
      // Back where it came from: no restore, no toast, nothing written.
      expect(screen.queryByText("toast.restored")).toBeNull();
      expect(document.querySelector(".dt-bin-row")).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("— putting a bin hit back from the search face leaves a body on screen", async () => {
    await make({ structure: WITH_REMOVED, files });
    await waitFor(() => expect(screen.getByText("bin.label")).toBeTruthy());

    // The face's own route to a restore, and the reason the bin is searched at
    // all: a bin hit begins the same placement the bin row's button begins.
    fireEvent.change(screen.getByLabelText("tree.findLabel"), {
      target: { value: "Opening" },
    });
    await waitFor(() => expect(panelBody()).toBe("results"));
    const face = document.querySelector(".dt-search") as HTMLElement;
    fireEvent.click(
      within(face).getByText("Opening").closest("button") as HTMLElement,
    );

    // Entering the placement un-mounts the face — correct, the placement owns
    // the panel — but the writer's query is still in the field, so the
    // stylesheet is still hiding the tree it was meant to hand back.
    await waitFor(() =>
      expect(document.querySelector(".dt-moving")).toBeTruthy(),
    );
    expect(panelBody()).toBe("tree");
  });
});

// ── Name field ───────────────────────────────────────────────────────────────

describe("NameInput", () => {
  it("Enter commits a valid name", async () => {
    const onCommit = vi.fn();
    render(
      <NameInput
        kind="section"
        depth={0}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByLabelText("tree.sectionName");
    fireEvent.change(input, { target: { value: "Arrival" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Arrival");
  });

  it("Enter accepts a name another node already carries", async () => {
    // Titles are free: a second "Opening" is the writer's choice, and
    // its file differs from the first by the node id.
    const onCommit = vi.fn();
    render(
      <NameInput
        kind="section"
        depth={0}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByLabelText("tree.sectionName");
    fireEvent.change(input, { target: { value: "Opening: Again" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Opening: Again");
  });

  it("Enter refuses a name over the length limit", async () => {
    const onCommit = vi.fn();
    render(
      <NameInput
        kind="section"
        depth={0}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByLabelText("tree.sectionName");
    fireEvent.change(input, { target: { value: "x".repeat(121) } });
    expect((input as HTMLInputElement).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByRole("alert").textContent).toBe("name.tooLong");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape cancels", async () => {
    const onCancel = vi.fn();
    render(
      <NameInput
        kind="part"
        depth={1}
        onCommit={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("tree.partName"), {
      key: "Escape",
    });
    expect(onCancel).toHaveBeenCalled();
  });

  it("blur commits a good name", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <NameInput
        kind="section"
        depth={0}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByLabelText("tree.sectionName");
    fireEvent.change(input, { target: { value: "Arrival" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("Arrival");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("blur discards a bad name", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <NameInput
        kind="section"
        depth={0}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByLabelText("tree.sectionName");
    fireEvent.change(input, { target: { value: "x".repeat(121) } });
    fireEvent.blur(input);
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // A Section name is a label in the tree, not prose — a browser squiggle
  // would be judging a heading the writer chose.
  it("never hands the name to the browser spellchecker", () => {
    render(
      <NameInput
        kind="section"
        depth={0}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByLabelText("tree.sectionName").getAttribute("spellcheck"),
    ).toBe("false");
  });
});

// ── The project's own facts ──────────────────────────────────────────────────
//
// Structure, language, type and genre as `document-properties.json` records
// them, at the bottom of the panel. Tags, not controls: none of them is
// editable here — every fact the wizard asked is changed from the Library
// card's Properties window — and the goal is absent: it
// belongs to the shelf card, where it can mean progress rather than a bare
// number.

describe("the project facts tags", () => {
  // `tree.structure` also names the region heading, so the tags row itself —
  // `.dt-meta` — is the only unambiguous way to reach these.
  const metaRow = () =>
    waitFor(() => {
      const meta = document.querySelector(".dt-meta");
      expect(meta).toBeTruthy();
      return meta as HTMLElement;
    });

  it("names structure, language, type and genre as readonly tags", async () => {
    await make();
    const meta = await metaRow();

    // The mocked `t` echoes keys; the language label is resolved for real.
    expect(within(meta).getByText("create.shape.threeact")).toBeTruthy();
    expect(within(meta).getByText("settings.language")).toBeTruthy();
    expect(within(meta).getByText("English")).toBeTruthy();
    expect(within(meta).getByText("create.typeLabel")).toBeTruthy();
    // The type is named in the reader's language, as the wizard names it.
    expect(within(meta).getByText("create.typeName.novel")).toBeTruthy();

    expect(within(meta).getByText("genre.label")).toBeTruthy();
    expect(within(meta).getByText("genre.unsaid")).toBeTruthy();

    // Readonly: no tag is a button or an input — there is no second editing
    // mechanism hiding in the row, the genre included.
    expect(meta.querySelector("button, input, select")).toBeNull();
  });

  it("names a declared genre and its blend, lead first", async () => {
    await make({
      props: PROPS.replace(
        '"goal": 4800,',
        '"goal": 4800, "genres": ["horror", "romance"],',
      ),
    });
    const meta = await metaRow();
    expect(
      within(meta).getByText("genre.name.horror + genre.name.romance"),
    ).toBeTruthy();
  });

  it("shows No structure for a project created without one", async () => {
    await make({
      props: PROPS.replace('"structure": "threeact"', '"structure": null'),
    });
    const meta = await metaRow();
    expect(within(meta).getByText("create.shape.empty")).toBeTruthy();
  });

  it("shows the stored words verbatim when the type is custom", async () => {
    await make({
      props: PROPS.replace('"type": "Novel"', '"type": "Screenplay"'),
    });
    const meta = await metaRow();
    expect(within(meta).getByText("Screenplay")).toBeTruthy();
  });

  it("never shows the goal", async () => {
    await make();
    const meta = await metaRow();
    expect(screen.queryByText("4800")).toBeNull();
    expect(within(meta).queryByText(/goal/i)).toBeNull();
  });
});

// ── Preferences the phone does not honour ────────────────────────────────────
//
// Both stay in the panel wearing the writer's own stored value: the setting is
// still in force at their desk, and one project file serves both. On the
// phone they are dimmed and pressing either says why — a control that went
// quiet would read as a broken switch, and the writer would try it again on
// the next project.

describe("the preferences the phone plane does not honour", () => {
  const gear = () =>
    screen.getByRole("button", { name: "tree.writingPreferences" });

  /**
   * Open the settings and wait for them, whichever surface holds them.
   *
   * On the phone the settings are a bottom sheet and the desk's anchored
   * popover is not rendered at all, so the wait is on the settings
   * themselves rather than on the box around them. Every claim below is about
   * the controls, not the container they arrive in.
   */
  async function openPrefs() {
    fireEvent.click(gear());
    await waitFor(() => expect(typewriter()).toBeTruthy());
    await act(async () => {});
  }

  // jsdom's own `matchMedia` answers false to everything, which is the desk —
  // so it has to be put back, or the desk test below inherits the phone from
  // whichever test ran before it.
  const realMatchMedia = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  ) as PropertyDescriptor;
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", realMatchMedia);
  });

  /** A window on the phone plane — both plane queries answer yes, as a real
   *  phone does: it is narrow and it is a phone. */
  function phoneWindow() {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        media: query,
        matches: query.includes("720") || query.includes("1015.98"),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  }

  const typewriter = () =>
    screen.getByRole("checkbox", { name: "tree.typewriter" });
  const focusLine = () =>
    screen.getByRole("button", { name: "tree.focusLine" });
  const toast = () => document.querySelector(".dt-toast");

  it("dims both without disabling either", async () => {
    phoneWindow();
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    // `aria-disabled`, never `disabled`. A disabled button fires no click, so
    // a control that has something to say cannot be one — and it stays
    // focusable, which is how a screen reader reaches the explanation at all.
    for (const el of [typewriter(), focusLine()]) {
      expect(el.getAttribute("aria-disabled")).toBe("true");
      expect(el.hasAttribute("disabled")).toBe(false);
    }
  });

  it("answers a press with the reason rather than with nothing", async () => {
    phoneWindow();
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    fireEvent.click(typewriter());
    await waitFor(() => expect(toast()).toBeTruthy());
    expect(toast()?.textContent).toContain("toast.desktopOnly");
    // And it is not the "for this project only" toast that a real toggle
    // arms — nothing was changed, so nothing is offered to undo.
    expect(toast()?.textContent).not.toContain("toast.setting");
    expect(
      toast()?.querySelector(".dt-toast-undo"),
      "nothing happened, so there is nothing to take back",
    ).toBeNull();
  });

  it("locks Henosis too, and says why on a press", async () => {
    phoneWindow();
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    const henosis = screen.getByRole("checkbox", { name: "tree.henosis" });
    expect(henosis.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(henosis);
    await waitFor(() => expect(toast()).toBeTruthy());
    expect(toast()?.textContent).toContain("toast.desktopOnly");
  });

  it("says it for the focus track too", async () => {
    phoneWindow();
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();

    fireEvent.click(focusLine());
    await waitFor(() => expect(toast()).toBeTruthy());
    expect(toast()?.textContent).toContain("toast.desktopOnly");
    // The track still reports the stored value: Off, because the demo project
    // has no override. Pressing Line did not move it.
    expect(
      screen
        .getByRole("button", { name: "tree.focusOff" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(focusLine().getAttribute("aria-pressed")).toBe("false");
  });

  it("leaves both live at a desk, which is the state every other test is in", async () => {
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    expect(typewriter().getAttribute("aria-disabled")).toBeNull();
    expect(focusLine().getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(typewriter());
    await waitFor(() => expect(toast()).toBeTruthy());
    // The real toggle, and its own toast — the divergence one, not the refusal.
    expect(toast()?.textContent).toContain("toast.settingOn");
  });

  it("does not touch the other four", async () => {
    // The phone is not a reduced editor: prose size, the smooth caret and
    // autosave mean the same thing here, and autosave means more, since a
    // phone browser discards a backgrounded tab whenever it wants the memory.
    phoneWindow();
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    await openPrefs();
    // The two ticks are checkboxes; the prose size is a track button.
    for (const [role, name] of [
      ["checkbox", "tree.smoothCaret"],
      ["checkbox", "toolbar.autosave"],
      ["button", "tree.proseSizeSmall"],
    ] as const) {
      expect(
        screen.getByRole(role, { name }).getAttribute("aria-disabled"),
        name,
      ).toBeNull();
    }
  });
});

// ── The panel as a sheet ─────────────────────────────────────────────────────
//
// On the phone plane the panel is a modal over the manuscript rather than a
// column beside it, and two things follow that are not decoration. The fold
// control becomes a close, because a rail is a width and a sheet has no width
// to give back. And the way back to the shelf appears in the head: the phone
// hides the titlebar to give the top of the window to the manuscript,
// and the titlebar is where that link lives — a writer who could not reach it
// would be shut inside the project.

describe("the panel as a sheet", () => {
  it("offers a close where the fold used to be", async () => {
    await make({ sheet: true });
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    const close = screen.getByRole("button", { name: "tree.closePanel" });
    // Not `aria-expanded`: a sheet is open or gone, and a control that
    // reported "expanded" would be describing a width it does not have.
    expect(close.getAttribute("aria-expanded")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "tree.collapsePanel" }),
    ).toBeNull();
  });

  it("carries the way back the titlebar no longer can", async () => {
    await make({ sheet: true, backTo: "/app", backLabel: "Back" });
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    const back = screen.getByRole("link", { name: "Back" });
    expect(back.getAttribute("href")).toBe("/app");
  });

  it("draws no way back where the titlebar still carries one", async () => {
    // The desk keeps its titlebar, and two links to the same shelf on one
    // screen is the same fact twice.
    await make();
    await waitFor(() => expect(screen.getByRole("treegrid")).toBeTruthy());
    expect(document.querySelector(".dt-back")).toBeNull();
    expect(
      screen.getByRole("button", { name: "tree.collapsePanel" }),
    ).toBeTruthy();
  });
});

// ── The panel's resize grip ──────────────────────────────────────────────────
//
// The dock's contract on the other edge. What is pinned here is the sign (the
// panel is pinned left, so it grows as the pointer moves right — the mirror of
// the dock, and the one thing a shared hook could get backwards) and the three
// views that have no width for the writer to set.

describe("the panel's resize grip", () => {
  const grip = () => document.querySelector(".panel-resize") as HTMLElement;

  it("offers a grip on the wide plane, labelled and reachable by keyboard", async () => {
    await make();
    expect(grip()).toBeTruthy();
    expect(grip().getAttribute("role")).toBe("separator");
    expect(grip().getAttribute("aria-orientation")).toBe("vertical");
    expect(grip().getAttribute("aria-label")).toBe("tree.resize");
    expect(grip().tabIndex).toBe(0);
  });

  it("points at the panel it sizes, and says where its edge stands", async () => {
    // The half of the splitter contract that cannot be pinned on the hook: the
    // element `aria-controls` names has to exist. A dangling id is announced
    // as nothing at all, and nothing fails when it rots, so it survives a
    // refactor while misdescribing the page.
    await make({ width: 248 });
    const controls = grip().getAttribute("aria-controls");
    expect(controls).toBe(STRUCTURE_PANEL_ID);
    expect(document.getElementById(STRUCTURE_PANEL_ID)).toBe(
      document.querySelector(".doc-tree"),
    );
    expect(grip().getAttribute("aria-valuenow")).toBe("248");
    expect(grip().getAttribute("aria-valuemin")).toBe(String(MIN_PANEL_W));
    expect(grip().getAttribute("aria-valuemax")).toBe(String(MAX_PANEL_W));
  });

  it("grows the panel as the pointer moves right, and persists once on release", async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    await make({ width: 248, onResize, onResizeEnd });

    fireEvent.pointerDown(grip(), { button: 0, clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 340 });
    expect(onResize).toHaveBeenLastCalledWith(288);
    fireEvent.pointerMove(window, { clientX: 380 });
    expect(onResize).toHaveBeenLastCalledWith(328);
    // The persist is the release, not the drag.
    expect(onResizeEnd).not.toHaveBeenCalled();

    fireEvent.pointerUp(window);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledWith(328);
  });

  it("keeps the drag inside the panel's limits", async () => {
    const onResizeEnd = vi.fn();
    await make({ width: 248, onResizeEnd });
    fireEvent.pointerDown(grip(), { button: 0, clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 5000 });
    fireEvent.pointerUp(window);
    expect(onResizeEnd).toHaveBeenCalledWith(MAX_PANEL_W);

    fireEvent.pointerDown(grip(), { button: 0, clientX: 300 });
    fireEvent.pointerMove(window, { clientX: -5000 });
    fireEvent.pointerUp(window);
    expect(onResizeEnd).toHaveBeenLastCalledWith(MIN_PANEL_W);
  });

  it("steps by the arrow keys and jumps to the limits", async () => {
    const onResizeEnd = vi.fn();
    await make({ width: 248, onResizeEnd });
    fireEvent.keyDown(grip(), { key: "ArrowRight" });
    expect(onResizeEnd).toHaveBeenLastCalledWith(272);
    fireEvent.keyDown(grip(), { key: "ArrowLeft" });
    expect(onResizeEnd).toHaveBeenLastCalledWith(224);
    fireEvent.keyDown(grip(), { key: "End" });
    expect(onResizeEnd).toHaveBeenLastCalledWith(MAX_PANEL_W);
    fireEvent.keyDown(grip(), { key: "Home" });
    expect(onResizeEnd).toHaveBeenLastCalledWith(MIN_PANEL_W);
  });

  // The rail is a different view rather than a narrow panel, and the sheet is
  // the screen — neither has a width the writer can set from an edge.
  it("offers no grip in the rail", async () => {
    await make({ rail: true });
    expect(grip()).toBeNull();
  });

  it("offers no grip in the phone sheet", async () => {
    await make({ sheet: true });
    expect(grip()).toBeNull();
  });
});

// ── The sheet clears what it opened ──────────────────────────────────────────
//
// On the phone this panel is a modal cover over the manuscript, so
// once it opens something it closes, rather than leaving the writer looking
// at the tree after picking what to read.
//
// One rule rather than a search special case, since two ways to open a
// Section on one surface with different results is drift, so these rows walk
// all five routes out.

describe("the structure sheet, once it has opened something", () => {
  async function sheetWith(over: Partial<MakeOptions> = {}) {
    const onToggleCollapse = vi.fn();
    await make({ sheet: true, onToggleCollapse, ...over });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    return onToggleCollapse;
  }

  it("closes when a Section is opened from the tree", async () => {
    const onToggleCollapse = await sheetWith();
    fireEvent.click(screen.getByRole("button", { name: "The Storm" }));
    expect(onToggleCollapse).toHaveBeenCalled();
  });

  it("stays exactly where it is when it is a column, not a cover", async () => {
    // The desk's panel gives no width back and has no manuscript to uncover.
    // The one property that keeps this a plane decision rather than a new
    // behaviour everywhere.
    const onToggleCollapse = vi.fn();
    await make({ onToggleCollapse });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "The Storm" }));
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it("closes on a name found by the search", async () => {
    const onToggleCollapse = await sheetWith();
    fireEvent.change(findField(), { target: { value: "storm" } });
    await waitFor(() => expect(panelBody()).toBe("results"));
    fireEvent.click(screen.getAllByRole("button", { name: /The Storm/ })[0]);
    expect(onToggleCollapse).toHaveBeenCalled();
  });

  it("closes on a phrase found in the writer's own prose", async () => {
    // The marks are painted on the words behind the sheet, so a sheet that
    // stayed up would hide the whole answer.
    const onToggleCollapse = await sheetWith();
    fireEvent.change(findField(), { target: { value: "warning" } });
    await waitFor(() =>
      expect(document.querySelector(".dt-search-occurrence")).toBeTruthy(),
    );
    const row = document.querySelector(".dt-search-occurrence");
    if (!row) throw new Error("no body row");
    fireEvent.click(row);
    expect(onToggleCollapse).toHaveBeenCalled();
  });

  it("closes BEFORE the dock arrives, on a chat", async () => {
    // The dock is a modal sheet on this plane too, so a close that followed
    // the open would be two scrims over one another, a state the phone's
    // modal sheets never reach.
    const order: string[] = [];
    const onOpenChat = vi.fn(() => void order.push("chat"));
    const onToggleCollapse = vi.fn(() => void order.push("close"));
    const assistant = assistantTestStub();
    vi.mocked(assistant.searchDocuments).mockReturnValue([
      {
        chatId: "chat-1",
        turnId: "turn-2",
        title: "Weather talk",
        speaker: "you",
        kind: "general",
        text: "Does the petrichor carry?",
      },
    ]);
    await make({ sheet: true, onToggleCollapse, onOpenChat, assistant });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "petrichor" } });
    await waitFor(() =>
      expect(document.querySelector(".dt-search-quote")).toBeTruthy(),
    );
    const row = document.querySelector(".dt-search-quote");
    if (!row) throw new Error("no chat row");
    fireEvent.click(row);
    expect(order).toEqual(["close", "chat"]);
  });

  it("closes before the dock arrives on a reference document too", async () => {
    const order: string[] = [];
    const onOpenReference = vi.fn(() => void order.push("reference"));
    const onToggleCollapse = vi.fn(() => void order.push("close"));
    await make({
      sheet: true,
      onToggleCollapse,
      onOpenReference,
      files: {
        ...DEFAULT_FILES,
        "/reference/character--Petrichor.md": "A smell of rain.\n",
      },
    });
    await waitFor(() => expect(screen.getByText("Opening")).toBeTruthy());
    fireEvent.change(findField(), { target: { value: "petrichor" } });
    await waitFor(() => expect(panelBody()).toBe("results"));
    fireEvent.click(screen.getAllByRole("button", { name: /Petrichor/ })[0]);
    expect(order).toEqual(["close", "reference"]);
  });

  it("closes when the notes face is asked for", async () => {
    const order: string[] = [];
    const onOpenNotesTab = vi.fn(() => void order.push("notes"));
    const onToggleCollapse = vi.fn(() => void order.push("close"));
    await make({ sheet: true, onToggleCollapse, onOpenNotesTab });
    await waitFor(() =>
      expect(screen.getByText("reference.group.notes")).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "reference.group.notes" }),
    );
    expect(order).toEqual(["close", "notes"]);
  });

  it("closes when the reference face is asked for", async () => {
    const order: string[] = [];
    const onOpenReferenceTab = vi.fn(() => void order.push("reference"));
    const onToggleCollapse = vi.fn(() => void order.push("close"));
    await make({ sheet: true, onToggleCollapse, onOpenReferenceTab });
    await waitFor(() =>
      expect(screen.getByText("tree.reference")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "tree.reference" }));
    expect(order).toEqual(["close", "reference"]);
  });
});
