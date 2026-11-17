// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  ChatRecord,
  CoverageReport,
  Finding,
  ModelRef,
  PersonaDefinition,
  ProjectFacts,
  ReviewCheckpoint,
  ReviewScope,
  ReviewSegment,
  ReviewTask,
  RunUsage,
  SegmentsCheckpoint,
  SourceText,
  ToolCall,
} from "../domain/types";
import { sameModel } from "../domain/types";
import { STANDARD, samplingFields } from "../domain/mode";
import type { Artifacts, ModelProvider, ProjectSources } from "../ports";
import {
  SEGMENT_OVERLAP,
  budgetFor,
  inputCharactersFor,
  limitsFor,
} from "./budgets";
import {
  fenced,
  referenceMessage,
  referenceUsage,
  selectDeclared,
} from "./context";
import { readsFor } from "../domain/skills";
import { relevanceTerms } from "../domain/relevance";
import { declaredSources } from "../domain/sourceView";
import {
  ModelRunError,
  mergeUsage,
  requireTools,
  runStep,
  stoppedIf,
} from "./runStep";
import {
  TOOL_DEFINITIONS,
  executeTool,
  toFindings,
  type RawFinding,
  type ToolContext,
} from "./tools";
import { validateFindings } from "./validateEvidence";
import { newId } from "./ids";
import {
  PROSE_BOUNDARY,
  projectBriefing,
  reviewRecipe,
} from "../domain/policy";
import { genreBriefing } from "../domain/genres";
import { appLog, describeError } from "../../log";

// Reviews past one Section run as a resumable work plan, not one oversized
// prompt. The plan is a checkpoint ledger: the work is partitioned into
// bounded steps, each step's findings are validated against the exact text
// the model saw, and the checkpoint is written after each, so an
// interruption leaves reusable artifacts rather than lost model state.
// Resume re-reads sources, reuses unchanged completed work, and reruns what
// changed.
//
// Two engines share this ledger. This file holds the segment sweep,
// every source cut into windows each read alone, which suits
// `/line-editing`, and the pieces both engines share: the findings step, the
// synthesis, and the publish-time check. `reviewWide.ts` holds the engine
// that reads Sections together for every other review.

export const REVIEW_RECIPE = "full-review";
/**
 * Bumped when a plan's shape changes, so an older plan is refused rather
 * than resumed.
 */
export const REVIEW_RECIPE_REVISION = "3";

/** The plan would exceed the work-plan storage bound. */
export class ReviewPlanTooLargeError extends Error {
  constructor() {
    super("review-plan-too-large");
    this.name = "ReviewPlanTooLargeError";
  }
}

const MAX_PLAN_BYTES = 8 * 1024 * 1024;

export interface ReviewDependencies {
  sources: ProjectSources;
  artifacts: Artifacts;
  model: ModelProvider;
  /**
   * What the book is, so `PROSE_BOUNDARY`'s "use the project's language"
   * has something to point at. A wrong-language answer costs
   * most on a review: its findings quote the manuscript, and `anchorState`
   * drops any quote that is not byte-exact.
   */
  projectFacts?: () => ProjectFacts | null;
  /**
   * Steps done of those planned; for the segment sweep, a segment is one
   * step. Never Sections: the copy that shows it says "steps".
   */
  onProgress?: (progress: { complete: number; total: number }) => void;
}

export interface ReviewOutcome {
  checkpoint: ReviewCheckpoint;
  usage: RunUsage;
  coverage: CoverageReport;
}

/** Segment one source into bounded windows with a controlled overlap. */
export function planSegments(
  sourceId: string,
  text: string,
  window: number,
): ReviewSegment[] {
  if (text.length <= window)
    return [
      { id: newId(), sourceId, start: 0, end: text.length, state: "pending" },
    ];
  const step = Math.max(1, window - SEGMENT_OVERLAP);
  const segments: ReviewSegment[] = [];
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(text.length, start + window);
    segments.push({ id: newId(), sourceId, start, end, state: "pending" });
    if (end >= text.length) break;
  }
  return segments;
}

