// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom

// The shelf card's one arithmetic line: current words against the goal in
// `document-properties.json`, as a percentage. A missing, zero or nonsense
// goal shows nothing rather than an invented percentage; the calculation
// reads the goal and never writes it; and a stale count is never presented as
// live, which `state` decides and these rows pin alongside.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ProjectCard from "./ProjectCard";
import {
  openableId,
  type CardState,
  type ProjectCard as Card,
} from "./useProjects";
import type { CardContent } from "../../profile/profileStore";
import type { ProjectRef } from "../../storage";

// "Reveal on this device" walks the root handle. It is mocked so the fallback
// can be pinned without a real File System Access API: a lapsed grant makes
// the book's own handle unobtainable, so the root is the picker's `startIn`.
const projectHandleFor = vi.fn();
const getLocalRoot = vi.fn();
vi.mock("../../storage/localRoot", () => ({
  projectHandleFor: (...args: unknown[]) => projectHandleFor(...args),
  getLocalRoot: () => getLocalRoot(),
}));

// Wrapped in a spy for the memo rows: `useTranslation()` runs
// unconditionally in the component's body, so its call count shows whether a
// render executed the function, which `React.memo`'s bail-out skips.
const useTranslationSpy = vi.fn(() => ({
  // The echo carries the interpolation, so an assertion can name the number
  // the card shows.
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key} ${vars.pct ?? ""}` : key,
  i18n: { language: "en" },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => useTranslationSpy(),
}));

afterEach(() => cleanup());

const AT = "2026-08-01T10:00:00.000Z";

function content(over: Partial<CardContent> = {}): CardContent {
  return {
    id: "doc-1",
    title: "Once Dark",
    type: "Novel",
    words: 2735,
    parts: 1,
    sections: 2,
    goal: 4800,
    perNode: [],
    structure: { version: 1, children: [] },
    updatedAt: AT,
    cachedAt: AT,
    ...over,
  };
}

function card(
  over: Partial<CardContent> = {},
  state: CardState = "ready",
): Card {
  const ref: ProjectRef = {
    providerId: "local",
    key: "k1",
    name: "Once Dark",
    openedAt: AT,
  };
  return {
    id: "book-k1",
    ref,
    state,
    fresh: true,
    problem: null,
    content: content(over),
  };
}

function renderCard(project: Card, opts: { synced?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <ProjectCard
        card={project}
        index={0}
        shelfMaxWords={100000}
        onForget={() => {}}
        onProperties={() => {}}
        onDuplicate={() => {}}
        onExport={() => {}}
        onDelete={() => {}}
        synced={opts.synced ?? false}
        localRootReady
      />
    </MemoryRouter>,
  );
}

/** A Drive card: the card's anatomy does not differ by provider. */
function driveCard(state: CardState): Card {
  return {
    id: "book-d1",
    ref: { providerId: "drive", key: "d1", name: "D1", openedAt: AT },
    state,
    fresh: false,
    problem: null,
    content: content(),
  };
}

describe("goal progress on the card", () => {
  it("shows words against the goal as a percentage", () => {
    renderCard(card());
    // 2735 / 4800 = 57%.
    expect(screen.getByText(/2,735/)).toBeTruthy();
    expect(screen.getByText(/library\.ofGoal 57/)).toBeTruthy();
  });

  it("shows no percentage when no goal was set", () => {
    renderCard(card({ goal: null }));
    expect(screen.getByText(/2,735/)).toBeTruthy();
    expect(screen.queryByText(/library\.ofGoal/)).toBeNull();
  });

  it("treats a zero goal as no goal rather than dividing", () => {
    renderCard(card({ goal: 0 }));
    expect(screen.queryByText(/library\.ofGoal/)).toBeNull();
  });

  it("caps at 100 instead of promising more than the whole project", () => {
    renderCard(card({ words: 60000, goal: 48000 }));
    expect(screen.getByText(/library\.ofGoal 100/)).toBeTruthy();
  });

  it("rounds rather than truncating", () => {
    renderCard(card({ words: 1000, goal: 3000 }));
    // 33.33… rounds to 33; 66.66… would round to 67.
    expect(screen.getByText(/library\.ofGoal 33/)).toBeTruthy();
  });
});

describe("the open link — error states cannot open", () => {
  it("a ready card's title is the link into the editor, at the book's own id", () => {
    renderCard(card());
    const link = screen.getByRole("link");
    // The id, not the folder: neither the provider nor the folder name
    // appears in the address.
    expect(link.getAttribute("href")).toBe("/app/project/doc-1");
  });

  it("a still-loading card can open — the editor reads the project itself", () => {
    renderCard(card({}, "loading"));
    expect(screen.getByRole("link")).toBeTruthy();
  });

  // A uuid address makes this state real rather than defensive: a card the
  // shelf has just adopted is `loading` with nothing read, so for one read
  // there is no id to link to. The app does not yet know which book this is,
  // and the state ends when the read lands.
  it("a card with nothing read yet is not a link, because it has no address", () => {
    renderCard({ ...card({}, "loading"), content: null });
    expect(screen.queryByRole("link")).toBeNull();
  });

  // A card in trouble has its own affordance above the shelf, where the
  // banner names the cause and carries the recovery. The editor's strict open
  // pipeline would refuse it anyway, so the title is not a link.
  for (const state of ["gone", "unreadable", "blocked"] as const) {
    it(`a ${state} card's title is not a link`, () => {
      renderCard(card({}, state));
      expect(screen.queryByRole("link")).toBeNull();
    });
  }
});

