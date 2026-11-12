// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA } from "../domain/personas";
import type {
  ChatRecord,
  ModelRequest,
  SourceDescriptor,
} from "../domain/types";
import type { CommentProposal } from "../domain/comments";
import type { Comments } from "../ports";
import { questionOf, skillFor } from "../domain/skills";
import { NEED_LINES } from "../domain/drafting";
import {
  EDITORIAL,
  ProgrammableModel,
  last,
  must,
  newChat,
  setup,
  lastTurn,
} from "./assistant.fixture";

// ── The rooms ────────────────────────────────────────────────────────────────
//
// What each kind of chat works from, and who is speaking in it. These pin
// the paperwork a room attaches, what a reader may see beside its horizon,
// the persona composed for the room, and the missing documents a persona is
// told to ask about.

describe("the rooms", () => {
  const guidebook = (sectionId: string): SourceDescriptor => ({
    id: `reference:guidebook--${sectionId}.md`,
    kind: "reference",
    title: sectionId,
    path: `reference/guidebook--${sectionId}.md`,
    group: "guidebook",
    sectionId,
    authority: "reference",
    revision: `r-${sectionId}`,
  });
  const withGuidebook = (texts: Record<string, string>) => {
    const harness = setup();
    for (const [sectionId, text] of Object.entries(texts)) {
      harness.sources.descriptors = [
        ...harness.sources.descriptors,
        guidebook(sectionId),
      ];
      harness.sources.texts.set(`reference:guidebook--${sectionId}.md`, text);
    }
    return harness;
  };
  const lastMessage = (request: ModelRequest) =>
    String(last(request.messages)?.content ?? "");

  it("attaches the drafting room's voice contract, and names what is unwritten", async () => {
    const { assistant, model } = withGuidebook({
      "prose-style": "Close third, past tense, no semicolons.",
      "at-a-glance": "# Story at a glance\n\n- **Genre:**\n  - ",
    });
    await newChat(assistant, "drafting");
    await assistant.send("Help me with this scene.");
    const message = lastMessage(must(model.requests[0]));
    expect(message).toContain("Close third, past tense, no semicolons.");
    // The untouched template is not attached — it says nothing — and is
    // named, with the character sheets nobody has started, as missing.
    expect(message).not.toContain("**Genre:**");
    expect(message).toContain("has not yet written these documents");
    expect(message).toContain('"guidebook: at-a-glance"');
    expect(message).toContain('"characters"');
  });

  it("names a missing document by the host's label when it has one", async () => {
    const { assistant, model } = setup({
      referenceLabel: (ref) => `Label for ${ref.sectionId ?? ref.group}`,
    });
    await newChat(assistant, "general");
    await assistant.send("Where are we?");
    expect(lastMessage(must(model.requests[0]))).toContain(
      '"Label for at-a-glance"',
    );
    // The room's want first, then what the persona's focus reads.
    const missing = await assistant.sources.missing();
    expect(missing[0]).toEqual({
      group: "guidebook",
      sectionId: "at-a-glance",
    });
    expect(missing).toContainEqual({
      group: "guidebook",
      sectionId: "promise",
    });
  });

  it("leaves the missing list to the panel, and names a document only where it changes a point", async () => {
    const { assistant, model } = setup();
    await newChat(assistant, "general");
    await assistant.send("Where are we?");
    const message = lastMessage(must(model.requests[0]));
    expect(message).toContain("do not list them or set them as homework");
    expect(message).not.toContain("fill it in and come back");
  });

  it("names the other chats in the writer's words, where a pointer may be given", async () => {
    const { assistant, model } = setup({
      chatKindLabel: (kind) => `Name of ${kind}`,
    });
    await newChat(assistant, "general");
    await assistant.send("Where is the story weak?");
    const general = lastMessage(must(model.requests[0]));
    expect(general).toContain('editorial: "Name of editorial"');
    expect(general).toContain('drafting: "Name of drafting"');
    expect(general).not.toContain('general: "Name of general"');
    // Drafting points too, never at itself.
    await newChat(assistant, "drafting");
    await assistant.send("Where is the book weak?");
    const drafting = lastMessage(must(model.requests[1]));
    expect(drafting).toContain('editorial: "Name of editorial"');
    expect(drafting).not.toContain('drafting: "Name of drafting"');
    // A room that points nowhere is sent no names.
    await newChat(assistant, "editorial");
    await assistant.send("Where is the book weak?");
    expect(lastMessage(must(model.requests[2]))).not.toContain(
      "The writer's interface names the other kinds of chat",
    );
  });

  it("lets an alpha reader see the intent, and never the world", async () => {
    const { assistant, model } = withGuidebook({
      promise: "The reader should feel the dread before the ghost appears.",
    });
    await newChat(assistant, "alpha-reader");
    await assistant.chats.updatePreferences({
      readerScope: { kind: "through", nodeId: "first" },
    });
    await assistant.send("How does it read?");
    const request = must(model.requests[0]);
    expect(lastMessage(request)).toContain("dread before the ghost");
    expect(lastMessage(request)).not.toContain("canon only when promoted");
    expect(request.instructions).toContain("statement of intent");
  });

  it("refuses a command whose documents are all unwritten, and runs it once one is", async () => {
    const intent = must(skillFor("/intent"));
    const ask = () => {
      const question = questionOf(intent);
      return assistant.send(question.text, undefined, question.command);
    };
    const { assistant, model, sources } = withGuidebook({
      promise: "# The promise\n\n- **What the reader will feel:**\n  - ",
    });
    await newChat(assistant, "alpha-reader");
    await assistant.chats.updatePreferences({
      readerScope: { kind: "through", nodeId: "first" },
    });
    expect(await ask()).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "reference-needed",
      command: "intent",
      needs: intent.needs,
    });
    // Nothing is written or sent.
    expect(must(assistant.activeChat()).turns).toHaveLength(0);
    expect(model.requests).toHaveLength(0);
    // One of them written is enough.
    sources.texts.set(
      "reference:guidebook--promise.md",
      "The reader should feel the dread before the ghost appears.",
    );
    expect(await ask()).toBe("started");
    expect(model.requests).toHaveLength(1);
  });

  it("gives a beta reader the back cover only, as a buyer's briefing, and never asks", async () => {
    const { assistant, model } = setup({
      projectFacts: () => ({
        title: "The Grey Port",
        type: "Novel",
        language: "English",
        goal: 90_000,
      }),
    });
    await newChat(assistant, "beta-reader");
    await assistant.chats.updatePreferences({
      readerScope: { kind: "through", nodeId: "first" },
    });
    await assistant.send("Keep going?");
    const request = must(model.requests[0]);
    expect(request.instructions).toContain("The Grey Port");
    expect(request.instructions).not.toContain("target length");
    // The blurb is missing, and a stranger cannot ask the author for it.
    expect(lastMessage(request)).not.toContain("has not yet written");
    expect(await assistant.sources.missing()).toEqual([
      { group: "guidebook", sectionId: "blurb" },
    ]);

    const covered = withGuidebook({
      blurb: "A port town that keeps its dead.",
    });
    await newChat(covered.assistant, "beta-reader");
    await covered.assistant.chats.updatePreferences({
      readerScope: { kind: "through", nodeId: "first" },
    });
    await covered.assistant.send("Keep going?");
    expect(lastMessage(must(covered.model.requests[0]))).toContain(
      "keeps its dead",
    );
    expect(await covered.assistant.sources.missing()).toEqual([]);
  });

  it("speaks as the persona composed for the room and its preset", async () => {
    const { assistant, model } = setup();
    await newChat(assistant, "editorial");
    await assistant.chats.updatePreferences({ personaId: EDITORIAL.id });
    const second = EDITORIAL.presets.filter((one) =>
      one.chats.includes("editorial"),
    )[1];
    await assistant.chats.updatePreferences({ preset: second.id });
    await assistant.send("How is it?");
    const instructions = must(model.requests[0]).instructions;
    expect(instructions).toContain(EDITORIAL.instructions);
    expect(instructions).toContain("Your obsessions");
    expect(instructions).toContain("Never praise without quoting");
    // A new voice opens on its own focus.
    await assistant.chats.updatePreferences({ personaId: DEFAULT_PERSONA.id });
    expect(assistant.activeChat()?.preferences.preset).toBeUndefined();
  });
});

