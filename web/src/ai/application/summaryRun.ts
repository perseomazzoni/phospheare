// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The summaries a run writes. One node's stored summary (`generateSummary`),
// the shared step that writes a run's missing summaries and then runs it
// again in its answer's place (`completeRun`), and `/summarise part`, one
// account of a Part told from its Sections' summaries.

import type { AssistantDependencies } from "./assistantTypes";
import type { WorkflowHost } from "./workflowRun";
import { oneLine } from "./context";
import { wideSections } from "./reviewWide";
import { throwIfCancelled } from "./runStep";
import {
  blocksSummary,
  generateNodeSummary,
  sectionFailure,
} from "./summaries";
import {
  composePartSummary,
  PartSummaryTooLargeError,
  type PartSummaryRow,
} from "./summarisePart";
import { isPart, partFor } from "../domain/parts";
import { skillsFor, summariseSkill } from "../domain/skills";
import { searchableSummary, summariesToWrite } from "../domain/sourceView";
import type {
  ChatRecord,
  ModelRef,
  ReviewScope,
  RunUsage,
} from "../domain/types";
import { withHost } from "./features";

/**
 * Write one node's stored summary; nothing of the chat is in it. The
 * tree's summary dialog asks for it, holds the page while it runs, and
 * shows its failure itself, so this publishes no `running`, no error and
 * no problem to the snapshot: the chat's Stop button, run line and error
 * strip belong to the conversation, and a summary written beside one must
 * neither wait for it nor disturb it.
 *
 * It throws rather than reporting, for the same reason.
 *
 * `model` is a parameter, not an ambient read: `SummaryMetadata` records it,
 * so the model named in the file is the one the caller chose.
 */
export async function generateSummary(
  dependencies: Pick<
    AssistantDependencies,
    "sources" | "artifacts" | "model" | "projectFacts"
  >,
  nodeId: string,
  model: ModelRef | null,
  signal: AbortSignal,
): Promise<void> {
  await generateNodeSummary(
    {
      sources: dependencies.sources,
      artifacts: dependencies.artifacts,
      provider: dependencies.model,
      model,
      projectFacts: dependencies.projectFacts ?? (() => null),
    },
    nodeId,
    signal,
  );
}

/**
 * "Summarise n Sections, then run it again in its place": the one shape
 * `/where`, the wide reviews and `/map` share. Claim the slot, `prepare`
 * (every refusal, before a single summary; null to stop there), summarise
 * `nodes`, then `redo` the run in place of its answer. Stop between
 * summaries keeps the ones written and the old answer.
 *
 * One skeleton, because the invariants are in it: the slot claimed before
 * the first await, refusals before any request, and the summaries always
 * followed by a run that takes its target again rather than reusing one
 * taken before them.
 */
export async function completeRun<
  P extends { chatId: string; model: ModelRef; nodes: readonly string[] },
>(
  host: WorkflowHost,
  prepare: () => Promise<P | null>,
  redo: (
    prepared: P,
    signal: AbortSignal,
    /** The node ids whose summary could not be written this run. */
    failed: ReadonlySet<string>,
    /**
     * Those of `failed` whose failure would repeat on the same model
     * (`blocksSummary`): the redo records them so its answer stops offering
     * them.
     */
    blocked: ReadonlySet<string>,
  ) => Promise<void>,
  stopped: (prepared: P, error: unknown) => void,
): Promise<"started" | "rejected"> {
  return host.runWorkflow({
    prepare,
    failure: "The summaries could not be started.",
    chatId: (run) => run.chatId,
    start: (run) => ({
      runProgress: {
        work: "summarise",
        complete: 0,
        total: run.nodes.length,
      },
    }),
    run: async (run, signal) => {
      const { failed, blocked } = await summariseNodes(
        host,
        run.nodes,
        run.model,
        signal,
      );
      throwIfCancelled(signal);
      await redo(run, signal, failed, blocked);
    },
    stopped,
    // `/summarise part` says it is waiting while it composes.
    end: { activity: null },
  });
}

