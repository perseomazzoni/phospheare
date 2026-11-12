// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Runs the app's own code for each place a model meets the margin against
// real models through OpenRouter, on one invented chapter. It
// is a smoke check, not an eval. What it asks of each model:
//
//   1. a margin reply from an editorial persona, a note rather than a letter,
//      that reads the book with its tools when the writer asks about an
//      earlier chapter;
//   2. a reader persona's reply from the text cut at the passage, whose
//      reads of the chapter stop there too;
//   3. `leave_comments` offered on a general turn, with quotes the margin can
//      find again in the chapter;
//   4. a drafting answer's `<for-later>` notes, in the `"passage" :: note`
//      form, with passages the margin can find;
//   5. a review's findings in the margin, end to end through the app's own
//      `Assistant` and the margin's own service (in memory): a line review
//      leaves ghost comments; the writer keeps one, dismisses one, and asks
//      in the kept one, which its persona answers; a second review leaves
//      the dismissed passage alone and does not raise the kept one again.
//
// Every check prints what the model wrote, so a person reads the voice as
// well as the verdict. The verdicts are the mechanical half: answered, and
// placeable.
//
//   node scripts/comments-live.mjs
//   node scripts/comments-live.mjs --models openai/gpt-6-luna-pro
//
// OpenRouter only, never a local Ollama. The key never touches a file:
// `PHOSPHEARE_OPENROUTER_KEY` comes from the environment and goes to the
// provider and nowhere else, and a missing key stops before any request.

/* global AbortController, structuredClone */
import {
  arg,
  moduleServer,
  openRouterGate,
  OpenRouter,
} from "./eval-common.mjs";

const MODELS = arg(
  "models",
  "openai/gpt-6-luna-pro,anthropic/claude-sonnet-5.5,google/gemini-3.8-flash",
).split(",");

// An invented chapter with things worth a note: a word repeated close by,
// a slip out of the point of view, and a night that is also noon.
const CHAPTER = [
  "Mara reached the harbour as the last ferry pulled away. The lanterns along the quay were already lit, and the water held their light in long, broken lines.",
  "She counted the boats twice. The harbour master had promised her a berth on the *Gull*, but the *Gull* was not there, and neither was he.",
  "Behind the warehouse, Tomas was thinking that she would never forgive him for the letter. He had burned it, after all, and she had loved the man who wrote it.",
  "The noon sun beat on the cobbles as Mara turned back toward the old lighthouse. Its lamp had been dark for eleven years, and tonight it was dark again.",
  "She climbed the stairs slowly, slowly, one hand on the cold rail, and at the top she found the door already open.",
].join("\n\n");

const PASSAGE = "Its lamp had been dark for eleven years";

// The chapter before it, where the lighthouse is set up: what a reply asked
// "did I set this up?" has to read.
const EARLIER = [
  "The letter came the week the lighthouse went dark. Mara's father had kept its lamp for thirty years, and on the night he left the island nobody lit it.",
  "She kept the letter in the tin with the ferry tickets and did not open it.",
].join("\n\n");

const CATALOG = [
  {
    id: "node:EL1",
    kind: "manuscript",
    title: "The Letter",
    path: "",
    nodeId: "EL1",
    nodeKind: "section",
    order: 0,
    authority: "manuscript",
  },
  {
    id: "node:EL2",
    kind: "manuscript",
    title: "The Quay",
    path: "",
    nodeId: "EL2",
    nodeKind: "section",
    order: 1,
    authority: "manuscript",
  },
];
const BOOK = new Map([
  ["node:EL1", EARLIER],
  ["node:EL2", CHAPTER],
]);
const SOURCES = {
  list: async () => CATALOG,
  read: async (sourceId, range) => {
    const text = BOOK.get(sourceId);
    if (text === undefined) throw new Error("source-not-found");
    return {
      text: range ? text.slice(range.start, range.end) : text,
      revision: "r",
      origin: "project-file",
    };
  },
  allowedReaderSources: async () => new Set(BOOK.keys()),
};

