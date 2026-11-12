// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { countedWords, partWords } from "../../ai/domain/parts";
import { MAP_SHAPES, beatOf } from "../../ai/domain/structureShapes";
import type { MapNode, MapArc, MapPassages } from "../../ai/domain/types";
import { isPlaced, markOf, stageNumber, type MapMark } from "./mapAnswer";

// ── Map figure geometry ──────────────────────────────────────────────────────
//
// Where each thing sits on a `/map` figure. Pure geometry, as in
// `spineLayout`: numbers in, numbers out, no React and no words. Every
// horizontal position is a percentage of the figure's width, because the
// lines are one SVG stretched to the dock's width and every label and mark is
// HTML placed over it; a stretched viewBox would squash its own text and
// discs. On the straight figures vertical positions are px, since the SVGs
// are drawn at their viewBox height. The Hero's circle is a square that is
// never stretched, and places by % both ways.
//
// Everything is drawn from the stored answer's nodes, as `mapAnswer.ts`
// reads them. Every number that reaches an attribute is finite and clamped,
// because a replayed file can carry any `words` at all.
//
// The published convention is drawn as a quiet line, and the writer's Parts
// (or, on a Hero's Journey, Sections) as degree-of-fit marks on it.
// Proportion is drawn only where the convention defines one: Field's 1:2:1,
// against the writer's own word shares. Kishōtenketsu prescribes none, and
// Freytag's and Campbell's are drawn by position, never by length.

/** A mark on a figure: which node, and its disc. Unplaced nodes have none. */
export interface FigureMark {
  sourceId: string;
  mark: MapMark;
}

/** Marks gathered at one place on a line, left to right in book order. */
export interface MarkGroup {
  /** % of the figure's width. */
  x: number;
  marks: FigureMark[];
}

