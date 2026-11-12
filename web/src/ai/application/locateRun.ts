// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// `/where`, and the "Summarise n sections" button under its answer, which
// runs the same search again in its place.

import type { WorkflowHost } from "./workflowRun";
import { completeRun } from "./summaryRun";
import { LOCATE_SENTENCE_MAX } from "./budgets";
import { locateInBook } from "./locateInBook";
import {
  commandArgument,
  commandLine,
  skillsFor,
  whereSkill,
} from "../domain/skills";
import {
  markUnsummarisable,
  summaryBlockLifted,
  toSummarise,
} from "../domain/sourceView";
import type {
  ChatRecord,
  LocateOutcome,
  ModelRef,
  RunUsage,
  SourceDescriptor,
} from "../domain/types";
import { withHost } from "./features";

/**
 * `/where <moment>`: find where the book shows a moment the writer
 * describes, and land the editor on it. Every refusal is decided before a
 * single request (`locateTarget`).
 *
 * Nothing is written until the answer is in: the question and its answer
 * land together, so a stopped or failed search leaves the chat as it was,
 * not a question with nothing under it that Retry would send to the model
 * as the words "/where …".
 *
 * Resolves `rejected` for a refusal, so the panel can give the writer their
 * words back, and `started` once a search that began has ended, whatever
 * its ending.
 */
export async function runLocate(
  host: WorkflowHost,
  sentence: string,
): Promise<"started" | "rejected"> {
  let unmoved: (() => boolean) | null = null;
  return host.runWorkflow({
    prepare: async () => {
      // Watched from the moment the writer asked, not from when the answer
      // lands: typing during a long search is the case the arrival rule is
      // for.
      unmoved = host.dependencies.evidence?.watch() ?? null;
      const chat = host.activeChat();
      return chat ? locateTarget(host, chat, sentence) : null;
    },
    failure: "The search could not be started.",
    chatId: ({ chat }) => chat.id,
    start: () => ({ runProgress: { work: "locate", complete: 0, total: 0 } }),
    run: ({ chat, model, allowed, text }, signal) =>
      searchAndAnswer(
        host,
        { chatId: chat.id, model, allowed, text, unmoved },
        signal,
      ),
    stopped: ({ chat }, error) =>
      host.endWorkflowRun(chat.id, error, [
        "Search stopped.",
        "The search was interrupted.",
      ]),
  });
}

/**
 * The search itself, its answer written, and the one landing. The caller
 * owns the run (the slot, `running`, Stop) and its ending.
 */
async function searchAndAnswer(
  host: WorkflowHost,
  run: {
    chatId: string;
    model: ModelRef;
    allowed: ReadonlySet<string>;
    text: string;
    unmoved: (() => boolean) | null;
    /** The pair this answer takes the place of (`completeLocate`). */
    replacing?: string;
    /**
     * The node ids this run's summaries just failed on for good: their
     * `unmapped` rows become `unsummarisable`. Only this run's own failures:
     * nothing is copied from the answer it replaces.
     */
    unsummarisable?: ReadonlySet<string>;
  },
  signal: AbortSignal,
): Promise<void> {
  host.publish({ runProgress: { work: "locate", complete: 0, total: 0 } });
  const { outcome, usage } = await locateInBook(
    {
      sources: host.dependencies.sources,
      model: host.dependencies.model,
      modelRef: run.model,
      projectFacts: host.dependencies.projectFacts,
      onProgress: (progress) =>
        host.publish({ runProgress: { work: "locate", ...progress } }),
    },
    { sentence: run.text, allowed: run.allowed },
    signal,
  );
  const located = {
    ...outcome,
    coverage: markUnsummarisable(outcome.coverage, run.unsummarisable),
  };
  const recorded = await publishLocateTurn(
    host,
    run.chatId,
    run.text,
    run.model,
    located,
    usage,
    run.replacing,
  );
  // One landing per run, on the first passage in book order (the row the
  // answer lists first), and only if the writer has not moved.
  const first = outcome.matches[0];
  if (recorded && first && run.unmoved && !signal.aborted)
    await host.dependencies.evidence?.reveal(first, { onlyIf: run.unmoved });
}

