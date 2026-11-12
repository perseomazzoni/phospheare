// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ProjectRef, StorageProvider } from "../storage";
import type { BodySource } from "../project/search";
import { useProjectBodies, type ProjectBodies } from "./useProjectBodies";

afterEach(() => cleanup());

// Pins which files the hook reads and when. A provider double stands in
// rather than a mocked module, because that is the surface a provider
// exposes; the pool, the abort and the session serve those two questions.
//
// The sources are handed in as literals rather than derived from a structure,
// because the hook does not know what it is reading. Which files a project has
// is `sourcesFor`'s question, and `search.test.ts` asks it there.

const source = (key: string): BodySource => ({
  key,
  path: `/document/${key}.md`,
});

const REF: ProjectRef = {
  providerId: "local",
  key: "once-dark",
  name: "Once Dark",
  openedAt: "2026-01-01T00:00:00.000Z",
};

function fakeProvider(files: Record<string, string>) {
  const readFile = vi.fn(async (_ref: ProjectRef, path: string) => {
    const name = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
    if (!(name in files)) throw new Error(`no ${name}`);
    return files[name];
  });
  return { readFile } as unknown as StorageProvider & {
    readFile: typeof readFile;
  };
}

/** Render the hook and keep the latest value it returned. */
function mount(
  provider: StorageProvider | null,
  sources: readonly BodySource[],
  session: number,
) {
  const answer: { current: ProjectBodies } = {
    current: { bodies: new Map(), reading: false },
  };
  // The rows below are about which words are held, so they read the map
  // directly; the three that are about the sweep itself reach for `answer`.
  const seen = {
    get current() {
      return answer.current.bodies;
    },
  };
  function Probe(props: {
    provider: StorageProvider | null;
    sources: readonly BodySource[];
    session: number;
    projectRef?: ProjectRef;
    written?: ReadonlyMap<string, number>;
    held?: boolean;
  }) {
    answer.current = useProjectBodies(
      props.projectRef ?? REF,
      props.provider,
      props.sources,
      props.session,
      props.written,
      props.held,
    );
    return null;
  }
  const view = render(
    <Probe provider={provider} sources={sources} session={session} />,
  );
  return { seen, answer, view, Probe };
}