// Whether a card may open and where are one question, because the URL names
// the book's id rather than its folder; two functions that must agree can
// disagree. Each state is pinned with the address it answers.
describe("openableId", () => {
  const at = (state: CardState, content = { id: "doc-1" }) =>
    openableId({
      state,
      content: content as unknown as CardContent,
    });

  it("gives ready and loading the book's own id, and everything else nothing", () => {
    expect(at("ready")).toBe("doc-1");
    expect(at("loading")).toBe("doc-1");
    expect(at("gone")).toBeNull();
    expect(at("unreadable")).toBeNull();
    expect(at("blocked")).toBeNull();
  });

  it("has no address for a card nothing has read", () => {
    expect(openableId({ state: "ready", content: null })).toBeNull();
    expect(openableId({ state: "loading", content: null })).toBeNull();
  });
});

// A card the writer cannot open looks it. The class matrix is
// pinned per state, because a class derived from one readable flag puts the
// wrong classes on some states. The two blocked shapes are `blocked` (access
// lapsed) and `unreadable` (a real read failure); both take ember,
// and `gone` takes slate.
describe("the attention mark — blocked states are visible as blocked", () => {
  const classes = (state: CardState) => {
    renderCard(card({}, state));
    return screen.getByText("Once Dark").closest("article")?.className ?? "";
  };

  for (const state of ["blocked", "unreadable"] as const) {
    it(`a ${state} card carries the attention mark`, () => {
      expect(classes(state)).toContain("project-attention");
    });
  }

  for (const state of ["ready", "loading"] as const) {
    it(`a ${state} card stays quiet`, () => {
      expect(classes(state)).not.toContain("project-attention");
    });
  }

  it("a still-checking card wears the pending dim, and only that", () => {
    // Before the verdict lands the face is dimmed. It brightens only when the
    // read settles and the card is available.
    const cls = classes("loading");
    expect(cls).toContain("project-pending");
    expect(cls).not.toContain("project-attention");
  });

  it("a ready card wears neither dim - it brightened", () => {
    const cls = classes("ready");
    expect(cls).not.toContain("project-pending");
    expect(cls).not.toContain("project-attention");
  });

  it("gone grieves in slate, never in ember", () => {
    const cls = classes("gone");
    expect(cls).toContain("project-gone");
    expect(cls).not.toContain("project-attention");
  });

  it("a blocked card with cached content is stale AND attention — the coexistence proof", () => {
    // The dim says the numbers are old; the ember edge says the card waits on
    // the writer. A blocked card with a cache is the common shape of a lapsed
    // grant: cached books, and a read that could not run.
    const cls = classes("blocked");
    expect(cls).toContain("project-stale");
    expect(cls).toContain("project-attention");
  });
});

describe("Reveal on this device — the picker must open even when the book handle is unobtainable", () => {
  const picker = vi.fn(async () => null);
  let bookHandle: FileSystemDirectoryHandle;
  let rootHandle: FileSystemDirectoryHandle;

  beforeEach(() => {
    picker.mockClear();
    window.showDirectoryPicker = picker as never;
    bookHandle = { name: "once-dark" } as FileSystemDirectoryHandle;
    rootHandle = { name: "PhospheareApp" } as FileSystemDirectoryHandle;
  });

  afterEach(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  /** Open the kebab and pick the reveal action. */
  async function reveal() {
    fireEvent.click(
      screen.getByRole("button", { name: /library\.actionsFor/ }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "library.locateFolder" }),
    );
    await waitFor(() => expect(picker).toHaveBeenCalled());
  }

  it("positions the picker at the book when its handle resolves", async () => {
    projectHandleFor.mockResolvedValue(bookHandle);
    renderCard(card());
    await reveal();
    expect(picker).toHaveBeenCalledWith({ startIn: bookHandle, mode: "read" });
  });

  it("falls back to the root when the book handle cannot be obtained — a lapsed grant still reveals", async () => {
    projectHandleFor.mockResolvedValue(null);
    getLocalRoot.mockResolvedValue(rootHandle);
    renderCard(card({}, "blocked"));
    await reveal();
    expect(picker).toHaveBeenCalledWith({ startIn: rootHandle, mode: "read" });
  });

  it("does nothing only when there is no root at all — the menu never offers the action then", async () => {
    projectHandleFor.mockResolvedValue(null);
    getLocalRoot.mockResolvedValue(null);
    renderCard(card({}, "blocked"));
    fireEvent.click(
      screen.getByRole("button", { name: /library\.actionsFor/ }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "library.locateFolder" }),
    );
    await waitFor(() => expect(projectHandleFor).toHaveBeenCalledWith("k1"));
    expect(picker).not.toHaveBeenCalled();
  });
});

