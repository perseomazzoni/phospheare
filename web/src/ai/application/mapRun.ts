// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// `/map` lays a story structure over the book or one Part, placing each of
// the structure's beats (its stages) on the Sections. On one Section it finds
// where each beat begins in the prose, or only which structure the Section
// fits. The answer is stored as a question and answer pair. Every refusal
// comes before the one model request (`mapTarget`), and the run calls the
// chat aggregate only through `WorkflowHost`.

import type { WorkflowHost } from "./workflowRun";
import { completeRun } from "./summaryRun";
import { oneLine } from "./context";
import { wideSections } from "./reviewWide";
import { mapStructure } from "./mapStructure";
import { mapPassages, mapSectionRoom } from "./mapPassages";
import {
  MAP_SHAPES,
  childrenOf,
  mapHeadline,
  mapIsStale,
  mapUnits,
  planMap,
  structureNodeIds,
  structureRevision,
  typedShapeOf,
  type MapPlan,
} from "../domain/structureShapes";
import { isPart, partFor } from "../domain/parts";
import { mapSkill, skillsFor } from "../domain/skills";
import {
  markUnsummarisable,
  summaryBlockLifted,
  toSummarise,
} from "../domain/sourceView";
import type {
  ChatRecord,
  MapOutcome,
  MapShapeId,
  ModelRef,
  ReviewScope,
  SourceDescriptor,
  SourceText,
} from "../domain/types";
import { withHost } from "./features";

/**
 * A `/map` run, resolved and refused-or-not before any request: an arc of
 * units on beats, or one Section read whole.
 */
type MapTarget = ArcTarget | SectionTarget;

interface ArcTarget {
  kind: "arc";
  chat: ChatRecord;
  model: ModelRef;
  /** The scope as run: `part` resolved to the Part it named. */
  planned: MapOutcome["scope"];
  /** The shape, where it came from and how units are placed, resolved once. */
  plan: MapPlan;
  /** The reader boundary's listing, for the summaries a button would write. */
  catalog: readonly SourceDescriptor[];
  allowed: ReadonlySet<string>;
  sectionIds: string[];
  /** The question as the writer would have typed it. */
  asked: string;
}

interface SectionTarget {
  kind: "section";
  chat: ChatRecord;
  model: ModelRef;
  section: SourceDescriptor;
  /** The shape its beats are read on; null reads it for its fit alone. */
  shape: MapShapeId | null;
  shapeFrom: "typed" | "declared";
  fit: boolean;
  /** The Section as measured against the room: what the run sends. */
  shown: SourceText;
  catalog: readonly SourceDescriptor[];
  asked: string;
}

/**
 * `/map`: place the scope on its structure (the declared one, or
 * `shape`, the one the writer typed for this map) and write the answer as
 * a pair, like `/where`. A Stop publishes nothing: the map has no
 * checkpoint, and a half-placed book would draw a Structure that is not the
 * writer's.
 */
export async function runMap(
  host: WorkflowHost,
  scope: ReviewScope,
  shape?: MapShapeId,
): Promise<"started" | "rejected"> {
  // No count until the engine has one: its steps depend on the rows.
  return host.runWorkflow({
    prepare: async () => {
      const chat = host.activeChat();
      return chat ? mapTarget(host, chat, scope, shape) : null;
    },
    failure: "The map could not be started.",
    chatId: ({ chat }) => chat.id,
    run: (prepared, signal) => mapAndAnswer(host, prepared, signal),
    stopped: ({ chat }, error) =>
      host.endWorkflowRun(chat.id, error, [
        "Map stopped.",
        "The map was interrupted.",
      ]),
  });
}

/**
 * Place a prepared scope and write the pair, in place of `replacing` when
 * a button asked for the answer to be finished.
 */