/** 0–100, and never NaN: the one gate every percentage passes through. */
export function pct(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/**
 * A replayed count as a safe number of words: finite, whole, ≥ 0, and 0 for
 * no count. It is the domain's cleaner (`countedWords`) with the zero a
 * proportion needs. The Three Acts bar does not use it for a missing count,
 * because there unknown is not zero (`partWords`).
 */
export function safeWords(words: number | undefined): number {
  return countedWords(words) ?? 0;
}

/** The node's disc on a figure, or none: an unplaced node is never drawn. */
function figureMark(node: MapNode, mapped: MapArc): FigureMark | null {
  if (!isPlaced(node)) return null;
  const mark = markOf(node, mapped.shape);
  return mark ? { sourceId: node.sourceId, mark } : null;
}

/**
 * The Part a map of one Part is drawn inside, by source id: the figure's
 * root, since a Part is its own mini-arc and its figure stops at it.
 * `null` on the whole Structure.
 */
function rootOf(mapped: MapArc): string | null {
  return mapped.scope.kind === "node" ? `node:${mapped.scope.nodeId}` : null;
}

/**
 * The nodes a figure frames: the whole Structure's top-level nodes (Parts,
 * and Sections outside every Part), or a Part's own children.
 */
function frame(mapped: MapArc): MapNode[] {
  const root = rootOf(mapped);
  return mapped.nodes.filter((node) =>
    root === null ? !node.parentId : node.parentId === root,
  );
}

/**
 * Marks gathered by beat, each beat at its own x, for the station figures. A
 * node with no beat (a beatless `no`) is on no figure: its row says it does
 * no beat's work.
 */
function marksByBeat(
  mapped: MapArc,
  nodes: readonly MapNode[],
  beatX: ReadonlyMap<string, number>,
): MarkGroup[] {
  const groups = new Map<string, FigureMark[]>();
  for (const node of nodes) {
    const beat = beatOf(node);
    const mark = figureMark(node, mapped);
    if (!beat || !mark || !beatX.has(beat)) continue;
    groups.set(beat, [...(groups.get(beat) ?? []), mark]);
  }
  return [...groups].map(([beat, marks]) => ({
    x: beatX.get(beat) as number,
    marks,
  }));
}

// ── Three Acts ───────────────────────────────────────────────────────────────
//
// Field's paradigm over the writer's word shares.

/** The narrowest a Part's field is drawn, in %: a 0-word Part still shows. */
export const MIN_FIELD_SHARE = 2;

export interface ThreeActsField {
  sourceId: string;
  /** % of the figure's width. */
  x: number;
  width: number;
  /**
   * A Section outside every Part: its own segment with no number, and its
   * disc when the map judged it, as a unit of a named map.
   */
  loose: boolean;
}

export interface ThreeActsLabel {
  sourceId: string;
  /**
   * "01": its place among the map's top-level Parts, or on a map of one Part
   * among the Part's children, Sections too, since every child is a unit and
   * none is loose. "" for a Section outside every Part, labelled by its disc
   * alone.
   */
  ordinal: string;
  mark: MapMark | null;
  /** %: the field's left edge, or its place on Field's line by beat. */
  x: number;
}

export interface ThreeActsLayout {
  /**
   * The three acts' names and where each is anchored: the outer two at the
   * figure's edges, the middle one centred. Not centred on their acts, where
   * the middle and last names collide at a 300px dock. The acts'
   * spans are the ticks.
   */
  beats: { id: string; labelAt: number }[];
  /** The line's ticks: its ends and the two plot points. */
  ticks: number[];
  plotPoints: { n: 1 | 2; x: number }[];
  /** The writer's Parts at their real word shares; null with no counts. */
  fields: ThreeActsField[] | null;
  labels: ThreeActsLabel[];
}

/**
 * Field's acts, as spans of the line in %: 1 : 2 : 1. A Map, not an object,
 * so a beat named "constructor" finds nothing here by itself, without relying
 * on the codec having refused it upstream.
 */
const FIELD_ACTS: ReadonlyMap<string, readonly [number, number]> = new Map([
  ["setup", [0, 25]],
  ["confrontation", [25, 75]],
  ["resolution", [75, 100]],
]);

export function threeActsLayout(mapped: MapArc): ThreeActsLayout {
  const root = rootOf(mapped);
  const tops = frame(mapped);
  // On a map of one Part every child is a unit with its own number; on the
  // whole Structure only a Part is, and a Section outside them is loose.
  const numbered = (node: MapNode) => root !== null || node.kind === "part";
  // A top-level node's words are its own plus every node's drawn inside it,
  // since a Part's own count is only its opening text. The sum is the
  // domain's, the one the `/map` prompt prints, so the bar and the
  // model are never told two lengths. A unit with anything uncounted inside
  // it has no total, and then there is no bar: one unit of unknown size makes
  // every share a guess.
  const totals = partWords(
    mapped.nodes.map((node) => ({
      id: node.sourceId,
      ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
      ...(node.words !== undefined ? { words: node.words } : {}),
    })),
  );
  const counted = tops.map((node) => totals.get(node.sourceId));
  const shares = counted.every((one) => one !== undefined)
    ? wordShares(counted as number[])
    : null;
  let at = 0;
  const fields = shares
    ? tops.map((node, index) => {
        const field = {
          sourceId: node.sourceId,
          x: pct(at),
          width: pct(shares[index]),
          loose: !numbered(node),
        };
        at += shares[index];
        return field;
      })
    : null;
  // Every Part is labelled, and a Section outside every Part when the map
  // judged it: on a named map it is a unit with a row and a disc, and the
  // station figures draw that disc.
  const labelled = tops.filter(
    (node) => numbered(node) || figureMark(node, mapped),
  );
  // With no counts there is no bar to stand on: each label sits on Field's
  // line inside its act, several on one act spread across it in book order.
  const onAct = new Map<string, MapNode[]>();
  for (const node of labelled) {
    const beat = beatOf(node);
    if (beat && FIELD_ACTS.has(beat))
      onAct.set(beat, [...(onAct.get(beat) ?? []), node]);
  }
  let unitNumber = 0;
  const labels = labelled.flatMap((node): ThreeActsLabel[] => {
    const mark = figureMark(node, mapped)?.mark ?? null;
    // Counted before any label is skipped: "03" is the third Part whether
    // or not the second is drawn.
    const ordinal = numbered(node)
      ? String((unitNumber += 1)).padStart(2, "0")
      : "";
    if (fields) {
      const field = fields.find((one) => one.sourceId === node.sourceId);
      return field
        ? [{ sourceId: node.sourceId, ordinal, mark, x: field.x }]
        : [];
    }
    const beat = beatOf(node);
    const span = beat ? FIELD_ACTS.get(beat) : undefined;
    if (!beat || !span) return [];
    const siblings = onAct.get(beat) ?? [node];
    const slot = siblings.indexOf(node);
    const x = span[0] + ((span[1] - span[0]) * (slot + 0.5)) / siblings.length;
    return [{ sourceId: node.sourceId, ordinal, mark, x: pct(x) }];
  });
  return {
    beats: MAP_SHAPES.threeact.beats.map((beat, index, all) => ({
      id: beat.id,
      labelAt: index === 0 ? 0 : index === all.length - 1 ? 100 : 50,
    })),
    ticks: [0, 25, 75, 100],
    plotPoints: [
      { n: 1, x: 25 },
      { n: 2, x: 75 },
    ],
    fields,
    labels,
  };
}

/**
 * Each count's share of 100, no field narrower than `MIN_FIELD_SHARE` (or
 * than an equal share, past fifty fields), the rest scaled to fit. `null`
 * when there is nothing to share out: no bar is drawn for a book with no
 * counts, since equal shares would be a proportion the writer never wrote.
 */
export function wordShares(counts: readonly number[]): number[] | null {
  const safe = counts.map(safeWords);
  const total = safe.reduce((sum, one) => sum + one, 0);
  if (total <= 0 || safe.length === 0) return null;
  const floor = Math.min(MIN_FIELD_SHARE, 100 / safe.length);
  let shares = safe.map((one) => (one / total) * 100);
  // Two passes: raising a sliver to the floor shrinks the rest, which can
  // bring one more to it; a third would move nothing a reader could see.
  for (let pass = 0; pass < 2; pass += 1) {
    const small = shares.map((one) => one < floor);
    const fixed = small.filter(Boolean).length * floor;
    const rest = shares.reduce(
      (sum, one, i) => (small[i] ? sum : sum + one),
      0,
    );
    shares = shares.map((one, i) =>
      small[i] ? floor : rest > 0 ? (one / rest) * (100 - fixed) : floor,
    );
  }
  return shares.map(pct);
}

// ── Kishōtenketsu ────────────────────────────────────────────────────────────

export interface StationsLayout {
  stations: { id: string; x: number }[];
  groups: MarkGroup[];
}

/**
 * Four equal stations on one line, whatever the words say: Kishōtenketsu
 * prescribes no proportion, so none is drawn. A Part stands on its beat's
 * station.
 */
export function kishotenketsuLayout(mapped: MapArc): StationsLayout {
  const beats = MAP_SHAPES.kishotenketsu.beats;
  const stations = beats.map((beat, index) => ({
    id: beat.id,
    x: ((index + 0.5) / beats.length) * 100,
  }));
  return {
    stations,
    groups: marksByBeat(
      mapped,
      frame(mapped),
      new Map(stations.map((one) => [one.id, one.x])),
    ),
  };
}

// ── Freytag's pyramid ────────────────────────────────────────────────────────

/** The triangle's height in px, its viewBox height too (never stretched). */
export const FREYTAG_HEIGHT = 56;

export interface FreytagLayout {
  /** The five parts at 0/25/50/75/100; `y` in px from the top. */
  stations: { id: string; x: number; y: number }[];
  /**
   * Freytag's three forces, left to right (MacEwan, 1895, pp. 114-115): the
   * exciting force in the introduction's close, the tragic force after the
   * climax, the force of the last suspense before the catastrophe. Only the
   * first is necessary; the class marks it, and the caption names them.
   */
  forces: {
    kind: "exciting" | "tragic" | "suspense";
    x: number;
    y: number;
    necessary: boolean;
  }[];
  groups: MarkGroup[];
}

/** Where the pyramid's line is at `x`%, in px from the top. */
function freytagY(x: number): number {
  const rise = x <= 50 ? x / 50 : (100 - x) / 50;
  return FREYTAG_HEIGHT * (1 - rise);
}

export function freytagLayout(mapped: MapArc): FreytagLayout {
  const beats = MAP_SHAPES.freytagspyramid.beats;
  const stations = beats.map((beat, index) => {
    const x = (index / (beats.length - 1)) * 100;
    return { id: beat.id, x, y: freytagY(x) };
  });
  const force = (
    kind: FreytagLayout["forces"][number]["kind"],
    x: number,
    necessary: boolean,
  ) => ({ kind, x, y: freytagY(x), necessary });
  return {
    stations,
    forces: [
      force("exciting", 12.5, true),
      force("tragic", 62.5, false),
      force("suspense", 87.5, false),
    ],
    groups: marksByBeat(
      mapped,
      frame(mapped),
      new Map(stations.map((one) => [one.id, one.x])),
    ),
  };
}

// ── The Hero's Journey ───────────────────────────────────────────────────────
//
// Campbell's circle, with Vogler's stages.

/** The circle's square viewBox, never stretched. */
export const HERO_BOX = 240;
export const HERO_RADIUS = 88;
/** Where the stage numbers stand, outside the circle. */
const HERO_NUMBER_RADIUS = 104;
/** Where a stage's Sections stack, inward from the circle. */
const HERO_SLOTS = [74, 60, 46] as const;
/** Where "+n" says there are more than the slots hold. */
const HERO_MORE_RADIUS = 32;

/** % of the box, from a polar point: math angles, y up. */
function heroPoint(degrees: number, radius: number): { x: number; y: number } {
  const angle = (degrees * Math.PI) / 180;
  const centre = HERO_BOX / 2;
  return {
    x: pct(((centre + radius * Math.cos(angle)) / HERO_BOX) * 100),
    y: pct(((centre - radius * Math.sin(angle)) / HERO_BOX) * 100),
  };
}

/**
 * Stage k's angle: Campbell's circle runs counter-clockwise from the top,
 * departure down the left, the ordeal at the bottom, the return up the
 * right. Stage 1 sits just right of the top, 2 at the top, 5 at the
 * threshold's left end, 8 at six o'clock, 11 at its right end.
 */
export function heroAngle(stage: number): number {
  return 60 + (stage - 1) * 30;
}

export interface HeroLayout {
  numbers: { n: number; x: number; y: number }[];
  marks: (FigureMark & { x: number; y: number })[];
  /** Past three Sections on one stage: "+n" inside them. */
  more: { n: number; x: number; y: number }[];
  /** The one arrowhead, on the 1→2 arc, pointing the way the circle runs. */
  arrow: string;
}

export function heroLayout(mapped: MapArc): HeroLayout {
  const stages = MAP_SHAPES.herosjourney.stages ?? [];
  const byStage = new Map<number, FigureMark[]>();
  for (const node of mapped.nodes) {
    const n = node.stage ? stageNumber(node.stage) : null;
    const mark = figureMark(node, mapped);
    // A Section enacting no stage is on no stage: its row says so.
    if (n === null || !mark) continue;
    byStage.set(n, [...(byStage.get(n) ?? []), mark]);
  }
  const marks: HeroLayout["marks"] = [];
  const more: HeroLayout["more"] = [];
  for (const [n, list] of byStage) {
    list.slice(0, HERO_SLOTS.length).forEach((mark, slot) => {
      marks.push({ ...mark, ...heroPoint(heroAngle(n), HERO_SLOTS[slot]) });
    });
    if (list.length > HERO_SLOTS.length)
      more.push({
        n: list.length - HERO_SLOTS.length,
        ...heroPoint(heroAngle(n), HERO_MORE_RADIUS),
      });
  }
  return {
    numbers: stages.map((_, index) => ({
      n: index + 1,
      ...heroPoint(heroAngle(index + 1), HERO_NUMBER_RADIUS),
    })),
    marks,
    more,
    arrow: heroArrow(),
  };
}

/**
 * A small open chevron on the circle between stages 1 and 2, pointing
 * counter-clockwise, the direction the stages run. In the box's own units,
 * since the circle is square and unstretched, so a path is exact here.
 */
function heroArrow(): string {
  const centre = HERO_BOX / 2;
  const at = (heroAngle(1) + heroAngle(2)) / 2;
  const rad = (at * Math.PI) / 180;
  const tip = {
    x: centre + HERO_RADIUS * Math.cos(rad),
    y: centre - HERO_RADIUS * Math.sin(rad),
  };
  // The tangent, counter-clockwise, in screen coordinates (y down).
  const tangent = { x: -Math.sin(rad), y: -Math.cos(rad) };
  const normal = { x: Math.cos(rad), y: -Math.sin(rad) };
  const back = 6;
  const wide = 4;
  const point = (along: number, across: number) =>
    `${round(tip.x - tangent.x * along + normal.x * across)} ${round(
      tip.y - tangent.y * along + normal.y * across,
    )}`;
  return `M${point(back, wide)} L${point(0, 0)} L${point(back, -wide)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Which figure a map draws, if any. */
export function figureOf(
  mapped: MapArc,
): "threeact" | "kishotenketsu" | "freytagspyramid" | "herosjourney" | null {
  // A reading compares nothing. A map on a shape, of the whole Structure or
  // of one Part as its own mini-arc (the same four figures, rooted at the
  // Part), draws it once something is placed.
  if (mapped.shape === null) return null;
  return mapped.nodes.some(
    (node) => isPlaced(node) && markOf(node, mapped.shape) !== null,
  )
    ? mapped.shape
    : null;
}

// ── A Section's ruler ────────────────────────────────────────────────────────

/**
 * How close two starts may fall, as a share of the ruler, before their
 * numbers share one label ("2·3"): about one two-digit label at a 300px
 * dock. Each tick stays at its own start; only the words merge.
 */
export const RULER_CLUSTER = 6;
/** The ruler's height: 34, or 52 on Three Acts, where Field's marks sit. */
export const RULER_HEIGHT = 34;
export const RULER_HEIGHT_FIELD = 52;

export interface RulerLayout {
  /** Each drawn start, in beat order: its number in the legend and its x%. */
  starts: { beat: string; n: number; x: number }[];
  /** The numbers on the line, a cluster's joined, at its first start. */
  labels: { text: string; x: number }[];
  /** Field's 25/75 marks: Three Acts only, a convention and not the book. */
  field: number[];
  height: number;
}

/**
 * The ruler of a Section map: one line from the Section's first
 * character to its last, with a tick and a disc at each verified start and
 * nothing for a beat that has none. No spans, since a beat's end is nobody's
 * claim. Numbered in beat order among the drawn beats, as the caption's
 * legend lists them. A replayed position goes through `pct`, so a hostile
 * one draws at an edge rather than off the figure.
 */
export function rulerLayout(mapped: MapPassages): RulerLayout {
  const starts = mapped.passages.flatMap((one) =>
    one.state === "found" ? [{ beat: one.beat, x: pct(one.at * 100) }] : [],
  );
  const numbered = starts.map((one, index) => ({ ...one, n: index + 1 }));
  // Clusters by position, left to right: the legend's order is the beats',
  // the line's is the prose's, and an out-of-order beat sits where it begins.
  const byX = [...numbered].sort((a, b) => a.x - b.x || a.n - b.n);
  const labels: RulerLayout["labels"] = [];
  let group: typeof byX = [];
  const flush = () => {
    if (group.length > 0)
      labels.push({
        text: group.map((one) => one.n).join("·"),
        x: group[0].x,
      });
    group = [];
  };
  for (const one of byX) {
    if (group.length > 0 && one.x - group[group.length - 1].x >= RULER_CLUSTER)
      flush();
    group.push(one);
  }
  flush();
  const threeact = mapped.shape === "threeact";
  return {
    starts: numbered,
    labels,
    field: threeact ? [25, 75] : [],
    height: threeact ? RULER_HEIGHT_FIELD : RULER_HEIGHT,
  };
}
