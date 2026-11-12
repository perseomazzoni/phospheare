// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_KINDS, QUESTION_ARGUMENT_MAX } from "../../ai/domain/types";
import { MAP_ANCHORS_MAX } from "../../ai/application/budgets";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  Assistant,
  AssistantSnapshot,
} from "../../ai/application/assistant";
import type {
  ChatKind,
  ChatRecord,
  MapOutcome,
  ModelDescriptor,
  SourceDescriptor,
} from "../../ai/domain/types";
import { structureRevision } from "../../ai/domain/structureShapes";
import AiPanel from "./AiPanel";
import { ASK_ARM_MS as ASK_ARM } from "./AiSearchAsk";
import { markdown } from "../components/safeMarkdown";
import {
  DEFAULT_PERSONA,
  PERSONAS,
  personasFor,
} from "../../ai/domain/personas";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

// The interface language picks a refusal's scope-word spelling, so a test
// can switch it; read at render, after the module has loaded.
const ui = { language: "en" };
vi.mock("react-i18next", () => {
  // One `t` for every render, as react-i18next's own is while the language
  // holds. A fresh one per render re-runs every memo keyed on `t`, so a
  // settled answer would re-render on every snapshot here and nowhere else,
  // and the streaming rows could not see the difference.
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return {
    useTranslation: () => ({ i18n: { language: ui.language }, t }),
  };
});

afterEach(() => {
  cleanup();
  // The overlay stack is module state shared by every layer in the app: a
  // test that leaves one registered makes the next test's Escape go to a
  // dialog that has left the page.
  __resetOverlays();
  vi.restoreAllMocks();
});

/** The shared overlay moves focus on a macrotask, so the layer is painted
 *  before it is reached into. */
const settled = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/**
 * Open the Context dialog the way a writer does: one press on the `@` beside
 * the field.
 */
async function openContext() {
  fireEvent.click(screen.getByLabelText("dock.context"));
  await settled();
}

/**
 * A review is typed, with no button and no dialog. The command and the
 * optional scope word go into the composer as a writer would write them, and
 * the submit key is the one route from text to run.
 */
function runCommand(text: string) {
  const field = screen.getByLabelText("dock.ask");
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter" });
}

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected test value");
  return value;
}

/** Any voice that is not the default: the one a click must switch to. */
const [OTHER] = PERSONAS.filter((one) => one !== DEFAULT_PERSONA);

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
    order: 1,
    authority: "manuscript",
  },
  {
    id: "reference:world.md",
    kind: "reference",
    title: "World",
    path: "/reference/world.md",
    authority: "reference",
    freshness: "outdated",
  },
];

/**
 * The run's one live region: a visually hidden node the panel owns,
 * outside every turn, which is where a screen reader hears what the run is
 * doing.
 */
const liveRegion = () =>
  document.querySelector(".ai-stage > .ui-visually-hidden[role='status']");

function record(kind: ChatKind = "general"): ChatRecord {
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    title: "My chat",
    kind,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    preferences: {
      // Whatever voice the folder offers this kind first — never a named one,
      // because the panel only ever asks the assistant to resolve an id.
      personaId: (personasFor(kind)[0] ?? DEFAULT_PERSONA).id,
      model: { providerId: "ollama", modelId: "llama" },
      targetNodeId: "S1",
      readerScope: { kind: "through" as const, nodeId: "S1" },
      pinnedSourceIds: [],
      reviewTask: "continuity",
      reviewScope: { kind: "current" },
    },
    turns: [],
  };
}

function fakeAssistant(
  snapshot: AssistantSnapshot,
  overrides: Record<string, unknown> = {},
) {
  // The feature objects, each a group of spies. An override that names a
  // feature replaces only the members it names.
  const features: Record<string, Record<string, unknown>> = {
    sources: {
      // Nothing unwritten: the quiet line has its own rows in
      // `AiPanel.test.tsx`.
      missing: vi.fn(async () => []),
      sectionRevisions: vi.fn(async () => new Map<string, string | null>()),
      summaryStateFor: vi.fn(async () => "missing" as const),
      revealEvidence: vi.fn(async () => "selected" as const),
      updateFindingStatus: vi.fn(async () => undefined),
    },
    room: {
      // The drafting room's need, answered: its question has its own rows.
      draftingNeed: vi.fn(() => "passage"),
      setDraftingNeed: vi.fn(async () => undefined),
    },
    chats: {
      create: vi.fn(async () => record("general")),
      rename: vi.fn(async () => undefined),
      updatePreferences: vi.fn(async () => undefined),
      startClean: vi.fn(async () => record("general")),
    },
    summaries: { generate: vi.fn(async () => undefined) },
    reviews: {
      run: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
    },
    locate: { run: vi.fn(async () => "started" as const) },
    verify: { run: vi.fn(async () => "started" as const) },
    maps: {
      run: vi.fn(async () => "started" as const),
      complete: vi.fn(async () => undefined),
    },
  };
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key in features && typeof value === "object" && value !== null)
      features[key] = { ...features[key], ...value };
    else rest[key] = value;
  }
  return {
    subscribe: vi.fn(() => () => undefined),
    getSnapshot: vi.fn(() => snapshot),
    initialize: vi.fn(async () => undefined),
    activeChat: vi.fn(() => snapshot.chats[0] ?? null),
    currentNode: vi.fn(() => ({ id: "S1", title: "Opening", kind: "section" })),
    listSources: vi.fn(async () => sources),
    // The fixtures' maps are drawn on Three Acts, the project's own.
    declaredShape: vi.fn(() => "threeact"),
    listModels: vi.fn(async () => []),
    personasForKind: vi.fn(() => PERSONAS),
    // Every installed voice, for the picker; the double offers all of them,
    // so nothing is marked unavailable unless a test says otherwise.
    allPersonas: vi.fn(() => PERSONAS),
    personaName: vi.fn(
      (id: string) => PERSONAS.find((one) => one.id === id)?.name ?? null,
    ),
    selectChat: vi.fn(),
    deleteChat: vi.fn(async () => undefined),
    send: vi.fn(async () => "started" as const),
    retrySave: vi.fn(async () => undefined),
    deleteChatFile: vi.fn(async () => undefined),
    clearRevealTurn: vi.fn(),
    continueInNewChat: vi.fn(async () => record("general")),
    stop: vi.fn(),
    cancelQueued: vi.fn(),
    dispose: vi.fn(),
    ...features,
    ...rest,
  } as unknown as Assistant;
}

function snapshot(chat?: ChatRecord): AssistantSnapshot {
  return {
    chats: chat ? [chat] : [],
    unreadable: [],
    activeChatId: chat?.id ?? null,
    running: false,
    preparing: false,
    error: null,
    queued: 0,
    saveFailedChatId: null,
  };
}

