// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { MAP_ANCHORS_MAX } from "../../ai";
import {
  MAP_SHAPES,
  beatOf,
  mapIsStale,
  mapUnitNodes,
  type MapLive,
} from "../../ai/domain/structureShapes";
import {
  MAP_SHAPE_IDS,
  type MapArc,
  type MapNode,
  type MapOutcome,
  type MapPassages,
  type MapShapeId,
} from "../../ai/domain/types";
import { partKeysFor } from "../../project/startingShape";
import { summariseTransit, widenState } from "../components/Widen";
import { offerableRows } from "../../ai/domain/sourceView";

// ── What a map answer says ───────────────────────────────────────────────────
//
// What a `/map` answer says, before anything draws it. Pure: no React
// and no i18n instance; the functions that produce words take `t`. The screen
// (`AiMapAnswer.tsx`) and the plain-text Copy read the same functions, with
// one title resolver, so the two never say different things about one map.
//
// Everything is read from the stored answer, the checked block the codec
// kept, and from the live Structure only to ask "is this still so": a title,
// whether a node still exists, whether the map is stale. Word counts and
// beats are never pulled from the live catalogue for a node the answer did
// not hold, so the answer cannot be made to claim what it never said.

/**
 * The live book the panel read, as one snapshot (`MapLive`): the Structure's
 * fingerprint and node ids, the declared structure, and the live content
 * revision of each Section a Section map covers. Undefined while it is being
 * read, and then nothing about staleness is said in either direction. A
 * caller without the project's facts leaves a field out and does not guess.
 */
export type LiveStructure = MapLive;

/** A degree-of-fit disc; `null` draws no mark. */
export type MapMark = "full" | "partly" | "none";

const MARK_OF_VERDICT = {
  fits: "full",
  partly: "partly",
  no: "none",
} as const satisfies Record<NonNullable<MapNode["verdict"]>, MapMark>;

/**
 * Whether the model placed this node: a verdict, or only its line (for a
 * reading, or a Hero's Journey Section enacting no stage). A node with
 * neither was not asked about (a Section under a judged Part) or was not
 * answered, and the coverage says which; it has no row and no mark.
 */
export function isPlaced(node: MapNode): boolean {
  return node.verdict !== undefined || node.reason !== undefined;
}

/**
 * The mark a placed node carries, from a closed lookup, so a class comes
 * from a validated value and never from file data. A reading carries none,
 * since nothing was compared. A Hero's Journey Section that enacts no stage
 * is the empty ring, as a named `no` is: the model said it does no stage's
 * work.
 */
export function markOf(
  node: MapNode,
  shape: MapShapeId | null,
): MapMark | null {
  if (shape === null) return null;
  if (node.verdict) return MARK_OF_VERDICT[node.verdict];
  return shape === "herosjourney" && node.reason !== undefined ? "none" : null;
}

/** An Issue: a node that does not fully fit where it stands. */
export function isIssue(node: MapNode, shape: MapShapeId | null): boolean {
  const mark = markOf(node, shape);
  return mark === "none" || mark === "partly" || node.outOfOrder === true;
}

export interface MapGroups {
  /**
   * Which kind of node the model judged, for the lede's count: `mixed` on a
   * Part whose children are Parts and Sections.
   */
  units: "part" | "section" | "mixed";
  /** Placed nodes that do not fully fit, `fits` out of order among them. */
  issues: MapNode[];
  /** `fits` and in order. */
  working: MapNode[];
  /**
   * A reading (no structure declared or typed): what each unit does, for
   * the top-level Parts, or on a map of one Part each of its children.
   */
  readings: MapNode[];
  /** How many units the model was asked about, for "placed none of n". */
  asked: number;
}

/**
 * The answer's rows, in book order (the stored order). A reading has only
 * readings; a map has Issues and Already working, and a placed node lands in
 * exactly one of them. A Section under a whole-Structure Part is in neither:
 * it was never judged, only drawn.
 */
