// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { DocumentStats, NodeStat } from "../project/types";
import type { DocNode, DocumentStructure } from "../project/types";
import { walk } from "../project/structure";

// ── Spine geometry ───────────────────────────────────────────────────────────
//
// The spine draws a project's shape: one group per Part, one bar per Section,
// width by word count and opacity by how recently it was touched. The
// geometry is kept apart from the SVG that renders it, because arithmetic is
// tested in Node. The failure it guards against is the one nobody notices: a
// Section of two hundred words rendering at nought pixels and vanishing from
// a writer's own project.

/** Width of the drawing space. The SVG stretches this; heights never scale. */
export const SPINE_WIDTH = 1000;

/**
 * A bar so thin it would disappear must still be visible; a Section the
 * writer has opened and typed one line into is the case that matters. This is
 * the full-scale value: when even the minimums cannot fit the field,
 * `layoutSpineGoal` scales it, and both gaps, by one `fit` factor rather than
 * clipping.
 */
const MIN_BAR = 2;

/**
 * The narrowest a filled spine may be drawn, as a fraction of the space it is
 * given. The same reasoning as `MIN_BAR` one level up: a project reduced to a
 * speck reads as a rendering fault rather than a short project. It floors the
 * shelf's card width against the longest project (`spineFill`); the goal
 * drawing's floor is the drawing-unit allocation in `layoutSpineGoal`, which
 * keeps every Part's field and bars legible.
 */
const MIN_FILL = 0.08;

/**
 * How much of its width a project's spine takes, measured against the longest
 * project on the same shelf.
 *
 * Within one project the proportions matter and the absolute size does not,
 * so a layout spends the full drawing width. Across a shelf that is wrong: a
 * two-word sketch and a finished novel would draw as the same bar, and the
 * most prominent mark on every card would carry no information.
 *
 * Square-rooted rather than linear. A 500-word note beside a 120,000-word
 * novel is 0.4% of it, and four pixels of bar says "broken", not "short"; the
 * root keeps the small end legible while still ordering the shelf by size.
 */
export function spineFill(words: number, max: number): number {
  // With no shelf to compare against, a lone spine draws at its full width,
  // as the landing page's example and the first-run glyph want.
  if (max <= 0) return 1;
  return Math.max(MIN_FILL, Math.min(1, Math.sqrt(words / max)));
}

export interface SpineSection {
  /** The node's id: stable across renames, unlike a file name. */
  nodeId: string;
  title: string;
  words: number;
  /** 0 at the oldest touched, 1 at the most recent. */
  recency: number;
  /** Words added (+) or cut (−) in the last real session, or null. */
  delta: number | null;
}

export interface SpinePart {
  nodeId: string;
  title: string;
  sections: SpineSection[];
  words: number;
  /**
   * The Part file's own text (`part--act-one.md`) plus the own text of any
   * Part nested inside it, which folds in so the totals match the real word
   * count. Not a bar of its own in `layoutSpine`; the goal layout draws it as
   * a leading dim slice.
   */
  ownWords: number;
  /** The Part file's own last-session delta, which colours the border. */
  ownDelta: number | null;
}

export interface SpineBar {
  nodeId: string;
  title: string;
  words: number;
  x: number;
  width: number;
  /** 0.30 to 1. Recency, not length: width already carries length. */
  opacity: number;
}

export interface SpinePartLayout {
  nodeId: string;
  title: string;
  /** The Part's number, as the panel and the rail print it: 1, 2. */
  label: string;
  words: number;
  x: number;
  width: number;
  bars: SpineBar[];
}

export interface SpineLayout {
  parts: SpinePartLayout[];
  bars: SpineBar[];
  totalWords: number;
  partCount: number;
  sectionCount: number;
}

export interface SpineScale {
  /** Bar height in px. Everything else follows from it. */
  height: number;
  gapPart: number;
  gapSection: number;
  radius: number;
}