describe("AiPanel controls", () => {
  it("shows unavailable and empty states and creates each chat type", () => {
    const { rerender } = render(
      <AiPanel assistant={null} quote={null} onQuote={vi.fn()} />,
    );
    expect(screen.getByText("dock.assistantUnavailable")).toBeTruthy();

    const assistant = fakeAssistant(snapshot());
    rerender(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    // Every kind is reachable with no chat open, and from either button: the
    // head carries one at the corner of the panel and the empty state one
    // beside the sentence explaining itself. Both drive the same menu, and
    // neither makes a general chat outright. Their words differ: the head's
    // is the dock's add-pill ("new chat", lowercase, like the notes table's)
    // and the empty state's is a sentence's worth of invitation.
    expect(screen.getByText("dock.newChatAdd")).toBeTruthy();
    fireEvent.click(screen.getByText("dock.newChat"));
    // Driven from `CHAT_KINDS` rather than a list written out here, so a kind
    // added to the union and never offered fails this test; its own copy of
    // the names could not catch that.
    for (const kind of CHAT_KINDS) {
      fireEvent.click(
        screen.getByRole("menuitem", { name: `dock.chatKind.${kind}` }),
      );
      expect(assistant.chats.create).toHaveBeenCalledWith(kind);
      fireEvent.click(screen.getByText("dock.newChat"));
    }
  });

  it("manages chat selection, persona, rename, and confirmed deletion", async () => {
    const current = record();
    const second = { ...record(), id: "second", title: "Second" };
    const state = { ...snapshot(current), chats: [current, second] };
    const assistant = fakeAssistant(state);
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);

    // The chat list is a dialog over the conversation. It stays open across
    // a rename and a delete, so no step below re-opens it. Picking a row is
    // the one action that closes it, because it is the one that changes what
    // the panel behind is showing.
    const control = () => screen.getByRole("button", { name: "dock.chats" });
    fireEvent.click(control());
    await settled();
    fireEvent.click(screen.getByText("Second"));
    expect(assistant.selectChat).toHaveBeenCalledWith("second");

    fireEvent.click(screen.getByLabelText("dock.persona"));
    await settled();
    fireEvent.click(screen.getByText(OTHER.name));
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({
      personaId: OTHER.id,
    });

    fireEvent.click(control());
    await settled();
    // A row's actions are behind its `more` button, as a tree row's are.
    const rowAction = (name: string) => {
      fireEvent.click(
        must(screen.getAllByRole("button", { name: /^dock\.chatActions/ })[0]),
      );
      fireEvent.click(screen.getByRole("menuitem", { name }));
    };
    rowAction("dock.renameChat");
    fireEvent.change(screen.getByLabelText("dock.chatTitle"), {
      target: { value: "Revised title" },
    });
    fireEvent.click(screen.getByText("dock.save"));
    expect(assistant.chats.rename).toHaveBeenCalledWith(
      current.id,
      "Revised title",
    );
    // Saving returns to the list rather than closing: the writer came here to
    // pick a chat, and renaming one was a detour.
    expect(screen.queryByLabelText("dock.chatTitle")).toBeNull();
    rowAction("dock.renameChat");
    fireEvent.click(screen.getByText("confirm.cancel"));
    expect(screen.queryByLabelText("dock.chatTitle")).toBeNull();

    // The confirmation stacks on the list, both built on the shared Scrim,
    // so the row that opened it is still there to take focus back.
    //
    // Focused explicitly first: a real press focuses the button it presses,
    // and `fireEvent.click` does not, so without this the overlay would
    // capture `body` as the place to go back to and prove nothing.
    const more = must(
      screen.getAllByRole("button", { name: /^dock\.chatActions/ })[0],
    );
    more.focus();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: "dock.deleteChat" }));
    // Deleting a chat is a loss, so it asks first.
    expect(assistant.deleteChat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("confirm.cancel"));
    await settled();
    // Back on the row's More button: the menu hands focus to its anchor, and
    // the confirmation hands it back to where it found it.
    expect(document.activeElement).toBe(more);

    rowAction("dock.deleteChat");
    fireEvent.click(screen.getByText("dock.deleteChatConfirm"));
    expect(assistant.deleteChat).toHaveBeenCalledWith(current.id);
    // The panel does not list chats on mount: the bridge owns that, and a
    // panel-mount listing would re-read every file per face switch for no
    // gain.
    expect(assistant.initialize).not.toHaveBeenCalled();
  });

  // Passages are shown when the writer asks, by a clicked quote or `/where`,
  // so the dialog has no "Highlight evidence while it works" switch: offering
  // the model a tool it might not call leaves the feature undiscoverable.
  it("offers no evidence switch in the Context dialog", async () => {
    const current = record();
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await openContext();
    // Only the evidence switch: another switch here is no regression.
    expect(screen.queryByRole("switch", { name: /evidence/i })).toBeNull();
    expect(screen.queryByText("dock.highlightEvidence")).toBeNull();
  });

  // Two states, not three: barring a document lives on the source's own row,
  // not in this dialog. Barring is a per-project decision, and an `exclude`
  // written to the chat would bring the document back with every new chat.
  it("offers auto/pin context controls and enforces reader horizon in the UI", async () => {
    const current = record("alpha-reader");
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await openContext();
    await screen.findByLabelText("Opening dock.context");
    expect(screen.queryByLabelText("Future dock.context")).toBeNull();
    expect(screen.queryByLabelText("World dock.context")).toBeNull();

    // A tick, pressed to pin: two states, so there is no third one to offer,
    // and a tick cannot grow one by accident.
    const opening = screen.getByLabelText("Opening dock.context");
    expect(opening.tagName).toBe("BUTTON");
    expect(opening.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(opening);
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        pinnedSourceIds: ["node:S1"],
      }),
    );
    // The reader's scope is the kit `Select`, found by its label.
    const horizon = screen.getByLabelText("dock.readerScope");
    fireEvent.change(horizon, {
      target: { value: "through:S2" },
    });
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({
      readerScope: { kind: "through", nodeId: "S2" },
    });
    fireEvent.change(horizon, {
      target: { value: "whole" },
    });
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({
      readerScope: { kind: "whole" },
    });
    // Nothing here is held back to confirm, so there is no foot: Escape is
    // the way out, and every choice is already written through.
    expect(screen.queryByText("confirm.done")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await settled();
    expect(screen.queryByLabelText("Opening dock.context")).toBeNull();
  });

  it("shows all context classes for general chat and their standing", async () => {
    const current = record();
    current.preferences.pinnedSourceIds = ["node:S1", "unused"];
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await openContext();
    await screen.findByText("World");
    // The standing is the group's heading, said once over the rows it names,
    // and the row keeps only its freshness. It reads "reference", never
    // "tentative": there is no Tentative/Canon rating.
    expect(screen.getByText("dock.sourceGroup.reference")).toBeTruthy();
    expect(screen.getByLabelText("World dock.context").textContent).toContain(
      "outdated",
    );
    fireEvent.click(screen.getByLabelText("Opening dock.context"));
    fireEvent.click(screen.getByLabelText("World dock.context"));
    // An id naming nothing in the catalog is left where it is: it is
    // inert, and pruning it would drop a pin the writer set on a document
    // that is merely binned or briefly unreachable.
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({
      pinnedSourceIds: ["unused"],
    });
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({
      pinnedSourceIds: ["node:S1", "unused", "reference:world.md"],
    });
    // Enter on an empty composer is not a send.
    fireEvent.keyDown(screen.getByLabelText("dock.ask"), { key: "Enter" });
    expect(assistant.send).not.toHaveBeenCalled();
  });

  it("hands a review the quote at the nearest scope, and clears it", () => {
    const current = record("editorial");
    const assistant = fakeAssistant(snapshot(current));
    const onQuote = vi.fn();
    render(<AiPanel assistant={assistant} quote="a line" onQuote={onQuote} />);
    runCommand("/continuity");
    expect(assistant.reviews.run).toHaveBeenCalledWith(
      "continuity",
      { kind: "current" },
      "a line",
      undefined,
    );
    expect(onQuote).toHaveBeenCalledWith(null);
  });

  it("runs a review from a typed command, at the nearest scope unless told otherwise", async () => {
    const current = record("editorial");
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    // A review is the command and one optional word. `/canon` is the
    // `consistency` review: the file names the task, so the writer's word
    // and the engine's word need not be the same word.
    runCommand("/canon");
    expect(assistant.reviews.run).toHaveBeenNthCalledWith(
      1,
      "consistency",
      { kind: "current" },
      undefined,
      undefined,
    );
    // The scope words are the app's nouns, in either language.
    runCommand("/canon structure");
    expect(assistant.reviews.run).toHaveBeenNthCalledWith(
      2,
      "consistency",
      { kind: "structure" },
      undefined,
      undefined,
    );

    // The nearest scope is the default, and the expensive one is never given
    // by accident: the whole Structure is minutes of the writer's own model.
    runCommand("/continuity");
    expect(assistant.reviews.run).toHaveBeenNthCalledWith(
      3,
      "continuity",
      { kind: "current" },
      undefined,
      undefined,
    );

    // A skill with no review task is a question, asked in the file's words
    // and carrying what the writer typed, which the bubble shows in place of
    // the rubric.
    runCommand("/summarise");
    expect(assistant.send).toHaveBeenCalledWith(
      expect.stringContaining("Summarise this part of the manuscript."),
      undefined,
      { skill: "summarise" },
    );

    // Anything the parser does not recognise is a question, including a
    // sentence that starts with a slash and a command with a word that is not
    // a scope. A `/canon` naming no reference and a lone slash-word are
    // refusals, pinned below.
    for (const text of [
      "/continuity deeply",
      "/nonesuch at all",
      "/ is a slash",
    ]) {
      runCommand(text);
      expect(assistant.send).toHaveBeenCalledWith(text, undefined);
    }
    expect(assistant.reviews.run).toHaveBeenCalledTimes(3);
  });

  // A lone slash-word that is no command in this chat, such as `/structure`
  // in a General chat, sends nothing and names the command it reached for.
  it("refuses a lone slash-word that is no command here, naming the nearest", async () => {
    const current = record("general");
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await waitFor(() => expect(assistant.listSources).toHaveBeenCalled());
    runCommand("/structure");
    expect(assistant.send).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
    ).toBe("/structure");
    const refusal = must(document.querySelector(".dock-problem"));
    // The key alone: this suite's translator does not draw slots, and the
    // command it names is pinned in `skills.test` (`nearestCommand`).
    expect(refusal.textContent).toContain("dock.problem.command-elsewhere");
    runCommand("/zzz");
    expect(must(document.querySelector(".dock-problem")).textContent).toContain(
      "dock.problem.command-unknown",
    );
    // A sentence that starts with a slash is still a question.
    runCommand("/structure feels off to me");
    expect(assistant.send).toHaveBeenCalled();
  });

  // A `/canon` line naming no reference the book holds is refused before
  // anything is sent: never a question, and never every reference instead.
  // The words stay where they were, and every name it would take is listed,
  // outside the crimson.
  describe("a named reference", () => {
    const marta: SourceDescriptor = {
      id: "reference:character--Marta.md",
      kind: "reference",
      title: "Marta",
      path: "/reference/character--Marta.md",
      authority: "reference",
      group: "characters",
    };

    it("refuses a name the book does not hold, and lists the ones it does", async () => {
      const current = record("editorial");
      const assistant = fakeAssistant(snapshot(current), {
        listSources: vi.fn(async () => [...sources, marta]),
      });
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      await waitFor(() => expect(assistant.listSources).toHaveBeenCalled());
      runCommand("/canon deeply");
      expect(assistant.send).not.toHaveBeenCalled();
      expect(assistant.reviews.run).not.toHaveBeenCalled();
      expect(
        (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
      ).toBe("/canon deeply");
      const refusal = must(document.querySelector(".dock-problem"));
      expect(refusal.textContent).toContain(
        "dock.problem.review-reference-unknown:",
      );
      const hints = [...document.querySelectorAll(".dock-hint")].map(
        (one) => one.textContent ?? "",
      );
      expect(hints.some((one) => one.startsWith("dock.canon.names"))).toBe(
        true,
      );

      // Changing the words takes the refusal away; a name runs.
      runCommand("/canon marta");
      expect(document.querySelector(".dock-problem")).toBeNull();
      expect(assistant.reviews.run).toHaveBeenCalledWith(
        "consistency",
        { kind: "current" },
        undefined,
        [marta.id],
      );
    });

    it("says so in one line when there is nothing it could name", async () => {
      const current = record("editorial");
      const assistant = fakeAssistant(snapshot(current));
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      await waitFor(() => expect(assistant.listSources).toHaveBeenCalled());
      runCommand("/canon Marta");
      expect(assistant.reviews.run).not.toHaveBeenCalled();
      expect(
        must(document.querySelector(".dock-problem")).textContent,
      ).toContain("dock.problem.review-reference-unknown-none");
      expect(document.body.textContent).not.toContain("dock.canon.names");
    });

    // A refused review leaves nothing in the transcript: the words come back
    // to be changed, after a model switch or with `section`, and sent again.
    it("gives the words back when the review is refused", async () => {
      const current = record("editorial");
      const assistant = fakeAssistant(snapshot(current), {
        listSources: vi.fn(async () => [...sources, marta]),
        reviews: { run: vi.fn(async () => "rejected" as const) },
      });
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      await waitFor(() => expect(assistant.listSources).toHaveBeenCalled());
      const field = screen.getByLabelText("dock.ask") as HTMLTextAreaElement;
      runCommand("/canon marta");
      expect(field.value).toBe("");
      await waitFor(() => expect(field.value).toBe("/canon marta"));
    });

    // A question refused over its named reference is refused only after its
    // run goes live, after the model's description, the context and any
    // compaction, so the writer may have begun another line by then. Its
    // words come back only into an empty field, as a review's do.
    it("gives a refused question back only into an empty field", async () => {
      const current = record("editorial");
      let settle: (outcome: "rejected") => void = () => undefined;
      const assistant = fakeAssistant(snapshot(current), {
        send: vi.fn(
          () =>
            new Promise<"rejected">((resolve) => {
              settle = resolve;
            }),
        ),
      });
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      const field = screen.getByLabelText("dock.ask") as HTMLTextAreaElement;
      runCommand("And her hands?");
      expect(field.value).toBe("");
      // The next line, begun while the first was still being put together.
      fireEvent.change(field, { target: { value: "Also the ferry" } });
      await act(async () => settle("rejected"));
      expect(field.value).toBe("Also the ferry");
    });

    // A review whose named reference is gone is offered no Resume, neither
    // the turn's own nor the asking stack's, because the run would refuse
    // it. The catalogue is `[]` until the first listing lands, so nothing
    // reads as gone before `catalogueRead`.
    const namedAnswer = (reference: string): ChatRecord => ({
      ...record("editorial"),
      turns: [
        {
          id: "t1",
          runId: "run-1",
          role: "assistant",
          text: "Review stopped.",
          createdAt: "2026-09-16T00:00:00.000Z",
          outcome: "interrupted",
          review: {
            runId: "run-1",
            task: "consistency",
            scope: { kind: "structure" },
            references: [reference],
          },
        },
      ],
    });
    const pending = {
      runId: "run-1",
      task: "consistency" as const,
      complete: 1,
      total: 3,
    };

    it("offers no Resume anywhere for a review whose named reference is gone", async () => {
      const assistant = fakeAssistant({
        ...snapshot(namedAnswer("reference:character--Gone.md")),
        pendingReview: pending,
      });
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      await waitFor(() => expect(assistant.listSources).toHaveBeenCalled());
      await settled();
      expect(screen.queryAllByText(/dock\.resumeReview/)).toHaveLength(0);
    });

    it("does not call a named reference gone before the catalogue is read", async () => {
      const assistant = fakeAssistant(
        { ...snapshot(namedAnswer(marta.id)), pendingReview: pending },
        // The first listing has not landed yet.
        { listSources: vi.fn(() => new Promise(() => undefined)) },
      );
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      await settled();
      // The stack's and the turn's own.
      expect(screen.queryAllByText(/dock\.resumeReview/)).toHaveLength(2);
    });
  });

  // A refusal gives back the line the writer typed, never the skill's rubric
  // that was sent in its place.
  it("gives back the words typed when a command's question is refused", async () => {
    // Editorial: the chat that offers `/summarise`.
    const current = record("editorial");
    const assistant = fakeAssistant(snapshot(current), {
      send: vi.fn(async () => "rejected" as const),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    const field = screen.getByLabelText("dock.ask") as HTMLTextAreaElement;
    runCommand("/summarise");
    // Cleared at submit, then given back once the refusal is in.
    expect(field.value).toBe("");
    await waitFor(() => expect(field.value).not.toBe(""));
    expect(field.value).toBe("/summarise");
  });

  it("runs /where with the writer's words, and holds a bare one", async () => {
    // The sentence is the search's argument, verbatim, and never a question,
    // not even bare, where the writer is halfway through asking.
    const current = record("general");
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    runCommand("/where");
    expect(assistant.locate.run).not.toHaveBeenCalled();
    expect(assistant.send).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
    ).toBe("/where");
    runCommand("/where  the night of the crash ");
    await waitFor(() =>
      expect(assistant.locate.run).toHaveBeenCalledWith(
        "the night of the crash",
      ),
    );
    expect(assistant.send).not.toHaveBeenCalled();
  });

  // The claim is `/verify`'s argument, verbatim, and the quote goes with it,
  // or stands for it where there is no claim.
  it("runs /verify with the claim and the quote, and holds a bare one with no quote", async () => {
    const current = record("general");
    const assistant = fakeAssistant(snapshot(current));
    const onQuote = vi.fn();
    const { rerender } = render(
      <AiPanel assistant={assistant} quote={null} onQuote={onQuote} />,
    );
    runCommand("/verify");
    expect(assistant.verify.run).not.toHaveBeenCalled();
    expect(assistant.send).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
    ).toBe("/verify");
    runCommand("/verify  Calvino died in Rome ");
    await waitFor(() =>
      expect(assistant.verify.run).toHaveBeenCalledWith(
        "Calvino died in Rome",
        undefined,
      ),
    );
    // A bare `/verify` over a quote runs, the quote standing for the claim.
    rerender(
      <AiPanel
        assistant={assistant}
        quote="Calvino died in Siena in 1985."
        onQuote={onQuote}
      />,
    );
    runCommand("/verify");
    await waitFor(() =>
      expect(assistant.verify.run).toHaveBeenLastCalledWith(
        "",
        "Calvino died in Siena in 1985.",
      ),
    );
    expect(onQuote).toHaveBeenCalledWith(null);
    expect(assistant.send).not.toHaveBeenCalled();
  });

  it("gives a refused /verify its words and its quote back", async () => {
    const current = record("editorial");
    const assistant = fakeAssistant(snapshot(current), {
      verify: { run: vi.fn(async () => "rejected" as const) },
    });
    const onQuote = vi.fn();
    render(
      <AiPanel
        assistant={assistant}
        quote="Calvino died in Siena."
        onQuote={onQuote}
      />,
    );
    runCommand("/verify Calvino died in Rome");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
      ).toBe("/verify Calvino died in Rome"),
    );
    expect(onQuote).toHaveBeenLastCalledWith("Calvino died in Siena.");
  });

  it("says what a /where or its summaries are doing, by stage", () => {
    // Before the search has chosen what to read there is no count to give,
    // so it says what it is doing; then it counts the Sections it reads.
    const current = record("general");
    const at = (runProgress: AssistantSnapshot["runProgress"]) =>
      fakeAssistant({ ...snapshot(current), running: true, runProgress });
    const { rerender } = render(
      <AiPanel
        assistant={at({ work: "locate", complete: 0, total: 0 })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(liveRegion()?.textContent).toBe("dock.where.ranking");
    rerender(
      <AiPanel
        assistant={at({ work: "locate", complete: 1, total: 3 })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(liveRegion()?.textContent).toBe(
      'dock.where.reading:{"complete":1,"count":3}',
    );
    rerender(
      <AiPanel
        assistant={at({ work: "summarise", complete: 2, total: 5 })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(liveRegion()?.textContent).toBe(
      'dock.summarising:{"complete":2,"count":5}',
    );
  });

  it("guides the command being typed from its first word, and only one this chat offers", () => {
    // The space above the field says what the command does, when and how,
    // as soon as the menu fills in `/where `, before the line is anything
    // Enter would run.
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(record("general")))}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const field = screen.getByLabelText("dock.ask");
    const guide = () => document.querySelector(".ai-guide");
    expect(guide()).toBeNull();
    fireEvent.change(field, { target: { value: "/where " } });
    expect(guide()?.textContent).toContain("/where");
    // A command of another room is not this chat's to explain.
    fireEvent.change(field, { target: { value: "/heart" } });
    expect(guide()).toBeNull();
    fireEvent.change(field, { target: { value: "where is the crash?" } });
    expect(guide()).toBeNull();
    // And a local model says nothing about transit: only the guide is up.
    fireEvent.change(field, { target: { value: "/map" } });
    expect(guide()?.textContent).toContain("/map");
    expect(document.querySelector(".ai-transit")).toBeNull();
  });

  it("says where a /where's summaries travel before it is sent, on a relay model only", () => {
    // The search sends summaries and passages to a vendor, so the writer is
    // told at the point of asking. A remote provider says so; the
    // local one says nothing.
    const current = record("general");
    current.preferences.model = { providerId: "relayed", modelId: "m" };
    const relayed = {
      relayed: {
        connected: true,
        state: "ready" as const,
        notice: null,
        waitUntil: null,
        limitUsd: 5,
        upstreamHost: "openrouter.ai",
      },
    };
    const { rerender } = render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={relayed}
      />,
    );
    const field = screen.getByLabelText("dock.ask");
    expect(screen.queryByText(/dock\.where\.remoteTransit/)).toBeNull();
    fireEvent.change(field, { target: { value: "/where the crash" } });
    expect(
      screen.getByText('dock.where.remoteTransit:{"provider":"openrouter.ai"}'),
    ).toBeTruthy();
    // An ordinary question carries nothing extra, and says nothing extra.
    fireEvent.change(field, { target: { value: "where is the crash?" } });
    expect(screen.queryByText(/dock\.where\.remoteTransit/)).toBeNull();

    const local = record("general");
    rerender(
      <AiPanel
        assistant={fakeAssistant(snapshot(local))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={relayed}
      />,
    );
    fireEvent.change(screen.getByLabelText("dock.ask"), {
      target: { value: "/where the crash" },
    });
    expect(screen.queryByText(/dock\.where\.remoteTransit/)).toBeNull();
  });

  it("gives a refused /where its words back", async () => {
    const current = record("drafting");
    const assistant = fakeAssistant(snapshot(current), {
      locate: { run: vi.fn(async () => "rejected" as const) },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    runCommand("/where the crash");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
      ).toBe("/where the crash"),
    );
  });

  // `/map` alone is the whole Structure, its words are a scope, and it is
  // never sent as a question. A shape word after the reach goes with it, and
  // none is `undefined`, the declared shape.
  it("runs /map on the scope typed, and the whole Structure when bare", async () => {
    const current = record("general");
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    runCommand("/map");
    await waitFor(() =>
      expect(assistant.maps.run).toHaveBeenCalledWith(
        { kind: "structure" },
        undefined,
      ),
    );
    runCommand("/map parte");
    await waitFor(() =>
      expect(assistant.maps.run).toHaveBeenLastCalledWith(
        { kind: "part" },
        undefined,
      ),
    );
    expect(assistant.send).not.toHaveBeenCalled();
    expect(assistant.reviews.run).not.toHaveBeenCalled();
    // A Section is a map's scope, in either language.
    runCommand("/map sezione");
    await waitFor(() =>
      expect(assistant.maps.run).toHaveBeenLastCalledWith(
        { kind: "section" },
        undefined,
      ),
    );
    // A word `/map` does not take is a question, as for every command.
    runCommand("/map sonnet");
    expect(assistant.send).toHaveBeenCalledWith("/map sonnet", undefined);
    expect(assistant.maps.run).toHaveBeenCalledTimes(3);
    runCommand("/map part eroe");
    await waitFor(() =>
      expect(assistant.maps.run).toHaveBeenLastCalledWith(
        { kind: "part" },
        "herosjourney",
      ),
    );
  });

  // A refusal comes once the run has looked, and the writer may have begun
  // the next line by then: the words come back into an empty field only.
  it.each([
    ["/where the crash", "locate"],
    ["/map part", "maps"],
  ])(
    "never gives a refused %s back over a line begun meanwhile",
    async (typed, feature) => {
      let refuse: (outcome: "rejected") => void = () => undefined;
      const assistant = fakeAssistant(snapshot(record("drafting")), {
        [feature]: {
          run: vi.fn(
            () =>
              new Promise((resolve) => {
                refuse = resolve;
              }),
          ),
        },
      });
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      runCommand(typed);
      const field = screen.getByLabelText("dock.ask") as HTMLTextAreaElement;
      await waitFor(() => expect(field.value).toBe(""));
      fireEvent.change(field, { target: { value: "Something else" } });
      await act(async () => refuse("rejected"));
      expect(field.value).toBe("Something else");
    },
  );

  it("gives a refused /map its words back", async () => {
    const current = record("drafting");
    const assistant = fakeAssistant(snapshot(current), {
      maps: { run: vi.fn(async () => "rejected" as const) },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    runCommand("/map part");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
      ).toBe("/map part"),
    );
  });

  // `/summarise part` composes one account of a Part; the quote, the open
  // Section and the open Section's own title stay the plain question.
  describe("/summarise part", () => {
    const BOOK: SourceDescriptor[] = [
      {
        id: "node:P1",
        nodeId: "P1",
        kind: "manuscript",
        nodeKind: "part",
        title: "Book One",
        path: "/document/book.md",
        order: 0,
        authority: "manuscript",
      },
      { ...sources[0], nodeKind: "section", partId: "P1", order: 1 },
      { ...sources[1], nodeKind: "section", partId: "P1", order: 2 },
    ];
    const summaryOf = (nodeId: string): SourceDescriptor => ({
      id: `reference:summary--${nodeId}.md`,
      kind: "summary",
      title: nodeId,
      path: `/reference/summary--${nodeId}.md`,
      summarises: nodeId,
      authority: "derived",
      freshness: "current",
    });
    const asked = expect.stringContaining(
      "Summarise this part of the manuscript.",
    );
    const panel = (
      overrides: Record<string, unknown> = {},
      quote: string | null = null,
      onQuote = vi.fn(),
    ) => {
      const assistant = fakeAssistant(snapshot(record("editorial")), {
        listSources: vi.fn(async () => BOOK),
        summaries: { run: vi.fn(async () => "started" as const) },
        ...overrides,
      });
      render(<AiPanel assistant={assistant} quote={quote} onQuote={onQuote} />);
      return assistant;
    };

    it("runs on part or a Part's title, and asks the open Section's own", async () => {
      const assistant = panel();
      await settled();
      runCommand("/summarise part");
      await waitFor(() =>
        expect(assistant.summaries.run).toHaveBeenLastCalledWith({
          kind: "part",
        }),
      );
      runCommand("/summarise Book One");
      await waitFor(() =>
        expect(assistant.summaries.run).toHaveBeenLastCalledWith({
          kind: "node",
          nodeId: "P1",
        }),
      );
      // Where the writer is: the plain question, never the refusal.
      runCommand("/summarise Opening");
      await waitFor(() =>
        expect(assistant.send).toHaveBeenCalledWith(asked, undefined, {
          skill: "summarise",
        }),
      );
      // Another Section's title goes to the run, which refuses it.
      runCommand("/summarise Future");
      await waitFor(() =>
        expect(assistant.summaries.run).toHaveBeenLastCalledWith({
          kind: "node",
          nodeId: "S2",
        }),
      );
      expect(assistant.summaries.run).toHaveBeenCalledTimes(3);
      expect(assistant.reviews.run).not.toHaveBeenCalled();
    });

    it("keeps a quote unsent for section, and sends it with a bare /summarise", async () => {
      const onQuote = vi.fn();
      const assistant = panel({}, "A line.", onQuote);
      await settled();
      runCommand("/summarise section");
      await waitFor(() =>
        expect(assistant.send).toHaveBeenCalledWith(asked, undefined, {
          skill: "summarise",
        }),
      );
      // The whole Section was asked about: the quote is left where it is.
      expect(onQuote).not.toHaveBeenCalledWith(null);
      runCommand("/summarise");
      await waitFor(() =>
        expect(assistant.send).toHaveBeenLastCalledWith(asked, "A line.", {
          skill: "summarise",
        }),
      );
      expect(onQuote).toHaveBeenCalledWith(null);
      expect(assistant.summaries.run).not.toHaveBeenCalled();
    });

    // The whole Section was asked about, so the quote never left: a refusal
    // gives the words back and leaves the quote where it is.
    it("keeps the quote when /summarise section is refused", async () => {
      const onQuote = vi.fn();
      const assistant = panel(
        { send: vi.fn(async () => "rejected" as const) },
        "A line.",
        onQuote,
      );
      await settled();
      runCommand("/summarise section");
      await waitFor(() =>
        expect(
          (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
        ).toBe("/summarise section"),
      );
      expect(assistant.send).toHaveBeenCalled();
      expect(onQuote).not.toHaveBeenCalledWith(null);
    });

    it("gives a refused /summarise part its words back", async () => {
      panel({ summaries: { run: vi.fn(async () => "rejected" as const) } });
      await settled();
      runCommand("/summarise part");
      await waitFor(() =>
        expect(
          (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
        ).toBe("/summarise part"),
      );
    });

    it("says what a Part's account sends, counting the summaries it writes", async () => {
      const current = record("editorial");
      current.preferences.model = { providerId: "relayed", modelId: "m" };
      const relayed = {
        relayed: {
          connected: true,
          state: "ready" as const,
          notice: null,
          waitUntil: null,
          limitUsd: 5,
          upstreamHost: "openrouter.ai",
        },
      };
      const listed = { list: BOOK };
      const assistant = fakeAssistant(snapshot(current), {
        listSources: vi.fn(async () => listed.list),
      });
      render(
        <AiPanel
          assistant={assistant}
          quote={null}
          onQuote={vi.fn()}
          remoteProviders={relayed}
        />,
      );
      await settled();
      const field = screen.getByLabelText("dock.ask");
      const notice = () => screen.queryByText(/Transit/)?.textContent;
      fireEvent.change(field, { target: { value: "/summarise part" } });
      // Neither Section has a summary: both leave whole, and it says two.
      expect(notice()).toBe(
        'dock.summarisePart.remoteTransit:{"provider":"openrouter.ai","count":2}',
      );
      fireEvent.change(field, { target: { value: "/summarise Book One" } });
      expect(notice()).toContain("dock.summarisePart.remoteTransit:");
      // A question sends what a question sends; a refusal sends nothing.
      for (const line of [
        "/summarise",
        "/summarise Opening",
        "/summarise Future",
      ]) {
        fireEvent.change(field, { target: { value: line } });
        expect(notice()).toBeUndefined();
      }
    });

    it("keeps the whole-Sections clause with no number when none is to write", async () => {
      const current = record("editorial");
      current.preferences.model = { providerId: "relayed", modelId: "m" };
      render(
        <AiPanel
          assistant={fakeAssistant(snapshot(current), {
            listSources: vi.fn(async () => [
              ...BOOK,
              summaryOf("S1"),
              summaryOf("S2"),
            ]),
          })}
          quote={null}
          onQuote={vi.fn()}
          remoteProviders={{
            relayed: {
              connected: true,
              state: "ready" as const,
              notice: null,
              waitUntil: null,
              limitUsd: 5,
              upstreamHost: "openrouter.ai",
            },
          }}
        />,
      );
      await settled();
      fireEvent.change(screen.getByLabelText("dock.ask"), {
        target: { value: "/summarise part" },
      });
      // "the 0 Sections" is not a sentence, and the clause stays, because a
      // summary can go out of date between the notice and Enter.
      expect(screen.queryByText(/Transit/)?.textContent).toBe(
        'dock.summarisePart.remoteTransitAny:{"provider":"openrouter.ai"}',
      );
    });

    // The count comes from the panel's listing, which is not re-read while
    // the writer types, while the run re-lists. So the notice never names
    // fewer whole Sections than a run started now sends: overstating is the
    // safe direction.
    it("never names fewer whole Sections than a run started now would send", async () => {
      const current = record("editorial");
      current.preferences.model = { providerId: "relayed", modelId: "m" };
      const listed = { list: [...BOOK, summaryOf("S1")] };
      render(
        <AiPanel
          assistant={fakeAssistant(snapshot(current), {
            listSources: vi.fn(async () => listed.list),
          })}
          quote={null}
          onQuote={vi.fn()}
          remoteProviders={{
            relayed: {
              connected: true,
              state: "ready" as const,
              notice: null,
              waitUntil: null,
              limitUsd: 5,
              upstreamHost: "openrouter.ai",
            },
          }}
        />,
      );
      await settled();
      // The writer types in "Opening": its summary is out of date now, and
      // nothing re-lists on a keystroke.
      listed.list = [...BOOK, { ...summaryOf("S1"), freshness: "outdated" }];
      fireEvent.change(screen.getByLabelText("dock.ask"), {
        target: { value: "/summarise part" },
      });
      // Both Sections leave whole if Enter is pressed now: the notice may say
      // two, or any, but never one.
      expect([
        'dock.summarisePart.remoteTransitAny:{"provider":"openrouter.ai"}',
        'dock.summarisePart.remoteTransit:{"provider":"openrouter.ai","count":2}',
      ]).toContain(screen.queryByText(/Transit/)?.textContent);
    });
  });

  it("says what a /map sends before it is sent, on a relay model only", () => {
    // The titles, summaries and project facts go to the vendor, so the
    // writer is told at the point of asking.
    const current = record("general");
    current.preferences.model = { providerId: "relayed", modelId: "m" };
    const relayed = {
      relayed: {
        connected: true,
        state: "ready" as const,
        notice: null,
        waitUntil: null,
        limitUsd: 5,
        upstreamHost: "openrouter.ai",
      },
    };
    const { rerender } = render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={relayed}
      />,
    );
    const field = screen.getByLabelText("dock.ask");
    const notice = () => screen.queryByText(/Transit/)?.textContent;
    fireEvent.change(field, { target: { value: "/map" } });
    expect(notice()).toBe(
      // The count is the engine's cap, read, never copied.
      `dock.map.remoteTransit:{"provider":"openrouter.ai","count":${MAP_ANCHORS_MAX}}`,
    );
    fireEvent.change(field, { target: { value: "/map part" } });
    expect(notice()).toContain("dock.map.remoteTransit");
    // Only one notice at a time: never the review's beside the map's.
    expect(screen.queryAllByText(/Transit/)).toHaveLength(1);
    // A Section map sends the Section itself, whole, and says so.
    fireEvent.change(field, { target: { value: "/map section" } });
    expect(notice()).toBe(
      'dock.map.remoteTransitSection:{"provider":"openrouter.ai"}',
    );
    fireEvent.change(field, { target: { value: "map the book" } });
    expect(notice()).toBeUndefined();

    rerender(
      <AiPanel
        assistant={fakeAssistant(snapshot(record("general")))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={relayed}
      />,
    );
    fireEvent.change(screen.getByLabelText("dock.ask"), {
      target: { value: "/map" },
    });
    expect(notice()).toBeUndefined();
  });

  it("says a Section's title sends the Section whole, and a Part's the map's list", async () => {
    // Chosen from the parse, so the notice and the run read one answer to
    // "is this a Section".
    const current = record("general");
    current.preferences.model = { providerId: "relayed", modelId: "m" };
    const listSources = vi.fn(async () => [
      {
        id: "node:P1",
        nodeId: "P1",
        nodeKind: "part" as const,
        kind: "manuscript" as const,
        title: "Beginnings",
        path: "/document/beginnings.md",
        order: 0,
        authority: "manuscript" as const,
      },
      {
        id: "node:S1",
        nodeId: "S1",
        nodeKind: "section" as const,
        partId: "P1",
        kind: "manuscript" as const,
        title: "Opening",
        path: "/document/opening.md",
        order: 1,
        authority: "manuscript" as const,
      },
    ]);
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current), { listSources })}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={{
          relayed: {
            connected: true,
            state: "ready" as const,
            notice: null,
            waitUntil: null,
            limitUsd: 5,
            upstreamHost: "openrouter.ai",
          },
        }}
      />,
    );
    await waitFor(() => expect(listSources).toHaveBeenCalled());
    const field = screen.getByLabelText("dock.ask");
    fireEvent.change(field, { target: { value: "/map Opening" } });
    expect(
      await screen.findByText(
        'dock.map.remoteTransitSection:{"provider":"openrouter.ai"}',
      ),
    ).toBeTruthy();
    fireEvent.change(field, { target: { value: "/map Beginnings" } });
    expect(
      await screen.findByText(
        `dock.map.remoteTransit:{"provider":"openrouter.ai","count":${MAP_ANCHORS_MAX}}`,
      ),
    ).toBeTruthy();
  });

  it("counts a /map's steps as it goes", () => {
    const current = record("general");
    render(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(current),
          running: true,
          runProgress: { work: "map", complete: 1, total: 3 },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(liveRegion()?.textContent).toBe(
      'dock.mapProgress:{"complete":1,"count":3}',
    );
  });

  it("counts a plan of no steps as one, never 0 of 0", () => {
    // i18next picks `_other` for 0, and a `/map` with no units publishes a
    // total of 0: the bare `_one` line is the true one.
    const current = record("general");
    render(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(current),
          running: true,
          runProgress: { work: "review", complete: 0, total: 0 },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(liveRegion()?.textContent).toBe(
      'dock.reviewProgress:{"complete":0,"count":1}',
    );
  });

  it("names the model and the scope words a /map refusal is about", () => {
    const current = record("general");
    render(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(current),
          problem: { kind: "map-needs-tools", model: "Tiny chat model" },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/dock\.problem\.map-needs-tools/).textContent,
    ).toContain("Tiny chat model");
    cleanup();
    render(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(current),
          problem: { kind: "map-no-part" },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    // The scope word reaches the refusal that teaches it.
    expect(
      screen.getByText(/dock\.problem\.map-no-part/).textContent,
    ).toContain('"section":"section"');
    cleanup();
    render(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(current),
          problem: { kind: "map-no-parts" },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    // A refusal that teaches the structure words gets them from the
    // parser's own table, in the scope language.
    expect(
      screen.getByText(/dock\.problem\.map-no-parts/).textContent,
    ).toContain('"herosjourney":"hero"');
  });

  it("picks the too-long refusal that offers the Part only when there is one", () => {
    const current = record("general");
    for (const [offersPart, key] of [
      [true, /dock\.problem\.map-section-too-long:/],
      [false, /dock\.problem\.map-section-too-long-no-part/],
    ] as const) {
      render(
        <AiPanel
          assistant={fakeAssistant({
            ...snapshot(current),
            problem: {
              kind: "map-section-too-long",
              model: "Tiny chat model",
              offersPart,
            },
          })}
          quote={null}
          onQuote={vi.fn()}
        />,
      );
      expect(screen.getByText(key).textContent).toContain("Tiny chat model");
      cleanup();
    }
  });

  it("draws no pencil on a /map or /where question", () => {
    // `editTurn` refuses a workflow's question: an edit
    // would send "/map" to the model as words, so there is nothing to offer.
    const current = record("general");
    const pair = (runId: string, text: string, answer: object) => [
      {
        id: `${runId}-asked`,
        runId,
        role: "user" as const,
        text,
        createdAt: stamp,
        outcome: "complete" as const,
      },
      {
        id: `${runId}-answer`,
        runId,
        role: "assistant" as const,
        text: "Answer",
        createdAt: stamp,
        outcome: "complete" as const,
        ...answer,
      },
    ];
    const coverage = { intended: 1, inspected: 1, skipped: [], complete: true };
    current.turns = [
      ...pair("run-map", "/map", {
        mapped: {
          shape: null,
          scope: { kind: "structure" },
          structureRevision: "r",
          nodes: [],
          coverage,
        },
      }),
      ...pair("run-where", "/where the crash", {
        located: { matches: [], coverage },
      }),
      ...pair("run-ask", "A question", {}),
    ];
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current))}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    // Only the plain question can be edited.
    expect(screen.getAllByLabelText("dock.editQuestion")).toHaveLength(1);
  });

  it("composes an edited command line as the composer does", async () => {
    // An edit to "/summarise" sends the rubric and remembers the line typed,
    // never the bare words "/summarise".
    const current = record("editorial");
    current.turns = [
      {
        id: "asked",
        runId: "run",
        role: "user",
        text: "A question",
        createdAt: stamp,
        outcome: "complete",
      },
      {
        id: "answer",
        runId: "run",
        role: "assistant",
        text: "Answer",
        createdAt: stamp,
        outcome: "complete",
      },
    ];
    const editTurn = vi.fn(async () => "started" as const);
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current), {
          edits: { edit: editTurn },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const edit = (line: string) => {
      fireEvent.click(screen.getByLabelText("dock.editQuestion"));
      const field = screen.getByRole("textbox", { name: "dock.editQuestion" });
      fireEvent.change(field, { target: { value: line } });
      fireEvent.keyDown(field, { key: "Enter" });
    };

    edit("/summarise");
    await waitFor(() => expect(editTurn).toHaveBeenCalledTimes(1));
    expect(editTurn).toHaveBeenCalledWith(
      "asked",
      expect.stringContaining("Summarise this part of the manuscript."),
      { skill: "summarise" },
    );

    // A plain edit is the writer's words, with nothing remembered beside them.
    edit("Another question");
    await waitFor(() => expect(editTurn).toHaveBeenCalledTimes(2));
    expect(editTurn).toHaveBeenLastCalledWith(
      "asked",
      "Another question",
      undefined,
    );
  });

  it("edits a quoted question into /summarise section without its quote", async () => {
    // Typed, `section` reads the whole Section and leaves a quote unsent;
    // edited, the same line must too (`passageFor`), while a bare
    // `/summarise` keeps the turn's quote, as typed.
    const current = record("editorial");
    current.turns = [
      {
        id: "asked",
        runId: "run",
        role: "user",
        text: "A question",
        quote: "A line.",
        createdAt: stamp,
        outcome: "complete",
      },
      {
        id: "answer",
        runId: "run",
        role: "assistant",
        text: "Answer",
        createdAt: stamp,
        outcome: "complete",
      },
    ];
    const editTurn = vi.fn(async () => "started" as const);
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current), {
          edits: { edit: editTurn },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const edit = (line: string) => {
      fireEvent.click(screen.getByLabelText("dock.editQuestion"));
      const field = screen.getByRole("textbox", { name: "dock.editQuestion" });
      fireEvent.change(field, { target: { value: line } });
      fireEvent.keyDown(field, { key: "Enter" });
    };
    const rubric = expect.stringContaining(
      "Summarise this part of the manuscript.",
    );
    edit("/summarise section");
    await waitFor(() => expect(editTurn).toHaveBeenCalledTimes(1));
    expect(editTurn).toHaveBeenCalledWith(
      "asked",
      rubric,
      { skill: "summarise" },
      { withoutQuote: true },
    );
    // The open Section's own title is `section` too.
    edit("/summarise Opening");
    await waitFor(() => expect(editTurn).toHaveBeenCalledTimes(2));
    expect(editTurn).toHaveBeenLastCalledWith(
      "asked",
      rubric,
      { skill: "summarise" },
      { withoutQuote: true },
    );
    edit("/summarise");
    await waitFor(() => expect(editTurn).toHaveBeenCalledTimes(3));
    expect(editTurn).toHaveBeenLastCalledWith("asked", rubric, {
      skill: "summarise",
    });
  });

  // `editedQuestion` answers null for a bare text-taking command with no
  // quote, a line the composer would hold, and `onEdit` answers false for it,
  // so `AiTurn` keeps the box open with the line in it rather than throwing
  // the edit away.
  it("holds a bare /how-to-say edit in the edit box, as the composer holds it", async () => {
    const current = record("editorial");
    current.turns = [
      {
        id: "asked",
        runId: "run",
        role: "user",
        text: "A question",
        createdAt: stamp,
        outcome: "complete",
      },
      {
        id: "answer",
        runId: "run",
        role: "assistant",
        text: "Answer",
        createdAt: stamp,
        outcome: "complete",
      },
    ];
    const editTurn = vi.fn(async () => "started" as const);
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current), {
          edits: { edit: editTurn },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("dock.editQuestion"));
    const field = screen.getByRole("textbox", { name: "dock.editQuestion" });
    fireEvent.change(field, { target: { value: "/how-to-say" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(editTurn).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("textbox", {
          name: "dock.editQuestion",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("/how-to-say");
  });

  it("keeps an over-long /how-to-say edit in its box while the assistant says why", async () => {
    // The assistant refuses it before the rewind and publishes the reason;
    // the box keeps the words, as the composer gives them back.
    const current = record("general");
    current.turns = [
      {
        id: "asked",
        runId: "run",
        role: "user",
        text: "A question",
        createdAt: stamp,
        outcome: "complete",
      },
      {
        id: "answer",
        runId: "run",
        role: "assistant",
        text: "Answer",
        createdAt: stamp,
        outcome: "complete",
      },
    ];
    const editTurn = vi.fn(async () => "rejected" as const);
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current), {
          edits: { edit: editTurn },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const long = `/how-to-say ${"x".repeat(QUESTION_ARGUMENT_MAX + 1)}`;
    fireEvent.click(screen.getByLabelText("dock.editQuestion"));
    const field = screen.getByRole("textbox", { name: "dock.editQuestion" });
    fireEvent.change(field, { target: { value: long } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(editTurn).toHaveBeenCalledTimes(1));
    expect(
      (
        screen.getByRole("textbox", {
          name: "dock.editQuestion",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(long);
  });

  describe("/how-to-say", () => {
    const relay = {
      relayed: {
        connected: true,
        state: "ready" as const,
        notice: null,
        waitUntil: null,
        limitUsd: 5,
        upstreamHost: "openrouter.ai",
      },
    };

    it("holds a bare one, and asks with the writer's words last", async () => {
      const current = record("general");
      const assistant = fakeAssistant(snapshot(current));
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      const field = screen.getByLabelText("dock.ask") as HTMLTextAreaElement;
      runCommand("/how-to-say   ");
      expect(assistant.send).not.toHaveBeenCalled();
      expect(field.value).toBe("/how-to-say   ");

      runCommand("/how-to-say  when you can't face it ");
      await waitFor(() => expect(assistant.send).toHaveBeenCalledTimes(1));
      expect(assistant.send).toHaveBeenCalledWith(
        expect.stringMatching(/\n\nMEANING: "when you can't face it"$/),
        undefined,
        { skill: "how-to-say", argument: "when you can't face it" },
      );
    });

    it("takes a quote as its words, bare", async () => {
      // Over a quote, Enter already sends: the quote is the argument.
      const current = record("drafting");
      const assistant = fakeAssistant(snapshot(current));
      render(
        <AiPanel
          assistant={assistant}
          quote="she sighed, again"
          onQuote={vi.fn()}
        />,
      );
      runCommand("/how-to-say");
      await waitFor(() => expect(assistant.send).toHaveBeenCalledTimes(1));
      const [text, quote, command] = vi.mocked(assistant.send).mock.calls[0];
      expect(text).not.toContain("MEANING:");
      expect(quote).toBe("she sighed, again");
      expect(command).toEqual({ skill: "how-to-say" });
    });

    it("gives the words back when the description is refused", async () => {
      const current = record("editorial");
      const assistant = fakeAssistant(snapshot(current), {
        send: vi.fn(async () => "rejected" as const),
      });
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      const field = screen.getByLabelText("dock.ask") as HTMLTextAreaElement;
      const long = `/how-to-say ${"x".repeat(501)}`;
      runCommand(long);
      await waitFor(() => expect(field.value).toBe(long));
    });

    it("is not a command in a reader chat", async () => {
      // Offered in General, Drafting and Editorial only, so a reader chat
      // asks the line as words, with no rubric behind it.
      const current = record("beta-reader");
      const assistant = fakeAssistant(snapshot(current));
      render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
      runCommand("/how-to-say a sigh");
      await waitFor(() => expect(assistant.send).toHaveBeenCalledTimes(1));
      expect(assistant.send).toHaveBeenCalledWith(
        "/how-to-say a sigh",
        undefined,
      );
    });

    it("says nothing about transit on a relay model: it sends what a question sends", () => {
      const current = record("editorial");
      current.preferences.model = { providerId: "relayed", modelId: "m" };
      render(
        <AiPanel
          assistant={fakeAssistant(snapshot(current))}
          quote={null}
          onQuote={vi.fn()}
          remoteProviders={relay}
        />,
      );
      const field = screen.getByLabelText("dock.ask");
      fireEvent.change(field, { target: { value: "/how-to-say a sigh" } });
      expect(screen.queryByText(/Transit/)).toBeNull();
      // The same field on a command that does send more says so, so the
      // silence above is the command's and not the fixture's.
      fireEvent.change(field, { target: { value: "/continuity" } });
      expect(screen.queryByText(/Transit/)).not.toBeNull();
    });
  });

  it("says what a review sends before it is sent, on a relay model only", () => {
    // A Part or the Structure goes to the vendor in bulk. A review of one
    // Section says so too: it sends the Section and the command's references
    // in full, which a question never attaches.
    const current = record("editorial");
    current.preferences.model = { providerId: "relayed", modelId: "m" };
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={{
          relayed: {
            connected: true,
            state: "ready" as const,
            notice: null,
            waitUntil: null,
            limitUsd: 5,
            upstreamHost: "openrouter.ai",
          },
        }}
      />,
    );
    const field = screen.getByLabelText("dock.ask");
    const notice = () => screen.queryByText(/dock\.reviewTransit/)?.textContent;
    // A fact check reads the book into its ledgers at any scope.
    fireEvent.change(field, { target: { value: "/continuity" } });
    expect(notice()).toBe(
      'dock.reviewTransit.facts:{"provider":"openrouter.ai"}',
    );
    fireEvent.change(field, { target: { value: "/line-editing" } });
    expect(notice()).toBe(
      'dock.reviewTransit.section:{"provider":"openrouter.ai"}',
    );
    // A question attaches nothing the writer did not point at.
    fireEvent.change(field, { target: { value: "Is the gate green?" } });
    expect(notice()).toBeUndefined();
    fireEvent.change(field, { target: { value: "/continuity parte" } });
    expect(notice()).toBe(
      'dock.reviewTransit.facts:{"provider":"openrouter.ai"}',
    );
    fireEvent.change(field, { target: { value: "/sensitivity structure" } });
    expect(notice()).toBe(
      'dock.reviewTransit.withSummaries:{"provider":"openrouter.ai"}',
    );
    // Line editing sweeps the Sections and sends no summary.
    fireEvent.change(field, { target: { value: "/line-editing part" } });
    expect(notice()).toBe(
      'dock.reviewTransit.sections:{"provider":"openrouter.ai"}',
    );
    // A word the command does not take is a question, and says nothing.
    fireEvent.change(field, { target: { value: "/line-editing structure" } });
    expect(notice()).toBeUndefined();
  });

  it("offers a refused Part review the next scope word, in the interface's spelling", () => {
    const current = record("editorial");
    render(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(current),
          problem: { kind: "review-no-part" },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/dock\.problem\.review-no-part/).textContent,
    ).toContain('"structure":"structure"');
    cleanup();
    ui.language = "it";
    try {
      render(
        <AiPanel
          assistant={fakeAssistant({
            ...snapshot(current),
            problem: { kind: "review-no-part-no-structure" },
          })}
          quote={null}
          onQuote={vi.fn()}
        />,
      );
      expect(
        screen.getByText(/dock\.problem\.review-no-part/).textContent,
      ).toContain('"section":"sezione"');
    } finally {
      ui.language = "en";
    }
  });

  it("names the model a /where refusal is about", () => {
    const current = record("general");
    const assistant = fakeAssistant({
      ...snapshot(current),
      problem: { kind: "where-needs-tools", model: "Tiny chat model" },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    expect(
      screen.getByText(/dock\.problem\.where-needs-tools/).textContent,
    ).toContain("Tiny chat model");
  });

  it("renders receipts, token use, queue progress, localized failures, and stop", () => {
    const current = record();
    current.turns = [
      {
        id: "user",
        role: "user",
        text: "Question",
        quote: "A line",
        createdAt: stamp,
        outcome: "complete",
      },
      {
        id: "assistant",
        role: "assistant",
        text: "Answer",
        createdAt: stamp,
        outcome: "complete",
        personaId: DEFAULT_PERSONA.id,
        sources: [
          {
            ...must(sources[0]),
            reason: "default",
            coverage: "full-text",
            characters: 20,
          },
        ],
        usage: { steps: 1, inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      },
    ];
    const assistant = fakeAssistant({
      ...snapshot(current),
      running: true,
      queued: 2,
      error: "technical message",
      errorCode: "connection",
      runProgress: { work: "review", complete: 1, total: 3 },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    expect(screen.getByText("A line")).toBeTruthy();
    // Both of these are facts on the turn's one footer line, not elements of
    // their own.
    const footer =
      document.querySelector(".msg-assistant .ai-turn-facts")?.textContent ??
      "";
    expect(footer).toContain('dock.sourcesUsed:{"count":1}');
    expect(footer).toContain("dock.tokenUsage");
    expect(screen.getByText(/dock.queued/)).toBeTruthy();
    // The panel hands the provider host to every failure line,
    // so the mock prints it after the key.
    expect(screen.getByText(/^dock.modelError.connection/)).toBeTruthy();
    expect(liveRegion()?.textContent).toContain("dock.reviewProgress");
    fireEvent.click(screen.getByLabelText("dock.stop"));
    expect(assistant.stop).toHaveBeenCalled();
  });

  it("sends quotes and keyboard submissions through the application port", () => {
    // The path under every question, with or without the writer's selection
    // attached. There are no suggestion chips: the editorial readings are
    // typed commands.
    const used = vi.fn();
    const assistant = fakeAssistant(snapshot(record()));
    const { rerender } = render(
      <AiPanel assistant={assistant} quote={null} onQuote={used} />,
    );
    const composer = screen.getByLabelText("dock.ask");
    fireEvent.change(composer, { target: { value: "My question" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(assistant.send).toHaveBeenCalledWith("My question", undefined);

    rerender(
      <AiPanel assistant={assistant} quote="Selected prose" onQuote={used} />,
    );
    const withQuote = screen.getByLabelText("dock.ask");
    fireEvent.change(withQuote, { target: { value: "About this line" } });
    fireEvent.keyDown(withQuote, { key: "Enter" });
    expect(assistant.send).toHaveBeenCalledWith(
      "About this line",
      "Selected prose",
    );
    fireEvent.click(screen.getByLabelText("dock.dropQuote"));
    expect(used).toHaveBeenCalled();
  });

  it("renders findings with evidence and writer actions", async () => {
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "Review done.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        findings: [
          {
            id: "f1",
            severity: "major",
            title: "Gate timing",
            explanation: "The state changes twice.",
            uncertainty: "If the dawn scene is a flashback, this is fine.",
            evidence: [
              { sourceId: "node:S1", quote: "the gate opens at dawn" },
            ],
            status: "open",
          },
        ],
        coverage: {
          intended: 3,
          inspected: 1,
          skipped: [{ sourceId: "node:S2", reason: "not-read" }],
          complete: false,
        },
      },
    ];
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    expect(screen.getByText("dock.severity.major")).toBeTruthy();
    expect(screen.getByText("Gate timing")).toBeTruthy();
    fireEvent.click(screen.getByText("the gate opens at dawn"));
    await waitFor(() =>
      expect(assistant.sources.revealEvidence).toHaveBeenCalledWith({
        sourceId: "node:S1",
        quote: "the gate opens at dawn",
      }),
    );
    fireEvent.click(screen.getByText("dock.finding.resolve"));
    expect(assistant.sources.updateFindingStatus).toHaveBeenCalledWith(
      "t1",
      "f1",
      "resolved",
    );
    fireEvent.click(screen.getByText("dock.finding.dismiss"));
    expect(assistant.sources.updateFindingStatus).toHaveBeenCalledWith(
      "t1",
      "f1",
      "dismissed",
    );
    // On the line rather than behind the caret — a run that could not read
    // what it meant to is the receipt nobody would think to go looking for.
    expect(
      document.querySelector(".msg-assistant .ai-turn-facts")?.textContent,
    ).toContain("dock.coverage");
  });

  it("offers Resume for a pending review and a fresh chat for contamination", async () => {
    const current = record("editorial");
    const assistant = fakeAssistant({
      ...snapshot(current),
      pendingReview: {
        runId: "run-1",
        task: "continuity",
        complete: 1,
        total: 3,
      },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    // The offer rides in the asking stack with the other transient rows, so
    // a review that stopped part way needs no button to get back to.
    await settled();
    fireEvent.click(screen.getByText(/dock\.resumeReview/));
    expect(assistant.reviews.resume).toHaveBeenCalledWith("run-1");

    const blocked = fakeAssistant({
      ...snapshot(record("alpha-reader")),
      problem: { kind: "reader-contaminated" },
    });
    cleanup();
    render(<AiPanel assistant={blocked} quote={null} onQuote={vi.fn()} />);
    // A prefix: the mock prints a problem's values after its key.
    expect(
      screen.getByText(/^dock\.problem\.reader-contaminated/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("dock.cleanChat"));
    expect(blocked.chats.startClean).toHaveBeenCalled();
  });

  it("refuses without a persona and offers a replacement picker", async () => {
    const assistant = fakeAssistant({
      ...snapshot(record()),
      problem: { kind: "persona-missing", personaId: "gone" },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    expect(
      (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    // The replacement is chosen in the persona picker, not a second one of
    // its own: no native select, one ember remedy that opens the dialog.
    expect(document.querySelector(".ai-asking select")).toBeNull();
    const banner = must(document.querySelector(".ui-banner-attention"));
    expect(banner.textContent).toContain("dock.problem.persona-missing");
    fireEvent.click(screen.getByRole("button", { name: "dock.choosePersona" }));
    fireEvent.click(await screen.findByText(OTHER.name));
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({
      personaId: OTHER.id,
    });
  });

  it("says syncing only while the chat file is queued", async () => {
    const current = record();
    const assistant = fakeAssistant(snapshot(current));
    render(
      <AiPanel
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
        queuedPaths={new Set([`/assistant/chat--${current.id}.json`])}
      />,
    );
    // Said on the chat bar, in the controls' place, never as a foot row
    // that pushes the composer up.
    const status = must(
      screen.getByText(/dock.syncing/).closest(".ai-chatbar-status"),
    );
    expect(status.getAttribute("role")).toBe("status");
    const bar = must(status.closest(".ai-chatbar"));
    expect(bar.hasAttribute("data-syncing")).toBe(true);
    expect(document.querySelector(".dock-foot")).toBeNull();
    // The model button sits at the trailing end of the bar and names the model
    // answering, so the writer can read that fact without opening anything.
    const control = screen.getByLabelText("dock.model");
    expect(control.textContent).toBe("llama");
  });

  it("opens the list of models even with none chosen, and never the settings sheet", async () => {
    // This button chooses a model and the app's settings set one up. With
    // nothing chosen it stays a menu: a button that opened the settings sheet
    // in one state would be two controls, and would put the writer somewhere
    // they had not asked to go.
    const noModel = record();
    noModel.preferences = { ...noModel.preferences, model: null };
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(noModel), {
          listModels: vi.fn(async () => [
            { id: "qwen3:8b", providerId: "ollama" },
          ]),
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const control = screen.getByLabelText("dock.model");
    expect(control.textContent).toBe("dock.chooseModel");
    fireEvent.click(control);
    await settled();
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /qwen3/ })).toBeTruthy(),
    );
  });

  it("picks the model for the CHAT, recording which provider owns it", async () => {
    const current = record();
    const assistant = fakeAssistant(snapshot(current), {
      listModels: vi.fn(async () => [
        { id: "qwen3:8b", providerId: "ollama" },
        { id: "llama3.1:70b", providerId: "ollama" },
      ]),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    // What the model button names is what the chat recorded, and what the chat
    // recorded is what answers. There is no second store to disagree with it.
    const control = screen.getByLabelText("dock.model");
    expect(control.textContent).toBe("llama");

    fireEvent.click(control);
    await settled();
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /llama3.1/ })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /llama3.1/ }));
    // Both halves are written to the chat. A bare id would leave the next
    // reader to guess whose model it is from the spelling of its name.
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({
      model: { providerId: "ollama", modelId: "llama3.1:70b" },
    });
  });

  it("shows the chat's model when the device does not offer it, rather than hiding it", async () => {
    // A writer cannot reasonably be asked to change a setting they cannot
    // see. The chat names a model this machine has never pulled; the row is
    // there anyway, beside the ones that are.
    const current = record();
    current.preferences = {
      ...current.preferences,
      model: { providerId: "ollama", modelId: "mistral-large:123b" },
    };
    const assistant = fakeAssistant(snapshot(current), {
      listModels: vi.fn(async () => [{ id: "qwen3:8b", providerId: "ollama" }]),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("dock.model"));
    await settled();
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /qwen3/ })).toBeTruthy(),
    );
    expect(
      screen.getByRole("menuitem", { name: /mistral-large/ }),
    ).toBeTruthy();
  });

  // ── Grouping the model menu ────────────────────────────────────────────────
  //
  // The list divides on the one axis anything above the port is allowed to
  // branch on: reached on this machine, or reached over the network.
  // A writer choosing a model is choosing where their words go, and that is
  // the moment they are owed the fact.

  /** A model as the port hands it over, `kind` included. */
  function offered(id: string, providerId: string, kind: "device" | "remote") {
    return {
      id,
      providerId,
      label: id,
      kind,
      capabilities: { tools: true, structuredOutput: true },
    };
  }

  /** What the rows draw. `textContent` also picks up the announced group,
      which `Menu` gives a screen reader and keeps off the screen. */
  function drawn() {
    // `:not(.ui-visually-hidden)` rather than `:first-child` — a ticked row
    // has its glyph first, so the visible span is not always the first child.
    return [
      ...document.querySelectorAll(
        ".ui-menu button > span:not(.ui-visually-hidden)",
      ),
    ].map((node) => node.textContent);
  }

  /** The headings the model menu drew, in order. */
  function groups() {
    return [...document.querySelectorAll(".ui-menu-group")].map(
      (node) => node.textContent,
    );
  }

  it("draws no headings at all while every model is on this device", async () => {
    // Until a writer connects a remote provider the model menu draws no
    // headings: one group under one heading is a label on a list that is
    // obviously one thing.
    const assistant = fakeAssistant(snapshot(record()), {
      listModels: vi.fn(async () => [
        offered("llama", "ollama", "device"),
        offered("qwen3:8b", "ollama", "device"),
      ]),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("dock.model"));
    await settled();
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /qwen3/ })).toBeTruthy(),
    );

    expect(groups()).toEqual([]);
  });

  it("divides device from remote, device first", async () => {
    // Device first, because a model on the writer's own machine is free,
    // private and needs no account.
    const assistant = fakeAssistant(snapshot(record()), {
      listModels: vi.fn(async () => [
        offered("llama", "ollama", "device"),
        offered("a/big-model", "a-provider", "remote"),
      ]),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("dock.model"));
    await settled();
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /big-model/ })).toBeTruthy(),
    );

    expect(groups()).toEqual([
      "dock.modelGroup.device",
      "dock.modelGroup.remote",
    ]);
    expect(drawn()).toEqual(["llama", "a/big-model"]);
  });

  it("keeps each group contiguous even when the list arrives interleaved", async () => {
    // The model menu does not own the order its providers are listed in, and a
    // heading drawn twice for one group would be the visible cost of
    // depending on it.
    const assistant = fakeAssistant(snapshot(record()), {
      listModels: vi.fn(async () => [
        offered("a/one", "a-provider", "remote"),
        offered("llama", "ollama", "device"),
        offered("a/two", "a-provider", "remote"),
      ]),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("dock.model"));
    await settled();
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /a\/two/ })).toBeTruthy(),
    );

    expect(groups()).toEqual([
      "dock.modelGroup.device",
      "dock.modelGroup.remote",
    ]);
    // Alphabetical within the group.
    expect(drawn()).toEqual(["llama", "a/one", "a/two"]);
  });

  it("lists each group alphabetically, numbers and case read as a person would", async () => {
    // A provider's own order is no order a writer can predict — OpenRouter
    // lists hundreds by its own ranking — and a list read to find a name is
    // read alphabetically.
    const assistant = fakeAssistant(snapshot(record()), {
      listModels: vi.fn(async () => [
        offered("qwen3:8b", "ollama", "device"),
        offered("llama3.10", "ollama", "device"),
        offered("Gemma", "ollama", "device"),
        offered("llama3.2", "ollama", "device"),
        offered("z/zeta", "a-provider", "remote"),
        offered("a/alpha", "a-provider", "remote"),
      ]),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("dock.model"));
    await settled();
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /zeta/ })).toBeTruthy(),
    );

    // The chat's own `llama` is offered by nothing here, so it is the
    // unavailable row, last.
    expect(drawn()).toEqual([
      "Gemma",
      "llama3.2",
      "llama3.10",
      "qwen3:8b",
      "a/alpha",
      "z/zeta",
      "llama",
    ]);
  });

  it("puts the chat's own model under its own heading when nothing offers it", async () => {
    // Its kind is unknown, because nothing offering it described it, so the
    // menu says that rather than guessing from the provider id, which would
    // be `providerId === "ollama"` written in ink.
    const current = record();
    current.preferences = {
      ...current.preferences,
      model: { providerId: "a-provider", modelId: "a/retired-model" },
    };
    const assistant = fakeAssistant(snapshot(current), {
      listModels: vi.fn(async () => [offered("llama", "ollama", "device")]),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("dock.model"));
    await settled();
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: /retired-model/ }),
      ).toBeTruthy(),
    );

    expect(groups()).toEqual([
      "dock.modelGroup.device",
      "dock.modelGroup.unavailable",
    ]);
    // Last, because it is the one row that cannot answer — and it still
    // carries the tick, so the eye looking for the current model finds it.
    const rows = drawn();
    expect(rows[rows.length - 1]).toBe("a/retired-model");
  });

  it("says so when nothing answers the model list, and goes nowhere", async () => {
    // Ollama not running is not a state that deserves a dialog, and it is not
    // a reason to send the writer to a settings sheet either. The menu states
    // the fact and does nothing when pressed.
    const assistant = fakeAssistant(snapshot(record()), {
      listModels: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("dock.model"));
    await settled();
    const rows = screen.getAllByRole("menuitem");
    // The chat's own model is still listed — it is what answers — so the
    // empty-state row appears only when there is nothing at all.
    expect(rows.map((row) => row.textContent)).toEqual(["llama"]);

    cleanup();
    const noModel = record();
    noModel.preferences = { ...noModel.preferences, model: null };
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(noModel), {
          listModels: vi.fn(async () => {
            throw new Error("connection refused");
          }),
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("dock.model"));
    await settled();
    const empty = screen.getAllByRole("menuitem");
    expect(empty).toHaveLength(1);
    expect(empty[0]?.textContent).toContain("dock.noModelsInstalled");
  });

  it("collapses a closed finding and restores it", async () => {
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "Review done.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        findings: [
          {
            id: "f1",
            severity: "minor",
            title: "Closed concern",
            explanation: "Already handled.",
            evidence: [],
            status: "dismissed",
          },
        ],
      },
    ];
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    expect(screen.getByText(/dock.finding.dismissed/)).toBeTruthy();
    fireEvent.click(screen.getByText("dock.finding.restore"));
    expect(assistant.sources.updateFindingStatus).toHaveBeenCalledWith(
      "t1",
      "f1",
      "open",
    );
  });

  it("shows the preparing label, cancels queued requests, and removes unreadable chats", async () => {
    const current = record();
    const busy = fakeAssistant({
      ...snapshot(current),
      running: true,
      preparing: true,
      queued: 2,
      unreadable: [{ file: "chat--bad.json", message: "invalid-chat" }],
    });
    render(<AiPanel assistant={busy} quote={null} onQuote={vi.fn()} />);
    expect(liveRegion()?.textContent).toBe("dock.preparing");
    fireEvent.click(screen.getByText("dock.cancelQueued"));
    expect(busy.cancelQueued).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("dock.chats"));
    fireEvent.click(screen.getByText("dock.removeUnreadable"));
    expect(busy.deleteChatFile).toHaveBeenCalledWith("chat--bad.json");
  });

  it("opens the model menu UPWARDS, never over the model button itself", () => {
    // The model button is the last thing on the bar and the bar is 10px off the
    // bottom of the window. A downward menu has nowhere to go: it is clamped by
    // the viewport and comes to rest over the button that opened it, hiding the
    // current model at the moment the writer is choosing one, with the pointer
    // already resting on an item nobody picked. jsdom lays nothing out, so
    // the test pins the direction chosen; the geometry lives in `Menu`.
    const current = record();
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("dock.model"));
    expect(
      document.querySelector('.ui-menu[data-placement="above-end"]'),
    ).toBeTruthy();
  });

  it("lets the quote go at submit, and takes it back if the send is refused", async () => {
    // `send` resolves when the whole answer has streamed, so a quote released
    // on its promise would stay in the composer for the length of the answer,
    // visibly unsent and attached to whatever is typed next. It goes with the
    // text, at the same instant the text goes.
    const current = record();
    let release: (outcome: "started" | "rejected") => void = () => {};
    const held = new Promise<"started" | "rejected">((resolve) => {
      release = resolve;
    });
    const busy = fakeAssistant(snapshot(current), {
      send: vi.fn(() => held),
    });
    const onQuote = vi.fn();
    render(
      <AiPanel
        assistant={busy}
        quote={"riding a little high"}
        onQuote={onQuote}
      />,
    );
    const field = screen.getByLabelText("dock.ask");
    fireEvent.change(field, { target: { value: "Too much?" } });
    fireEvent.keyDown(field, { key: "Enter" });
    // While the run is still in flight.
    await waitFor(() => expect(onQuote).toHaveBeenCalledWith(null));
    expect(busy.send).toHaveBeenCalledWith("Too much?", "riding a little high");

    // And a refusal puts it back, because the question comes back too, and a
    // question without the passage it was about is one the writer has to
    // reassemble from memory.
    release("rejected");
    await waitFor(() =>
      expect(onQuote).toHaveBeenCalledWith("riding a little high"),
    );
  });

  it("counts the wait up, by the clock, and says it only to the eye", () => {
    // A local model answers in anything from four seconds to four minutes,
    // and "slow" and "hung" look identical without a number.
    vi.useFakeTimers();
    try {
      const current = record();
      const busy = fakeAssistant({
        ...snapshot(current),
        running: true,
        activity: { kind: "thinking" },
      });
      render(<AiPanel assistant={busy} quote={null} onQuote={vi.fn()} />);
      const clock = () => document.querySelector(".ai-elapsed")?.textContent;
      // The i18n mock prints the interpolation, so the number is assertable.
      expect(clock()).toBe('dock.elapsedSeconds:{"seconds":0}');
      act(() => void vi.advanceTimersByTime(3_000));
      expect(clock()).toBe('dock.elapsedSeconds:{"seconds":3}');
      // Past a minute it changes key rather than counting on to 63.
      act(() => void vi.advanceTimersByTime(60_000));
      expect(clock()).toBe('dock.elapsedMinutes:{"minutes":1,"seconds":3}');

      // Not in the live region: a screen reader announcing a new number every
      // second would say nothing else for the length of the answer.
      expect(liveRegion()?.textContent).toBe("dock.thinking");
      expect(liveRegion()?.textContent).not.toContain("elapsed");
      expect(
        document.querySelector(".ai-elapsed")?.closest("[aria-hidden='true']"),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says what the run is DOING, visibly, and announces it once", () => {
    // Three dots look identical at second three and at second ninety, and a
    // local model reading a long manuscript takes minutes. The sentence is
    // what tells the writer the difference between working and stuck.
    //
    // A chat run says it in the line of the turn it is writing, not under the
    // transcript: one fact, one place. Both halves are asserted: the
    // absence alone would pass with no line anywhere.
    const current = record();
    current.turns = [
      {
        id: "q",
        role: "user",
        text: "What happens?",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
      },
      {
        id: "a",
        role: "assistant",
        text: "",
        createdAt: "2026-09-16T00:00:01.000Z",
        outcome: "interrupted",
        errorCode: "interrupted",
      },
    ];
    const running = (activity: NonNullable<AssistantSnapshot["activity"]>) =>
      fakeAssistant({
        ...snapshot(current),
        running: true,
        preparing: false,
        runningChatId: current.id,
        activity,
      });
    const { rerender } = render(
      <AiPanel
        assistant={running({
          kind: "tool",
          tool: "read_source",
          subject: "The Dark",
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const turnLine = () =>
      document.querySelector(".msg-assistant .ai-turn-foot .ai-activity");
    // Visible at the foot of the turn it is writing, naming the source's
    // title, never the id it is addressed by, and not under the transcript
    // as well.
    expect(turnLine()?.textContent).toContain("dock.doing.read_source");
    expect(turnLine()?.textContent).toContain("The Dark");
    expect(document.querySelector(".ai-activity-row")).toBeNull();
    // Said once to a screen reader: the live region says it, and the line a
    // sighted reader sees is hidden from the reader that heard it.
    expect(turnLine()?.getAttribute("aria-hidden")).toBe("true");
    expect(liveRegion()?.textContent).toContain("dock.doing.read_source");

    // A tool with nothing to name falls back to the plain key. Waiting names
    // the model. Writing shows no words, because the answer arriving under
    // the line says it, and is still said to a screen reader, which cannot
    // see the prose arrive.
    for (const [activity, shown, spoken] of [
      [
        { kind: "tool", tool: "inspect_structure" },
        "dock.doing.inspect_structure",
        "dock.doing.inspect_structure",
      ],
      [
        { kind: "waiting", model: "Nemotron 3.5" },
        "Nemotron 3.5",
        "Nemotron 3.5",
      ],
      [{ kind: "thinking" }, "dock.thinking", "dock.thinking"],
      [{ kind: "writing" }, null, "dock.writing"],
    ] as const) {
      rerender(
        <AiPanel
          assistant={running(activity)}
          quote={null}
          onQuote={vi.fn()}
        />,
      );
      const label = turnLine()?.querySelector(".ai-activity-label");
      if (shown === null) expect(label).toBeNull();
      else expect(label?.textContent).toContain(shown);
      expect(turnLine()?.querySelector(".ai-elapsed")).toBeTruthy();
      expect(liveRegion()?.textContent).toContain(spoken);
    }

    // A review keeps its count instead: "4 of 31" answers how long this will
    // take, which the name of the source it happens to be on does not. It
    // has no turn to hold its line, so the line under the transcript is its.
    rerender(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(current),
          running: true,
          runProgress: { work: "review", complete: 1, total: 3 },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const during =
      document.querySelector(".ai-activity-row")?.textContent ?? "";
    expect(during).toContain("dock.reviewProgress");
    expect(during).not.toContain("The Dark");
  });

  it("gives a finished answer no live line while a review runs beside it", () => {
    // A full review marks its chat as running from its first second and
    // writes its turn only at the end, so "the last turn of the running
    // chat" is an old, finished answer for the whole review. Only a chat run
    // publishes an activity, and that is what picks the turn.
    const current = record();
    current.turns = [
      {
        id: "old",
        role: "assistant",
        text: "An old answer.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
      },
    ];
    render(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(current),
          running: true,
          runningChatId: current.id,
          runProgress: { work: "review", complete: 0, total: 3 },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(document.querySelector(".msg-assistant .ai-activity")).toBeNull();
    expect(document.querySelector(".ai-activity-row")).toBeTruthy();
  });

  it("offers retry and copy after a failed save", async () => {
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "The answer that could not be saved.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
      },
    ];
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const assistant = fakeAssistant({
      ...snapshot(current),
      saveFailedChatId: current.id,
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    expect(screen.getByText("dock.saveFailed")).toBeTruthy();
    fireEvent.click(screen.getByText("dock.retrySave"));
    expect(assistant.retrySave).toHaveBeenCalledWith(current.id);
    fireEvent.click(screen.getByText("dock.copyAnswer"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "The answer that could not be saved.",
      ),
    );
  });

  it("names a cited summary as a summary, never as its Section", async () => {
    // A summary's title is its Section's, so a cited summary named by its
    // title alone reads as the chapter itself.
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "As reference:summary--S1.md tells it.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        tools: [
          {
            callId: "c1",
            name: "read_source",
            status: "ok",
            sourceId: "reference:summary--S1.md",
          },
        ],
      },
    ];
    const assistant = fakeAssistant(snapshot(current), {
      listSources: vi.fn(async () => [
        ...sources,
        {
          id: "reference:summary--S1.md",
          kind: "summary" as const,
          title: "Opening",
          path: "/reference/summary--S1.md",
          summarises: "S1",
          authority: "derived" as const,
          freshness: "current" as const,
        },
      ]),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await waitFor(() =>
      expect(document.querySelector(".ai-cite")?.textContent).toBe(
        'dock.summaryTitle:{"title":"Opening"}',
      ),
    );
  });

  it("names a cited Guidebook page as its shelf does, never by its file stem", async () => {
    // Named by its file stem, a Guidebook page reads as "(editing-brief)".
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "The brief is empty (reference:guidebook--editing-brief.md).",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        tools: [
          {
            callId: "c1",
            name: "read_source",
            status: "ok",
            sourceId: "reference:guidebook--editing-brief.md",
          },
        ],
      },
    ];
    const assistant = fakeAssistant(snapshot(current), {
      listSources: vi.fn(async () => [
        ...sources,
        {
          id: "reference:guidebook--editing-brief.md",
          kind: "reference" as const,
          group: "guidebook",
          sectionId: "editing-brief",
          title: "editing-brief",
          path: "/reference/guidebook--editing-brief.md",
          authority: "reference" as const,
        },
      ]),
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await waitFor(() =>
      expect(document.querySelector(".ai-cite")?.textContent).toMatch(
        /^reference\.section\.guidebook\.editing-brief/,
      ),
    );
  });

  it("copies an answer's citations as the titles a person reads", async () => {
    // The stored answer keeps the model's ids; what a person copies is what
    // they read in the transcript, so every id this turn used and the
    // catalogue still lists becomes its title.
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "As node:S1 says, and node:S9 does not.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        tools: [
          {
            callId: "c1",
            name: "read_source",
            status: "ok",
            sourceId: "node:S1",
          },
        ],
      },
    ];
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const assistant = fakeAssistant({
      ...snapshot(current),
      saveFailedChatId: current.id,
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    // The catalogue arrives after mount; wait for the answer to show it.
    await waitFor(() =>
      expect(document.querySelector(".ai-cite")?.textContent).toBe("Opening"),
    );
    fireEvent.click(screen.getByText("dock.copyAnswer"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "As Opening says, and node:S9 does not.",
      ),
    );
  });

  // The panel remounts on every dock-face switch, so a panel opened or
  // returned to during a run loads the transcript's titles then. With an
  // empty title map every finding says its source is gone, every citation
  // shows its raw id, and every read in a trace loses its name.
  it("names the transcript's sources when mounted mid-run", async () => {
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "As node:S1 says.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        sources: [
          {
            id: "node:S1",
            kind: "manuscript",
            title: "Opening",
            path: "/document/opening.md",
            authority: "manuscript",
            reason: "default",
            coverage: "full-text",
            characters: 10,
          },
        ],
        findings: [
          {
            id: "f1",
            severity: "major",
            title: "Gate timing",
            explanation: "The state changes twice.",
            evidence: [{ sourceId: "node:S1", quote: "the gate opens" }],
            status: "open",
          },
        ],
      },
      {
        id: "q2",
        role: "user",
        text: "And then?",
        createdAt: "2026-09-16T00:01:00.000Z",
        outcome: "complete",
      },
    ];
    // A run is going in this chat: the writer switched to Notes and back,
    // which mounts a fresh panel over the running assistant.
    const assistant = fakeAssistant({
      ...snapshot(current),
      running: true,
      runningChatId: current.id,
      activity: { kind: "waiting", model: "Llama" },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await waitFor(() =>
      expect(document.querySelector(".ai-cite")?.textContent).toBe("Opening"),
    );
    const finding = document.querySelector(".ai-evidence small");
    expect(finding?.textContent).toContain("Opening");
    expect(finding?.textContent).not.toContain("dock.sourceGone");
  });

  it("names a background chat's failed save and keeps its Retry with it", async () => {
    const background = record();
    const active = { ...record(), id: "chat-2", title: "Another chat" };
    const assistant = fakeAssistant({
      ...snapshot(active),
      chats: [active, background],
      saveFailedChatId: background.id,
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    // The failure is not the active chat's, so the row says whose it is —
    // work in memory with nothing said is the state this app never keeps.
    expect(screen.getByText(/dock.saveFailed/).textContent).toContain(
      background.title,
    );
    fireEvent.click(screen.getByText("dock.retrySave"));
    expect(assistant.retrySave).toHaveBeenCalledWith(background.id);
  });

  it("offers no Copy for a failed chat with no answer yet", async () => {
    const fresh = record();
    const assistant = fakeAssistant({
      ...snapshot(fresh),
      saveFailedChatId: fresh.id,
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    expect(screen.getByText("dock.saveFailed")).toBeTruthy();
    // Retry alone is the remedy for a chat whose first save failed:
    // there is no answer to copy.
    expect(screen.queryByText("dock.copyAnswer")).toBeNull();
  });

  // A chat continued from one that searched starts latched, and
  // the panel hands the latch to the walk. These rows pin the panel's wiring,
  // the one place a steered link in the digest would reach the writer.
  it("draws a continued chat's model link as its words", async () => {
    const current = {
      ...record(),
      searchedBefore: true as const,
      turns: [
        {
          id: "t1",
          role: "assistant" as const,
          text: "See [the story](https://evil.example/).",
          createdAt: "2026-09-16T00:00:00.000Z",
          outcome: "complete" as const,
        },
      ],
    };
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current))}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const read = await waitFor(() => {
      const found = document.querySelector(".dock-read");
      expect(found?.textContent).toContain("the story");
      return found as HTMLElement;
    });
    expect(read.querySelector("a")).toBeNull();
  });

  it("copies a continued chat's model link as its words after a failed save", async () => {
    const current = {
      ...record(),
      searchedBefore: true as const,
      turns: [
        {
          id: "t1",
          role: "assistant" as const,
          text: "See [the story](https://evil.example/).",
          createdAt: "2026-09-16T00:00:00.000Z",
          outcome: "complete" as const,
        },
      ],
    };
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(current),
          saveFailedChatId: current.id,
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("dock.copyAnswer"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const [text] = writeText.mock.calls[0] as unknown as [string];
    expect(text).toContain("the story");
    expect(text).not.toContain("https://evil.example/");
  });

  it("offers no Copy of a /where answer's history line after a failed save", async () => {
    // A `/where` answer's text is the line kept for the model's history, ids
    // and all, and the writer reads its rows instead. The turn's own
    // Copy and the save-failure Copy share one producer, so neither puts
    // `node:` ids on the clipboard.
    const current = record();
    current.turns = [
      {
        id: "earlier",
        role: "assistant",
        text: "An earlier answer.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
      },
      {
        id: "answer",
        role: "assistant",
        text: "node:S1 · The lamp goes out.",
        createdAt: "2026-09-16T00:00:01.000Z",
        outcome: "complete",
        located: {
          matches: [{ sourceId: "node:S1", quote: "The lamp goes out." }],
          coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
        },
      },
    ];
    const assistant = fakeAssistant({
      ...snapshot(current),
      saveFailedChatId: current.id,
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    expect(screen.getByText("dock.saveFailed")).toBeTruthy();
    expect(screen.getByText("dock.retrySave")).toBeTruthy();
    // Nor does it reach past the last answer to an older one: "copy the
    // answer" over the answer the writer is looking at is a different one.
    expect(screen.queryByText("dock.copyAnswer")).toBeNull();
  });

  it("prunes a deleted chat's draft", async () => {
    const current = record();
    const onDrafts = vi.fn();
    const assistant = fakeAssistant({ ...snapshot(current), chats: [current] });
    render(
      <AiPanel
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
        drafts={{ [current.id]: "keep", "chat-gone": "stale" }}
        onDrafts={onDrafts}
      />,
    );
    // A chat that is not in the list keeps no draft: the mirror is pruned,
    // not left to leak into a later chat with the same id.
    //
    // A chat opens on its last message, so there is no remembered scroll
    // position for a dead chat to leak.
    await waitFor(() =>
      expect(onDrafts).toHaveBeenCalledWith({ [current.id]: "keep" }),
    );
  });

  it("shows the active chat's run error even when another chat's save failed", async () => {
    const background = record();
    const active = { ...record(), id: "chat-2", title: "Another chat" };
    const assistant = fakeAssistant({
      ...snapshot(active),
      chats: [active, background],
      saveFailedChatId: background.id,
      error: "Ollama is offline",
      errorCode: "connection",
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    // The strip is scoped to the active chat's save state: a stale failure in
    // another chat must not silence this chat's run error.
    expect(screen.getByText(/dock.modelError.connection/)).toBeTruthy();
  });

  it("explains a changed citation and resumes from the review turn", async () => {
    const current = record("editorial");
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "Review done.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        review: {
          runId: "run-1",
          task: "continuity",
          scope: { kind: "structure" },
        },
        findings: [
          {
            id: "f1",
            severity: "minor",
            title: "Gate timing",
            explanation: "Check it.",
            evidence: [{ sourceId: "node:S1", quote: "the gate" }],
            status: "open",
          },
        ],
      },
    ];
    const assistant = fakeAssistant(
      {
        ...snapshot(current),
        pendingReview: {
          runId: "run-1",
          task: "continuity",
          complete: 1,
          total: 3,
        },
      },
      { sources: { revealEvidence: vi.fn(async () => "changed" as const) } },
    );
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByText("the gate"));
    await waitFor(() =>
      expect(screen.getByText("dock.evidence.changed")).toBeTruthy(),
    );
    const resumeButtons = screen.getAllByText(/dock\.resumeReview/);
    fireEvent.click(must(resumeButtons[resumeButtons.length - 1]));
    expect(assistant.reviews.resume).toHaveBeenCalledWith("run-1");
  });

  // A changed-passage notice goes when the next run starts, not only on a
  // click that selects; otherwise "That passage has changed since the
  // answer" stays under the next `/map` run and its answer, about a click
  // made before it.
  it("lets a changed-passage notice go once the next run starts", async () => {
    const current = record("editorial");
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "Review done.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        review: {
          runId: "run-1",
          task: "continuity",
          scope: { kind: "structure" },
        },
        findings: [
          {
            id: "f1",
            severity: "minor",
            title: "Gate timing",
            explanation: "Check it.",
            evidence: [{ sourceId: "node:S1", quote: "the gate" }],
            status: "open",
          },
        ],
      },
    ];
    let state = snapshot(current);
    let notify = () => undefined as void;
    const assistant = fakeAssistant(state, {
      subscribe: vi.fn((listener: () => void) => {
        notify = listener;
        return () => undefined;
      }),
      getSnapshot: vi.fn(() => state),
      sources: { revealEvidence: vi.fn(async () => "changed" as const) },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByText("the gate"));
    await waitFor(() =>
      expect(screen.getByText("dock.evidence.changed")).toBeTruthy(),
    );
    act(() => {
      state = { ...state, running: true, runningChatId: current.id };
      notify();
    });
    expect(screen.queryByText("dock.evidence.changed")).toBeNull();
  });

  // A click over unsaved prose in another Section is held by the save or
  // discard question, which speaks for itself; the passage was never checked
  // and failed, so the panel says nothing of it.
  it("says nothing of a reveal held by the unsaved-prose question", async () => {
    const current = record("editorial");
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "Review done.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        review: {
          runId: "run-1",
          task: "continuity",
          scope: { kind: "structure" },
        },
        findings: [
          {
            id: "f1",
            severity: "minor",
            title: "Gate timing",
            explanation: "Check it.",
            evidence: [{ sourceId: "node:S1", quote: "the gate" }],
            status: "open",
          },
        ],
      },
    ];
    const assistant = fakeAssistant(snapshot(current), {
      sources: { revealEvidence: vi.fn(async () => "held" as const) },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByText("the gate"));
    await waitFor(() =>
      expect(assistant.sources.revealEvidence).toHaveBeenCalled(),
    );
    await settled();
    expect(screen.queryByText(/dock\.evidence\./)).toBeNull();
  });

  // The switcher has no search field: its list is short by construction,
  // and the palette already searches chats. The test pins the ordering, the
  // unreadable-date guard, and the field's absence.
  it("lists every chat and tolerates an unreadable date", async () => {
    const first = { ...record(), id: "one", title: "Alpha chat" };
    const second = {
      ...record(),
      id: "two",
      title: "Beta chat",
      updatedAt: "not-a-date",
    };
    const assistant = fakeAssistant({
      ...snapshot(first),
      chats: [first, second],
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("dock.chats"));
    const rows = () => document.querySelectorAll(".ai-switcher-open");
    expect([...rows()].map((row) => row.textContent)).toEqual([
      expect.stringContaining("Alpha chat"),
      expect.stringContaining("Beta chat"),
    ]);
    expect(screen.queryByLabelText("dock.searchChats")).toBeNull();
  });

  it("shows a review label without Resume when no plan is pending", () => {
    const current = record("editorial");
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "Review done.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        review: { runId: "run-1", task: "line", scope: { kind: "structure" } },
      },
    ];
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    expect(document.querySelector(".ai-review-link")?.textContent).toContain(
      "dock.review.line",
    );
    expect(screen.queryByText(/dock\.resumeReview/)).toBeNull();
  });

  it("reveals a search hit's turn and hands the state back", async () => {
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "Found me.",
        createdAt: stamp,
        outcome: "complete",
      },
    ];
    const assistant = fakeAssistant({
      ...snapshot(current),
      revealTurnId: "t1",
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await waitFor(() => expect(assistant.clearRevealTurn).toHaveBeenCalled());
    expect(
      document
        .querySelector('[data-turn-id="t1"]')
        ?.classList.contains("is-revealed"),
    ).toBe(true);
  });

  // A turn id is the record's own text, and a file can hold any: one that
  // reads as selector syntax is still found, and never throws.
  it("reveals a turn whose id reads as selector syntax", async () => {
    const odd = 'odd"] .x, [id';
    const current = record();
    current.turns = [
      {
        id: odd,
        role: "assistant",
        text: "Found me.",
        createdAt: stamp,
        outcome: "complete",
      },
    ];
    const assistant = fakeAssistant({
      ...snapshot(current),
      revealTurnId: odd,
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await waitFor(() => expect(assistant.clearRevealTurn).toHaveBeenCalled());
    const turn = [...document.querySelectorAll("[data-turn-id]")].find(
      (one) => one.getAttribute("data-turn-id") === odd,
    );
    expect(turn?.classList.contains("is-revealed")).toBe(true);
  });

  // A queued question refused when its turn came is given back once. The
  // panel remounts on every dock-face switch, and the same hand-back applied
  // again would put a stale line and quote over the writer's own.
  it("gives a refused queued question back once, not on every mount", async () => {
    const current = record();
    const assistant = fakeAssistant({
      ...snapshot(current),
      returned: { chatId: current.id, text: "Too far?", quote: "Old quote." },
    });
    const first = vi.fn();
    const view = render(
      <AiPanel assistant={assistant} quote={null} onQuote={first} />,
    );
    const field = () =>
      screen.getByLabelText("dock.ask") as HTMLTextAreaElement;
    await waitFor(() => expect(field().value).toBe("Too far?"));
    expect(first).toHaveBeenCalledWith("Old quote.");
    view.unmount();
    const again = vi.fn();
    render(<AiPanel assistant={assistant} quote="Mine." onQuote={again} />);
    await settled();
    expect(field().value).toBe("");
    expect(again).not.toHaveBeenCalled();
  });

  it("offers Continue in a new chat when the record nears its bound", () => {
    const current = record();
    const assistant = fakeAssistant({
      ...snapshot(current),
      continuationOffered: true,
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    fireEvent.click(screen.getByText("dock.continueChat"));
    expect(assistant.continueInNewChat).toHaveBeenCalled();
  });

  it("keeps drafts and scroll positions in the shell when it is given them", () => {
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "A long answer.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
      },
    ];
    const assistant = fakeAssistant(snapshot(current));
    const onDrafts = vi.fn();
    render(
      <AiPanel
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
        drafts={{ [current.id]: "a half-typed question" }}
        onDrafts={onDrafts}
      />,
    );
    expect(
      (screen.getByLabelText("dock.ask") as HTMLTextAreaElement).value,
    ).toBe("a half-typed question");
    fireEvent.change(screen.getByLabelText("dock.ask"), {
      target: { value: "changed" },
    });
    expect(onDrafts).toHaveBeenCalledWith({
      [current.id]: "changed",
    });
    // Scrolling reports nothing outwards. A mirror of the position in the
    // shell would be a second owner of this scroller, racing the follow
    // effect and losing on every face switch. A scroll only detaches
    // the follow.
    const messages = document.querySelector(".ai-messages");
    if (!(messages instanceof HTMLElement)) throw new Error("no transcript");
    Object.defineProperty(messages, "scrollHeight", { value: 600 });
    Object.defineProperty(messages, "clientHeight", { value: 100 });
    messages.scrollTop = 0;
    fireEvent.scroll(messages);
    expect(screen.getByLabelText("dock.jumpLatest")).toBeTruthy();
  });

  it("offers Jump to latest once the writer scrolls away from the bottom", () => {
    const current = record();
    current.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "A long answer.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
      },
    ];
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    const messages = document.querySelector(".ai-messages");
    if (!(messages instanceof HTMLElement)) throw new Error("no transcript");
    Object.defineProperty(messages, "scrollHeight", { value: 600 });
    Object.defineProperty(messages, "clientHeight", { value: 100 });
    messages.scrollTop = 0;
    fireEvent.scroll(messages);
    const jump = screen.getByLabelText("dock.jumpLatest");
    expect(jump).toBeTruthy();
    fireEvent.click(jump);
    expect(screen.queryByLabelText("dock.jumpLatest")).toBeNull();
  });

  it("opens a chat on its last message, however the writer left it", () => {
    // A conversation is read from its end, so choosing one out of the list
    // lands on what was last said in it, never on wherever the writer
    // stopped scrolling.
    const first = record();
    first.turns = [
      {
        id: "t1",
        role: "assistant",
        text: "A long answer.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
      },
    ];
    const second = { ...record(), id: "chat-2", title: "Another" };
    const assistant = fakeAssistant({
      ...snapshot(first),
      chats: [first, second],
    });
    const { rerender } = render(
      <AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />,
    );
    const messages = document.querySelector(".ai-messages");
    if (!(messages instanceof HTMLElement)) throw new Error("no transcript");
    // jsdom lays nothing out, so the transcript's height has to be asserted
    // rather than measured; the behaviour under test is only ever "put the
    // scroller at its own full height".
    Object.defineProperty(messages, "scrollHeight", { value: 600 });
    Object.defineProperty(messages, "clientHeight", { value: 100 });
    // The writer reads back through it and leaves it at the top.
    messages.scrollTop = 0;
    fireEvent.scroll(messages);
    expect(screen.getByLabelText("dock.jumpLatest")).toBeTruthy();

    // Away to another chat, and back. Both are openings.
    rerender(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(second),
          chats: [first, second],
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    rerender(
      <AiPanel
        assistant={fakeAssistant({
          ...snapshot(first),
          chats: [first, second],
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const reopened = document.querySelector(".ai-messages");
    if (!(reopened instanceof HTMLElement)) throw new Error("no transcript");
    expect(reopened.scrollTop).toBe(reopened.scrollHeight);
    // And the way back is gone, because there is nothing to go back to.
    expect(screen.queryByLabelText("dock.jumpLatest")).toBeNull();
  });

  // The button, the run and the search share one rule for what is missing.
  // `completeLocate` drops every id that is not a live manuscript
  // source, so the button does not count a Section deleted since the search.
  it("counts on the Summarise button only the Sections a click would summarise", async () => {
    const current = record();
    current.turns = [
      {
        id: "asked",
        runId: "run-where",
        role: "user",
        text: "/where when the light goes out",
        createdAt: stamp,
        outcome: "complete",
      },
      {
        id: "answer",
        runId: "run-where",
        role: "assistant",
        text: "The described moment was not found in the Sections searched.",
        createdAt: stamp,
        outcome: "complete",
        located: {
          matches: [],
          coverage: {
            intended: 3,
            inspected: 0,
            skipped: [
              // Still in the book, with no summary: a click summarises it.
              { sourceId: "node:S2", reason: "unmapped" },
              // Deleted since the search: nothing a click can summarise.
              { sourceId: "node:gone", reason: "unmapped" },
            ],
            complete: false,
          },
        },
      },
    ];
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current))}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    // `findByRole` waits for the live catalogue: the count is taken against it.
    expect(
      await screen.findByRole("button", {
        name: /dock\.where\.summariseMissing:\{"count":1\}/,
      }),
    ).toBeTruthy();
  });

  // The Review again button counts what `completeReview` would summarise: the
  // answer's rows inside the review's reach now. A Section moved out of the
  // Part since the review, or a row a chat file planted, is summarised by no
  // click, so the button does not count it.
  it("counts on a Part review's button only the Sections still in the Part", async () => {
    const current = record("editorial");
    current.turns = [
      {
        id: "answer",
        runId: "run-review",
        role: "assistant",
        text: "Completed the continuity review with 0 findings.",
        createdAt: stamp,
        outcome: "complete",
        findings: [],
        coverage: {
          intended: 2,
          inspected: 0,
          skipped: [
            { sourceId: "node:S1", reason: "unmapped" },
            { sourceId: "node:S2", reason: "unmapped" },
          ],
          complete: false,
        },
        review: {
          runId: "run-review",
          task: "continuity",
          scope: { kind: "node", nodeId: "P" },
        },
      },
    ];
    // `S1` is still in Part `P`; `S2` has moved to the top of the Structure.
    const listed: SourceDescriptor[] = [
      {
        id: "node:P",
        nodeId: "P",
        nodeKind: "part",
        kind: "manuscript",
        title: "Part",
        path: "/document/part.md",
        order: 0,
        authority: "manuscript",
      },
      ...sources.map((one) =>
        one.nodeId === "S1"
          ? { ...one, nodeKind: "section" as const, partId: "P" }
          : one.nodeId === "S2"
            ? { ...one, nodeKind: "section" as const }
            : one,
      ),
    ];
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current), {
          listSources: vi.fn(async () => listed),
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("button", {
        name: /dock\.reviewFollowUp\.summariseMissing:\{"count":1\}/,
      }),
    ).toBeTruthy();
  });

  // A wide review's button runs `completeReview` on its own answer, and is not
  // drawn while any run is going.
  it("sends a wide review's button to completeReview, and hides it while a run goes", async () => {
    const current = record("editorial");
    current.turns = [
      {
        id: "answer",
        runId: "run-review",
        role: "assistant",
        text: "Completed the continuity review with 0 findings.",
        createdAt: stamp,
        outcome: "complete",
        findings: [],
        coverage: {
          intended: 2,
          inspected: 1,
          skipped: [{ sourceId: "node:S2", reason: "unmapped" }],
          complete: false,
        },
        review: {
          runId: "run-review",
          task: "continuity",
          scope: { kind: "structure" },
        },
      },
    ];
    const completeReview = vi.fn(async () => undefined);
    const { rerender } = render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current), {
          reviews: { complete: completeReview },
        })}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: /dock\.reviewFollowUp\.summariseMissing:\{"count":1\}/,
      }),
    );
    expect(completeReview).toHaveBeenCalledWith("run-review");
    rerender(
      <AiPanel
        assistant={fakeAssistant(
          { ...snapshot(current), running: true },
          { reviews: { complete: completeReview } },
        )}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /reviewFollowUp/ })).toBeNull();
  });
});

