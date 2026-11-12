// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  ProjectFacts,
  RunUsage,
  SourceDescriptor,
  SummaryMetadata,
  SummarySource,
  ModelRef,
} from "../domain/types";
import type { Artifacts, ModelProvider, ProjectSources } from "../ports";
import { limitsFor } from "./budgets";
import { characterTitles } from "./names";
import { ModelRunError, runStep } from "./runStep";
import { hashOf } from "../../text/hash";
import { STANDARD, samplingFields } from "../domain/mode";
import { projectFact } from "../domain/policy";

// On-demand generated summaries. A summary is derived from one node's own
// adopted prose (a live buffer when that node is the open file), never from
// references, notes or later sections, which keeps it usable inside a
// reader horizon. Generation is explicit, in memory until validated, and
// refuses to publish a stale replacement when the source changed mid-run.
// The app treats it as read-only; the writer owns the file and may edit it
// externally, which the body hash detects rather than overwrites.
//
// Besides the prose, a summary is told the book's title, type and language,
// and the names of its character sheets, never what a sheet says.
// The names fix the spelling of a name the Section uses, so `/where` can
// route by it, and nothing more. The instruction binds them: a character is
// named only as the Section names them, because summaries feed the reader
// chats, and a nickname resolved to a true name is an identity the Section
// withheld. The project briefing is left out, because its review orders
// would push a record the readers read toward critique. The Section's beat
// is never included: "Catastrophe" in a reader's record says what is
// coming.

export const SUMMARY_RECIPE = "node-summary";
/**
 * Bumped for the record when the recipe changes. It does not make a stored
 * summary stale, because freshness is the source hash, so a summary written
 * under the last recipe stays in use until its Section changes.
 */
export const SUMMARY_RECIPE_REVISION = "2";

/**
 * The source moved on while the summary was being generated. A typed error,
 * not a message string: the surface keys its state on the type.
 */
export class SummarySourceChangedError extends Error {
  constructor() {
    super("summary-source-changed");
    this.name = "SummarySourceChangedError";
  }
}

/**
 * The node is not in the catalogue: deleted, or moved out while a run
 * waited for its turn. Typed so a surface matches it by type, not by its
 * message, and never shows the raw string.
 */
export class SummarySourceMissingError extends Error {
  constructor() {
    super("summary-source-missing");
    this.name = "SummarySourceMissingError";
  }
}

/**
 * A model failure that belongs to this Section, not to the model: its prose
 * does not fit the window, or the model gave nothing back for it, stopped at
 * the output limit, or declined this text. It keeps `ModelRunError`'s code,
 * so every surface that renders a failure by code renders this one unchanged;
 * the subclass only marks where it came from.
 */
export class SummarySectionError extends ModelRunError {}

/**
 * Whether a summary failed for a reason that belongs to its one Section, so a
 * run over many Sections skips it and goes on (`completeLocate`).
 *
 * The line is drawn by where a failure came from, not by its code alone: an
 * adapter throws `invalid-response` for a malformed stream, which would hit
 * every Section in turn, while the empty-summary check in
 * `generateNodeSummary` throws the same code about this Section's own
 * output. The Section's failures are marked where they are thrown, and
 * everything else (Stop, the connection, a timeout, a key, a provider that
 * rejects the request itself) ends the run, because it would only repeat. A
 * refusal written as the answer to this text is the Section's, and skips.
 */
export function sectionFailure(error: unknown): boolean {
  return (
    error instanceof SummarySourceChangedError ||
    error instanceof SummarySourceMissingError ||
    error instanceof SummarySectionError
  );
}

/**
 * Whether a Section's summary failure would repeat on the same model: too
 * long for its window, cut off at the output limit, or declined.
 * Those are recorded as `unsummarisable`, so the answer stops offering the
 * click. An empty answer (`retryable`), a Section changed mid-summary or one
 * deleted are not: a second click may succeed, or the button already skips it.
 */
export function blocksSummary(error: unknown): boolean {
  return (
    error instanceof SummarySectionError &&
    (error.failure.code === "context-too-large" ||
      error.failure.code === "interrupted" ||
      error.failure.code === "provider-rejected")
  );
}

export interface SummaryDependencies {
  sources: ProjectSources;
  artifacts: Artifacts;
  provider: ModelProvider;
  /**
   * `null` when no model is chosen yet: a summary has no chat in scope to
   * inherit one from, and `generateNodeSummary` refuses with
   * `not-configured` rather than writing anything.
   */
  model: ModelRef | null;
  projectFacts: () => ProjectFacts | null;
}

/**
 * A first-person Section, summarised from the narrator's side. Otherwise a
 * summary calls its narrator only "the narrator" while the people around
 * them say their name, or reads "my father" as the father of someone else in
 * the scene, and every whole-book answer built on the summaries repeats the
 * error. The name rule still holds: the narrator is named only by what the
 * Section itself calls them.
 *
 * The relation has to be written as well as resolved. "Lei è con Leo, suo
 * padre Valerio" resolves "my father" to the narrator, and still reads in
 * Italian as Leo's father, because a possessive leans on the nearest name.
 */
const FIRST_PERSON = `If the source is told in the first person, say so, and name the narrator by the name the source itself uses for them — a name another character calls them, or one they give themselves; only if it never names them, call them the narrator. Resolve every relation the narrator speaks of from the narrator's side: "my father" is the narrator's father, never the father of anyone else in the scene. Write the relation so it cannot be read as anyone else's: a possessive beside another character's name leans on that name, so say whose father it is.`;

