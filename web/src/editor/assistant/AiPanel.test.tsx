// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import AiPanel from "./AiPanel";
import type { KeyVerdict } from "./keyVerdict";
import { Assistant } from "../../ai/application/assistant";
import { DEFAULT_PERSONA, personasFor } from "../../ai/domain/personas";
import { skillsFor } from "../../ai/domain/skills";
import type {
  ChatRecord,
  ModelEvent,
  ModelFailureCode,
  SourceDescriptor,
} from "../../ai/domain/types";
import type { Artifacts, ModelProvider, ProjectSources } from "../../ai/ports";
import { serializeChat } from "../../ai/adapters/chatCodec";
import { setConnector } from "../../ai/connectPath";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

afterEach(() => cleanup());

type Ask = (input: unknown) => Promise<{
  model: string;
  stream: AsyncIterable<string>;
}>;

// Every word of a conversation is kept in the writer's own folder: the file is
// theirs, on their disk, readable without the app and without the model.

const SOURCE: SourceDescriptor = {
  id: "node:EL3",
  nodeId: "EL3",
  kind: "manuscript",
  title: "the-storm",
  path: "/document/section--the_storm.EL3.01.md",
  order: 0,
  authority: "manuscript",
  revision: "r1",
};

function chat(
  turns: ChatRecord["turns"] = [],
  kind: ChatRecord["kind"] = "general",
): ChatRecord {
  return {
    schemaVersion: 1,
    id: "00000000-0000-4000-8000-000000000003",
    title: "The storm",
    kind,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    preferences: {
      personaId: DEFAULT_PERSONA.id,
      model: { providerId: "scripted", modelId: "test-model" },
      targetNodeId: "EL3",
      pinnedSourceIds: [],
    },
    turns,
  };
}

function harness(
  over: {
    existing?: string;
    folder?: string[];
    ask?: Ask;
    kind?: ChatRecord["kind"];
    /** The code a throwing `ask` fails with; `provider-rejected` if unset. */
    failCode?: ModelFailureCode;
  } = {},
) {
  const written = new Map<string, string>();
  let current = chat(
    over.existing
      ? [
          {
            id: "old",
            role: "user",
            text: "Too much?",
            createdAt: "2026-01-01T00:00:00.000Z",
            outcome: "complete",
          },
        ]
      : [],
    over.kind,
  );
  const artifacts: Artifacts = {
    listChats: async () => ({ chats: [current], unreadable: [] }),
    loadChat: async () => current,
    saveChat: async (next) => {
      current = next;
      written.set(`/assistant/chat--${next.id}.json`, serializeChat(next));
      return {};
    },
    deleteChatFile: async () => undefined,
    deleteChat: async () => undefined,
    saveReview: async () => undefined,
    loadReview: async () => {
      throw new Error("unused");
    },
    deleteReview: async () => undefined,
    readSummary: async () => null,
    writeSummary: async () => undefined,
    readLedger: async () => null,
    writeLedger: async () => undefined,
    readJudgements: async () => null,
    writeJudgements: async () => undefined,
    readEntities: async () => null,
    writeEntities: async () => undefined,
  };
  const sources: ProjectSources = {
    list: async () => [SOURCE],
    read: async () => ({
      text: "The storm arrives.",
      revision: "r1",
      origin: "project-file",
    }),
    allowedReaderSources: async () => new Set([SOURCE.id]),
  };
  const model: ModelProvider = {
    id: "scripted",
    listModels: async () => [],
    describeModel: async (ref) => ({
      id: ref.modelId,
      providerId: ref.providerId,
      label: ref.modelId,
      kind: "device" as const,
      capabilities: { tools: true, structuredOutput: true },
    }),
    estimate: async () => ({ tokens: 1, exact: true }),
    generate: async function* (): AsyncIterable<ModelEvent> {
      if (!over.ask) {
        yield {
          type: "failed",
          error: {
            code: "not-configured",
            message: "No model configured",
            retryable: false,
          },
        };
        return;
      }
      try {
        const reply = await over.ask({});
        yield {
          type: "started",
          model: { providerId: "scripted", modelId: reply.model },
        };
        for await (const part of reply.stream)
          yield { type: "text-delta", text: part };
        yield { type: "completed", reason: "answer" };
      } catch (error) {
        yield {
          type: "failed",
          error: {
            code: over.failCode ?? "provider-rejected",
            message: error instanceof Error ? error.message : "failed",
            retryable: false,
          },
        };
      }
    },
  };
  return {
    assistant: new Assistant({
      sources,
      artifacts,
      model,
      defaultNode: () => ({ id: "EL3", title: "the-storm", kind: "section" }),
    }),
    written,
  };
}

