// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom

// The snapshot face's suite: the table (newest first, tick on adopted, hover
// Adopt), the verbs (add, adopt, re-title, delete), the save-first gates, and
// the divider. The comparing half of the face (a selected snapshot shown as a
// read-only diff in the main editor) belongs to the engine and has its own
// suite there.
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
import {
  ProjectProvider,
  useProjectActions,
  useProjectState,
} from "../ProjectContext";
import { EditorEngine } from "../views/engine";
import {
  FakeProvider,
  structureOf,
  withRecords,
  seedRecords,
  seedFile,
} from "../project.fixture";
import {
  filePath,
  historyPath,
  PROPERTIES_FILE,
  STRUCTURE_FILE,
} from "../../project/naming";
import SnapshotPanel from "./SnapshotPanel";
import LeaveDialog from "./LeaveDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const PROPS = `{
  "schemaVersion": 1,
  "document": {
    "id": "doc-1",
    "title": "Once Dark",
    "type": "novel",
    "language": "en",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "sync": null,
  "ui": { "expanded": [], "lastOpened": "EL3" },
  "stats": { "words": 0, "parts": 0, "sections": 0, "countedAt": "2026-01-01T00:00:00.000Z", "perNode": [] }
}
`;

const STRUCTURE = `version: 1
document:
  - id: EL1
    part: Act One
    adopted: part--act_one.EL1.00.md
    snapshots:
      - file: part--act_one.EL1.00.md
        title: Act One 1
        created: 2026-01-01T00:00:00.000Z
    children:
      - id: EL3
        section: The Storm
        adopted: section--the_storm.EL3.01.md
        snapshots:
          - file: section--the_storm.EL3.00.md
            title: The Storm 1
            created: 2026-08-14T09:12:00.000Z
          - file: section--the_storm.EL3.01.md
            title: The Storm 2
            created: 2026-08-15T08:00:00.000Z