export function mapGroups(mapped: MapArc): MapGroups {
  const judged = mapUnitNodes(mapped);
  const placed = mapped.nodes.filter(isPlaced);
  const reading = mapped.shape === null;
  return {
    units: unitsOf(judged),
    issues: reading ? [] : placed.filter((n) => isIssue(n, mapped.shape)),
    working: reading ? [] : placed.filter((n) => !isIssue(n, mapped.shape)),
    readings: reading ? placed : [],
    asked: judged.length,
  };
}

/**
 * What the units were, from the one rule the run used (`mapUnitNodes`, read
 * back from the block's own mode and scope). Do not mirror that rule here.
 */
function unitsOf(judged: readonly MapNode[]): MapGroups["units"] {
  const kinds = new Set(judged.map((node) => node.kind));
  return kinds.size > 1 ? "mixed" : kinds.has("section") ? "section" : "part";
}

/**
 * A beat's label key: the scaffold's own Part key for it (`create.partRising`
 * for `rising`), so the Part the writer was given for a beat and the beat's
 * name on the map are one string. Derived from `partKeysFor`, the join
 * `projectFacts` pins, and `null` for a beat the shape does not have.
 */
export function beatLabelKey(shape: MapShapeId, beat: string): string | null {
  return (
    partKeysFor(shape).find(
      (key) => key.replace("create.part", "").toLowerCase() === beat,
    ) ?? null
  );
}

/** A Vogler stage's label key, or null for one the table does not have. */
export function stageLabelKey(stage: string): string | null {
  return MAP_SHAPES.herosjourney.stages?.some((one) => one.id === stage)
    ? `dock.map.stage.${stage}`
    : null;
}

/** A stage's number on Vogler's circle, 1 to 12, or null. */
export function stageNumber(stage: string): number | null {
  const at =
    MAP_SHAPES.herosjourney.stages?.findIndex((one) => one.id === stage) ?? -1;
  return at < 0 ? null : at + 1;
}

/**
 * The row's key, as the figure labels the node. A Three Acts Part is
 * "01 · Setup": its place among the map's top-level Parts, or on a map of one
 * Part among its children, then its beat; a reading's is the same with no
 * beat. A Hero's Journey Section is "6 · Tests, allies, enemies". A station
 * shape names the beat alone. A beatless `no`, and a Section enacting no
 * stage, have no key. Written in the app's words, never the model's.
 */
export function rowKey(
  node: MapNode,
  mapped: MapArc,
  t: TFunction,
): string | null {
  const { shape } = mapped;
  if (shape === "herosjourney") {
    const key = node.stage ? stageLabelKey(node.stage) : null;
    return key && node.stage ? `${stageNumber(node.stage)} · ${t(key)}` : null;
  }
  const beat = beatOf(node);
  const beatKey = shape && beat ? beatLabelKey(shape, beat) : null;
  const beatWords = beatKey ? t(beatKey) : null;
  const ordinal =
    shape === null || shape === "threeact" ? ordinalOf(node, mapped) : null;
  return [ordinal, beatWords].filter(Boolean).join(" · ") || null;
}

/**
 * "01": the node's place in book order among what the figure numbers: the
 * whole Structure's top-level Parts, or every child of the Part a map of one
 * Part covers, where each child is a unit, Sections too. `null` for a node
 * the figure does not number.
 */
function ordinalOf(node: MapNode, mapped: MapArc): string | null {
  const { scope } = mapped;
  const numbered = mapped.nodes.filter((n) =>
    scope.kind === "node"
      ? n.parentId === `node:${scope.nodeId}`
      : n.kind === "part" && !n.parentId,
  );
  const at = numbered.indexOf(node);
  return at < 0 ? null : String(at + 1).padStart(2, "0");
}

/**
 * A node's title for a person, and whether it is gone. The live title while
 * the node is in the Structure; the title the answer kept, marked, once it is
 * not; never its id. While the Structure is still being read, the kept title
 * and no marker: "gone" is a claim, and nothing has answered yet.
 */
