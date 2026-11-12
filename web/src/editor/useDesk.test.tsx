// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ProjectRef, StorageProvider } from "../storage";
import { useDesk } from "./useDesk";
import { paragraphText } from "./engine";
import type {
  DocumentProperties,
  DocumentStructure,
  NodeStat,
} from "../project/types";

afterEach(() => cleanup());

// Pins which file the Desk reads. The hook is the reading loop around
// `resumeSources`, whose order `desk.test.ts` pins: given a provider, it walks
// the sources in order and stops at the first file with a paragraph worth
// reading back.

const AT = "2026-01-01T00:00:00.000Z";

const REF: ProjectRef = {
  providerId: "local",
  key: "once-dark",
  name: "Once Dark",
  openedAt: AT,
};

const STRUCTURE: DocumentStructure = {
  version: 1,
  children: [
    {
      kind: "section",
      id: "EL2",
      title: "Opening",
      adopted: "section--a.EL2.00.md",
      snapshots: [
        { file: "section--a.EL2.00.md", title: "Opening 1", created: AT },
      ],
    },
    {
      kind: "part",
      id: "EL4",
      title: "Act Two",
      adopted: "part--b.EL4.00.md",
      snapshots: [
        { file: "part--b.EL4.00.md", title: "Act Two 1", created: AT },
      ],
      children: [],
    },
  ],
  removed: [
    {
      kind: "section",
      id: "EL6",
      title: "Gone",
      adopted: "section--gone.EL6.00.md",
      snapshots: [
        { file: "section--gone.EL6.00.md", title: "Gone 1", created: AT },
      ],
    },
  ],
};

function props(
  perNode: NodeStat[],
  lastOpened: string | null,
): DocumentProperties {
  return {
    schemaVersion: 1,
    document: {
      id: "p1",
      title: "Once Dark",
      author: "",
      type: "Novel",
      structure: null,
      language: "en",
      createdAt: AT,
      updatedAt: AT,
      goal: null,
      genres: [],
      ageCategory: null,
      tropes: [],
    },
    sync: null,
    ui: {
      expanded: [],
      lastOpened,
      session: null,
      dockWidth: null,
      structureWidth: null,
      commentsHidden: null,
      snapshotSplit: null,
      proseSize: null,
      typewriter: null,
      focus: null,
      smoothCaret: null,
      autosave: null,
      autosaveDelay: null,
      henosis: null,
      henosisAfter: null,
      henosisFade: null,
      henosisPause: null,
    },
    stats: { words: 4, parts: 0, sections: 1, countedAt: AT, perNode },
    snapshotHashes: {},
    summaries: {},
  };
}

function fakeProvider(files: Record<string, string>) {
  const readFile = vi.fn(async (_ref: ProjectRef, path: string) => {
    const name = path.split("/").pop() ?? "";
    if (!(name in files)) throw new Error(`no ${name}`);
    return files[name];
  });
  return { readFile } as unknown as StorageProvider & {
    readFile: typeof readFile;
  };
}

/** Render the hook and keep the latest value it returned. */
function mount(
  files: Record<string, string>,
  over: {
    perNode?: NodeStat[];
    lastOpened?: string | null;
  } = {},
) {
  const answer: {
    current: ReturnType<typeof useDesk>;
  } = { current: { resume: null, thread: null } };
  const provider = fakeProvider(files);
  const p = props(over.perNode ?? [], over.lastOpened ?? null);
  function Probe() {
    answer.current = useDesk(provider, REF, STRUCTURE, p, null);
    return null;
  }
  const view = render(<Probe />);
  return { answer, provider, view, p };
}

describe("useDesk", () => {
  it("reads what the writer last wrote, even when lastOpened names a removed node", async () => {
    // The properties name a removed node; the Desk does not trust it and
    // reads the last written node.
    const { answer } = mount(
      {
        "section--a.EL2.00.md": "The words I wrote.\n",
        "part--b.EL4.00.md": "",
      },
      {
        perNode: [
          { nodeId: "EL2", words: 4, updatedAt: "2026-01-02T09:00:00Z" },
        ],
        lastOpened: "EL6",
      },
    );
    await waitFor(() => {
      expect(answer.current.resume?.fileName).toBe("section--a.EL2.00.md");
    });
    const resume = answer.current.resume;
    if (!resume) throw new Error("no resume");
    expect(paragraphText(resume.para)).toBe("The words I wrote.");
  });

  it("lets a last-opened file with no words fall through to the last written one", async () => {
    const { answer } = mount(
      {
        "section--a.EL2.00.md": "Still the place I stopped.\n",
        "part--b.EL4.00.md": "",
      },
      {
        perNode: [
          { nodeId: "EL2", words: 5, updatedAt: "2026-01-02T09:00:00Z" },
        ],
        lastOpened: "EL4",
      },
    );
    await waitFor(() => {
      expect(answer.current.resume?.fileName).toBe("section--a.EL2.00.md");
    });
    const resume = answer.current.resume;
    if (!resume) throw new Error("no resume");
    expect(paragraphText(resume.para)).toBe("Still the place I stopped.");
  });

  it("offers the first openable node when nothing was written or opened", async () => {
    const { answer } = mount({
      "section--a.EL2.00.md": "A page to start on.\n",
      "part--b.EL4.00.md": "",
    });
    await waitFor(() => {
      expect(answer.current.resume?.fileName).toBe("section--a.EL2.00.md");
    });
  });

  it("says nothing when no source holds a paragraph", async () => {
    const { answer } = mount(
      {
        "section--a.EL2.00.md": "",
        "part--b.EL4.00.md": "",
      },
      {
        perNode: [
          { nodeId: "EL2", words: 0, updatedAt: "2026-01-02T09:00:00Z" },
        ],
        lastOpened: "EL4",
      },
    );
    await waitFor(() => expect(answer.current.resume).toBeNull());
  });
});
