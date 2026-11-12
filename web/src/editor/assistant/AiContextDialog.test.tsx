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
import AiContextDialog from "./AiContextDialog";
import type { Assistant } from "../../ai";
import type { ChatRecord, SourceDescriptor } from "../../ai/domain/types";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  __resetOverlays();
});

const settled = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const sources: SourceDescriptor[] = [
  {
    id: "node:S1",
    nodeId: "S1",
    kind: "manuscript",
    title: "Opening",
    path: "/document/opening.md",
    order: 0,
    authority: "manuscript",
  },
  {
    id: "node:S2",
    nodeId: "S2",
    kind: "manuscript",
    title: "Future",
    path: "/document/future.md",
    order: 9,
    authority: "manuscript",
  },
  {
    id: "reference:world.md",
    kind: "reference",
    title: "World",
    path: "/reference/world.md",
    authority: "reference",
  },
];

function chat(kind: ChatRecord["kind"] = "general"): ChatRecord {
  return {
    schemaVersion: 1,
    id: "chat-1",
    title: "A chat",
    kind,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    preferences: {
      personaId: "persona-fixture",
      model: { providerId: "ollama", modelId: "llama" },
      pinnedSourceIds: [],
      readerScope: { kind: "through" as const, nodeId: "S1" },
    },
    turns: [],
  };
}

function fake(): Assistant {
  return {
    listSources: vi.fn(async () => sources),
    chats: { updatePreferences: vi.fn(async () => undefined) },
  } as unknown as Assistant;
}

describe("AiContextDialog", () => {
  it("does not read the project until it is opened", async () => {
    const assistant = fake();
    const view = render(
      <AiContextDialog
        open={false}
        onClose={vi.fn()}
        assistant={assistant}
        chat={chat()}
      />,
    );
    // Mounting is not opening: the project is read only once the dialog
    // opens.
    expect(assistant.listSources).not.toHaveBeenCalled();
    view.rerender(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={assistant}
        chat={chat()}
      />,
    );
    await waitFor(() => expect(assistant.listSources).toHaveBeenCalled());
    await screen.findByText("Opening");
  });

  it("offers every source to a general chat, each a tick that pins it", async () => {
    render(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={fake()}
        chat={chat()}
      />,
    );
    await screen.findByText("Opening");
    expect(screen.getByText("World")).toBeTruthy();
    expect(screen.getByText("Future")).toBeTruthy();
    // A tick per source, not a native select per row: two states are a tick,
    // and unticked is "auto".
    const opening = screen.getByRole("checkbox", { name: /^Opening/ });
    expect(opening.getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector(".ai-source-list select")).toBeNull();
    // Grouped under their kind, which the rows do not repeat one by one.
    expect(
      [...document.querySelectorAll(".ai-source-group-title")].map(
        (heading) => heading.textContent,
      ),
    ).toContain("dock.sourceGroup.manuscript");
  });

  it("pins a source on a press, and unpins it on the next", async () => {
    const assistant = fake();
    const { rerender } = render(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={assistant}
        chat={chat()}
      />,
    );
    fireEvent.click(await screen.findByRole("checkbox", { name: /^Opening/ }));
    const pinned = (
      assistant.chats.updatePreferences as unknown as {
        mock: { calls: Array<[{ pinnedSourceIds: string[] }]> };
      }
    ).mock.calls[0]?.[0].pinnedSourceIds;
    expect(pinned).toHaveLength(1);
    const id = pinned?.[0] ?? "";
    rerender(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={assistant}
        chat={{
          ...chat(),
          preferences: { ...chat().preferences, pinnedSourceIds: [id] },
        }}
      />,
    );
    const opening = screen.getByRole("checkbox", { name: /^Opening/ });
    expect(opening.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(opening);
    expect(assistant.chats.updatePreferences).toHaveBeenLastCalledWith({
      pinnedSourceIds: [],
    });
  });

  it("has no foot: every choice writes through, and Escape is the way out", async () => {
    render(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={fake()}
        chat={chat()}
      />,
    );
    await screen.findByText("Opening");
    expect(document.querySelector(".ui-dialog-foot")).toBeNull();
    expect(screen.queryByText("confirm.done")).toBeNull();
  });

  it("hides what a reader is not allowed to know", async () => {
    // A reader knows the manuscript up to its horizon and nothing else, and a
    // source past it is dropped from the list, not disabled: a disabled row
    // still tells the reader that a chapter exists.
    //
    // The horizon select is the exception and lists every manuscript source,
    // because it exists to move the horizon forward, and a picker offering
    // only what the reader knows could never advance it. So the two are
    // asserted apart.
    render(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={fake()}
        chat={chat("alpha-reader")}
      />,
    );
    const list = await waitFor(() => {
      const found = document.querySelector(".ai-source-list");
      if (!found) throw new Error("no source list");
      return found;
    });
    expect(list.textContent).toContain("Opening");
    expect(list.textContent).not.toContain("Future");
    expect(list.textContent).not.toContain("World");

    // The kit `Select`, found by its label as a writer's screen reader
    // would find it.
    const horizon = screen.getByLabelText("dock.readerScope");
    // "The whole manuscript" is its own row, not the absence of a choice:
    // naming the last node instead stops meaning the whole as soon as a
    // chapter is added.
    expect(
      [...horizon.querySelectorAll("option")].map((o) => o.textContent),
    ).toEqual([
      "dock.readerScopeWhole",
      "dock.readerScopeThrough",
      "dock.readerScopeThrough",
    ]);
  });

  it("offers a horizon at a Section, never at a Part's heading", async () => {
    // A Part comes before its Sections in reading order, so "up to Part
    // One" would mean its heading alone, yet read as the whole Part.
    const part: SourceDescriptor = {
      id: "node:P1",
      nodeId: "P1",
      nodeKind: "part",
      kind: "manuscript",
      title: "Part One",
      path: "/document/part-one.md",
      order: 0,
      authority: "manuscript",
    };
    const assistant = {
      listSources: vi.fn(async () => [part, ...sources]),
      chats: { updatePreferences: vi.fn(async () => undefined) },
    } as unknown as Assistant;
    render(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={assistant}
        chat={chat("beta-reader")}
      />,
    );
    await waitFor(() => {
      if (!document.querySelector(".ai-source-list")) throw new Error("none");
    });
    const values = [
      ...screen.getByLabelText("dock.readerScope").querySelectorAll("option"),
    ].map((option) => option.getAttribute("value"));
    expect(values).toContain("through:S1");
    expect(values).not.toContain("through:P1");
  });

  it("never renders a chosen scope over an unset one", async () => {
    // An unset scope shows as unset. A `value=""` that no option carries
    // shows the first chapter, saying a reader is limited to chapter one when
    // the chat is going to be refused.
    render(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={fake()}
        chat={{
          ...chat("beta-reader"),
          preferences: {
            ...chat("beta-reader").preferences,
            readerScope: undefined,
          },
        }}
      />,
    );
    const select = screen.getByLabelText(
      "dock.readerScope",
    ) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect([...select.querySelectorAll("option")][0]?.textContent).toBe(
      "dock.readerScopeUnset",
    );
  });

  it("keeps the reader horizon off a general chat", async () => {
    render(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={fake()}
        chat={chat()}
      />,
    );
    await screen.findByText("Opening");
    expect(screen.queryByText("dock.readerScope")).toBeNull();
  });

  // The editor moves only when the writer asks, so the dialog carries no
  // evidence switch.
  it("offers no evidence switch", async () => {
    render(
      <AiContextDialog
        open
        onClose={vi.fn()}
        assistant={fake()}
        chat={chat()}
      />,
    );
    await settled();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