export function nodeTitle(
  node: MapNode,
  titles: ReadonlyMap<string, string>,
  live: LiveStructure | undefined,
): { title: string; gone: boolean } {
  if (!live) return { title: node.title, gone: false };
  return live.nodeIds.has(node.sourceId)
    ? { title: titles.get(node.sourceId) ?? node.title, gone: false }
    : { title: node.title, gone: true };
}

/** The Part a Section is drawn under, within the same answer. */
export function parentOf(node: MapNode, mapped: MapArc): MapNode | undefined {
  return node.parentId
    ? mapped.nodes.find((n) => n.sourceId === node.parentId)
    : undefined;
}

/** The Part or Section a map of one node covers, as the answer holds it. */
function scopeNode(mapped: MapOutcome): MapNode | undefined {
  const { scope } = mapped;
  return scope.kind === "node"
    ? mapped.nodes.find((n) => n.sourceId === `node:${scope.nodeId}`)
    : undefined;
}

export type MapFollowUp =
  | "pending"
  | { kind: "changed"; canMapAgain: boolean }
  | { kind: "summarise"; unmapped: number; missing: number }
  | { kind: "outOfDate" };

/**
 * The one button an answer offers, in precedence order: the book changed (Map
 * again, never the summarise button, which would summarise for a Structure
 * that is gone); Sections still without a summary; the answer predates their
 * summaries; none. Nothing until the live Structure has been read. A Section
 * map read prose, never a summary, so it has only the first.
 *
 * Stale is `mapIsStale`, the rule the run reads too.
 * `canMapAgain: false` means only that the Part or Section a map of one node
 * covers is gone, and Map again would have nothing to map.
 *
 * Running, and no handler, are the caller's: the follow-up is drawn without its
 * button (`Widen` with no `onOpen`), as every follow-up is.
 */
export function mapFollowUp(
  mapped: MapOutcome,
  live: LiveStructure | undefined,
  stillMissing: ((ids: readonly string[]) => readonly string[]) | undefined,
  /** The chat asks another model than the one that answered. */
  lifted = false,
): MapFollowUp | null {
  if (!live) return "pending";
  if (mapIsStale(mapped, live)) {
    const { scope } = mapped;
    return {
      kind: "changed",
      canMapAgain:
        scope.kind !== "node" || live.nodeIds.has(`node:${scope.nodeId}`),
    };
  }
  if (mapped.kind !== "arc") return null;
  // The run's own list: Sections this model could not summarise join it
  // only under another model (`offerableRows`).
  const unmapped = offerableRows(mapped.coverage.skipped, lifted);
  const missing = stillMissing ? stillMissing(unmapped) : unmapped;
  const state = widenState(unmapped, missing);
  if (state === "summarise")
    return {
      kind: "summarise",
      unmapped: unmapped.length,
      missing: missing.length,
    };
  return state === "outOfDate" ? { kind: "outOfDate" } : null;
}

/**
 * The transit line a button shows before its click, for the chat's current
 * remote provider, so the writer sees where the text goes before it leaves.
 * "Map again" sends what a `/map` sends; the summarise button first sends what
 * a summary request sends (the shared lead every summarise button reads),
 * joined to the map's own line, so the map's list lives in one key. A
 * Section map sends the whole Section and says so in its own line, chosen
 * from the stored scope; it has no summarise button.
 */
export function mapTransit(
  action: "summarise" | "again",
  provider: string,
  t: TFunction,
  section = false,
): string {
  if (section) return t("dock.map.remoteTransitSection", { provider });
  const map = t("dock.map.remoteTransit", {
    provider,
    count: MAP_ANCHORS_MAX,
  });
  return action === "summarise" ? summariseTransit(provider, map, t) : map;
}

/** Where the Part's title goes in a header, until it is placed. */
export const TITLE_SLOT = "\u0001";