describe("the bar's readings and the Mode row", () => {
  const reading = () =>
    [...document.querySelectorAll(".ai-reading")].map((node) => ({
      text: node.querySelector(".ai-reading-text")?.textContent,
      meter: node.querySelector(".ui-meter")?.getAttribute("class"),
    }));

  const panel = () => document.querySelector(".ai-reading-panel");

  // The chat's model as its provider describes it: Ollama's scale, which
  // names no default, so the middle of the track is its middle word.
  // The bar names a level only once the model is described.
  const LLAMA: ModelDescriptor = {
    id: "llama",
    providerId: "ollama",
    label: "llama",
    kind: "device",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: true,
      efforts: ["none", "low", "medium", "high"],
    },
  };
  const described = { listModels: vi.fn(async () => [LLAMA]) };
  // A level as the test translator prints it, with the model's own word as
  // its fallback.
  const level = (word: string) =>
    `dock.mode.effort.${word}:${JSON.stringify({ defaultValue: word })}`;

  function answered(usage: Record<string, unknown>, modelId = "llama") {
    const chat = record();
    chat.turns = [
      {
        id: "a1",
        role: "assistant",
        text: "An answer.",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
        model: { providerId: "ollama", modelId },
        usage: { steps: 1, ...usage } as never,
      },
    ];
    return chat;
  }

  it("reads how full the window was on the last answer, as a ring and a number", async () => {
    render(
      <AiPanel
        assistant={fakeAssistant(
          snapshot(answered({ contextTokens: 1_200, contextWindow: 8_000 })),
        )}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    await waitFor(() => expect(reading()).toHaveLength(1));
    expect(reading()[0].text).toBe(
      `dock.contextUsed:${JSON.stringify({ percent: 15 })}`,
    );
    expect(reading()[0].meter).toContain("ui-meter-ring");
    expect(reading()[0].meter).toContain("is-normal");
    // No browser tooltip: the sentence lives in the panel it opens.
    expect(document.querySelector(".ai-reading[title]")).toBeNull();
  });

  it("climbs the scale's colours as the window fills", async () => {
    for (const [tokens, stage] of [
      [3_600, "is-ok"],
      [5_000, "is-warning"],
      [6_600, "is-danger"],
      [7_900, "is-error"],
    ] as const) {
      render(
        <AiPanel
          assistant={fakeAssistant(
            snapshot(answered({ contextTokens: tokens, contextWindow: 8_000 })),
          )}
          quote={null}
          onQuote={vi.fn()}
        />,
      );
      await waitFor(() => expect(reading()).toHaveLength(1));
      expect(reading()[0].meter).toContain(stage);
      cleanup();
    }
  });

  it("opens the context panel on a press, with the ring and one line of figures", async () => {
    render(
      <AiPanel
        assistant={fakeAssistant(
          snapshot(answered({ contextTokens: 1_200, contextWindow: 8_000 })),
        )}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    await waitFor(() => expect(reading()).toHaveLength(1));
    const control = document.querySelector(".ai-reading");
    if (!(control instanceof HTMLElement)) throw new Error("no reading");
    expect(panel()).toBeNull();
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");

    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    const open = panel();
    expect(open?.getAttribute("role")).toBe("dialog");
    expect(open?.querySelector(".ui-meter-ring")).toBeTruthy();
    // "Context 1.2K / 8K (15%)": compact, and the percent said once.
    expect(open?.textContent).toBe(
      `dock.reading.context dock.reading.contextUsed:${JSON.stringify({ used: "1.2K", window: "8K", percent: 15 })}`,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel()).toBeNull();
  });

  it("reads nothing for another model, or for numbers a hand-edit made up", async () => {
    // After a switch, the old model's share of its window says nothing about
    // the new one; and the chat file is the writer's own, so a string or a
    // negative is not a reading.
    for (const chat of [
      answered({ contextTokens: 1_200, contextWindow: 8_000 }, "qwen3:8b"),
      answered({ contextTokens: "1200", contextWindow: 8_000 }),
      answered({ contextTokens: -5, contextWindow: 8_000 }),
      answered({ inputTokens: 1_200 }),
    ]) {
      render(
        <AiPanel
          assistant={fakeAssistant(snapshot(chat))}
          quote={null}
          onQuote={vi.fn()}
        />,
      );
      await waitFor(() =>
        expect(document.querySelector(".ai-chatbar")).toBeTruthy(),
      );
      expect(reading()).toEqual([]);
      cleanup();
    }
  });

  const credit = () =>
    [...document.querySelectorAll(".ai-reading")].find((node) =>
      /dock\.creditLeft/.test(node.textContent ?? ""),
    ) ?? null;

  function key(over: Record<string, unknown> = {}) {
    return {
      // The chat answers with `ollama` in these fixtures, so the verdict is
      // keyed there: the bar reads the key of the chat's own provider.
      ollama: {
        connected: true,
        state: "ready" as const,
        notice: null,
        waitUntil: null,
        limitUsd: 5,
        ...over,
      },
    };
  }

  it("prints the credit left as the server sent it, on a bar drawn from the server's share", async () => {
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(record()))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={key({
          spentUsd: 3.25,
          remainingUsd: 1.75,
          spentShare: 0.65,
        })}
      />,
    );
    await waitFor(() => expect(credit()).toBeTruthy());
    expect(credit()?.textContent).toBe(
      `dock.creditLeft:${JSON.stringify({ amount: "$1.75" })}`,
    );
    const bar = credit()?.querySelector(".ui-meter-bar");
    expect(bar?.classList.contains("is-warning")).toBe(true);
    expect(bar?.querySelector<HTMLElement>(".ui-meter-fill")?.style.width).toBe(
      "65%",
    );

    fireEvent.click(credit() as HTMLElement);
    const open = panel();
    expect(open?.textContent).toContain("dock.reading.creditSpent");
    expect(open?.textContent).toContain("$3.25");
    expect(open?.textContent).toContain("$1.75");
    expect(open?.textContent).toContain("$5.00");
  });

  it("names when the key stops, date and time, beside the figures", async () => {
    // Printed from the verdict's instant in the writer's own clock; never
    // compared, and left out when unreadable.
    const at = "2026-10-05T14:30:00.000Z";
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(record()))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={key({
          spentUsd: 1,
          remainingUsd: 4,
          spentShare: 0.2,
          expiresAtOrBefore: at,
        })}
      />,
    );
    await waitFor(() => expect(credit()).toBeTruthy());
    fireEvent.click(credit() as HTMLElement);
    const printed = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at));
    expect(panel()?.textContent).toContain("dock.reading.keyExpires");
    expect(panel()?.textContent).toContain(printed);
    cleanup();

    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(record()))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={key({
          spentUsd: 1,
          remainingUsd: 4,
          expiresAtOrBefore: "not a date",
        })}
      />,
    );
    await waitFor(() => expect(credit()).toBeTruthy());
    fireEvent.click(credit() as HTMLElement);
    expect(panel()?.textContent).not.toContain("dock.reading.keyExpires");
  });

  // The credit reading shares the Assistant's one money formatter, so a
  // credit under a cent is never printed as nothing left.
  it("never prints credit that is left as $0.00", async () => {
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(record()))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={key({ spentUsd: 4.996, remainingUsd: 0.004 })}
      />,
    );
    await waitFor(() => expect(credit()).toBeTruthy());
    expect(credit()?.textContent).toBe(
      `dock.creditLeft:${JSON.stringify({ amount: "$0.004" })}`,
    );
  });

  it("draws no bar the server did not send a share for", async () => {
    // The division is the verdict's: no share, no bar — the words
    // alone, never a share worked out here from the two amounts.
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(record()))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={key({ spentUsd: 1.25, remainingUsd: 3.75 })}
      />,
    );
    await waitFor(() => expect(credit()).toBeTruthy());
    expect(credit()?.querySelector(".ui-meter")).toBeNull();
  });

  it("prints no credit it would have to work out itself", async () => {
    // No reading yet, or one from an ended window: the verdict holds null,
    // and the bar does not subtract its way to a number.
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(record()))}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={key({ spentUsd: null, remainingUsd: null })}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".ai-chatbar")).toBeTruthy(),
    );
    expect(credit()).toBeNull();
  });

  it("shows the chat's live pins above the composer and unpins from there", async () => {
    // What is pinned in Context rides with every message, so it is shown
    // where the message is written.
    const current = record();
    current.preferences.pinnedSourceIds = [
      "reference:world.md",
      "unused",
      "node:S1",
    ];
    const assistant = fakeAssistant(snapshot(current));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    const pins = await screen.findByRole("list", {
      name: "dock.pinnedSources",
    });
    // In the order they were pinned, and never a chip for the id that names
    // nothing in the catalogue: it is attached to nothing.
    await waitFor(() =>
      expect(
        [...pins.querySelectorAll(".composer-pin span")].map(
          (chip) => chip.textContent,
        ),
      ).toEqual(["World", "Opening"]),
    );
    fireEvent.click(
      screen.getByLabelText(`dock.unpin:${JSON.stringify({ title: "World" })}`),
    );
    // The inert id stays where it is, as the Context dialog leaves it.
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({
      pinnedSourceIds: ["unused", "node:S1"],
    });
  });

  it("draws the Mode bar on the chat bar, in the middle for a new chat", async () => {
    const assistant = fakeAssistant(snapshot(record()), described);
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    const bar = await waitFor(() => screen.getByRole("slider"));
    expect(bar.getAttribute("aria-label")).toBe("dock.mode.label");
    expect((bar as HTMLInputElement).value).toBe("0.5");
    await waitFor(() =>
      expect(bar.getAttribute("aria-valuetext")).toBe(
        `dock.mode.valueText:${JSON.stringify({ temperature: "0.60", effort: level("low") })}`,
      ),
    );
    // The Mode bar takes the place of a temperature button.
    expect(screen.queryByLabelText("dock.temperature.label")).toBeNull();
    // On the chat bar's one line, at its trailing end beside the model button:
    // Mode first, then the model.
    const row = document.querySelector(".ai-mode");
    expect(row?.parentElement?.className).toBe("ai-chatbar-end");
    expect(row?.nextElementSibling?.getAttribute("aria-label")).toBe(
      "dock.model",
    );
  });

  it("reads the new values while dragged and stores the position once, on release", async () => {
    const assistant = fakeAssistant(snapshot(record()), described);
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    const bar = (await waitFor(() =>
      screen.getByRole("slider"),
    )) as HTMLInputElement;
    await waitFor(() =>
      expect(bar.getAttribute("aria-valuetext")).toContain("effort.low"),
    );
    // A drag is `input` events; the release is the one `change`. The
    // Creative end is the model's most.
    fireEvent.input(bar, { target: { value: "0" } });
    expect(bar.getAttribute("aria-valuetext")).toBe(
      `dock.mode.valueText:${JSON.stringify({ temperature: "0.90", effort: level("high") })}`,
    );
    // React's onChange is the drag; nothing is written until the native
    // `change` the element fires when the writer lets go.
    expect(assistant.chats.updatePreferences).not.toHaveBeenCalled();
    fireEvent.change(bar);
    expect(assistant.chats.updatePreferences).toHaveBeenCalledTimes(1);
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({ mode: 0 });
  });

  it("draws a chat's stored position, and a double-click returns it to the middle", async () => {
    const chat = record();
    chat.preferences = { ...chat.preferences, mode: 1 };
    const assistant = fakeAssistant(snapshot(chat), described);
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    const bar = (await waitFor(() =>
      screen.getByRole("slider"),
    )) as HTMLInputElement;
    expect(bar.value).toBe("1");
    // The Standard end is the least the model takes: none, on one that
    // can stop.
    await waitFor(() =>
      expect(bar.getAttribute("aria-valuetext")).toBe(
        `dock.mode.valueText:${JSON.stringify({ temperature: "0.30", effort: level("none") })}`,
      ),
    );
    expect(document.querySelector(".ai-mode-end.is-near")?.textContent).toBe(
      "dock.mode.standard",
    );
    fireEvent.doubleClick(bar);
    expect(assistant.chats.updatePreferences).toHaveBeenCalledWith({
      mode: 0.5,
    });
  });

  it("opens a caption's panel saying what its end is for, without moving the thumb", async () => {
    const assistant = fakeAssistant(snapshot(record()));
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    const standard = await waitFor(() =>
      screen.getByRole("button", { name: "dock.mode.standard" }),
    );
    fireEvent.click(standard);
    const panel = await waitFor(() => {
      const found = document.querySelector(".ai-mode-panel");
      if (!found) throw new Error("no panel yet");
      return found;
    });
    expect(panel.textContent).toContain("dock.mode.standardTitle");
    expect(panel.textContent).toContain("dock.mode.standardGoal");
    expect(assistant.chats.updatePreferences).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "dock.mode.creative" }));
    // A bare click sends no pointerdown, so the first panel is still open:
    // read every panel rather than the first one found.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".ai-mode-panel")]
          .map((node) => node.textContent)
          .join(" "),
      ).toContain("dock.mode.creativeGoal"),
    );
  });

  it("shows the values over the thumb while it is held", async () => {
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(record()), described)}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByRole("slider"));
    await waitFor(() =>
      expect(document.querySelector(".ui-slider-readout")?.textContent).toBe(
        `dock.mode.readout:${JSON.stringify({ temperature: "0.60", effort: level("low") })}`,
      ),
    );
  });

  it("names no effort for a model it has not described", async () => {
    // Which level a position means is the model's to say; before the model
    // is described, or for one offered nowhere, the bar names the
    // temperature alone rather than a level it made up.
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(record()))}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    const bar = await waitFor(() => screen.getByRole("slider"));
    expect(bar.getAttribute("aria-valuetext")).toBe(
      `dock.mode.valueTextPlain:${JSON.stringify({ temperature: "0.60", effort: "" })}`,
    );
    expect(document.querySelector(".ui-slider-readout")?.textContent).toBe(
      `dock.mode.readoutPlain:${JSON.stringify({ temperature: "0.60", effort: "" })}`,
    );
  });
});