/** The three sizes the design uses: a card badge, a panel, and the hero. */
export function scaleFor(height: number): SpineScale {
  const small = height <= 10;
  return {
    height,
    gapPart: small ? 3 : 7,
    gapSection: small ? 1 : 2,
    radius: small ? 1.5 : 2.5,
  };
}

/**
 * Turn a project's structure and stats into the groups the spine draws.
 *
 * Only Parts at the top level become groups. A Section directly at the root,
 * which is legal and what a short document looks like, is gathered into one
 * unnamed group so it is drawn rather than dropped.
 *
 * Parts have their own text, and it counts toward the project. `layoutSpine`
 * does not draw it, because a Part is the group and a bar inside itself would
 * double it visually. The goal layout does: the Part's own words become a
 * leading dim slice, because there they decide how much width the Part is
 * owed against the goal.
 */
export function spineParts(
  structure: DocumentStructure,
  stats: DocumentStats,
): SpinePart[] {
  const byId = new Map<string, NodeStat>();
  for (const entry of stats.perNode) byId.set(entry.nodeId, entry);

  const recencyOf = recencyScale(stats.perNode);

  // Word counts come from the writer's own files, and a hand-edited yaml can
  // carry `1e400`, which parses to Infinity and turns every width it touches
  // into NaN. The clamp is the one funnel both layouts read from.
  const wordsOf = (stat: NodeStat | undefined): number => {
    const w = stat?.words;
    return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 0;
  };
  const deltaOf = (stat: NodeStat | undefined): number | null => {
    const d = stat?.lastDelta;
    return typeof d === "number" && Number.isFinite(d) ? d : null;
  };
  // A Part's own text is its file's words plus every nested Part's file's
  // words. `walk` visits the node itself first, so the sum starts at the
  // Part's own stat and adds the nested ones on the way down. Counting
  // Sections only would drop a nested Part's prose from the spine's totals
  // while it still counts in the project's.
  const ownUnder = (node: DocNode): number => {
    let own = 0;
    walk([node], (child) => {
      if (child.kind === "part") own += wordsOf(byId.get(child.id));
    });
    return own;
  };

  const ownDeltaUnder = (node: DocNode): number | null => {
    let sum = 0;
    let has = false;
    walk([node], (child) => {
      if (child.kind === "part") {
        const d = deltaOf(byId.get(child.id));
        if (d !== null) {
          sum += d;
          has = true;
        }
      }
    });
    return has ? sum : null;
  };

  const sectionsUnder = (node: DocNode): SpineSection[] => {
    const out: SpineSection[] = [];
    walk([node], (child) => {
      if (child.kind !== "section") return;
      const stat = byId.get(child.id);
      out.push({
        nodeId: child.id,
        title: child.title,
        words: wordsOf(stat),
        recency: recencyOf(stat?.updatedAt),
        delta: deltaOf(stat),
      });
    });
    return out;
  };

  const parts: SpinePart[] = [];
  const loose: SpineSection[] = [];

  for (const node of structure.children) {
    if (node.kind === "section") {
      const stat = byId.get(node.id);
      loose.push({
        nodeId: node.id,
        title: node.title,
        words: wordsOf(stat),
        recency: recencyOf(stat?.updatedAt),
        delta: deltaOf(stat),
      });
      continue;
    }
    const sections = sectionsUnder(node);
    parts.push({
      nodeId: node.id,
      title: node.title,
      sections,
      words: sections.reduce((t, s) => t + s.words, 0),
      ownWords: ownUnder(node),
      ownDelta: ownDeltaUnder(node),
    });
  }

  if (loose.length > 0) {
    parts.unshift({
      nodeId: "",
      title: "",
      sections: loose,
      words: loose.reduce((t, s) => t + s.words, 0),
      ownWords: 0,
      ownDelta: null,
    });
  }

  return parts;
}