export async function generateNodeSummary(
  dependencies: SummaryDependencies,
  nodeId: string,
  signal: AbortSignal,
): Promise<RunUsage> {
  if (!dependencies.model)
    throw new ModelRunError({
      code: "not-configured",
      message: "Choose an installed Ollama model in Settings.",
      retryable: false,
    });
  const sourceId = `node:${nodeId}`;
  const catalogue = await dependencies.sources.list();
  const source = catalogue.find((one) => one.id === sourceId);
  if (!source) throw new SummarySourceMissingError();
  const before = await dependencies.sources.read(sourceId);
  const descriptor = await dependencies.provider.describeModel(
    dependencies.model,
    signal,
  );
  const limits = limitsFor(descriptor, 2_000);
  const facts = dependencies.projectFacts();
  // The book's title, type and language come from a project file that may be
  // shared, so each is held to the briefing's bounded line (`projectFact`)
  // before it enters the system prompt.
  const book = facts
    ? ` It is one part of "${projectFact(facts.title)}", a ${projectFact(facts.type)}.`
    : "";
  const request = {
    model: dependencies.model,
    instructions: `Create a neutral, factual summary of this single source.${book} Cover events, decisions, character knowledge, unresolved threads, explicit time and place cues, and changes of state. Do not critique, invent motives, or use knowledge from anywhere else, and do not mention the book's structure or where this part stands in it. Tell what happens rather than describing the text: where you must name the text itself, it is the section, never "the source". Name a character only as this source names them: the names listed beside it are for spelling, never to be added, and never to replace what the source calls someone. ${FIRST_PERSON} Write in ${facts ? projectFact(facts.language) : "the source's own language"}. Return only the summary.`,
    // The names travel as data beside the prose, never in the instructions:
    // they are file names from the writer's folder.
    messages: [
      {
        role: "user" as const,
        content: [characterNames(catalogue), before.text]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    tools: [],
    limits,
    // Standard, always: a summary is extraction, and no chat's Mode reaches
    // it. There is no chat in scope, and a setting chosen for brainstorming
    // must not leak into the record the reader chats are built on.
    ...samplingFields(STANDARD, descriptor),
  };
  const estimate = await dependencies.provider.estimate(request);
  // The bound is the step's own input allowance, the same number `runStep`
  // sends, not a re-derived slice of the advertised window: the headroom and
  // the output reserve are already inside `limits.inputTokens`.
  if (estimate.tokens > limits.inputTokens)
    throw new SummarySectionError({
      code: "context-too-large",
      message:
        "This source does not fit the model's context window for one summary. Choose a model with a larger window, or split the section.",
      retryable: false,
    });
  const result = await runStep(dependencies.provider, request, signal).catch(
    (error: unknown) => {
      // The same fact reported by the other side: a provider that counts
      // exactly (the OpenRouter request gate) says it where the estimate
      // could not. It is still this Section's size.
      if (
        error instanceof ModelRunError &&
        error.failure.code === "context-too-large"
      )
        throw new SummarySectionError(error.failure);
      throw error;
    },
  );
  if (result.reason === "cancelled")
    throw new ModelRunError({
      code: "cancelled",
      message: "Summary generation stopped.",
      retryable: false,
    });
  // A summary cut off at the output limit, or a refusal written as prose,
  // is never published as the record, where `/where` would route by half a
  // Section or by "I can't help with that".
  //
  // The code is the sentence the writer reads (`dock.modelError.<code>`), so
  // each takes the one that is true of it, not `invalid-response`: a cut-off
  // "ended before it was complete", and a refusal is the model saying no,
  // where the copy's remedy, another model, is the one that helps.
  if (result.reason === "limit" || result.reason === "refusal")
    throw new SummarySectionError({
      code: result.reason === "limit" ? "interrupted" : "provider-rejected",
      message:
        result.reason === "limit"
          ? "The summary was cut off before it ended."
          : "The model declined to summarise this source.",
      retryable: false,
    });
  const body = result.text.trim();
  if (!body)
    throw new SummarySectionError({
      code: "invalid-response",
      message: "The model returned an empty summary.",
      retryable: true,
    });
  const after = await dependencies.sources.read(sourceId);
  if (after.revision !== before.revision) throw new SummarySourceChangedError();
  const sources: SummarySource[] = [{ nodeId, contentHash: before.revision }];
  const metadata: SummaryMetadata = {
    schemaVersion: 1,
    nodeId,
    scope: "node",
    sources,
    model: { ...dependencies.model, modelRevision: descriptor.revision },
    recipe: SUMMARY_RECIPE,
    recipeRevision: SUMMARY_RECIPE_REVISION,
    language: dependencies.projectFacts()?.language ?? "project",
    generatedAt: new Date().toISOString(),
    bodyHash: await hashOf(body),
  };
  await dependencies.artifacts.writeSummary(nodeId, metadata, body);
  return result.usage;
}

/**
 * The cast line a summary spells by: the sheets' titles and never an alias
 * (`names.ts`). Empty when there are none, so a book without sheets sends
 * the prose alone.
 */
function characterNames(catalogue: readonly SourceDescriptor[]): string {
  const names = characterTitles(catalogue);
  return names.length
    ? `Character names in this project, as the writer spells them: ${names.join(", ")}.\n\nThe source:`
    : "";
}
