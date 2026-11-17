// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Asks once per book which names, labels and values are one.
//
// The ledgers name a thing as each passage words it, so "the green iron
// gate", "the school gate" and "la cancellata" are three entities and their
// colours are never compared (`domain/entities.ts`). This asks the model
// once, showing it the names and nothing else, which of them are one, and
// keeps the answer while the names stay the same.
//
// The same question is asked of the ledgers' labels: each passage
// labels a fact in its own words, so "hair colour" here and "colour of her
// hair" there are two facts that are never compared. Grouped, they are one.
// It is also asked of the free-text values: "baker" and "works in a
// bakery" would read as a conflict the judge must turn down, and a capped
// judge spends itself on them. A value that fits two others ("dark" beside
// "brown" and "black") is grouped with neither, so a real slip is never
// merged away.
//
// The answer can only point at the list's own numbers. A failed or
// shapeless answer groups nothing, so the check compares what it would
// compare without grouping, never less.

import { labelKey, valueKey } from "../domain/candidates";
import {
  aliasesOf,
  ENTITY_NAMES_MAX,
  ENTITY_RECIPE_REVISION,
  entityKey,
  GROUPING_PARTS,
  groupsOf,
  type EntityGroups,
  type GroupingPart,
} from "../domain/entities";
import { fixedSpelling, type SectionLedger, amountOf } from "../domain/ledger";
import { STANDARD, samplingFields } from "../domain/mode";
import type { ModelDescriptor, ModelRef, RunUsage } from "../domain/types";
import type { Artifacts, ModelProvider } from "../ports";
import { ENTITY_OUTPUT_TOKENS, limitsFor } from "./budgets";
import { stoppedIf, throwIfCancelled } from "./runStep";
import {
  structuredAnswer,
  type StructuredAnswerShape,
} from "./structuredAnswer";
import { appLog, describeError } from "../../log";

export const ENTITY_INSTRUCTIONS = `You are shown a numbered list of names, each with what it is (a place or a thing). They are every name a note-taker used for the places and things of one novel, each passage noted on its own, so one thing may be named in several ways: with more or fewer words, by its owner, or in another language ("the old revolver", "Hale's gun", "la pistola").

Group the names that surely mean the same place or thing. Leave alone any you are not sure of: two things of one kind are not one thing ("the front door" and "the back door"; "Anna's car" and "Luca's car"; a bed and a sofa), a part is not its whole (a house's garden is not the house), and a place is never a thing. Answer with groups of the names' numbers, each group at least two numbers and each number in at most one group. A name that belongs with no other is left out. An empty list is a fine answer.`;

export const LABEL_INSTRUCTIONS = `You are shown a numbered list of labels a note-taker gave the facts of one novel, each with how its values are written (a number, a colour, words…). Each passage was noted on its own, so one kind of fact may be labelled in several ways: with more or fewer words, as a synonym, or in another language ("hair colour", "colour of hair", "colore dei capelli").

Group the labels that surely name the same kind of fact, so that two values under them could not both be true at once. Never group two different kinds of fact, even close ones ("home" and "workplace"; "mother" and "father"; "height" and "weight"; "hair colour" and "hair style"). Answer with groups of the labels' numbers, each group at least two numbers and each number in at most one group. A label that belongs with no other is left out. An empty list is a fine answer.`;

export const VALUE_INSTRUCTIONS = `You are shown a numbered list of values a note-taker wrote down for facts in one novel, each after the kind of fact it is. Each passage was noted on its own, so one value may be written in several ways: with more or fewer words, as a synonym, or in another language ("baker", "works in a bakery", "fornaio").

Group the values of one kind of fact that surely say the same thing, so that a reader would never take one for a contradiction of another. Never group values that could not both be true ("brown" and "blond"; "baker" and "teacher"; "Rome" and "Milan"). A vaguer value that fits two different ones belongs with neither ("dark" fits both "brown" and "black"). Never group values of two different kinds of fact. Answer with groups of the values' numbers, each group at least two numbers and each number in at most one group. A value that belongs with no other is left out. An empty list is a fine answer.`;

export interface EntityDependencies {
  model: ModelProvider;
  descriptor: ModelDescriptor;
  modelRef: ModelRef;
  artifacts: Pick<Artifacts, "readEntities" | "writeEntities">;
}

/** One list the model is asked to group: keys, how each is shown, counts. */
interface Question {
  /** Which part of the kept file holds the answer. */
  part: GroupingPart;
  instructions: string;
  counts: Map<string, number>;
  label: (key: string) => string;
  /** The groups as the answer may keep them. */
  keep?: (groups: string[][]) => string[][];
}

/**
 * Each grouped name (`entityKey`) and the one it stands for, from the
 * ledgers' names. Asks only when the kept groups were asked of other names.
 */