/**
 * The header line: the map's scope, then the shape it was drawn on and
 * whose it is (the project's, or chosen for this map), on every header,
 * since Copy has no question line above it to say so. A reading has no shape
 * and says only its scope. A Part's title is left as `TITLE_SLOT` in the
 * translated line, so the screen puts it in its own `<bdi>` and Copy puts it
 * in as text: a writer's title is never an interpolated value inside markup.
 */
export function mapHeader(
  mapped: MapOutcome,
  titles: ReadonlyMap<string, string>,
  live: LiveStructure | undefined,
  t: TFunction,
): { text: string; part?: { title: string; gone: boolean } } {
  const part = scopeNode(mapped);
  // A fit-only Section map has no shape: the header names its scope alone.
  const used = mapped.kind === "fit" ? null : mapped;
  const shape = used?.shape ? t(`create.shape.${used.shape}`) : null;
  const source = used && shape ? shapeSource(used, live, shape, t) : null;
  const tail = (lead: string) => (source ? `${lead} · ${source}` : lead);
  if (!part) return { text: tail(t("dock.map.headerStructure")) };
  return {
    text: tail(t("dock.map.headerNode", { title: TITLE_SLOT })),
    part: nodeTitle(part, titles, live),
  };
}

/**
 * Whose structure the header names. The project's while it still declares
 * this one, whether or not the writer typed it out, so "the project's
 * structure" is said only while true. Otherwise "chosen for this map" when a
 * word was typed; a map on a shape the project does not declare names the
 * shape alone, and its Map again button says the rest. With the declaration
 * unknown, the stored fact decides.
 */
function shapeSource(
  mapped: MapArc | MapPassages,
  live: LiveStructure | undefined,
  shape: string,
  t: TFunction,
): string {
  const known = live?.declared;
  const ours =
    known === undefined
      ? mapped.shapeFrom === "declared"
      : mapped.shape === known;
  if (ours) return t("dock.map.shapeDeclared", { shape });
  return mapped.shapeFrom === "typed"
    ? t("dock.map.shapeTyped", { shape })
    : shape;
}

/**
 * The fit note: which shape the model says the scope would fit, and its one
 * line of why. `text` holds `TITLE_SLOT` where the model's name goes (its own
 * `<bdi>` on the screen, as `nonePlaced` places it) and the shape's name from
 * the enum, never the model's words; `reason` is the model's, drawn as its
 * own text node. `mapWith` is the shape "Map with this structure" would map on:
 * `null` for `none`, and for the shape the map already used, which means the
 * declared shape fits and there is nothing to try.
 */
export interface FitNote {
  text: string;
  reason: string;
  mapWith: MapShapeId | null;
}

export function fitNote(mapped: MapOutcome, t: TFunction): FitNote | null {
  const suggestion = mapped.suggestion;
  if (!suggestion) return null;
  const { reason } = suggestion;
  if (suggestion.shape === "none")
    return {
      text: t("dock.map.fit.none", { model: TITLE_SLOT }),
      reason,
      mapWith: null,
    };
  const shape = t(`create.shape.${suggestion.shape}`);
  const used = mapped.kind === "fit" ? null : mapped.shape;
  return suggestion.shape === used
    ? {
        text: t("dock.map.fit.declared", { model: TITLE_SLOT, shape }),
        reason,
        mapWith: null,
      }
    : {
        text: t("dock.map.fit.other", { model: TITLE_SLOT, shape }),
        reason,
        mapWith: suggestion.shape,
      };
}

/**
 * The shape words as a refusal or a note names them, in the interface's
 * language, from the one table the parser reads, never a locale's own
 * spelling (`locales.test.ts` fails on one).
 */
export function shapeWords(language: "en" | "it"): Record<MapShapeId, string> {
  return Object.fromEntries(
    MAP_SHAPE_IDS.map((id) => [id, MAP_SHAPES[id].word[language]]),
  ) as Record<MapShapeId, string>;
}

