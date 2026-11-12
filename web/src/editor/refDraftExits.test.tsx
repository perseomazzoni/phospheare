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
import { createMemoryRouter, RouterProvider } from "react-router";

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

// Pins what the page's exits do with a reference draft: the tab hiding, the
// tab closing, and the leaving dialog's Save. A document not yet on disk is
// created only through the create-only seam, so no exit writes over a file
// another tab made meanwhile.
//
// A file of its own because it dispatches `pagehide` and `beforeunload` on
// `window`, which reach every listener alive in the environment.
// The dock is a stub that hands the shell's callbacks to the
// test, so a draft is started and typed without the reader's own UI.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));
vi.mock("./tree/DocumentTree", () => ({ default: () => null }));

interface DockCallbacks {
  onStartEdit: (fileName: string, text: string) => void;
  onWriteSection: (fileName: string, text: string, unborn: boolean) => void;
  onDraft: (draft: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => Promise<boolean>;
}
const dock = vi.hoisted(() => ({ current: null as DockCallbacks | null }));
vi.mock("./components/Dock", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: (props: DockCallbacks) => {
    dock.current = props;
    return null;
  },
}));

import { Workspace } from "./EditorRoute";
import { holdOpenWork, writeOpenWork } from "../auth/openWork";
import { connectionFor } from "../storage/connections";
import { EditorServicesProvider, inertServices } from "./services/context";
import type { EditorServices } from "./services/port";
import type { ReactNode } from "react";
import { EditorEngine } from "./views/engine";
import type { ResolvedPrefs } from "./writingPreferences";

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

vi.setConfig({ testTimeout: 60000 });

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

const WRITTEN = "# Maren\n\nShe keeps the lighthouse and trusts nobody.\n";
const PATH = "/reference/character--maren.md";

function make({ onDisk }: { onDisk: boolean }) {
  const writeFile = vi.fn(async () => undefined);
  const provider = {
    listDir: async () => [],
    readFile: async () => "",
    exists: vi.fn(async () => onDisk),
    writeFile,
  };
  return mount(provider, writeFile);
}

/**
 * A folder that remembers what is written to it. A write puts its file in
 * place when it starts, as a backend creates the file before the bytes land;
 * `hold` keeps every write pending until `release`.
 */
function makeDisk(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  let gate: Promise<void> | null = null;
  let open = () => {};
  const writeFile = vi.fn(async (_ref: unknown, path: string, text: string) => {
    files.set(path, text);
    if (gate) await gate;
  });
  const removeFile = vi.fn(async (_ref: unknown, path: string) => {
    files.delete(path);
  });
  const provider = {
    listDir: async () => [],
    readFile: async (_ref: unknown, path: string) => files.get(path) ?? "",
    exists: vi.fn(async (_ref: unknown, path: string) => files.has(path)),
    writeFile,
    removeFile,
  };
  const disk = {
    files,
    removeFile,
    hold() {
      gate = new Promise((resolve) => (open = resolve));
    },
    release() {
      gate = null;
      open();
    },
  };
  return { ...mount(provider, writeFile), disk };
}

function mount<P extends object, W>(provider: P, writeFile: W) {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const saveActiveFile = vi.fn().mockResolvedValue(true);
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            openTitle="hello"
            saveActiveFile={saveActiveFile}
            settings={settings}
            dock={
              {
                provider,
                activeNode: { id: "EL1", title: "hello" },
              } as never
            }
          />
        ),
      },
      { path: "/app", element: <div>The Library</div> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />, { wrapper: AccountServices });
  return { writeFile, provider, saveActiveFile, router };
}

/** A draft of a document on disk, edited. */
function editExisting() {
  act(() => dock.current?.onStartEdit("character--maren.md", "# Maren\n"));
  act(() => dock.current?.onDraft(WRITTEN));
}

/** A draft of a document not yet on disk, with something written in it. */
function writeUnborn() {
  act(() =>
    dock.current?.onWriteSection("character--maren.md", "# Maren\n", true),
  );
  act(() => dock.current?.onDraft(WRITTEN));
}

afterEach(() => {
  cleanup();
  dock.current = null;
  vi.clearAllMocks();
});

describe("a reference draft at the page's exits", () => {
  it("is written when the tab hides, as the open Section is", async () => {
    const { writeFile, saveActiveFile } = make({ onDisk: true });
    editExisting();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(writeFile).toHaveBeenCalledWith(projectRef, PATH, WRITTEN);
    // The buffer is clean, so the Section's save is not asked for.
    expect(saveActiveFile).not.toHaveBeenCalled();
  });

  it("a hide never writes a new document over a file another tab made", async () => {
    const { writeFile } = make({ onDisk: true });
    writeUnborn();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("closing the tab never writes a new document over a file another tab made", async () => {
    const { writeFile, provider } = make({ onDisk: true });
    writeUnborn();
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    });
    await waitFor(() => expect(provider.exists).toHaveBeenCalled());
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("closing the tab creates a new document that is not on disk", async () => {
    const { writeFile } = make({ onDisk: false });
    writeUnborn();
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    });
    await waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(projectRef, PATH, WRITTEN),
    );
  });
});

