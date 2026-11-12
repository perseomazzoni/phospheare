// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { DEFAULT_PERSONA, PERSONAS, personasFor } from "../domain/personas";
import type { SectionLedger } from "../domain/ledger";
import type {
  ReaderScope,
  ChatRecord,
  ChatTurn,
  ModelDescriptor,
  ModelEvent,
  ModelRef,
  ModelRequest,
  ReviewCheckpoint,
  SourceDescriptor,
  SummaryMetadata,
} from "../domain/types";
import type { Artifacts, ModelProvider, ProjectSources } from "../ports";
import {
  Assistant,
  type AssistantDependencies,
  type AnswerText,
} from "./assistant";
import { citationsAsText } from "../domain/citations";

/**
 * The `Assistant`'s test kit, shared by the suites of the application
 * modules: in-memory stand-ins for its ports, a model that answers from a
 * script, the personas and sources the rows use, and `setup`, which builds
 * an Assistant over them.
 */

/**
 * Stands in for what the editor hands `searchDocuments` (`indexText`),
 * because the application's test cannot import the editor. These rows pin
 * the hand-off, which titles reach it per turn, not the index's shape, which
 * `turnText.test.ts` pins. Project ids read as their titles.
 */
export const flatText: AnswerText = (turn, { titles }) =>
  citationsAsText(turn.text, titles);

export class MemoryArtifacts implements Artifacts {
  chats = new Map<string, ChatRecord>();
  reviews = new Map<string, ReviewCheckpoint>();
  summaries = new Map<string, { metadata: SummaryMetadata; body: string }>();
  unreadable: Array<{ file: string; message: string }> = [];
  saved = 0;
  failNextSave = false;
  conflictOnSave: string | null = null;
  /** While set, every save reports the record is near the file bound. */
  nearLimitOnSave = false;

  async listChats() {
    return { chats: [...this.chats.values()], unreadable: this.unreadable };
  }
  async loadChat(id: string) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error("missing-chat");
    return chat;
  }
  async saveChat(chat: ChatRecord) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("save-failed");
    }
    this.saved += 1;
    this.chats.set(chat.id, structuredClone(chat));
    if (this.nearLimitOnSave) return { nearLimit: true };
    return this.conflictOnSave ? { conflictFile: this.conflictOnSave } : {};
  }
  async deleteChatFile(file: string) {
    this.unreadable = this.unreadable.filter((one) => one.file !== file);
  }
  async deleteChat(id: string) {
    // Idempotent, like the real adapter: a chat whose first save failed has
    // no file, and deleting it is not an error.
    this.chats.delete(id);
  }
  async saveReview(review: ReviewCheckpoint) {
    this.reviews.set(review.runId, structuredClone(review));
  }
  async loadReview(runId: string) {
    const review = this.reviews.get(runId);
    if (!review) throw new Error("missing-review");
    return review;
  }
  async deleteReview(runId: string) {
    this.reviews.delete(runId);
  }
  async readSummary(nodeId: string) {
    return this.summaries.get(nodeId) ?? null;
  }
  async writeSummary(nodeId: string, metadata: SummaryMetadata, body: string) {
    this.summaries.set(nodeId, { metadata, body });
  }
  ledgers = new Map<string, SectionLedger>();
  async readLedger(sourceId: string) {
    return this.ledgers.get(sourceId) ?? null;
  }
  async writeLedger(ledger: SectionLedger) {
    this.ledgers.set(ledger.sourceId, ledger);
  }
  async readJudgements() {
    return null;
  }
  async writeJudgements() {}
  async readEntities() {
    return null;
  }
  async writeEntities() {}
}

