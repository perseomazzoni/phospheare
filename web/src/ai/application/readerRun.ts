// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The beta reader's runs, `/read-on` and `/predict`: every refusal before a
// request or a write, the read, and the journal's pair, reading and horizon
// written together through the aggregate's write lane.

import type {
  ChatRecord,
  ModelDescriptor,
  ModelRef,
  PersonaDefinition,
  ProjectFacts,
  ReaderScope,
  ReadingRecord,
  RunActivity,
  RunUsage,
  SourceDescriptor,
} from "../domain/types";
import type { ModelProvider, ProjectSources } from "../ports";
import { READING_LIMITS } from "../domain/types";
import { foldReading, nextSection, readingPosition } from "../domain/reading";
import { isUnwritten } from "../domain/rooms";
import {
  PROSE_BOUNDARY,
  projectBriefing,
  workflowInstructions,
} from "../domain/policy";
import { genreBriefing } from "../domain/genres";
import {
  commandLine,
  offersWorkflow,
  predictSkill,
  readOnSkill,
  type AiSkill,
} from "../domain/skills";
import { readerExtras } from "../domain/sourceView";
import { DEFAULT_CONTEXT_TOKENS } from "./budgets";
import { titlesOf } from "./chatFacts";
import { now, workflowPair } from "./runRecords";
import type { WorkflowHost } from "./workflowRun";
import {
  predict,
  readOn,
  readOnMessage,
  memoryMessage,
  readingFits,
  type ReaderMemory,
} from "./readingJournal";

/**
 * The refusals a reading publishes before it starts. Each one is also an
 * `AssistantProblem`; the union is declared here so that this module does not
 * import the assistant, which imports it.
 */
export type ReadingProblem =
  | { kind: "persona-missing"; personaId: string }
  | { kind: "reading-needs-tools"; model: string }
  | { kind: "reading-whole-book" }
  | { kind: "reading-finished" }
  | { kind: "reading-journal-full" }
  | { kind: "reading-empty-section"; title: string }
  | { kind: "predict-nothing-read" }
  | { kind: "reading-too-long"; title: string; model: string };

export interface ReadingNotice {
  problem?: ReadingProblem;
  error?: null;
  errorCode?: "not-configured";
}

export interface ReadingHost {
  model: ModelProvider;
  sources: ProjectSources;
  projectFacts?: () => ProjectFacts | null;
  resolvePersona(chat: ChatRecord): PersonaDefinition | null;
  listCatalogue(): Promise<SourceDescriptor[]>;
  readerBoundary(
    chat: ChatRecord,
  ): Promise<{ ok: true; allowed: ReadonlySet<string> } | { ok: false }>;
  publish(patch: ReadingNotice): void;
  isDeleted(chatId: string): boolean;
}

export interface ReadingTarget {
  kind: "read" | "predict";
  chat: ChatRecord;
  model: ModelRef;
  descriptor: ModelDescriptor;
  instructions: string;
  memory: ReaderMemory;
  section: { nodeId: string; title: string; text: string } | null;
  scope: ReaderScope | undefined;
}

/** The journal and the answer, written together (`publishReading`). */
export interface ReadingPublication {
  asked: AiSkill;
  model: ModelRef;
  scope: ReaderScope | undefined;
  nodeId: string | null;
  reading: ReadingRecord;
  text: string;
  usage: RunUsage;
}

/**
 * Reader refusals are checked before a request or a write: room, persona,
 * model, horizon, book, then context window. The horizon is checked as it
 * will stand after reading the next Section.
 */