const echo: Ask = async () => ({
  model: "test-model",
  stream: (async function* () {
    yield "It is doing two jobs ";
    yield "and only one is earned.";
  })(),
});

function panel(
  opts: {
    existing?: string;
    folder?: string[];
    quote?: string | null;
    ask?: Ask;
    kind?: ChatRecord["kind"];
    failCode?: ModelFailureCode;
    onNotify?: (text: string, undo?: () => void) => void;
    activeFile?: string | null;
    nodeId?: string | null;
    nodeTitle?: string | null;
    remoteProviders?: Record<string, KeyVerdict>;
  } = {},
) {
  const { assistant, written } = harness(opts);
  const onQuote = vi.fn();
  // The bridge owns the chat listing (the panel does not list on mount), so
  // the harness plays the bridge here, as `EditorRoute` does.
  void assistant.initialize();
  render(
    <AiPanel
      assistant={assistant}
      quote={opts.quote ?? null}
      onQuote={onQuote}
      remoteProviders={opts.remoteProviders}
      onNotify={opts.onNotify}
    />,
  );
  return { written, onQuote };
}

const turns = () =>
  [...document.querySelectorAll(".msg")].map((m) => m.textContent);
const composer = () => screen.getByLabelText("dock.ask") as HTMLTextAreaElement;

