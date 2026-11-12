// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ImportPlan, Level, PlanEntry } from "../domain/plan";
import type { TitleWords } from "../ports";
import { layout, unitsOf, type NodeKind } from "./draft";
import type { PreparedBook } from "./prepare";
import { tidyTitle, titleFor } from "./titles";

// What the writer can change before the import. The list keeps including and
// joining apart, because one tick meaning "merge" reads as "do not import":
//
//   - the tick (a row's bead): whether the row comes into the project at all.
//     Ticked, it is imported; unticked, it is left out, text and all.
//   - the join (the gap between two beads): whether the row starts its own
//     Section, or its text, title line included, becomes the end of the row
//     above. Nothing is lost by it and nothing is invented.
//   - the name: a row's title, typed over in place.
//
// What the row itself offers, under the pointer: its kind, a Part or a
// Section (`setKind`), and a cut between two paragraphs (`splitAt`). The
// plan holds levels, not kinds; the kind follows from the whole of it
// (`layout`).
//
// The book's one choice above the list, each scene its own Section, cuts
// every chapter at its scene breaks into scene rows, and takes them away
// again when it is unticked.
//
// Reordering belongs to the editor, after the book exists.

function replace(plan: ImportPlan, entries: PlanEntry[]): ImportPlan {
  return { ...plan, entries };
}

/**
 * Toggles whether a row comes into the project at all, its tick. A chapter's
 * scenes come and go with it: a chapter's own row holds no text once it is
 * cut into scenes, and scenes left behind without it would join the chapter
 * above.
 */
export function toggleInclude(plan: ImportPlan, key: string): ImportPlan {
  const at = plan.entries.findIndex((entry) => entry.key === key);
  if (at < 0) return plan;
  const included = !plan.entries[at].included;
  let end = at + 1;
  if (plan.entries[at].level === "chapter")
    while (plan.entries[end]?.level === "scene") end += 1;
  return replace(
    plan,
    plan.entries.map((entry, i) =>
      i >= at && i < end ? { ...entry, included } : entry,
    ),
  );
}

/**
 * Toggles whether a row starts its own Section or Part, or joins the one
 * above. A row the writer cut off joins back by going away: its text returns
 * to the row it was cut from, as if the cut had never been made.
 */
export function toggleStart(plan: ImportPlan, key: string): ImportPlan {
  const at = plan.entries.findIndex((entry) => entry.key === key);
  if (at < 0) return plan;
  const entry = plan.entries[at];
  if (entry.origin === "split" && entry.starts && at > 0) {
    const entries = [...plan.entries];
    entries[at - 1] = { ...entries[at - 1], end: entry.end };
    entries.splice(at, 1);
    return replace(plan, entries);
  }
  return replace(
    plan,
    plan.entries.map((e, i) => (i === at ? { ...e, starts: !e.starts } : e)),
  );
}

/** Renames a row as the writer typed it; nothing typed keeps the old name. */
export function rename(
  plan: ImportPlan,
  key: string,
  typed: string,
): ImportPlan {
  const title = tidyTitle(typed);
  if (!title) return plan;
  return replace(
    plan,
    plan.entries.map((entry) =>
      entry.key === key && entry.title !== title
        ? { ...entry, title, titleSource: "writer" }
        : entry,
    ),
  );
}

/**
 * Cuts a row in two before paragraph `at`: a new row from there to the row's
 * end, of the row's own level (a chapter, under a Part's text). It is named
 * after the row it was cut from, numbered by its place among that row's cuts
 * ("Part 1", "Part 1 split 1", "Part 1 split 2"), and `retitle` keeps the
 * numbers in order however the cuts were made, and the name in step with the
 * row's. The line it starts with is never taken for a title: the writer chose
 * a place in the prose, not a heading.
 */
export function splitAt(
  plan: ImportPlan,
  key: string,
  at: number,
  words: TitleWords,
): ImportPlan {
  const index = plan.entries.findIndex((entry) => entry.key === key);
  const entry = plan.entries[index];
  if (!entry || at <= entry.start || at >= entry.end) return plan;
  const cut: PlanEntry = {
    key: `${entry.key}/${at}`,
    level: entry.level === "part" ? "chapter" : entry.level,
    start: at,
    end: entry.end,
    titleSpan: 0,
    title: "",
    titleSource: "split",
    matter: null,
    starts: true,
    included: entry.included,
    origin: "split",
  };
  const entries = [...plan.entries];
  entries.splice(index, 1, { ...entry, end: at }, cut);
  return retitle(replace(plan, entries), words);
}

/** The kind a starting row will have, or `null` for a row making no node. */
export function kindOf(
  plan: ImportPlan,
  key: string,
  words: TitleWords,
): NodeKind | null {
  const placed = layout(unitsOf(plan, words)).find(
    (node) => node.entry.key === key,
  );
  return placed?.kind ?? null;
}