/**
 * `/summarise part` and `/summarise <a Part's title>`: one account
 * of the Part, composed from its Sections' summaries. It is `completeRun`'s
 * shape: every refusal first (`summariseTarget`), then the Sections whose
 * summary is missing or out of date written as the tree's dialog writes
 * them (`generateNodeSummary`), then one step. The nearer scopes are asked
 * as today's question by the caller (`asksAt`), never here.
 *
 * Nothing is stored but the pair; a Part never gets a stored summary. Stop
 * keeps the Section summaries written and publishes nothing. A Section
 * whose summary could not be written refuses the account, naming it: an
 * account of the Part with a hole in it is never told.
 */
export function runSummarise(
  host: WorkflowHost,
  scope: ReviewScope,
): Promise<"started" | "rejected"> {
  let composing = false;
  return completeRun(
    host,
    async () => {
      const chat = host.activeChat();
      return chat ? summariseTarget(host, chat, scope) : null;
    },
    async (run, signal, failed) => {
      host.publish({ runProgress: undefined });
      // Listed again, not reused: the summaries just written are sources
      // the listing taken before them does not hold, and the chat's
      // boundary may have narrowed while they were written.
      const chat = host.snapshot().chats.find((one) => one.id === run.chatId);
      const boundary = chat ? await host.readerBoundary(chat) : null;
      if (!boundary?.ok) return;
      // Which Sections, and which summaries count, were decided when the
      // run began: a summary is used as it is now, never judged stale again,
      // since the writer may be typing in the open Section. Only a write this
      // run attempted and lost is a refusal by name.
      let withheld = run.withheld;
      const rows: PartSummaryRow[] = [];
      for (const id of run.sectionIds) {
        const section = boundary.catalog.find(
          (one) => one.id === id && boundary.allowed.has(one.id),
        );
        // Out of the Structure, or outside what the chat may read, since the
        // run began.
        if (!section?.nodeId) continue;
        const nodeId = section.nodeId;
        const summary = section.summaryBarred
          ? undefined
          : boundary.catalog.find(
              (one) =>
                searchableSummary(one, boundary.allowed) &&
                one.summarises === nodeId,
            );
        if (summary && !failed.has(nodeId)) {
          rows.push({ section, summary });
          continue;
        }
        if (run.nodes.includes(nodeId)) {
          host.publish({
            problem: {
              kind: "summarise-section-failed",
              title: oneLine(section.title),
            },
          });
          return;
        }
        // Usable when the run began and gone now (barred, or deleted,
        // under it): not one this run could write, so kept out.
        withheld = true;
      }
      if (rows.length === 0) {
        host.publish({ problem: { kind: "summarise-nothing-to-read" } });
        return;
      }
      composing = true;
      // The RunLine cuts from the count to the one step: the same
      // "waiting for" line a question shows, because it is one request.
      const descriptor = await host.dependencies.model.describeModel(
        run.model,
        signal,
      );
      host.publish({
        activity: {
          kind: "waiting",
          model: descriptor.label || run.model.modelId,
        },
      });
      let composed: { text: string; usage: RunUsage };
      try {
        composed = await composePartSummary(
          {
            sources: host.dependencies.sources,
            model: host.dependencies.model,
            modelRef: run.model,
            projectFacts: host.dependencies.projectFacts,
          },
          rows,
          signal,
        );
      } catch (error) {
        if (!(error instanceof PartSummaryTooLargeError)) throw error;
        host.publish({
          problem: { kind: "summarise-part-too-large", model: error.model },
        });
        return;
      }
      await host.publishWorkflowPair(run.chatId, run.asked, {
        text: composed.text,
        model: run.model,
        usage: composed.usage,
        summarisedPart: {
          nodeId: run.part,
          ...(withheld ? { withheld: true as const } : {}),
        },
      });
    },
    ({ chatId }, error) =>
      host.endWorkflowRun(
        chatId,
        error,
        composing
          ? ["Summary stopped.", "The summary was interrupted."]
          : ["Summaries stopped.", "The summaries were interrupted."],
      ),
  );
}