// ── Personas by property ─────────────────────────────────────────────────────
//
// Every case below needs a voice of a certain shape, never a particular one.
// A fixture that spells out a persona id goes stale silently when the folder
// changes, so the persona folder owns the names.
export const [EDITORIAL] = personasFor("editorial").filter(
  (one) => one !== DEFAULT_PERSONA,
);
export const [READER] = personasFor("alpha-reader").filter(
  (one) => one !== DEFAULT_PERSONA,
);
// A folder that cannot supply either fails here, rather than leaving the cases
// below passing without meaning.
if (!EDITORIAL || !READER || PERSONAS.length < 3)
  throw new Error("the persona folder no longer supports these fixtures");

export const SOURCES: SourceDescriptor[] = [
  {
    id: "node:first",
    kind: "manuscript",
    title: "First",
    path: "document/first.md",
    nodeId: "first",
    nodeKind: "section",
    order: 0,
    authority: "manuscript",
    revision: "r1",
  },
  {
    id: "node:future",
    kind: "manuscript",
    title: "Future",
    path: "document/future.md",
    nodeId: "future",
    nodeKind: "section",
    order: 1,
    authority: "manuscript",
    revision: "r2",
  },
  {
    id: "reference:world.md",
    kind: "reference",
    title: "World",
    path: "reference/world.md",
    authority: "reference",
    revision: "rw",
  },
];

export class MemorySources implements ProjectSources {
  descriptors: SourceDescriptor[] = SOURCES;
  texts = new Map([
    ["node:first", "A lantern goes dark beside the old gate."],
    ["node:future", "FUTURE SECRET: the guide is the thief."],
    ["reference:world.md", "The old gate is canon only when promoted."],
  ]);
  reads: string[] = [];
  revisionAfterRead: string | null = null;
  /** How many times the catalog was derived; a run derives it once. */
  lists = 0;

  async list() {
    this.lists += 1;
    return this.descriptors;
  }
  async read(sourceId: string, range?: { start: number; end: number }) {
    this.reads.push(sourceId);
    const text = this.texts.get(sourceId);
    if (text === undefined) throw new Error("source-not-found");
    const revision = this.revisionAfterRead ?? `${sourceId}-revision`;
    this.revisionAfterRead = null;
    return {
      text: range ? text.slice(range.start, range.end) : text,
      revision,
      origin: "project-file" as const,
    };
  }
  async search(query: string, allowed: ReadonlySet<string>, limit: number) {
    return this.descriptors
      .filter(
        (source) =>
          allowed.has(source.id) &&
          (this.texts.get(source.id) ?? "")
            .toLowerCase()
            .includes(query.toLowerCase().split(" ")[0] ?? ""),
      )
      .slice(0, limit)
      .map((source) => ({
        source,
        excerpt: this.texts.get(source.id) ?? "",
        score: 1,
      }));
  }
  async allowedReaderSources(scope: ReaderScope) {
    const allowed = new Set<string>();
    for (const source of this.descriptors) {
      if (source.kind !== "manuscript") continue;
      allowed.add(source.id);
      if (scope.kind === "through" && source.nodeId === scope.nodeId) break;
    }
    return allowed;
  }
}

export type Generator = (
  request: ModelRequest,
  signal: AbortSignal,
  call: number,
) => AsyncIterable<ModelEvent>;

/**
 * Whether a step may call its tools. The closing step after a ceiling
 * declares them with `toolChoice` none and may call none.
 */
export const mayCall = (request: ModelRequest) =>
  request.tools.length > 0 && request.toolChoice !== "none";

export class ProgrammableModel implements ModelProvider {
  readonly id = "test-model";
  requests: ModelRequest[] = [];
  descriptor: ModelDescriptor = {
    id: "llama-test",
    providerId: "test-model",
    label: "Llama test",
    kind: "device" as const,
    capabilities: { tools: true, structuredOutput: true },
    // A 32k window plus the instructions reserve's extra 10,000 characters, so
    // the rooms the cases below assume stay the same.
    contextTokens: 36_500,
  };
  generator: Generator;

