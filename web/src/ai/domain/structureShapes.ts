// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { hashOf } from "../../text/hash";
import { isPart, sectionsInPart, topPartOf } from "./parts";
import { normaliseTyped } from "./scope";
import {
  MAP_REASON_MAX,
  MAP_SHAPE_IDS,
  type MapMode,
  type MapNode,
  type MapArc,
  type MapOutcome,
  type MapShapeId,
  type MapSuggestion,
  type ProjectFacts,
  type SourceDescriptor,
} from "./types";

// The declared structures, as `/map` places a book on them. One entry
// per shape the project dialog scaffolds (`project/startingShape`), keyed by
// its stored id. Each beat is the scaffold's own Part, by the suffix of its
// locale key (`create.partRising` → `rising`), so a beat and the Part the
// writer was given for it are one id; `editor/ai` pins that join, because
// this layer may not import the project layer.
//
// Each beat carries one English line on what it does, for the model, drawn
// only from what was checked against the sources: Field's Screenplay (1979)
// for the three acts and their two plot points; Freytag (MacEwan, 1895,
// pp. 114-115) for the five parts and their forces; Vogler's twelve stages
// and his act mapping (1-5, 6-9, 10-12). Kishōtenketsu is described by what
// each movement is, with no claim about conflict. The lines steer a
// judgement; the labels the writer reads are the interface's, never these.
//
// The model is never asked what the app can work out: which beat a Part
// stands in when the Parts line up, or whether a Hero's Journey Section's
// stage fits the Part it sits in.

export interface MapBeat {
  readonly id: string;
  /** For the model: what this beat does, in one line. */
  readonly does: string;
}

export interface MapStage extends MapBeat {
  /** The phase, a beat of the Hero's Journey, the stage belongs to. */
  readonly phase: string;
}

/**
 * The word a writer types after `/map` to ask for this shape: one
 * per interface language, and any other spelling the parser also takes. It
 * lives here, not in a locale file, for the reason `SCOPE_WORDS` gives in
 * `scope.ts`. None begins with the letter of a scope word, so one typed
 * letter tells the two slots apart; none is a beat's name, which a
 * scaffolded Part is titled.
 */
export interface ShapeWord {
  readonly en: string;
  readonly it: string;
  /** Spellings taken but never shown: the app's own, copied off the screen. */
  readonly also?: readonly string[];
}

export interface MapShape {
  readonly word: ShapeWord;
  readonly beats: readonly MapBeat[];
  /** Hero's Journey only: Vogler's twelve stages, in order. */
  readonly stages?: readonly MapStage[];
}