/**
 * The answer as plain text, for the clipboard: what the answer says, in
 * words, with no drawing, symbols, ids, anchors or revision, and none of the
 * buttons, transit or advice. Titles go through the resolver the screen uses.
 * Each row is its own line, so a direction override in a title or a reason
 * ends with it and no invisible isolates reach the writer's clipboard.
 */
export function mapAsText(
  mapped: MapOutcome,
  titles: ReadonlyMap<string, string>,
  live: LiveStructure | undefined,
  model: string,
  t: TFunction,
): string {
  const lines: string[] = [headerText(mapped, titles, live, t), ""];
  if (mapped.kind === "arc")
    lines.push(...arcLines(mapped, titles, live, model, t));
  if (mapped.kind === "passages") lines.push(...passageLines(mapped, model, t));
  // The fit note is what the answer says, so it is copied; its button is not,
  // nor the advice under a fit-only one.
  const fit = fitNote(mapped, t);
  if (fit) {
    if (mapped.kind !== "fit") lines.push("");
    lines.push(fit.text.replace(TITLE_SLOT, model), `  ${fit.reason}`);
  }
  return lines.join("\n");
}

/** An arc's rows as Copy lists them: the Issues, then what already works. */
function arcLines(
  mapped: MapArc,
  titles: ReadonlyMap<string, string>,
  live: LiveStructure | undefined,
  model: string,
  t: TFunction,
): string[] {
  const lines: string[] = [];
  const groups = mapGroups(mapped);
  const titleText = (node: MapNode) => {
    const { title, gone } = nodeTitle(node, titles, live);
    return gone ? `${title} (${t("dock.map.gone")})` : title;
  };
  const row = (node: MapNode) => {
    const mark = markOf(node, mapped.shape);
    const parent =
      groups.units === "section" && mapped.scope.kind === "structure"
        ? parentOf(node, mapped)
        : undefined;
    const head = [
      mark ? t(`dock.map.verdict.${VERDICT_OF_MARK[mark]}`) : null,
      rowKey(node, mapped, t),
      titleText(node),
      parent ? titleText(parent) : null,
      node.outOfOrder ? t("dock.map.outOfOrder") : null,
    ].filter(Boolean);
    return [
      head.join(" · "),
      ...(node.reason ? [`  ${node.reason}`] : []),
      ...(node.anchor ? [`  “${node.anchor.quote}”`] : []),
    ];
  };
  const placedAny =
    groups.issues.length + groups.working.length + groups.readings.length > 0;
  if (!placedAny) lines.push(nonePlaced(groups, model, t));
  if (groups.readings.length > 0) lines.push(...groups.readings.flatMap(row));
  if (groups.issues.length > 0)
    lines.push(
      issuesLede(groups, t),
      ...groups.issues.flatMap(row),
      ...(groups.working.length > 0 ? [""] : []),
    );
  if (groups.working.length > 0)
    lines.push(
      t("dock.map.alreadyWorking", { count: groups.working.length }),
      ...groups.working.flatMap(row),
    );
  const coverage = consideredLine(mapped, t);
  if (coverage) lines.push("", coverage);
  return lines;
}

/**
 * A Section map's rows as Copy lists them: each found beat (its name, "out
 * of sequence" when it is, its reason and where it begins), then the lines
 * the screen says under them. No position, which is the drawing's.
 */
function passageLines(
  mapped: MapPassages,
  model: string,
  t: TFunction,
): string[] {
  const rows = mapped.passages.flatMap((one) =>
    one.state === "found"
      ? [
          passageHead(mapped.shape, one, t),
          `  ${one.reason}`,
          `  “${one.anchor.quote}”`,
        ]
      : [],
  );
  const { none, missing, unanswered } = sectionLines(mapped, model, t);
  const said = [none, missing, unanswered].filter(
    (line): line is string => line !== null,
  );
  return [
    ...rows,
    ...(said.length > 0 && rows.length > 0 ? [""] : []),
    ...said,
  ];
}

const VERDICT_OF_MARK = {
  full: "fits",
  partly: "partly",
  none: "no",
} as const satisfies Record<MapMark, NonNullable<MapNode["verdict"]>>;