  constructor(generator?: Generator) {
    this.generator =
      generator ??
      async function* () {
        yield { type: "text-delta", text: "A careful answer." };
        yield { type: "usage", inputTokens: 4, outputTokens: 3, durationMs: 2 };
        yield { type: "completed", reason: "answer" };
      };
  }
  async listModels() {
    return [this.descriptor];
  }
  async describeModel() {
    return this.descriptor;
  }
  async estimate() {
    return { tokens: 20, exact: false };
  }
  /**
   * The fact check's own steps: a ledger's extraction and a
   * candidate's judgement. They are answered through `facts` and kept apart
   * from `requests`, so a row about a `/continuity` turn counts only the
   * turn's requests, and a row about the check reads these.
   */
  factRequests: ModelRequest[] = [];
  facts: (request: ModelRequest) => unknown = () => ({ facts: [] });

  async *generate(request: ModelRequest, signal: AbortSignal) {
    if (
      request.output?.name === "write_facts" ||
      request.output?.name === "submit_judgement"
    ) {
      this.factRequests.push(request);
      yield {
        type: "text-delta" as const,
        text: JSON.stringify(this.facts(request)),
      };
      yield { type: "completed" as const, reason: "answer" as const };
      return;
    }
    this.requests.push(request);
    yield* this.generator(request, signal, this.requests.length);
  }
}

export function last<T>(values: T[]): T | undefined {
  return values[values.length - 1];
}

export function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected test value");
  return value;
}

/**
 * Which model answers, and whose it is. The provider id is not `ollama`, so
 * no spec passes only because both halves of the pair say the same thing.
 */
export const MODEL: ModelRef = {
  providerId: "test-model",
  modelId: "llama-test",
};

/**
 * A chat, with a model chosen for it.
 *
 * The chat is the one place a selection lives, so a chat created
 * in a fresh harness has nothing to inherit, like a writer's first chat. In
 * the editor the model menu chooses the model; here the harness does, so
 * each spec is about what it names rather than about an assistant with no
 * model. Specs that want that state call `chats.create` directly.
 */
export async function newChat(
  assistant: Assistant,
  kind: Parameters<Assistant["chats"]["create"]>[0],
): Promise<ChatRecord> {
  const chat = await assistant.chats.create(kind);
  await assistant.chats.updatePreferences({ model: MODEL });
  return { ...chat, preferences: { ...chat.preferences, model: MODEL } };
}

export function setup(overrides: Partial<AssistantDependencies> = {}) {
  const artifacts = new MemoryArtifacts();
  const sources = new MemorySources();
  const model = new ProgrammableModel();
  const dependencies: AssistantDependencies = {
    artifacts,
    sources,
    model,
    defaultNode: () => ({ id: "first", title: "First", kind: "section" }),
    ...overrides,
  };
  const assistant = new Assistant(dependencies);
  return { assistant, artifacts, sources, model, dependencies };
}

/**
 * The last turn, failing here rather than downstream when there is none.
 * Every caller has just asserted that a turn exists, so this replaces a
 * non-null assertion on each line.
 */
export function lastTurn(turns: ChatTurn[]): ChatTurn {
  const found = turns[turns.length - 1];
  if (!found) throw new Error("expected the chat to have a turn");
  return found;
}

export const SUMMARY: SourceDescriptor = {
  id: "reference:summary--first.md",
  kind: "summary",
  title: "First",
  path: "reference/summary--first.md",
  summarises: "first",
  authority: "derived",
  freshness: "current",
};

/** A model that ranks `first` and finds the lantern in it. */
export function locating(): Generator {
  return async function* (request) {
    const tool = request.tools[0]?.name;
    yield {
      type: "tool-call-ready",
      call: {
        id: "call",
        name: tool ?? "none",
        arguments:
          tool === "choose_sections"
            ? { sourceIds: ["node:first"] }
            : { found: true, quote: "A lantern goes dark" },
      },
    };
    yield { type: "completed", reason: "tools" };
  };
}
