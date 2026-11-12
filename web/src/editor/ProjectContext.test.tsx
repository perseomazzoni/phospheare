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
} from "@testing-library/react";

// Pins the restore machinery: the file the writer left open is found, read
// and re-opened on a reload. A fresh open always lands on the Desk, and
// `ui.lastOpened` is what the Desk offers to resume, never what it reopens
// unasked.
import {
  ProjectProvider,
  useProjectActions,
  useProjectState,
  useProjectToast,
} from "./ProjectContext";
import { EditorEngine } from "./views/engine";
import { holdOpenWork, writeOpenWork } from "../auth/openWork";
import { connectionFor } from "../storage/connections";
import { EditorServicesProvider, inertServices } from "./services/context";
import type { EditorServices } from "./services/port";
import type { ReactNode } from "react";
import { StorageError } from "../storage";
import { hashOf } from "../text/hash";
import { ensureLocalRoot } from "../storage/localRoot";
import {
  FakeProvider,
  structureOf,
  propsOf,
  seedRecords,
  seedProps,
  seedFile,
  splitRecords,
  hashedRecordsOf,
  catalogueOf,
} from "./project.fixture";
import {
  HISTORY_DIR,
  PROPERTIES_FILE,
  STRUCTURE_FILE,
  filePath,
  historyPath,
  SNAPSHOTS_CATALOGUE_FILE,
} from "../project/naming";
import { childrenOf, findNode } from "../project/structure";
import { countWords } from "../project/stats";
import { DeltaTimeline, Session, commonmarkCodec } from "./engine";
import type { SessionEvents } from "./engine/application/session";
import { regexSearch } from "./engine/adapters/regex";
import { Emitter } from "./engine/adapters/emitter";
import { browserClipboardCodec } from "./engine/adapters/browserHtml";

// The account's hold on open work and its storage reconnection, as the
// project route lends them (`services/account.ts`).
const accountLike: EditorServices = {
  ...inertServices,
  holdOpenWork,
  connectionFor,
};
function AccountServices({ children }: { children: ReactNode }) {
  return (
    <EditorServicesProvider value={accountLike}>
      {children}
    </EditorServicesProvider>
  );
}

// One `t` for every render, as react-i18next keeps it until the language
// changes, so a callback built on it keeps its identity.
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

// The local reconnect is the folder picker (`ensureLocalRoot`). Mocked
// wholesale (spreading the real module) so the fake provider path can drive
// "cancelled" vs "picked" without IndexedDB or the picker seam.
vi.mock("../storage/localRoot", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ensureLocalRoot: vi.fn(async () => null),
}));

// ── The shared fixture ───────────────────────────────────────────────────────
//
// The snapshot model: every Part and Section is a set of snapshot files
// (`part--act_one.EL1.00.md`), the yaml names which one is adopted (the live
// content), and the node itself is identified by a stable id (`EL1`) that no
// rename can touch. `ui.expanded` and `ui.lastOpened` therefore hold ids, and
// the open half resolves the remembered id to the node's adopted file.

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
  "ui": { "expanded": ["EL1"], "lastOpened": "EL3" },
  "stats": { "words": 0, "parts": 0, "sections": 0, "countedAt": "2026-01-01T00:00:00.000Z", "perNode": [] }
}
`;

const STRUCTURE = `# Phospheare — document structure
# The order of this list is the order of the finished document.
# Phospheare rewrites this file when the structure changes; comments below are not preserved.
version: 1
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
        section: Opening
        adopted: section--opening.EL3.00.md
        snapshots:
          - file: section--opening.EL3.00.md
            title: Opening 1
            created: 2026-01-01T00:00:00.000Z
      - id: EL4
        section: The Storm
        adopted: section--the_storm.EL4.00.md
        snapshots:
          - file: section--the_storm.EL4.00.md
            title: The Storm 1
            created: 2026-01-01T00:00:00.000Z
  - id: EL2
    part: Act Two
    adopted: part--act_two.EL2.00.md
    snapshots:
      - file: part--act_two.EL2.00.md
        title: Act Two 1
        created: 2026-01-01T00:00:00.000Z
    children: []
`;

const DEFAULT_FILES: Record<string, string> = {
  [filePath("part--act_one.EL1.00.md")]: "# Act One\n",
  [filePath("part--act_two.EL2.00.md")]: "# Act Two\n",
  [filePath("section--opening.EL3.00.md")]:
    "The house had been empty for a year.\n",
  [filePath("section--the_storm.EL4.00.md")]:
    "It came in from the west, without warning.\n",
};

interface MakeOptions {
  props?: string | null;
  structure?: string | null;
  files?: Record<string, string>;
  /** Tune the provider before the component mounts. */
  before?: (provider: FakeProvider) => void;
  /**
   * Open a file after the folder loads, like the writer resuming from the
   * Desk. Defaults to the fixture's own last-opened file; `null` lands on a
   * bare Desk (or on an invalid or grant-lapsed fixture).
   */
  open?: string | null;
}

async function make({
  props = PROPS,
  structure = STRUCTURE,
  files = DEFAULT_FILES,
  before,
  open = "section--opening.EL3.00.md",
}: MakeOptions = {}) {
  const provider = new FakeProvider();
  // The snapshot record lives in the properties file, and a yaml carrying
  // `snapshots:` blocks fails the strict reconcile, so the fixture's own
  // entries are moved into the properties file. The effective structure is
  // the one that lands on disk: a `files` override of `STRUCTURE_FILE` wins
  // over the `structure` param.
  const effectiveStructure = files[STRUCTURE_FILE] ?? structure;
  if (props !== null && effectiveStructure !== null) {
    seedRecords(provider, props, effectiveStructure);
  } else if (props !== null) {
    seedProps(provider, props);
  }
  if (effectiveStructure !== null)
    provider.files.set(STRUCTURE_FILE, effectiveStructure);
  for (const [path, content] of Object.entries(files))
    seedFile(provider, path, content);
  before?.(provider);

  const engine = new EditorEngine();
  const view = render(
    <ProjectProvider engine={engine} provider={provider} projectKey="demo-key">
      <Probe />
    </ProjectProvider>,
    { wrapper: AccountServices },
  );

  if (open) {
    // A fresh open lands on the Desk, and the file opens only when the
    // writer resumes it. This is that resume, for the tests that assume a
    // file is on screen.
    try {
      await waitFor(() => expect(attr("status")()).toBe("ready"));
      fireEvent.click(screen.getByTestId("act-openFile"));
      await waitFor(() => expect(attr("active")()).toBe(open));
    } catch {
      // The fixture never reached "ready" (invalid or no grant); the test
      // asserts that state itself, and there is nothing to resume.
    }
  }

  return { provider, engine, view };
}

const probe = () => screen.getByTestId("probe");
const attr = (name: string) => () => probe().getAttribute(`data-${name}`);

const click = (action: string) =>
  fireEvent.click(screen.getByTestId(`act-${action}`));

/** What the last `addSnapshot` returned; `undefined` while it runs. */
let added: string | null | undefined;

function Probe() {
  const state = useProjectState();
  const actions = useProjectActions();
  const toast = useProjectToast();
  return (
    <div
      data-testid="probe"
      data-status={state.status}
      data-active={state.activeFile ?? ""}
      data-ref={state.ref?.name ?? ""}
      data-error={state.error ?? ""}
      data-validation={state.validation.map((v) => v.code).join(",")}
      data-pending={state.pendingRef?.name ?? ""}
      data-last={toast.lastAction?.code ?? ""}
      data-canundo={toast.lastAction?.undo ? "1" : "0"}
      data-expanded={state.props?.ui.expanded.join(",") ?? ""}
      data-lastopened={state.props?.ui.lastOpened ?? ""}
      data-outofband={[...state.outOfBand].join(",") ?? ""}
      data-nodes={state.structure?.children.map((n) => n.id).join(",") ?? ""}
    >
      <button
        data-testid="act-reconnect"
        onClick={() => void actions.reconnect()}
      />
      <button data-testid="act-reload" onClick={() => void actions.reload()} />
      <button
        data-testid="act-closeFile"
        onClick={() => void actions.closeFile()}
      />
      <button
        data-testid="act-save"
        onClick={() => void actions.saveActiveFile()}
      />
      <button data-testid="act-undo" onClick={() => void toast.undoLast()} />
      <button data-testid="act-dismiss" onClick={toast.dismissUndo} />
      <button
        data-testid="act-openFile"
        onClick={() => void actions.openFile("section--opening.EL3.00.md")}
      />
      <button
        data-testid="act-openStorm"
        onClick={() => void actions.openFile("section--the_storm.EL4.00.md")}
      />
      <button
        data-testid="act-addPart"
        onClick={() => void actions.addNode("part", null, "Interlude")}
      />
      <button
        data-testid="act-addToPart"
        onClick={() => void actions.addNode("section", "EL2", "Arrival")}
      />
      <button
        data-testid="act-rename"
        onClick={() => void actions.renameNodeTo("EL3", "Dawn")}
      />
      <button
        data-testid="act-renameSame"
        onClick={() => void actions.renameNodeTo("EL3", "Opening")}
      />
      <button
        data-testid="act-removeLeaf"
        onClick={() => void actions.removeNodeAt("EL3")}
      />
      <button
        data-testid="act-removePart"
        onClick={() => void actions.removeNodeAt("EL1")}
      />
      <button
        data-testid="act-move"
        onClick={() => void actions.moveNodesTo(["EL3"], "EL2", 0)}
      />
      <button
        data-testid="act-moveGroup"
        onClick={() => void actions.moveNodesTo(["EL4", "EL3"], "EL2", 0)}
      />
      <button
        data-testid="act-restore"
        onClick={() => void actions.restoreFromBin("EL3", "EL2", 0)}
      />
      <button
        data-testid="act-addOpening"
        onClick={() => void actions.addNode("section", "EL2", "Opening")}
      />
      <button
        data-testid="act-saveUi"
        onClick={() => actions.saveUi(["EL1"])}
      />
      <button
        data-testid="act-setPrefs"
        onClick={() => actions.setPrefs({ proseSize: 21, typewriter: true })}
      />
      <button
        data-testid="act-setDockWidth"
        onClick={() => actions.setDockWidth(480)}
      />
      <button
        data-testid="act-setStructureWidth"
        onClick={() => actions.setStructureWidth(320)}
      />
      <button
        data-testid="act-openSnapshot"
        onClick={() => void actions.openFile("section--the_storm.EL4.01.md")}
      />
      <button
        data-testid="act-addSnapshot"
        onClick={() => {
          added = undefined;
          void actions.addSnapshot("EL4").then((file) => {
            added = file;
          });
        }}
      />
      <button
        data-testid="act-adoptSnapshot"
        onClick={() =>
          void actions.adoptSnapshot("EL4", "section--the_storm.EL4.01.md")
        }
      />
      <button
        data-testid="act-adoptBack"
        onClick={() =>
          void actions.adoptSnapshot("EL4", "section--the_storm.EL4.00.md")
        }
      />
      <button
        data-testid="act-renameSnapshot"
        onClick={() =>
          void actions.renameSnapshotTitle(
            "EL4",
            "section--the_storm.EL4.01.md",
            "Storm 2",
          )
        }
      />
      <button
        data-testid="act-deleteAdopted"
        onClick={() =>
          void actions.deleteSnapshot("EL4", "section--the_storm.EL4.00.md")
        }
      />
      <button
        data-testid="act-deleteSnapshot"
        onClick={() =>
          void actions.deleteSnapshot("EL4", "section--the_storm.EL4.01.md")
        }
      />
      <button
        data-testid="act-restoreSnapshot"
        onClick={() =>
          void actions.restoreBinnedSnapshot(
            "EL4",
            "section--the_storm.EL4.01.md",
          )
        }
      />
      <button
        data-testid="act-renameStorm"
        onClick={() => void actions.renameNodeTo("EL4", "The Gale")}
      />
      <button
        data-testid="act-closeThenSave"
        onClick={() =>
          void actions.closeFile().then(() => actions.saveActiveFile())
        }
      />
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => cleanup());

// ── Opening ──────────────────────────────────────────────────────────────────

describe("opening a project", () => {
  it("opens a valid folder: ready, named from its properties, landing on the Desk", async () => {
    const { engine } = await make({ open: null });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    expect(attr("ref")()).toBe("Once Dark");
    // A fresh open always lands on the Desk: `ui.lastOpened` is what the Desk
    // offers to resume, never what is reopened unasked.
    expect(attr("active")()).toBe("");
    expect(attr("error")()).toBe("");
    expect(attr("validation")()).toBe("");
    expect(engine.commonmark).toBe("");
  });

  it("opens an empty buffer when the remembered file is no longer in the document", async () => {
    const props = PROPS.replace("EL3", "EL9");
    const { engine } = await make({ props, open: null });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    expect(attr("active")()).toBe("");
    expect(engine.commonmark).toBe("");
  });

  it("refuses an empty folder — missing properties", async () => {
    const { provider } = await make({ props: null, files: {} });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toBe("missingProperties");
    expect(provider.listDir).toHaveBeenCalled();
  });

  it("refuses a folder with no properties file but prose in document/ — a half-deleted document", async () => {
    await make({
      props: null,
      files: { [filePath("part--act_one.EL1.00.md")]: "# Act One\n" },
    });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toBe("documentNotEmpty");
  });

  it("refuses a damaged properties file, naming the missing field", async () => {
    await make({ props: '{ "schemaVersion": 1, "document": {} }', files: {} });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toBe("propertiesField");
  });

  it("refuses unparseable properties JSON", async () => {
    await make({ props: "{ not json", files: {} });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toBe("propertiesParse");
  });

  it("refuses a missing structure file", async () => {
    await make({ structure: null, files: {} });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toBe("missingStructure");
  });

  it("refuses unparseable yaml with its line number", async () => {
    await make({
      structure: "version: 1\ndocument:\n  - section: 'unclosed",
      files: {},
    });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toContain("yamlParse");
  });

  it("refuses a yaml that duplicates a snapshot file name", async () => {
    // Two nodes cannot share a file, because the id is in the name,
    // so the duplicate a hand edit can make is one record listing its own
    // file twice.
    await make({
      structure: `version: 1