function headerText(
  mapped: MapOutcome,
  titles: ReadonlyMap<string, string>,
  live: LiveStructure | undefined,
  t: TFunction,
): string {
  const { text, part } = mapHeader(mapped, titles, live, t);
  return part
    ? text.replace(
        TITLE_SLOT,
        part.gone ? `${part.title} (${t("dock.map.gone")})` : part.title,
      )
    : text;
}

/** The lede keys by what the units were, including a Part's mixed children. */
const UNIT_KEYS = {
  part: "Parts",
  section: "Sections",
  mixed: "Units",
} as const satisfies Record<MapGroups["units"], string>;

/** The fixed sentence over the Issues (never model-written). */
export function issuesLede(groups: MapGroups, t: TFunction): string {
  return t(`dock.map.issues${UNIT_KEYS[groups.units]}`, {
    count: groups.issues.length,
  });
}

/** "qwen3:8b placed none of the 4 Parts." */
export function nonePlaced(
  groups: MapGroups,
  model: string,
  t: TFunction,
): string {
  return t(`dock.map.nonePlaced${UNIT_KEYS[groups.units]}`, {
    count: groups.asked,
    model,
  });
}

/**
 * "Sections considered: 5 of 7.", only when the map could not consider
 * every Section it meant to; a complete map needs no receipt here.
 */
export function consideredLine(mapped: MapArc, t: TFunction): string | null {
  const { coverage } = mapped;
  return coverage.skipped.length > 0
    ? t("dock.map.considered", {
        count: coverage.inspected,
        total: coverage.intended,
      })
    : null;
}

// ── A Section's beats ────────────────────────────────────────────────────────

/** A beat's name, as the scaffold names its Part; the id if it has none. */
export function beatName(
  shape: MapShapeId,
  beat: string,
  t: TFunction,
): string {
  const key = beatLabelKey(shape, beat);
  return key ? t(key) : beat;
}

/** A found beat's head: its name, then "out of sequence" when it is. */
export function passageHead(
  shape: MapShapeId,
  passage: MapPassages["passages"][number],
  t: TFunction,
): string {
  return [
    beatName(shape, passage.beat, t),
    passage.state === "found" && passage.outOfOrder
      ? t("dock.map.outOfOrder")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What a Section map says under its rows: with nothing found and
 * nothing missing, only that the model placed none; otherwise the beats not
 * in the Section, then, on the coverage line and never as "not in", the
 * beats it never placed. Names are joined by a plain comma in beat order,
 * after a colon, so no "and" is joined in code; `count` serves the Italian
 * verb. `model` is `TITLE_SLOT` on the screen, a name in Copy.
 */
export interface SectionLines {
  /** Nothing found and nothing missing: "placed none of the n beats". */
  none: string | null;
  /** The beats the model said are not in the Section. */
  missing: string | null;
  /** The beats it never placed: the coverage line. */
  unanswered: string | null;
}

export function sectionLines(
  mapped: MapPassages,
  model: string,
  t: TFunction,
): SectionLines {
  const names = (state: "found" | "missing" | "unanswered") =>
    mapped.passages
      .filter((one) => one.state === state)
      .map((one) => beatName(mapped.shape, one.beat, t));
  const found = names("found");
  const missing = names("missing");
  const unanswered = names("unanswered");
  if (found.length === 0 && missing.length === 0)
    return {
      none: t("dock.map.nonePlacedBeats", {
        count: mapped.passages.length,
        model,
      }),
      missing: null,
      unanswered: null,
    };
  return {
    none: null,
    missing:
      missing.length > 0
        ? t("dock.map.missingBeats", {
            count: missing.length,
            beats: missing.join(", "),
          })
        : null,
    unanswered:
      unanswered.length > 0
        ? t("dock.map.unansweredBeats", {
            count: unanswered.length,
            beats: unanswered.join(", "),
            model,
          })
        : null,
  };
}