`;

const FILES: Record<string, string> = {
  [filePath("part--act_one.EL1.00.md")]: "# Act One\n",
  [filePath("section--the_storm.EL3.00.md")]:
    "It came in from the south, a slow darkening.\n",
  [filePath("section--the_storm.EL3.01.md")]:
    "It came in from the west, without warning, and by four the lane was gone.\n",
};

async function make({
  files = FILES,
  before,
  onCompare,
  compareExits = 0,
  open = "section--the_storm.EL3.01.md",
}: {
  files?: Record<string, string>;
  before?: (provider: FakeProvider) => void;
  onCompare?: (info: unknown) => void;
  compareExits?: number;
  /**
   * Open a file after the folder loads, like the writer resuming from the
   * Desk. Defaults to the fixture's own last-opened file (The Storm's adopted
   * `.01`); pass `null` for a bare Desk landing.
   */
  open?: string | null;
} = {}) {
  const provider = new FakeProvider();
  // The snapshot record lives in properties — relocate the fixture
  // yaml's own entries so the strict reconcile passes. The effective structure
  // is the one the test actually lands on disk (a `files` override wins).
  const effectiveStructure = files[STRUCTURE_FILE] ?? STRUCTURE;
  seedRecords(provider, PROPS, effectiveStructure);
  provider.files.set(STRUCTURE_FILE, effectiveStructure);
  for (const [path, content] of Object.entries(files))
    seedFile(provider, path, content);
  before?.(provider);

  const engine = new EditorEngine();
  const view = render(
    <ProjectProvider engine={engine} provider={provider} projectKey="demo-key">
      <ResumeButton file={open ?? ""} />
      <SnapshotPanel
        provider={provider}
        projectRef={{
          providerId: "fake",
          key: "demo-key",
          name: "Demo",
          openedAt: "",
        }}
        activeFile="section--the_storm.EL3.01.md"
        onCompare={onCompare}
        compareExits={compareExits}
      />
    </ProjectProvider>,
  );

  if (open) {
    try {
      await waitFor(() => expect(rows().length).toBe(2));
      fireEvent.click(screen.getByTestId("test-resume"));
      await waitFor(() =>
        expect(
          screen.getByTestId("test-resume").getAttribute("data-open"),
        ).toBe("1"),
      );
    } catch {
      // The fixture never reached "ready" — nothing to resume.
    }
  }

  return { provider, engine, view };
}

/** The writer's Desk resume, as a test button — a fresh open does not
 *  auto-restore. It also shows how the last save ended. */
function ResumeButton({ file }: { file: string }) {
  const { openFile } = useProjectActions();
  const { activeFile, lastSave } = useProjectState();
  return (
    <button
      data-testid="test-resume"
      data-open={activeFile === file ? "1" : "0"}
      data-save={lastSave === null ? "" : lastSave.ok ? "ok" : "failed"}
      onClick={() => void openFile(file)}
      aria-hidden
      tabIndex={-1}
    />
  );
}

const rows = () => document.querySelectorAll(".snap-row");
const rowTitles = () =>
  [...rows()].map((r) => r.querySelector(".snap-title")?.textContent);

/** The fixture's "The Storm" node, from the structure the provider holds. */
function stormNode(structure: ReturnType<typeof structureOf>) {
  const part = structure.children[0];
  return part.kind === "part"
    ? part.children.find((c) => c.title === "The Storm")
    : undefined;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

// A row's date: its own cell, or the tooltip of the tag that stands in its
// place.
const whenOf = (row: Element) =>
  row.querySelector(".snap-when")?.textContent ??
  row.querySelector(".snap-rel")?.getAttribute("title")?.split(" · ")[1];

describe("the table", () => {
  it("lists the open node's snapshots, newest first, with the tick on the adopted one", async () => {
    await make();
    await waitFor(() => expect(rows().length).toBe(2));
    // Newest first: the `.01` (adopted) above the `.00`.
    expect(rowTitles()).toEqual(["The Storm 2", "The Storm 1"]);
    const adoptedRow = rows()[0];
    expect(adoptedRow.querySelector(".snap-tick")).toBeTruthy();
    expect(adoptedRow.querySelector(".snap-adopt")).toBeNull();
    // The older row's Adopt button is in the DOM, revealed on hover/focus.
    expect(rows()[1].querySelector(".snap-adopt")).toBeTruthy();
  });

  it("names the adopted row in a word a theme may set, hidden from the reader", async () => {
    await make();
    await waitFor(() => expect(rows().length).toBe(2));
    const word = rows()[0].querySelector(".snap-adopted");
    expect(word?.textContent).toBe("snapshots.adopted");
    expect(word?.getAttribute("aria-hidden")).toBe("true");
    expect(rows()[1].querySelector(".snap-adopted")).toBeNull();
  });

  it("rests the divider at its own third until the writer moves it", async () => {
    await make();
    await waitFor(() => expect(rows().length).toBe(2));
    const table = () => document.querySelector(".snap-table") as HTMLElement;
    expect(table().style.height).toBe("33%");
  });

  it("the head carries no column labels — only the [+] button", async () => {
    await make();
    await waitFor(() => expect(rows().length).toBe(2));
    const head = document.querySelector(".snap-head");
    expect(head).toBeTruthy();
    // The minimalistic table: no "Date and time / Title / Actions" labels.
    expect(document.querySelector(".snap-head-label")).toBeNull();
    // The [+] is still there — the new-snapshot button. The grain lens lives
    // in the comparing bar over the paper, not the strip.
    expect(screen.getByTitle("snapshots.addNewSnapshot")).toBeTruthy();
    expect(document.querySelector(".snap-grain")).toBeNull();
  });

  it("shows the empty state when no node is open", async () => {
    const provider = new FakeProvider();
    const engine = new EditorEngine();
    render(
      <ProjectProvider
        engine={engine}
        provider={provider}
        projectKey="demo-key"
      >
        <SnapshotPanel
          provider={provider}
          projectRef={{
            providerId: "fake",
            key: "demo-key",
            name: "Demo",
            openedAt: "",
          }}
          activeFile={null}
        />
      </ProjectProvider>,
    );
    expect(screen.getByText("snapshots.emptyNoNode")).toBeTruthy();
  });
});

describe("the preview", () => {
  it("shows the adopted snapshot's text at rest", async () => {
    await make();
    await waitFor(() =>
      expect(screen.getByText(/came in from the west/)).toBeTruthy(),
    );
  });

  it("follows the selection, and re-clicking the selected row returns to the adopted text", async () => {
    await make();
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(rows()[1].querySelector(".snap-title") as HTMLElement);
    await waitFor(() =>
      expect(screen.getByText(/came in from the south/)).toBeTruthy(),
    );
    expect(rows()[1].classList.contains("selected")).toBe(true);
    // Re-click toggles the comparison off.
    fireEvent.click(rows()[1].querySelector(".snap-title") as HTMLElement);
    await waitFor(() =>
      expect(screen.getByText(/came in from the west/)).toBeTruthy(),
    );
  });

  it("renders the engine's own blocks — a pagebreak directive becomes an <hr>, not literal braces", async () => {
    // The preview runs the engine's codec+renderer (the same pipeline as the
    // comparing diff), so the manuscript's directives render as what they are.
    // A Markdown renderer would draw "{pagebreak}" as literal text.
    await make({
      files: {
        ...FILES,
        [filePath("section--the_storm.EL3.01.md")]:
          "It came in from the west.\n\n{pagebreak}\n\nAnd then the lane was gone.\n",
      },
    });
    await waitFor(() =>
      expect(document.querySelector(".snap-preview-body hr")).toBeTruthy(),
    );
    expect(
      document.querySelector(".snap-preview-body")?.textContent,
    ).not.toContain("{pagebreak}");
  });

  it("renders a hostile file as inert text — no live markup, no links", async () => {
    // The writer's own folder is not a trust boundary: the engine dialect has
    // no link or image syntax, and the renderer escapes every run. A file
    // carrying markup must render as escaped text, never as live elements.
    // The `javascript:` link is the discriminating case: `markdown-it`, even
    // with `html: false`, renders it as a live `<a>`.
    await make({
      files: {
        ...FILES,
        [filePath("section--the_storm.EL3.01.md")]:
          "Before <script>alert(1)</script> after\n\n[x](javascript:alert(1))\n",
      },
    });
    await waitFor(() =>
      expect(document.querySelector(".snap-preview-body")).toBeTruthy(),
    );
    const body = document.querySelector(".snap-preview-body");
    expect(body?.querySelector("script")).toBeNull();
    expect(body?.querySelector("a")).toBeNull();
    expect(body?.querySelector("img")).toBeNull();
    expect(body?.textContent).toContain("[x](javascript:alert(1))");
  });
});

describe("adopting", () => {
  it("adopts another snapshot: the yaml pointer swaps and the editor lands on the new file", async () => {
    const { provider } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(rows()[1].querySelector(".snap-adopt") as HTMLElement);
    await waitFor(() => {
      const structure = structureOf(provider);
      expect(stormNode(structure)?.adopted).toBe(
        "section--the_storm.EL3.00.md",
      );
    });
    // The tick moved with the pointer — the now-adopted row is the `.00`.
    expect(rows()[1].querySelector(".snap-tick")).toBeTruthy();
    expect(rows()[0].querySelector(".snap-tick")).toBeNull();
  });

  it("with a dirty buffer, the gate's Save lands the keystrokes before the pointer swap", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    fireEvent.click(rows()[1].querySelector(".snap-adopt") as HTMLElement);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() =>
      expect(stormNode(structureOf(provider))?.adopted).toBe(
        "section--the_storm.EL3.00.md",
      ),
    );
    // The keystroke landed in the old adopted file before the swap.
    expect(
      provider.files.get(filePath("section--the_storm.EL3.01.md")),
    ).toContain("x");
  });

  it("with a dirty buffer, the gate's Stay aborts the adoption", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    fireEvent.click(rows()[1].querySelector(".snap-adopt") as HTMLElement);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.stay" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(stormNode(structureOf(provider))?.adopted).toBe(
      "section--the_storm.EL3.01.md",
    );
  });

  it("with a dirty buffer, the gate's Skip adopts without saving", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    fireEvent.click(rows()[1].querySelector(".snap-adopt") as HTMLElement);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.skip" }));
    await waitFor(() =>
      expect(stormNode(structureOf(provider))?.adopted).toBe(
        "section--the_storm.EL3.00.md",
      ),
    );
    // The unsaved keystroke stays out of both files: adoption lands the
    // editor in the newly adopted file with a fresh baseline, so the buffer
    // the "x" sat in is gone — the writer chose Skip knowing the switch.
    expect(
      provider.files.get(filePath("section--the_storm.EL3.01.md")),
    ).not.toContain("x");
    expect(
      provider.files.get(filePath("section--the_storm.EL3.00.md")),
    ).not.toContain("x");
  });

  // A journal of steps the file never got is dropped as stale at the next
  // open, and the Section's saved history goes with it.
  it("the gate's Skip leaves the discarded edits out of the journal", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    fireEvent.click(rows()[1].querySelector(".snap-adopt") as HTMLElement);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.skip" }));
    await waitFor(() =>
      expect(stormNode(structureOf(provider))?.adopted).toBe(
        "section--the_storm.EL3.00.md",
      ),
    );
    // The buffer leaves the `.01` for the newly adopted `.00`.
    await waitFor(() =>
      expect(screen.getByTestId("test-resume").dataset.open).toBe("0"),
    );
    expect(
      provider.files.has(historyPath("section--the_storm.EL3.01.md")),
    ).toBe(false);
  });
});

describe("creating", () => {
  it("the [+] opens a ghost row with an open, focused title field, and Enter creates the snapshot", async () => {
    const { provider } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(screen.getByTitle("snapshots.addNewSnapshot"));
    // The ghost row's input is focused, the default title its placeholder.
    const input = await screen.findByLabelText("The Storm 3");
    expect((input as HTMLInputElement).placeholder).toBe("The Storm 3");
    // The field lives in the ghost row's title cell — the first row — so the
    // writer names the snapshot where its row will be. The ghost has no title
    // button (it is not a snapshot yet) and no date, tick or actions: the
    // absence is the honesty.
    const ghost = rows()[0];
    expect(ghost.querySelector(".snap-title-cell .snap-add-input")).toBe(input);
    expect(ghost.querySelector(".snap-title")).toBeNull();
    expect(ghost.querySelector(".snap-when")).toBeNull();
    expect(ghost.querySelector(".snap-tick")).toBeNull();
    // Enter is when the snapshot is created — nothing exists on disk before it.
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(rows().length).toBe(3));
    const storm = stormNode(structureOf(provider));
    expect(storm?.snapshots.map((s) => s.file)).toEqual([
      "section--the_storm.EL3.00.md",
      "section--the_storm.EL3.01.md",
      "section--the_storm.EL3.02.md",
    ]);
    // The adopted one did not change, and the copy matches the adopted text.
    expect(storm?.adopted).toBe("section--the_storm.EL3.01.md");
    expect(
      provider.files.get(filePath("section--the_storm.EL3.02.md")),
    ).toContain("came in from the west");
  });

  it("with a dirty buffer the save-first gate asks, and Save writes before the copy", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    expect(engine.hasChanges).toBe(true);
    fireEvent.click(screen.getByTitle("snapshots.addNewSnapshot"));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    // Save: the buffer lands first, then Enter on the ghost row creates the
    // snapshot, copying the saved text.
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    const input = await screen.findByLabelText("The Storm 3");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(rows().length).toBe(3));
    expect(
      provider.files.get(filePath("section--the_storm.EL3.01.md")),
    ).toContain("x");
    expect(
      provider.files.get(filePath("section--the_storm.EL3.02.md")),
    ).toContain("x");
  });

  it("the gate's Stay keeps the writer where they are — no snapshot, no switch, no ghost", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    fireEvent.click(screen.getByTitle("snapshots.addNewSnapshot"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.stay" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(rows().length).toBe(2);
    expect(stormNode(structureOf(provider))?.snapshots).toHaveLength(2);
    // The add never began, so no ghost row's field exists — a Stay must not
    // leave a phantom input that could create or re-title anything on the
    // next blur.
    expect(document.querySelector(".snap-add-input")).toBeNull();
    const storm = stormNode(structureOf(provider));
    expect(storm?.snapshots.map((s) => s.title)).toEqual([
      "The Storm 1",
      "The Storm 2",
    ]);
  });

  it("the fresh title lands on the NEW row, never the previous newest", async () => {
    const { provider } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(screen.getByTitle("snapshots.addNewSnapshot"));
    const input = await screen.findByLabelText("The Storm 3");
    fireEvent.change(input, { target: { value: "Afterword" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(rows().length).toBe(3));
    const storm = stormNode(structureOf(provider));
    // The adopted row kept its own title; the fresh row carries the typed one.
    expect(storm?.snapshots.map((s) => s.title)).toEqual([
      "The Storm 1",
      "The Storm 2",
      "Afterword",
    ]);
    expect(storm?.snapshots[2].file).toBe("section--the_storm.EL3.02.md");
    expect(storm?.adopted).toBe("section--the_storm.EL3.01.md");
  });

  it("Esc aborts the creation — nothing is written, the ghost unmounts", async () => {
    const { provider } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(screen.getByTitle("snapshots.addNewSnapshot"));
    const input = await screen.findByLabelText("The Storm 3");
    fireEvent.change(input, { target: { value: "Aborted" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(document.querySelector(".snap-add-input")).toBeNull(),
    );
    // No new snapshot: the list, the yaml and the disk are untouched.
    expect(rows().length).toBe(2);
    const storm = stormNode(structureOf(provider));
    expect(storm?.snapshots).toHaveLength(2);
    expect(provider.files.has(filePath("section--the_storm.EL3.02.md"))).toBe(
      false,
    );
  });

  it("blur aborts the creation too — clicking away never creates an unconfirmed snapshot", async () => {
    const { provider } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(screen.getByTitle("snapshots.addNewSnapshot"));
    const input = await screen.findByLabelText("The Storm 3");
    fireEvent.change(input, { target: { value: "Aborted" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(document.querySelector(".snap-add-input")).toBeNull(),
    );
    expect(rows().length).toBe(2);
    const storm = stormNode(structureOf(provider));
    expect(storm?.snapshots).toHaveLength(2);
    expect(provider.files.has(filePath("section--the_storm.EL3.02.md"))).toBe(
      false,
    );
  });

  it("the gate's Skip proceeds without saving — the snapshot captures the saved text", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    fireEvent.click(screen.getByTitle("snapshots.addNewSnapshot"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.skip" }));
    const input = await screen.findByLabelText("The Storm 3");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(rows().length).toBe(3));
    // Skip means "proceed anyway": the unsaved keystroke stays in the buffer
    // and out of both files — the snapshot is of the text on disk.
    expect(engine.hasChanges).toBe(true);
    expect(
      provider.files.get(filePath("section--the_storm.EL3.01.md")),
    ).not.toContain("x");
    expect(
      provider.files.get(filePath("section--the_storm.EL3.02.md")),
    ).not.toContain("x");
    expect(
      provider.files.get(filePath("section--the_storm.EL3.02.md")),
    ).toContain("came in from the west");
  });

  it("selecting a snapshot with a dirty buffer asks first, and Save proceeds to the preview", async () => {
    const { engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    fireEvent.click(rows()[1].querySelector(".snap-title") as HTMLElement);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() =>
      expect(screen.getByText(/came in from the south/)).toBeTruthy(),
    );
  });
});

// The gate's Save is a promise that the buffer is on disk before the verb
// runs. A save that fails keeps that promise by not running the verb: the
// adoption would replace the buffer with another file, and the add and the
// comparison would read a disk the writer's text never reached.
describe("a gate whose save fails", () => {
  // The gate decides on the verb as the failed save returns, the moment the
  // save is reported, so what has not happened by then never will.
  const saveFailed = () =>
    waitFor(() =>
      expect(screen.getByTestId("test-resume").dataset.save).toBe("failed"),
    );

  function failingSave(provider: FakeProvider) {
    const original = provider.writeFile.getMockImplementation();
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === filePath("section--the_storm.EL3.01.md"))
        throw new Error("Disk full");
      return original?.(ref, path, content);
    });
  }

  it("does not adopt, and keeps the unsaved buffer", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    failingSave(provider);
    fireEvent.click(rows()[1].querySelector(".snap-adopt") as HTMLElement);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await saveFailed();
    expect(stormNode(structureOf(provider))?.adopted).toBe(
      "section--the_storm.EL3.01.md",
    );
    expect(engine.hasChanges).toBe(true);
    expect(engine.commonmark).toContain("x");
  });

  it("does not begin the add", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    failingSave(provider);
    fireEvent.click(screen.getByTitle("snapshots.addNewSnapshot"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await saveFailed();
    expect(document.querySelector(".snap-add-input")).toBeNull();
  });

  it("does not open the comparison", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    act(() => engine.type("x"));
    failingSave(provider);
    fireEvent.click(rows()[1].querySelector(".snap-title") as HTMLElement);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await saveFailed();
    expect(rows()[1].classList.contains("selected")).toBe(false);
  });
});

describe("re-titling", () => {
  it("the pencil opens an inline field and Enter re-titles the snapshot", async () => {
    const { provider } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    const renameButtons = screen.getAllByTitle("snapshots.rename");
    fireEvent.click(renameButtons[0]);
    // The field is the row's input — scoped by class, because the row's own
    // pencil carries the same accessible name.
    const input = document.querySelector(
      ".snap-title-cell .snap-title-input",
    ) as HTMLInputElement;
    await waitFor(() => expect(input).toBeTruthy());
    fireEvent.change(input, { target: { value: "Dawn of the storm" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByText("Dawn of the storm")).toBeTruthy(),
    );
    const storm = stormNode(structureOf(provider));
    expect(
      storm?.snapshots.find((s) => s.file === "section--the_storm.EL3.01.md")
        ?.title,
    ).toBe("Dawn of the storm");
  });
});

describe("deleting", () => {
  it("the trash is absent on the adopted row, and deleting a snapshot is undo-less", async () => {
    const { provider } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    // The adopted row (newest) has no trash; the older one does.
    expect(
      within(rows()[0] as HTMLElement).queryByTitle("snapshots.delete"),
    ).toBeNull();
    fireEvent.click(
      within(rows()[1] as HTMLElement).getByTitle("snapshots.delete"),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("snapshots.deleteTitle");
    // The confirm button — scoped to the dialog, because the row's trash
    // carries the same accessible name.
    fireEvent.click(within(dialog).getByRole("button", { name: "bin.moveTo" }));
    await waitFor(() => expect(rows().length).toBe(1));
    expect(provider.files.has(filePath("section--the_storm.EL3.00.md"))).toBe(
      false,
    );
    const storm = stormNode(structureOf(provider));
    expect(storm?.snapshots.map((s) => s.file)).toEqual([
      "section--the_storm.EL3.01.md",
    ]);
  });
});

describe("the comparison", () => {
  it("reports the pair to the shell when a non-adopted snapshot is selected", async () => {
    const onCompare = vi.fn();
    await make({ onCompare });
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(rows()[1].querySelector(".snap-title") as HTMLElement);
    await waitFor(() => {
      expect(onCompare).toHaveBeenLastCalledWith({
        compared: "The Storm 1",
        adopted: "The Storm 2",
        comparedFile: "section--the_storm.EL3.00.md",
        adoptedFile: "section--the_storm.EL3.01.md",
      });
    });
  });

  it("the adopted row and the re-click both return to editing", async () => {
    const onCompare = vi.fn();
    await make({ onCompare });
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(rows()[1].querySelector(".snap-title") as HTMLElement);
    await waitFor(() => expect(onCompare).toHaveBeenCalled());
    // Re-clicking the selected row toggles the comparison off.
    fireEvent.click(rows()[1].querySelector(".snap-title") as HTMLElement);
    await waitFor(() => expect(onCompare).toHaveBeenLastCalledWith(null));
    // Clicking the adopted row is a return too, never a self-comparison.
    fireEvent.click(rows()[0].querySelector(".snap-title") as HTMLElement);
    await waitFor(() => expect(onCompare).toHaveBeenLastCalledWith(null));
  });
});

describe("the divider", () => {
  it("the keyboard steps the split and persists it", async () => {
    const { provider } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    const divider = screen.getByRole("separator");
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    // The persist is a fire-and-forget write; assert on the file once the
    // write lands, never on the same tick as the keystroke. The generous
    // timeout covers a load stall under the coverage run.
    await waitFor(
      () => {
        const saved = JSON.parse(provider.files.get(PROPERTIES_FILE) ?? "{}").ui
          .snapshotSplit as number;
        expect(saved).toBeGreaterThan(0.33);
      },
      { timeout: 5000 },
    );
    fireEvent.keyDown(divider, { key: "Home" });
    await waitFor(
      () => {
        const home = JSON.parse(provider.files.get(PROPERTIES_FILE) ?? "{}").ui
          .snapshotSplit as number;
        expect(home).toBe(0.2);
      },
      { timeout: 5000 },
    );
  });

  it("the pointer drags the split, and a release outside the window still lands it", async () => {
    const { provider } = await make();
    await waitFor(() => expect(rows().length).toBe(2));
    const divider = screen.getByRole("separator");
    // A zero-height panel measures no drag — stub a real box so the drag has
    // a distance to translate.
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if ((this as HTMLElement).classList?.contains("snap-face")) {
        return {
          left: 0,
          top: 0,
          right: 400,
          bottom: 600,
          width: 400,
          height: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return original.call(this);
    };
    try {
      // A downward drag grows the split: pointer 300 → 350 on a 600px panel
      // from the resting third lands at 1/3 + 50/600 = 0.4167 — in range, so
      // the pin discriminates direction alone (an inverted drag would
      // produce 1/3 − 50/600 = 0.25).
      fireEvent.pointerDown(divider, { clientY: 300 });
      fireEvent.pointerMove(window, { clientY: 350 });
      fireEvent.pointerUp(window);
      // The persisted split must be the dragged-to value, not the pre-drag
      // 1/3. Same fire-and-forget discipline as the
      // keyboard row, and the same generous timeout.
      await waitFor(
        () => {
          const saved = JSON.parse(provider.files.get(PROPERTIES_FILE) ?? "{}")
            .ui.snapshotSplit as number;
          expect(saved).toBeCloseTo(1 / 3 + 50 / 600, 3);
        },
        { timeout: 5000 },
      );
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});

describe("edges", () => {
  it("a preview that cannot be read says so instead of blanking", async () => {
    // The adopted snapshot's file is unreadable this moment (a Drive sync
    // half-finished) — the preview at rest must say so rather than pretend
    // there is nothing to show. The open pipeline's own read of the file is
    // swallowed by its read-or-null seam; the preview's read is the one that
    // must surface the failure.
    await make({
      before: (p) =>
        p.readFile.mockImplementation(async (_ref, path) => {
          if (path === filePath("section--the_storm.EL3.01.md"))
            throw new Error("sync in flight");
          return (p as unknown as { files: Map<string, string> }).files.get(
            path,
          ) as string;
        }),
    });
    await waitFor(() =>
      expect(screen.getByText("dock.unreadable")).toBeTruthy(),
    );
  });

  it("an unreadable date renders as itself — the row never lies about the stamp", async () => {
    // The creation moment lives in properties, so corrupt it
    // there — a hand-edited date is still displayed verbatim, never parsed
    // into a lie.
    const corrupt = withRecords(PROPS, STRUCTURE).replace(
      '"created": "2026-08-14T09:12:00.000Z"',
      '"created": "not-a-date"',
    );
    await make({ files: { ...FILES, [PROPERTIES_FILE]: corrupt } });
    await waitFor(() => expect(rows().length).toBe(2));
    // "not-a-date" sorts after the ISO stamp, so the replaced row is first.
    expect(whenOf(rows()[0])).toBe("not-a-date");
  });

  it("the date shows the node's edit time on the adopted row, creation otherwise", async () => {
    // Only the adopted file is ever written, so the node's `perNode`
    // edit-time stamp belongs to the adopted row; every other row shows its
    // creation moment. The Storm's adopted `.01` carries the stamp; the older
    // `.00` shows creation (last edit when creation and edit time differ,
    // creation otherwise).
    const stamped = {
      ...JSON.parse(PROPS),
      stats: {
        words: 10,
        parts: 1,
        sections: 1,
        countedAt: "2026-01-01T00:00:00.000Z",
        perNode: [
          { nodeId: "EL3", words: 10, updatedAt: "2026-08-16T11:45:00.000Z" },
        ],
      },
    };
    await make({
      files: {
        ...FILES,
        [PROPERTIES_FILE]: withRecords(
          JSON.stringify(stamped, null, 2),
          STRUCTURE,
        ),
      },
    });
    await waitFor(() => expect(rows().length).toBe(2));
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      });
    // Row 0 is newest by created (The Storm 2, 08/15) — the adopted one, and
    // the only one ever written, so it shows the node's edit time. Row 1
    // (The Storm 1, 08/14) was never the live file, so creation is the answer.
    expect(whenOf(rows()[0])).toBe(fmt("2026-08-16T11:45:00.000Z"));
    expect(whenOf(rows()[1])).toBe(fmt("2026-08-14T09:12:00.000Z"));
  });

  it("— an adopted row whose node was never written shows its creation time, not a fabricated edit", async () => {
    // The stats backfill counts a node's file without stamping an edit time:
    // the file was never written by this editor, so "never edited" is the
    // answer and the row falls back to the snapshot's creation moment, never
    // a minted `updatedAt: now` claiming an edit nobody made.
    const unstamped = {
      ...JSON.parse(PROPS),
      stats: {
        words: 10,
        parts: 1,
        sections: 1,
        countedAt: "2026-01-01T00:00:00.000Z",
        perNode: [{ nodeId: "EL3", words: 10 }],
      },
    };
    await make({
      files: {
        ...FILES,
        [PROPERTIES_FILE]: withRecords(
          JSON.stringify(unstamped, null, 2),
          STRUCTURE,
        ),
      },
    });
    await waitFor(() => expect(rows().length).toBe(2));
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      });
    // The adopted .01 row answers with its creation moment (08/15), never
    // with the open moment.
    expect(rows()[0].querySelector(".snap-when")?.textContent).toBe(
      fmt("2026-08-15T08:00:00.000Z"),
    );
  });

  it("a comparison exited from outside clears the selection", async () => {
    const provider = new FakeProvider();
    seedRecords(provider, PROPS, STRUCTURE);
    provider.files.set(STRUCTURE_FILE, STRUCTURE);
    for (const [path, content] of Object.entries(FILES))
      provider.files.set(path, content);
    const engine = new EditorEngine();
    const panel = (
      <SnapshotPanel
        provider={provider}
        projectRef={{
          providerId: "fake",
          key: "demo-key",
          name: "Demo",
          openedAt: "",
        }}
        activeFile="section--the_storm.EL3.01.md"
        onCompare={() => {}}
        compareExits={0}
      />
    );
    const view = render(
      <ProjectProvider
        engine={engine}
        provider={provider}
        projectKey="demo-key"
      >
        {panel}
      </ProjectProvider>,
    );
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(rows()[1].querySelector(".snap-title") as HTMLElement);
    await waitFor(() =>
      expect(rows()[1].classList.contains("selected")).toBe(true),
    );
    // The shell bumps `compareExits` when a comparison exits from outside
    // (Esc, the Snapshots face closing, the rail opening): the selection clears
    // with the diff — a row must never stay highlighted over a closed
    // comparison.
    view.rerender(
      <ProjectProvider
        engine={engine}
        provider={provider}
        projectKey="demo-key"
      >
        <SnapshotPanel
          provider={provider}
          projectRef={{
            providerId: "fake",
            key: "demo-key",
            name: "Demo",
            openedAt: "",
          }}
          activeFile="section--the_storm.EL3.01.md"
          onCompare={() => {}}
          compareExits={1}
        />
      </ProjectProvider>,
    );
    await waitFor(() =>
      expect(rows()[1].classList.contains("selected")).toBe(false),
    );
  });

  it("deleting the selected snapshot clears the selection and the preview returns to the adopted text", async () => {
    await make();
    await waitFor(() => expect(rows().length).toBe(2));
    fireEvent.click(rows()[1].querySelector(".snap-title") as HTMLElement);
    await waitFor(() =>
      expect(rows()[1].classList.contains("selected")).toBe(true),
    );
    fireEvent.click(
      within(rows()[1] as HTMLElement).getByTitle("snapshots.delete"),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "bin.moveTo" }));
    await waitFor(() => expect(rows().length).toBe(1));
    await waitFor(() =>
      expect(screen.getByText(/came in from the west/)).toBeTruthy(),
    );
  });

  it("— badge order follows the file suffix, not the created tie", async () => {
    // Two snapshots share one `created` stamp, and a third sits on the other
    // side of the adopted row. The relative-position badge must follow the
    // file order (the xy suffix), never the created sort whose tie is stable.
    const tiedStructure = `version: 1