const UP: Record<Level, Level[]> = {
  scene: ["chapter", "part"],
  chapter: ["part"],
  part: [],
};
const DOWN: Record<Level, Level[]> = {
  part: ["chapter", "scene"],
  chapter: ["scene"],
  scene: [],
};

/**
 * Makes a row a Part or a Section by the nearest level that does it, upward
 * for a Part and downward for a Section. A chapter made a Part becomes a Part
 * of the book and takes the chapters after it; a Part made a Section goes
 * back among the chapters. The plan is unchanged when no level does it, as
 * for a scene with no chapter above it to belong to.
 */
export function setKind(
  plan: ImportPlan,
  key: string,
  kind: NodeKind,
  words: TitleWords,
): ImportPlan {
  const entry = plan.entries.find((e) => e.key === key);
  if (!entry || kindOf(plan, key, words) === kind) return plan;
  for (const level of (kind === "part" ? UP : DOWN)[entry.level]) {
    const next = replace(
      plan,
      plan.entries.map((e) => (e.key === key ? { ...e, level } : e)),
    );
    if (kindOf(next, key, words) === kind) return next;
  }
  return plan;
}

/** Whether `setKind` can make the row that kind, or it already is. */
export function canBe(
  plan: ImportPlan,
  key: string,
  kind: NodeKind,
  words: TitleWords,
): boolean {
  return (
    kindOf(plan, key, words) === kind ||
    setKind(plan, key, kind, words) !== plan
  );
}

/** What marks the book's scenes, as the scenes tick says it. */
export interface SceneMarks {
  /** The ornament the writer typed, or `null` when blank lines mark them. */
  mark: string | null;
  /** The scenes the tick makes, or has made. */
  count: number;
}

/**
 * Where a chapter's scenes begin: after each scene break typed inside it
 * (the ornament line ends the scene before, so each scene opens on its
 * prose), or, in a manuscript with no typed scene break anywhere, at each run
 * of blank lines wider than its own spacing (one, double-spaced). A blank
 * line is never removed for it: it stays where it was, above the scene it
 * now opens.
 */
function sceneCuts(book: PreparedBook, entry: PlanEntry): number[] {
  const typed = book.blocks.some((block) => block.scene);
  const spacing = book.doubleSpaced ? 1 : 0;
  const cuts: number[] = [];
  for (let n = entry.start + entry.titleSpan + 1; n < entry.end; n++) {
    const block = book.blocks[n];
    // Two ornaments in a row are one break: the scene opens after the last.
    const after = typed
      ? book.blocks[n - 1].scene && !block.scene
      : (block.blankBefore ?? 0) > spacing;
    if (after) cuts.push(n);
  }
  return cuts;
}

/** Whether the scenes tick is on: the plan holds the rows it made. */
export const hasScenes = (plan: ImportPlan) =>
  plan.entries.some((entry) => entry.origin === "scenes");

/** What the scenes tick would offer for this plan, or `null` with no breaks. */
export function sceneMarks(
  plan: ImportPlan,
  book: PreparedBook,
): SceneMarks | null {
  const count = hasScenes(plan)
    ? plan.entries.filter((entry) => entry.origin === "scenes").length
    : plan.entries
        .filter((entry) => entry.level === "chapter")
        .map((entry) => sceneCuts(book, entry).length)
        .filter((cuts) => cuts > 0)
        .reduce((sum, cuts) => sum + cuts + 1, 0);
  if (!count) return null;
  // The ornament the writer used most, said as they typed it.
  const tally = new Map<string, number>();
  for (const block of book.blocks)
    if (block.scene) tally.set(block.text, (tally.get(block.text) ?? 0) + 1);
  const mark = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { mark, count };
}

/**
 * Each scene its own Section: every chapter with scene breaks becomes the
 * row of a Part holding no text of its own, and its text the rows of its
 * scenes, the first opening on the chapter's title line. Chapters with none
 * stay as they are.
 */
export function splitScenes(
  plan: ImportPlan,
  book: PreparedBook,
  words: TitleWords,
): ImportPlan {
  const entries: PlanEntry[] = [];
  for (const entry of plan.entries) {
    const cuts = entry.level === "chapter" ? sceneCuts(book, entry) : [];
    if (!cuts.length) {
      entries.push(entry);
      continue;
    }
    entries.push({ ...entry, end: entry.start });
    const bounds = [entry.start, ...cuts, entry.end];
    for (let i = 0; i + 1 < bounds.length; i++)
      entries.push({
        key: `${entry.key}~${i + 1}`,
        level: "scene",
        start: bounds[i],
        end: bounds[i + 1],
        titleSpan: 0,
        title: words.scene(entry.title, i + 1),
        titleSource: "scene",
        matter: null,
        starts: true,
        included: entry.included,
        origin: "scenes",
        scene: i + 1,
      });
  }
  return replace(plan, entries);
}