const stamp = "2026-09-16T00:00:00.000Z";

// ── A /map answer in the panel ───────────────────────────────────────────────
//
// The live Structure is hashed with the same `structureRevision` the run
// stamps the answer with, so a map over an unchanged listing is not stale
// and a renamed Part is: the real function on both sides, not a stub.
describe("a /map answer in the panel", () => {
  const STRUCTURE: SourceDescriptor[] = [
    {
      id: "node:P1",
      nodeId: "P1",
      kind: "manuscript",
      nodeKind: "part",
      title: "Beginnings",
      path: "/document/p1",
      order: 0,
      authority: "manuscript",
    },
    {
      id: "node:S1",
      nodeId: "S1",
      kind: "manuscript",
      nodeKind: "section",
      partId: "P1",
      title: "Opening",
      path: "/document/p1/opening.md",
      order: 1,
      authority: "manuscript",
    },
  ];

  async function mapChat(
    kind: ChatKind,
    listing: SourceDescriptor[],
    skipped: MapOutcome["coverage"]["skipped"] = [],
  ) {
    const current = record(kind);
    current.turns = [
      {
        id: "asked",
        runId: "run-map",
        role: "user",
        text: "/map",
        createdAt: stamp,
        outcome: "complete",
      },
      {
        id: "answer",
        runId: "run-map",
        role: "assistant",
        text: "Mapped the manuscript on threeact.",
        createdAt: stamp,
        outcome: "complete",
        mapped: {
          kind: "arc",
          mode: "positional",
          shapeFrom: "declared",
          shape: "threeact",
          scope: { kind: "structure" },
          structureRevision: await structureRevision(STRUCTURE),
          nodes: [
            {
              sourceId: "node:P1",
              kind: "part",
              title: "Beginnings",
              standsIn: "setup",
              verdict: "fits",
              reason: "It sets up.",
            },
            {
              sourceId: "node:S1",
              kind: "section",
              parentId: "node:P1",
              title: "Opening",
              standsIn: "setup",
            },
          ],
          coverage: {
            intended: 1,
            inspected: 1 - skipped.length,
            skipped,
            complete: skipped.length === 0,
          },
        },
      },
    ];
    const listSources = vi.fn(async () => listing);
    const assistant = fakeAssistant(snapshot(current), { listSources });
    const view = render(
      <AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />,
    );
    return { assistant, current, view, listSources };
  }

  it("says nothing about staleness over the listing it was drawn from", async () => {
    await mapChat("general", STRUCTURE, [
      { sourceId: "node:S1", reason: "unmapped" },
    ]);
    // A button appears only once the fingerprint has answered — and it is the
    // summarise button, not "changed": the same Structure on both sides.
    expect(
      await screen.findByRole("button", {
        name: 'dock.map.summariseMissing:{"count":1}',
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dock.map.structureChanged")).toBeNull();
  });

  it("says the Structure changed once a Part is renamed, and maps again in place", async () => {
    const renamed = STRUCTURE.map((one) =>
      one.id === "node:P1" ? { ...one, title: "Firsts" } : one,
    );
    const { assistant } = await mapChat("editorial", renamed);
    expect(await screen.findByText("dock.map.structureChanged")).toBeTruthy();
    // The row reads the live title; the Map again button re-runs the answer's
    // own run.
    expect(screen.getByRole("button", { name: "Firsts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "dock.map.mapAgain" }));
    expect(assistant.maps.complete).toHaveBeenCalledWith("run-map");
  });

  it("hears a rename in the tree while the answer is open, with no run between", async () => {
    // The panel lists again on a tree change, not only when a run starts or
    // ends or the chat changes; otherwise a Part renamed in the tree leaves
    // the map silent, undimmed and still offering to summarise.
    const { assistant, view, listSources } = await mapChat(
      "general",
      STRUCTURE,
    );
    await screen.findByRole("button", { name: "Beginnings" });
    expect(screen.queryByText("dock.map.structureChanged")).toBeNull();
    listSources.mockImplementation(async () =>
      STRUCTURE.map((one) =>
        one.id === "node:P1" ? { ...one, title: "Firsts" } : one,
      ),
    );
    // The editor replaces its tree on a rename; the panel reads that as
    // "list again".
    view.rerender(
      <AiPanel
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
        structure={{ version: 1, children: [] }}
      />,
    );
    expect(await screen.findByText("dock.map.structureChanged")).toBeTruthy();
    expect(document.querySelector(".ai-map-figure.is-stale")).toBeTruthy();
  });

  // A Section map is dated by its Section's content, read on every re-list,
  // never by the Structure's fingerprint.
  /** A general chat holding one `/map section` answer on `S1`, at `r1`. */
  function sectionMapRecord(): ChatRecord {
    const current = record("general");
    current.turns = [
      {
        id: "asked",
        runId: "run-map",
        role: "user",
        text: "/map section three-act",
        createdAt: stamp,
        outcome: "complete",
      },
      {
        id: "answer",
        runId: "run-map",
        role: "assistant",
        text: "Mapped one Section on threeact.",
        createdAt: stamp,
        outcome: "complete",
        mapped: {
          kind: "passages",
          shape: "threeact",
          shapeFrom: "typed",
          scope: { kind: "node", nodeId: "S1" },
          sectionRevision: "r1",
          nodes: [{ sourceId: "node:S1", kind: "section", title: "Opening" }],
          passages: [
            {
              beat: "setup",
              state: "found",
              at: 0,
              anchor: {
                sourceId: "node:S1",
                quote: "It opens.",
                revision: "r1",
              },
              reason: "It opens.",
            },
            { beat: "confrontation", state: "unanswered" },
            { beat: "resolution", state: "unanswered" },
          ],
          coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
        },
      },
    ];
    return current;
  }

  it("reads a Section map's Section on each listing, and says when it changed", async () => {
    const current = sectionMapRecord();
    const sectionRevisions = vi.fn<
      (ids: readonly string[]) => Promise<Map<string, string>>
    >(async () => new Map([["node:S1", "r1"]]));
    const listSources = vi.fn(async () => STRUCTURE);
    const assistant = fakeAssistant(snapshot(current), {
      listSources,
      sources: { sectionRevisions },
    });
    const view = render(
      <AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />,
    );
    await waitFor(() =>
      expect(sectionRevisions).toHaveBeenCalledWith(["node:S1"]),
    );
    // Unchanged: the start is a button, and nothing says the Section moved.
    expect(
      await screen.findByRole("button", { name: /It opens\./ }),
    ).toBeTruthy();
    expect(screen.queryByText("dock.map.sectionChanged")).toBeNull();
    // A rename elsewhere changes the fingerprint and nothing about this map.
    listSources.mockImplementation(async () =>
      STRUCTURE.map((one) =>
        one.id === "node:P1" ? { ...one, title: "Firsts" } : one,
      ),
    );
    sectionRevisions.mockImplementation(
      async () => new Map([["node:S1", "r2"]]),
    );
    view.rerender(
      <AiPanel
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
        structure={{ version: 1, children: [] }}
      />,
    );
    expect(await screen.findByText("dock.map.sectionChanged")).toBeTruthy();
    expect(screen.queryByText("dock.map.structureChanged")).toBeNull();
    expect(
      document.querySelector(".ai-map-figure.is-ruler.is-stale"),
    ).toBeTruthy();
  });

  // A start refused because its passage changed re-reads the Section at
  // once, so the ruler dims with the refusal rather than offering starts
  // that will each be refused.
  it("re-reads a Section map's Section when a start's click is refused as changed", async () => {
    const sectionRevisions = vi.fn<
      (ids: readonly string[]) => Promise<Map<string, string>>
    >(async () => new Map([["node:S1", "r1"]]));
    const assistant = fakeAssistant(snapshot(sectionMapRecord()), {
      listSources: vi.fn(async () => STRUCTURE),
      sources: {
        sectionRevisions,
        revealEvidence: vi.fn(async () => "changed" as const),
      },
    });
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    const start = await screen.findByRole("button", { name: /It opens\./ });
    const reads = sectionRevisions.mock.calls.length;
    sectionRevisions.mockImplementation(
      async () => new Map([["node:S1", "r2"]]),
    );
    fireEvent.click(start);
    expect(await screen.findByText("dock.map.sectionChanged")).toBeTruthy();
    expect(screen.getByText("dock.evidence.changed")).toBeTruthy();
    expect(sectionRevisions.mock.calls.length).toBeGreaterThan(reads);
  });

  it("counts only what a click would summarise now", async () => {
    await mapChat("general", STRUCTURE, [
      { sourceId: "node:S1", reason: "unmapped" },
      { sourceId: "node:gone", reason: "unmapped" },
    ]);
    // The note is the answer's own record (two rows); the button counts what a
    // click would write now — `S1`, still in the listing with no summary, and
    // not the Section deleted since.
    expect(
      await screen.findByText('dock.map.noSummary:{"count":2}'),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: 'dock.map.summariseMissing:{"count":1}',
      }),
    ).toBeTruthy();
    expect(screen.queryByText("dock.map.structureChanged")).toBeNull();
  });

  it("draws none of a map a reader chat's file carries", async () => {
    await mapChat("alpha-reader", STRUCTURE);
    await screen.findByText("/map");
    expect(document.querySelector(".ai-map")).toBeNull();
    expect(screen.queryByText("Beginnings")).toBeNull();
    expect(screen.queryByText("It sets up.")).toBeNull();
  });

  it("copies a /map answer after a failed save as the answer's own Copy does", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { assistant, current } = await mapChat("general", STRUCTURE);
    cleanup();
    const failed = assistant.getSnapshot();
    render(
      <AiPanel
        assistant={fakeAssistant(
          { ...failed, saveFailedChatId: failed.chats[0]?.id ?? current.id },
          { listSources: vi.fn(async () => STRUCTURE) },
        )}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Beginnings" });
    fireEvent.click(screen.getByText("dock.copyAnswer"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const [text] = writeText.mock.calls[0] as unknown as [string];
    expect(text).toContain("Beginnings");
    expect(text).toContain("It sets up.");
    expect(text).not.toContain("node:");
    expect(text).not.toContain("Mapped the manuscript");
  });
});

// ── A search waiting on the writer ───────────────────────────────────────────
//
// A run holds before a web search until the writer decides it.

describe("AiPanel: the ask", () => {
  const ASK = {
    askId: "ask-1",
    engine: { kind: "wikipedia" as const },
    kind: "first" as const,
    rows: [{ rowId: "r0", query: "Porta Pia 1870", bookWords: false }],
  };

  /** A chat whose run is live and waiting on the writer, in `where`. */
  function waiting(
    where: "here" | "elsewhere",
    ask: NonNullable<AssistantSnapshot["pendingSearch"]> = ASK,
    extra: { open?: boolean; state?: Partial<AssistantSnapshot> } = {},
  ) {
    const current = record();
    current.turns = [
      {
        id: "t0",
        role: "user",
        text: "When was Porta Pia?",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
      },
      {
        id: "t1",
        role: "assistant",
        text: "",
        createdAt: "2026-09-16T00:00:01.000Z",
        // Written ahead, as a live turn is: it says "interrupted" until the
        // run ends it.
        outcome: "interrupted",
      },
    ];
    const answerSearches = vi.fn(() => true);
    const assistant = fakeAssistant(
      {
        ...snapshot(current),
        running: true,
        activity: { kind: "awaiting-writer" },
        runningChatId: where === "here" ? current.id : "another-chat",
        pendingSearch: ask,
        runWaitedMs: 0,
        ...extra.state,
      },
      {
        answerSearches,
        searchQueryHoldsBookWords: vi.fn(() => false),
        revealPendingSearch: vi.fn(),
      },
    );
    const panel = (open: boolean) => (
      <AiPanel
        open={open}
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
      />
    );
    const view = render(panel(extra.open ?? true));
    return {
      assistant,
      answerSearches,
      reopen: () => view.rerender(panel(true)),
    };
  }

  const scrollAway = () => {
    const messages = document.querySelector(".ai-messages");
    if (!(messages instanceof HTMLElement)) throw new Error("no transcript");
    Object.defineProperty(messages, "scrollHeight", { value: 600 });
    Object.defineProperty(messages, "clientHeight", { value: 100 });
    messages.scrollTop = 0;
    fireEvent.scroll(messages);
  };

  it("sits in the live turn's foot, and answers through the Assistant", () => {
    vi.useFakeTimers();
    try {
      const { answerSearches } = waiting("here");
      const field = screen.getByRole("textbox", {
        name: "dock.web.ask.wikipedia",
      });
      expect((field as HTMLTextAreaElement).value).toBe("Porta Pia 1870");
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.click(screen.getByRole("button", { name: "dock.web.search" }));
      expect(answerSearches).toHaveBeenCalledWith("ask-1", {
        kind: "send",
        rows: [{ rowId: "r0", query: "Porta Pia 1870" }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says in the live region that the run waits, and the Stop stays", () => {
    waiting("here");
    expect(liveRegion()?.textContent).toContain("dock.awaitingWriter");
    const stop = screen.getByLabelText("dock.stop") as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    expect(stop.classList.contains("is-running")).toBe(false);
  });

  it("returns focus to the composer only when it was in the ask", () => {
    waiting("here");
    const field = screen.getByRole("textbox", {
      name: "dock.web.ask.wikipedia",
    });
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByLabelText("dock.ask"));
  });

  it("turns the jump into the way to the ask, and lands focus in it", () => {
    waiting("here");
    scrollAway();
    const jump = screen.getByLabelText("dock.jumpToAsk");
    expect(jump.classList.contains("is-attention")).toBe(true);
    fireEvent.click(jump);
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "dock.web.ask.wikipedia" }),
    );
  });

  it("marks the chat-title button when the ask is in another chat", () => {
    waiting("elsewhere");
    // Not here: no ask in this transcript, and the jump is the plain one.
    expect(
      screen.queryByRole("textbox", { name: "dock.web.ask.wikipedia" }),
    ).toBeNull();
    const control = screen.getByLabelText("dock.chatsWaiting");
    expect(control.classList.contains("is-attention")).toBe(true);
  });

  it("leaves the buttons plain with no ask", () => {
    const current = record();
    render(
      <AiPanel
        assistant={fakeAssistant(snapshot(current))}
        quote={null}
        onQuote={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("dock.chats").classList).not.toContain(
      "is-attention",
    );
  });
});

// ── The ask's reveals and buttons ────────────────────────────────────────────
//
// The jump's focus conditions and the reveals around the ask; each row fails
// under the mutation it guards against.

describe("AiPanel: the ask's reveals and buttons", () => {
  const ASK1 = {
    askId: "ask-1",
    engine: { kind: "wikipedia" as const },
    kind: "first" as const,
    rows: [{ rowId: "r0", query: "Porta Pia 1870", bookWords: false }],
  };
  function live(
    where: "here" | "elsewhere",
    ask: NonNullable<AssistantSnapshot["pendingSearch"]> | null = ASK1,
    extra: { open?: boolean; state?: Partial<AssistantSnapshot> } = {},
  ) {
    const current = record();
    current.turns = [
      {
        id: "t0",
        role: "user",
        text: "When was Porta Pia?",
        createdAt: "2026-09-16T00:00:00.000Z",
        outcome: "complete",
      },
      {
        id: "t1",
        role: "assistant",
        text: "",
        createdAt: "2026-09-16T00:00:01.000Z",
        outcome: "interrupted",
      },
    ];
    const answerSearches = vi.fn(() => true);
    const assistant = fakeAssistant(
      {
        ...snapshot(current),
        running: true,
        activity: ask ? { kind: "awaiting-writer" } : { kind: "thinking" },
        runningChatId: where === "here" ? current.id : "another-chat",
        pendingSearch: ask,
        runWaitedMs: 0,
        ...extra.state,
      },
      {
        answerSearches,
        searchQueryHoldsBookWords: vi.fn(() => false),
        revealPendingSearch: vi.fn(),
      },
    );
    const panel = (open: boolean) => (
      <AiPanel
        open={open}
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
      />
    );
    const view = render(panel(extra.open ?? true));
    return { answerSearches, reopen: () => view.rerender(panel(true)) };
  }
  const scrollAway = () => {
    const messages = document.querySelector(".ai-messages");
    if (!(messages instanceof HTMLElement)) throw new Error("no transcript");
    Object.defineProperty(messages, "scrollHeight", { value: 600 });
    Object.defineProperty(messages, "clientHeight", { value: 100 });
    messages.scrollTop = 0;
    fireEvent.scroll(messages);
  };
  const searchButton = () =>
    screen.getByRole("button", { name: "dock.web.search" });
  const later = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restarts arming when the dock opens on a waiting ask", () => {
    vi.useFakeTimers();
    const { answerSearches, reopen } = live("here", ASK1, { open: false });
    later(ASK_ARM);
    reopen();
    fireEvent.click(searchButton());
    expect(answerSearches).not.toHaveBeenCalled();
    later(ASK_ARM);
    fireEvent.click(searchButton());
    expect(answerSearches).toHaveBeenCalledTimes(1);
  });

  it("drops a held or quick Enter after the jump lands in the field", () => {
    vi.useFakeTimers();
    const { answerSearches } = live("here");
    later(ASK_ARM);
    scrollAway();
    fireEvent.click(screen.getByLabelText("dock.jumpToAsk"));
    const field = screen.getByRole("textbox", {
      name: "dock.web.ask.wikipedia",
    });
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: "Enter", repeat: true });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(answerSearches).not.toHaveBeenCalled();
    later(ASK_ARM);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(answerSearches).toHaveBeenCalledTimes(1);
  });

  it("lands a retry's jump on the named ask, which has no field", () => {
    live("here", {
      askId: "ask-r",
      engine: { kind: "wikipedia" },
      kind: "retry",
      at: new Date(Date.now() + 60_000).toISOString(),
      rows: [{ rowId: "r0", query: "Porta Pia", bookWords: false }],
    });
    scrollAway();
    fireEvent.click(screen.getByLabelText("dock.jumpToAsk"));
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "dock.web.ask.wikipedia" }),
    );
  });

  it("lands the jump on the named ask, never a tick, when every row is unticked", () => {
    live("here", {
      askId: "ask-2",
      engine: { kind: "wikipedia" },
      kind: "first",
      rows: [
        { rowId: "r0", query: "Porta Pia", bookWords: false },
        { rowId: "r1", query: "Cadorna", bookWords: false },
      ],
    });
    // Several rows open behind Edit, so the ticks this row unticks are
    // reached through it.
    fireEvent.click(screen.getByRole("button", { name: "dock.web.editName" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Porta Pia" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Cadorna" }));
    scrollAway();
    fireEvent.click(screen.getByLabelText("dock.jumpToAsk"));
    // One named group, the rows' fieldset: never a tick, never unnamed.
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "dock.web.ask.wikipedia" }),
    );
    expect(document.activeElement?.tagName).toBe("FIELDSET");
  });

  it("lands the jump on the read-only ask's group, never a button, and Enter there sends nothing", () => {
    vi.useFakeTimers();
    const { answerSearches } = live("here", {
      askId: "ask-3",
      engine: { kind: "wikipedia" },
      kind: "first",
      rows: [
        { rowId: "r0", query: "Porta Pia", bookWords: false },
        { rowId: "r1", query: "Cadorna", bookWords: false },
      ],
    });
    scrollAway();
    fireEvent.click(screen.getByLabelText("dock.jumpToAsk"));
    const group = screen.getByRole("group", {
      name: "dock.web.ask.wikipedia",
    });
    expect(document.activeElement).toBe(group);
    expect(group.tagName).toBe("DIV");
    later(ASK_ARM);
    fireEvent.keyDown(group, { key: "Enter" });
    expect(answerSearches).not.toHaveBeenCalled();
    // Search sends both, as shown.
    fireEvent.click(searchButton());
    expect(answerSearches).toHaveBeenCalledWith("ask-3", {
      kind: "send",
      rows: [
        { rowId: "r0", query: "Porta Pia" },
        { rowId: "r1", query: "Cadorna" },
      ],
    });
  });

  it("marks the jump only when the ask is in this chat", () => {
    live("elsewhere");
    scrollAway();
    const jump = screen.getByLabelText("dock.jumpLatest");
    expect(jump.classList.contains("is-attention")).toBe(false);
  });

  it("speaks a flagged ask's flag in the live region", () => {
    live("here", {
      ...ASK1,
      rows: [{ rowId: "r0", query: "Marta a Roma", bookWords: true }],
    });
    expect(liveRegion()?.textContent).toContain("dock.web.flag");
  });

  it("leaves focus where it was when the ask is decided from outside it", () => {
    live("here");
    fireEvent.click(screen.getByRole("button", { name: "dock.web.decline" }));
    expect(document.activeElement).not.toBe(screen.getByLabelText("dock.ask"));
  });

  it("marks the waiting chat's row in the switcher", async () => {
    live("here");
    fireEvent.click(screen.getByLabelText("dock.chats"));
    await settled();
    expect(
      screen.getByRole("img", { name: "dock.awaitingWriter" }),
    ).toBeTruthy();
  });

  it("leaves the writer's wait out of the live clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T00:02:01.000Z"));
    live("here", null, { state: { runWaitedMs: 60_000 } });
    const clock = document.querySelector(".ai-activity")?.textContent ?? "";
    expect(clock).toContain('"minutes":1');
    expect(clock).toContain('"seconds":0');
  });
});