describe("useProjectBodies", () => {
  it("reads nothing at all until the writer asks", async () => {
    // Reading every file in a book to answer a keystroke nobody has typed is
    // a cost every writer pays for the few who search, and the first fill of
    // a cold working copy is a sweep of the remote. Session 0 means no search
    // has begun.
    const provider = fakeProvider({ EL1: "the storm" });
    const sources = [source("EL1")];
    const { seen, view, Probe } = mount(provider, sources, 0);
    await Promise.resolve();
    expect(provider.readFile).not.toHaveBeenCalled();
    expect(seen.current.size).toBe(0);

    view.rerender(<Probe provider={provider} sources={sources} session={1} />);
    await waitFor(() => expect(seen.current.get("EL1")).toBe("the storm"));
  });

  it("hands over what has landed rather than waiting for the slowest file", async () => {
    // A search that showed nothing until every file was read would feel
    // broken on a cold remote, and would show an empty result set that is not
    // true.
    let release = () => {};
    const slow = new Promise<string>((resolve) => {
      release = () => resolve("late");
    });
    const provider = {
      readFile: vi.fn(async (_ref: ProjectRef, path: string) =>
        path.includes("EL2") ? slow : "early",
      ),
    } as unknown as StorageProvider;

    const { seen } = mount(provider, [source("EL1"), source("EL2")], 1);
    await waitFor(() => expect(seen.current.get("EL1")).toBe("early"));
    expect(seen.current.has("EL2")).toBe(false);
    release();
    await waitFor(() => expect(seen.current.get("EL2")).toBe("late"));
  });

  it("keeps the rest of the project searchable when one file cannot be read", async () => {
    // One unreadable Section never costs the writer every other hit in their
    // book.
    const provider = fakeProvider({ EL2: "the storm" });
    const { seen } = mount(provider, [source("EL1"), source("EL2")], 1);
    await waitFor(() => expect(seen.current.get("EL2")).toBe("the storm"));
    expect(seen.current.has("EL1")).toBe(false);
  });

  it("does not read a file twice while one search is being typed", async () => {
    // The session does not move while the writer is refining a query, so the
    // book is read once and every keystroke after that is a regex over memory.
    const provider = fakeProvider({ EL1: "the storm" });
    const sources = [source("EL1")];
    const { seen, view, Probe } = mount(provider, sources, 1);
    await waitFor(() => expect(seen.current.get("EL1")).toBe("the storm"));

    view.rerender(<Probe provider={provider} sources={sources} session={1} />);
    view.rerender(<Probe provider={provider} sources={sources} session={1} />);
    await Promise.resolve();
    expect(provider.readFile).toHaveBeenCalledTimes(1);
  });

  it("re-reads the whole book for a new search, so a saved edit is found", async () => {
    // Every search re-reads the book. Re-reading only files whose
    // `contentHash` moved makes the save path keep the hash true in a second
    // place, and a miss there hides the writer's own edits from their search.
    //
    // Nothing in the read path reaches the network (`cached.readFile` serves
    // the working copy; a device project reads its own disk), so re-reading a
    // book per search is a local sweep, and it cannot go stale because nothing
    // outside this hook has to remember anything.
    const files: Record<string, string> = { EL1: "before", EL2: "also before" };
    const provider = fakeProvider(files);
    const sources = [source("EL1"), source("EL2")];
    const { seen, view, Probe } = mount(provider, sources, 1);
    await waitFor(() => expect(seen.current.get("EL1")).toBe("before"));
    expect(provider.readFile).toHaveBeenCalledTimes(2);

    // The writer edits and saves, and nothing tells the index.
    files.EL1 = "after";
    view.rerender(<Probe provider={provider} sources={sources} session={2} />);
    await waitFor(() => expect(seen.current.get("EL1")).toBe("after"));
    expect(provider.readFile).toHaveBeenCalledTimes(4);
  });

  it("re-reads only the file that was written while a search is open", async () => {
    // An autosave of the open Section must not re-read the whole book: the
    // write names its path, and only that file's entry is owed again.
    const files: Record<string, string> = {
      EL1: "one",
      EL2: "before",
      EL3: "three",
    };
    const provider = fakeProvider(files);
    const sources = [source("EL1"), source("EL2"), source("EL3")];
    const { seen, view, Probe } = mount(provider, sources, 1);
    await waitFor(() => expect(seen.current.size).toBe(3));
    expect(provider.readFile).toHaveBeenCalledTimes(3);

    files.EL2 = "after";
    view.rerender(
      <Probe
        provider={provider}
        sources={sources}
        session={1}
        written={new Map([["/document/EL2.md", 1]])}
      />,
    );
    await waitFor(() => expect(seen.current.get("EL2")).toBe("after"));
    expect(provider.readFile).toHaveBeenCalledTimes(4);
    expect(provider.readFile.mock.calls[3]?.[1]).toBe("/document/EL2.md");
  });

  it("holds the files written while held, and reads every one of them when the hold lifts", async () => {
    const files: Record<string, string> = {
      EL1: "one",
      EL2: "two",
      EL3: "three",
    };
    const provider = fakeProvider(files);
    const sources = [source("EL1"), source("EL2"), source("EL3")];
    const { seen, answer, view, Probe } = mount(provider, sources, 1);
    await waitFor(() => expect(seen.current.size).toBe(3));

    files.EL1 = "one again";
    files.EL3 = "three again";
    const written = new Map([
      ["/document/EL1.md", 1],
      ["/document/EL3.md", 2],
    ]);
    view.rerender(
      <Probe
        provider={provider}
        sources={sources}
        session={1}
        written={written}
        held
      />,
    );
    await Promise.resolve();
    expect(provider.readFile).toHaveBeenCalledTimes(3);
    expect(answer.current.reading).toBe(false);

    view.rerender(
      <Probe
        provider={provider}
        sources={sources}
        session={1}
        written={written}
      />,
    );
    await waitFor(() => expect(seen.current.get("EL3")).toBe("three again"));
    expect(seen.current.get("EL1")).toBe("one again");
    expect(
      provider.readFile.mock.calls.slice(3).map(([, path]) => path),
    ).toEqual(["/document/EL1.md", "/document/EL3.md"]);
  });

  it("shows the last search's answer while the next one is being read", async () => {
    // The map is not dropped when the session moves, only overwritten as the
    // sweep lands. Emptying the panel and filling it again would flash a "no
    // results" that was never true, on every second search.
    let release = () => {};
    const provider = {
      readFile: vi.fn(
        async () =>
          new Promise<string>((resolve) => {
            release = () => resolve("second");
          }),
      ),
    } as unknown as StorageProvider;
    const sources = [source("EL1")];

    // The first search resolves immediately, through its own double.
    const first = { readFile: vi.fn(async () => "first") };
    const { seen, view, Probe } = mount(
      first as unknown as StorageProvider,
      sources,
      1,
    );
    await waitFor(() => expect(seen.current.get("EL1")).toBe("first"));

    // The second search's read has not come back yet.
    view.rerender(<Probe provider={provider} sources={sources} session={2} />);
    await Promise.resolve();
    expect(seen.current.get("EL1")).toBe("first");
    release();
    await waitFor(() => expect(seen.current.get("EL1")).toBe("second"));
  });

  it("says it is reading until every file this search asked for has answered", async () => {
    // What the loader in the find field is drawn from. It matters on every
    // search: the index re-reads the project each time it is asked,
    // so without it a writer whose query matches no name watches an empty
    // list under a query whose answer has not been read yet.
    let release: (text: string) => void = () => {};
    const provider = {
      readFile: vi.fn(
        async () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      ),
    } as unknown as StorageProvider;

    const { answer } = mount(provider, [source("EL1")], 1);
    expect(answer.current.reading).toBe(true);
    release("the storm");
    await waitFor(() => expect(answer.current.reading).toBe(false));
  });

  it("stops reading when a file cannot be read at all", async () => {
    // A failed read is recorded rather than skipped. Skipped, the source
    // would still be owed and the loader would turn for as long as the
    // project stayed open, and an indicator that never stops is one nobody
    // believes the next time it starts.
    const provider = fakeProvider({ EL2: "the storm" });
    const { answer } = mount(provider, [source("EL1"), source("EL2")], 1);
    await waitFor(() => expect(answer.current.reading).toBe(false));
    expect(answer.current.bodies.has("EL1")).toBe(false);
  });

  it("is not reading when no search has begun, and not when nothing can read", () => {
    // Session 0 is the lazy case; a missing provider is the case where waiting
    // would never end.
    expect(
      mount(fakeProvider({ EL1: "x" }), [source("EL1")], 0).answer.current
        .reading,
    ).toBe(false);
    expect(mount(null, [source("EL1")], 1).answer.current.reading).toBe(false);
  });

  it("drops one project's prose the moment it is asked about another", async () => {
    // Synchronously, during render, and not in an effect: an effect would let
    // one render hand the previous project's words to a panel already showing
    // the new project's tree. An empty result for a frame is true; another
    // book's sentences under this book's headings are not.
    const provider = fakeProvider({ EL1: "the storm" });
    const sources = [source("EL1")];
    const { seen, view, Probe } = mount(provider, sources, 1);
    await waitFor(() => expect(seen.current.get("EL1")).toBe("the storm"));

    view.rerender(
      <Probe
        provider={provider}
        sources={sources}
        session={1}
        projectRef={{ ...REF, key: "another-book" }}
      />,
    );
    expect(seen.current.size).toBe(0);
  });

  it("has nothing to read without a provider or without sources", async () => {
    const { seen } = mount(null, [source("EL1")], 1);
    expect(seen.current.size).toBe(0);
    const { seen: empty } = mount(fakeProvider({}), [], 1);
    await Promise.resolve();
    expect(empty.current.size).toBe(0);
  });
});