export const MAP_SHAPES: Readonly<Record<MapShapeId, MapShape>> = {
  threeact: {
    word: { en: "three-act", it: "tre-atti" },
    beats: [
      {
        id: "setup",
        does: "establishes the world, the protagonist and the dramatic need, and ends on the first plot point that turns the story in a new direction",
      },
      {
        id: "confrontation",
        does: "the protagonist meets obstacles in pursuit of the need, and it ends on the second plot point that turns the story toward its end",
      },
      {
        id: "resolution",
        does: "resolves the story: the outcome of the conflict and what it leaves",
      },
    ],
  },
  kishotenketsu: {
    word: {
      en: "kishotenketsu",
      it: "kishotenketsu",
      // The app spells it with the macron everywhere, and `normaliseTyped`
      // folds no diacritics: copied off the screen it would be a question.
      also: ["kishōtenketsu"],
    },
    beats: [
      { id: "ki", does: "introduces the characters and their world" },
      { id: "sho", does: "develops what was introduced, without a turn" },
      {
        id: "ten",
        does: "the turn: something unexpected that recasts what came before",
      },
      {
        id: "ketsu",
        does: "the conclusion, which draws the first movements and the turn together",
      },
    ],
  },
  freytagspyramid: {
    word: { en: "freytag", it: "freytag" },
    beats: [
      {
        id: "exposition",
        does: "the introduction: the setting, the people and the situation; the exciting force comes at its end and sets the action going",
      },
      {
        id: "rising",
        does: "the rise: the action grows through complications toward the climax",
      },
      {
        id: "climax",
        does: "the high point, where the action turns; the tragic force that starts the counter-action follows it",
      },
      {
        id: "falling",
        does: "the return or fall: the counter-action gathers, with a force of last suspense before the end",
      },
      {
        id: "denouement",
        does: "the catastrophe, in Freytag's word: the action closes",
      },
    ],
  },
  herosjourney: {
    word: { en: "hero", it: "eroe" },
    beats: [
      {
        id: "departure",
        does: "the hero leaves the ordinary world for the special world",
      },
      {
        id: "initiation",
        does: "the hero is tested in the special world, faces the central ordeal and wins its reward",
      },
      {
        id: "return",
        does: "the hero comes back, changed, to the ordinary world",
      },
    ],
    stages: [
      stage(
        "ordinary-world",
        "departure",
        "the hero's everyday world, before the adventure",
      ),
      stage(
        "call",
        "departure",
        "a problem or a challenge calls the hero away",
      ),
      stage("refusal", "departure", "the hero hesitates or refuses the call"),
      stage("mentor", "departure", "a mentor gives advice, training or a gift"),
      stage(
        "threshold",
        "departure",
        "the hero commits and crosses into the special world",
      ),
      stage(
        "tests",
        "initiation",
        "tests, allies and enemies in the special world",
      ),
      stage(
        "approach",
        "initiation",
        "the hero prepares for, and nears, the central ordeal",
      ),
      stage(
        "ordeal",
        "initiation",
        "the central crisis: a confrontation with death or the greatest fear",
      ),
      stage(
        "reward",
        "initiation",
        "the hero takes the reward of surviving the ordeal",
      ),
      stage("road-back", "return", "the hero turns for home, often pursued"),
      stage(
        "resurrection",
        "return",
        "a last test, in which the hero is transformed",
      ),
      stage(
        "elixir",
        "return",
        "the hero comes home with something that changes their world",
      ),
    ],
  },
};

function stage(id: string, phase: string, does: string): MapStage {
  return { id, phase, does };
}

export function isMapShapeId(value: unknown): value is MapShapeId {
  return (MAP_SHAPE_IDS as readonly unknown[]).includes(value);
}

/** What the fit step may answer: one of the four, or none of them. */
export const FIT_SHAPES = [...MAP_SHAPE_IDS, "none"] as const;

/**
 * A fit suggestion as it is kept: a shape from the enum and a reason
 * that is one line, bounded and not empty. Anything else is none. The step
 * that asks and the chat codec that reads it back share this one check.
 */
export function suggestionOf(value: unknown): MapSuggestion | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { shape?: unknown; reason?: unknown };
  const shape = FIT_SHAPES.find((one) => one === raw.shape);
  if (!shape || typeof raw.reason !== "string") return null;
  const reason = raw.reason.trim();
  if (!reason || reason.length > MAP_REASON_MAX || /[\r\n]/.test(reason))
    return null;
  return { shape, reason };
}

/** The shape a typed word names, in either language, or `null`. */
export function shapeOfWord(word: string): MapShapeId | null {
  const typed = normaliseTyped(word);
  return (
    MAP_SHAPE_IDS.find((id) => {
      const { en, it, also = [] } = MAP_SHAPES[id].word;
      return [en, it, ...also].some((one) => normaliseTyped(one) === typed);
    }) ?? null
  );
}

/** The shape a project declared, when `/map` can draw it; else `null`. */
export function mapShapeOf(
  facts: ProjectFacts | null | undefined,
): MapShapeId | null {
  const id = facts?.structure?.id;
  return isMapShapeId(id) ? id : null;
}

/** A node's beat, whichever of the two facts holds it. */
export function beatOf(node: MapNode): string | undefined {
  return node.standsIn ?? node.beat;
}