export async function groupEntities(
  ledgers: readonly SectionLedger[],
  deps: EntityDependencies,
  signal: AbortSignal,
): Promise<{ grouped: Map<string, string>; usage: RunUsage }> {
  const counts = new Map<string, number>();
  const spelt = new Map<string, string>();
  const kinds = new Map<string, string>();
  for (const ledger of ledgers)
    for (const claim of ledger.claims) {
      // People and animals are the book's names to resolve, never grouped.
      if (claim.kind !== "place" && claim.kind !== "thing") continue;
      const key = entityKey(claim.entity);
      if (!kinds.has(key)) kinds.set(key, claim.kind);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!spelt.has(key)) spelt.set(key, claim.entity);
    }
  return ask(
    {
      part: "names",
      instructions: ENTITY_INSTRUCTIONS,
      counts,
      label: (key) => `${JSON.stringify(spelt.get(key))} (${kinds.get(key)})`,
      // A place is never a thing, whatever the answer says: an instruction
      // is not a check. A part left with one name groups nothing.
      keep: (groups) => splitBy(groups, (key) => kinds.get(key) ?? ""),
    },
    deps,
    signal,
  );
}

/**
 * Each grouped label (`labelKey`) and the one it stands for, each
 * shown with how its values are spelt, for the model to read what it is.
 */
export async function groupLabels(
  ledgers: readonly SectionLedger[],
  deps: EntityDependencies,
  signal: AbortSignal,
): Promise<{ grouped: Map<string, string>; usage: RunUsage }> {
  const counts = new Map<string, number>();
  const types = new Map<string, Set<string>>();
  for (const ledger of ledgers)
    for (const claim of ledger.claims) {
      // A name is compared by its spelling (`candidates`), never by label.
      if (claim.type === "name") continue;
      const key = labelKey(claim);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      types.set(key, (types.get(key) ?? new Set()).add(claim.type));
    }
  return ask(
    {
      part: "labels",
      instructions: LABEL_INSTRUCTIONS,
      counts,
      label: (key) =>
        `${JSON.stringify(key)} (${[...(types.get(key) as Set<string>)].sort().join(", ")})`,
      // A fact measured in numbers, dates, days or times is never one fact
      // with one told in words or colours: a group that mixed them would hold
      // every number against every word. A label given both is worded.
      keep: (groups) =>
        splitBy(groups, (key) =>
          [...(types.get(key) as Set<string>)].every(measured)
            ? "measured"
            : "worded",
        ),
    },
    deps,
    signal,
  );
}

/** A value type compared by its number: never one fact with words. */
function measured(type: string): boolean {
  return (
    type === "number" || type === "date" || type === "day" || type === "time"
  );
}

/**
 * Each grouped free-text value (`valueKey`) and the norm it is compared as,
 * under the labels as `labels` grouped them. Only a fact given two
 * or more values, one of them in free words, is asked about: a fact stated
 * only in numbers, dates or colour words is in one spelling already. Its
 * every value is listed, a colour word too, since whether "dark" is
 * "black" is a reader's call, not a spelling's.
 */
export async function groupValues(
  ledgers: readonly SectionLedger[],
  labels: ReadonlyMap<string, string>,
  deps: EntityDependencies,
  signal: AbortSignal,
): Promise<{ grouped: Map<string, string>; usage: RunUsage }> {
  const counts = new Map<string, number>();
  const facts = new Map<string, Set<string>>();
  const worded = new Set<string>();
  for (const ledger of ledgers)
    for (const claim of ledger.claims) {
      if (claim.type === "name") continue;
      const label = labels.get(labelKey(claim)) ?? labelKey(claim);
      const key = valueKey(label, claim.norm);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      facts.set(label, (facts.get(label) ?? new Set()).add(key));
      if (!fixedSpelling(claim.type)) worded.add(label);
    }
  for (const [fact, keys] of facts)
    if (keys.size < 2 || !worded.has(fact))
      for (const key of keys) counts.delete(key);
  const { grouped, usage } = await ask(
    {
      part: "values",
      instructions: VALUE_INSTRUCTIONS,
      counts,
      label: (key) => {
        const [attribute, ...norm] = key.split("|");
        return `${attribute}: ${JSON.stringify(norm.join("|"))}`;
      },
      // Two kinds of fact are never one value; nor are two different
      // amounts.
      keep: (groups) => sameAmount(splitBy(groups, factOf)),
    },
    deps,
    signal,
  );
  // The stand-in's norm: what `candidates` compares.
  return {
    grouped: new Map(
      [...grouped].map(([key, lead]) => [
        key,
        lead.split("|").slice(1).join("|"),
      ]),
    ),
    usage,
  };
}

/** A value key's fact: its label. */
function factOf(key: string): string {
  return key.split("|")[0];
}

/** A value key's norm: what `candidates` compares. */
function normOfKey(key: string): string {
  return key.split("|").slice(1).join("|");
}