/** Every `/where` refusal, in the order a writer can act on them. */
async function locateTarget(
  host: WorkflowHost,
  chat: ChatRecord,
  sentence: string,
): Promise<{
  chat: ChatRecord;
  model: ModelRef;
  allowed: ReadonlySet<string>;
  catalog: SourceDescriptor[];
  text: string;
} | null> {
  // Two layers, and both are kept. The menu offers `/where` only where its
  // file says; the run refuses a reader chat whatever a file says, because
  // a search that ranks every summary in the book reaches past any horizon
  // by construction.
  const reader = chat.kind === "alpha-reader" || chat.kind === "beta-reader";
  if (reader || !skillsFor(chat.kind).includes(whereSkill)) return null;
  const text = sentence.trim();
  if (!text) return null;
  if (text.length > LOCATE_SENTENCE_MAX) {
    host.publish({
      problem: { kind: "where-too-long", max: LOCATE_SENTENCE_MAX },
    });
    return null;
  }
  const model = chat.preferences.model;
  if (!model) {
    host.publish({ errorCode: "not-configured", error: null });
    return null;
  }
  const descriptor = await host.dependencies.model.describeModel(
    model,
    new AbortController().signal,
  );
  if (!descriptor.capabilities.tools) {
    host.publish({
      problem: { kind: "where-needs-tools", model: descriptor.label },
    });
    return null;
  }
  const boundary = await host.readerBoundary(chat);
  if (!boundary.ok) return null;
  return {
    chat,
    model,
    allowed: boundary.allowed,
    catalog: boundary.catalog,
    text,
  };
}

/**
 * A `/where` answer and its question, as the pair publisher writes them.
 * The answer's `text` is for the model, not the writer: the dock draws the
 * rows from `located`, and a later question about "that scene" needs the
 * history to say which one it was. Ids, never quotes: the quotes are on
 * the turn once already, and history cites by id.
 */
function publishLocateTurn(
  host: WorkflowHost,
  chatId: string,
  text: string,
  model: ModelRef,
  located: LocateOutcome,
  usage: RunUsage,
  replacing?: string,
): Promise<boolean> {
  const found = located.matches.map((match) => match.sourceId);
  return host.publishWorkflowPair(
    chatId,
    commandLine({ skill: whereSkill.command, argument: text }),
    {
      text:
        found.length === 0
          ? "The described moment was not found in the Sections searched."
          : `The described moment is in ${found.join(", ")}.`,
      located,
      model,
      usage,
    },
    replacing,
  );
}

/**
 * "Summarise n sections" under a `/where` answer: write the summaries that
 * search could not see, then run the same search again and put its answer
 * where the old one stood.
 *
 * Never started by the search itself: on a local model each summary takes
 * minutes, and that is the writer's call to make.
 *
 * Every refusal `/where` has applies before a single summary is written, so
 * a model that cannot search spends nothing. The `unmapped` rows are
 * requests from a chat file: only live manuscript sources inside the chat's
 * `readerBoundary` are summarised, and one already summarised is skipped. A
 * Section that cannot be summarised (`sectionFailure`) is skipped and the
 * run goes on; a failure of the model or the run ends it.
 *
 * Stop leaves the old answer where it was; the summaries already written
 * stay.
 */
export async function completeLocate(
  host: WorkflowHost,
  runId: string,
): Promise<void> {
  let unmoved: (() => boolean) | null = null;
  // Which half a failure lands in: a boundary refusal after the summaries
  // is still the summaries' ending, and only the search itself is the
  // search's.
  let searching = false;
  await completeRun(
    host,
    async () => {
      // Watched from the click, as a typed `/where` is.
      unmoved = host.dependencies.evidence?.watch() ?? null;
      const chat = host.activeChat();
      const asked = chat?.turns.find(
        (turn) => turn.runId === runId && turn.role === "user",
      );
      const answer = chat?.turns.find(
        (turn) => turn.runId === runId && turn.located,
      );
      const sentence = asked ? commandArgument(asked.text, whereSkill) : null;
      if (!chat || !sentence || !answer?.located) return null;
      const target = await locateTarget(host, chat, sentence);
      if (!target) return null;
      return {
        ...target,
        chatId: target.chat.id,
        // The same list the button counts, less the Sections this model
        // already could not summarise.
        nodes: toSummarise(
          answer.located.coverage,
          target.catalog,
          target.allowed,
          undefined,
          summaryBlockLifted(answer.model, target.model),
        ),
      };
    },
    async ({ chat, model, text }, signal, _failed, blocked) => {
      // Read again, not reused: the summaries just written are sources the
      // scope taken before them does not name.
      const boundary = await host.readerBoundary(chat);
      if (!boundary.ok) return;
      searching = true;
      await searchAndAnswer(
        host,
        {
          chatId: chat.id,
          model,
          allowed: boundary.allowed,
          text,
          unmoved,
          replacing: runId,
          unsummarisable: blocked,
        },
        signal,
      );
    },
    ({ chatId }, error) =>
      host.endWorkflowRun(
        chatId,
        error,
        searching
          ? ["Search stopped.", "The search was interrupted."]
          : ["Summaries stopped.", "The summaries were interrupted."],
      ),
  );
}

/** `/where`, bound to the aggregate (`assistant.locate`). */
export function bind(host: WorkflowHost) {
  return {
    run: withHost(host, runLocate),
    complete: withHost(host, completeLocate),
  };
}