/**
 * Where each bar sits, given the parts and a scale.
 *
 * Widths are proportional to word count, after the gaps are taken out of the
 * budget; otherwise a project with many Sections would overflow, each gap
 * added to a width that had already spent the full 1000.
 *
 * A project with no words yet divides the space evenly: proportional-to-zero
 * has no answer, and an empty shelf entry should still show its shape.
 */
export function layoutSpine(
  parts: readonly SpinePart[],
  scale: SpineScale,
): SpineLayout {
  const drawn = parts.filter((p) => p.sections.length > 0);
  const sectionCount = drawn.reduce((t, p) => t + p.sections.length, 0);
  const partCount = parts.length;

  const totalWords = parts.reduce((t, p) => t + p.words + p.ownWords, 0);

  if (sectionCount === 0) {
    return { parts: [], bars: [], totalWords, partCount, sectionCount: 0 };
  }

  const gaps =
    Math.max(0, drawn.length - 1) * scale.gapPart +
    drawn.reduce(
      (t, p) => t + Math.max(0, p.sections.length - 1) * scale.gapSection,
      0,
    );

  const usable = Math.max(sectionCount * MIN_BAR, SPINE_WIDTH - gaps);

  const laid: SpinePartLayout[] = [];
  const bars: SpineBar[] = [];
  let x = 0;

  drawn.forEach((part, partIndex) => {
    const start = x;
    const partBars: SpineBar[] = [];

    part.sections.forEach((section, sectionIndex) => {
      const share =
        totalWords > 0 ? section.words / totalWords : 1 / sectionCount;
      const width = Math.max(MIN_BAR, share * usable);
      const bar: SpineBar = {
        nodeId: section.nodeId,
        title: section.title,
        words: section.words,
        x,
        width,
        opacity: recencyOpacity(section.recency),
      };
      partBars.push(bar);
      bars.push(bar);
      x += width;
      if (sectionIndex < part.sections.length - 1) x += scale.gapSection;
    });

    laid.push({
      nodeId: part.nodeId,
      title: part.title,
      label: String(partIndex + 1).padStart(2, "0"),
      words: part.words,
      x: start,
      width: x - start,
      bars: partBars,
    });

    if (partIndex < drawn.length - 1) x += scale.gapPart;
  });

  return { parts: laid, bars, totalWords, partCount, sectionCount };
}

// ── The goal-anchored spine ──────────────────────────────────────────────────
//
// The Desk, the panel and the shelf cards draw the project against the
// writer's goal, not against itself. The bar is the goal: every Part is an
// equal share of it, its Sections live inside it at their true size, and
// whatever capacity the Sections have not consumed stays visible as the
// Part's empty region. The shelf also compares projects with each other
// (`spineFill`), which is a different question. `layoutSpine` has no
// production consumer; only its own suite uses it.

/** One bar of the goal layout: a Section, or the Part file's own slice. */
export interface GoalSpineBar {
  nodeId: string;
  title: string;
  words: number;
  x: number;
  width: number;
  /** `own` is the Part file's own text; `section` is a real Section. */
  kind: "own" | "section";
  /** True when the bar has no words; drawn hollow. */
  empty: boolean;
  /** Words added (+) or cut (−) in the last real session, or null. */
  delta: number | null;
}

export interface GoalSpinePart {
  nodeId: string;
  title: string;
  /** The Part's number, as the panel and the rail print it: 1, 2. */
  label: string;
  /** Section words only. */
  words: number;
  /** The Part file's own words, including any Part nested inside it. */
  ownWords: number;
  /** `words + ownWords`, the Part's content. */
  totalWords: number;
  /** `capacity − totalWords` in real words, what the empty region says. */
  unusedWords: number;
  x: number;
  width: number;
  /** True when the Part holds no words at all; drawn hollow. */
  empty: boolean;
  /** The Part file's own last-session delta, which colours the border. */
  delta: number | null;
  /**
   * The width of the Part's unused capacity in drawing units: the hatched
   * region trailing the Sections. 0 in the no-goal drawing, where the
   * Sections fill the Part.
   */
  emptyWidth: number;
  bars: GoalSpineBar[];
}