document:
  - id: EL1
    section: Opening
    adopted: section--opening.EL1.00.md
    snapshots:
      - file: section--opening.EL1.00.md
        title: Opening 1
        created: 2026-01-01T00:00:00.000Z
      - file: section--opening.EL1.00.md
        title: Opening 2
        created: 2026-01-01T00:00:00.000Z
`,
      files: {},
    });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toContain("duplicateSnapshotFile");
  });

  it("refuses a yaml whose record names another node's file", async () => {
    await make({
      structure: `version: 1
document:
  - id: EL1
    section: Opening
    adopted: section--opening.EL1.00.md
    snapshots:
      - file: section--opening.EL1.00.md
        title: Opening 1
        created: 2026-01-01T00:00:00.000Z
  - id: EL2
    section: Opening
    adopted: section--opening.EL1.00.md
    snapshots:
      - file: section--opening.EL1.00.md
        title: Opening 1
        created: 2026-01-01T00:00:00.000Z
`,
      files: {},
    });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toContain("snapshotEntryBad");
  });

  it("refuses a folder whose document/ directory is missing", async () => {
    await make({ files: {} });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toBe("missingDocumentDir");
  });

  it("refuses a folder holding files the yaml does not name", async () => {
    await make({
      files: { ...DEFAULT_FILES, [filePath("section--stray.md")]: "stray\n" },
    });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toBe("filesUnlisted");
  });

  it("refuses a yaml naming files that are not on disk", async () => {
    await make({ files: { [filePath("section--opening.EL3.00.md")]: "x\n" } });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toBe("filesMissing");
  });

  it("treats an unreadable properties file as an absent one — invalid when the folder is empty", async () => {
    await make({
      files: {},
      before: (p) => {
        const original = p.readFile.getMockImplementation();
        if (original === undefined)
          throw new Error("readFile must have an implementation to rewrap");
        p.readFile.mockImplementation(async (ref, path) => {
          if (path === PROPERTIES_FILE)
            throw new StorageError("Permission lost", "permission");
          return original(ref, path);
        });
      },
    });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
  });

  it("does nothing when the provider is unsupported, and never reopens", async () => {
    const { provider } = await make({ before: (p) => (p.available = false) });
    expect(attr("status")()).toBe("idle");
    expect(provider.reopenProject).not.toHaveBeenCalled();
  });

  it("remembers a refused folder for the reconnect affordance, and reconnect opens it", async () => {
    const { provider } = await make({ before: (p) => (p.grant = false) });
    await waitFor(() => expect(attr("pending")()).toBe("demo-key"));
    provider.grant = true;
    click("reconnect");
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    expect(attr("pending")()).toBe("");
  });

  it("reconnect that is still refused says so", async () => {
    await make({ before: (p) => (p.grant = false) });
    await waitFor(() => expect(attr("pending")()).toBe("demo-key"));
    click("reconnect");
    await waitFor(() =>
      expect(attr("error")()).toBe("storage.permissionStill"),
    );
    expect(attr("status")()).toBe("idle");
  });

  // The mount asks what is true and never fires a `requestPermission`: an
  // unbidden prompt trains browsers into silently denying the app.
  // The affordance alone is the mount's voice.
  it("holds a lapsed folder at the affordance without a single request attempt", async () => {
    const { provider } = await make({ before: (p) => (p.grant = false) });
    await waitFor(() => expect(attr("pending")()).toBe("demo-key"));
    expect(provider.reopenProject).not.toHaveBeenCalled();
  });

  // The local reconnect is the picker. Cancelling it changes
  // nothing: the affordance stays, with no error and no second attempt.
  // Picking opens the project, so there is no failure copy to print.
  it("local reconnect that is cancelled keeps the affordance, silently", async () => {
    await make({
      before: (p) => {
        p.grant = false;
        // The picker path is local-only; borrow the identity for this row.
        Object.defineProperty(p, "id", { value: "local" });
      },
    });
    await waitFor(() => expect(attr("pending")()).toBe("demo-key"));
    click("reconnect");
    await waitFor(() => expect(ensureLocalRoot).toHaveBeenCalledTimes(1));
    expect(attr("status")()).toBe("idle");
    expect(attr("error")()).toBe("");
    expect(attr("pending")()).toBe("demo-key");
  });

  // This row borrows the "local" identity so the picker branch runs, which
  // makes it the one place where a registry lookup by `target.providerId`
  // resolves to something other than the provider the route handed down.
  // Reaching `ready` is the assertion: the bytes come back through this
  // instance. A decorator preserves the base's `id`, so
  // a lookup cannot tell the composed provider from the bare one, and only
  // the handed-down reference can.
  it("local reconnect that picks the folder re-reads through the provider it was given", async () => {
    vi.mocked(ensureLocalRoot).mockResolvedValue({
      providerId: "local",
      key: "demo-key",
      name: "demo",
      openedAt: "",
    });
    const { provider } = await make({
      before: (p) => {
        p.grant = false;
        Object.defineProperty(p, "id", { value: "local" });
      },
    });
    await waitFor(() => expect(attr("pending")()).toBe("demo-key"));
    provider.readFile.mockClear();
    click("reconnect");
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    expect(ensureLocalRoot).toHaveBeenCalledTimes(1);
    expect(provider.readFile).toHaveBeenCalled();
    vi.mocked(ensureLocalRoot).mockResolvedValue(null);
  });

  it("reload re-reads a folder that failed, restoring the open file on success", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    provider.files.set(
      STRUCTURE_FILE,
      "version: 1\ndocument:\n  - section: broken\n",
    );
    click("reload");
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    provider.files.set(STRUCTURE_FILE, STRUCTURE);
    click("reload");
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    expect(attr("active")()).toBe("section--opening.EL3.00.md");
  });

  it("lands on the Desk when the writer closed the file before the next try", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    provider.files.set(
      STRUCTURE_FILE,
      "version: 1\ndocument:\n  - section: broken\n",
    );
    click("reload");
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    click("closeFile");
    await waitFor(() => expect(attr("active")()).toBe(""));
    provider.files.set(STRUCTURE_FILE, STRUCTURE);
    click("reload");
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    expect(attr("active")()).toBe("");
  });
});

// ── Backfill ─────────────────────────────────────────────────────────────────

describe("stats backfill", () => {
  it("reads uncounted files behind the open and writes the totals into properties", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    await waitFor(() => {
      const stats = propsOf(provider).stats as {
        perNode: { nodeId: string; words: number; updatedAt?: string }[];
      };
      expect(stats.perNode.length).toBe(4);
    });
    const stats = propsOf(provider).stats as {
      perNode: { nodeId: string; words: number; updatedAt?: string }[];
    };
    // Entries are keyed by the node's id: the count belongs to the node, not
    // to whichever file name it lives in.
    const opening = stats.perNode.find((n) => n.nodeId === "EL3");
    expect(opening?.words).toBe(
      countWords(DEFAULT_FILES[filePath("section--opening.EL3.00.md")]),
    );
    // The backfill counts files the editor has never written, so it stamps
    // no edit time on them; a fabricated "now" would make the snapshot table
    // claim a just-opened book was just being edited.
    expect(opening?.updatedAt).toBeUndefined();
  });
});

// ── Empty folders ────────────────────────────────────────────────────────────

describe("an empty folder under the root", () => {
  it("settles invalid with missingProperties — the editor never scaffolds in place; creation is the Library's", async () => {
    const { provider } = await make({
      props: null,
      structure: null,
      files: {},
    });
    await waitFor(() => expect(attr("status")()).toBe("invalid"));
    expect(attr("validation")()).toBe("missingProperties");
    // No scaffold happened and none can be asked for: the affordance is gone.
    expect(provider.files.has(PROPERTIES_FILE)).toBe(false);
    expect(provider.files.has(STRUCTURE_FILE)).toBe(false);
  });
});

// ── Opening one file ─────────────────────────────────────────────────────────

describe("opening one file", () => {
  it("opens a file when the buffer is clean", async () => {
    const { engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("openStorm");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.00.md"),
    );
    expect(engine.commonmark).toContain("It came in from the west");
  });

  it("asks before discarding unsaved changes, and honours the answer", async () => {
    const { engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("x"));
    click("openStorm");
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "leave.stay" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(attr("active")()).toBe("section--opening.EL3.00.md");
    expect(engine.commonmark).toContain("The house had been empty");

    click("openStorm");
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "leave.skip" }));
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.00.md"),
    );
    expect(engine.commonmark).toContain("It came in from the west");
  });

  it("Save on the leave dialog writes the buffer before switching files", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("!"));
    click("openStorm");
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.00.md"),
    );
    // The dirty buffer reached disk before the switch, so nothing is lost.
    expect(
      provider.files.get(filePath("section--opening.EL3.00.md")),
    ).toContain("!");
    expect(engine.hasChanges).toBe(false);
  });

  it("a failed save from the leave dialog keeps the writer where they were", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("x"));
    const original = provider.writeFile.getMockImplementation();
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === filePath("section--opening.EL3.00.md"))
        throw new StorageError("Disk full", "io");
      return original?.(ref, path, content);
    });
    click("openStorm");
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    expect(attr("active")()).toBe("section--opening.EL3.00.md");
    expect(engine.hasChanges).toBe(true);
  });

  it("the file asked for last stays open when an earlier, slower read lands after it", async () => {
    let release = () => {};
    const { engine } = await make({
      open: null,
      before: (p) => {
        const original = p.readFile.getMockImplementation();
        if (!original)
          throw new Error("readFile must have an implementation to rewrap");
        p.readFile.mockImplementation(async (ref, path) => {
          if (path === filePath("section--opening.EL3.00.md"))
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return original(ref, path);
        });
      },
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("openFile");
    click("openStorm");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.00.md"),
    );
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(attr("active")()).toBe("section--the_storm.EL4.00.md");
    expect(engine.commonmark).toContain("It came in from the west");
  });

  it("a file whose read lands after the writer went back to the Desk stays closed", async () => {
    let release: (() => void) | null = null;
    const { engine } = await make({
      open: null,
      before: (p) => {
        const original = p.readFile.getMockImplementation();
        if (!original)
          throw new Error("readFile must have an implementation to rewrap");
        p.readFile.mockImplementation(async (ref, path) => {
          if (path === filePath("section--opening.EL3.00.md"))
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return original(ref, path);
        });
      },
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("openFile");
    // The read is in flight before the writer leaves.
    await waitFor(() => expect(release).not.toBeNull());
    click("closeFile");
    await act(async () => {
      (release as (() => void) | null)?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(attr("active")()).toBe("");
    expect(engine.commonmark).toBe("");
  });

  it("opening the file already open is a no-op, even with a dirty buffer", async () => {
    const { engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("x"));
    click("openFile");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(attr("active")()).toBe("section--opening.EL3.00.md");
  });

  it("saveActiveFile writes the buffer, blesses it, and records its count", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("!"));
    click("save");
    await waitFor(() => expect(engine.hasChanges).toBe(false));
    const saved = provider.files.get(filePath("section--opening.EL3.00.md"));
    expect(saved).toBe(engine.save());
    await waitFor(() => {
      const stats = propsOf(provider).stats as {
        perNode: { nodeId: string; words: number }[];
      };
      expect(stats.perNode.find((n) => n.nodeId === "EL3")?.words).toBe(
        countWords(saved ?? ""),
      );
    });
  });

  // A save writes its count and its hash in one properties write. Two writes
  // change the project state twice, redrawing everything that reads it.
  it("records a save's count and hash in one properties write", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    // The open's own background writes come first: the visit's session, the
    // hash backfill of every node and the count backfill all land.
    await waitFor(() => {
      const props = propsOf(provider);
      const snaps = Object.values(
        hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>,
      );
      expect(snaps.every((list) => list[0]?.contentHash)).toBe(true);
      expect((props.ui as { session?: unknown }).session).toBeDefined();
      expect((props.stats as { countedAt?: string }).countedAt).toBeTruthy();
    });
    // And any write still behind them.
    await settle(provider);
    const countedBefore = (propsOf(provider).stats as { countedAt?: string })
      .countedAt;
    const writes = vi.spyOn(provider, "writeFile");
    // A whole word, so the count moves and its write can be told apart.
    act(() => engine.type(" more"));
    click("save");
    const saved = await waitFor(() => {
      const text = provider.files.get(filePath("section--opening.EL3.00.md"));
      expect(text).toBe(engine.save());
      return text ?? "";
    });
    const hash = await hashOf(saved);
    await waitFor(() => {
      const props = propsOf(provider);
      const snaps = (
        hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
      )["EL3"];
      expect(snaps?.[0]?.contentHash).toBe(hash);
      const stats = props.stats as {
        perNode: { nodeId: string; words: number }[];
      };
      expect(stats.perNode.find((n) => n.nodeId === "EL3")?.words).toBe(
        countWords(saved),
      );
    });
    // Every properties write since the save began, read back. Writes queued
    // before it still land in the lane and carry the old count stamp; the
    // first one stamped by this save already carries its hash, never a count
    // alone with the hash following in a second write.
    const written = writes.mock.calls
      .filter(([, path]) => path === PROPERTIES_FILE)
      .map(([, , text]) => JSON.parse(String(text)) as Record<string, unknown>);
    const stamped = written.findIndex(
      (doc) =>
        (doc.stats as { countedAt?: string }).countedAt !== countedBefore,
    );
    expect(stamped).not.toBe(-1);
    const doc = written[stamped];
    expect(
      (doc.snapshotHashes as Record<string, string>)[
        "section--opening.EL3.00.md"
      ],
    ).toBe(hash);
    expect(
      (
        doc.stats as { perNode: { nodeId: string; words: number }[] }
      ).perNode.find((n) => n.nodeId === "EL3")?.words,
    ).toBe(countWords(saved));
  });

  it("a failed save leaves the buffer dirty and reports the error", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("x"));
    const original = provider.writeFile.getMockImplementation();
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === filePath("section--opening.EL3.00.md"))
        throw new StorageError("Disk full", "io");
      return original?.(ref, path, content);
    });
    click("save");
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    expect(engine.hasChanges).toBe(true);
  });

  // `StorageError` messages are English prose in the storage layer and never
  // reach the writer's screen: the mapper hands back a translation key (this
  // suite's `t` returns the key as-is), so a failed write in the Italian
  // locale reads Italian. Code `unavailable` maps to `storage.unreachable`,
  // not to a key named after the code.
  it("— a failed write surfaces a translation key, not English StorageError prose", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("x"));
    const original = provider.writeFile.getMockImplementation();
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === filePath("section--opening.EL3.00.md")) {
        throw new StorageError(
          "Phospheare could not reach Google Drive.",
          "unavailable",
        );
      }
      return original?.(ref, path, content);
    });
    click("save");
    await waitFor(() => expect(attr("error")()).toBe("storage.unreachable"));
    expect(attr("error")()).not.toMatch(/Phospheare|could not|Google Drive/i);
  });
});

// ── Structural changes and their undo ────────────────────────────────────────

describe("structural changes", () => {
  it("addNode writes the file, updates the yaml, and arms the undo toast", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("addPart");
    await waitFor(() =>
      expect(provider.files.has(filePath("part--interlude.EL5.00.md"))).toBe(
        true,
      ),
    );
    expect(provider.files.get(filePath("part--interlude.EL5.00.md"))).toBe("");
    expect(attr("last")()).toBe("added");
    // A node is born with its id and one adopted snapshot, its .00.
    const structure = structureOf(provider);
    expect(
      structure.children.some((c) => c.id === "EL5" && c.title === "Interlude"),
    ).toBe(true);

    click("undo");
    await waitFor(() => expect(attr("last")()).toBe(""));
    expect(provider.files.has(filePath("part--interlude.EL5.00.md"))).toBe(
      false,
    );
    expect(
      structureOf(provider).children.some((c) => c.title === "Interlude"),
    ).toBe(false);
  });

  it("a failed undo of addNode keeps the prose saved into the new node", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("addPart");
    await waitFor(() => expect(attr("last")()).toBe("added"));
    const file = filePath("part--interlude.EL5.00.md");
    provider.files.set(file, "Prose saved into the new Part.");
    const original = provider.writeFile.getMockImplementation();
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === "/snapshots-catalogue.json")
        throw new StorageError("disk full", "io");
      return original?.(ref, path, content);
    });

    click("undo");
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    expect(provider.files.get(file)).toBe("Prose saved into the new Part.");
    // The yaml and the catalogue both still name the node, so the book opens.
    expect(structureOf(provider).children.some((c) => c.id === "EL5")).toBe(
      true,
    );
    const catalogue = JSON.parse(
      provider.files.get("/snapshots-catalogue.json") ?? "{}",
    ) as { snapshots: Record<string, unknown[]> };
    expect(catalogue.snapshots.EL5).toHaveLength(1);
  });

  it("addNode opens the new node for writing the moment it exists", async () => {
    await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("addPart");
    // The freshly created node becomes the active file.
    await waitFor(() =>
      expect(attr("active")()).toBe("part--interlude.EL5.00.md"),
    );
  });

  it("addNode does not yank the writer out of their file when the commit fails", async () => {
    await make({
      before: (p) => {
        const original = p.writeFile.getMockImplementation();
        p.writeFile.mockImplementation(async (ref, path, content) => {
          if (path === filePath("part--interlude.EL5.00.md"))
            throw new StorageError("Disk full", "io");
          return original?.(ref, path, content);
        });
      },
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("addPart");
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    // The current file stays open: a failed add does not move the writer.
    expect(attr("active")()).toBe("section--opening.EL3.00.md");
  });

  it("addNode puts a Section inside a Part when told to", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("addToPart");
    await waitFor(() => expect(attr("last")()).toBe("added"));
    const structure = structureOf(provider);
    expect(
      childrenOf(structure, "EL2").some((c) => c.title === "Arrival"),
    ).toBe(true);
  });

  it("renameNodeTo renames the file, retargets the open file, and undoes", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("rename");
    await waitFor(() =>
      expect(provider.files.has(filePath("section--dawn.EL3.00.md"))).toBe(
        true,
      ),
    );
    expect(provider.files.has(filePath("section--opening.EL3.00.md"))).toBe(
      false,
    );
    expect(attr("active")()).toBe("section--dawn.EL3.00.md");
    expect(attr("last")()).toBe("renamed");

    click("undo");
    await waitFor(() =>
      expect(provider.files.has(filePath("section--opening.EL3.00.md"))).toBe(
        true,
      ),
    );
    expect(attr("active")()).toBe("section--opening.EL3.00.md");
  });

  it("renaming to the current name is a no-op", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    const writes = provider.writeFile.mock.calls.length;
    click("renameSame");
    expect(attr("last")()).toBe("");
    expect(provider.writeFile.mock.calls.length).toBe(writes);
    expect(provider.files.get(STRUCTURE_FILE)).toBe(STRUCTURE);
  });

  it("removeNodeAt moves a lone node out to recyclebin/ and clears the open file", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("removeLeaf");
    await waitFor(() => expect(attr("last")()).toBe("removed"));
    expect(provider.files.has("/recyclebin/section--opening.EL3.00.md")).toBe(
      true,
    );
    expect(provider.files.has(filePath("section--opening.EL3.00.md"))).toBe(
      false,
    );
    expect(attr("active")()).toBe("");
    // The subtree also lands in the yaml's `removed:` list, where the bin can
    // render it and a restore can bring it back.
    const after = structureOf(provider);
    expect(after.removed?.map((n) => n.id)).toEqual(["EL3"]);

    click("undo");
    await waitFor(() =>
      expect(provider.files.has(filePath("section--opening.EL3.00.md"))).toBe(
        true,
      ),
    );
    expect(provider.files.has("/recyclebin/section--opening.EL3.00.md")).toBe(
      false,
    );
    const restored = structureOf(provider);
    expect(childrenOf(restored, "EL1").some((c) => c.id === "EL3")).toBe(true);
    expect(restored.removed).toEqual([]);
  });

  it("removeNodeAt moves every file of a populated Part out together", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("removePart");
    await waitFor(() =>
      expect(provider.files.has("/recyclebin/part--act_one.EL1.00.md")).toBe(
        true,
      ),
    );
    expect(provider.files.has("/recyclebin/section--opening.EL3.00.md")).toBe(
      true,
    );
    expect(provider.files.has("/recyclebin/section--the_storm.EL4.00.md")).toBe(
      true,
    );
    const structure = structureOf(provider);
    expect(structure.children.some((c) => c.title === "Act One")).toBe(false);
    // The bin keeps the whole subtree, so a restore brings the Part back whole.
    expect(structure.removed?.[0]).toMatchObject({
      kind: "part",
      id: "EL1",
      title: "Act One",
    });
  });

  it("removeNodeAt clears a lastOpened that named the removed node", async () => {
    await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    // The fixture's `lastOpened` is EL3, the node `removeLeaf` takes.
    expect(attr("lastopened")()).toBe("EL3");
    click("removeLeaf");
    await waitFor(() => expect(attr("last")()).toBe("removed"));
    // No stale id stays in the properties pointing at the bin.
    await waitFor(() => expect(attr("lastopened")()).toBe(""));
  });

  it("removeNodeAt takes the removed node's generated summary with it", async () => {
    // A summary left behind keeps the shelf drawing a summary of a chapter
    // that is gone, and the assistant reading it. The file is removed rather
    // than binned, unlike the node's own files: a summary is derived material
    // the assistant regenerates, and nobody restores it from the bin.
    const { provider } = await make({
      props: PROPS.replace(
        `"sync": null,`,
        `"sync": null,\n  "summaries": { "EL3": "summary--EL3.md" },`,
      ),
      before: (p) => p.files.set("/reference/summary--EL3.md", "what happens"),
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));

    click("removeLeaf");
    await waitFor(() => expect(attr("last")()).toBe("removed"));

    await waitFor(() =>
      expect(provider.files.has("/reference/summary--EL3.md")).toBe(false),
    );
    // Not moved: the bin is for the writer's own work, not for what the
    // assistant can make again.
    expect(provider.files.has("/recyclebin/summary--EL3.md")).toBe(false);
    // The binding goes with it: a binding whose file is gone claims a summary
    // still exists.
    await waitFor(() =>
      expect(provider.files.get(PROPERTIES_FILE)).not.toContain(
        "summary--EL3.md",
      ),
    );
  });

  it("restoreFromBin moves the files back and puts the node where it was dropped", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("removeLeaf");
    await waitFor(() => expect(attr("last")()).toBe("removed"));

    click("restore");
    await waitFor(() => expect(attr("last")()).toBe("restored"));
    expect(provider.files.has(filePath("section--opening.EL3.00.md"))).toBe(
      true,
    );
    expect(provider.files.has("/recyclebin/section--opening.EL3.00.md")).toBe(
      false,
    );
    const structure = structureOf(provider);
    expect(childrenOf(structure, "EL2")[0]?.id).toBe("EL3");
    expect(structure.removed).toEqual([]);

    click("undo");
    await waitFor(() => expect(attr("last")()).toBe(""));
    expect(provider.files.has("/recyclebin/section--opening.EL3.00.md")).toBe(
      true,
    );
    expect(structureOf(provider).removed?.map((n) => n.id)).toEqual(["EL3"]);
  });

  it("restoreFromBin brings back a node whose title a live node now uses", async () => {
    // Titles are free: a new "Opening" written while the old one sat
    // in the bin is a different file with its own id, so the restore does not
    // collide with it and both live side by side.
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("removeLeaf");
    await waitFor(() => expect(attr("last")()).toBe("removed"));

    click("addOpening");
    await waitFor(() =>
      expect(provider.files.has(filePath("section--opening.EL5.00.md"))).toBe(
        true,
      ),
    );
    click("restore");
    await waitFor(() => expect(attr("last")()).toBe("restored"));
    expect(provider.files.has(filePath("section--opening.EL3.00.md"))).toBe(
      true,
    );
    expect(provider.files.has(filePath("section--opening.EL5.00.md"))).toBe(
      true,
    );
    expect(attr("error")()).toBe("");
  });

  it("— says so when the id is not a whole bin item, rather than doing nothing", async () => {
    // Removing the Part sends the whole subtree to the bin as one entry, so
    // EL3 is nested inside it rather than a top-level `removed:` row.
    // `restoreTargets` and `canRestore` both accept it and offer real
    // destinations, while the resolve here is top-level only, so a miss
    // reports an error rather than doing nothing.
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("removePart");
    await waitFor(() => expect(attr("last")()).toBe("removed"));
    expect(structureOf(provider).removed?.map((n) => n.id)).toEqual(["EL1"]);

    click("restore");
    await waitFor(() => expect(attr("error")()).toBe("bin.restoreNotWhole"));
    // Nothing moved on the way to saying so.
    expect(structureOf(provider).removed?.map((n) => n.id)).toEqual(["EL1"]);
  });

  it("moveNodesTo rewrites only the yaml, and undo restores it", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("move");
    await waitFor(() => expect(attr("last")()).toBe("moved"));
    const structure = structureOf(provider);
    expect(childrenOf(structure, "EL2")[0]?.id).toBe("EL3");
    // The flat layout means no file ever moves on disk.
    expect(provider.files.has(filePath("section--opening.EL3.00.md"))).toBe(
      true,
    );

    click("undo");
    await waitFor(() => expect(attr("last")()).toBe(""));
    const restored = structureOf(provider);
    expect(childrenOf(restored, "EL1").some((c) => c.id === "EL3")).toBe(true);
  });

  // A group is one yaml write, so one undo takes all of it back.
  it("moveNodesTo lands a group in document order, and one undo restores it", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    const before = structureOf(provider);
    click("moveGroup");
    await waitFor(() => expect(attr("last")()).toBe("movedSections"));
    const structure = structureOf(provider);
    // Named The Storm first; the book's order is what lands.
    expect(childrenOf(structure, "EL2").map((c) => c.id)).toEqual([
      "EL3",
      "EL4",
    ]);
    expect(childrenOf(structure, "EL1")).toEqual([]);

    click("undo");
    await waitFor(() => expect(attr("last")()).toBe(""));
    const restored = structureOf(provider);
    expect(childrenOf(restored, "EL1").map((c) => c.id)).toEqual(
      childrenOf(before, "EL1").map((c) => c.id),
    );
    expect(childrenOf(restored, "EL2")).toEqual([]);
  });

  it("a failed file write aborts the commit: no yaml change, no toast", async () => {
    const { provider } = await make({
      before: (p) => {
        const original = p.writeFile.getMockImplementation();
        p.writeFile.mockImplementation(async (ref, path, content) => {
          if (path === filePath("part--interlude.EL5.00.md"))
            throw new StorageError("Disk full", "io");
          return original?.(ref, path, content);
        });
      },
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("addPart");
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    expect(attr("last")()).toBe("");
    expect(provider.files.has(filePath("part--interlude.EL5.00.md"))).toBe(
      false,
    );
    expect(
      structureOf(provider).children.some((c) => c.title === "Interlude"),
    ).toBe(false);
  });

  it("a failed yaml write puts the files back", async () => {
    const { provider } = await make({
      before: (p) => {
        const original = p.writeFile.getMockImplementation();
        p.writeFile.mockImplementation(async (ref, path, content) => {
          if (path === STRUCTURE_FILE)
            throw new StorageError("Disk full", "io");
          return original?.(ref, path, content);
        });
      },
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("addPart");
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    expect(attr("last")()).toBe("");
    expect(provider.files.has(filePath("part--interlude.EL5.00.md"))).toBe(
      false,
    );
    expect(provider.files.get(STRUCTURE_FILE)).toBe(STRUCTURE);
  });

  it("a failed undo reports the error and drops the toast", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("removeLeaf");
    await waitFor(() => expect(attr("last")()).toBe("removed"));
    provider.moveFile.mockRejectedValueOnce(
      new StorageError("Permission lost", "permission"),
    );
    click("undo");
    await waitFor(() => expect(attr("error")()).toBe("storage.permission"));
    expect(attr("last")()).toBe("");
  });

  it("saveUi persists expansion and the last opened file", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("saveUi");
    await waitFor(() => expect(attr("expanded")()).toBe("EL1"));
    const ui = propsOf(provider).ui as {
      expanded: string[];
      lastOpened: string | null;
    };
    expect(ui.expanded).toEqual(["EL1"]);
    // `lastOpened` is the id of the node owning the open file: ids survive
    // renames and adoptions, and a file name does not.
    expect(ui.lastOpened).toBe("EL3");
  });

  it("setPrefs writes the setting into the project's properties, state and disk", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    fireEvent.click(screen.getByTestId("act-setPrefs"));
    await waitFor(() => {
      const ui = propsOf(provider).ui as {
        proseSize?: number;
        typewriter?: boolean;
      };
      expect(ui.proseSize).toBe(21);
      expect(ui.typewriter).toBe(true);
    });
    // The state update is synchronous with the picker: the properties the
    // context hands out already carry the new setting, and the write lands
    // behind it. A partial change does not erode the ui it did not name.
    const ui = propsOf(provider).ui as {
      proseSize?: number;
      typewriter?: boolean;
      lastOpened: string | null;
      expanded: string[];
    };
    expect(ui.lastOpened).toBe("EL3");
    expect(ui.expanded).toEqual(["EL1"]);
  });

  it("setDockWidth remembers the dock width without eroding the rest of ui", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    fireEvent.click(screen.getByTestId("act-setDockWidth"));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { dockWidth?: number | null };
      expect(ui.dockWidth).toBe(480);
    });
    const ui = propsOf(provider).ui as {
      dockWidth?: number | null;
      proseSize?: number | null;
      expanded: string[];
    };
    expect(ui.expanded).toEqual(["EL1"]);
    expect(ui.proseSize).toBeNull();
  });

  // The `ui` block is replace-merged, so remembering one panel's width does
  // not drop the other's or anything else the writer has set.
  it("setStructureWidth remembers the panel width without eroding the rest of ui", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    fireEvent.click(screen.getByTestId("act-setDockWidth"));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { dockWidth?: number | null };
      expect(ui.dockWidth).toBe(480);
    });
    fireEvent.click(screen.getByTestId("act-setStructureWidth"));
    await waitFor(() => {
      const ui = propsOf(provider).ui as { structureWidth?: number | null };
      expect(ui.structureWidth).toBe(320);
    });
    const ui = propsOf(provider).ui as {
      dockWidth?: number | null;
      structureWidth?: number | null;
      expanded: string[];
    };
    expect(ui.dockWidth).toBe(480);
    expect(ui.expanded).toEqual(["EL1"]);
  });
});

// ── The undo timeline's journal ──────────────────────────────────────────────
//
// The per-file `history/<file>.json` flush rides the save path after the
// `.md` write, lands on file switches and on hide and close events, hydrates
// on open with the tail-reconcile dropping a stale journal (with one quiet
// toast), and never overwrites a foreign or unreadable journal on disk. The
// journal is named by snapshot file name, so each snapshot owns its own
// timeline through adoption cycles.

function journalSection(
  provider: FakeProvider,
  fileName: string,
): string | null {
  return provider.files.get(historyPath(fileName)) ?? null;
}

/**
 * A timeline built from the file's bytes, with one edit and one undo: the
 * head ends back at the file's content, with a walk left to undo.
 */
function journalFor(md: string): string {
  const timeline = new DeltaTimeline();
  const session = new Session({
    codec: commonmarkCodec,
    history: timeline,
    search: regexSearch,
    events: new Emitter<SessionEvents>(),
    clipboard: browserClipboardCodec,
  });
  session.open(md);
  session.type("!");
  session.backspace();
  return timeline.exportJournal() as string;
}

describe("the undo timeline's journal", () => {
  it("save flushes the journal only after the .md write lands", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    engine.type("x");
    click("save");
    await waitFor(() =>
      expect(
        journalSection(provider, "section--opening.EL3.00.md"),
      ).not.toBeNull(),
    );
    expect(journalSection(provider, "section--opening.EL3.00.md")).toBe(
      engine.exportJournal(),
    );
    // The flush comes after the md write: both land, in that order.
    const mdWrites = provider.writeFile.mock.calls.filter(
      (c) => c[1] === filePath("section--opening.EL3.00.md"),
    ).length;
    const journalWrites = provider.writeFile.mock.calls.filter(
      (c) => c[1] === historyPath("section--opening.EL3.00.md"),
    ).length;
    expect(mdWrites).toBe(1);
    expect(journalWrites).toBe(1);
  });

  it("a clean-but-walked timeline still flushes on file switch", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    engine.type("x");
    click("save");
    await waitFor(() =>
      expect(
        journalSection(provider, "section--opening.EL3.00.md"),
      ).not.toBeNull(),
    );
    engine.enter(); // a separate step, so the undo below lands on the saved state
    engine.undo(); // back to the saved state — clean, but the timeline moved
    expect(engine.hasChanges).toBe(false);
    const walked = engine.exportJournal();
    expect(walked).not.toBe(
      journalSection(provider, "section--opening.EL3.00.md"),
    );
    click("openStorm");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.00.md"),
    );
    expect(journalSection(provider, "section--opening.EL3.00.md")).toBe(walked);
  });

  it("open hydrates the file's timeline from the journal", async () => {
    const stormMd = DEFAULT_FILES[filePath("section--the_storm.EL4.00.md")];
    // The engine holds a document, so it is compared against the file's
    // canonical form, not its raw bytes; the two differ by the file's
    // terminating newline, which the parser does not fold into the last
    // paragraph. Open restores the timeline, and undo returns to
    // the state the file was opened in.
    const opened = commonmarkCodec.serialize(commonmarkCodec.parse(stormMd));
    const journal = journalFor(stormMd);
    const { engine } = await make({
      before: (p) =>
        p.files.set(historyPath("section--the_storm.EL4.00.md"), journal),
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("openStorm");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.00.md"),
    );
    expect(engine.commonmark).toBe(opened);
    expect(engine.canUndo).toBe(true);
    engine.undo();
    engine.undo();
    expect(engine.commonmark).toBe(opened);
  });

  it("a stale journal is dropped at open, with one quiet toast", async () => {
    // The journal's head does not match the file on disk: it is built for
    // other text, and the restore opens `section--opening.EL3.00.md`.
    const journal = journalFor("completely different text");
    const { engine, view } = await make({
      before: (p) =>
        p.files.set(historyPath("section--opening.EL3.00.md"), journal),
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    expect(engine.canUndo).toBe(false);
    expect(view.container.querySelector(".rev-notice")).not.toBeNull();
  });

  it("never flushes over a foreign journal on disk", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    engine.type("a");
    click("save");
    await waitFor(() =>
      expect(
        journalSection(provider, "section--opening.EL3.00.md"),
      ).not.toBeNull(),
    );

    // Another device writes newer steps to the same file.
    provider.files.set(
      historyPath("section--opening.EL3.00.md"),
      "foreign-journal",
    );

    engine.type("b");
    click("save");
    await waitFor(() => expect(engine.hasChanges).toBe(false));
    // The second flush is skipped: the disk copy still holds the foreign
    // journal, and only the first flush wrote the file.
    expect(journalSection(provider, "section--opening.EL3.00.md")).toBe(
      "foreign-journal",
    );
    const journalWrites = provider.writeFile.mock.calls.filter(
      (c) => c[1] === historyPath("section--opening.EL3.00.md"),
    ).length;
    expect(journalWrites).toBe(1);
  });

  it("a journal read that fails never wipes another Section's journal", async () => {
    const { provider, engine } = await make({
      before: (p) =>
        p.files.set(
          historyPath("section--the_storm.EL4.00.md"),
          "storm-journal",
        ),
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    const originalRead = provider.readFile.getMockImplementation();
    if (!originalRead) throw new Error("readFile must have an implementation");
    provider.readFile.mockImplementation(async (ref, path) => {
      if (path.startsWith(`${HISTORY_DIR}/`))
        throw new StorageError("busy", "io");
      return originalRead(ref, path);
    });
    engine.type("x");
    click("save");
    await waitFor(() => expect(engine.hasChanges).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(journalSection(provider, "section--the_storm.EL4.00.md")).toBe(
      "storm-journal",
    );
    // An unreadable journal is never taken for an absent one: the flush
    // writes nothing over steps it could not see.
    expect(
      provider.writeFile.mock.calls.some((c) =>
        String(c[1]).startsWith(`${HISTORY_DIR}/`),
      ),
    ).toBe(false);
  });

  it("a journal unreadable at open is never written over", async () => {
    const { provider, engine } = await make({
      before: (p) => {
        p.files.set(historyPath("section--opening.EL3.00.md"), "kept-journal");
        const originalRead = p.readFile.getMockImplementation();
        if (!originalRead)
          throw new Error("readFile must have an implementation");
        let failed = false;
        p.readFile.mockImplementation(async (ref, path) => {
          // The open's read fails once; every later read succeeds.
          if (path === historyPath("section--opening.EL3.00.md") && !failed) {
            failed = true;
            throw new StorageError("busy", "io");
          }
          return originalRead(ref, path);
        });
      },
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    engine.type("x");
    click("save");
    await waitFor(() => expect(engine.hasChanges).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(journalSection(provider, "section--opening.EL3.00.md")).toBe(
      "kept-journal",
    );
  });

  it("pagehide forces a flush of a never-saved timeline", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    engine.type("x");
    expect(journalSection(provider, "section--opening.EL3.00.md")).toBeNull();
    fireEvent(window, new Event("pagehide"));
    await waitFor(() =>
      expect(journalSection(provider, "section--opening.EL3.00.md")).toBe(
        engine.exportJournal(),
      ),
    );
  });

  it("visibilitychange to hidden forces the flush; visible does not", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    engine.type("x");
    // The listener is on `document`; a window event would never reach it
    // and the negative assertion would be vacuous.
    fireEvent(document, new Event("visibilitychange"));
    expect(journalSection(provider, "section--opening.EL3.00.md")).toBeNull();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    try {
      fireEvent(document, new Event("visibilitychange"));
      expect(journalSection(provider, "section--opening.EL3.00.md")).toBeNull();
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }

    // jsdom's `visibilityState` is a prototype accessor, so
    // `getOwnPropertyDescriptor(document, ...)` returns nothing. The restore
    // below deletes the own property the define created, or the "hidden"
    // value leaks into every later suite that reads it.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    try {
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() =>
        expect(journalSection(provider, "section--opening.EL3.00.md")).toBe(
          engine.exportJournal(),
        ),
      );
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });

  it("— renaming a file moves its journal section to the new name", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    engine.type("x");
    click("save");
    await waitFor(() =>
      expect(
        journalSection(provider, "section--opening.EL3.00.md"),
      ).not.toBeNull(),
    );
    const before = journalSection(provider, "section--opening.EL3.00.md");
    click("rename");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--dawn.EL3.00.md"),
    );
    // The timeline is keyed by `fileName`: the rename re-keys the section, or
    // the renamed file reopens with an empty history and the old section
    // lingers, since the name-reuse guard only sees it as stale.
    await waitFor(() =>
      expect(journalSection(provider, "section--dawn.EL3.00.md")).toBe(before),
    );
    expect(journalSection(provider, "section--opening.EL3.00.md")).toBeNull();
  });

  it("— undoing a rename moves the journal section back to the reverted name", async () => {
    // The rename moves the section to the new name, and the
    // undo toast's rollback moves it back with the file. A null old-name
    // section makes the foreign-journal baseline comparison skip every flush
    // for the rest of the session, and the reverted file reopens with an
    // empty timeline.
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    engine.type("x");
    click("save");
    await waitFor(() =>
      expect(
        journalSection(provider, "section--opening.EL3.00.md"),
      ).not.toBeNull(),
    );
    click("rename");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--dawn.EL3.00.md"),
    );
    await waitFor(() =>
      expect(
        journalSection(provider, "section--dawn.EL3.00.md"),
      ).not.toBeNull(),
    );
    click("undo"); // the rename toast's rollback: Dawn → opening
    await waitFor(() =>
      expect(attr("active")()).toBe("section--opening.EL3.00.md"),
    );
    engine.type("y");
    click("save");
    await waitFor(() => expect(engine.hasChanges).toBe(false));
    // The file is back under the old name, and so is its timeline.
    expect(journalSection(provider, "section--opening.EL3.00.md")).toBe(
      engine.exportJournal(),
    );
    expect(journalSection(provider, "section--dawn.EL3.00.md")).toBeNull();
  });
});

// ── Snapshot actions ─────────────────────────────────────────────────────────
//
// The shell's snapshot actions ride the same commit funnel as the structural
// ops. A snapshot's save lands in its own file and never in the adopted one;
// adopt is a yaml pointer swap that copies nothing and arms no undo, because
// adopting back is the undo; delete bins the snapshot, is refused while it is
// adopted, and drops its journal section.

const STRUCTURE_WITH_SNAPSHOTS = `# Phospheare — document structure
# The order of this list is the order of the finished document.
# Phospheare rewrites this file when the structure changes; comments below are not preserved.
version: 1
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
        section: Opening
        adopted: section--opening.EL3.00.md
        snapshots:
          - file: section--opening.EL3.00.md
            title: Opening 1
            created: 2026-01-01T00:00:00.000Z
      - id: EL4
        section: The Storm
        adopted: section--the_storm.EL4.00.md
        snapshots:
          - file: section--the_storm.EL4.00.md
            title: The Storm 1
            created: 2026-01-01T00:00:00.000Z
          - file: section--the_storm.EL4.01.md
            title: The Storm 2
            created: 2026-08-14T09:12:00.000Z
  - id: EL2
    part: Act Two
    adopted: part--act_two.EL2.00.md
    snapshots:
      - file: part--act_two.EL2.00.md
        title: Act Two 1
        created: 2026-01-01T00:00:00.000Z
    children: []