export async function prepareReading(
  host: ReadingHost,
  chat: ChatRecord,
  kind: "read" | "predict",
): Promise<ReadingTarget | null> {
  if (
    chat.kind !== "beta-reader" ||
    !offersWorkflow(chat.kind, kind === "read" ? "journal" : "predict")
  )
    return null;
  const persona = host.resolvePersona(chat);
  if (!persona) {
    host.publish({
      problem: {
        kind: "persona-missing",
        personaId: chat.preferences.personaId,
      },
      error: null,
    });
    return null;
  }
  const model = chat.preferences.model;
  if (!model) {
    host.publish({ errorCode: "not-configured", error: null });
    return null;
  }
  const descriptor = await host.model.describeModel(
    model,
    new AbortController().signal,
  );
  // The entry is data the app draws, so it comes in a fixed shape: held
  // natively, or as one tool's arguments (`structuredAnswer`). A model
  // that can do neither would answer in prose the app cannot trust.
  if (
    !descriptor.capabilities.tools &&
    !descriptor.capabilities.structuredOutput
  ) {
    host.publish({
      problem: { kind: "reading-needs-tools", model: descriptor.label },
    });
    return null;
  }
  // A reader that already knows the whole book is not blind to what comes
  // next, and narrowing it would contaminate it: the remedy is a new
  // chat, which the copy says.
  if (chat.preferences.readerScope?.kind === "whole") {
    host.publish({ problem: { kind: "reading-whole-book" } });
    return null;
  }
  const catalog = await host.listCatalogue();
  let section: { nodeId: string; title: string; text: string } | null = null;
  let scope = chat.preferences.readerScope;
  if (kind === "read") {
    const next = nextSection(catalog, chat.reading);
    if (!next?.nodeId) {
      // A full journal is not the end of the book: a longer book has
      // Sections left that this reader has no room to write down.
      const full =
        (chat.reading?.entries.length ?? 0) >= READING_LIMITS.entries;
      host.publish({
        problem: { kind: full ? "reading-journal-full" : "reading-finished" },
      });
      return null;
    }
    const within = scope
      ? (await host.sources.allowedReaderSources(scope)).has(next.id)
      : false;
    if (!within) scope = { kind: "through", nodeId: next.nodeId };
    const read = await host.sources.read(next.id);
    if (!read.text.trim()) {
      host.publish({
        problem: { kind: "reading-empty-section", title: next.title },
      });
      return null;
    }
    section = { nodeId: next.nodeId, title: next.title, text: read.text };
  }
  // A prediction before the first page has no horizon yet and reads no
  // manuscript, only the back cover, which is the room's own extra, so it
  // is the one run that goes on without one. Every other goes through the
  // boundary as it will be.
  if (scope) {
    const boundary = await host.readerBoundary({
      ...chat,
      preferences: { ...chat.preferences, readerScope: scope },
    });
    if (!boundary.ok) return null;
    // By construction the next Section is inside the horizon just set; a
    // port that disagrees is a bug to surface, never a reason to read
    // past the boundary it drew.
    const sectionId = catalog.find(
      (one) => one.nodeId === section?.nodeId && one.nodeKind === "section",
    )?.id;
    if (section && (!sectionId || !boundary.allowed.has(sectionId)))
      throw new Error("The next Section is outside this reader's horizon.");
  }
  const backCover: string[] = [];
  for (const source of readerExtras(chat.kind, catalog)) {
    const text = (await host.sources.read(source.id)).text;
    if (!isUnwritten(text)) backCover.push(text.trim());
  }
  const memory: ReaderMemory = {
    backCover,
    reading: chat.reading,
    titleOf: titlesOf(catalog),
  };
  if (
    kind === "predict" &&
    !chat.reading?.entries.length &&
    !backCover.length
  ) {
    host.publish({ problem: { kind: "predict-nothing-read" } });
    return null;
  }
  const instructions = [
    PROSE_BOUNDARY,
    projectBriefing(host.projectFacts?.() ?? null, chat.kind),
    genreBriefing(host.projectFacts?.() ?? null, chat.kind),
    workflowInstructions(chat.kind),
    persona.instructions,
  ]
    .filter(Boolean)
    .join("\n\n");
  const message = section
    ? readOnMessage({ ...memory, section, at: "" })
    : memoryMessage(memory);
  if (
    !readingFits(
      descriptor,
      kind === "read" ? "read-on" : "predict",
      instructions,
      message,
    )
  ) {
    host.publish({
      problem: {
        kind: "reading-too-long",
        title: section?.title ?? "",
        model: descriptor.label,
      },
    });
    return null;
  }
  if (host.isDeleted(chat.id)) return null;
  return {
    kind,
    chat,
    model,
    descriptor,
    instructions,
    memory,
    section,
    scope,
  };
}