// ── Streaming re-renders the live answer ─────────────────────────────────────
//
// The panel walks the open chat's web citations on every snapshot, and a
// settled answer above the streaming one must come out of that walk with the
// same entry object (`previous`, from the last committed walk), so its memo
// holds and its Markdown is not rendered again per token. Its Copy text is
// memoized beside it: never one parse per render.

describe("AiPanel while an answer streams", () => {
  const SETTLED = "SETTLED web:1 (web:1)";
  const LIVE = "LIVE so far";

  /**
   * The open chat, streaming. `failed` is a second, background chat whose
   * save failed: it rides along unchanged in every snapshot, so the panel's
   * save-failure foot stays up while the open chat streams.
   */
  function streaming(failed?: ChatRecord) {
    const current = record();
    const settledAnswer = {
      id: "a1",
      role: "assistant" as const,
      text: SETTLED,
      createdAt: stamp,
      outcome: "complete" as const,
      web: [
        {
          callId: "c1",
          engine: { kind: "wikipedia" as const },
          status: "searched" as const,
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
    const liveAnswer = {
      id: "a2",
      role: "assistant" as const,
      text: LIVE,
      createdAt: stamp,
      // The live flag, not the outcome, is what makes it stream: the panel
      // names the last answer of the running chat.
      outcome: "complete" as const,
    };
    current.turns = [
      {
        id: "q1",
        role: "user",
        text: "Rome?",
        createdAt: stamp,
        outcome: "complete",
      },
      settledAnswer,
      {
        id: "q2",
        role: "user",
        text: "And then?",
        createdAt: stamp,
        outcome: "complete",
      },
      liveAnswer,
    ];
    const others = failed ? [failed] : [];
    let state: AssistantSnapshot = {
      ...snapshot(current),
      chats: [current, ...others],
      running: true,
      runningChatId: current.id,
      activity: { kind: "thinking" },
      saveFailedChatId: failed?.id ?? null,
    };
    let notify = () => undefined as void;
    const assistant = fakeAssistant(state, {
      subscribe: vi.fn((listener: () => void) => {
        notify = listener;
        return () => undefined;
      }),
      getSnapshot: vi.fn(() => state),
    });
    /** One more token into the live turn; every other turn is unchanged. */
    const token = (words: string) =>
      act(() => {
        const turns = current.turns.slice(0, -1);
        const grown = { ...liveAnswer, text: `${LIVE}${words}` };
        state = {
          ...state,
          chats: [{ ...current, turns: [...turns, grown] }, ...others],
        };
        notify();
      });
    return { assistant, token };
  }

  /** Mounted, with the catalogue listed and hashed: nothing left to land. */
  async function mounted(assistant: Assistant) {
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await waitFor(() => expect(assistant.listSources).toHaveBeenCalled());
    await settled();
    await settled();
    // The settled answer drew its marker: the entry reached it.
    expect(document.querySelector(".ai-web-mark")?.textContent).toBe("1");
  }

  const firstArgs = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((call) => String(call[0]));

  it("streaming one token re-renders only the live turn", async () => {
    const { assistant, token } = streaming();
    const render = vi.spyOn(markdown, "render");
    await mounted(assistant);
    render.mockClear();
    token(" and more");
    const rendered = firstArgs(render);
    expect(rendered.some((text) => text.startsWith("SETTLED"))).toBe(false);
    expect(rendered).toContain(`${LIVE} and more`);
  });

  it("Copy parses nothing in render", async () => {
    // `render` calls `parse` itself, so every parse a render did not make
    // is a parse something else made in render: after the token, the two
    // counts are equal. And the Copy click reads the memo, parsing nothing.
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      const { assistant, token } = streaming();
      const render = vi.spyOn(markdown, "render");
      const parse = vi.spyOn(markdown, "parse");
      await mounted(assistant);
      render.mockClear();
      parse.mockClear();
      token(" and more");
      expect(render.mock.calls.length).toBeGreaterThan(0);
      expect(parse).toHaveBeenCalledTimes(render.mock.calls.length);
      expect(firstArgs(parse).some((text) => text.startsWith("SETTLED"))).toBe(
        false,
      );
      render.mockClear();
      parse.mockClear();
      const copy = document.querySelector<HTMLButtonElement>(
        '[data-turn-id="a1"] .ai-turn-copy',
      );
      fireEvent.click(copy as Element);
      expect(writeText).toHaveBeenCalledWith(
        // Two groups: a wrapper starts a group of its own.
        "SETTLED[1][1]\n\n[1] Rome · https://en.wikipedia.org/wiki/Rome",
      );
      expect(render).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("a failed save's Copy parses nothing while another chat streams", async () => {
    // Copy's text is memoized on its inputs or computed on the click, never
    // parsed per render. The save-failure foot memoizes it on the failed
    // record, so a token streamed in another chat does not re-parse a
    // background chat's settled answer.
    const BACKGROUND = "BACKGROUND web:7 (web:7)";
    const failed: ChatRecord = {
      ...record(),
      id: "22222222-2222-4222-8222-222222222222",
      title: "Unsaved chat",
      turns: [
        {
          id: "b1",
          role: "assistant",
          text: BACKGROUND,
          createdAt: stamp,
          outcome: "complete",
          web: [
            {
              callId: "c7",
              engine: { kind: "wikipedia" },
              status: "searched",
              query: "walls",
              results: [
                {
                  id: "web:7",
                  url: "https://en.wikipedia.org/wiki/Walls",
                  title: "Walls",
                },
              ],
            },
          ],
        },
      ],
    };
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    try {
      const { assistant, token } = streaming(failed);
      const render = vi.spyOn(markdown, "render");
      const parse = vi.spyOn(markdown, "parse");
      await mounted(assistant);
      // The premise: the foot is up, naming the background chat, with Copy.
      expect(screen.getByText(/dock.saveFailedNamed/)).toBeTruthy();
      expect(screen.getByText("dock.copyAnswer")).toBeTruthy();
      render.mockClear();
      parse.mockClear();
      token(" and more");
      expect(render.mock.calls.length).toBeGreaterThan(0);
      expect(
        firstArgs(parse).some((text) => text.startsWith("BACKGROUND")),
      ).toBe(false);
      expect(parse).toHaveBeenCalledTimes(render.mock.calls.length);
      // And the Copy it offers still copies the answer, cited as the screen
      // reads it.
      fireEvent.click(screen.getByText("dock.copyAnswer"));
      expect(writeText).toHaveBeenCalledWith(
        "BACKGROUND[1][1]\n\n[1] Walls · https://en.wikipedia.org/wiki/Walls",
      );
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });
});