/** The top-level nodes of the Structure, in reading order. */
export function topLevel(
  catalog: readonly SourceDescriptor[],
): SourceDescriptor[] {
  return catalog
    .filter(
      (one) =>
        one.kind === "manuscript" &&
        one.nodeId !== undefined &&
        (one.nodeKind === "part" || one.nodeKind === "section") &&
        topPartOf(catalog, one.nodeId) ===
          (one.nodeKind === "part" ? one.nodeId : null),
    )
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER),
    );
}

/**
 * The beat each node stands in, by source id, worked out by the app and
 * never asked: at run time, from `partId` and the declared structure, for
 * editorial workflows only, and never written into a summary.
 *
 * By position, and only when the top-level Parts line up one-to-one with the
 * beats, which is how the scaffold made them. A writer who split
 * Confrontation into two Parts would otherwise have the second half standing
 * in Resolution, so when the counts differ this is `null` and the model
 * names each Part's beat instead. A Section, or a nested Part, stands in its
 * top-level Part's beat; a Section at the top of the Structure stands in
 * none.
 */
export function standsIn(
  catalog: readonly SourceDescriptor[],
  shape: MapShapeId,
): Map<string, string> | null {
  const beats = MAP_SHAPES[shape].beats;
  const parts = topLevel(catalog).filter((one) => one.nodeKind === "part");
  if (parts.length !== beats.length) return null;
  const beatOfPart = new Map(
    parts.map((part, index) => [part.nodeId as string, beats[index].id]),
  );
  const out = new Map<string, string>();
  for (const one of catalog) {
    if (one.kind !== "manuscript" || one.nodeId === undefined) continue;
    const top = topPartOf(catalog, one.nodeId);
    const beat = top === null ? undefined : beatOfPart.get(top);
    if (beat !== undefined) out.set(one.id, beat);
  }
  return out;
}

/**
 * A fingerprint of the Structure a map was drawn from: every Part and
 * Section's id, kind, order, title and Part. Only what moves a node on the
 * drawing changes it: a rename, a reorder, a move. Editing prose or a word
 * count leaves the map's shape standing. When it differs, the map says the
 * Structure has changed since it was drawn.
 */
export async function structureRevision(
  catalog: readonly SourceDescriptor[],
): Promise<string> {
  const nodes = catalog
    .filter((one) => one.kind === "manuscript" && one.nodeKind !== undefined)
    .map((one) => [
      one.id,
      one.nodeKind,
      one.order ?? null,
      one.title,
      one.partId ?? null,
    ]);
  return hashOf(JSON.stringify(nodes));
}

/**
 * The book as it reads now, for a stored map to be compared with: one
 * snapshot, read by the button and the run alike (`mapStale`). What is not
 * known claims nothing either way, so nothing is said until the fingerprint
 * answers.
 */
export interface MapLive {
  /** The Structure's fingerprint (`structureRevision`). */
  revision: string;
  /** The source ids of its Parts and Sections (`structureNodeIds`). */
  nodeIds: ReadonlySet<string>;
  /** The structure the project declares now; `undefined` when not known. */
  declared?: MapShapeId | null;
  /**
   * The live content revision of each Section a Section map covers, by
   * source id, read through `sources.read` (the live buffer or the file).
   * `null` when the read failed, which counts as changed; absent when not
   * known.
   */
  sections?: ReadonlyMap<string, string | null>;
}

/**
 * Whether the book has moved past a map:
 * - every kind: a node the map holds is not a Part or a Section in the live
 *   listing, since a deleted node must say so whatever a hash says;
 * - an arc: the Structure's fingerprint differs;
 * - a Section map: the Section's content differs, never the fingerprint,
 *   because a rename elsewhere changes nothing about its arc and its button
 *   would re-send the whole Section for nothing; a failed read counts as
 *   changed;
 * - a map on the project's own structure: the project now declares another,
 *   since it was a map on the project's structure, not on a remembered one.
 *   A shape the writer typed stands on their word, and a fit-only map has no
 *   shape to go stale.
 * The button that offers "Map again" and the run that click starts read this
 * one rule, so the run never summarises for a book the button said had
 * changed.
 */