describe("AiPanel", () => {
  // The header speaks the node's display name — handed down as `nodeTitle`,
  // never derived from a file name — so a rename changes the header and not
  // the conversation it keys to.
  it("is about the Section that is open, and says so", async () => {
    panel();
    // The chat's title button sits in the chatbar.
    await waitFor(() =>
      expect(document.querySelector(".ai-chatbar")).toBeTruthy(),
    );
    expect(screen.getByLabelText("dock.chats").textContent).toContain(
      "The storm",
    );
  });

  // The composer asks about prose; it is not prose itself. A browser squiggle
  // under a sentence the writer has not written would be a false accusation.
  it("keeps the composer out of the browser spellchecker", async () => {
    panel();
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    expect(composer().getAttribute("spellcheck")).toBe("false");
  });

  it("keeps project chat available when no Section is open", async () => {
    panel({ activeFile: null, nodeId: null, nodeTitle: null });
    await waitFor(() => expect(screen.getByText("dock.askHint")).toBeTruthy());
  });

  // An assistant with no persona has no voice, so the first one stands in.
  it("takes a persona from the folder", async () => {
    panel();
    await waitFor(() =>
      expect(document.querySelector(".ai-persona")?.textContent).toContain(
        DEFAULT_PERSONA.name,
      ),
    );
  });

  // The face is the chip's mark. The face and the generic mark are drawn from
  // one branch, so a fallback widened by accident would put a generic mark
  // over a named voice.
  it("wears the selected voice's own face, not a generic mark", async () => {
    panel();
    await waitFor(() =>
      expect(document.querySelector(".ai-persona .ai-face")).toBeTruthy(),
    );
    const face = document.querySelector<HTMLImageElement>(
      ".ai-persona .ai-face",
    );
    expect(face?.getAttribute("src")).toBe(DEFAULT_PERSONA.avatar);
    // Decorative beside the name it depicts, and sized on the element so the
    // chip does not reflow a frame after the image decodes.
    expect(face?.getAttribute("alt")).toBe("");
    expect(face?.getAttribute("width")).toBe("18");
    expect(face?.getAttribute("height")).toBe("18");
    // The face takes the seat; it does not join the mark already in it.
    expect(document.querySelectorAll(".ai-persona svg").length).toBe(1);
  });

  it("says so when the folder holds no persona", async () => {
    panel({ folder: ["memory.md"] });
    await waitFor(() =>
      expect(document.querySelector(".ai-persona")?.textContent).toContain(
        DEFAULT_PERSONA.name,
      ),
    );
  });

  // A skill file reaches the writer as a typed command, which is what makes
  // writing one worth the trouble.
  it("turns a skill file into a typed command", async () => {
    panel({ kind: "editorial" });
    await waitFor(() => expect(screen.getByLabelText("dock.ask")).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "/" } });
    // By its name: the row also draws its note.
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "/continuity" }),
      ).toBeTruthy(),
    );
  });

  it("offers the same commands whether or not something is selected", async () => {
    // A selection changes what a question is about; it does not change what
    // can be asked.
    panel({ kind: "editorial", quote: "riding a little high" });
    await waitFor(() => expect(screen.getByLabelText("dock.ask")).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "/" } });
    // Every command the chat offers, counted from the skills rather than
    // written down: a selection takes none of them away.
    await waitFor(() =>
      expect(screen.getAllByRole("menuitem")).toHaveLength(
        skillsFor("editorial").length,
      ),
    );
  });

  it("runs a beta reader's journal from its command, and gives a refusal back", async () => {
    const { assistant } = harness({ kind: "beta-reader" });
    const readOn = vi
      .spyOn(assistant.reader, "readOn")
      .mockResolvedValue("rejected");
    const predict = vi
      .spyOn(assistant.reader, "predict")
      .mockResolvedValue("started");
    void assistant.initialize();
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("dock.ask")).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "/read-on" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(readOn).toHaveBeenCalledTimes(1));
    // Refused: the words come back to be sent again.
    await waitFor(() => expect(composer().value).toBe("/read-on"));
    fireEvent.change(composer(), { target: { value: "/predict" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(predict).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(composer().value).toBe(""));
  });

  it("names what the chat relies on that is unwritten, and offers to write it", async () => {
    const { assistant } = harness({ kind: "editorial" });
    vi.spyOn(assistant.sources, "missing").mockResolvedValue([
      { group: "guidebook", sectionId: "editing-brief" },
      { group: "characters" },
    ]);
    const write = vi.fn();
    void assistant.initialize();
    render(
      <AiPanel
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
        onWriteReference={write}
      />,
    );
    const line = await waitFor(() => {
      const found = document.querySelector(".ai-missing");
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    // With links to write them, the sentence only leads in and the links are
    // the list, so no name appears twice; the shelf is named, as plain text
    // among the links.
    expect(line.textContent).toContain("dock.missingLead");
    expect(line.textContent).not.toContain("dock.missingReferences");
    // One button per section; a shelf is named, never offered as one file.
    const buttons = line.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(line.querySelector(".ai-write-links")?.children).toHaveLength(2);
    // Drawn as a link, on its own row under the sentence: a call to act, not
    // more of the sentence.
    expect(buttons[0].className).toBe("ui-text-link");
    expect(buttons[0].parentElement?.className).toBe("ai-write-links");
    fireEvent.click(buttons[0]);
    expect(write).toHaveBeenCalledWith({
      group: "guidebook",
      sectionId: "editing-brief",
    });
  });

  it("refuses /intent until the intent is written, and offers to write it", async () => {
    const { assistant } = harness({ kind: "alpha-reader" });
    const write = vi.fn();
    void assistant.initialize();
    render(
      <AiPanel
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
        onWriteReference={write}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("dock.ask")).toBeTruthy());
    // Lumi: the default voice does not work in the reader rooms.
    await assistant.chats.updatePreferences({
      readerScope: { kind: "whole" },
      personaId: personasFor("alpha-reader")[0].id,
    });
    fireEvent.change(composer(), { target: { value: "/intent" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    const problem = await waitFor(() => {
      const found = document.querySelector(".dock-problem");
      expect(found?.textContent).toContain("dock.problem.reference-needed");
      return found as HTMLElement;
    });
    // The words come back for when the writer returns.
    await waitFor(() => expect(composer().value).toBe("/intent"));
    const offered = problem.querySelectorAll(".ai-write-links > button");
    expect(offered.length).toBeGreaterThan(1);
    for (const one of offered) expect(one.className).toBe("ui-text-link");
    fireEvent.click(offered[0]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("asks a drafting chat what the writer needs, and fills the field with it", async () => {
    const { assistant } = harness({ kind: "drafting" });
    void assistant.initialize();
    render(<AiPanel assistant={assistant} quote={null} onQuote={vi.fn()} />);
    const question = await screen.findByRole("group", {
      name: "dock.drafting.question",
    });
    fireEvent.click(within(question).getByText("dock.drafting.need.unstick"));
    await waitFor(() => expect(composer().value).toBe("/unstick "));
    // Answered: the question is gone until the writer moves Section.
    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "dock.drafting.question" }),
      ).toBeNull(),
    );
    expect(assistant.room.draftingNeed()).toBe("unstick");
  });

  it("offers an alpha reader its own commands and no editor's", async () => {
    panel({ kind: "alpha-reader" });
    await waitFor(() => expect(screen.getByLabelText("dock.ask")).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "/" } });
    const offered = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent ?? "");
    expect(offered).toHaveLength(2);
    for (const command of ["heart", "intent"])
      expect(offered.some((one) => one.includes(`/${command}`))).toBe(true);
  });

  it("offers a beta reader its own commands and no editor's", async () => {
    panel({ kind: "beta-reader" });
    await waitFor(() => expect(screen.getByLabelText("dock.ask")).toBeTruthy());
    expect(composer().placeholder).toBe("dock.askPlaceholderCommands");
    fireEvent.change(composer(), { target: { value: "/" } });
    const offered = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent ?? "");
    for (const command of ["read-on", "predict", "put-down", "review", "blurb"])
      expect(offered.some((one) => one.includes(`/${command}`))).toBe(true);
    for (const command of ["where", "map", "verify", "continuity"])
      expect(offered.some((one) => one.includes(`/${command}`))).toBe(false);
  });

  // ── The conversation, and where it lives ───────────────────────────────────

  it("reads an existing conversation back", async () => {
    panel({
      existing:
        "---\nsection: section--the_storm.EL3.01.md\n---\n\n## You\n\nToo much?\n",
    });
    await waitFor(() => expect(turns()).toHaveLength(1));
    expect(turns()[0]).toContain("Too much?");
  });

  it("starts an empty one when there is none yet", async () => {
    panel();
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
  });

  it("writes the question to the writer’s own folder as structured JSON", async () => {
    const { written } = panel();
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    fireEvent.change(composer(), {
      target: { value: "Is this doing too much work?" },
    });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() => expect(written.size).toBe(1));
    const [path, content] = [...written.entries()][0];
    expect(path).toMatch(/^\/assistant\/chat--[0-9a-f-]+\.json$/);
    expect(content).toContain("Is this doing too much work?");
    // And it reads back as what was said.
    expect((JSON.parse(content) as ChatRecord).turns[0].text).toBe(
      "Is this doing too much work?",
    );
  });

  it("keeps the selection apart from the question", async () => {
    const { written, onQuote } = panel({ quote: "riding a little high" });
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "Too much?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() => expect(written.size).toBe(1));
    const conversation = JSON.parse([...written.values()][0]) as ChatRecord;
    expect(conversation.turns[0].quote).toBe("riding a little high");
    expect(conversation.turns[0].text).toBe("Too much?");
    // Cleared at submit, with the text, not when the run ends: `send`
    // resolves when the whole answer has streamed, so clearing after it would
    // leave the passage in the composer for the length of the answer, looking
    // unsent and riding on the next question.
    expect(onQuote).toHaveBeenCalledWith(null);
  });

  it("takes an answer from whatever was injected", async () => {
    panel({ ask: echo });
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "Well?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(turns()).toHaveLength(2));
    expect(turns()[1]).toContain("and only one is earned.");
  });

  // The answering model rides on the reply, so the footer names it instead
  // of letting the "no model" empty state outlive the answer.
  it("names the model that answered", async () => {
    const { written } = panel({ ask: echo });
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "Well?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(turns()).toHaveLength(2));
    // The model is recorded on the turn, where the answer lives; the foot
    // carries no permanent model or path chrome.
    const raw = [...written.values()].pop();
    if (!raw) throw new Error("expected a saved chat");
    const saved = JSON.parse(raw) as {
      turns: Array<{ model?: { modelId?: string } }>;
    };
    expect(saved.turns[1]?.model?.modelId).toBe("test-model");
  });

  // The question was sent; the conversation is the record, so the refusal
  // belongs in it as the answer — the writer must not have to wonder whether
  // their question vanished into a dock that said nothing.
  it("says why the run failed, inside the conversation", async () => {
    const refuses: Ask = async () => {
      throw new Error("rejected");
    };
    const { written } = panel({ ask: refuses });
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "Well?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(turns()).toHaveLength(2));
    // The namespaced key, not its suffix: `dock.modelError.auth` is the string
    // the component builds, and a lookup of `modelError.auth` would match it
    // as a substring.
    expect(turns()[1]).toContain("rejected");
    // And the refusal was kept with the conversation, not swallowed silently.
    await waitFor(() => expect(written.size).toBeGreaterThan(0));
  });

  it("says nothing rather than inventing one when no model is wired", async () => {
    panel();
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "Well?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    // The question and its placeholder show together, and under them only
    // the reason: no answer made up.
    await waitFor(() => expect(turns()).toHaveLength(2));
    expect(turns()[0]).toBe("Well?");
    expect(turns()[1]).toContain("dock.modelError.not-configured");
    expect(turns()[1]).not.toContain("Well?");
  });

  it("refuses an empty question", async () => {
    const { written } = panel();
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "   " } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(written.size).toBe(0);
  });

  it("leaves Shift+Enter to the writer, for a second line", async () => {
    const { written } = panel();
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "One" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(written.size).toBe(0);
  });

  // The conversation is stored, in a file named by the chat's own id, so the
  // file name survives renames and adoptions.
  it("keeps the conversation in the project's assistant folder", async () => {
    const { written } = panel({ ask: echo });
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    fireEvent.change(composer(), {
      target: { value: "Where does this live?" },
    });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(written.size).toBeGreaterThan(0));
    // The record lives at `assistant/chat--<uuid>.json` in the writer's own
    // project; the surface does not print that path under the composer.
    expect([...written.keys()]).toContain(
      "/assistant/chat--00000000-0000-4000-8000-000000000003.json",
    );
  });
});

