// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { commentsContext, threadContext } from "../domain/comments";
import type {
  ChapterComments,
  CommentThreadView,
  MarginSearch,
} from "../domain/comments";
import { STANDARD, samplingFields } from "../domain/mode";
import { PROSE_BOUNDARY, projectBriefing } from "../domain/policy";
import { genreBriefing } from "../domain/genres";
import type {
  ChatKind,
  ContextUse,
  ModelRef,
  PersonaDefinition,
  ProjectFacts,
  RunActivity,
  RunUsage,
  SourceDescriptor,
  ToolCall,
} from "../domain/types";
import { composeVoice } from "../domain/voice";
import { fenced, projectManifest } from "./context";
import type { Comments, ModelProvider, ProjectSources } from "../ports";
import { COMMENTS_CONTEXT_CHARACTERS, budgetFor } from "./budgets";
import { ModelRunError } from "./runStep";
import { callSubject, runToolLoop } from "./toolLoop";
import { manuscriptTextsOf, toolsFor, type ToolContext } from "./tools";
import { engineLabel } from "../domain/webEngine";
import type { SearchPause } from "./searchAsk";

// A persona answering in a margin thread, never in a chat. It answers by the
// same tool loop a chat does, but gets no chat skills or commands, because a
// margin note is a reply, not a method.
//
// A reader persona is shown less, because a reader answers from where they
// are in the book: the chapter only as far as the passage (`readingTo`); the
// book only up to that chapter; and none of the other comments. A first
// reader never sees the margin, the same rule `commentsBlock` keeps for
// reader chats.

export const MARGIN_REPLY =
  "You are answering in a margin thread beside a passage of the writer's chapter. You may read the book with your tools before you answer, and your answer is the comment. Write a margin comment, not a letter: at most five sentences and under 900 characters, in plain text — no headings, no lists or numbered points, no markdown. Answer what the last entry asks or says, as yourself. When you point at the text, quote the chapter's exact words, never another comment's, and never name a source id: the comment sits beside its chapter. You cannot change the text: say what you see and why, and offer a rewrite only if the writer asks for one.";

/** When a reply may leave comments, what one comment cannot hold goes there. */
export const MARGIN_MORE =
  "If you see more than one comment can hold, say here the one thing that matters most to what the writer asked, and leave the rest with leave_comments, each beside its own passage.";

export const MARGIN_READER =
  "You have read this chapter only as far as the passage, and you do not know what comes after it. The text you were given stops where the passage ends, even mid-sentence: that cut is where you stopped reading, not the writer's punctuation, so never remark on it. Answer as a reader at this point in the book: what you feel, believe or expect here, never what the writer should do.";

/** Whether a persona answers as a reader: it works only in reader rooms. */
export function readsAsReader(persona: PersonaDefinition): boolean {
  return persona.compatibleWith.every(
    (kind) => kind === "alpha-reader" || kind === "beta-reader",
  );
}

/** The room a persona speaks from in the margin. */
export function roomOf(persona: PersonaDefinition): ChatKind {
  if (persona.compatibleWith.includes("editorial")) return "editorial";
  return persona.compatibleWith[0] ?? "general";
}

export interface CommentReplyDependencies {
  model: ModelProvider;
  modelRef: ModelRef;
  projectFacts?: () => ProjectFacts | null;
  personas: readonly PersonaDefinition[];
  sources: ProjectSources;
  /** The book's sources, resolved once for the run. */
  catalog: readonly SourceDescriptor[];
  /** What this persona may read here: a reader's horizon, or the book. */
  allowed: ReadonlySet<string>;
  /** The margin, where the persona may leave notes beside other passages. */
  comments?: Comments;
  /**
   * Builds the run's web-search pause, where the writer may be asked about
   * each search, over the writer's words this run has shown the
   * model. Absent where search is not offered; never used for a reader
   * persona, whose horizon the web does not respect.
   */
  searchPause?: (bookTexts: () => readonly string[]) => SearchPause;
}

export interface CommentReplyInput {
  persona: PersonaDefinition;
  /** The chapter as this persona reads it: a reader's is cut at the passage. */
  chapter: { sourceId: string; title: string; text: string };
  thread: CommentThreadView;
  /** The chapter's whole margin; the thread answered is left out of it. */
  margin: ChapterComments | null;
}

/**
 * The reader's read of the book: the chapter answered is the text it was
 * given, cut at the passage, however it is asked for — attached, read whole,
 * read by range, or grepped — so a tool cannot read past where it stopped.
 */
export function readingTo(
  sources: ProjectSources,
  chapter: CommentReplyInput["chapter"],
): ProjectSources {
  return {
    ...sources,
    list: () => sources.list(),
    allowedReaderSources: (scope) => sources.allowedReaderSources(scope),
    read: async (sourceId, range) => {
      if (sourceId !== chapter.sourceId) return sources.read(sourceId, range);
      const read = await sources.read(sourceId);
      return {
        ...read,
        text: range ? chapter.text.slice(range.start, range.end) : chapter.text,
      };
    },
  };
}