export interface GoalSpineLayout {
  parts: GoalSpinePart[];
  bars: GoalSpineBar[];
  totalWords: number;
  partCount: number;
  sectionCount: number;
}

/**
 * The ledger's one overrun fact: how far past the goal a word count has run,
 * as a whole percent; `null` at or under the goal, or with none set. The
 * Desk's badge and the drawing's fill decisions both speak from this one
 * formula, so the two cannot drift.
 */
export function overrunPercent(
  words: number,
  goal: number | null,
): number | null {
  if (!goal || goal <= 0 || words <= goal) return null;
  return Math.round(((words - goal) / goal) * 100);
}

/**
 * The allocation in words: a closed-form water-fill.
 *
 * Every Part starts with `goal / n` words of capacity. A Part whose content
 * outgrows its share borrows from the unused capacity of its neighbours,
 * each donor giving in proportion to what it has left; the loop settles
 * every deficit, and content past the goal lets the total exceed it, so the
 * drawing compresses and the ledger's badge reports the overrun.
 */
function waterFillCapacities(words: readonly number[], goal: number): number[] {
  const n = words.length;
  const capacity = words.map(() => goal / n);

  const MAX_ITERATIONS = 100;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const needy = words
      .map((_, i) => i)
      .filter((i) => words[i] > capacity[i] + 1e-9);
    if (needy.length === 0) break;

    const donors = words
      .map((_, i) => i)
      .filter((i) => capacity[i] > words[i] + 1e-9);

    const totalUnused = donors.reduce(
      (sum, i) => sum + capacity[i] - words[i],
      0,
    );
    const totalDeficit = needy.reduce(
      (sum, i) => sum + words[i] - capacity[i],
      0,
    );

    // No unused capacity anywhere: the goal is consumed, the needy Parts
    // keep what they hold and the total passes the goal.
    if (totalUnused <= 1e-9) {
      needy.forEach((i) => {
        capacity[i] = words[i];
      });
      break;
    }

    const transfer = Math.min(totalUnused, totalDeficit);
    donors.forEach((i) => {
      const unused = capacity[i] - words[i];
      capacity[i] -= transfer * (unused / totalUnused);
    });
    needy.forEach((i) => {
      const deficit = words[i] - capacity[i];
      capacity[i] += transfer * (deficit / totalDeficit);
    });
  }

  // Content beyond the goal: no Part may hold less than its content.
  const totalContent = words.reduce((sum, w) => sum + w, 0);
  if (totalContent > goal) {
    for (let i = 0; i < n; i++) {
      if (capacity[i] < words[i]) capacity[i] = words[i];
    }
  }

  return capacity;
}

/**
 * The bars a Part draws, in draw order: the Part file's own text first (the
 * leading dim slice, only when it has any), then each Section. The goal
 * drawing's one answer to which bars a Part has: the width allocation counts
 * them for the Part's floor, and the per-Part loop shares its budget among
 * them.
 */
function partWeights(part: SpinePart): number[] {
  const weights: number[] = [];
  if (part.ownWords > 0) weights.push(part.ownWords);
  for (const section of part.sections) weights.push(section.words);
  return weights;
}