export function mapIsStale(mapped: MapOutcome, live: MapLive): boolean {
  if (mapped.nodes.some((node) => !live.nodeIds.has(node.sourceId)))
    return true;
  if (
    mapped.kind !== "fit" &&
    live.declared !== undefined &&
    mapped.shapeFrom === "declared" &&
    mapped.shape !== live.declared
  )
    return true;
  if (mapped.kind === "arc") return live.revision !== mapped.structureRevision;
  const now = live.sections?.get(`node:${mapped.scope.nodeId}`);
  return now === null || (now !== undefined && now !== mapped.sectionRevision);
}

/** The source ids of a listing's Parts and Sections. */
export function structureNodeIds(
  catalog: readonly SourceDescriptor[],
): Set<string> {
  return new Set(
    catalog
      .filter(
        (one) =>
          one.kind === "manuscript" &&
          (one.nodeKind === "part" || one.nodeKind === "section"),
      )
      .map((one) => one.id),
  );
}

/**
 * How one `/map` run reads the book, resolved once from the scope
 * and the words typed and handed to the run, so the refusals and the run
 * cannot disagree about a typed shape.
 */
export interface MapPlan {
  shape: MapShapeId | null;
  shapeFrom: "typed" | "declared";
  mode: MapMode;
  /**
   * The beat each node stands in, by position (`standsIn`), only on a
   * positional plan; on a whole-Structure Hero's Journey, the phase each
   * Part stands in, which a stage's verdict is checked against.
   */
  positions: Map<string, string> | null;
  /**
   * Whether the run asks which shape the scope would fit: on every map with
   * no shape word typed. Never when a word was, because the writer has
   * already said which shape they want.
   */
  fit: boolean;
}

/**
 * The plan for a scope. The shape is the one typed, else the one declared;
 * none is a reading. Positional only on the whole Structure, on the declared
 * shape, when its top-level Parts line up one to one with the beats
 * (`standsIn` says why). Nothing made a Part's children one per beat, and
 * nothing made the Parts line up with a shape the writer typed a moment ago,
 * so a count that happens to match is a coincidence and those are always
 * named. A Hero's Journey is placed by Section; its phase check stands on
 * the same claim.
 */
export function planMap(
  catalog: readonly SourceDescriptor[],
  scope: MapOutcome["scope"],
  typed: MapShapeId | undefined,
  declared: MapShapeId | null,
): MapPlan {
  const shape = typed ?? declared;
  // Whether a word was typed is the question's fact, which "Map again" asks
  // again; storing "whose shape" instead would re-run a typed-out project
  // shape as a map with no word, fit step and all. Whose shape
  // it is, is the header's question, answered against the live declaration
  // (`mapHeader`): the project's own shape typed out still reads "the
  // project's structure", and is positional where the Parts line up with it.
  const shapeFrom = typed ? "typed" : "declared";
  const fit = typed === undefined;
  const claimed =
    scope.kind === "structure" && shape !== null && shape === declared
      ? standsIn(catalog, shape)
      : null;
  if (shape === null)
    return { shape, shapeFrom, fit, mode: "reading", positions: null };
  if (shape === "herosjourney")
    return { shape, shapeFrom, fit, mode: "hero", positions: claimed };
  return claimed
    ? { shape, shapeFrom, fit, mode: "positional", positions: claimed }
    : { shape, shapeFrom, fit, mode: "named", positions: null };
}

/**
 * The shape the writer typed for a map, or `undefined` for one mapped on the
 * declared shape. "Map again" asks with it, so it asks the same question.
 */
export function typedShapeOf(mapped: MapOutcome): MapShapeId | undefined {
  return mapped.kind !== "fit" &&
    mapped.shapeFrom === "typed" &&
    mapped.shape !== null
    ? mapped.shape
    : undefined;
}