async function mapAndAnswer(
  host: WorkflowHost,
  prepared: MapTarget,
  signal: AbortSignal,
  replacing?: string,
  /** This run's summaries that failed for good (`completeMap`). */
  unsummarisable?: ReadonlySet<string>,
): Promise<void> {
  if (prepared.kind === "section")
    return mapSectionAndAnswer(host, prepared, signal, replacing);
  const { chat, model, planned, plan, allowed, sectionIds, asked } = prepared;
  const { outcome, usage } = await mapStructure(
    {
      sources: host.dependencies.sources,
      model: host.dependencies.model,
      modelRef: model,
      projectFacts: host.dependencies.projectFacts,
      onProgress: (progress) =>
        host.publish({ runProgress: { work: "map", ...progress } }),
    },
    {
      scope: planned,
      plan,
      allowed,
      sectionIds,
      // The key is the switch: a `/map` file without it prints no counts.
      ...(mapSkill.words ? { words: mapSkill.words } : {}),
    },
    signal,
  );
  await host.publishWorkflowPair(
    chat.id,
    asked,
    {
      // Never the history line: history rebuilds that from the block
      // (`mapHistoryLine`), so this text is read only by a person, and
      // only when a malformed block was dropped on replay. It is an
      // id-free headline, not the ids and verdict words (`mapHeadline`).
      text: mapHeadline(
        outcome.shape,
        outcome.scope.kind === "node" ? "part" : "structure",
      ),
      mapped: {
        ...outcome,
        coverage: markUnsummarisable(outcome.coverage, unsummarisable),
      },
      model,
      usage,
    },
    replacing,
  );
}

/** One Section's beats, or its fit alone, and the pair. */
async function mapSectionAndAnswer(
  host: WorkflowHost,
  prepared: SectionTarget,
  signal: AbortSignal,
  replacing?: string,
): Promise<void> {
  const { chat, model, section, shape, shapeFrom, fit, shown, asked } =
    prepared;
  const { outcome, usage } = await mapPassages(
    {
      sources: host.dependencies.sources,
      model: host.dependencies.model,
      modelRef: model,
      projectFacts: host.dependencies.projectFacts,
      onProgress: (progress) =>
        host.publish({ runProgress: { work: "map", ...progress } }),
    },
    { section, shape, shapeFrom, fit, shown },
    signal,
  );
  if (!outcome) {
    // A fit-only read with no usable note has nothing to keep: said, and
    // no turn written. An old answer it was replacing stays as it was.
    const descriptor = await host.dependencies.model.describeModel(
      model,
      signal,
    );
    host.publish({
      problem: { kind: "map-fit-failed", model: descriptor.label },
    });
    return;
  }
  await host.publishWorkflowPair(
    chat.id,
    asked,
    {
      text: mapHeadline(
        outcome.kind === "passages" ? outcome.shape : null,
        "section",
      ),
      mapped: outcome,
      model,
      usage,
    },
    replacing,
  );
}

/**
 * Finish a `/map` answer in its own place: summarise the Sections
 * it had no summary for that still have none, then map again and replace
 * it. The same click is the "Map again" of an answer the summaries or the
 * Structure have moved past: nothing to summarise, the map alone. Every
 * `/map` refusal comes first, from the answer's own planned scope (a Part is
 * the Part the map read, not whichever is open at the click), and the target
 * is taken again after the summaries, from the chat as it is then.
 */