describe("editing a question", () => {
  it("rewinds, and offers the Undo through the shared toast", async () => {
    // The edit happens at once and the toast carries its Undo: the app's rule
    // for a reversible act, rather than a question first.
    const onNotify = vi.fn();
    panel({ ask: echo, onNotify });
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    for (const question of ["First?", "Second?"]) {
      fireEvent.change(composer(), { target: { value: question } });
      fireEvent.keyDown(composer(), { key: "Enter" });
      await waitFor(() =>
        expect(screen.getAllByText(question).length).toBeGreaterThan(0),
      );
    }
    await waitFor(() => expect(turns()).toHaveLength(4));

    const [firstPencil] = screen.getAllByLabelText("dock.editQuestion");
    if (!firstPencil)
      throw new Error("expected a pencil on the first question");
    fireEvent.click(firstPencil);
    const field = screen.getByRole("textbox", { name: "dock.editQuestion" });
    fireEvent.change(field, { target: { value: "First, again?" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith(
        "dock.edited",
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(turns()).toHaveLength(2));
    expect(screen.queryByText("Second?")).toBeNull();
  });
});

describe("trying again", () => {
  it("offers Try again under the last turn only", async () => {
    // An older failure is history: its reason still shows, only the button
    // goes, and `retryTurn` refuses it too, so the rule does not live in the
    // button alone.
    panel({
      ask: async () => {
        throw new Error("gone");
      },
    });
    await waitFor(() => expect(screen.getByText(/dock.askHint/)).toBeTruthy());
    for (const question of ["First?", "Second?"]) {
      fireEvent.change(composer(), { target: { value: question } });
      fireEvent.keyDown(composer(), { key: "Enter" });
      await waitFor(() =>
        expect(screen.getAllByText(question).length).toBeGreaterThan(0),
      );
    }
    await waitFor(() =>
      expect(
        document.querySelectorAll(".msg .ui-banner-attention"),
      ).toHaveLength(2),
    );

    const offers = screen.getAllByText("dock.retry.again");
    expect(offers).toHaveLength(1);
    const turns = document.querySelectorAll(".msg");
    expect(turns[turns.length - 1]?.contains(offers[0] ?? null)).toBe(true);
  });
});

// ── The key line under the chat ──────────────────────────────────────────────
//
// The panel never judges a key: `keyVerdict` in `ai/domain/openrouterKey.ts`
// does. These rows pin the other half: each verdict is
// rendered as the right sentence and the right one button, and the panel
// reads nothing else.

/** A key's verdict; ready, with nothing to say, unless a row says otherwise. */
function verdict(over: Partial<KeyVerdict> = {}): KeyVerdict {
  return {
    connected: true,
    state: "ready",
    notice: null,
    waitUntil: null,
    limitUsd: 10,
    ...over,
  };
}

const settled = () =>
  waitFor(() => expect(document.querySelector(".ai-chatbar")).toBeTruthy());

describe("saying so before the key's limit is spent", () => {
  const spendLine = () =>
    [...document.querySelectorAll(".ui-banner-attention")].find((one) =>
      /dock\.spend\./.test(one.textContent ?? ""),
    ) ?? null;

  it("says nothing while most of the limit is left", async () => {
    panel({ remoteProviders: { scripted: verdict() } });
    await settled();
    expect(spendLine()).toBeNull();
  });

  it("says most of it is gone, and offers nothing", async () => {
    // Nothing to do yet, so no button. The figure is the verdict's call: the
    // line names the limit, never a spend it would have to judge.
    panel({
      remoteProviders: { scripted: verdict({ notice: "limit-mostly-used" }) },
    });
    await waitFor(() => expect(spendLine()).toBeTruthy());

    expect(spendLine()?.textContent ?? "").toContain("dock.spend.most");
    expect(spendLine()?.querySelector("button")).toBeNull();
  });

  it("says it has been reached, and offers a new key", async () => {
    // What happened, and the way on.
    const connector = vi.fn();
    setConnector(connector);
    panel({
      remoteProviders: { scripted: verdict({ state: "limit-reached" }) },
    });
    await waitFor(() => expect(spendLine()).toBeTruthy());

    // No `waitUntil`: the verdict judged waiting not a real choice.
    expect(spendLine()?.textContent ?? "").toContain("dock.spend.reached");
    expect(spendLine()?.textContent ?? "").not.toContain("reachedOrWait");
    fireEvent.click(screen.getByText("dock.retry.newKey"));
    expect(connector).toHaveBeenCalledTimes(1);
    expect(connector).toHaveBeenCalledWith("scripted");
    setConnector(() => {});
  });

  it("offers waiting too, when the server says the key outlives the reset", async () => {
    panel({
      remoteProviders: {
        scripted: verdict({
          state: "limit-reached",
          waitUntil: "2026-10-01T00:00:00+00:00",
        }),
      },
    });
    await waitFor(() => expect(spendLine()).toBeTruthy());

    expect(spendLine()?.textContent ?? "").toContain(
      "dock.spend.reachedOrWait",
    );
    expect(screen.getByText("dock.retry.newKey")).toBeTruthy();
  });

  it("offers the wait on the turn that met the limit", async () => {
    // The moment it matters: the question has just been refused. The
    // composer's line stands aside for that turn, so if the turn did
    // not say it, the wait would be offered nowhere at all.
    panel({
      ask: async () => {
        throw new Error("spent");
      },
      failCode: "limit-reached",
      remoteProviders: {
        scripted: verdict({
          state: "limit-reached",
          waitUntil: "2026-10-01T00:00:00+00:00",
        }),
      },
    });
    await waitFor(() => expect(spendLine()).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "Well?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() =>
      expect(document.querySelector(".msg .ui-banner-attention")).toBeTruthy(),
    );
    // One banner, the turn's, with both ways on — and no Try again, which
    // would fail until the reset or a new key.
    const said = [...document.querySelectorAll(".ui-banner-attention")];
    expect(said).toHaveLength(1);
    expect(said[0]?.textContent).toContain("dock.modelError.limit-reached");
    expect(said[0]?.textContent).toContain("dock.retry.waitForReset");
    expect(screen.getByText("dock.retry.newKey")).toBeTruthy();
    expect(screen.queryByText("dock.retry.again")).toBeNull();
  });

  it("does not offer the wait on the turn when the key dies first", async () => {
    panel({
      ask: async () => {
        throw new Error("spent");
      },
      failCode: "limit-reached",
      remoteProviders: { scripted: verdict({ state: "limit-reached" }) },
    });
    await waitFor(() => expect(spendLine()).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "Well?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() =>
      expect(document.querySelector(".msg .ui-banner-attention")).toBeTruthy(),
    );
    const said = document.querySelector(".msg .ui-banner-attention");
    expect(said?.textContent).toContain("dock.modelError.limit-reached");
    expect(said?.textContent).not.toContain("dock.retry.waitForReset");
  });

  it("says nothing about a limit the server says has reset", async () => {
    // Last window's spend is the verdict's to discount, and it does: a key
    // whose limit reset comes back `ready`.
    panel({ remoteProviders: { scripted: verdict({ state: "ready" }) } });
    await settled();
    expect(spendLine()).toBeNull();
  });

  it("follows the verdict when the account is re-read, without a reload", async () => {
    // The panel keeps no clock of its own. The account layer re-reads the key
    // (a renewal, a refusal, the writer returning to the tab) and the panel
    // renders what it is handed next.
    const { assistant } = harness({});
    void assistant.initialize();
    const { rerender } = render(
      <AiPanel
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={{ scripted: verdict({ state: "limit-reached" }) }}
      />,
    );
    await waitFor(() => expect(spendLine()).toBeTruthy());
    rerender(
      <AiPanel
        assistant={assistant}
        quote={null}
        onQuote={vi.fn()}
        remoteProviders={{ scripted: verdict({ state: "ready" }) }}
      />,
    );
    await waitFor(() => expect(spendLine()).toBeNull());
  });

  it("arms no timer of its own for a reset, however far away", async () => {
    // The reset date is only rendered, so no timer is armed for it, and none
    // needs clamping against a browser that fires one longer than 2^31-1 ms
    // at once.
    const armed = vi.spyOn(window, "setTimeout");
    panel({
      remoteProviders: {
        scripted: verdict({
          state: "limit-reached",
          waitUntil: new Date(Date.now() + 31 * 86_400_000).toISOString(),
        }),
      },
    });
    await waitFor(() => expect(spendLine()).toBeTruthy());

    const delays = armed.mock.calls.map(([, ms]) => Number(ms ?? 0));
    expect(delays.every((ms) => ms < 60 * 60_000)).toBe(true);
    armed.mockRestore();
  });

  it("does not promise a reset that will never come", async () => {
    panel({
      remoteProviders: {
        scripted: verdict({ state: "limit-reached", waitUntil: null }),
      },
    });
    await waitFor(() => expect(spendLine()).toBeTruthy());
    expect(spendLine()?.textContent ?? "").not.toContain("reachedOrWait");
  });

  it("invents nothing when the server has nothing to say", async () => {
    // The verdict makes the call on a null spend and says nothing, which the
    // panel renders as nothing.
    panel({ remoteProviders: { scripted: verdict({ notice: null }) } });
    await settled();
    expect(spendLine()).toBeNull();
  });
});

describe("saying so before the key runs out", () => {
  // Renewal cannot be silent, because a popup opens only inside a user
  // gesture, so this warning is what makes renewing possible. Without it the
  // first sign is a failed turn.
  const warning = () =>
    // The shared attention banner, the same component the Library uses for a
    // lapsed connection.
    [...document.querySelectorAll(".ui-banner-attention")].find((one) =>
      /dock\.renewal\./.test(one.textContent ?? ""),
    ) ?? null;

  it("says nothing while there is plenty of time left", async () => {
    panel({ remoteProviders: { scripted: verdict() } });
    await settled();

    expect(warning()).toBeNull();
  });

  it("says so inside the threshold, and offers the one action", async () => {
    panel({
      remoteProviders: { scripted: verdict({ notice: "expiring-soon" }) },
    });
    await waitFor(() => expect(warning()).toBeTruthy());

    expect(warning()?.textContent ?? "").toContain("dock.renewal.soon");
    expect(warning()?.textContent ?? "").toContain("dock.retry.renew");
  });

  it("changes the sentence rather than the shape once it has lapsed", async () => {
    // A lapsed key is not more urgent than an expiring one; it is a different
    // fact. Escalating the treatment would interrupt a writer who is already
    // being told what to do about it.
    panel({ remoteProviders: { scripted: verdict({ state: "expired" }) } });
    await waitFor(() => expect(warning()).toBeTruthy());

    expect(warning()?.textContent ?? "").toContain("dock.renewal.expired");
  });

  it("says nothing about a provider this chat does not answer with", async () => {
    // The chat's model is `scripted`. A writer on their own Ollama must not be
    // warned about a remote key they are not spending — that is the line
    // between a warning and a nag.
    panel({
      remoteProviders: {
        "some-other-provider": verdict({ notice: "expiring-soon" }),
      },
    });
    await settled();

    expect(warning()).toBeNull();
  });

  it("says it once when the failed turn above already says it", async () => {
    // A key-expired turn carries its own attention banner with the same
    // sentence and the same Renew. The composer's copy under it would be the
    // fact twice, one above the other, the duplicate the panel rules out for
    // errors. The turn's banner wins because it is about that question.
    panel({
      ask: async () => {
        throw new Error("gone");
      },
      failCode: "key-expired",
      remoteProviders: { scripted: verdict({ state: "expired" }) },
    });
    await waitFor(() => expect(warning()).toBeTruthy());
    fireEvent.change(composer(), { target: { value: "Well?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() =>
      expect(document.querySelector(".msg .ui-banner-attention")).toBeTruthy(),
    );
    // One attention banner on screen, and it is the turn's: the reason in
    // the locale's words, with Renew — and only Renew — beside it.
    const said = [...document.querySelectorAll(".ui-banner-attention")];
    expect(said).toHaveLength(1);
    expect(said[0]?.closest(".msg")).toBeTruthy();
    expect(said[0]?.textContent).toContain("dock.modelError.key-expired");
    expect(screen.getByText("dock.retry.renew")).toBeTruthy();
    expect(screen.queryByText("dock.retry.again")).toBeNull();
  });

  it("says nothing when the account has no providers at all", async () => {
    // The device path, and the demo route: no account, no key, nothing to
    // renew. It must not break and must not speak.
    panel();
    await settled();

    expect(warning()).toBeNull();
  });

  it("raises no alarm under a key the server calls ready", async () => {
    // The panel reads no expiry, and a working chat shows no alarm: ready
    // with no notice is silent.
    panel({
      remoteProviders: { scripted: verdict({ state: "ready", notice: null }) },
    });
    await settled();

    expect(warning()).toBeNull();
  });
});