/**
 * Each group kept whole while its numbers agree, and split when they do
 * not. A worded value ("twelve metres") in a group of two amounts could be
 * either, so it stands alone; in a group of one amount it stays with it.
 */
function sameAmount(groups: readonly string[][]): string[][] {
  return groups.flatMap((group) => {
    const amounts = new Set(
      group.flatMap((key) => {
        const amount = amountOf(normOfKey(key))?.amount;
        return amount === undefined ? [] : [amount];
      }),
    );
    if (amounts.size <= 1) return [group];
    return splitBy([group], (key) => {
      const amount = amountOf(normOfKey(key))?.amount;
      return amount === undefined ? "words" : `n:${amount}`;
    });
  });
}

/** Each group split by `by`, the parts left with two or more kept. */
function splitBy(
  groups: readonly string[][],
  by: (key: string) => string,
): string[][] {
  return groups.flatMap((group) => {
    const parts = new Map<string, string[]>();
    for (const key of group)
      parts.set(by(key), [...(parts.get(by(key)) ?? []), key]);
    return [...parts.values()].filter((one) => one.length >= 2);
  });
}

/**
 * The question asked, or its kept answer reused while the question is the
 * same, as each key's stand-in.
 *
 * A kept answer's identity is the whole question as put: every line the
 * model was shown, kind and type included, and which model was asked. A
 * name reclassified as a place, or a label turned numeric, is a new
 * question. Kept groups pass the question's `keep` guard as a fresh answer
 * does.
 */
async function ask(
  question: Question,
  deps: EntityDependencies,
  signal: AbortSignal,
): Promise<{ grouped: Map<string, string>; usage: RunUsage }> {
  const { counts } = question;
  const listed = [...counts.keys()]
    .sort((a, b) => (counts.get(b) as number) - (counts.get(a) as number))
    .slice(0, ENTITY_NAMES_MAX)
    .sort();
  let usage: RunUsage = { steps: 0 };
  if (listed.length < 2) return { grouped: new Map(), usage };
  const lines = listed.map((key) => question.label(key));
  const model = `${deps.modelRef.providerId}/${deps.modelRef.modelId}`;
  const guarded = (groups: string[][]) =>
    question.keep ? question.keep(groups) : groups;
  // An unreadable file is asked again, like a lost ledger.
  const read = await deps.artifacts.readEntities().catch(() => null);
  const kept = read?.recipeRevision === ENTITY_RECIPE_REVISION ? read : null;
  const before = kept?.[question.part];
  if (
    before &&
    before.model === model &&
    before.asked.join("\n") === lines.join("\n")
  ) {
    // Kept groups name a key missing from the list only when the file was
    // edited by hand; such a key groups nothing.
    const known = new Set(listed);
    const groups = before.groups
      .map((group) => group.filter((key) => known.has(key)))
      .filter((group) => group.length >= 2);
    return { grouped: aliasesOf(guarded(groups), counts), usage };
  }
  throwIfCancelled(signal);
  const sampling = samplingFields(STANDARD, deps.descriptor);
  const answer = await structuredAnswer(
    deps.model,
    deps.descriptor,
    {
      model: deps.modelRef,
      instructions: question.instructions,
      messages: [
        {
          role: "user",
          content: lines.map((line, at) => `${at + 1}. ${line}`).join("\n"),
        },
      ],
      limits: limitsFor(deps.descriptor, ENTITY_OUTPUT_TOKENS, sampling.effort),
      ...sampling,
    },
    groupsShape(listed),
    signal,
  );
  usage = answer.usage;
  stoppedIf(answer.reason, "Checking stopped");
  if (!answer.value) return { grouped: new Map(), usage };
  const groups = guarded(answer.value);
  // The other questions' answers are kept as they were.
  const next = {
    recipeRevision: ENTITY_RECIPE_REVISION,
    ...Object.fromEntries(
      GROUPING_PARTS.map((part) => [
        part,
        kept?.[part] ?? { asked: [], model: "", groups: [] },
      ]),
    ),
    [question.part]: { asked: lines, model, groups },
  } as EntityGroups;
  await deps.artifacts.writeEntities(next).catch((err) =>
    appLog.warn("ai", "An AI cache file could not be written.", {
      artifact: "entities",
      ...describeError(err),
    }),
  );
  return { grouped: aliasesOf(groups, counts), usage };
}

function groupsShape(
  names: readonly string[],
): StructuredAnswerShape<string[][]> {
  return {
    name: "group_names",
    description: "Group the names that mean the same one.",
    inputSchema: {
      type: "object",
      properties: {
        groups: {
          type: "array",
          items: { type: "array", items: { type: "integer" } },
        },
      },
      required: ["groups"],
      additionalProperties: false,
    },
    validate: (value) => groupsOf(value, names),
  };
}