/** The persona's answer, or a `ModelRunError` saying why there is none. */
export async function composeCommentReply(
  dependencies: CommentReplyDependencies,
  input: CommentReplyInput,
  signal: AbortSignal,
  /** What the run is doing, for the card that waits on it; null between. */
  onActivity?: (activity: RunActivity | null) => void,
): Promise<{ text: string; usage: RunUsage; searched: MarginSearch[] }> {
  const { persona, chapter, thread } = input;
  const reader = readsAsReader(persona);
  const room = roomOf(persona);
  const nameOf = (id: string) =>
    dependencies.personas.find((one) => one.id === id)?.name ?? null;
  const voice = composeVoice(
    persona,
    room,
    undefined,
    dependencies.personas,
  ).instructions;

  const others =
    !reader && input.margin
      ? commentsContext(
          [
            {
              nodeId: input.margin.nodeId,
              threads: input.margin.threads.filter((t) => t.id !== thread.id),
            },
          ],
          new Map([
            [
              input.margin.nodeId,
              { sourceId: chapter.sourceId, title: chapter.title },
            ],
          ]),
          persona.id,
          nameOf,
          COMMENTS_CONTEXT_CHARACTERS,
        )
      : "";

  const descriptor = await dependencies.model.describeModel(
    dependencies.modelRef,
    signal,
  );
  const budget = budgetFor(descriptor);
  const tooled = descriptor.capabilities.tools;
  const port = dependencies.comments;
  /** The writer's words this run's reads showed the model. */
  const readTexts: string[] = [];
  // The query a search sends is checked against every word of the book the
  // run has shown the model — the chapter, the passages in the margin, what
  // its tools read — so a search never carries the writer's prose out.
  const pause =
    tooled && !reader && dependencies.searchPause
      ? dependencies.searchPause(() => [
          chapter.text,
          ...(thread.passage ? [thread.passage] : []),
          ...(input.margin?.threads.flatMap((one) =>
            one.passage ? [one.passage] : [],
          ) ?? []),
          ...readTexts,
        ])
      : null;
  const tools = tooled
    ? toolsFor(
        {
          skills: [],
          findings: false,
          ...(port ? { comments: port.cap } : {}),
          web: pause !== null,
        },
        budget.readWindow,
      )
    : [];
  const used: ContextUse[] = [];
  const toolContext: ToolContext = {
    sources: reader
      ? readingTo(dependencies.sources, chapter)
      : dependencies.sources,
    catalog: dependencies.catalog,
    allowed: dependencies.allowed,
    used,
    budget,
    ...(port
      ? {
          leaveComments: (nodeId, proposals) =>
            port.propose(nodeId, persona.id, proposals),
        }
      : {}),
  };
  // A chapter longer than this window holds is shown as far as it fits, and
  // said to be, so the model reads the rest with its tools rather than
  // answering about an ending it never saw.
  const shown = chapter.text.slice(0, budget.sourceCharacters);
  const flags = [
    ...(reader ? ["read as far as the passage"] : []),
    ...(shown.length < chapter.text.length
      ? [`first ${shown.length} characters; read the rest with read_source`]
      : []),
  ];

  const loop = await runToolLoop({
    provider: dependencies.model,
    request: {
      model: dependencies.modelRef,
      instructions: [
        PROSE_BOUNDARY,
        projectBriefing(
          dependencies.projectFacts?.() ?? null,
          reader ? room : undefined,
        ),
        genreBriefing(dependencies.projectFacts?.() ?? null, room),
        voice,
        MARGIN_REPLY,
        tools.some((tool) => tool.name === "leave_comments") ? MARGIN_MORE : "",
        reader ? MARGIN_READER : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      tools,
      limits: {
        inputTokens: budget.inputTokens,
        outputTokens: budget.outputTokens,
      },
      ...samplingFields(STANDARD, descriptor),
    },
    messages: [
      {
        role: "user",
        content: [
          tooled
            ? projectManifest(
                dependencies.catalog,
                dependencies.allowed,
                budget.manifestRows,
              )
            : "",
          fenced("SOURCE", chapter.sourceId, chapter.title, flags, shown),
          others,
          threadContext(thread, persona.id, nameOf),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    budget,
    toolContext,
    pause,
    signal,
    step: {},
    sink: {
      stepStarted: () => onActivity?.(null),
      saidOnTheWay: () => undefined,
      calling: (call: ToolCall) =>
        onActivity?.({
          kind: "tool",
          tool: call.name,
          ...callSubject(call.arguments, dependencies.catalog),
        }),
      settled: (call, value) => {
        if (pause) readTexts.push(...manuscriptTextsOf(call, value));
      },
    },
  });
  const text = loop.text.trim();
  if (loop.ending.errorCode === "cancelled")
    throw new ModelRunError({
      code: "cancelled",
      message: "Reply stopped.",
      retryable: false,
    });
  // Half a note, or a refusal written as prose, is not an answer: said as
  // the failure it is, and never written into the thread.
  if (loop.ending.outcome !== "complete" || !text)
    throw new ModelRunError({
      code:
        loop.ending.errorCode === "output-limit" ||
        loop.ending.outcome === "interrupted"
          ? "interrupted"
          : loop.ending.errorCode === "refusal"
            ? "provider-rejected"
            : "invalid-response",
      message: "The reply could not be written.",
      retryable: loop.ending.errorCode !== "refusal",
    });
  // What the file keeps of each search that went: never the declined, the
  // failed or an excerpt.
  const searched = (pause?.written ?? []).flatMap((record): MarginSearch[] =>
    record.status === "searched"
      ? [
          {
            engine: engineLabel(record.engine),
            query: record.query,
            links: record.results.map(({ url, title }) => ({ url, title })),
          },
        ]
      : [],
  );
  return { text, usage: loop.usage, searched };
}