/** Every `/summarise part` refusal, in the order a writer can act on them. */
async function summariseTarget(
  host: WorkflowHost,
  chat: ChatRecord,
  scope: ReviewScope,
): Promise<{
  chatId: string;
  model: ModelRef;
  nodes: string[];
  part: string;
  /** The Sections the account is told from, in reading order. */
  sectionIds: string[];
  withheld: boolean;
  asked: string;
} | null> {
  // Two layers, as for `/where` and `/map`: the menu offers it only where
  // its file says, and the run refuses a reader chat whatever a file says,
  // because a Part's account reads every summary in the Part.
  const reader = chat.kind === "alpha-reader" || chat.kind === "beta-reader";
  if (reader || !skillsFor(chat.kind).includes(summariseSkill)) return null;
  const catalog = await host.listCatalogue();
  let part: string;
  switch (scope.kind) {
    case "part": {
      const open = host.dependencies.defaultNode();
      const found = open ? partFor(catalog, open.id) : null;
      if (!found) {
        // "Or a Part's title" only where there is one to type, as `/map`
        // splits it.
        host.publish({
          problem: {
            kind: catalog.some((one) => one.nodeKind === "part")
              ? "summarise-no-part"
              : "summarise-no-part-no-parts",
          },
        });
        return null;
      }
      part = found;
      break;
    }
    case "node": {
      if (isPart(catalog, scope.nodeId)) {
        part = scope.nodeId;
        break;
      }
      // Another Section's title: the one move is to open it. The open
      // Section's own title never reaches here: the panel asks it as
      // `section`, where it is today's question.
      const section = catalog.find(
        (one) => one.nodeId === scope.nodeId && one.nodeKind === "section",
      );
      host.publish({
        problem: section
          ? { kind: "summarise-open-section", title: oneLine(section.title) }
          : { kind: "review-node-missing" },
      });
      return null;
    }
    default:
      return null;
  }
  const model = chat.preferences.model;
  if (!model) {
    host.publish({ errorCode: "not-configured", error: null });
    return null;
  }
  const boundary = await host.readerBoundary(chat);
  if (!boundary.ok) return null;
  const wide = wideSections(boundary.catalog, boundary.allowed, {
    kind: "node",
    nodeId: part,
  });
  // A Section whose summary the writer barred is kept from the account, open
  // or not: never written over, never read. The provenance says Sections
  // were, in one clause, never which.
  const sectionIds = wide.sectionIds.filter(
    (id) => !boundary.catalog.find((one) => one.id === id)?.summaryBarred,
  );
  if (sectionIds.length === 0) {
    host.publish({ problem: { kind: "summarise-nothing-to-read" } });
    return null;
  }
  const title = oneLine(
    boundary.catalog.find((one) => one.nodeId === part)?.title ?? "",
  );
  return {
    chatId: chat.id,
    model,
    // The one list the transit notice counts (`summariesToWrite`).
    nodes: summariesToWrite(boundary.catalog, sectionIds, boundary.allowed),
    part,
    sectionIds,
    withheld: sectionIds.length < wide.sectionIds.length,
    // The question as the writer would have typed it: a `part` is written
    // as the Part it resolved to, as `/map`'s is.
    asked: `/${summariseSkill.command} ${title}`,
  };
}

/**
 * Summarise `nodes` in turn, publishing the count. One Section's failure is
 * that Section's (`sectionFailure`): skipped, and the run goes on. It stays
 * unsummarised and its own button offers it again, so a later click does
 * not fail on the same Section first. A failure of the model or the run ends
 * it.
 */
async function summariseNodes(
  host: WorkflowHost,
  nodes: readonly string[],
  model: ModelRef,
  signal: AbortSignal,
): Promise<{ failed: ReadonlySet<string>; blocked: ReadonlySet<string> }> {
  const total = nodes.length;
  // The Sections skipped for their own text, for a run that must not
  // tell an account without them (`/summarise part`).
  const failed = new Set<string>();
  // The subset the same model would fail on again.
  const blocked = new Set<string>();
  for (const [index, nodeId] of nodes.entries()) {
    throwIfCancelled(signal);
    try {
      await generateSummary(host.dependencies, nodeId, model, signal);
    } catch (error) {
      if (!sectionFailure(error)) throw error;
      failed.add(nodeId);
      if (blocksSummary(error)) blocked.add(nodeId);
    }
    host.publish({
      runProgress: { work: "summarise", complete: index + 1, total },
    });
  }
  return { failed, blocked };
}

/** The summaries, bound to the aggregate. */
export function bind(host: WorkflowHost) {
  return {
    run: withHost(host, runSummarise),
    generate: withHost(host.dependencies, generateSummary),
  };
}