describe("the drafting room's memory", () => {
  const answering = (text: string) =>
    new ProgrammableModel(async function* () {
      yield { type: "text-delta", text };
      yield { type: "completed", reason: "answer" };
    });

  it("keeps the need for the open Section, and tells the model", async () => {
    const model = answering("Try this.");
    const { assistant } = setup({ model });
    await newChat(assistant, "drafting");
    expect(assistant.room.draftingNeed()).toBeNull();
    await assistant.room.setDraftingNeed("passage");
    expect(assistant.room.draftingNeed()).toBe("passage");
    expect(must(assistant.activeChat()).drafting?.need).toMatchObject({
      kind: "passage",
      nodeId: "first",
    });
    await assistant.send("The storm scene.");
    const message = String(last(must(model.requests[0]).messages)?.content);
    expect(message).toContain(NEED_LINES.passage);
    // Taken back, it is asked again.
    await assistant.room.setDraftingNeed(null);
    expect(assistant.room.draftingNeed()).toBeNull();
  });

  it("forgets the need when the writer moves to another Section", async () => {
    let open = { id: "first", title: "First", kind: "section" as const };
    const { assistant } = setup({ defaultNode: () => open });
    await newChat(assistant, "drafting");
    await assistant.room.setDraftingNeed("check");
    expect(assistant.room.draftingNeed()).toBe("check");
    open = { id: "future", title: "Future", kind: "section" };
    expect(assistant.room.draftingNeed()).toBeNull();
  });

  it("hears a need in the command that serves it", async () => {
    const model = answering("Three ways.");
    const { assistant } = setup({ model });
    await newChat(assistant, "drafting");
    const unstick = questionOf(must(skillFor("/unstick")));
    await assistant.send(unstick.text, undefined, unstick.command);
    expect(assistant.room.draftingNeed()).toBe("unstick");
    expect(String(last(must(model.requests[0]).messages)?.content)).toContain(
      NEED_LINES.unstick,
    );
  });

  // The notes kept for later are ghost comments in the margin, where the
  // writer keeps or dismisses them: they leave the answer and land beside
  // the Section being drafted.
  it("takes the notes kept for later out of the answer, into the margin", async () => {
    const model = answering(
      'Here is the passage.\n\n<for-later>\n- "the old gate" :: Which gate?\n- "not in the text" :: Echo on door.\n- The middle sags.\n</for-later>',
    );
    const asked: [string, CommentProposal[]][] = [];
    const comments: Comments = {
      cap: 8,
      threadsOf: async () => [],
      reply: async () => undefined,
      propose: async (nodeId, _personaId, proposals) => {
        asked.push([nodeId, [...proposals]]);
        // The margin finds the first quote and not the second.
        return proposals.map((one) =>
          one.quote?.text === "not in the text" ? "unplaceable" : "placed",
        );
      },
    };
    const { assistant } = setup({ model, comments });
    await newChat(assistant, "drafting");
    await assistant.send("Write the storm.");
    const chat = must(assistant.activeChat());
    const answer = lastTurn(chat.turns);
    expect(answer.text).toBe("Here is the passage.");
    expect(chat.drafting).not.toHaveProperty("forLater");
    expect(asked[0]).toEqual([
      "first",
      [
        {
          quote: { text: "the old gate" },
          body: "Which gate?",
          weight: "minor",
        },
        {
          quote: { text: "not in the text" },
          body: "Echo on door.",
          weight: "minor",
        },
        { quote: null, body: "The middle sags.", weight: "observation" },
      ],
    ]);
    // A misquote is not lost: it goes on the Section, carrying its words.
    expect(asked[1]).toEqual([
      "first",
      [
        {
          quote: null,
          body: "Echo on door.\n\n“not in the text”",
          weight: "minor",
        },
      ],
    ]);
    expect(answer.commented).toEqual([{ nodeId: "first", count: 3 }]);
  });

  it("leaves another room's answer as it came", async () => {
    const model = answering("Answer.\n<for-later>kept</for-later>");
    const { assistant } = setup({ model });
    await newChat(assistant, "general");
    await assistant.send("A question.");
    const chat = must(assistant.activeChat());
    expect(lastTurn(chat.turns).text).toContain("<for-later>");
    expect(chat.drafting).toBeUndefined();
    // And a need is the drafting room's alone.
    await assistant.room.setDraftingNeed("check");
    expect(must(assistant.activeChat()).drafting).toBeUndefined();
  });

  it("attaches what a question command reads, beside the room's own", async () => {
    const { assistant, model, sources } = setup();
    sources.descriptors = [
      ...sources.descriptors,
      {
        id: "reference:characters--mara.md",
        kind: "reference",
        title: "Mara",
        path: "reference/characters--mara.md",
        group: "characters",
        authority: "reference",
        revision: "rm",
      },
    ];
    // An inner-life answer: `/scene-plan` reads the whole cast, and the
    // drafting room only its facts and rules, so this is what the
    // command adds and the room does not.
    sources.texts.set(
      "reference:characters--mara.md",
      "- **Fears:** Mara keeps the lighthouse, and fears the night it fails.",
    );
    await newChat(assistant, "drafting");
    const plan = questionOf(must(skillFor("/scene-plan")));
    await assistant.send(plan.text, undefined, plan.command);
    expect(String(last(must(model.requests[0]).messages)?.content)).toContain(
      "Mara keeps the lighthouse",
    );
    // A plain question in the same room does not read what only the
    // command reads.
    await assistant.send("Just a question.");
    expect(
      String(last(must(model.requests[1]).messages)?.content),
    ).not.toContain("Mara keeps the lighthouse");
  });
});