// A hide keeps the draft safe from a killed tab, but it is not the writer's
// Save: Cancel and every discard still throw the draft away.
describe("a reference draft a hide wrote", () => {
  it("Cancel puts back the text the file held", async () => {
    const { disk } = makeDisk({ [PATH]: "# Maren\n" });
    editExisting();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(disk.files.get(PATH)).toBe(WRITTEN);
    await act(async () => dock.current?.onCancelEdit());
    await waitFor(() => expect(disk.files.get(PATH)).toBe("# Maren\n"));
  });

  it("Cancel removes a new document the hide created", async () => {
    const { disk } = makeDisk({});
    writeUnborn();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(disk.files.get(PATH)).toBe(WRITTEN);
    await act(async () => dock.current?.onCancelEdit());
    await waitFor(() => expect(disk.files.has(PATH)).toBe(false));
  });

  it("leaving with Don't save puts back the text the file held", async () => {
    const { disk, router } = makeDisk({ [PATH]: "# Maren\n" });
    editExisting();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    fireEvent.click(screen.getByText("titlebar.back"));
    fireEvent.click(screen.getByRole("button", { name: "leave.skip" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    await waitFor(() => expect(disk.files.get(PATH)).toBe("# Maren\n"));
  });

  it("a Save while the hide is creating the document overwrites its own file", async () => {
    const { disk } = makeDisk({});
    writeUnborn();
    disk.hold();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    // The hide's write has made the file and has not landed yet.
    expect(disk.files.has(PATH)).toBe(true);
    let saved: Promise<boolean> | undefined;
    act(() => {
      saved = dock.current?.onSaveEdit();
    });
    disk.release();
    await act(async () => {
      await expect(saved).resolves.toBe(true);
    });
    expect(disk.files.get(PATH)).toBe(WRITTEN);
    expect(disk.removeFile).not.toHaveBeenCalled();
  });
});

describe("a reference draft at a sign-out", () => {
  it("is written when the account layer asks for open work", async () => {
    const { writeFile } = make({ onDisk: true });
    editExisting();
    await act(() => writeOpenWork());
    expect(writeFile).toHaveBeenCalledWith(projectRef, PATH, WRITTEN);
  });

  it("never writes a new document over a file another tab made", async () => {
    const { writeFile, provider } = make({ onDisk: true });
    writeUnborn();
    await act(() => writeOpenWork());
    expect(provider.exists).toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("stops the sign-out when the draft's write fails", async () => {
    const { writeFile } = make({ onDisk: true });
    writeFile.mockRejectedValueOnce(new Error("disk full"));
    editExisting();
    let kept: boolean | undefined;
    await act(async () => {
      kept = await writeOpenWork();
    });
    expect(kept).toBe(false);
  });

  it("stops the sign-out when the newest draft fails after a hide wrote an older one", async () => {
    const { writeFile, disk } = makeDisk({ [PATH]: "# Maren\n" });
    editExisting();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(disk.files.get(PATH)).toBe(WRITTEN);
    // The writer goes on typing; the sign-out's write of these words fails.
    act(() => dock.current?.onDraft(`${WRITTEN}\nAnd the sea.\n`));
    writeFile.mockRejectedValueOnce(new Error("disk full"));
    let kept: boolean | undefined;
    await act(async () => {
      kept = await writeOpenWork();
    });
    expect(disk.files.get(PATH)).toBe(WRITTEN);
    expect(kept).toBe(false);
  });

  it("stops the sign-out when a new document cannot be created", async () => {
    make({ onDisk: true });
    writeUnborn();
    let kept: boolean | undefined;
    await act(async () => {
      kept = await writeOpenWork();
    });
    expect(kept).toBe(false);
  });

  it("lets the sign-out go on when the draft lands", async () => {
    make({ onDisk: true });
    editExisting();
    let kept: boolean | undefined;
    await act(async () => {
      kept = await writeOpenWork();
    });
    expect(kept).toBe(true);
  });
});

describe("the leaving dialog's Save with a new document", () => {
  it("refuses to write over a file another tab made, and stays", async () => {
    const { writeFile, router } = make({ onDisk: true });
    writeUnborn();
    fireEvent.click(screen.getByText("titlebar.back"));
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(writeFile).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/");
  });

  it("creates it when the name is free, and leaves", async () => {
    const { writeFile, router } = make({ onDisk: false });
    writeUnborn();
    fireEvent.click(screen.getByText("titlebar.back"));
    fireEvent.click(screen.getByRole("button", { name: "leave.save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(writeFile).toHaveBeenCalledWith(projectRef, PATH, WRITTEN);
  });
});