// One anatomy per state, never per provider. A gone card of any kind
// shows the Remove button; its kebab is absent when the menu would only
// duplicate it.
describe("the standardized gone card — Remove visible, kebab only when it holds more", () => {
  it("a gone LOCAL card: Remove button, no kebab", () => {
    renderCard(card({}, "gone"));
    expect(screen.getByRole("button", { name: "library.remove" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /library\.actionsFor/ }),
    ).toBeNull();
  });

  it("a gone DRIVE card is identical: Remove button, no kebab", () => {
    renderCard(driveCard("gone"));
    expect(screen.getByRole("button", { name: "library.remove" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /library\.actionsFor/ }),
    ).toBeNull();
  });

  it("a gone SYNCED card keeps its kebab — unpair is not a visible button", () => {
    renderCard(card({}, "gone"), { synced: true });
    expect(screen.getByRole("button", { name: "library.remove" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /library\.actionsFor/ }),
    ).toBeTruthy();
  });

  it("a ready DRIVE card keeps its single-item kebab — there is no visible button to duplicate", () => {
    renderCard(driveCard("ready"));
    expect(screen.queryByRole("button", { name: "library.remove" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /library\.actionsFor/ }),
    ).toBeTruthy();
  });
});

// The card is memoized. `useTranslation()` runs unconditionally
// in the component body, so its call count shows whether a render executed
// the function; a memoized bail-out skips the whole body, hooks included.
describe("React.memo skips a re-render when nothing about the card actually changed", () => {
  it("does not re-run on an identical-props rerender, but does on a genuine prop change", () => {
    useTranslationSpy.mockClear();
    const onForget = () => {};
    const onProperties = () => {};
    const onDuplicate = () => {};
    const onExport = () => {};
    const onDelete = () => {};
    const project = card();

    const element = (c: Card) => (
      <MemoryRouter>
        <ProjectCard
          card={c}
          index={0}
          shelfMaxWords={100000}
          onForget={onForget}
          onProperties={onProperties}
          onDuplicate={onDuplicate}
          onExport={onExport}
          onDelete={onDelete}
          synced={false}
          localRootReady
        />
      </MemoryRouter>
    );

    const { rerender } = render(element(project));
    const afterMount = useTranslationSpy.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    // Identical props and references, as a sibling card's read landing
    // produces, leaving this card's own props untouched.
    rerender(element(project));
    expect(useTranslationSpy.mock.calls.length).toBe(afterMount);

    // A change to this card's own content still re-renders.
    rerender(element(card({ words: 9999 })));
    expect(useTranslationSpy.mock.calls.length).toBeGreaterThan(afterMount);
  });
});

// `onMoveToDrive` takes the whole `Card`, as `onMoveToLocal` does, because
// `requestMoveToDrive` needs the card to prefill the confirm dialog. A
// ref-only handler would force `Library.tsx` into a fresh closure per card
// per render, defeating the memo; this way every card gets the same stable
// reference.
describe("onMoveToDrive receives the whole card, not just its ref", () => {
  it("passes the full Card through to the handler", () => {
    const onMoveToDrive = vi.fn();
    const project = card();
    render(
      <MemoryRouter>
        <ProjectCard
          card={project}
          index={0}
          shelfMaxWords={100000}
          onForget={() => {}}
          onSyncToDrive={() => {}}
          onMoveToDrive={onMoveToDrive}
          onProperties={() => {}}
          onDuplicate={() => {}}
          onExport={() => {}}
          onDelete={() => {}}
          synced={false}
          localRootReady
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /library\.actionsFor/ }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "library.moveToDrive" }),
    );

    expect(onMoveToDrive).toHaveBeenCalledWith(project);
  });
});