document:
  - id: EL1
    part: Act One
    adopted: part--act_one.EL1.00.md
    snapshots:
      - file: part--act_one.EL1.00.md
        title: Act One 1
        created: 2026-01-01T00:00:00.000Z
    children:
      - id: EL3
        section: The Storm
        adopted: section--the_storm.EL3.01.md
        snapshots:
          - file: section--the_storm.EL3.00.md
            title: The Storm 1
            created: 2026-01-01T00:00:00.000Z
          - file: section--the_storm.EL3.01.md
            title: The Storm 2
            created: 2026-02-01T00:00:00.000Z
          - file: section--the_storm.EL3.02.md
            title: The Storm 3
            created: 2026-01-01T00:00:00.000Z
`;
    await make({
      files: {
        ...FILES,
        [STRUCTURE_FILE]: tiedStructure,
        [filePath("section--the_storm.EL3.02.md")]: "A third storm version.\n",
      },
    });
    await waitFor(() => expect(rows().length).toBe(3));
    const badgeOf = (title: string) => {
      const row = [...rows()].find(
        (r) => r.querySelector(".snap-title")?.textContent === title,
      );
      return row?.querySelector(".snap-rel");
    };
    const back = badgeOf("The Storm 1");
    const ahead = badgeOf("The Storm 3");
    expect(back?.getAttribute("data-dir")).toBe("back");
    expect(back?.getAttribute("data-count")).toBe("1");
    expect(ahead?.getAttribute("data-dir")).toBe("ahead");
    expect(ahead?.getAttribute("data-count")).toBe("1");
  });

  it("the badge is a real button that selects the snapshot for comparison", async () => {
    // The badge is the count and a button: clicking it selects the snapshot
    // for diffing — the same selection path as the title and the date.
    // The a11y tree hears it as a button with the count's label.
    const onCompare = vi.fn();
    await make({ onCompare });
    await waitFor(() => expect(rows().length).toBe(2));
    const badge = rows()[1].querySelector(".snap-rel") as HTMLElement;
    expect(badge?.tagName).toBe("BUTTON");
    expect(badge?.getAttribute("aria-label")).toBe("snapshots.rowBack");
    fireEvent.click(badge);
    await waitFor(() => {
      expect(onCompare).toHaveBeenLastCalledWith({
        compared: "The Storm 1",
        adopted: "The Storm 2",
        comparedFile: "section--the_storm.EL3.00.md",
        adoptedFile: "section--the_storm.EL3.01.md",
      });
    });
  });
});

// `LeaveDialog` is imported for its role in the gate flow above — the import
// keeps the dialog's own suite honest about the reuse.
void LeaveDialog;