/** What the model judges: a Part, read through its Sections, or a Section. */
export interface MapUnit {
  source: SourceDescriptor;
  /** The scope's Sections it is read through, by source id, in order. */
  sectionIds: string[];
}

/**
 * The Parts and Sections directly under `root`, in reading order. `root` is
 * a Part's node id, or `null` for the top of the Structure.
 */
export function childrenOf(
  catalog: readonly SourceDescriptor[],
  root: string | null,
): SourceDescriptor[] {
  if (root === null) return topLevel(catalog);
  return catalog
    .filter(
      (one) =>
        one.kind === "manuscript" &&
        one.nodeId !== undefined &&
        one.partId === root &&
        (one.nodeKind === "part" || one.nodeKind === "section"),
    )
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER),
    );
}

/**
 * What `/map` asks the model about, over the scope's Sections. The root is
 * the Structure, or the Part a `node` scope names; a Part is its own
 * mini-arc, placed the way the Structure is, one level down:
 *
 * - a Hero's Journey: each Section in the scope, at any depth, placed on
 *   a stage.
 * - otherwise the root's children. A child Part is one unit, read through
 *   all of its Sections, so a nested Part folds into it. A child Section
 *   is its own unit, except on the whole Structure when the plan is
 *   positional (the Parts line up with the beats, and a Section outside
 *   them has no beat to stand in, so it would be drawn and judged against
 *   nothing) or a reading (a reading of one bare Section would
 *   repeat its summary). A Part's reading reads what each child does.
 *
 * A child none of whose Sections is in the scope is not a unit: there is
 * nothing of it the chat may read.
 */
export function mapUnits(
  catalog: readonly SourceDescriptor[],
  sectionIds: readonly string[],
  mode: MapMode,
  scope: MapOutcome["scope"],
): MapUnit[] {
  const inScope = new Set(sectionIds);
  const root = scope.kind === "node" ? scope.nodeId : null;
  if (root !== null && !isPart(catalog, root)) return [];
  if (mode === "hero")
    return catalog
      .filter((one) => inScope.has(one.id))
      .map((one) => ({ source: one, sectionIds: [one.id] }));
  const bareSectionsSkipped =
    root === null && (mode === "positional" || mode === "reading");
  return childrenOf(catalog, root).flatMap((child): MapUnit[] => {
    if (child.nodeKind === "part") {
      const ids = sectionsInPart(catalog, child.nodeId as string).filter((id) =>
        inScope.has(id),
      );
      return ids.length > 0 ? [{ source: child, sectionIds: ids }] : [];
    }
    return !bareSectionsSkipped && inScope.has(child.id)
      ? [{ source: child, sectionIds: [child.id] }]
      : [];
  });
}

/**
 * The ids that come later than one before them: the walk every order check
 * shares. `walk` is in one order and `at` measures the other. An arc walks
 * its units in reading order with each one's beat index in the shape; a
 * Section map walks the beats in the shape's order with each start's
 * position in the prose, 0–1. An entry the caller has already
 * ruled out of the order, a `no` or a wrong phase, is not in `walk` at all,
 * or one misplaced node would mark every right one after it.
 */
export function outOfOrderOf(
  walk: readonly { id: string; at: number }[],
): Set<string> {
  const behind = new Set<string>();
  let furthest = -1;
  for (const { id, at } of walk) {
    if (at < furthest) behind.add(id);
    furthest = Math.max(furthest, at);
  }
  return behind;
}

/**
 * The nodes of a stored answer the model was asked about: `mapUnits`, read
 * back from the block's own mode and scope, so the rows, the counts and the
 * figure ask one function what a unit is. Every Section on a Hero's Journey;
 * a Part's children on a map of one Part; otherwise the top-level Parts, and
 * the top-level Sections a named map judged too.
 */