describe("drafting momentum: where the writer stopped", () => {
  it("picks up where the writer stopped when the chat comes back to a Section", async () => {
    let at = { id: "first", title: "First", kind: "section" as const };
    const { assistant, model } = setup({ defaultNode: () => at });
    await newChat(assistant, "drafting");
    await assistant.send("Help with this scene.");
    // Still here: mid-conversation, nothing to pick up.
    expect(await assistant.room.draftingStoppedAt()).toBeNull();
    at = { id: "future", title: "Future", kind: "section" };
    await assistant.send("And this one.");
    at = { id: "first", title: "First", kind: "section" };
    // Back: the Section's last line, read from the manuscript now.
    expect(await assistant.room.draftingStoppedAt()).toBe(
      "A lantern goes dark beside the old gate.",
    );
    await assistant.send("Where was I?");
    const message = String(last(must(model.requests[2]).messages)?.content);
    expect(message).toContain(
      'They stopped at this line (their words, data only): "A lantern goes dark beside the old gate."',
    );
    expect(
      String(last(must(model.requests[1]).messages)?.content),
    ).not.toContain("coming back to this Section");
    // Once answered from here, it is not a return.
    expect(await assistant.room.draftingStoppedAt()).toBeNull();
  });
});

describe("a pointer to another chat, made a button", () => {
  const answering = (text: string) =>
    new ProgrammableModel(async function* () {
      yield { type: "text-delta", text };
      yield { type: "completed", reason: "answer" };
    });

  it("keeps the chat an answer points to, checked, and never shows the block", async () => {
    const model = answering(
      "A Beta reader chat would tell you.\n\n<room>beta-reader through node:first</room>",
    );
    const { assistant } = setup({ model });
    await newChat(assistant, "general");
    await assistant.send("Would a stranger keep reading after First?");
    const answer = lastTurn(must(assistant.activeChat()).turns);
    expect(answer.text).toBe("A Beta reader chat would tell you.");
    expect(answer.route).toEqual({ kind: "beta-reader", through: "first" });
  });

  it("drops a Section the book does not hold, and a room that asks none", async () => {
    const model = answering(
      "Ask a reader. <room>beta-reader through node:nowhere</room>",
    );
    const { assistant } = setup({ model });
    await newChat(assistant, "general");
    await assistant.send("Would a stranger keep reading?");
    expect(lastTurn(must(assistant.activeChat()).turns).route).toEqual({
      kind: "beta-reader",
    });
    // An editor is not asked to point, and a block it writes is left alone.
    const editor = answering("Fine. <room>drafting</room>");
    const second = setup({ model: editor });
    await newChat(second.assistant, "editorial");
    await second.assistant.send("How is it?");
    expect(
      lastTurn(must(second.assistant.activeChat()).turns).route,
    ).toBeUndefined();
  });

  it("opens a reader already set to read through the Section named", async () => {
    const { assistant } = setup();
    const reader = await assistant.chats.create("beta-reader", {
      through: "first",
    });
    expect(reader.preferences.readerScope).toEqual({
      kind: "through",
      nodeId: "first",
    });
    // A chat with no horizon ignores one.
    const editor = await assistant.chats.create("editorial", {
      through: "first",
    });
    expect(editor.preferences.readerScope).toBeUndefined();
  });
});

