// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The ordinary chat turn ───────────────────────────────────────────────────
//
// A chat turn (context, history, tools, search, the step loop, the closing
// call, the endings) is a function of the writer's question and a host
// (`TurnHost`), so what a run reads and writes of the assistant's state is a
// list, not `this`.

import type {
  ChatRecord,
  ChatTurn,
  ContextUse,
  Finding,
  ModelMessage,
  PersonaDefinition,
  ReviewTask,
  RunActivity,
  RunUsage,
  SourceDescriptor,
  TurnCommand,
  ToolCall,
  ToolReceipt,
  TurnTrace,
} from "../domain/types";
import { runElapsedMs } from "../domain/runClock";
import { withTurn, type ChatWrites } from "./chatWrites";
import { relevanceTerms } from "../domain/relevance";
import { commentsBlock, divertFindings, keepForLater } from "./comments";
import { lastWebIndexOf } from "../domain/webCitations";
import { searchesWeb } from "../domain/webEngine";
import { appendThought, recordToolCall, setStepText } from "../domain/trace";
import { PERSONAS } from "../domain/personas";
import { composeVoice } from "../domain/voice";
import { briefingOf } from "../domain/signals/briefing";
import { chatKindNames, joinReads } from "../domain/rooms";
import { partsOf, replanned, shownOf } from "../domain/answerParts";
import { unfoundQuotes } from "../domain/quoteCheck";
import { isFactTask } from "../domain/policy";
import { bookFactCheck } from "./factList";
import {
  STANDARD,
  chatMode,
  samplingFields,
  samplingFor,
} from "../domain/mode";
import { DEFAULT_CONTEXT_TOKENS, budgetFor } from "./budgets";
import {
  missingMessage,
  missingWants,
  projectManifest,
  referenceMessage,
  referenceUsage,
  selectContext,
  selectReferences,
  ReviewReferenceError,
} from "./context";
import {
  compactHistory,
  replayedManuscript,
  requestHistory,
  stripAbsorbedReceipts,
} from "./history";
import { ModelRunError, mergeUsage, throwIfCancelled } from "./runStep";
import { callSubject, runToolLoop } from "./toolLoop";
import {
  manuscriptTextsOf,
  quotableTextsOf,
  receiptOf,
  toFindings,
  toolsFor,
  type RawFinding,
  type ToolContext,
} from "./tools";
import { SearchPause, type SearchPauseDependencies } from "./searchAsk";
import { nextSection } from "../domain/reading";
import {
  NEED_LINES,
  needFor,
  momentumLine,
  needOfCommand,
  returningTo,
  visit,
} from "../domain/drafting";
import {
  commandLine,
  readsFor,
  autonomousSkills,
  skillFor,
  skillsFor,
} from "../domain/skills";
import { declaredSources } from "../domain/sourceView";
import {
  reviewReads,
  wantsOf,
  reviewsFocused,
  chatTitleFrom,
} from "./chatFacts";
import { now, webOf, runProblemOf } from "./runRecords";
import { newId } from "./ids";
import { stoppedLine } from "./roomMemory";
import { SignalPass } from "./signalPass";
import { skillPickup } from "./skillPickup";
import { requestMessage, turnInstructions } from "./turnPrompt";
import { letterEvidence } from "./letterEvidence";
import { declaredReads, namedReferences, questionReads } from "./chatFacts";
import { focusedCoverage, refAddress, sourceMessage } from "./context";
import { readerMemory } from "./readingJournal";
import { withSkillDetectors } from "../domain/obsessions";
import { commentedBy } from "../domain/comments";
import type {
  AssistantDependencies,
  AssistantSnapshot,
} from "./assistantTypes";
import { appLog, describeError } from "../../log";

/**
 * What a turn may use of the aggregate. The run reads the live snapshot
 * through `snapshot()`, because the state is replaced on every publish and a
 * captured copy would go stale. `setAbort` is how Stop reaches the run.
 */
export interface TurnHost {
  readonly dependencies: AssistantDependencies;
  readonly writes: ChatWrites;
  /** Chats deleted while a run was in flight: nothing is written to one. */
  readonly deletedChats: ReadonlySet<string>;
  snapshot(): AssistantSnapshot;
  isDisposed(): boolean;
  setAbort(abort: AbortController | null): void;
  publish(patch: Partial<AssistantSnapshot>): void;
  resolvePersona(chat: ChatRecord): PersonaDefinition | null;
  readerBoundary(
    chat: ChatRecord,
  ): Promise<
    | { ok: true; allowed: ReadonlySet<string>; catalog: SourceDescriptor[] }
    | { ok: false }
  >;
  searchPauseFor(
    webSearch: SearchPauseDependencies["webSearch"],
    run: Pick<
      SearchPauseDependencies,
      | "model"
      | "account"
      | "signal"
      | "lastWebIndex"
      | "bookTexts"
      | "onRecords"
    >,
  ): SearchPause;
  releasePause(pause: SearchPause | null): void;
  validateTurnFindings(
    findings: Finding[],
    used: ContextUse[],
  ): Promise<Finding[]>;
}