/**
 * Where each Part and Section sits, measured against the goal.
 *
 * The bar is the goal. Every Part starts at an equal share; a Part whose
 * content outgrows it borrows width from the neighbours' unused capacity
 * (`waterFillCapacities`), so the Parts sum to the goal's width until the
 * content passes it. A Section does not fill its Part: it is drawn at
 * `words / capacity` of the Part's content area, purely proportional with no
 * minimum-width reservation shifting the others, and the capacity it has not
 * consumed stays visible as the hatched empty region trailing it.
 *
 * The gaps come out of the width before the bars share it, so a Part's bars,
 * gaps and empty region sum to its width exactly and the border always
 * contains the Sections. An empty Section keeps `MIN_BAR` only while the
 * hatch can hold it, and collapses to nothing in a full Part. A collapsed
 * Section takes no gap either: it is not in the drawing, so the visible bars
 * reclaim the room and end on the border.
 *
 * Only the gaps between Parts leave the drawing's budget, since the Section
 * gaps live inside each Part, so the Parts' fields plus the Part gaps span
 * the full drawing width in every regime: at the capacity shares when the
 * minimums fit, and after the one `fit` scale-down when they do not.
 *
 * Width is allocated in two stages. The capacity share is the ideal, purely
 * proportional, with no `MIN_BAR` clamp. A Part whose share cannot hold its
 * own bars and gaps at `MIN_BAR` takes its floor instead, and the Parts with
 * slack pay the difference in proportion to that slack. When even the floors
 * cannot fit the field (a few hundred Sections' gaps alone can pass it), one
 * `fit` factor scales `MIN_BAR` and both gaps so the minimums fit by
 * construction; the drawing is never clipped. A normal book,
 * with no floor active and the pitch within the field, is untouched: `fit` is
 * 1 and every width is the capacity share.
 *
 * With no goal the capacity is the content and the empty region never
 * appears: the full-width drawing, with the content-area correction applied.
 */
