// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Which of the ledgers' names mean one place or thing.
//
// Every ledger is read on its own, so one thing gets as many names as the
// passages that mention it: "the old revolver", "Hale's gun", "la pistola".
// A person is resolved by the name the book gives them (`candidates`'s
// resolver). A thing has no such name, so without grouping two claims about
// it are never compared and a slip in its colour or size is never raised.
//
// Places and things only. A model shown names alone merges people and files
// one character's facts under another's. A person's names are the
// book's and the sheets' to give, never a guess over a list.
//
// One question per book, asked of names only: which of these name the same
// one? The model answers with groups of the list's own numbers, never with
// new words, and plain code compares each group as one entity. A wrong merge
// makes a candidate the judge reads and turns down; a missed one leaves a
// slip unseen. Neither invents a finding.
//
// The answer is kept (`EntityGroups`) and reused while the set of names and
// the question are the same, so the groups and the candidate keys built on
// them stay put from one check to the next.
//
// The same question, asked of the ledgers' labels, compares two wordings of
// one kind of fact as one ("hair colour", "colour of her hair").
// Asked of a fact's free-text values, it compares two wordings of one value
// ("baker", "works in a bakery", "fornaio"). All three answers are
// kept in one file.

import { fold } from "./textMatch";

/** Bumped when the question or the answer's shape changes. */
export const ENTITY_RECIPE_REVISION = "5";

/** The most names one question lists: the most used first. */
export const ENTITY_NAMES_MAX = 500;

/**
 * One question's list and the model's answer to it.
 *
 * `asked` is the question as it was put: each line the model was shown,
 * with the kind or type beside the name, in order, not the sorted keys. With
 * the keys as identity, a name reclassified from thing to place, or a label
 * whose values turned from words to numbers, would keep its keys and reuse
 * an answer given to a different question. `model` is who was asked: one
 * model's reading of a list is not another's.
 */
export interface Grouping {
  /** The lines the model was shown, in order. */
  asked: string[];
  /** The model that answered, as `providerId/modelId`. */
  model: string;
  /** The groups the model gave, as keys, each at least two of the list's. */
  groups: string[][];
}

/** The three questions a fact check asks, each kept while its list holds. */
export const GROUPING_PARTS = ["names", "labels", "values"] as const;
export type GroupingPart = (typeof GROUPING_PARTS)[number];

export interface EntityGroups extends Record<GroupingPart, Grouping> {
  recipeRevision: string;
  /** Places' and things' names, as `entityKey`s. */
  names: Grouping;
  /** The ledgers' labels, as `labelKey`s. */
  labels: Grouping;
  /** Free-text values, as `valueKey`s. */
  values: Grouping;
}

/** A name as compared: folded, with its spacing collapsed. */
export function entityKey(entity: string): string {
  return fold(entity).replace(/\s+/gu, " ").trim();
}

/**
 * The model's answer as groups of `names`, or null when it is no answer.
 * A number off the list or already used is left out, and a group left with
 * fewer than two names is no group.
 */
export function groupsOf(
  value: unknown,
  names: readonly string[],
): string[][] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>).groups;
  if (!Array.isArray(raw)) return null;
  const used = new Set<number>();
  const groups: string[][] = [];
  for (const group of raw) {
    if (!Array.isArray(group)) continue;
    const members = group.filter(
      (one): one is number =>
        Number.isInteger(one) &&
        one >= 1 &&
        one <= names.length &&
        !used.has(one),
    );
    const distinct = [...new Set(members)];
    if (distinct.length < 2) continue;
    for (const one of distinct) used.add(one);
    groups.push(distinct.map((one) => names[one - 1]));
  }
  return groups;
}

/** The kept groups, or null when the value is not them. */
export function entityGroupsOf(value: unknown): EntityGroups | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const strings = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((one) => typeof one === "string");
  const grouping = (part: unknown): part is Grouping => {
    const one = part as Record<string, unknown> | null;
    return (
      !!one &&
      typeof one === "object" &&
      strings(one.asked) &&
      typeof one.model === "string" &&
      Array.isArray(one.groups) &&
      one.groups.every(strings)
    );
  };
  if (
    typeof raw.recipeRevision !== "string" ||
    !grouping(raw.names) ||
    !grouping(raw.labels) ||
    !grouping(raw.values)
  )
    return null;
  const copy = (one: Grouping): Grouping => ({
    asked: one.asked,
    model: one.model,
    groups: one.groups,
  });
  return {
    recipeRevision: raw.recipeRevision,
    names: copy(raw.names),
    labels: copy(raw.labels),
    values: copy(raw.values),
  };
}

/**
 * Each grouped name's stand-in: the group's name with the most claims
 * (`counts`), the longer on a tie, then the first in order — the same
 * groups always give the same stand-ins, so the keys built on them do not
 * move.
 */
export function aliasesOf(
  groups: readonly (readonly string[])[],
  counts: ReadonlyMap<string, number>,
): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const group of groups) {
    const lead = [...group].sort(
      (a, b) =>
        (counts.get(b) ?? 0) - (counts.get(a) ?? 0) ||
        b.length - a.length ||
        a.localeCompare(b),
    )[0];
    for (const name of group) if (name !== lead) aliases.set(name, lead);
  }
  return aliases;
}