const { server, load } = await moduleServer();
const failures = [];
try {
  const { composeCommentReply } = await load(
    "/src/ai/application/commentReply.ts",
  );
  const { textThrough } = await load("/src/ai/domain/comments.ts");
  const { PERSONAS } = await load("/src/ai/domain/personas.ts");
  const { PROSE_BOUNDARY, workflowInstructions } = await load(
    "/src/ai/domain/policy.ts",
  );
  const { composeVoice } = await load("/src/ai/domain/voice.ts");
  const { leaveCommentsTool } = await load("/src/ai/application/tools.ts");
  const { fenced } = await load("/src/ai/application/context.ts");
  const { runStep } = await load("/src/ai/application/runStep.ts");
  const { limitsFor } = await load("/src/ai/application/budgets.ts");
  const { splitForLater } = await load("/src/ai/domain/drafting.ts");
  const { anchorOfQuote, commentsPort } = await load(
    "/src/editor/assistant/commentsAdapter.ts",
  );
  const { Assistant } = await load("/src/ai/application/assistant.ts");
  const { CommentsService } = await load(
    "/src/editor/comments/application/comments.ts",
  );

  const editor = PERSONAS.find((one) => one.name === "Nova");
  const reader = PERSONAS.find((one) => one.name === "Lumi");
  const drafter = PERSONAS.find((one) => one.name === "Spark");
  const thread = {
    id: "t1",
    state: "open",
    passage: PASSAGE,
    entries: [
      {
        by: { kind: "writer" },
        body: "Does this land, or is the lighthouse too obvious a symbol? Did I set it up earlier in the book? Check before you answer.",
      },
    ],
  };
  const chapter = (text) => ({ sourceId: "node:EL2", title: "The Quay", text });
  const verdict = (name, ok, detail) => {
    console.log(
      `  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
    );
    if (!ok) failures.push(name);
  };
  const shown = (text) =>
    console.log(
      text
        .split("\n")
        .map((line) => `      | ${line}`)
        .join("\n"),
    );

  for (const modelId of MODELS) {
    const gate = await openRouterGate("openrouter", modelId);
    if (gate.refusal) {
      console.log(`\n${modelId}: ${gate.refusal}`);
      failures.push(`${modelId}: gate`);
      continue;
    }
    const model = new OpenRouter(
      process.env.PHOSPHEARE_OPENROUTER_KEY,
      gate.listing,
    );
    const modelRef = { providerId: "openrouter", modelId };
    const deps = {
      model,
      modelRef,
      personas: PERSONAS,
      sources: SOURCES,
      catalog: CATALOG,
      allowed: new Set(BOOK.keys()),
    };
    /** Every tool a reply called, by name and subject. */
    const calls = [];
    const heard = (activity) => {
      if (activity?.kind === "tool")
        calls.push(
          `${activity.tool}${activity.subject ? ` ${activity.subject}` : ""}`,
        );
    };
    const signal = () => new AbortController().signal;
    console.log(`\n${modelId}`);

    // 1. An editorial persona answers in the margin, after reading.
    try {
      calls.length = 0;
      const { text } = await composeCommentReply(
        deps,
        { persona: editor, chapter: chapter(CHAPTER), thread, margin: null },
        signal(),
        heard,
      );
      shown(text);
      const plain = !/^\s*(#|[-*] |\d+\. )/m.test(text);
      verdict(
        "margin reply",
        text.length > 0 && text.length < 1500 && plain,
        `${text.length} characters${plain ? "" : ", markdown"}`,
      );
      verdict(
        "margin reply reads the book",
        calls.length > 0,
        calls.join(", ") || "no tool called",
      );
    } catch (error) {
      verdict("margin reply", false, String(error?.failure?.code ?? error));
    }

    // 2. The reader answers from the text as far as the passage.
    try {
      calls.length = 0;
      const through = textThrough(CHAPTER, PASSAGE);
      const { text } = await composeCommentReply(
        deps,
        {
          persona: reader,
          chapter: chapter(through ?? ""),
          thread,
          margin: null,
        },
        signal(),
        heard,
      );
      shown(text);
      verdict(
        "reader reply",
        through !== null &&
          !through.includes("door already open") &&
          !/already open/i.test(text) &&
          text.length > 0,
        `read ${through?.length ?? 0} of ${CHAPTER.length} characters; ${calls.join(", ") || "no tool called"}`,
      );
    } catch (error) {
      verdict("reader reply", false, String(error?.failure?.code ?? error));
    }

    // 3. Notes left with the tool, on a general turn.
    try {
      const descriptor = await model.describeModel(modelRef);
      const result = await runStep(
        model,
        {
          model: modelRef,
          instructions: [
            PROSE_BOUNDARY,
            workflowInstructions("general"),
            composeVoice(editor, "general", undefined, PERSONAS).instructions,
          ].join("\n\n"),
          messages: [
            {
              role: "user",
              content: `${fenced("SOURCE", "node:EL2", "The Quay", [], CHAPTER)}\n\nWriter request:\nLeave notes in the margin of this chapter on whatever most needs my attention.`,
            },
          ],
          tools: [leaveCommentsTool(8)],
          limits: limitsFor(descriptor, 2_000),
        },
        signal(),
      );
      const calls = result.calls.filter((one) => one.name === "leave_comments");
      const notes = calls.flatMap((one) => {
        const args =
          typeof one.arguments === "string"
            ? JSON.parse(one.arguments)
            : one.arguments;
        return Array.isArray(args?.comments) ? args.comments : [];
      });
      for (const note of notes)
        shown(
          `[${note.weight}] ${note.quote ? `"${note.quote}" — ` : ""}${note.body}`,
        );
      const placeable = notes.filter(
        (note) => !note.quote || anchorOfQuote(CHAPTER, { text: note.quote }),
      );
      verdict(
        "leave_comments",
        notes.length > 0 && placeable.length === notes.length,
        `${notes.length} notes, ${placeable.length} placeable`,
      );
    } catch (error) {
      verdict("leave_comments", false, String(error?.failure?.code ?? error));
    }

    // 4. A drafting answer's notes for later.
    try {
      const descriptor = await model.describeModel(modelRef);
      const result = await runStep(
        model,
        {
          model: modelRef,
          instructions: [
            PROSE_BOUNDARY,
            workflowInstructions("drafting"),
            composeVoice(drafter, "drafting", undefined, PERSONAS).instructions,
          ].join("\n\n"),
          messages: [
            {
              role: "user",
              content: `${fenced("SOURCE", "node:EL2", "The Quay", [], CHAPTER)}\n\nThe writer wants a passage to react to, written as prose.\n\nWriter request:\nWrite the next paragraph: what Mara finds behind the open door.`,
            },
          ],
          tools: [],
          limits: limitsFor(descriptor, 2_000),
        },
        signal(),
      );
      const { answer, notes } = splitForLater(result.text);
      shown(answer.slice(0, 400));
      for (const note of notes)
        shown(
          `for later: ${note.quote ? `"${note.quote.text}" :: ` : ""}${note.body}`,
        );
      const placeable = notes.filter(
        (note) => !note.quote || anchorOfQuote(CHAPTER, note.quote),
      );
      verdict(
        "for-later",
        answer.length > 0 && placeable.length === notes.length,
        `${notes.length} notes (${notes.filter((one) => one.quote).length} on a passage), ${placeable.length} placeable`,
      );
    } catch (error) {
      verdict("for-later", false, String(error?.failure?.code ?? error));
    }

    // 5. A review into the margin, kept, dismissed, answered, reviewed again.
    try {
      await reviewIntoMargin(model, modelRef);
    } catch (error) {
      verdict("review into margin", false, String(error?.stack ?? error));
    }
  }

  /**
   * The margin's whole loop with a review behind it: the app's `Assistant`
   * runs the line review, its findings go through `divertFindings` and the
   * adapter into a `CommentsService` over an in-memory file; the writer's
   * keep, dismiss and question are the service's own commands, and the
   * persona's answer is `answerComment`.
   */
  async function reviewIntoMargin(model, modelRef) {
    const files = new Map();
    let ids = 0;
    const service = new CommentsService({
      store: {
        read: async (nodeId) =>
          files.has(nodeId)
            ? { kind: "text", text: files.get(nodeId) }
            : { kind: "missing" },
        write: async (nodeId, text) => void files.set(nodeId, text),
      },
      now: () => new Date().toISOString(),
      newId: () => `id${(ids += 1)}`,
    });
    await service.load(["EL1", "EL2"]);
    const outcomes = [];
    const port = commentsPort(service, async (nodeId) =>
      nodeId === "EL2" ? CHAPTER : nodeId === "EL1" ? EARLIER : null,
    );
    const comments = {
      ...port,
      async propose(nodeId, personaId, proposals) {
        const out = await port.propose(nodeId, personaId, proposals);
        outcomes.push(...out);
        return out;
      },
    };
    const catalog = CATALOG.map((one) => ({ ...one, revision: "r" }));
    const assistant = new Assistant({
      model,
      artifacts: memoryArtifacts(),
      sources: {
        ...SOURCES,
        list: async () => catalog,
        search: async () => [],
      },
      defaultNode: () => ({ id: "EL2", title: "The Quay", kind: "section" }),
      comments,
    });
    await assistant.initialize();
    await assistant.chats.create("editorial");
    await assistant.chats.updatePreferences({ model: modelRef });

    const review = async () => {
      outcomes.length = 0;
      const started = await assistant.reviews.run("line", { kind: "current" });
      const chat = assistant.activeChat();
      const turn = chat?.turns[chat.turns.length - 1];
      return { started, turn, problem: assistant.getSnapshot().problem };
    };
    const ghostsOf = () =>
      (service.fileOf("EL2")?.threads ?? []).filter(
        (one) => one.state === "proposed",
      );
    const where = (quote) => {
      const at = CHAPTER.indexOf(quote);
      return at < 0 ? null : [at, at + quote.length];
    };
    const overlaps = (a, b) => {
      const x = where(a);
      const y = where(b);
      return x !== null && y !== null && x[0] < y[1] && y[0] < x[1];
    };

    const first = await review();
    const ghosts = ghostsOf();
    for (const one of ghosts)
      shown(
        `[${one.weight}] "${one.anchor?.quote ?? "(chapter)"}" — ${one.entries[0].body.replace(/\n+/g, " ")}`,
      );
    verdict(
      "review leaves ghost comments",
      first.started === "started" && ghosts.length >= 1,
      `${ghosts.length} ghosts, ${first.turn?.findings?.length ?? 0} findings left in the chat, commented ${JSON.stringify(first.turn?.commented ?? [])}${first.problem ? `, problem ${JSON.stringify(first.problem)}` : ""}`,
    );
    if (ghosts.length === 0) return;

    // With one ghost there is nothing to keep beside the one dismissed: the
    // dismissal is still checked, and the kept thread's half is said skipped
    // rather than passed.
    const [dismissed, kept = null] =
      ghosts.length === 1 ? [ghosts[0]] : [ghosts[1], ghosts[0]];
    if (kept) await service.keep("EL2", kept.id);
    await service.remove("EL2", dismissed.id);
    const file = service.fileOf("EL2");
    verdict(
      kept ? "keep and dismiss" : "dismiss",
      (!kept ||
        file.threads.find((one) => one.id === kept.id)?.state === "open") &&
        !file.threads.some((one) => one.id === dismissed.id) &&
        file.dismissed.length === 1,
      `${file.dismissed.length} dismissal remembered`,
    );

    if (kept) {
      const persona = kept.entries[0].author.id;
      await service.reply(
        "EL2",
        kept.id,
        { kind: "writer" },
        "Why does this matter here? Say it in one or two sentences.",
      );
      const answered = await assistant.margin.answer({
        nodeId: "EL2",
        threadId: kept.id,
        personaId: persona,
      });
      const thread = service
        .fileOf("EL2")
        .threads.find((one) => one.id === kept.id);
      const last = thread?.entries[thread.entries.length - 1];
      if (last) shown(`${persona}: ${last.body}`);
      verdict(
        "persona answers in the kept thread",
        answered.ok && last?.author.kind === "persona" && last.body.length > 0,
        answered.ok ? `${last?.body.length ?? 0} characters` : answered.reason,
      );
    } else
      console.log(
        "  SKIP persona answers in the kept thread — one ghost, none kept",
      );

    const second = await review();
    const again = ghostsOf();
    for (const one of again)
      shown(`again [${one.weight}] "${one.anchor?.quote ?? "(chapter)"}"`);
    const quoteOf = (one) => one.anchor?.quote ?? "";
    const reraised = again.filter((one) =>
      overlaps(quoteOf(one), quoteOf(dismissed)),
    );
    const refused = outcomes.filter((one) => one === "dismissed").length;
    verdict(
      "second review leaves the dismissed passage alone",
      second.started === "started" && reraised.length === 0,
      `${refused} refused as dismissed, ${reraised.length} re-raised over the dismissed words`,
    );
    if (kept) {
      // Every passage the kept note names: its anchor, and the other places
      // a finding cites, which the note carries as quotations (`noteOf`). A
      // review that comes back to the same slip may anchor it on any of them.
      const keptQuotes = [
        quoteOf(kept),
        ...[...kept.entries[0].body.matchAll(/“([^”]+)”/g)].map(
          (match) => match[1],
        ),
      ];
      const doubled = again.filter((one) =>
        keptQuotes.some((quote) => overlaps(quoteOf(one), quote)),
      );
      verdict(
        "second review does not raise the kept one again",
        doubled.length === 0,
        `${outcomes.filter((one) => one === "duplicate").length} refused as duplicates, ${doubled.length} new ghosts over the kept words`,
      );
    } else
      console.log(
        "  SKIP second review does not raise the kept one again — none kept",
      );
    assistant.dispose?.();
    service.dispose();
  }

  /** The chats and checkpoints a run keeps, in memory. */
  function memoryArtifacts() {
    const chats = new Map();
    const reviews = new Map();
    return {
      listChats: async () => ({ chats: [...chats.values()], unreadable: [] }),
      loadChat: async (id) => {
        if (!chats.has(id)) throw new Error("missing-chat");
        return chats.get(id);
      },
      saveChat: async (chat) => {
        chats.set(chat.id, structuredClone(chat));
        return {};
      },
      deleteChatFile: async () => {},
      deleteChat: async (id) => void chats.delete(id),
      saveReview: async (one) =>
        void reviews.set(one.runId, structuredClone(one)),
      loadReview: async (id) => {
        if (!reviews.has(id)) throw new Error("missing-review");
        return reviews.get(id);
      },
      deleteReview: async (id) => void reviews.delete(id),
      readSummary: async () => null,
      writeSummary: async () => {},
      readLedger: async () => null,
      writeLedger: async () => {},
      readJudgements: async () => null,
      writeJudgements: async () => {},
      readEntities: async () => null,
      writeEntities: async () => {},
    };
  }
} finally {
  await server.close();
}
console.log(
  failures.length ? `\nFailed: ${failures.join(", ")}` : "\nAll passed.",
);
process.exitCode = failures.length ? 1 : 0;