export function layoutSpineGoal(
  parts: readonly SpinePart[],
  scale: SpineScale,
  goal: number | null,
): GoalSpineLayout {
  const partCount = parts.length;
  const sectionCount = parts.reduce((t, p) => t + p.sections.length, 0);
  // A Part's content in words: its Sections plus the Part file's own text
  // (nested Parts' own words fold in through `spineParts`). Derived once, so
  // the empty guard and the allocation below read the same list.
  const contentWords = parts.map((p) => p.words + p.ownWords);
  const totalWords = contentWords.reduce((t, w) => t + w, 0);

  if (partCount === 0) {
    return {
      parts: [],
      bars: [],
      totalWords,
      partCount,
      sectionCount,
    };
  }

  const hasGoal = goal !== null && Number.isFinite(goal) && goal > 0;

  // Only the Part gaps leave the budget; the Section gaps come out of each
  // Part's own field below.
  const partGaps = Math.max(0, partCount - 1) * scale.gapPart;

  // ── Word allocation ────────────────────────────────────────────────────────
  //
  // Equal shares of the goal, borrowed from the neighbours on demand; over
  // the goal the widths compress to the drawing (`squeeze`).
  const capacity = hasGoal
    ? waterFillCapacities(contentWords, goal)
    : [...contentWords];
  const totalCapacity = capacity.reduce((t, c) => t + c, 0);
  const squeeze = hasGoal && totalCapacity > goal ? goal / totalCapacity : 1;

  // ── Drawing-unit allocation ────────────────────────────────────────────────
  //
  // A Part's minimum is its bars at `MIN_BAR` plus one gap between each pair;
  // a Part with no bars still counts one unit, so its field stays visible.
  // `pitch` is the whole drawing's skeleton, and `fit` scales the minimums
  // to the field when it does not hold them.
  const weightsByPart = parts.map(partWeights);
  const minimums = weightsByPart.map(
    (w) =>
      Math.max(1, w.length) * MIN_BAR +
      Math.max(0, w.length - 1) * scale.gapSection,
  );
  const pitch = partGaps + minimums.reduce((t, m) => t + m, 0);
  const fit = Math.min(1, SPINE_WIDTH / pitch);
  const minBar = MIN_BAR * fit;
  const gapSection = scale.gapSection * fit;
  const gapPart = scale.gapPart * fit;
  const available = Math.max(0, SPINE_WIDTH - partGaps * fit);

  const ideal = hasGoal
    ? capacity.map((cap) => (available * cap * squeeze) / goal)
    : totalWords > 0
      ? contentWords.map((w) => (available * w) / totalWords)
      : contentWords.map(() => available / partCount);

  const floors = minimums.map((m) => m * fit);
  const widths = ideal.map((w, i) => Math.max(w, floors[i]));
  const overflow = widths.reduce((t, w) => t + w, 0) - available;
  if (overflow > 0) {
    const slack = widths.map((w, i) => w - floors[i]);
    const totalSlack = slack.reduce((t, s) => t + s, 0);
    // `totalSlack > 0` is the NaN guard; the `min` is float hygiene (the
    // floors fit by construction, so the overflow never exceeds the slack).
    if (totalSlack > 0) {
      const giveBack = Math.min(overflow, totalSlack);
      widths.forEach((w, i) => {
        widths[i] = Math.max(floors[i], w - (giveBack * slack[i]) / totalSlack);
      });
    }
  }

  // ── Per-Part content ───────────────────────────────────────────────────────
  //
  // `widths[i]` is the Part's field, already fitted and floored; `minBar`
  // and the two gaps are the effective scale every read below uses.
  const laid: GoalSpinePart[] = [];
  const bars: GoalSpineBar[] = [];
  let x = 0;

  parts.forEach((part, partIndex) => {
    const start = x;
    const words = contentWords[partIndex];
    const cap = capacity[partIndex];
    const width = widths[partIndex];

    let weights = weightsByPart[partIndex];
    let innerGaps = Math.max(0, weights.length - 1) * gapSection;
    const minima = weights.length * minBar;

    // The gaps leave the width before the bars share it, so a full Part's
    // last bar ends on the border.
    let contentArea = Math.max(0, width - innerGaps);

    // The used budget is content relative to capacity: Sections do not fill
    // the Part (`words / capacity`). Without a goal, capacity equals content,
    // so the budget is the whole content area and the empty region never
    // appears.
    let usedBudget =
      hasGoal && cap > 0 ? contentArea * Math.min(1, words / cap) : contentArea;
    let positive = weights.reduce((t, w) => t + w, 0);

    // Empty bars take only from the hatch, never from the positive bars'
    // budget, and keep the minimum only while the hatch can hold all of them
    // at it: a partial slot would render sub-pixel marks beside orphaned
    // gaps.
    const emptyCount = weights.filter((w) => w === 0).length;
    const hatch = Math.max(0, contentArea - usedBudget);
    const collapsed = hasGoal && emptyCount > 0 && hatch < emptyCount * minBar;
    const emptySlot = hasGoal && emptyCount > 0 && !collapsed ? minBar : 0;

    // Re-budget without the collapsed empties before the shares are
    // computed, so the one share formula below sees the final weights: the
    // visible bars widen into the reclaimed room (still `words / capacity` of
    // the wider content area) and end on the border. Collapse is decided
    // first because it reads the hatch, which the pre-collapse content area
    // yields.
    if (collapsed) {
      weights = weights.filter((w) => w > 0);
      innerGaps = Math.max(0, weights.length - 1) * gapSection;
      contentArea = Math.max(0, width - innerGaps);
      usedBudget =
        hasGoal && cap > 0
          ? contentArea * Math.min(1, words / cap)
          : contentArea;
      positive = weights.reduce((t, w) => t + w, 0);
      // `emptySlot` is 0 here, and the collapsed Sections are skipped below,
      // so none reaches `pushBar`'s empty branch.
    }

    // The goal drawing shares purely by words; the no-goal drawing shares
    // minima first, and collapse never applies to it.
    const share =
      positive > 0
        ? (hasGoal ? usedBudget : Math.max(0, usedBudget - minima)) / positive
        : 0;

    const partBars: GoalSpineBar[] = [];
    let innerX = x;
    const pushBar = (
      nodeId: string,
      title: string,
      w: number,
      kind: "own" | "section",
      delta: number | null,
    ) => {
      // Only the no-goal drawing, where the Sections are the drawing, splits
      // the Part evenly among them when nothing is written.
      const bw =
        w > 0
          ? hasGoal
            ? w * share
            : minBar + w * share
          : hasGoal
            ? emptySlot
            : positive > 0
              ? minBar
              : usedBudget / weights.length;
      partBars.push({
        nodeId,
        title,
        words: w,
        x: innerX,
        width: bw,
        kind,
        empty: w === 0,
        delta,
      });
      innerX += bw + gapSection;
    };

    if (part.ownWords > 0) {
      pushBar(part.nodeId, part.title, part.ownWords, "own", part.ownDelta);
    }
    part.sections.forEach((section) => {
      if (collapsed && section.words === 0) return;
      pushBar(
        section.nodeId,
        section.title,
        section.words,
        "section",
        section.delta,
      );
    });

    const barsSum = partBars.reduce((t, b) => t + b.width, 0);
    // The unused capacity trailing the bars: the hatched region. Only the
    // goal drawing has one; without a goal the Sections fill the Part.
    const emptyWidth = hasGoal ? Math.max(0, width - innerGaps - barsSum) : 0;

    laid.push({
      nodeId: part.nodeId,
      title: part.title,
      label: String(partIndex + 1).padStart(2, "0"),
      words: part.words,
      ownWords: part.ownWords,
      totalWords: words,
      unusedWords: Math.max(0, cap - words),
      x: start,
      width,
      empty: words === 0,
      delta: part.ownDelta,
      emptyWidth,
      bars: partBars,
    });
    bars.push(...partBars);
    x += width + gapPart;
  });

  return {
    parts: laid,
    bars,
    totalWords,
    partCount,
    sectionCount,
  };
}