export async function runTurn(
  host: TurnHost,
  chatId: string,
  text: string,
  quote?: string,
  onStarted?: () => void,
  command?: TurnCommand,
): Promise<"started" | "rejected"> {
  let chat = host.snapshot().chats.find((one) => one.id === chatId) ?? null;
  if (!chat) return "rejected";
  // The record the run starts from. Every write lays the run's copy onto the
  // chat as it is then (`ontoLatest`): what the run changed is the run's, and
  // the rest (a model switch, a rename, a plan tick) is the writer's.
  const started = chat;

  const persona = host.resolvePersona(chat);
  if (persona === null) {
    host.publish({
      problem: {
        kind: "persona-missing",
        personaId: chat.preferences.personaId,
      },
      error: null,
    });
    return "rejected";
  }
  const model = chat.preferences.model;
  if (!model) {
    host.publish({
      error: null,
      errorCode: "not-configured",
      problem: null,
    });
    return "rejected";
  }

  // General chats follow the open file by default; the captured target is
  // recorded on the context uses and never changes mid-run.
  const current = host.dependencies.defaultNode();
  if (chat.kind === "general" && current)
    chat = {
      ...chat,
      preferences: { ...chat.preferences, targetNodeId: current.id },
    };

  const boundary = await host.readerBoundary(chat);
  if (!boundary.ok) return "rejected";
  // The chat may have been deleted while the boundary's list was in flight;
  // a run that publishes `runningChatId` afterwards would be uncancellable,
  // because the delete's abort predicate reads that field.
  if (host.deletedChats.has(chatId)) return "rejected";
  const allowed = boundary.allowed;
  const catalog = boundary.catalog;
  // A command that cannot do its job without a document the writer has not
  // written is refused here, before the question exists: answering around
  // the gap would be a guess dressed as a reading, and the writer is better
  // served by the document (`AiSkill.needs`). Read through the same allowed
  // set as everything else, so a reader is only asked for what its horizon
  // lets it see.
  const commandSkill = command
    ? skillFor(command.skill, skillsFor(chat.kind))
    : null;
  if (commandSkill && commandSkill.needs.length > 0) {
    const unwritten = await missingWants(
      host.dependencies.sources,
      catalog,
      allowed,
      commandSkill.needs,
      new Set(),
    );
    if (unwritten.length === commandSkill.needs.length) {
      host.publish({
        problem: {
          kind: "reference-needed",
          command: commandSkill.command,
          needs: unwritten,
        },
        error: null,
      });
      return "rejected";
    }
  }

  const user: ChatTurn = {
    id: newId(),
    runId: newId(),
    role: "user",
    text,
    quote,
    // What the writer typed, when a command asked this for them: the
    // bubble shows it, and `text` stays what was sent.
    ...(command ? { command } : {}),
    createdAt: now(),
    outcome: "complete",
  };
  const assistantTurn: ChatTurn = {
    id: newId(),
    runId: user.runId,
    role: "assistant",
    text: "",
    createdAt: now(),
    outcome: "interrupted",
    // What this turn says if nothing ever rewrites it: the editor closed or
    // reloaded mid-answer. Every ending replaces the code (Stop with
    // `cancelled`, a failure with its own, an answer with none), so only a
    // run that never reached an ending keeps it, and the transcript can
    // tell the writer which of those happened.
    errorCode: "interrupted",
  };
  // The question and its placeholder are shown at once (`preview`) but held
  // off the disk until the context is assembled. A reference the writer
  // named that is gone, empty or too long refuses only there, after any
  // compaction, since the set may spend what the history left. A refusal
  // must find nothing written and nothing started. `ask` writes them once
  // nothing can refuse any more, and a failure writes them as a run that
  // happened.
  //
  // The drafting room's memory: the Section being drafted, the need the
  // writer gave for it (a command that serves a need says it too, so typing
  // `/unstick` also answers the room's question), and whether this answer's
  // for-later notes are kept apart.
  const drafting = chat.kind === "drafting";
  const draftingNode = drafting
    ? host.dependencies.defaultNode()?.id
    : undefined;
  const said = drafting && command ? needOfCommand(command.skill) : null;
  const need = drafting ? (said ?? needFor(chat.drafting, draftingNode)) : null;
  // Back on a Section this chat worked on before: judged from the turns
  // before this one, with the momentum line read fresh later.
  const returning = drafting && returningTo(chat.drafting, draftingNode);
  const drafted =
    drafting && draftingNode
      ? visit(chat.drafting, draftingNode)
      : chat.drafting;
  let working: ChatRecord = {
    ...chat,
    updatedAt: now(),
    turns: [...chat.turns, user, assistantTurn],
    ...(said
      ? {
          drafting: {
            ...drafted,
            need: {
              kind: said,
              ...(draftingNode ? { nodeId: draftingNode } : {}),
              at: now(),
            },
          },
        }
      : drafted
        ? { drafting: drafted }
        : {}),
  };
  host.writes.previewRun(started, working);
  let asked = false;
  const ask = async (): Promise<boolean> => {
    asked = true;
    try {
      await host.writes.persistRun(started, working);
    } catch (err) {
      appLog.error("ai", "A question could not be saved.", {
        chat: chatId,
        ...describeError(err),
      });
      host.publish({
        error: "Your message could not be saved.",
        problem: null,
      });
      return false;
    }
    if (host.deletedChats.has(chatId)) return false;
    // An edit waits for this to offer its Undo.
    onStarted?.();
    return true;
  };
  // The placeholder's stamp is the run's one start instant: the live clock
  // in the turn counts from it, and every ending stores the same
  // subtraction, so the number the clock freezes on is the last one it
  // showed rather than a second measurement that disagrees by a second.
  //
  // A wait on the writer is theirs, not the run's: a web search's ask can
  // hold a run for as long as they take, and the clock leaves it out.
  // The pause lives only inside the run.
  let pause: SearchPause | null = null;
  const elapsed = () =>
    runElapsedMs(assistantTurn.createdAt, pause?.waitedMs ?? 0, now());

  const abort = new AbortController();
  host.setAbort(abort);
  const signal = abort.signal;
  host.publish({
    running: true,
    preparing: true,
    activity: { kind: "preparing" },
    runningChatId: chat.id,
    runWaitedMs: 0,
    error: null,
    errorCode: null,
    problem: null,
    conflictFile: null,
  });
  const used: ContextUse[] = [];
  const receipts: ToolReceipt[] = [];
  const findings: Finding[] = [];
  let usage: RunUsage = { steps: 0 };
  try {
    // The book's facts, read once: a change of its language or genre while
    // the run lasts never gives one turn two answers.
    const facts = host.dependencies.projectFacts?.() ?? null;
    const descriptor = await host.dependencies.model.describeModel(
      model,
      signal,
    );
    // The chat's Mode, on every step of the answer and only there:
    // compaction asks with Standard, like every other piece of housekeeping
    // (`domain/mode.ts`). Resolved before the budget, because an effort the
    // model is sent needs its thinking reserve carved out of the window
    // (`THINKING_STEP_TOKENS`).
    const sampling = samplingFields(
      samplingFor(chatMode(chat.preferences)),
      descriptor,
    );
    const budget = budgetFor(descriptor, sampling.effort);
    const limits = {
      inputTokens: budget.inputTokens,
      outputTokens: budget.outputTokens,
    };
    // Named once, from the description the run fetched anyway: the panel's
    // own model list loads only when its menu opens, so it cannot be what
    // the status line reads.
    const waiting: RunActivity = {
      kind: "waiting",
      model: descriptor.label || model.modelId,
    };
    throwIfCancelled(signal);

    // A command that reads the book's opening (`/first-pages`) reads its
    // first Section whatever is open, for this turn only: the chat keeps
    // its own target.
    const opening =
      commandSkill?.target === "opening"
        ? nextSection(catalog, undefined)?.nodeId
        : undefined;
    const selection = await selectContext(
      host.dependencies.sources,
      catalog,
      opening
        ? {
            ...working,
            preferences: { ...working.preferences, targetNodeId: opening },
          }
        : working,
      allowed,
      budget,
    );
    used.push(...selection.uses);
    throwIfCancelled(signal);

    // ── What this run offers ─────────────────────────────────────────────────
    //
    // Decided once: the same answer sets the tool list, builds the pause and
    // gives the tool context its search. Search needs an account now, and
    // every send must still be it; the chat kind's horizon must survive the
    // web. Leaving it off a command turn costs the prefix cache, since the
    // tools block heads the prompt, and buys a tool that cannot be called
    // where it was never meant to be.
    const webSearch = host.dependencies.webSearch;
    const account = webSearch?.accountId() ?? null;
    // The skills the persona may pick up itself: never on a turn that already
    // runs one (a typed command, or a focused review, whose rubric is the
    // task).
    const skillsOffered =
      descriptor.capabilities.tools &&
      command === undefined &&
      !reviewsFocused(chat)
        ? autonomousSkills(chat.kind)
        : [];
    // Not in a focused review, whose findings go to the margin on their own
    // (`divertFindings`). A reader's notes stay inside its horizon: the tool
    // checks every chapter against `allowed`.
    const marginPort = host.dependencies.comments;
    const offersComments =
      marginPort !== undefined &&
      !reviewsFocused(chat) &&
      descriptor.capabilities.tools;
    /** What this run's own notes placed, chapter by chapter. */
    const notesLeft = new Map<string, number>();
    const offer = {
      skills: skillsOffered,
      findings: reviewsFocused(chat),
      ...(offersComments && marginPort ? { comments: marginPort.cap } : {}),
      web:
        webSearch !== undefined &&
        account !== null &&
        searchesWeb(chat.kind) &&
        command === undefined &&
        !reviewsFocused(chat) &&
        descriptor.capabilities.tools,
    };
    const tools = descriptor.capabilities.tools
      ? toolsFor(offer, budget.readWindow)
      : [];
    // The history replays only calls to tools this run declares: a vendor
    // refuses a call that names an undeclared tool, and a model without tool
    // support refuses any tool message at all.
    const replayTools = new Set(tools.map((tool) => tool.name));

    // History may need compaction before the first step; that call is part
    // of the run ledger and shown as the context-preparing state. The
    // assistant placeholder is not history: it is the turn being made.
    const historySource = {
      ...working,
      turns: working.turns.filter((turn) => turn.id !== assistantTurn.id),
    };
    let history = requestHistory(historySource, budget, allowed, replayTools);
    if (history.overBudget) {
      host.publish({ preparing: true });
      const compaction = await compactHistory(
        historySource,
        host.dependencies.model,
        model,
        signal,
        limits,
        Math.floor(budget.historyCharacters / 2),
        samplingFields(STANDARD, descriptor),
        allowed,
        replayTools,
      );
      usage = mergeUsage(usage, compaction.usage);
      // The absorbed turns' receipts lose their replay half here:
      // `requestHistory` never slices back past this point, so every retained
      // result older than it is prose the chat file would carry forever and
      // nothing would read.
      working = stripAbsorbedReceipts(
        { ...working, compactedHistory: compaction.compaction },
        compaction.compaction.coversThroughTurnId,
      );
      history = requestHistory(
        {
          ...working,
          turns: working.turns.filter((t) => t.id !== assistantTurn.id),
        },
        budget,
        allowed,
        replayTools,
      );
    }
    throwIfCancelled(signal);

    // References come last of the three, because they are what yields: the
    // Section is required and the history is the conversation, so both are
    // spent before the references get what is left. A declared reference
    // must never tip a turn over the window and refuse the run.
    //
    // A reference the writer named is the exception: it is
    // required, so it may spend everything the Section and the history
    // left, and a set that does not fit refuses rather than yields.
    const named = namedReferences(chat);
    // A named review reads what the writer named and its brief, never the
    // room's paperwork too: a name narrows and never widens.
    const reads = named
      ? reviewReads(chat)
      : joinReads(declaredReads(chat), questionReads(chat, command));
    // How to use the references this chat reads: app text, from the
    // pages its reads reach in the catalogue rather than what this turn
    // attached, so it holds turn to turn. It is about the references, so it
    // is paid for from theirs: a reference gives way to it, and the turn
    // never refuses for it. At most a quarter of their room, past which it
    // names the pages rather than explain them, and then glosses the
    // headings; a larger share lets a small window spend the room on the key
    // and leave out the sheet the request named.
    const referenceClause = referenceUsage(
      declaredSources(catalog, allowed, reads),
      Math.floor(budget.referenceCharacters / 4),
      reads,
    );
    const referenceBudget = {
      ...budget,
      referenceCharacters: Math.max(
        0,
        budget.referenceCharacters - referenceClause.length,
      ),
      totalCharacters: budget.totalCharacters - referenceClause.length,
    };
    const declared = await selectReferences(
      host.dependencies.sources,
      catalog,
      allowed,
      reads,
      named && {
        ids: named,
        room:
          referenceBudget.totalCharacters -
          selection.uses.reduce((sum, use) => sum + use.characters, 0) -
          history.characters,
      },
      selection,
      history.characters,
      referenceBudget,
      // What this turn is about: the writer's words and the names the
      // attached prose uses, for a declared document that does not fit
      // whole.
      relevanceTerms(text, [...selection.texts.values()]),
      text,
    );
    used.push(...declared.uses);
    throwIfCancelled(signal);
    // What the room relies on and the writer has not written yet: the
    // persona asks for it rather than guessing. Never in a beta chat, where
    // a stranger cannot ask the author for anything and the panel says it
    // instead, and never for a named review, which reads what the writer
    // named and nothing else.
    const missing =
      chat.kind === "beta-reader" || named
        ? []
        : await missingWants(
            host.dependencies.sources,
            catalog,
            allowed,
            wantsOf(chat),
            new Set(declared.uses.map((use) => use.id)),
          );
    throwIfCancelled(signal);
    if (!(await ask())) return "rejected";

    /** The writer's words this run's reads showed the model. */
    const readTexts: string[] = [];
    /** Every text this run's calls showed the model, for its quotations. */
    const shownTexts: string[] = [];
    if (offer.web && webSearch && account !== null) {
      pause = host.searchPauseFor(webSearch, {
        model,
        account,
        signal,
        lastWebIndex: lastWebIndexOf(working.turns),
        bookTexts: () => [
          // The room's and the focus's declared references too: the rooms
          // read the writer's Guidebook on every turn, so a question that
          // searches carries them beside the prose, and a query that quotes
          // a logline leaks it as surely as one that quotes a chapter.
          ...declared.texts.values(),
          ...selection.texts.values(),
          ...replayedManuscript(history.messages),
          ...working.turns.flatMap((turn) => (turn.quote ? [turn.quote] : [])),
          ...readTexts,
        ],
        onRecords: async (records) => {
          working = withTurn(working, assistantTurn.id, {
            web: [...records],
          });
          host.writes.previewRun(started, working);
          await host.writes.persistRun(started, working);
        },
      });
    }
    // ── The signal pre-pass ──────────────────────────────────────────────────
    //
    // Candidates for this persona's own obsessions (`SignalPass`). Only
    // where the prose is what is being read (an editor's turn, or a drafting
    // writer who asked for a check), because a list beside "what happens
    // next?" becomes the answer.
    const attachedProse = selection.uses.filter(
      (use) => use.kind === "manuscript",
    );
    // The voice's own obsessions first, then the detectors of the domains
    // the task's skill serves: a typed command's from the start, a skill
    // picked up from the moment it is, so the Sections read after it carry
    // that skill's candidates too.
    const prepass =
      chat.kind === "editorial" ||
      (chat.kind === "drafting" && need === "check");
    const voiceObsessions = prepass
      ? composeVoice(persona, chat.kind, chat.preferences.preset, PERSONAS)
          .obsessions
      : [];
    const pass = prepass
      ? new SignalPass(
          commandSkill
            ? withSkillDetectors(voiceObsessions, commandSkill)
            : voiceObsessions,
          facts?.languageCode,
          attachedProse.map((use) => ({
            id: use.id,
            text: selection.texts.get(use.id) ?? "",
          })),
        )
      : null;
    const momentum =
      returning && draftingNode ? await stoppedLine(host, draftingNode) : null;
    // The app's fact check (`factList.ts`): run once, and only when a fact
    // check needs it (a typed `/continuity` or `/canon`, or either picked up
    // mid-answer), kept to what touches the prose attached to this run when
    // there is any. Its ledgers are read by this chat's model and kept, so a
    // second check reads only what changed.
    let factCheck: Promise<string> | null = null;
    const bookFacts = (task: ReviewTask) =>
      (factCheck ??= Promise.resolve()
        .then(() =>
          bookFactCheck(
            host.dependencies.sources,
            catalog,
            allowed,
            {
              task,
              ...(attachedProse.length > 0
                ? { focus: new Set(attachedProse.map((use) => use.id)) }
                : {}),
              // A review the writer named a reference for holds the prose
              // against that reference and no other sheet.
              ...(named ? { sheets: new Set(named) } : {}),
            },
            {
              sources: host.dependencies.sources,
              artifacts: host.dependencies.artifacts,
              model: host.dependencies.model,
              descriptor,
              modelRef: model,
              language: facts?.language,
            },
            signal,
            (activity) => host.publish({ activity }),
            // What the command declares beyond the fact sheets (the
            // continuity guide, the notes), read into the check as well and
            // narrowed to the named reference when one was named; their
            // records reach the judge too.
            declaredSources(catalog, allowed, readsFor(task)).filter(
              (one) => !named || named.includes(one.id),
            ),
          ),
        )
        .then((check) => {
          usage = mergeUsage(usage, check.usage);
          return check.message;
        }));
    const useSkill = skillPickup({
      dependencies: host.dependencies,
      catalog,
      allowed,
      skills: skillsOffered,
      chat,
      chats: () => host.snapshot().chats,
      question: text,
      reads,
      declared,
      referenceClause,
      budget,
      used,
      pass,
      bookFacts,
    });
    const toolContext: ToolContext = {
      sources: host.dependencies.sources,
      useSkill: skillsOffered.length > 0 ? useSkill : undefined,
      signals: pass ? (sourceId, read) => pass.scan(sourceId, read) : undefined,
      // Resolved once at the boundary and handed to every tool: the
      // adapter's listing re-reads every generated summary, and the model
      // drives its own retrieval across many steps.
      catalog,
      allowed,
      used,
      budget,
      submitFindings: offer.findings
        ? (raw: RawFinding[]) => {
            findings.push(...toFindings(raw, newId));
            return { accepted: raw.length, rejected: [] };
          }
        : undefined,
      leaveComments:
        offersComments && marginPort
          ? async (nodeId, proposals) => {
              const outcomes = await marginPort.propose(
                nodeId,
                persona.id,
                proposals,
              );
              const placed = outcomes.filter((one) => one === "placed");
              if (placed.length > 0)
                notesLeft.set(
                  nodeId,
                  (notesLeft.get(nodeId) ?? 0) + placed.length,
                );
              return outcomes;
            }
          : undefined,
    };
    // ── A model without tools ────────────────────────────────────────────────
    //
    // A model that reports no tool capability (`llama3:latest` reports only
    // `completion`) runs with no tools, and the writer is told so: otherwise
    // an assistant that cannot reach the project looks like one that chose
    // not to. The review path refuses on the same condition; a chat does
    // not, because a chat-only model can still answer about what is attached.
    if (!descriptor.capabilities.tools)
      host.publish({
        problem: { kind: "model-capability-missing", capability: "tools" },
      });

    // ── The request, ordered by rate of change (`turnPrompt.ts`) ────────────
    const manifest = projectManifest(catalog, allowed, budget.manifestRows);
    // A typed fact check's list, beside the prose it is about.
    const commandFacts =
      commandSkill?.reviewTask && isFactTask(commandSkill.reviewTask)
        ? await bookFacts(commandSkill.reviewTask)
        : "";
    // The margin of the chapters attached, for the voice answering: beside
    // their prose, never in the instructions, because an editor's comment
    // comes from outside the book.
    const margin = await commentsBlock(
      host.dependencies.comments,
      chat.kind,
      selection.uses,
      persona.id,
      (id) => PERSONAS.find((one) => one.id === id)?.name ?? null,
      budget,
    );
    // What the book's other chats found, for an editor's letter: the one
    // open lane between chats. Readers and drafting flow to the editor, and
    // nothing flows back.
    const letter =
      commandSkill?.evidence === "rooms" && chat.kind === "editorial"
        ? await letterEvidence(
            host.snapshot().chats,
            chat,
            catalog,
            host.dependencies.comments,
          )
        : "";
    throwIfCancelled(signal);
    const baseMessages: ModelMessage[] = [...history.messages];
    const lastHistory = baseMessages.pop();
    baseMessages.push({
      role: "user",
      content: requestMessage({
        references: referenceMessage(declared),
        missing: missingMessage(
          missing,
          host.dependencies.referenceLabel ?? refAddress,
        ),
        readerMemory:
          chat.kind === "beta-reader" ? readerMemory(chat, catalog) : "",
        need: need ? NEED_LINES[need] : "",
        momentum: momentum ? momentumLine(momentum) : "",
        chatNames:
          chat.kind === "general" || chat.kind === "drafting"
            ? chatKindNames(chat.kind, host.dependencies.chatKindLabel)
            : "",
        letter,
        briefing: briefingOf(pass?.attached ?? []),
        facts: commandFacts,
        manifest,
        sources: sourceMessage(selection.uses, selection.texts),
        margin,
        request: lastHistory?.content ?? text,
        command: command !== undefined,
      }),
    });
    // Everything before the final user message is this run's stable prefix:
    // the compaction and the earlier turns, none of which change while the
    // run lasts. The volatile block (a review's references, index, attached
    // prose, question) is that last message, by the rate-of-change order.
    // Providers that reuse a prefix on their own ignore this; Anthropic has
    // to be told where the boundary is.
    const cacheBreakpoint = Math.max(0, baseMessages.length - 1);
    const instructions = turnInstructions({
      facts,
      kind: chat.kind,
      reviewTask: chat.preferences.reviewTask,
      named: Boolean(named),
      referenceClause: declared.uses.length > 0 ? referenceClause : "",
      persona: persona.instructions,
    });

    let lastCheckpoint = performance.now();
    // A long answer, or a long think, is saved as it goes rather than only
    // at its end: a reload mid-run keeps what had arrived.
    const checkpoint = async () => {
      if (performance.now() - lastCheckpoint < 2_000) return;
      lastCheckpoint = performance.now();
      await host.writes.persistRun(started, working);
    };
    /**
     * How this run is reaching its answer, step by step, capped. Shown in
     * the turn's fold as it streams; never replayed, and never the answer
     * (`ChatTurn.trace`).
     */
    let trace: TurnTrace | undefined;
    /** The step being run: the loop's steps, then the closing call. */
    let at = -1;
    const think = async (piece: string) => {
      trace = appendThought(trace, at, piece);
      working = withTurn(working, assistantTurn.id, { trace });
      host.writes.previewRun(started, working);
      await checkpoint();
    };

    // ── A step's states ──────────────────────────────────────────────────────
    //
    // Waiting, thinking, writing. Each state starts on the event that proves
    // it and never before: a request that has left is `waiting`
    // until a byte comes back, `thinking` on the first reasoning event of
    // any length, since an encrypted think arrives as empty pieces, and
    // `writing` on the first word of prose. Never backwards within a step: a
    // stray reasoning event after the prose has started does not un-start
    // it. Only the first event of each kind publishes; these run per token,
    // and republishing the same fact hundreds of times a second would
    // re-render the panel for no change in it.
    const thinking = () => {
      if (host.snapshot().activity?.kind === "waiting")
        host.publish({ activity: { kind: "thinking" } });
    };
    const stream = async (partial: string) => {
      if (host.snapshot().activity?.kind !== "writing")
        host.publish({ activity: { kind: "writing" } });
      // A drafting answer's for-later notes are never shown as it streams:
      // the writer mid-scene reads help, not the critique held back.
      working = withTurn(working, assistantTurn.id, {
        text: shownOf(chat.kind, partial),
      });
      host.writes.previewRun(started, working);
      await checkpoint();
    };
    const stepOptions = {
      onText: stream,
      onReasoning: think,
      onThinking: thinking,
    };

    /**
     * A call's receipt, written the moment it settles into the turn's tools
     * and its trace, published live, so the trace can show a read while the
     * model is still deciding what to do with it.
     */
    const record = (call: ToolCall, value: unknown) => {
      receipts.push(receiptOf(call, value));
      if (pause) readTexts.push(...manuscriptTextsOf(call, value));
      shownTexts.push(...quotableTextsOf(value));
      trace = recordToolCall(trace, at, call.id);
      working = withTurn(working, assistantTurn.id, {
        tools: [...receipts],
        trace,
      });
      host.writes.previewRun(started, working);
    };

    host.publish({ preparing: false });
    // The loop is shared with the margin (`toolLoop.ts`); what is the
    // dock's (its activity line, the turn's receipts and trace) is said here.
    const loop = await runToolLoop({
      provider: host.dependencies.model,
      request: {
        model,
        instructions,
        tools,
        limits,
        cacheBreakpoint,
        ...sampling,
      },
      messages: baseMessages,
      budget,
      toolContext,
      pause,
      signal,
      step: stepOptions,
      sink: {
        stepStarted: () => {
          host.publish({ activity: waiting });
          at += 1;
        },
        saidOnTheWay: (said) => {
          // Into the trace in the same write that clears it from the
          // answer, so it never lingers until the next step's first word.
          if (said.trim()) trace = setStepText(trace, at, said);
          working = withTurn(working, assistantTurn.id, {
            text: "",
            trace,
          });
          host.writes.previewRun(started, working);
        },
        // Named before it runs: a tool that takes seconds to read a chapter
        // is the wait this line exists for.
        calling: (call) =>
          host.publish({
            activity: {
              kind: "tool",
              tool: call.name,
              ...callSubject(call.arguments, catalog),
            },
          }),
        settled: record,
      },
    });
    usage = mergeUsage(usage, loop.usage);
    const textOut = loop.text;
    const ending = loop.ending;

    const checkedFindings = findings.length
      ? await host.validateTurnFindings(findings, used)
      : [];
    // A finding about one chapter's words leaves for the margin, as a ghost
    // comment beside them (`divertFindings`), from a finished answer only:
    // an interrupted one's findings stay where the writer can see the answer
    // they came with.
    const { findings: validated, commented } =
      ending.outcome === "complete"
        ? await divertFindings(
            host.dependencies.comments,
            checkedFindings,
            catalog,
            persona.id,
          )
        : { findings: checkedFindings, commented: [] };
    // The answer's text, and the blocks that leave it (`partsOf`). A pointer
    // to another chat is checked against the book: a reader is only set to
    // read through a Section the catalogue holds.
    const { held, planned, checked, routed, answerText } = partsOf(
      chat.kind,
      textOut,
      new Set(
        catalog.flatMap((one) =>
          one.nodeKind === "section" && one.nodeId !== undefined
            ? [one.nodeId]
            : [],
        ),
      ),
    );
    // The notes a drafting answer kept for later go to the margin of the
    // Section being drafted, as ghost comments (`keepForLater`). From a
    // finished answer only, as findings are: an interrupted one may have
    // stopped mid-note. With no Section open there is no margin to leave
    // them in, and they go with the answer's block: the room's rule is that
    // critique waits, not that it is kept anywhere.
    if (
      held &&
      draftingNode &&
      host.dependencies.comments &&
      ending.outcome === "complete"
    ) {
      const placed = await keepForLater(
        host.dependencies.comments,
        draftingNode,
        persona.id,
        held.notes,
      );
      if (placed > 0)
        notesLeft.set(
          draftingNode,
          (notesLeft.get(draftingNode) ?? 0) + placed,
        );
    }
    // Only a letter that ended changes the plan (`replanned`): one cut off by
    // Stop or the output allowance holds part of a plan at most, and folded
    // it would replace the whole one. The verdicts and the new items land on
    // the plan as it is when the answer is saved (`settle` below), so an
    // item the writer ticked meanwhile stays ticked, whether its save has
    // landed yet or waits behind the answer's.
    const replan =
      ending.outcome === "complete" && planned
        ? (current: ChatRecord["plan"]) =>
            replanned(current, { planned, checked }, assistantTurn.id, newId)
        : null;
    // The answer's quotations, looked for in everything this run and the
    // history it carried showed the model, and in the writer's own words
    // (`quoteCheck.ts`).
    const unfound = unfoundQuotes(answerText, [
      ...selection.texts.values(),
      ...declared.texts.values(),
      ...replayedManuscript(history.messages),
      ...shownTexts,
      // The request's own message: the index, the documents it names as
      // unwritten and the other chats' names are all shown to the model, and
      // an answer that names one in quotation marks, such as a Guidebook
      // section named as missing, quotes what it was given.
      ...baseMessages.slice(-1).map((message) => message.content),
      ...working.turns.flatMap((turn) =>
        turn.role === "user"
          ? [turn.text, ...(turn.quote ? [turn.quote] : [])]
          : [],
      ),
    ]);
    const assistant: ChatTurn = {
      ...assistantTurn,
      text: answerText,
      unfoundQuotes: unfound.length ? unfound : undefined,
      signalCandidates: pass && pass.count > 0 ? pass.count : undefined,
      route: routed?.route,
      outcome: ending.outcome,
      // Explicitly, even when absent: the placeholder's `interrupted` would
      // otherwise survive the merge into a finished answer.
      errorCode: ending.errorCode,
      trace,
      elapsedMs: elapsed(),
      personaId: persona.id,
      model,
      sources: used,
      tools: receipts.length ? receipts : undefined,
      web: webOf(pause),
      findings: validated.length ? validated : undefined,
      commented: commentedBy(commented, notesLeft),
      usage: {
        ...usage,
        totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        // What the reading in the panel is a share of: the window this run
        // was budgeted against, which is what `limitsFor` sized it by.
        contextWindow: descriptor.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
      },
      coverage: reviewsFocused(chat)
        ? focusedCoverage(allowed, catalog, used, declared.skipped)
        : undefined,
    };
    working = withTurn(
      { ...working, updatedAt: now() },
      assistantTurn.id,
      assistant,
    );
    // Settled on the chat as it is when the save starts, after every write
    // queued before it: the writer's rename and ticks are in it by then.
    await host.writes.persistRun(started, working, (laid) => {
      const plan = replan ? replan(laid.plan) : laid.plan;
      return {
        ...laid,
        // Named by what the writer typed: a chat a command opens is titled
        // by the command, never by its rubric. A name the
        // writer gave it while the answer ran stands.
        title:
          chat.turns.length === 0 && laid.title === started.title
            ? chatTitleFrom(command ? commandLine(command) : text)
            : laid.title,
        ...(plan === laid.plan ? {} : { plan }),
      };
    });
  } catch (error) {
    if (host.isDisposed()) return "started";
    if (!asked) {
      // A refusal, not a failed run: the question was never written nor
      // asked. A compaction of the history may have run first; its summary
      // is not kept, and is made again on the next question. The problem is
      // the one account, since the error's own message is a kind, never a
      // sentence.
      if (error instanceof ReviewReferenceError) {
        // The shown question goes, from the chat as it is now (a setting
        // changed meanwhile stays). Written, not only shown: any save of
        // this chat while it prepared carried the question with it.
        const current = host.snapshot().chats.find((one) => one.id === chatId);
        if (current)
          await host.writes.persist({
            ...current,
            turns: current.turns.filter(
              (turn) => turn.id !== user.id && turn.id !== assistantTurn.id,
            ),
          });
        host.publish({
          error: null,
          errorCode: null,
          problem: runProblemOf(error, true),
        });
        return "rejected";
      }
      // Anything else before the question was written (the model could not
      // be described, Stop while preparing) ended a run that did begin: the
      // question is written now, and the failure lands under it.
      if (!(await ask())) return "rejected";
    }
    if (error instanceof ModelRunError && error.failure.code === "cancelled") {
      // Stop raced the step helper: retain whatever text arrived, and every
      // search the run was asked about. A Stop while an ask waited leaves its
      // rows declined, written here with the turn.
      appLog.info("ai", "A chat turn was stopped.", {
        chat: chatId,
        elapsedMs: elapsed(),
      });
      working = withTurn(working, assistantTurn.id, {
        outcome: "interrupted",
        errorCode: "cancelled",
        elapsedMs: elapsed(),
        web: webOf(pause),
      });
      await host.writes.persistRun(started, working);
    } else {
      const message =
        error instanceof Error ? error.message : "The assistant failed.";
      const partial =
        working.turns.find((turn) => turn.id === assistantTurn.id)?.text ?? "";
      const failureCode =
        error instanceof ModelRunError ? error.failure.code : null;
      appLog.error("ai", "A chat turn failed.", {
        chat: chatId,
        provider: model.providerId,
        model: model.modelId,
        elapsedMs: elapsed(),
        partialChars: partial.length,
        ...describeError(error),
      });
      working = withTurn({ ...working, updatedAt: now() }, assistantTurn.id, {
        // Only prose that arrived. The failure's own sentence is never
        // stored as the answer: the transcript would show an adapter's English
        // in every locale, and `history.ts` would replay it as something the
        // model said. The reason is `errorCode`; the turn's banner words it
        // in the locale. `message` stays in the published state as a
        // diagnostic, never shown as prose.
        text: partial,
        outcome: "failed",
        // Which model was asked, recorded on failure as on success: the
        // strip's Renew button needs the provider as much as the code, so a
        // key-expired turn can offer its one remedy.
        model,
        // On the turn as well as in the published state (`ChatTurn.errorCode`
        // says why), and `undefined` rather than absent, as on success.
        errorCode: failureCode ?? undefined,
        elapsedMs: elapsed(),
        web: webOf(pause),
      });
      await host.writes.persistRun(started, working);
      // No problem to name: the one refusal a turn has (a named reference)
      // is answered before anything is written.
      host.publish({ error: message, errorCode: failureCode, problem: null });
    }
  } finally {
    host.setAbort(null);
    // The pause ends with its run, and the writer's no with it.
    host.releasePause(pause);
    if (!host.isDisposed())
      host.publish({
        running: false,
        preparing: false,
        activity: null,
        runningChatId: null,
        runProgress: undefined,
        pendingSearch: null,
        runWaitedMs: 0,
      });
    // The claim's release and the drain belong to `startTurn`'s outer
    // finally: draining here would run while the claim is still held.
  }
  return "started";
}