/**
 * The scenes tick, unticked: the rows it made go, their text back to the row
 * above them, and a scene the writer cut is a chapter again.
 */
export function unsplitScenes(plan: ImportPlan): ImportPlan {
  const entries: PlanEntry[] = [];
  for (const entry of plan.entries) {
    if (entry.origin === "scenes" && entries.length) {
      const above = entries[entries.length - 1];
      entries[entries.length - 1] = { ...above, end: entry.end };
      continue;
    }
    entries.push(
      entry.level === "scene" ? { ...entry, level: "chapter" } : entry,
    );
  }
  return replace(plan, entries);
}

/**
 * Words the made-up titles again in the book's language, and tells apart the
 * titles the project would hold twice. A title the source gave, or the writer
 * typed, is otherwise never touched; "Untitled" or "Dedication" that
 * detection supplied becomes "Senza titolo" or "Dedica" when the writer says
 * the book is Italian. A scene is named after its chapter, and a cut after
 * the row it was cut from, as that row is named now; a cut's number is its
 * place among the cuts after that row, so one made above another renumbers
 * the other. The window shows and imports the plan through this, so the two
 * cannot disagree.
 *
 * The project allows two nodes to share a title, such as a point-of-view
 * character's name heading each of their chapters, but five "Anna"s cannot
 * be told apart in the tree. So each shared title is numbered in reading
 * order, "Anna - 1", "Anna - 2", on the node's name alone: the title line in
 * the prose stays as written. Only rows that make a node count. The numbers
 * come before the scenes and cuts are named, so "Anna - 2, scene 1" says
 * whose scene it is.
 */
export function retitle(plan: ImportPlan, words: TitleWords): ImportPlan {
  // Which rows make a node depends on the ticks and joins, never the titles.
  const named = new Set(unitsOf(plan, words).map((unit) => unit.entry.key));
  const own = plan.entries.map((entry) =>
    entry.titleSource === "generated"
      ? titleFor({ title: "", matter: entry.matter }, words)
      : entry.title,
  );
  const derived = (entry: PlanEntry) =>
    entry.titleSource === "scene" || entry.titleSource === "split";
  const numbered = numberShared(
    plan.entries,
    own,
    (entry) => named.has(entry.key) && !derived(entry),
    words,
  );
  let chapter = "";
  // The row the cuts below were made from, and how many there are so far.
  let origin = "";
  let cuts = 0;
  const titles = plan.entries.map((entry, i) => {
    let title = numbered[i];
    if (entry.origin === "split") cuts += 1;
    if (entry.titleSource === "scene")
      title = words.scene(chapter, entry.scene ?? 1);
    else if (entry.titleSource === "split") title = words.split(origin, cuts);
    if (entry.level === "chapter") chapter = title;
    if (entry.origin !== "split") {
      origin = title;
      cuts = 0;
    }
    return title;
  });
  // A made-up name can still meet one the writer typed ("LEV split 1").
  const unique = numberShared(
    plan.entries,
    titles,
    (entry) => named.has(entry.key),
    words,
  );
  return replace(
    plan,
    plan.entries.map((entry, i) =>
      unique[i] === entry.title ? entry : { ...entry, title: unique[i] },
    ),
  );
}

/**
 * The titles, with each one that more than one counted row holds numbered in
 * reading order. They compare as the writer reads them: by letters, not by
 * case or the spaces around them. A number another row's title already reads
 * as is passed over ("Anna - 1" typed beside two "Anna"s), so what comes out
 * is every counted title once.
 */
function numberShared(
  entries: readonly PlanEntry[],
  titles: readonly string[],
  counts: (entry: PlanEntry) => boolean,
  words: TitleWords,
): string[] {
  const same = (title: string) => title.trim().toLocaleLowerCase();
  const held = new Map<string, number>();
  entries.forEach((entry, i) => {
    if (!counts(entry)) return;
    const k = same(titles[i]);
    held.set(k, (held.get(k) ?? 0) + 1);
  });
  const taken = new Set(held.keys());
  const last = new Map<string, number>();
  return titles.map((title, i) => {
    const k = same(title);
    if (!counts(entries[i]) || (held.get(k) ?? 0) < 2) return title;
    let n = last.get(k) ?? 0;
    let numbered: string;
    do numbered = words.shared(title, ++n);
    while (taken.has(same(numbered)));
    last.set(k, n);
    taken.add(same(numbered));
    return numbered;
  });
}