/** Build the journal update without publishing state or persisting a chat. */
export async function readForJournal(
  target: ReadingTarget,
  provider: ModelProvider,
  signal: AbortSignal,
  onActivity: (activity: RunActivity) => void,
): Promise<ReadingPublication> {
  const {
    kind,
    chat,
    model,
    descriptor,
    instructions,
    memory,
    section,
    scope,
  } = target;
  const deps = {
    model: provider,
    descriptor,
    modelRef: model,
    instructions,
    rubric: (kind === "read" ? readOnSkill : predictSkill).instruction,
    onActivity,
  };
  const at = now();
  const answer = section
    ? await readOn(deps, { ...memory, section, at }, signal)
    : { ...(await predict(deps, memory, signal)), entry: undefined };
  const madeAt = section?.nodeId ?? readingPosition(chat.reading);
  return {
    asked: kind === "read" ? readOnSkill : predictSkill,
    model,
    scope,
    nodeId: madeAt,
    reading: foldReading(chat.reading, {
      ...("settled" in answer ? { settled: answer.settled } : {}),
      ...(answer.entry ? { entry: answer.entry } : {}),
      predictions: answer.predictions,
      ...(madeAt ? { madeAt } : {}),
      at,
    }),
    text: answer.entry
      ? [answer.entry.reaction, answer.entry.why].join("\n\n").trim()
      : answer.predictions.map((one) => "- " + one).join("\n"),
    usage: {
      ...answer.usage,
      contextWindow: descriptor.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
    },
  };
}

/** `/read-on` or `/predict`, through the aggregate's run entry point. */
export async function startReading(
  host: WorkflowHost,
  kind: "read" | "predict",
): Promise<"started" | "rejected"> {
  return host.runWorkflow<ReadingTarget>({
    prepare: async () => {
      const chat = host.activeChat();
      if (!chat) return null;
      return prepareReading(
        {
          model: host.dependencies.model,
          sources: host.dependencies.sources,
          projectFacts: host.dependencies.projectFacts,
          resolvePersona: (one) => host.resolvePersona(one),
          listCatalogue: () => host.listCatalogue(),
          readerBoundary: (one) => host.readerBoundary(one),
          publish: (patch) => host.publish(patch),
          isDeleted: (chatId) => host.isDeleted(chatId),
        },
        chat,
        kind,
      );
    },
    failure: "The reading could not be started.",
    chatId: ({ chat }) => chat.id,
    start: () => ({ activity: { kind: "preparing" } }),
    run: async (prepared, signal) => {
      const publication = await readForJournal(
        prepared,
        host.dependencies.model,
        signal,
        (activity) => host.publish({ activity }),
      );
      await publishReading(host, prepared.chat.id, publication);
    },
    stopped: ({ chat }, error) =>
      host.endWorkflowRun(
        chat.id,
        error,
        kind === "read"
          ? ["Reading stopped.", "The reading was interrupted."]
          : ["Prediction stopped.", "The prediction was interrupted."],
      ),
    end: { preparing: false, activity: null },
  });
}

/**
 * The journal's pair, its reading and its horizon, written together to the
 * chat that asked, read fresh from the list, because the writer may have
 * renamed it or switched its persona while the reader read. False when the
 * chat is gone.
 */
async function publishReading(
  host: WorkflowHost,
  chatId: string,
  run: ReadingPublication,
): Promise<boolean> {
  if (host.isDisposed() || host.isDeleted(chatId)) return false;
  const chat = host.snapshot().chats.find((one) => one.id === chatId);
  if (!chat) return false;
  const placed = workflowPair(
    {
      ...chat,
      reading: run.reading,
      preferences: {
        ...chat.preferences,
        ...(run.scope ? { readerScope: run.scope } : {}),
      },
    },
    { text: commandLine({ skill: run.asked.command }) },
    {
      text: run.text,
      model: run.model,
      usage: run.usage,
      journal: {
        kind: run.asked === readOnSkill ? "read" : "predict",
        ...(run.nodeId ? { nodeId: run.nodeId } : {}),
      },
    },
  );
  await host.writes.persist(placed.chat);
  return true;
}

/** A beta reader's two runs, bound to the aggregate. */
export function bind(host: WorkflowHost) {
  return {
    /**
     * `/read-on`: the next Section in reading order, read and journaled,
     * the open predictions settled, new ones written down, and the horizon
     * moved to it when it lay past the horizon, never back. Nothing is
     * written until the entry is in: a read that stopped or failed leaves
     * the chat, its horizon and its ledger as they were.
     */
    readOn: () => startReading(host, "read"),
    /** `/predict`: what the reader expects next, reading nothing new. */
    predict: () => startReading(host, "predict"),
  };
}