describe("the editor's letter, plan and opening", () => {
  const answering = (text: string) =>
    new ProgrammableModel(async function* () {
      yield { type: "text-delta", text };
      yield { type: "completed", reason: "answer" };
    });
  const LETTER =
    "Dear writer.\n\n<plan>\nMUST: Give Mara a reason to stay.\nCOULD: Vary the tags.\n</plan>";

  it("hands a letter the other rooms' evidence, and keeps its plan apart", async () => {
    const model = answering(LETTER);
    const { assistant } = setup({ model });
    // A beta reader that would have stopped after the first Section.
    await newChat(assistant, "beta-reader");
    const beta = must(assistant.activeChat());
    await assistant.chats.updatePreferences({
      readerScope: { kind: "through", nodeId: "first" },
    });
    // Its reading, as a run would have left it — written through the one
    // save lane, as `/read-on` writes it.
    await (
      assistant as unknown as {
        writes: { persist(chat: ChatRecord): Promise<void> };
      }
    ).writes.persist({
      ...must(assistant.activeChat()),
      reading: {
        entries: [
          {
            nodeId: "first",
            readAt: "t",
            reaction: "r",
            understanding: "u",
            questions: [],
            confusion: [],
            attention: 1,
            cares: [],
            keepReading: false,
            why: "nothing happens",
          },
        ],
        predictions: [],
      },
    });
    await newChat(assistant, "editorial");
    const letter = questionOf(must(skillFor("/letter")));
    await assistant.send(letter.text, undefined, letter.command);
    const message = String(last(must(model.requests[0]).messages)?.content);
    expect(message).toContain("EVIDENCE FROM THE BOOK'S OTHER CHATS");
    expect(message).toContain(`Beta reader "${beta.title}"`);
    expect(message).toContain(
      'would have stopped after: "First" (nothing happens)',
    );
    const chat = must(assistant.activeChat());
    expect(lastTurn(chat.turns).text).toBe("Dear writer.");
    expect(chat.plan?.items.map((item) => [item.priority, item.text])).toEqual([
      ["must", "Give Mara a reason to stay."],
      ["could", "Vary the tags."],
    ]);
    // Ticked off, and put back.
    const [first] = must(chat.plan).items;
    await assistant.room.setPlanItem(first.id, "done");
    expect(must(assistant.activeChat()).plan?.items[0].state).toBe("done");
    await assistant.room.setPlanItem(first.id, "open");
    expect(must(assistant.activeChat()).plan?.items[0].state).toBe("open");
  });

  it("has the next letter judge the last plan, and records its verdicts", async () => {
    // A later review of the same scope reports each item resolved, still
    // open or made worse: the next /letter, not a command of its own.
    const replies = [
      LETTER,
      "Dear writer, again.\n\n<plan-check>\nP1: resolved — Mara now has the letter.\nP2: worse — every tag is 'said' now.\n</plan-check>\n\n<plan>\nCOULD: Vary the tags.\nSHOULD: Cut the harbour flashback.\n</plan>",
    ];
    const model = new ProgrammableModel(async function* () {
      yield { type: "text-delta", text: must(replies.shift()) };
      yield { type: "completed", reason: "answer" };
    });
    const { assistant } = setup({ model });
    await newChat(assistant, "editorial");
    const letter = questionOf(must(skillFor("/letter")));
    await assistant.send(letter.text, undefined, letter.command);
    // The first letter has no plan to judge.
    expect(
      String(last(must(model.requests[0]).messages)?.content),
    ).not.toContain("The revision plan from this chat's last letter");
    await assistant.send(letter.text, undefined, letter.command);
    const message = String(last(must(model.requests[1]).messages)?.content);
    expect(message).toContain("P1 [MUST] Give Mara a reason to stay.");
    expect(message).toContain("P2 [COULD] Vary the tags.");
    const chat = must(assistant.activeChat());
    // Neither block reaches the writer as prose.
    expect(lastTurn(chat.turns).text).toBe("Dear writer, again.");
    expect(
      must(chat.plan).items.map((item) => [
        item.text,
        item.state,
        item.check?.verdict,
      ]),
    ).toEqual([
      // Repeated: keeps the verdict the same letter gave it.
      ["Vary the tags.", "open", "worse"],
      ["Cut the harbour flashback.", "open", undefined],
      // Resolved and not repeated: still listed, ticked.
      ["Give Mara a reason to stay.", "done", "resolved"],
    ]);
  });

  it("keeps a tick made while a letter runs, its save still waiting when the plan folds", async () => {
    const replies = [
      LETTER,
      // Repeats the first item, which keeps its state, and adds one.
      "Dear writer, again.\n\n<plan>\nMUST: Give Mara a reason to stay.\nSHOULD: Cut the harbour flashback.\n</plan>",
    ];
    let markStreaming: () => void = () => undefined;
    const streaming = new Promise<void>((done) => (markStreaming = done));
    let releaseModel: () => void = () => undefined;
    const modelGate = new Promise<void>((done) => (releaseModel = done));
    const model = new ProgrammableModel(async function* (
      _request,
      _signal,
      call,
    ) {
      if (call === 2) {
        markStreaming();
        await modelGate;
      }
      yield { type: "text-delta", text: must(replies.shift()) };
      yield { type: "completed", reason: "answer" };
    });
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "editorial");
    const letter = questionOf(must(skillFor("/letter")));
    await assistant.send(letter.text, undefined, letter.command);
    const [first] = must(must(assistant.activeChat()).plan).items;

    // The tick's save waits until the second letter has folded its plan.
    const save = artifacts.saveChat.bind(artifacts);
    let markTickHeld: () => void = () => undefined;
    const tickHeld = new Promise<void>((done) => (markTickHeld = done));
    let releaseTick: () => void = () => undefined;
    const tickGate = new Promise<void>((done) => (releaseTick = done));
    let holding = true;
    artifacts.saveChat = async (record: ChatRecord) => {
      if (holding && record.plan?.items[0]?.state === "done") {
        holding = false;
        markTickHeld();
        await tickGate;
      }
      return save(record);
    };
    // Told when the answer's write is queued: the fold is done by then.
    const writes = (
      assistant as unknown as {
        writes: { persistRun: (...args: unknown[]) => Promise<void> };
      }
    ).writes;
    const persistRun = writes.persistRun.bind(writes);
    let markFolded: () => void = () => undefined;
    const folded = new Promise<void>((done) => (markFolded = done));
    writes.persistRun = (...args: unknown[]) => {
      const run = args[1] as ChatRecord;
      const done = persistRun(...args);
      if (lastTurn(run.turns).outcome === "complete") markFolded();
      return done;
    };

    const sending = assistant.send(letter.text, undefined, letter.command);
    await streaming;
    const ticking = assistant.room.setPlanItem(first.id, "done");
    await tickHeld;
    releaseModel();
    await folded;
    releaseTick();
    await Promise.all([sending, ticking]);

    const stored = must(artifacts.chats.get(chat.id));
    expect(
      must(stored.plan).items.map((item) => [item.text, item.state]),
    ).toEqual([
      ["Give Mara a reason to stay.", "done"],
      ["Cut the harbour flashback.", "open"],
    ]);
    expect(lastTurn(stored.turns).text).toBe("Dear writer, again.");
  });

  it("hands a letter the persona notes the writer kept in the margin, book-wide", async () => {
    const asked: string[][] = [];
    const comments: Comments = {
      cap: 8,
      threadsOf: async (nodeIds) => {
        asked.push([...nodeIds]);
        return [
          {
            nodeId: "first",
            threads: [
              {
                id: "k",
                state: "open",
                passage: "the old gate",
                entries: [
                  { by: { kind: "persona", id: "30" }, body: "Which gate?" },
                ],
              },
            ],
          },
        ];
      },
      reply: async () => undefined,
      propose: async () => [],
    };
    const model = answering(LETTER);
    const { assistant } = setup({ model, comments });
    await newChat(assistant, "editorial");
    const letter = questionOf(must(skillFor("/letter")));
    await assistant.send(letter.text, undefined, letter.command);
    const message = String(last(must(model.requests[0]).messages)?.content);
    expect(message).toContain(
      "Notes the book's personas left in the margin that the writer kept",
    );
    expect(message).toContain('at "the old gate": Which gate?');
    // Every Section of the book, not only the attached one.
    expect(asked.some((ids) => ids.includes("first") && ids.length > 1)).toBe(
      true,
    );
  });

  it("writes a letter without the margin when the margin cannot be read", async () => {
    const comments: Comments = {
      cap: 8,
      threadsOf: async () => {
        throw new Error("offline");
      },
      reply: async () => undefined,
      propose: async () => [],
    };
    const model = answering(LETTER);
    const { assistant } = setup({ model, comments });
    await newChat(assistant, "editorial");
    const letter = questionOf(must(skillFor("/letter")));
    await assistant.send(letter.text, undefined, letter.command);
    expect(lastTurn(must(assistant.activeChat()).turns).text).toBe(
      "Dear writer.",
    );
  });

  it("never hands a reader the other rooms, and a plain question none either", async () => {
    const model = answering("An answer.");
    const { assistant } = setup({ model });
    await newChat(assistant, "editorial");
    await assistant.send("How is it going?");
    expect(
      String(last(must(model.requests[0]).messages)?.content),
    ).not.toContain("EVIDENCE FROM THE BOOK'S OTHER CHATS");
  });

  it("reads the book's opening for /first-pages, wherever the writer stands", async () => {
    const model = answering("I would read on.");
    const { assistant } = setup({
      model,
      defaultNode: () => ({ id: "future", title: "Future", kind: "section" }),
    });
    await newChat(assistant, "editorial");
    const opening = questionOf(must(skillFor("/first-pages")));
    await assistant.send(opening.text, undefined, opening.command);
    const message = String(last(must(model.requests[0]).messages)?.content);
    expect(message).toContain("A lantern goes dark");
    expect(message).not.toContain("FUTURE SECRET");
    // The chat keeps its own target.
    expect(must(assistant.activeChat()).preferences.targetNodeId).toBe(
      "future",
    );
  });
});