export function mapUnitNodes(mapped: MapArc): MapNode[] {
  const { mode, scope, nodes } = mapped;
  if (mode === "hero") return nodes.filter((node) => node.kind === "section");
  if (scope.kind === "node") {
    const root = `node:${scope.nodeId}`;
    return nodes.filter((node) => node.parentId === root);
  }
  return nodes.filter(
    (node) =>
      node.parentId === undefined && (node.kind === "part" || mode === "named"),
  );
}

/** How much of the book a map covers, as its headline says it. */
export type MapCoverage = "structure" | "part" | "section";

/** A stored map's scope: a Section map is always one Section. */
export function coverageOfMap(mapped: MapOutcome): MapCoverage {
  if (mapped.kind !== "arc") return "section";
  return mapped.scope.kind === "node" ? "part" : "structure";
}

const COVERAGE_WORDS = {
  structure: "the manuscript",
  part: "one Part",
  section: "one Section",
} as const satisfies Record<MapCoverage, string>;

/**
 * "Mapped the manuscript on <shape>", the one spelling of the opening, with
 * "one Part" or "one Section" for a smaller map: a headline shown when a
 * stored Part answer was dropped must not claim the whole book.
 * Never a title: the fallback names nothing a chat file could
 * have put there.
 */
function mappedOn(shape: MapShapeId | null, coverage: MapCoverage): string {
  return `Mapped ${COVERAGE_WORDS[coverage]} on ${shape ?? "no declared structure"}`;
}

/**
 * A `/map` answer's stored text. History never reads it, because it
 * rebuilds `mapHistoryLine` from the block, so the text is only shown, and
 * only when the chat codec has dropped a malformed block and the turn falls
 * back to its text. It therefore names no source id and no verdict: a
 * fallback that printed `node:` addresses would show the writer the app's
 * own plumbing. The shape is its stored id, in English (`threeact`): the
 * file's words, not the interface's, as in every stored answer text; the
 * rows, when the block survives, say it in the writer's language.
 */
export function mapHeadline(
  shape: MapShapeId | null,
  coverage: MapCoverage = "structure",
): string {
  return `${mappedOn(shape, coverage)}.`;
}

/**
 * The line a `/map` answer is in the model's history: ids and verdict
 * words, rebuilt from the checked block every time it is replayed. Never the
 * stored text, and never a reason: a reason is the model's own prose, and a
 * chat file can carry any text at all. Only sources the run still allows are
 * named, as a replayed read is gated.
 */
export function mapHistoryLine(
  mapped: MapOutcome,
  allowed: ReadonlySet<string>,
): string {
  const coverage = coverageOfMap(mapped);
  // A fit-only map says only that it was made: the note never reaches a
  // later model step.
  if (mapped.kind === "fit") return mapHeadline(null, coverage);
  if (mapped.kind === "passages") {
    const section = mapped.nodes[0]?.sourceId;
    // Beat ids and state words, never a start's quote: the quote is the
    // writer's prose, and a chat file can carry any text in it.
    if (!section || !allowed.has(section))
      return mapHeadline(mapped.shape, coverage);
    const said = mapped.passages.map((one) =>
      one.state === "found" && one.outOfOrder
        ? `${one.beat} found, out of order`
        : `${one.beat} ${one.state}`,
    );
    return `${mappedOn(mapped.shape, coverage)}: ${section} (${said.join("; ")}).`;
  }
  const placed = mapped.nodes
    .filter((node) => allowed.has(node.sourceId))
    .flatMap((node) => {
      const said = [
        node.stage
          ? `stage ${node.stage}`
          : beatOf(node)
            ? `beat ${beatOf(node)}`
            : "",
        node.verdict ?? "",
        node.outOfOrder ? "out of order" : "",
      ].filter(Boolean);
      return said.length > 0 ? [`${node.sourceId} (${said.join(", ")})`] : [];
    });
  return placed.length > 0
    ? `${mappedOn(mapped.shape, coverage)}: ${placed.join("; ")}.`
    : mapHeadline(mapped.shape, coverage);
}