`;

const FILES_WITH_SNAPSHOTS: Record<string, string> = {
  ...DEFAULT_FILES,
  [filePath("section--the_storm.EL4.01.md")]: "It came in from the south.\n",
};

/** The storm node's snapshots, as the yaml currently holds them. */
function stormSnapshotsOf(provider: FakeProvider) {
  const node = findNode(structureOf(provider), "EL4");
  if (!node) throw new Error("fixture: the storm node EL4 is missing");
  return node.snapshots;
}

/** The bin's own half of the snapshot record, from the catalogue. */
function binnedSnapshotsOf(provider: FakeProvider) {
  return Object.values(catalogueOf(provider).binned).flat();
}

describe("snapshot actions in the shell", () => {
  it("addSnapshot copies the adopted file to xy max+1 and registers the yaml entry with an undo toast", async () => {
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("addSnapshot");
    await waitFor(() =>
      expect(provider.files.has(filePath("section--the_storm.EL4.02.md"))).toBe(
        true,
      ),
    );
    // The copy captures the adopted file, what the save-first gate kept.
    expect(provider.files.get(filePath("section--the_storm.EL4.02.md"))).toBe(
      "It came in from the west, without warning.\n",
    );
    // xy is max+1: the existing .01 is never overwritten or re-numbered.
    const snapshots = stormSnapshotsOf(provider);
    expect(snapshots.length).toBe(3);
    expect(snapshots[2]?.file).toBe("section--the_storm.EL4.02.md");
    expect(snapshots[2]?.title).toBe("The Storm 3");
    await waitFor(() => expect(added).toBe("section--the_storm.EL4.02.md"));
    // It rides the funnel: one undo toast, whose code is the added
    // snapshot's toast.
    expect(attr("last")()).toBe("createdSnapshot");

    click("undo");
    await waitFor(() => expect(attr("last")()).toBe(""));
    expect(provider.files.has(filePath("section--the_storm.EL4.02.md"))).toBe(
      false,
    );
    expect(stormSnapshotsOf(provider).length).toBe(2);
  });

  it("— the snapshot's stored hash and its copied bytes come from the SAME read of the adopted file", async () => {
    // The hash and the copy come from one `readFile` of the adopted file.
    // With two reads, a save landing between them persists a hash for bytes
    // never written to the snapshot. The read count pins it.
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    // The open-time backfill settles first: it reads every snapshot file,
    // including this node's first snapshot, which shares the adopted file's
    // path in this fixture, and the spy would count those reads too.
    await waitFor(() => {
      const snaps = (
        hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
      )["EL4"];
      expect(snaps?.every((s) => s.contentHash)).toBe(true);
    });

    const adoptedPath = filePath("section--the_storm.EL4.00.md");
    // `readFile` is already a `vi.fn()` in the fake provider, so `spyOn`
    // returns that same mock, with its earlier call history. It is cleared so
    // only what `addSnapshot` does from here counts, not the open-time verify
    // and backfill sweeps.
    const readSpy = vi.spyOn(provider, "readFile");
    readSpy.mockClear();
    const readsOfAdopted = () =>
      readSpy.mock.calls.filter(([, path]) => path === adoptedPath).length;

    click("addSnapshot");
    await waitFor(() =>
      expect(provider.files.has(filePath("section--the_storm.EL4.02.md"))).toBe(
        true,
      ),
    );

    expect(readsOfAdopted()).toBe(1);
    // With a single shared read, the copy is whatever that one read
    // returned: the adopted file's unmodified content.
    expect(provider.files.get(filePath("section--the_storm.EL4.02.md"))).toBe(
      provider.files.get(adoptedPath),
    );
  });

  it("a snapshot's save lands in its own file, never the adopted one, and the count belongs to the node", async () => {
    const { provider, engine } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("openSnapshot");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.01.md"),
    );
    engine.type(" and the water rose");
    click("save");
    await waitFor(() => expect(engine.hasChanges).toBe(false));
    // The write path is the snapshot's own file, resolved from its name.
    expect(
      provider.files.get(filePath("section--the_storm.EL4.01.md")),
    ).toContain("and the water rose");
    // The node's adopted file is untouched: a snapshot is its own text.
    expect(provider.files.get(filePath("section--the_storm.EL4.00.md"))).toBe(
      "It came in from the west, without warning.\n",
    );
    // The count is keyed by the node's id, never a per-file entry.
    const stats = propsOf(provider).stats as {
      perNode: Array<{ nodeId: string; words: number }>;
    };
    expect(stats.perNode.some((n) => n.nodeId.startsWith("section--"))).toBe(
      false,
    );
    expect(stats.perNode.find((n) => n.nodeId === "EL4")?.words).toBe(
      countWords(
        provider.files.get(filePath("section--the_storm.EL4.01.md")) ?? "",
      ),
    );
  });

  it("adoptSnapshot swaps the pointer and lands the editor in the newly adopted file", async () => {
    const { provider, engine } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    // The storm is the open node, so adopting a sibling snapshot lands the
    // editor in the new file (the caller settled the buffer first) and never
    // clobbers it with a stale one.
    click("openStorm");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.00.md"),
    );
    click("adoptSnapshot");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.01.md"),
    );
    expect(engine.commonmark).toContain("It came in from the south");
    // A pointer swap, not a copy: no file was touched on disk.
    expect(provider.files.get(filePath("section--the_storm.EL4.00.md"))).toBe(
      "It came in from the west, without warning.\n",
    );
    // Nothing was destroyed, so no undo is offered: adopting back is the
    // undo. The plain toast still speaks, as the writer's confirmation.
    expect(attr("last")()).toBe("adoptedSnapshot");
    expect(attr("canundo")()).toBe("0");
  });

  it("adoptSnapshot with the node closed swaps only the pointer — no undo, adopting back is the undo", async () => {
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    // Close the buffer (no open node), then adopt.
    click("closeFile");
    await waitFor(() => expect(attr("active")()).toBe(""));
    click("adoptSnapshot");
    await waitFor(() =>
      expect(findNode(structureOf(provider), "EL4")?.adopted).toBe(
        "section--the_storm.EL4.01.md",
      ),
    );
    expect(attr("active")()).toBe("");
    // The swap is reversible, so no undo is offered; adopting the original
    // snapshot back restores the pointer, with a toast as well.
    expect(attr("last")()).toBe("adoptedSnapshot");
    expect(attr("canundo")()).toBe("0");
    click("adoptBack");
    await waitFor(() =>
      expect(findNode(structureOf(provider), "EL4")?.adopted).toBe(
        "section--the_storm.EL4.00.md",
      ),
    );
    expect(attr("last")()).toBe("adoptedSnapshot");
    expect(attr("canundo")()).toBe("0");
  });

  it("renameSnapshotTitle re-titles undoably, deleteSnapshot refuses while adopted, and a node rename re-keys every snapshot's journal section", async () => {
    const { provider, engine } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));

    // Re-title one snapshot: a yaml-only rename, undoable like any rename.
    click("renameSnapshot");
    await waitFor(() => expect(attr("last")()).toBe("renamedSnapshot"));
    expect(
      stormSnapshotsOf(provider).find(
        (s) => s.file === "section--the_storm.EL4.01.md",
      )?.title,
    ).toBe("Storm 2");
    // The file itself never moves on disk: titles are display only.
    expect(provider.files.has(filePath("section--the_storm.EL4.01.md"))).toBe(
      true,
    );
    click("undo");
    await waitFor(() => expect(attr("last")()).toBe(""));
    expect(
      stormSnapshotsOf(provider).find(
        (s) => s.file === "section--the_storm.EL4.01.md",
      )?.title,
    ).toBe("The Storm 2");

    // The adopted snapshot is the node's live text, so deletion refuses
    // silently: no toast, no file removed, no entry dropped.
    click("deleteAdopted");
    expect(attr("last")()).toBe("");
    expect(stormSnapshotsOf(provider).length).toBe(2);
    expect(provider.files.has(filePath("section--the_storm.EL4.00.md"))).toBe(
      true,
    );

    // A node rename re-stems every snapshot file, and the journal, keyed by
    // snapshot file name, moves with each one.
    click("openSnapshot");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.01.md"),
    );
    engine.type("x");
    click("save");
    await waitFor(() =>
      expect(
        journalSection(provider, "section--the_storm.EL4.01.md"),
      ).not.toBeNull(),
    );
    const before = journalSection(provider, "section--the_storm.EL4.01.md");
    click("renameStorm");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_gale.EL4.01.md"),
    );
    expect(provider.files.has(filePath("section--the_gale.EL4.00.md"))).toBe(
      true,
    );
    expect(provider.files.has(filePath("section--the_storm.EL4.00.md"))).toBe(
      false,
    );
    expect(provider.files.has(filePath("section--the_storm.EL4.01.md"))).toBe(
      false,
    );
    await waitFor(() =>
      expect(journalSection(provider, "section--the_gale.EL4.01.md")).toBe(
        before,
      ),
    );
    expect(journalSection(provider, "section--the_storm.EL4.01.md")).toBeNull();
  });

  it("deleteSnapshot removes the file and entry, drops the journal section, and arms no undo toast", async () => {
    const { provider, engine } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("openSnapshot");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.01.md"),
    );
    engine.type("x");
    click("save");
    await waitFor(() => expect(engine.hasChanges).toBe(false));
    // The adopted snapshot is the live text, so deletion refuses while it is.
    click("deleteAdopted");
    await waitFor(() => expect(stormSnapshotsOf(provider).length).toBe(2));
    expect(provider.files.has(filePath("section--the_storm.EL4.00.md"))).toBe(
      true,
    );
    expect(attr("last")()).toBe("");

    // Close it, then delete the non-adopted snapshot for real.
    click("closeFile");
    await waitFor(() => expect(attr("active")()).toBe(""));
    click("deleteSnapshot");
    await waitFor(() =>
      expect(provider.files.has(filePath("section--the_storm.EL4.01.md"))).toBe(
        false,
      ),
    );
    expect(stormSnapshotsOf(provider).map((s) => s.file)).toEqual([
      "section--the_storm.EL4.00.md",
    ]);
    // Binned, not removed: a snapshot is prose the writer wrote and set
    // aside, so it gets the net a chapter gets. The file is in the one
    // recycle bin, and its record travels with it so the bin row can speak
    // the writer's own title.
    expect(provider.files.has("/recyclebin/section--the_storm.EL4.01.md")).toBe(
      true,
    );
    await waitFor(() =>
      expect(binnedSnapshotsOf(provider).map((s) => s.file)).toEqual([
        "section--the_storm.EL4.01.md",
      ]),
    );
    // No undo is offered, because the bin is the way back and both would be
    // two answers to one question, but the toast speaks.
    expect(attr("last")()).toBe("deletedSnapshot");
    expect(attr("canundo")()).toBe("0");
    // The journal dies even though the file survives: the name can be taken
    // back while the snapshot sits in the bin, and a surviving journal would
    // be inherited by that successor.
    await waitFor(() =>
      expect(
        journalSection(provider, "section--the_storm.EL4.01.md"),
      ).toBeNull(),
    );
  });

  it("puts a binned snapshot back on its node, and refuses a name taken back", async () => {
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("closeFile");
    await waitFor(() => expect(attr("active")()).toBe(""));
    click("deleteSnapshot");
    await waitFor(() => expect(binnedSnapshotsOf(provider).length).toBe(1));

    click("restoreSnapshot");
    await waitFor(() =>
      expect(provider.files.has(filePath("section--the_storm.EL4.01.md"))).toBe(
        true,
      ),
    );
    expect(stormSnapshotsOf(provider).map((s) => s.file)).toEqual([
      "section--the_storm.EL4.00.md",
      "section--the_storm.EL4.01.md",
    ]);
    // The record leaves the bin with the file: a row that stayed would offer
    // to restore something already back on its node.
    await waitFor(() => expect(binnedSnapshotsOf(provider).length).toBe(0));
  });

  /** Makes every catalogue write fail until the returned function is called. */
  function failCatalogueWrites(provider: FakeProvider) {
    const original = provider.writeFile.getMockImplementation();
    if (!original) throw new Error("writeFile must have an implementation");
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === "/snapshots-catalogue.json")
        throw new StorageError("disk full", "io");
      await original(ref, path, content);
    });
    return () => provider.writeFile.mockImplementation(original);
  }

  it("a failed catalogue write puts a binned snapshot's file back on its node", async () => {
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("closeFile");
    await waitFor(() => expect(attr("active")()).toBe(""));
    const catalogue = provider.files.get("/snapshots-catalogue.json");
    failCatalogueWrites(provider);

    click("deleteSnapshot");
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    await waitFor(() =>
      expect(provider.files.has(filePath("section--the_storm.EL4.01.md"))).toBe(
        true,
      ),
    );
    expect(provider.files.has("/recyclebin/section--the_storm.EL4.01.md")).toBe(
      false,
    );
    expect(provider.files.get("/snapshots-catalogue.json")).toBe(catalogue);
    expect(stormSnapshotsOf(provider)).toHaveLength(2);
    expect(binnedSnapshotsOf(provider)).toHaveLength(0);
  });

  it("a failed catalogue write sends a restored snapshot's file back to the bin", async () => {
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("closeFile");
    await waitFor(() => expect(attr("active")()).toBe(""));
    click("deleteSnapshot");
    await waitFor(() => expect(binnedSnapshotsOf(provider)).toHaveLength(1));
    const catalogue = provider.files.get("/snapshots-catalogue.json");
    failCatalogueWrites(provider);

    click("restoreSnapshot");
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    await waitFor(() =>
      expect(
        provider.files.has("/recyclebin/section--the_storm.EL4.01.md"),
      ).toBe(true),
    );
    expect(provider.files.has(filePath("section--the_storm.EL4.01.md"))).toBe(
      false,
    );
    expect(provider.files.get("/snapshots-catalogue.json")).toBe(catalogue);
    expect(stormSnapshotsOf(provider)).toHaveLength(1);
    expect(binnedSnapshotsOf(provider)).toHaveLength(1);
  });

  it("refuses to restore a snapshot whose file name a successor has taken", async () => {
    // A restore never overwrites a snapshot the writer made after the
    // deletion. The name can be taken back while the old one sits in the bin,
    // because `addSnapshot` numbers from the structure and the binned one has
    // left it.
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("closeFile");
    await waitFor(() => expect(attr("active")()).toBe(""));
    click("deleteSnapshot");
    await waitFor(() => expect(binnedSnapshotsOf(provider).length).toBe(1));

    // A successor takes the name back.
    provider.files.set(
      filePath("section--the_storm.EL4.01.md"),
      "Newer words.\n",
    );
    click("restoreSnapshot");
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    expect(provider.files.get(filePath("section--the_storm.EL4.01.md"))).toBe(
      "Newer words.\n",
    );
    // Still binned, so nothing is lost either way.
    expect(binnedSnapshotsOf(provider).length).toBe(1);
  });

  it.each([
    ["fails to read", new StorageError("Disk fault", "io")],
    ["is gone", new StorageError("File not found", "not-found")],
  ])(
    "makes no snapshot when the source %s, and leaves the records and the disk as they were",
    async (_case, failure) => {
      const { provider } = await make({
        structure: STRUCTURE_WITH_SNAPSHOTS,
        files: FILES_WITH_SNAPSHOTS,
      });
      await waitFor(() => expect(attr("status")()).toBe("ready"));
      const adopted = filePath("section--the_storm.EL4.00.md");
      const original = provider.readFile.getMockImplementation();
      if (!original) throw new Error("readFile must have an implementation");
      provider.readFile.mockImplementation(async (ref, path) => {
        if (path === adopted) throw failure;
        return original(ref, path);
      });
      const catalogue = provider.files.get("/snapshots-catalogue.json");
      const structure = provider.files.get("/document-structure.yaml");
      const writes = provider.writeFile.mock.calls.length;

      click("addSnapshot");
      await waitFor(() =>
        expect(attr("error")()).toBe("name.snapshotSourceUnreadable"),
      );
      expect(provider.files.has(filePath("section--the_storm.EL4.02.md"))).toBe(
        false,
      );
      expect(provider.files.get("/snapshots-catalogue.json")).toBe(catalogue);
      expect(provider.files.get("/document-structure.yaml")).toBe(structure);
      expect(provider.writeFile.mock.calls.length).toBe(writes);
      expect(stormSnapshotsOf(provider).length).toBe(2);
    },
  );

  it("stops when the free-name check fails for a reason other than not-found", async () => {
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    const next = filePath("section--the_storm.EL4.02.md");
    const original = provider.readFile.getMockImplementation();
    if (!original) throw new Error("readFile must have an implementation");
    provider.readFile.mockImplementation(async (ref, path) => {
      if (path === next)
        throw new StorageError("Permission lost", "permission");
      return original(ref, path);
    });

    click("addSnapshot");
    await waitFor(() =>
      expect(attr("error")()).toBe("name.snapshotSourceUnreadable"),
    );
    expect(provider.files.has(next)).toBe(false);
    expect(stormSnapshotsOf(provider).length).toBe(2);
  });

  it("a failed properties write rolls a snapshot add back — no orphaned file, no phantom row", async () => {
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    // Sabotage the properties write: the snapshot's metadata cannot land.
    const original = provider.writeFile.getMockImplementation();
    if (!original) throw new Error("writeFile must have an implementation");
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === PROPERTIES_FILE) throw new StorageError("disk full", "io");
      await original(ref, path, content);
    });
    click("addSnapshot");
    // The copy lands first, then the properties write fails. The commit's
    // rollback removes the copied file, puts the structure back, and arms no
    // undo, since nothing committed. A half-committed document, with a file
    // the snapshots block does not name, never opens.
    await waitFor(() =>
      expect(provider.files.has(filePath("section--the_storm.EL4.02.md"))).toBe(
        false,
      ),
    );
    expect(stormSnapshotsOf(provider).length).toBe(2);
    expect(attr("last")()).toBe("");
    // No file was made, so none is named back to the caller.
    await waitFor(() => expect(added).toBeNull());
  });
});

// The save's `updatedAt` lives in `stats.perNode`, beside the per-node count,
// so the save-first gate's adopt has no stamp to carry: the save writes
// `document-properties.json` (stats and snapshots) and the adopt writes the
// yaml, and neither can erase the other. The per-node edit time survives a
// same-tick save-then-adopt, and neither touches the properties snapshots
// block.
describe("the save-first gate's adopt and the unified edit-time stamp", () => {
  it("keeps the perNode edit-time stamp and the snapshots block through a save-then-adopt", async () => {
    // The Storm node is adopted on its .01 file, where the writer is working;
    // the save-first gate's adopt then switches to .00 in the same tick. The
    // save's `perNode` stamp, the table's edit time, survives, and the
    // snapshots block keeps the adopted-away file.
    const props = PROPS.replace('"lastOpened": "EL3"', '"lastOpened": "EL4"');
    const structure = STRUCTURE_WITH_SNAPSHOTS.replace(
      "adopted: section--the_storm.EL4.00.md",
      "adopted: section--the_storm.EL4.01.md",
    );
    const provider = new FakeProvider();
    seedRecords(provider, props, structure);
    provider.files.set(STRUCTURE_FILE, structure);
    for (const [path, content] of Object.entries(FILES_WITH_SNAPSHOTS))
      provider.files.set(path, content);
    const engine = new EditorEngine();
    const GateProbe = () => {
      const actions = useProjectActions();
      const state = useProjectState();
      return (
        <>
          <div
            data-testid="probe"
            data-status={state.status}
            data-active={state.activeFile ?? ""}
          />
          <button
            data-testid="gate-open"
            onClick={() =>
              void actions.openFile("section--the_storm.EL4.01.md")
            }
          >
            open
          </button>
          <button
            data-testid="gate-adopt"
            onClick={() => {
              void (async () => {
                await actions.saveActiveFile();
                await actions.adoptSnapshot(
                  "EL4",
                  "section--the_storm.EL4.00.md",
                );
              })();
            }}
          >
            gate
          </button>
        </>
      );
    };
    const view = render(
      <ProjectProvider
        engine={engine}
        provider={provider}
        projectKey="demo-key"
      >
        <GateProbe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    // The writer resumes The Storm's adopted .01 from the Desk; a fresh open
    // restores nothing by itself.
    fireEvent.click(screen.getByTestId("gate-open"));
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.01.md"),
    );
    act(() => engine.type("x"));
    fireEvent.click(screen.getByTestId("gate-adopt"));
    // The adopt lands: .00 becomes adopted, .01 adopted-away.
    await waitFor(() => {
      const node = findNode(structureOf(provider), "EL4");
      expect(node?.adopted).toBe("section--the_storm.EL4.00.md");
    });
    // The save stamped the node's edit time in the properties' `perNode`, and
    // it survives the adopt, which writes the yaml only.
    await waitFor(() => {
      const propsFile = propsOf(provider);
      const storm = (
        propsFile.stats as { perNode: { nodeId: string; updatedAt: string }[] }
      ).perNode.find((n) => n.nodeId === "EL4");
      expect(storm?.updatedAt).toBeTruthy();
      // The snapshots block is intact: neither the save nor the adopt loses
      // the adopted-away .01.
      const stormSnaps = (
        hashedRecordsOf(provider) as Record<string, { file: string }[]>
      ).EL4;
      expect(stormSnaps?.map((s) => s.file)).toEqual([
        "section--the_storm.EL4.00.md",
        "section--the_storm.EL4.01.md",
      ]);
    });
    void view;
  });
});

// The properties lane is shared across projects, and its base is read at
// dequeue time, which prevents a lost update within a project. A job queued
// for one project that dequeues after another project's open has swapped the
// base would merge onto the wrong document and write the wrong file; the
// owner mirror makes it bail instead.
describe("the properties lane stays inside its own project", () => {
  it("never merges a queued properties write into another project's file", async () => {
    const { provider, engine, view } = await make({
      open: "section--opening.EL3.00.md",
    });
    await waitFor(() =>
      expect(attr("active")()).toBe("section--opening.EL3.00.md"),
    );

    // Every properties write is gated: the save's `recordCount` job stays
    // queued in the lane while project B opens and claims the base.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = provider.writeFile.getMockImplementation();
    if (!original) throw new Error("writeFile must have an implementation");
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === PROPERTIES_FILE) await gate;
      await original(ref, path, content);
    });

    // A save in project A enqueues a stats write for A's node (EL3).
    click("save");
    await waitFor(() =>
      expect(
        provider.writeFile.mock.calls.some(
          (call) => call[1] === PROPERTIES_FILE,
        ),
      ).toBe(true),
    );

    // Project B takes the provider's place: a different folder with its own
    // document, node ids and files, and the queued A job does not ride along.
    // The wait is on the named ref, not on "ready": the status is already
    // "ready" from A's open, so a status wait would race ahead of B's load.
    provider.files.clear();
    seedProps(provider, B_PROPS);
    provider.files.set(STRUCTURE_FILE, B_STRUCTURE);
    for (const [path, content] of Object.entries(B_FILES))
      provider.files.set(path, content);
    view.rerender(
      <ProjectProvider
        engine={engine}
        provider={provider}
        projectKey="other-key"
      >
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(attr("ref")()).toBe("The Other House"));

    // The lane drains A's queued job first, then B's own backfill. A's count
    // for EL3 never lands in B's properties file, and the file keeps B's own
    // document. A job merged onto B's base would become the base B's backfill
    // writes, leaving A's document title in B's file.
    release();
    await waitFor(() => {
      const finalProps = propsOf(provider);
      const perNode = (finalProps.stats as { perNode: { nodeId: string }[] })
        .perNode;
      expect((finalProps.document as { title: string }).title).toBe(
        "The Other House",
      );
      expect(perNode.some((n) => n.nodeId === "EL3")).toBe(false);
      expect(perNode.some((n) => n.nodeId === "EL9")).toBe(true);
    });
    void view;
  });
});

/** Project B's fixture, a different document entirely. */
const B_PROPS = `{
  "schemaVersion": 1,
  "document": {
    "id": "doc-b",
    "title": "The Other House",
    "type": "Novel",
    "structure": "threeact",
    "language": "en",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "sync": null,
  "ui": { "expanded": [], "lastOpened": "" },
  "stats": { "words": 0, "parts": 0, "sections": 0, "countedAt": "2026-01-01T00:00:00.000Z", "perNode": [] },
  "snapshots": {
    "EL9": [{ "file": "part--solo.EL9.00.md", "title": "Solo 1", "created": "2026-01-01T00:00:00.000Z" }]
  }
}
`;

const B_STRUCTURE = `# Phospheare — document structure
version: 1
document:
  - id: EL9
    part: Solo
    adopted: part--solo.EL9.00.md
    children: []
`;

const B_FILES: Record<string, string> = {
  [filePath("part--solo.EL9.00.md")]: "# Solo\n",
};

/**
 * Serves project B under its own key, from its own files, beside the fixture's
 * project A on the same provider, so two projects can be in flight at once.
 */
function serveProjectB(provider: FakeProvider, key = "other-key") {
  const files = new Map(Object.entries({ ...B_FILES }));
  const b = splitRecords(B_PROPS);
  files.set(PROPERTIES_FILE, b.properties);
  if (b.catalogue !== null) files.set(SNAPSHOTS_CATALOGUE_FILE, b.catalogue);
  files.set(STRUCTURE_FILE, B_STRUCTURE);
  const read = provider.readFile.getMockImplementation();
  const list = provider.listDir.getMockImplementation();
  const write = provider.writeFile.getMockImplementation();
  if (!read || !list || !write) throw new Error("the fake must implement io");
  provider.readFile.mockImplementation(async (ref, path) => {
    if (ref.key !== key) return read(ref, path);
    const content = files.get(path);
    if (content === undefined)
      throw new StorageError(`File not found: ${path}`, "not-found");
    return content;
  });
  provider.listDir.mockImplementation(async (ref, path) => {
    if (ref.key !== key) return list(ref, path);
    return [...files.keys()]
      .filter((p) => p.startsWith(`${path}/`))
      .map((p) => ({ path: p, name: p.slice(path.length + 1), kind: "file" }));
  });
  provider.writeFile.mockImplementation(async (ref, path, content) => {
    if (ref.key !== key) return write(ref, path, content);
    files.set(path, content);
  });
  return files;
}

/** A promise held until `release` is called. */
function held() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

/**
 * Waits until every call made to the provider has settled and no new call
 * started meanwhile, so the work queued behind them has all run.
 */
async function settle(provider: FakeProvider) {
  const calls = () =>
    Object.values(provider).flatMap((member: unknown) =>
      vi.isMockFunction(member)
        ? member.mock.results.map((result) => result.value as unknown)
        : [],
    );
  for (let seen = -1; seen !== calls().length;) {
    const pending = calls();
    seen = pending.length;
    await act(async () => {
      await Promise.allSettled(pending);
    });
  }
}

describe("one provider, more than one project", () => {
  it("keeps every action the same object across a save", async () => {
    const { provider, engine, view } = await make();
    const seen = new Set<unknown>();
    function Spy() {
      seen.add(useProjectActions());
      return null;
    }
    view.rerender(
      <ProjectProvider
        engine={engine}
        provider={provider}
        projectKey="demo-key"
      >
        <Probe />
        <Spy />
      </ProjectProvider>,
    );
    // A save writes the properties (the count and the hash), which changes
    // the project's state; the actions must not change with it.
    click("save");
    await waitFor(() => {
      const perNode = (propsOf(provider).stats as { perNode: unknown[] })
        .perNode;
      expect(perNode.length).toBeGreaterThan(0);
    });
    await settle(provider);
    expect(seen.size).toBe(1);
  });

  it("never lets an open that was overtaken write over the newer one", async () => {
    const first = held();
    const { provider, engine, view } = await make({
      open: null,
      // Project A's reads wait, so its open is still reading when B's starts.
      before: (p) => {
        const read = p.readFile.getMockImplementation();
        if (!read) throw new Error("the fake must implement readFile");
        p.readFile.mockImplementation(async (ref, path) => {
          if (ref.key === "demo-key") await first.gate;
          return read(ref, path);
        });
      },
    });
    serveProjectB(provider);
    view.rerender(
      <ProjectProvider
        engine={engine}
        provider={provider}
        projectKey="other-key"
      >
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(attr("ref")()).toBe("The Other House"));

    // A's open finishes last. It must leave B on screen.
    first.release();
    await settle(provider);
    expect(attr("ref")()).toBe("The Other House");
    expect(attr("nodes")()).toBe("EL9");
    expect(attr("status")()).toBe("ready");
  });

  it("writes a change queued for one project to its own folder, and never shows it in the next", async () => {
    const { provider, engine, view } = await make();
    // The move's yaml write waits, so it is still in the lane after B opens.
    const yaml = held();
    const write = provider.writeFile.getMockImplementation();
    if (!write) throw new Error("the fake must implement writeFile");
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (ref.key === "demo-key" && path === STRUCTURE_FILE) await yaml.gate;
      return write(ref, path, content);
    });
    click("move");
    await waitFor(() =>
      expect(
        provider.writeFile.mock.calls.some(
          (call) => call[1] === STRUCTURE_FILE,
        ),
      ).toBe(true),
    );

    const bFiles = serveProjectB(provider);
    view.rerender(
      <ProjectProvider
        engine={engine}
        provider={provider}
        projectKey="other-key"
      >
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(attr("ref")()).toBe("The Other House"));

    yaml.release();
    await settle(provider);
    // B still shows its own tree, and its yaml is its own.
    expect(attr("nodes")()).toBe("EL9");
    expect(bFiles.get(STRUCTURE_FILE)).toBe(B_STRUCTURE);
    // A's folder got A's move: EL3 now sits in EL2.
    const a = structureOf(provider);
    expect(childrenOf(a, "EL2").map((n) => n.id)).toEqual(["EL3"]);
  });

  it("drops a properties write still queued when the folder is refused", async () => {
    const { provider } = await make();
    // The first properties write waits inside the write; the second queues
    // behind it in the lane.
    const first = held();
    let gated = false;
    const write = provider.writeFile.getMockImplementation();
    if (!write) throw new Error("the fake must implement writeFile");
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === PROPERTIES_FILE && !gated) {
        gated = true;
        await first.gate;
      }
      return write(ref, path, content);
    });
    click("saveUi");
    await waitFor(() => expect(gated).toBe(true));
    click("setDockWidth");

    // The folder loses its yaml (caught mid-sync) and a reload refuses it.
    provider.files.delete(STRUCTURE_FILE);
    click("reload");
    await waitFor(() => expect(attr("status")()).toBe("invalid"));

    first.release();
    await settle(provider);
    const ui = propsOf(provider).ui as { dockWidth?: number | null };
    expect(ui.dockWidth).not.toBe(480);
  });
});

// ── Out-of-band edit detection ───────────────────────────────────────────────
//
// The per-snapshot `contentHash` is app-level and canonicalized (CRLF to LF,
// BOM removed). Verification is non-blocking and warn-only, on open and
// reload; a missing hash is "not yet computed" and backfilled, not a
// mismatch. `outOfBand` is the flag other features derive from, as the
// `Snapshot` type in `project/types.ts` documents.
describe("contentHash out-of-band detection", () => {
  it("backfills missing hashes behind the open", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    await waitFor(() => {
      const snaps = (
        hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
      )["EL3"];
      expect(snaps?.[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });
    expect(attr("outofband")()).toBe("");
  });

  it("marks a node as out-of-band when its file was changed outside the app and clears on save", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    // The backfill seeds hashes first, so the next verify has something to
    // compare.
    await waitFor(() => {
      const snaps = (
        hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
      )["EL3"];
      expect(snaps?.[0]?.contentHash).toBeDefined();
    });
    expect(attr("outofband")()).toBe("");

    // An external edit changes the adopted file's bytes, not the stored hash.
    provider.files.set(
      filePath("section--opening.EL3.00.md"),
      "tampered outside\n",
    );
    click("reload");
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    await waitFor(() => expect(attr("outofband")()).toBe("EL3"));

    // Saving from inside the app re-hashes and clears the flag. After the
    // reload the buffer holds the tampered disk content; typing makes it
    // dirty, and the save writes it and updates the hash.
    act(() => engine.type("!"));
    click("save");
    await waitFor(() => expect(attr("outofband")()).toBe(""));
    // The stored hash now matches the new file.
    const snaps = (
      hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
    )["EL3"];
    expect(snaps?.[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not flag a CRLF ? LF only change as out-of-band", async () => {
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    await waitFor(() => {
      const snaps = (
        hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
      )["EL3"];
      expect(snaps?.[0]?.contentHash).toBeDefined();
    });
    // An external edit that changes only line endings is invisible after
    // canonicalization.
    const original =
      provider.files.get(filePath("section--opening.EL3.00.md")) ?? "";
    provider.files.set(
      filePath("section--opening.EL3.00.md"),
      original.replace(/\n/g, "\r\n"),
    );
    click("reload");
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    // Still clean, because `hashOf` canonicalizes.
    await waitFor(() => expect(attr("outofband")()).toBe(""));
  });
});

// ── Write lanes and open ordering ────────────────────────────────────────────

describe("audit findings", () => {
  it("— a save's journal flush and a concurrent snapshot delete's journal write never clobber each other", async () => {
    // The journal files have one FIFO lane (`enqueueJournalWrite`), as the
    // properties and structure files do. `flushJournal` and
    // `deleteJournalSection` each read a journal before they write or remove
    // one, and the lane runs each job only after the one before it settles.
    //
    // Every read under `HISTORY_DIR` is gated behind one manually-released
    // promise, opened once; a gated read after it opens falls straight
    // through, so the gate holds back only the first wave. Without a lane,
    // both reads queue on the gate and resume together, which forces the
    // race deterministically. With the lane, `deleteJournalSection`'s job is
    // not invoked until `flushJournal`'s promise, gated read included, has
    // settled, so one read alone waits on the gate before release.
    const { provider, engine } = await make(); // EL3 (opening) is active
    await waitFor(() => expect(attr("status")()).toBe("ready"));

    // EL4 gets a second, non-adopted snapshot so it can be deleted; the
    // adopted one always refuses deletion.
    click("addSnapshot");
    await waitFor(() =>
      provider.writeFile.mock.calls.some(
        (c) => c[1] === filePath("section--the_storm.EL4.01.md"),
      ),
    );

    // A journal for that new snapshot, apart from EL3, the file this test's
    // save touches.
    provider.files.set(
      historyPath("section--the_storm.EL4.01.md"),
      "storm-journal",
    );

    let attemptedReads = 0;
    let openGate: (() => void) | null = null;
    let opened = false;
    const gate = new Promise<void>((resolve) => {
      openGate = () => {
        opened = true;
        resolve();
      };
    });
    const originalRead = provider.readFile.getMockImplementation();
    if (!originalRead) throw new Error("readFile must have an implementation");
    provider.readFile.mockImplementation(async (ref, path) => {
      if (path.startsWith(`${HISTORY_DIR}/`)) {
        attemptedReads++;
        if (!opened) await gate;
      }
      return originalRead(ref, path);
    });

    engine.type("x");
    click("save"); // EL3's flush reaches its gated read and waits.
    await waitFor(() => expect(attemptedReads).toBe(1));

    click("deleteSnapshot");
    // With the lane, delete's job cannot attempt its read yet, queued behind
    // the save's in-flight job. Without a lane, delete's read would reach the
    // gate too, making `attemptedReads` 2 before anything is released.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attemptedReads).toBe(1);

    (openGate as (() => void) | null)?.();
    await waitFor(() => expect(engine.hasChanges).toBe(false));

    // Both changes survive: EL3's fresh flush and EL4's deletion.
    await waitFor(() => {
      expect(
        journalSection(provider, "section--opening.EL3.00.md"),
      ).not.toBeNull();
      expect(
        journalSection(provider, "section--the_storm.EL4.01.md"),
      ).toBeNull();
    });
  });

  it("— the open-time hash backfill never overwrites a hash a real save landed in the meantime", async () => {
    // `backfillContentHashes` reads every hash-less snapshot file in turn,
    // hashes what it read, and only then enqueues one properties write. A
    // real save can land on the same file in between with a newer hash, so
    // the backfill fills only a missing hash and never overwrites an existing
    // one, whatever its value.
    //
    // EL3 ("opening") has neither a `contentHash` nor a word count in the
    // default fixture, so both open-time backfills read it: the counts and
    // the hashes. Each read is held so a real save can land and complete,
    // with a fresh hash, while the hash backfill still holds the original
    // content it read before the save.
    //
    // The two backfills start the moment the project is ready and race the
    // open for this file, so no read is picked out by its position. Every
    // read of EL3 is held until the test opens the file itself, and the
    // open's read, made after that, passes.
    const file = "section--opening.EL3.00.md";
    const el3 = filePath(file);
    const original = DEFAULT_FILES[el3];
    const held: (() => void)[] = [];
    let holding = true;
    const { provider, engine } = await make({
      open: null,
      before: (p) => {
        const originalRead = p.readFile.getMockImplementation();
        if (!originalRead) {
          throw new Error("readFile must have an implementation");
        }
        p.readFile.mockImplementation(async (ref, path) => {
          if (path !== el3 || !holding) return originalRead(ref, path);
          // The content is captured synchronously, before blocking: a real
          // read takes its bytes at read time, not when its delivery resumes.
          // `originalRead` re-reads `p.files` live, so calling it after the
          // release would pick up the save's new content and defeat the race
          // this test forces.
          const captured = p.files.get(path);
          await new Promise<void>((resolve) => held.push(resolve));
          if (captured === undefined) {
            throw new StorageError(`File not found: ${path}`, "not-found");
          }
          return captured;
        });
      },
    });

    // Both backfills hold their read of EL3 before the writer opens it.
    await waitFor(() => expect(held).toHaveLength(2));
    holding = false;
    click("openFile");
    await waitFor(() => expect(attr("active")()).toBe(file));

    // A real save lands while the backfills' reads of the same file are still
    // pending, with newer content and its own fresh hash.
    engine.type(" It rained.");
    click("save");
    const freshContent = engine.commonmark;
    await waitFor(() => {
      const snaps = (
        hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
      )["EL3"];
      expect(snaps?.[0]?.contentHash).toBeDefined();
    });
    const freshHash = (
      hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
    )["EL3"]?.[0]?.contentHash;

    // The backfills' stale reads resolve; they still hold `original`, the
    // pre-save content, and the hash backfill tries to persist its stale hash.
    for (const release of held) release();
    const staleHash = await hashOf(original);
    expect(freshHash).not.toBe(staleHash);

    // The backfill's tail (its remaining `hashOf` calls and its enqueued
    // properties job) settles. `engine.hasChanges` reflects only the save's
    // completion, not the backfill's separate async chain, so no `waitFor` on
    // a save condition fits; a fixed real-macrotask drain lets a no-op job
    // and an overwrite alike finish before the assertion reads the state.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const snaps = (
      hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
    )["EL3"];
    expect(snaps?.[0]?.contentHash).toBe(freshHash);
    expect(snaps?.[0]?.contentHash).not.toBe(staleHash);
    // The survivor describes what the writer's save put on disk, not a check
    // that refuses to write anything at all.
    expect(freshHash).toBe(await hashOf(freshContent));
  });

  it("— the buffer restore does not wait behind the snapshot-hash verify", async () => {
    // The file restore runs first and `verifySnapshotHashes` is
    // fire-and-forget. Status is already "ready", and `EditorBoot` drops the
    // skeleton the instant it is, so a verify awaited first would mount the
    // workspace over an empty engine for as long as the read and digest of
    // every hashed snapshot take. The row gates verify's own read, never the
    // restore's, and checks the buffer is back before the gate is released.
    const { provider, engine } = await make();
    // EL3 gets a real hash first, through the backfill's own job: verify
    // skips an unhashed snapshot without reading it, which would prove
    // nothing about ordering.
    await waitFor(() => {
      const snaps = (
        hashedRecordsOf(provider) as Record<string, { contentHash?: string }[]>
      )["EL3"];
      expect(snaps?.[0]?.contentHash).toBeDefined();
    });

    // The buffer is cleared as `reload` does, then the second read of the
    // adopted file is gated. The first is the restore's own read
    // (`hydrateOpen`), which completes unblocked; the second is verify's,
    // which runs after, over the just-hashed snapshot.
    let reads = 0;
    let releaseVerify: (() => void) | null = null;
    const originalRead = provider.readFile.getMockImplementation();
    if (!originalRead) throw new Error("readFile must have an implementation");
    provider.readFile.mockImplementation(async (ref, path) => {
      if (path === filePath("section--opening.EL3.00.md")) {
        reads++;
        if (reads === 2) {
          await new Promise<void>((resolve) => {
            releaseVerify = resolve;
          });
        }
      }
      return originalRead(ref, path);
    });

    act(() => engine.open(""));
    expect(engine.commonmark).toBe("");
    click("reload");

    // The restored buffer is observable without releasing verify's gate, so
    // the restore does not wait on it; otherwise this would time out, since
    // verify's read never resolves on its own in this test.
    await waitFor(() => expect(engine.commonmark).not.toBe(""));

    (releaseVerify as (() => void) | null)?.();
  });
});

// ── Saving and leaving ───────────────────────────────────────────────────────
//
// Every way out of the open Section either writes its buffer or is the
// writer's own "Don't save". A removal, a rename that fails halfway, a
// reconnect followed by a re-render, and a save racing a close each keep the
// writer's text and the project openable.

describe("saving and leaving", () => {
  it("removing the open Section saves its unsaved text before the file goes to the bin", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("Kept "));
    const typed = engine.save();
    click("removeLeaf");
    await waitFor(() => expect(attr("last")()).toBe("removed"));
    expect(provider.files.get("/recyclebin/section--opening.EL3.00.md")).toBe(
      typed,
    );
    expect(attr("active")()).toBe("");
  });

  it("a removal whose save fails leaves the Section, its file and its buffer in place", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("Kept "));
    const original = provider.writeFile.getMockImplementation();
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === filePath("section--opening.EL3.00.md"))
        throw new StorageError("Disk full", "io");
      return original?.(ref, path, content);
    });
    click("removeLeaf");
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    expect(attr("last")()).toBe("");
    expect(attr("active")()).toBe("section--opening.EL3.00.md");
    expect(engine.hasChanges).toBe(true);
    expect(provider.files.has(filePath("section--opening.EL3.00.md"))).toBe(
      true,
    );
    expect(provider.files.has("/recyclebin/section--opening.EL3.00.md")).toBe(
      false,
    );
  });

  it("a reconnected project is not opened again by a later render", async () => {
    // The open effect runs again whenever its provider changes identity, as
    // the Remote Storage mirror does when its connection flips, or when
    // `loadProject` does on a language change. A reconnect that left the key
    // unrecorded let that run reopen the project, which lands on the Desk
    // over the writer's buffer.
    const { provider, engine, view } = await make({
      before: (p) => (p.grant = false),
    });
    await waitFor(() => expect(attr("pending")()).toBe("demo-key"));
    provider.grant = true;
    const opens = () =>
      provider.readFile.mock.calls.filter((c) => c[1] === PROPERTIES_FILE)
        .length;
    const before = opens();
    click("reconnect");
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("openFile");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--opening.EL3.00.md"),
    );
    act(() => engine.type("Kept "));
    const typed = engine.save();
    click("saveUi");
    await waitFor(() => expect(attr("expanded")()).toBe("EL1"));
    // The same provider under a new identity: the same id and the same
    // methods, so the effect runs again for the same project.
    const rebuilt = new Proxy(provider, {});
    view.rerender(
      <ProjectProvider engine={engine} provider={rebuilt} projectKey="demo-key">
        <Probe />
      </ProjectProvider>,
    );
    // A reopen would read the folder again, so every read must be done.
    await settle(provider);
    expect(opens() - before).toBe(1);
    expect(attr("active")()).toBe("section--opening.EL3.00.md");
    expect(engine.save()).toBe(typed);
  });

  it("a save racing a close writes nothing over the file the buffer left", async () => {
    // The autosave debounce can fire after `closeFile` emptied the engine and
    // before the render that clears the open file. The save writes the file
    // the buffer was opened from, so an emptied buffer writes nowhere.
    const { provider } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    const before = provider.files.get(filePath("section--opening.EL3.00.md"));
    click("closeThenSave");
    await waitFor(() => expect(attr("active")()).toBe(""));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.files.get(filePath("section--opening.EL3.00.md"))).toBe(
      before,
    );
  });

  it("a rename waits for a save of the open file still in flight", async () => {
    // The save's write lands after the move would have taken the old name,
    // and would leave a stray file the structure does not name.
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    click("openStorm");
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.00.md"),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = provider.writeFile.getMockImplementation();
    if (!original) throw new Error("writeFile must have an implementation");
    const stormPath = filePath("section--the_storm.EL4.00.md");
    provider.writeFile.mockImplementation(async (ref, path, content) => {
      if (path === stormPath) await gate;
      await original(ref, path, content);
    });
    act(() => engine.type("x"));
    const typed = engine.save();
    click("save");
    await waitFor(() =>
      expect(
        provider.writeFile.mock.calls.some((c) => c[1] === stormPath),
      ).toBe(true),
    );
    click("renameStorm");
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_gale.EL4.00.md"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.files.has(stormPath)).toBe(false);
    expect(provider.files.get(filePath("section--the_gale.EL4.00.md"))).toBe(
      typed,
    );
  });

  it("a rename that fails halfway puts back every file it moved", async () => {
    const { provider } = await make({
      structure: STRUCTURE_WITH_SNAPSHOTS,
      files: FILES_WITH_SNAPSHOTS,
      open: null,
    });
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    const original = provider.renameFile.getMockImplementation();
    provider.renameFile.mockImplementation(async (ref, path, newName) => {
      if (path === filePath("section--the_storm.EL4.01.md"))
        throw new StorageError("busy", "io");
      return original?.(ref, path, newName);
    });
    click("renameStorm");
    await waitFor(() => expect(attr("error")()).toBe("storage.io"));
    // The `.00` moved and the `.01` did not; the rollback moves back only the
    // `.00`, so the folder matches the structure that still names both.
    await waitFor(() =>
      expect(provider.files.has(filePath("section--the_storm.EL4.00.md"))).toBe(
        true,
      ),
    );
    expect(provider.files.has(filePath("section--the_storm.EL4.01.md"))).toBe(
      true,
    );
    expect(provider.files.has(filePath("section--the_gale.EL4.00.md"))).toBe(
      false,
    );
    expect(attr("last")()).toBe("");
  });

  it("Don't save leaves the discarded edits out of the Section's journal", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("x"));
    click("openStorm");
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "leave.skip" }));
    await waitFor(() =>
      expect(attr("active")()).toBe("section--the_storm.EL4.00.md"),
    );
    // A journal of steps the file never got is dropped as stale at the next
    // open, and the Section's saved history goes with it.
    expect(journalSection(provider, "section--opening.EL3.00.md")).toBeNull();
  });

  it("offers the open buffer to the account layer, which writes it before clearing the account", async () => {
    const { provider, engine } = await make();
    await waitFor(() => expect(attr("status")()).toBe("ready"));
    act(() => engine.type("Kept "));
    const typed = engine.save();
    await act(() => writeOpenWork());
    expect(provider.files.get(filePath("section--opening.EL3.00.md"))).toBe(
      typed,
    );
    expect(engine.hasChanges).toBe(false);
  });
});