export async function completeMap(
  host: WorkflowHost,
  runId: string,
): Promise<void> {
  // Which half a failure lands in, as `completeLocate` says it.
  let mapping = false;
  await completeRun(
    host,
    async () => {
      const chat = host.activeChat();
      const answer = chat?.turns.find(
        (turn) => turn.runId === runId && turn.mapped,
      );
      if (!chat || !answer?.mapped) return null;
      // A typed shape is the writer's question, and "Map again" asks it
      // again, never quietly the declared one. Taken from the block, never
      // re-parsed: the button has no text to parse.
      const typed = typedShapeOf(answer.mapped);
      const target = await mapTarget(host, chat, answer.mapped.scope, typed);
      if (!target) return null;
      // A Structure that has moved since the answer gets "Map again", and
      // its transit notice names only what a map sends, so nothing is
      // summarised first, whatever the old answer could not see: the same
      // rule the button read (`mapIsStale`).
      const stale = mapIsStale(answer.mapped, {
        revision: await structureRevision(target.catalog),
        nodeIds: structureNodeIds(target.catalog),
        declared: host.declaredShape(),
        ...(target.kind === "section"
          ? {
              sections: new Map([[target.section.id, target.shown.revision]]),
            }
          : {}),
      });
      return {
        scope: answer.mapped.scope,
        typed,
        chatId: chat.id,
        model: target.model,
        // The same list the button counts (`unsummarised`), narrowed to the
        // map's own scope. A Section map read prose, and has nothing to
        // summarise.
        nodes:
          stale || target.kind === "section"
            ? []
            : toSummarise(
                answer.mapped.coverage,
                target.catalog,
                target.allowed,
                new Set(target.sectionIds),
                summaryBlockLifted(answer.model, target.model),
              ),
      };
    },
    async ({ scope, typed, chatId }, signal, _failed, blocked) => {
      host.publish({ runProgress: undefined });
      // Taken again, not reused: the summaries just written are sources
      // the scope taken before them does not hold, and the writer may have
      // changed the model, or the Part, while they ran.
      const chat = host.snapshot().chats.find((one) => one.id === chatId);
      const again = chat ? await mapTarget(host, chat, scope, typed) : null;
      if (!again) return;
      mapping = true;
      await mapAndAnswer(host, again, signal, runId, blocked);
    },
    ({ chatId }, error) =>
      host.endWorkflowRun(
        chatId,
        error,
        mapping
          ? ["Map stopped.", "The map was interrupted."]
          : ["Summaries stopped.", "The summaries were interrupted."],
      ),
  );
}

/** Every `/map` refusal, in the order a writer can act on them. */
async function mapTarget(
  host: WorkflowHost,
  chat: ChatRecord,
  scope: ReviewScope,
  typed?: MapShapeId,
): Promise<MapTarget | null> {
  // Two layers, as for `/where`: the menu offers `/map` only where its
  // file says, and the run refuses a reader chat whatever a file says,
  // because a map reads every summary in its scope.
  const reader = chat.kind === "alpha-reader" || chat.kind === "beta-reader";
  if (reader || !skillsFor(chat.kind).includes(mapSkill)) return null;
  const catalog = await host.listCatalogue();
  let planned: MapOutcome["scope"];
  switch (scope.kind) {
    case "structure":
      planned = { kind: "structure" };
      break;
    case "part": {
      const open = host.dependencies.defaultNode();
      const part = open ? partFor(catalog, open.id) : null;
      if (!part) {
        // "Or nothing for the whole manuscript" only where a bare `/map`
        // would run: a project with a Part, or a structure declared.
        const bare =
          catalog.some((one) => one.nodeKind === "part") ||
          host.declaredShape() !== null;
        host.publish({
          problem: { kind: bare ? "map-no-part" : "map-no-part-no-parts" },
        });
        return null;
      }
      planned = { kind: "node", nodeId: part };
      break;
    }
    case "node":
      // Resolved against the live listing: a node that was a Section and
      // is a Part now maps as a Part; one that is gone says so.
      if (isPart(catalog, scope.nodeId)) planned = scope;
      else {
        const section = catalog.find(
          (one) => one.nodeId === scope.nodeId && one.nodeKind === "section",
        );
        if (!section) {
          host.publish({ problem: { kind: "review-node-missing" } });
          return null;
        }
        return sectionTarget(host, chat, catalog, section, typed);
      }
      break;
    case "section":
    case "current": {
      // `current` is never parsed for `/map` (its bare scope is the
      // Structure); both read the open Section, and nothing open is
      // named rather than guessed at: an open Part is not a Section.
      const open = host.dependencies.defaultNode();
      const section = open
        ? catalog.find(
            (one) => one.nodeId === open.id && one.nodeKind === "section",
          )
        : undefined;
      if (!section) {
        host.publish({ problem: { kind: "map-no-section" } });
        return null;
      }
      return sectionTarget(host, chat, catalog, section, typed);
    }
    default:
      return scope satisfies never;
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
      problem: { kind: "map-needs-tools", model: descriptor.label },
    });
    return null;
  }
  const boundary = await host.readerBoundary(chat);
  if (!boundary.ok) return null;
  const wide = wideSections(boundary.catalog, boundary.allowed, planned);
  if (wide.sectionIds.length === 0) {
    host.publish({ problem: { kind: "map-nothing-to-read" } });
    return null;
  }
  const plan = planMap(boundary.catalog, planned, typed, host.declaredShape());
  const units = mapUnits(boundary.catalog, wide.sectionIds, plan.mode, planned);
  if (units.length === 0) {
    host.publish({ problem: { kind: "map-no-parts" } });
    return null;
  }
  // One unit is no arc to place: named, with the move that maps it, and
  // never switched to a Section's map, which would read its prose where
  // the writer asked for a map of summaries.
  if (planned.kind === "node" && units.length === 1) {
    host.publish({
      problem: {
        kind: "map-one-unit",
        title: oneLine(units[0].source.title),
        unit: units[0].source.nodeKind === "part" ? "part" : "section",
      },
    });
    return null;
  }
  // The question as the writer would have typed it, from the planned
  // scope: a `part` is written as the Part it resolved to.
  const named =
    planned.kind === "node"
      ? oneLine(
          boundary.catalog.find((one) => one.nodeId === planned.nodeId)
            ?.title ?? "",
        )
      : "";
  // A typed shape is written as its English word, the file's words as
  // every stored question is; both parse in either interface.
  const word = typed ? ` ${MAP_SHAPES[typed].word.en}` : "";
  return {
    kind: "arc",
    chat,
    model,
    planned,
    plan,
    catalog: boundary.catalog,
    allowed: wide.allowed,
    sectionIds: wide.sectionIds,
    asked: `/${mapSkill.command}${named ? ` ${named}` : ""}${word}`,
  };
}