/**
 * Map each file's timestamp onto 0…1, newest at 1.
 *
 * Rank rather than elapsed time: a project written over two years and one
 * written over a fortnight should both show where the recent work is, and a
 * linear map of dates would leave the fortnight's spine uniformly bright and
 * the two years' uniformly dark.
 *
 * Everything untouched, or all touched at once, sits at 1: a flat spine says
 * "no recency information", which is honest, where a flat dim one would say
 * "all of this is stale".
 */
function recencyScale(
  entries: readonly NodeStat[],
): (at: string | undefined) => number {
  const stamps = [
    ...new Set(
      entries.map((e) => e.updatedAt).filter((s): s is string => Boolean(s)),
    ),
  ].sort();
  if (stamps.length <= 1) return () => 1;

  const rank = new Map<string, number>();
  stamps.forEach((stamp, i) => rank.set(stamp, i / (stamps.length - 1)));
  return (at) => (at && rank.has(at) ? (rank.get(at) ?? 0) : 0);
}

/**
 * The ink a Section is drawn in, by how recently it was touched: full at the
 * most recent, fading to a floor that still reads at the oldest.
 */
export function recencyOpacity(recency: number): number {
  return 0.3 + 0.7 * recency;
}

/**
 * The counts row's voice: full numbers below a thousand, `k` shorthand
 * above. A project of a few hundred words rendered as "0.2k" is a row of
 * identical labels that say nothing; the shorthand earns its width at a real
 * book's scale.
 */
export function formatCount(words: number): string {
  return words < 1000 ? String(words) : `${(words / 1000).toFixed(1)}k`;
}

/**
 * "5 parts, 31 sections, 84,120 words": what a screen reader is told. Takes
 * the three totals both layouts carry, so the goal-anchored drawing describes
 * itself with the same sentence the proportional one does.
 */
export function describeSpine(layout: {
  partCount: number;
  sectionCount: number;
  totalWords: number;
}): string {
  return `${layout.partCount} parts, ${layout.sectionCount} sections, ${layout.totalWords.toLocaleString()} words`;
}