/**
 * Write a new plan, refusing one past the storage bound. Both engines plan
 * through here, so the bound has one home.
 */
export async function savePlan(
  dependencies: ReviewDependencies,
  checkpoint: ReviewCheckpoint,
): Promise<void> {
  const size = new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength;
  if (size > MAX_PLAN_BYTES) throw new ReviewPlanTooLargeError();
  await dependencies.artifacts.saveReview(checkpoint);
}

/** The fields every plan starts with, whichever engine runs it. */
export function planHeader(
  chat: ChatRecord,
  task: ReviewTask,
  scope: ReviewScope,
  model: ModelRef,
  personaId: string,
  sources: ReviewCheckpoint["sources"],
) {
  const stamp = new Date().toISOString();
  return {
    schemaVersion: 1 as const,
    runId: newId(),
    chatId: chat.id,
    task,
    scope,
    state: "running" as const,
    model,
    personaId,
    recipe: REVIEW_RECIPE,
    recipeRevision: REVIEW_RECIPE_REVISION,
    sources,
    findings: [],
    usage: { steps: 0 },
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * Plan the segment sweep over `sourceIds`: the Sections of the scope, in
 * reading order, which the caller resolves. References are never
 * reviewed as prose.
 *
 * Snapshots and the writer's barred list need no exclusion here, because
 * the port lists neither.
 */
export async function planReview(
  dependencies: ReviewDependencies,
  chat: ChatRecord,
  task: ReviewTask,
  scope: ReviewScope,
  model: ModelRef,
  personaId: string,
  sourceIds: readonly string[],
  signal: AbortSignal,
  /** What the chat may read now; nothing, and the plan leaves no room. */
  allowed: ReadonlySet<string> = new Set(),
): Promise<SegmentsCheckpoint> {
  // Segments are sized to the model that will read them, so the plan cannot
  // be partitioned for one window and executed against another. They also
  // leave room for the references each carries (`sweepReferences`), so the
  // style rules sit beside the sentence they govern. The room is what the
  // references measure, never the whole allowance, so a book with no style
  // page and no sheet pays nothing for them.
  const budget = budgetFor(
    await dependencies.model.describeModel(model, signal),
  );
  const referenceRoom = (
    await sweepReferences(
      dependencies,
      task,
      model,
      allowed,
      budget.referenceCharacters,
      [],
      signal,
    )
  ).size;
  const window = budget.sourceCharacters - referenceRoom;
  const segments: ReviewSegment[] = [];
  const rows: ReviewCheckpoint["sources"] = [];
  for (const sourceId of sourceIds) {
    const capture = await dependencies.sources.read(sourceId);
    segments.push(...planSegments(sourceId, capture.text, window));
    rows.push({ sourceId, revision: capture.revision, state: "pending" });
  }
  const checkpoint: SegmentsCheckpoint = {
    ...planHeader(chat, task, scope, model, personaId, rows),
    method: "segments",
    segments,
    referenceRoom,
  };
  await savePlan(dependencies, checkpoint);
  return checkpoint;
}

/** One reading step, as the engine that runs it describes it. */
export interface FindingsRequest {
  model: ModelRef;
  task: ReviewTask;
  persona: PersonaDefinition | null;
  /** App-written: what this step is shown, and how to answer. */
  clause: string;
  /** Data: the fenced sources, and anything else handed in as data. */
  message: string;
  /**
   * What the step showed, by source id: the only text a quote may be
   * verified against. A summary or a model-written lead is never here.
   */
  captures: ReadonlyMap<string, SourceText>;
  outputTokens: number;
}

/**
 * One step that reads and answers with `submit_findings` and nothing else,
 * so a step can neither wander off to read something unplanned nor answer
 * in prose the app cannot check. Findings come back validated
 * against the step's own captures; publish checks them again against the
 * sources as they read then.
 */
export async function findingsStep(
  dependencies: ReviewDependencies,
  request: FindingsRequest,
  signal: AbortSignal,
): Promise<{ findings: Finding[]; usage: RunUsage; complete: boolean }> {
  const raw: RawFinding[] = [];
  const descriptor = await dependencies.model.describeModel(
    request.model,
    signal,
  );
  const context: ToolContext = {
    sources: dependencies.sources,
    // `submit_findings` reads no catalogue, and an empty one keeps this
    // correct if a reading tool is ever added here.
    catalog: [],
    allowed: new Set(request.captures.keys()),
    used: [],
    budget: budgetFor(descriptor),
    submitFindings: (findings: RawFinding[]) => {
      raw.push(...findings.slice(0, 100));
      return { accepted: findings.length, rejected: [] };
    },
  };
  requireTools(descriptor, "the review");
  const limits = limitsFor(descriptor, request.outputTokens);
  const result = await runStep(
    dependencies.model,
    {
      model: request.model,
      instructions: [
        PROSE_BOUNDARY,
        projectBriefing(dependencies.projectFacts?.() ?? null),
        // The genre contract a "contract" severity is measured against.
        genreBriefing(dependencies.projectFacts?.() ?? null),
        reviewRecipe(request.task),
        request.persona ? `Persona: ${request.persona.instructions}` : "",
        request.clause,
      ]
        .filter(Boolean)
        .join("\n\n"),
      messages: [{ role: "user", content: request.message }],
      tools: [TOOL_DEFINITIONS.submit_findings],
      limits,
      // Standard, like every piece of the assistant's housekeeping: a review
      // pass is extraction against a rubric.
      ...samplingFields(STANDARD, descriptor),
    },
    signal,
  );
  stoppedIf(result.reason, "Review stopped");
  // An answer cut off by the output limit, or declined, may have read only
  // part of what it was shown.
  let complete = result.reason !== "limit" && result.reason !== "refusal";
  for (const call of result.calls) {
    if (call.name !== "submit_findings") continue;
    const answer = await executeTool(call, context);
    // An empty list fails the schema's minimum, yet it is the answer the
    // clause asks for when nothing applies: nothing was found, nothing lost.
    if (!refused(answer) || noFindings(call)) continue;
    // One finding out of shape fails the whole call's schema. The rest are
    // still the model's reading: kept, shaped by `toFindings`, and the step
    // is not called complete over the ones that were lost.
    complete = false;
    raw.push(...salvaged(call, context.allowed));
  }
  return {
    findings: validateFindings(toFindings(raw, newId), request.captures)
      .findings,
    usage: result.usage,
    complete,
  };
}

function refused(answer: unknown): boolean {
  return (
    typeof answer === "object" &&
    answer !== null &&
    "error" in answer &&
    answer.error !== undefined
  );
}

function noFindings(call: ToolCall): boolean {
  const args = call.arguments;
  return (
    typeof args === "object" &&
    args !== null &&
    "findings" in args &&
    Array.isArray(args.findings) &&
    args.findings.length === 0
  );
}

/**
 * The findings of a `submit_findings` call its schema refused, held to the
 * scope rule the tool applies: each cites at least one source, and only
 * sources the step showed.
 */
function salvaged(call: ToolCall, allowed: ReadonlySet<string>): RawFinding[] {
  const args = call.arguments;
  const items =
    typeof args === "object" &&
    args !== null &&
    "findings" in args &&
    Array.isArray(args.findings)
      ? (args.findings as unknown[])
      : [];
  return items
    .filter((item): item is RawFinding => {
      const evidence = (item as { evidence?: unknown } | null)?.evidence;
      return (
        Array.isArray(evidence) &&
        evidence.length > 0 &&
        evidence.every(
          (anchor: { sourceId?: unknown } | null) =>
            typeof anchor?.sourceId === "string" &&
            allowed.has(anchor.sourceId),
        )
      );
    })
    .slice(0, 100);
}

/**
 * What a step of a sweep carries beside its segment: the references the
 * command reads, narrowed to the roles it asks for (`/line-editing` reads the
 * style rules and each character's voice, never their history), how to read
 * them, and their text as read for the evidence check. Without them a line
 * edit could "fix" a voice or a point of view the writer's own pages ask
 * for.
 *
 * Chosen for each segment by the names it uses (`relevanceTerms`), so a long
 * cast gives each passage the voices in it rather than the first that fit.
 * Never more than `room`, block and clause together: the plan measured the
 * room with no terms, and a step never exceeds what its segment was cut to
 * leave.
 */
interface SweepReferences {
  message: string;
  clause: string;
  captures: ReadonlyMap<string, SourceText>;
  skipped: CoverageReport["skipped"];
  /** What the message and the clause take together; 0 with nothing. */
  size: number;
}

const NO_REFERENCES: SweepReferences = {
  message: "",
  clause: "",
  captures: new Map(),
  skipped: [],
  size: 0,
};

async function sweepReferences(
  dependencies: ReviewDependencies,
  task: ReviewTask,
  model: ModelRef,
  allowed: ReadonlySet<string>,
  room: number,
  terms: readonly string[],
  signal: AbortSignal,
): Promise<SweepReferences> {
  const reads = readsFor(task);
  if (reads.length === 0 || room <= 0) return NO_REFERENCES;
  const budget = budgetFor(
    await dependencies.model.describeModel(model, signal),
  );
  const catalog = await dependencies.sources.list();
  // Paid from the references' room and never more than a quarter of it, as
  // in a chat (`turnRun.ts`).
  const clause = referenceUsage(
    declaredSources(catalog, allowed, reads),
    Math.floor(room / 4),
    reads,
  );
  // The fences and the framing line cost a little beyond the texts the
  // selection counts, so the message is measured and the texts' room cut by
  // the excess until the two fit.
  let texts = room - clause.length;
  for (let tries = 0; tries < 3 && texts > 0; tries += 1) {
    const declared = await selectDeclared(
      dependencies.sources,
      catalog,
      allowed,
      reads,
      { uses: [], texts: new Map() },
      0,
      { ...budget, referenceCharacters: texts },
      { terms },
    );
    const message = referenceMessage(declared);
    if (!message) return { ...NO_REFERENCES, skipped: declared.skipped };
    const size = message.length + clause.length;
    if (size <= room)
      return {
        message,
        clause,
        captures: new Map(
          declared.uses.flatMap((use) => {
            const capture = declared.captures?.get(use.id);
            return capture ? [[use.id, capture] as const] : [];
          }),
        ),
        skipped: declared.skipped,
        size,
      };
    texts -= size - room;
  }
  return NO_REFERENCES;
}

/** The segment sweep's reading step: one window of one source, alone. */
async function extractSegment(
  dependencies: ReviewDependencies,
  checkpoint: SegmentsCheckpoint,
  segment: ReviewSegment,
  title: string,
  persona: PersonaDefinition | null,
  signal: AbortSignal,
  capture: SourceText,
  allowed: ReadonlySet<string>,
  skipped: Map<string, CoverageReport["skipped"][number]>,
  attached: Set<string>,
): Promise<{ findings: Finding[]; usage: RunUsage; complete: boolean }> {
  const text = capture.text.slice(segment.start, segment.end);
  const references = await sweepReferences(
    dependencies,
    checkpoint.task,
    checkpoint.model,
    allowed,
    checkpoint.referenceRoom,
    relevanceTerms("", [text]),
    signal,
  );
  for (const id of references.captures.keys()) attached.add(id);
  for (const one of references.skipped) skipped.set(one.sourceId, one);
  return findingsStep(
    dependencies,
    {
      model: checkpoint.model,
      task: checkpoint.task,
      persona,
      clause: [
        references.clause,
        "Use submit_findings with every evidence-backed finding for this passage. Quote the source text exactly. Return no findings if none apply.",
      ]
        .filter(Boolean)
        .join(" "),
      message: [
        references.message,
        fenced("SOURCE", segment.sourceId, title, [], text),
      ]
        .filter(Boolean)
        .join("\n\n"),
      // Validate against the exact text this segment showed the model, and
      // the references as read.
      captures: new Map([
        ...references.captures,
        [segment.sourceId, { ...capture, text }],
      ]),
      outputTokens: 2_000,
    },
    signal,
  );
}

/**
 * Merge duplicates across the steps' findings. Returns `null` to keep the
 * steps' own findings: too few to merge, too many to reconcile in one step,
 * or an answer that is not a list.
 */
async function synthesise(
  dependencies: ReviewDependencies,
  checkpoint: ReviewCheckpoint,
  signal: AbortSignal,
): Promise<{ findings: Finding[]; usage: RunUsage } | null> {
  const findings = checkpoint.findings;
  if (findings.length < 2) return null;
  const payload = JSON.stringify(findings);
  const descriptor = await dependencies.model.describeModel(
    checkpoint.model,
    signal,
  );
  const limits = limitsFor(descriptor, 4_000);
  if (payload.length > inputCharactersFor(limits)) return null;
  const result = await runStep(
    dependencies.model,
    {
      model: checkpoint.model,
      instructions: [
        reviewRecipe(checkpoint.task),
        "Reconcile these findings across sources. Merge duplicates, keep every verified evidence anchor exactly as given (sourceId, quote, prefix, suffix), and return a JSON array with the same fields. Add nothing that is not supported by the supplied findings.",
      ].join("\n\n"),
      messages: [{ role: "user", content: payload }],
      tools: [],
      limits,
      ...samplingFields(STANDARD, descriptor),
    },
    signal,
  );
  stoppedIf(result.reason, "Review stopped");
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text.replace(/^```json\s*|\s*```$/g, ""));
  } catch (err) {
    appLog.warn("ai", "The merged review findings were not JSON.", {
      provider: checkpoint.model.providerId,
      model: checkpoint.model.modelId,
      length: result.text.length,
      ...describeError(err),
    });
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  // Model text in the findings' shape, held to what it was handed: each
  // merged finding shaped by `toFindings`, its anchors only in sources the
  // findings cited, and one left with none is no finding. Publish reads
  // every source an anchor names, so an unchecked id would be a read the
  // review never planned. An anchor given back as it was handed keeps the
  // revision it was verified at, so publish still drops it if that source
  // has changed since.
  const cited = new Set(
    findings.flatMap((finding) => finding.evidence.map((one) => one.sourceId)),
  );
  const revisions = new Map(
    findings.flatMap((finding) =>
      finding.evidence.map(
        (one) => [`${one.sourceId}\u0000${one.quote}`, one.revision] as const,
      ),
    ),
  );
  const merged = toFindings(parsed as RawFinding[], newId)
    .map((finding) => ({
      ...finding,
      evidence: finding.evidence
        .filter((one) => cited.has(one.sourceId))
        .map((one) => {
          const revision = revisions.get(`${one.sourceId}\u0000${one.quote}`);
          return revision ? { ...one, revision } : one;
        }),
    }))
    .filter((finding) => finding.evidence.length > 0);
  return {
    findings: [...merged, ...lost(findings, merged)],
    usage: result.usage,
  };
}

/**
 * The findings a reconciliation left out: those no finding it returned
 * quotes any of the same places for. Merging is the step's job; dropping a
 * finding is not, and nothing else would notice. A returned finding
 * covers another when one of its anchors and one of the other's are in the
 * same source and one quote holds the other.
 */
function lost(
  before: readonly Finding[],
  after: readonly Finding[],
): Finding[] {
  const anchors = after.flatMap((finding) =>
    Array.isArray(finding?.evidence) ? finding.evidence : [],
  );
  return before.filter(
    (finding) =>
      !finding.evidence.some((one) =>
        anchors.some(
          (other) =>
            typeof other?.quote === "string" &&
            other.sourceId === one.sourceId &&
            (other.quote.includes(one.quote) ||
              one.quote.includes(other.quote)),
        ),
      ),
  );
}

/**
 * Finish a plan whose steps are done: synthesise, then re-read every cited
 * source and re-validate the anchors against its current text. A source that
 * changed drops the anchors it does not hold, and a comparison that lost
 * one side is demoted (`validateFinding`). Coverage is the plan's own source
 * states, plus whatever the engine names beside them (a declared reference
 * that did not fit).
 */
export async function publishReview(
  dependencies: ReviewDependencies,
  checkpoint: ReviewCheckpoint,
  usage: RunUsage,
  signal: AbortSignal,
  beside: CoverageReport["skipped"] = [],
): Promise<ReviewOutcome> {
  let working = checkpoint;
  const synthesis = await synthesise(dependencies, working, signal);
  if (synthesis) {
    usage = mergeUsage(usage, synthesis.usage);
    working = { ...working, findings: synthesis.findings, usage };
  }
  const freshCaptures = new Map<string, SourceText>();
  const unreadable: string[] = [];
  let readError: unknown;
  for (const sourceId of new Set(
    working.findings.flatMap((finding) =>
      finding.evidence.map((anchor) => anchor.sourceId),
    ),
  )) {
    try {
      freshCaptures.set(sourceId, await dependencies.sources.read(sourceId));
    } catch (err) {
      // Unreadable at publish time; validation drops the anchors.
      unreadable.push(sourceId);
      readError = err;
    }
  }
  // Each source's kind, so a reference's quote is held to its answers and
  // names its field. An unreadable catalogue checks text alone.
  const kinds = new Map(
    (
      await dependencies.sources.list().catch((err) => {
        appLog.warn(
          "ai",
          "The source catalogue could not be listed at publish.",
          {
            ...describeError(err),
          },
        );
        return [];
      })
    ).map((one) => [one.id, one]),
  );
  if (unreadable.length > 0)
    appLog.warn("ai", "Cited sources could not be read at publish.", {
      count: unreadable.length,
      kinds: [
        ...new Set(unreadable.map((id) => kinds.get(id)?.kind ?? "unknown")),
      ].join(","),
      ...describeError(readError),
    });
  const validated = validateFindings(working.findings, freshCaptures, kinds);
  const inspected = working.sources.filter(
    (one) => one.state === "complete",
  ).length;
  // What the fact stage judged, off the plan: a review is complete when its
  // reading and its judging are. A candidate the judge could not answer, or
  // was never asked about, leaves it short, and the coverage names the
  // unjudged ones so the answer is never mistaken for a clean bill.
  const judgement = working.method === "sections" ? working.facts : undefined;
  // A reference the check could not read into a ledger is on the plan
  // (`facts.unread`) whether or not this publish was handed it beside the
  // Sections: named once, and never complete over it.
  const unread = (judgement?.unread ?? []).filter(
    (sourceId) => !beside.some((row) => row.sourceId === sourceId),
  );
  const coverage: CoverageReport = {
    intended: working.sources.length,
    inspected,
    // `flatMap` rather than filter-then-map so the narrowing survives: the
    // reason is the state minus `complete`, checked against the closed
    // `CoverageSkipReason` union instead of widened to a string.
    skipped: [
      ...working.sources.flatMap((one) =>
        one.state === "complete"
          ? []
          : [{ sourceId: one.sourceId, reason: one.state }],
      ),
      ...beside,
      ...unread.map((sourceId) => ({
        sourceId,
        reason: "unextracted" as const,
      })),
    ],
    complete:
      inspected === working.sources.length &&
      beside.length === 0 &&
      unread.length === 0 &&
      (working.method !== "segments" ||
        working.segments.every((segment) => segment.state === "complete")) &&
      (judgement === undefined || judgement.judged === judgement.candidates),
    ...(judgement ? { judgement } : {}),
  };
  working = {
    ...working,
    findings: validated.findings,
    state: "complete",
    usage,
    updatedAt: new Date().toISOString(),
  };
  await dependencies.artifacts.saveReview(working);
  return { checkpoint: working, usage, coverage };
}

/**
 * Execute (or continue) a segment sweep. The checkpoint is persisted after
 * each completed segment; progress is reported per completed source.
 */
export async function executeReview(
  dependencies: ReviewDependencies,
  checkpoint: SegmentsCheckpoint,
  persona: PersonaDefinition | null,
  signal: AbortSignal,
  /**
   * What the chat may read now: the references come only from it, so a
   * caller that says nothing gets none (fail closed).
   */
  allowed: ReadonlySet<string> = new Set(),
): Promise<ReviewOutcome> {
  let usage = checkpoint.usage;
  let working: SegmentsCheckpoint = { ...checkpoint, state: "running" };
  const catalog = new Map(
    (await dependencies.sources.list()).map((source) => [source.id, source]),
  );
  // A declared document no segment attached is named in the coverage, once.
  const skipped = new Map<string, CoverageReport["skipped"][number]>();
  const attached = new Set<string>();

  for (const row of working.sources) {
    // `failed` is final here: the caller marks what this chat may not read
    // as failed, and a row that says so is never read, catalogued or not.
    if (row.state === "complete" || row.state === "failed") continue;
    const source = catalog.get(row.sourceId);
    if (!source) {
      working = {
        ...working,
        sources: working.sources.map((one) =>
          one.sourceId === row.sourceId ? { ...one, state: "failed" } : one,
        ),
        updatedAt: new Date().toISOString(),
      };
      continue;
    }
    const planned = working.sources.find(
      (one) => one.sourceId === row.sourceId,
    );
    const capture = await dependencies.sources.read(row.sourceId);
    if (planned?.revision && capture.revision !== planned.revision) {
      // The writer edited this source since the plan was made: invalidate its
      // remaining segments, keep the new revision, and re-plan them.
      working = {
        ...working,
        sources: working.sources.map((one) =>
          one.sourceId === row.sourceId
            ? { ...one, revision: capture.revision, state: "pending" }
            : one,
        ),
        segments: working.segments.map((one) =>
          one.sourceId === row.sourceId
            ? { ...one, state: "invalidated" as const }
            : one,
        ),
        findings: working.findings.filter(
          (finding) =>
            !finding.evidence.some(
              (anchor) => anchor.sourceId === row.sourceId,
            ),
        ),
        updatedAt: new Date().toISOString(),
      };
    }
    // Invalidated segments are offsets into a text that is gone, here or on a
    // resume after an edit stopped the run. The source is cut again over the
    // text as it reads now, in its place in the plan, so no part of it goes
    // unread. An edit invalidates every segment of its source and drops its
    // findings, so nothing read before is read twice.
    if (
      working.segments.some(
        (one) => one.sourceId === row.sourceId && one.state === "invalidated",
      )
    ) {
      const window =
        budgetFor(await dependencies.model.describeModel(working.model, signal))
          .sourceCharacters - working.referenceRoom;
      working = {
        ...working,
        segments: replanned(
          working.segments,
          planSegments(row.sourceId, capture.text, window),
        ),
        updatedAt: new Date().toISOString(),
      };
    }
    const freshCapture = capture;
    // Whether every step over this source read all it was shown.
    let whole = true;
    for (const segment of working.segments.filter(
      (one) => one.sourceId === row.sourceId,
    )) {
      // A resumed pass reuses completed segments: their validated artifacts
      // are in the checkpoint, and re-extracting them would duplicate work
      // and findings until the publish-time dedupe.
      if (segment.state === "complete") continue;
      if (signal.aborted)
        throw new ModelRunError({
          code: "cancelled",
          message: "Review stopped",
          retryable: false,
        });
      // Re-read between segments so a writer edit cannot be styled as read.
      const fresh = await dependencies.sources.read(row.sourceId);
      if (fresh.revision !== freshCapture.revision) {
        working = {
          ...working,
          state: "interrupted",
          sources: working.sources.map((one) =>
            one.sourceId === row.sourceId
              ? { ...one, revision: fresh.revision, state: "pending" }
              : one,
          ),
          segments: working.segments.map((one) =>
            one.sourceId === row.sourceId
              ? { ...one, state: "invalidated" as const }
              : one,
          ),
          findings: working.findings.filter(
            (finding) =>
              !finding.evidence.some(
                (anchor) => anchor.sourceId === row.sourceId,
              ),
          ),
          updatedAt: new Date().toISOString(),
        };
        await dependencies.artifacts.saveReview(working);
        throw new ModelRunError({
          code: "interrupted",
          message: "A source changed while the review was running.",
          retryable: true,
        });
      }
      const extraction = await extractSegment(
        dependencies,
        working,
        segment,
        source.title,
        persona,
        signal,
        freshCapture,
        allowed,
        skipped,
        attached,
      );
      usage = mergeUsage(usage, extraction.usage);
      // A step that fell short keeps what it found and stays pending, so the
      // coverage never reads it as read. The segment names those findings,
      // and its next step replaces them rather than adding them again.
      if (!extraction.complete) whole = false;
      const earlier = new Set(segment.findingIds ?? []);
      working = {
        ...working,
        segments: working.segments.map((one) => {
          if (one.id !== segment.id) return one;
          const { findingIds, ...rest } = one;
          return {
            ...rest,
            state: extraction.complete ? "complete" : "pending",
            revision: freshCapture.revision,
            ...(extraction.complete
              ? {}
              : { findingIds: extraction.findings.map((found) => found.id) }),
          };
        }),
        findings: [
          ...working.findings.filter((found) => !earlier.has(found.id)),
          ...extraction.findings,
        ],
        usage,
        updatedAt: new Date().toISOString(),
      };
      await dependencies.artifacts.saveReview(working);
      dependencies.onProgress?.(segmentSteps(working));
    }
    working = {
      ...working,
      sources: working.sources.map((one) =>
        one.sourceId === row.sourceId
          ? {
              ...one,
              state: whole ? "complete" : "pending",
              revision: freshCapture.revision,
            }
          : one,
      ),
      usage,
      updatedAt: new Date().toISOString(),
    };
    await dependencies.artifacts.saveReview(working);
    dependencies.onProgress?.(segmentSteps(working));
  }

  return publishReview(
    dependencies,
    working,
    usage,
    signal,
    [...skipped.values()].filter((one) => !attached.has(one.sourceId)),
  );
}

/**
 * A plan's segments with one source's replaced by `fresh`, where that
 * source's first one stood.
 */
function replanned(
  segments: readonly ReviewSegment[],
  fresh: readonly ReviewSegment[],
): ReviewSegment[] {
  const sourceId = fresh[0]?.sourceId;
  const at = segments.findIndex((one) => one.sourceId === sourceId);
  const others = segments.filter((one) => one.sourceId !== sourceId);
  // Nothing before the first of them is theirs, so `at` counts others alone.
  if (at < 0) return [...others, ...fresh];
  return [...others.slice(0, at), ...fresh, ...others.slice(at)];
}

/** The sweep's steps: its live segments, an invalidated one replaced. */
function segmentSteps(working: SegmentsCheckpoint): {
  complete: number;
  total: number;
} {
  const live = working.segments.filter((one) => one.state !== "invalidated");
  return {
    complete: live.filter((one) => one.state === "complete").length,
    total: live.length,
  };
}

/**
 * Whether a checkpoint may resume under the current model, persona and
 * recipe. A mismatch is a refusal, not a half-and-half continuation.
 *
 * The persona is compared by id alone: personas are not versioned,
 * so rewording a persona file does not invalidate a plan in flight, and a
 * resumed review runs under whatever the file says now. The recipe carries
 * its own revision, bumped when the review's shape changes.
 */
export function resumable(
  checkpoint: ReviewCheckpoint,
  current: { model: ModelRef; personaId: string },
): boolean {
  return (
    sameModel(checkpoint.model, current.model) &&
    checkpoint.personaId === current.personaId &&
    checkpoint.recipeRevision === REVIEW_RECIPE_REVISION &&
    checkpoint.state !== "complete"
  );
}