/**
 * A Section map's refusals, in the order a writer can act on them,
 * all before a byte leaves: no model; one that cannot call tools;
 * the reader boundary; nothing of it the chat may read; no prose; too long
 * to read whole (measured by the one room the run reads, never windowed).
 * The Section is read once, here, and that capture is what the run sends.
 */
async function sectionTarget(
  host: WorkflowHost,
  chat: ChatRecord,
  catalog: readonly SourceDescriptor[],
  section: SourceDescriptor,
  typed: MapShapeId | undefined,
): Promise<SectionTarget | null> {
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
      problem: { kind: "map-needs-tools", model: descriptor.label },
    });
    return null;
  }
  const boundary = await host.readerBoundary(chat);
  if (!boundary.ok) return null;
  if (!boundary.allowed.has(section.id)) {
    host.publish({ problem: { kind: "map-nothing-to-read" } });
    return null;
  }
  // "Map its Part" only where that map would run: a Part around the
  // Section with at least two units to place.
  const tooLong = () => {
    const part = section.nodeId ? partFor(catalog, section.nodeId) : null;
    host.publish({
      problem: {
        kind: "map-section-too-long",
        model: descriptor.label,
        offersPart: part !== null && childrenOf(catalog, part).length >= 2,
      },
    });
    return null;
  };
  let shown: SourceText;
  try {
    shown = await host.dependencies.sources.read(section.id);
  } catch (error) {
    // A Section the port will not read at all is past any model's room: the
    // same refusal, never the port's raw word. Anything else is the run's
    // error.
    if (error instanceof Error && error.message === "source-too-large")
      return tooLong();
    throw error;
  }
  if (shown.text.trim().length === 0) {
    host.publish({ problem: { kind: "map-section-empty" } });
    return null;
  }
  const shape = typed ?? host.declaredShape();
  const facts = host.dependencies.projectFacts?.() ?? null;
  if (shown.text.length > mapSectionRoom(descriptor, facts, shape, section))
    return tooLong();
  const word = typed ? ` ${MAP_SHAPES[typed].word.en}` : "";
  return {
    kind: "section",
    chat,
    model,
    section,
    shape,
    shapeFrom: typed ? "typed" : "declared",
    fit: typed === undefined,
    shown,
    catalog: boundary.catalog,
    asked: `/${mapSkill.command} ${oneLine(section.title)}${word}`,
  };
}

/** `/map`, bound to the aggregate. */
export function bind(host: WorkflowHost) {
  return {
    run: withHost(host, runMap),
    complete: withHost(host, completeMap),
  };
}
