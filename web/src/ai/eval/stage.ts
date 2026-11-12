// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Where a plant the findings missed was lost, read off the run's own
// ledgers, kept groupings and candidates (`scripts/fact-eval.mjs`).
//
// It reads the run the way the pipeline did. A claim states the
// plant when its value holds the words, and two claims are one fact when
// `candidates` would key them together: `entityResolver` over the kept name
// groups, `labelKey` over the kept label groups, the kept value groups. The
// stage is named by where the two statements parted. Matching the exact
// spelling of `entity|attribute` instead would call a fact noted under two
// wordings an extraction loss, and pairing claims by their quotes would pair
// different facts read from one sentence.
import {
  type Candidate,
  entityResolver,
  labelKey,
  valueKey,
} from "../domain/candidates";
import { aliasesOf, entityKey, type EntityGroups } from "../domain/entities";
import type { Claim, SectionLedger } from "../domain/ledger";
import { findTerms, fold } from "../domain/textMatch";
import type { ScoredPlant } from "./score";

/**
 * The stages a plant passes, in order. `found` is no loss. `extraction`:
 * the fact never reached a ledger as the book states it, on the planted
 * side or the witness's. `unpaired`: both statements are in the ledgers,
 * under a name and a label the pipeline could not have made one: the
 * extractor decomposed the fact two ways, or the planter's witness is
 * another fact, and a reader decides which. `grouping`: the grouping question
 * left them two facts (labels not united; a place's or a thing's names
 * not united), or made their two values one. `candidate`: keyed as one
 * fact, or one person the resolver named apart, and never raised.
 * `judgment`: raised, and the judge did not call it.
 */
export type Stage =
  "found" | "extraction" | "unpaired" | "grouping" | "candidate" | "judgment";

export interface Loss {
  stage: Stage;
  /** The one reason, in words, with the two sides named where it helps. */
  detail: string;
}

/** What one run kept: its ledgers by source, and the grouping file. */
export interface StageArtifacts {
  ledgers: ReadonlyMap<string, SectionLedger>;
  groupings: EntityGroups | null;
}

/** What the check returned about its candidates, by identity. */
export interface StageResult {
  raised: readonly Candidate[];
  unresolved: readonly Pick<Candidate, "key">[];
  deferred: readonly Pick<Candidate, "key">[];
}

/** Where `scored.plant` was lost, or `found`. */
export function stageOf(
  scored: ScoredPlant,
  artifacts: StageArtifacts,
  result: StageResult,
): Loss {
  const plant = scored.plant;
  if (scored.found)
    return { stage: "found", detail: "a finding quotes the planted words" };
  const ledger = artifacts.ledgers.get(plant.sourceId);
  if (!ledger)
    return { stage: "extraction", detail: "no ledger for its source" };
  const planted = ledger.claims.filter((claim) =>
    states(claim, plant.after, plant.kind === "name"),
  );
  if (planted.length === 0)
    return {
      stage: "extraction",
      detail: ledger.claims.some((claim) => holds(claim.quote, plant.after))
        ? "the planted words are in a claim's quote, but are no claim's value"
        : "the planted words are in no claim",
    };
  const raised = result.raised.filter((one) =>
    one.sides.some(
      (side) =>
        side.sourceId === plant.sourceId && holds(side.quote, plant.after),
    ),
  );
  if (raised.length > 0) {
    const keys = new Set(raised.map((one) => one.key));
    if (result.unresolved.some((one) => keys.has(one.key)))
      return { stage: "judgment", detail: "answered in no shape" };
    if (result.deferred.some((one) => keys.has(one.key)))
      return { stage: "judgment", detail: "deferred past the cap" };
    return { stage: "judgment", detail: "raised, judged no slip" };
  }
  // A weekday plant is checked by arithmetic, not against a counterpart:
  // its candidate is a one-sided `calendar` one, raised only once the book
  // has given a year to reckon from and the date could be placed.
  if (plant.kind === "weekday")
    return {
      stage: "candidate",
      detail:
        "the dated claim is in the ledger, but no calendar candidate was raised (no year to reckon from, or the date not placed)",
    };
  const counterparts = counterpartsOf(plant, planted, artifacts.ledgers);
  if (counterparts.length === 0) return noCounterpart(plant, artifacts);
  // A name is compared by its spellings (`nameDrift`), not by a label.
  if (plant.kind === "name")
    return {
      stage: "candidate",
      detail:
        "the name is in the ledgers under both spellings, and no name candidate was raised",
    };
  const stated = counterparts.filter((one) => one.status === "stated");
  if (stated.length === 0)
    return {
      stage: "candidate",
      detail: `the counterpart's status is ${JSON.stringify(counterparts[0].status)}, not stated — never compared`,
    };
  // The closest pairing decides: a pair the pipeline keyed as one fact is a
  // loss after grouping, whatever another pair says.
  const keys = pipelineKeys(artifacts);
  return best(
    planted.flatMap((mine) =>
      stated.map((theirs) => pairing(mine, theirs, keys)),
    ),
  );
}

/**
 * Whether a claim states `word` as its value: in the value as the book
 * words it, in the norm, or, for a name plant, as the entity. Never merely
 * somewhere in its quote, because one sentence is quoted by every claim
 * read from it, and "golden hat" is in the hair colour's quote too.
 */
function states(claim: Claim, word: string, asName: boolean): boolean {
  return (
    holds(claim.value, word) ||
    holds(claim.norm, word) ||
    (asName && holds(claim.entity, word))
  );
}

/**
 * The claims elsewhere that state the fact as the book had it: they hold
 * the old words as their value, and where the planter recorded witnesses,
 * they were read from a witness sentence, because another entity's same
 * number is no counterpart.
 */
function counterpartsOf(
  plant: ScoredPlant["plant"],
  planted: readonly Claim[],
  ledgers: ReadonlyMap<string, SectionLedger>,
): Claim[] {
  const witnesses = plant.witnesses ?? [];
  const found: Claim[] = [];
  for (const ledger of ledgers.values())
    for (const claim of ledger.claims) {
      if (planted.includes(claim)) continue;
      if (!states(claim, plant.before, plant.kind === "name")) continue;
      if (
        witnesses.length === 0 ||
        witnesses.some(
          (one) =>
            one.sourceId === ledger.sourceId &&
            overlaps(one.quote, claim.quote),
        )
      )
        found.push(claim);
    }
  return found;
}

/**
 * Why no claim states the fact's other value: an extraction loss, told
 * apart.
 */
function noCounterpart(
  plant: ScoredPlant["plant"],
  artifacts: StageArtifacts,
): Loss {
  const witnesses = plant.witnesses ?? [];
  if (witnesses.length === 0)
    return {
      stage: "extraction",
      detail: "no claim anywhere states the fact's other value",
    };
  const read = witnesses.filter((one) => artifacts.ledgers.has(one.sourceId));
  if (read.length === 0)
    return {
      stage: "extraction",
      detail: "no ledger for the witness's source",
    };
  const fromSentence = read.some((one) =>
    (artifacts.ledgers.get(one.sourceId) as SectionLedger).claims.some(
      (claim) => overlaps(one.quote, claim.quote),
    ),
  );
  const n = `${witnesses.length} witness${witnesses.length === 1 ? "" : "es"}`;
  return {
    stage: "extraction",
    detail: fromSentence
      ? `the witness sentence yielded claims, none with the old value (${n})`
      : `the witness sentence yielded no claim (${n})`,
  };
}

/**
 * How `candidates` keyed the claims of this run: the entity as
 * `entityResolver` names it over the kept name groups, the label as the
 * kept label groups stand it in, the kept value groups as they are. The
 * stand-ins are rebuilt from the same counts (`aliasesOf`) so the keys are
 * the pipeline's own, not a reading of them.
 */
function pipelineKeys(artifacts: StageArtifacts) {
  const ledgers = [...artifacts.ledgers.values()];
  const kept = artifacts.groupings;
  const nameCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  for (const ledger of ledgers)
    for (const claim of ledger.claims) {
      if (claim.kind === "place" || claim.kind === "thing")
        count(nameCounts, entityKey(claim.entity));
      if (claim.type !== "name") count(labelCounts, labelKey(claim));
    }
  const names = aliasesOf(kept?.names.groups ?? [], nameCounts);
  const labels = aliasesOf(kept?.labels.groups ?? [], labelCounts);
  const entityOf = entityResolver(
    ledgers.map((ledger) => ({ ledger, text: "" })),
    names,
  );
  return {
    entityOf,
    labelOf: (claim: Claim) => labels.get(labelKey(claim)) ?? labelKey(claim),
    valuesUnited: united(kept?.values.groups ?? []),
  };
}

function count(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Where `mine` and `theirs` parted on the way to a candidate, if they did. */
function pairing(
  mine: Claim,
  theirs: Claim,
  keys: ReturnType<typeof pipelineKeys>,
): Loss {
  const q = JSON.stringify;
  // A value the text sets in another time is compared with nothing of the
  // present: a past age is held by the years' arithmetic or not at all, so
  // this is the candidate stage's answer, not a grouping or extraction loss.
  if ((mine.when === undefined) !== (theirs.when === undefined)) {
    const scoped = mine.when ?? (theirs.when as string);
    const dated = scoped !== "past" && scoped !== "future";
    return {
      stage: "candidate",
      detail: `one side is of another time (${q(scoped)}) and the other of the present: never compared as values, ${dated ? "held only by the years' arithmetic" : "an undated time is held to nothing"}`,
    };
  }
  const e1 = keys.entityOf(mine.entity);
  const e2 = keys.entityOf(theirs.entity);
  const l1 = keys.labelOf(mine);
  const l2 = keys.labelOf(theirs);
  if (e1 === e2 && l1 === l2) {
    if (mine.norm === theirs.norm)
      return {
        stage: "extraction",
        detail: `the planted value was read as the same value as its counterpart (${q(mine.norm)})`,
      };
    if (keys.valuesUnited(valueKey(l1, mine.norm), valueKey(l1, theirs.norm)))
      return {
        stage: "grouping",
        detail: `the two values were grouped as one (${q(mine.norm)}, ${q(theirs.norm)})`,
      };
    return {
      stage: "candidate",
      detail: `one fact, two values in the ledgers (${q(mine.norm)}, ${q(theirs.norm)}), never raised — ranking or construction`,
    };
  }
  if (e1 === e2)
    return {
      stage: "grouping",
      detail: `labels not united: ${q(labelKey(mine))} against ${q(labelKey(theirs))}`,
    };
  if (l1 === l2) {
    // One person under two spellings the resolver did not make one (a
    // relation's name, "daughter of Amos", read as the entity's own, or a
    // word shared by two fuller names) is the candidate construction's to
    // answer, not the grouping question's, which asks only of places and
    // things.
    if (personAlias(entityKey(mine.entity), entityKey(theirs.entity)))
      return {
        stage: "candidate",
        detail: `the resolver named them apart: ${q(mine.entity)} as ${q(e1)}, ${q(theirs.entity)} as ${q(e2)}`,
      };
    if (
      (mine.kind === "place" || mine.kind === "thing") &&
      (theirs.kind === "place" || theirs.kind === "thing")
    )
      return {
        stage: "grouping",
        detail: `names not united: ${q(mine.entity)} against ${q(theirs.entity)}`,
      };
    return {
      stage: "unpaired",
      detail: `one label, two entities: ${q(mine.entity)} against ${q(theirs.entity)} — the extractor's decomposition, or a witness of another fact`,
    };
  }
  // One person, two label wordings: the grouping question parted the
  // labels first, and the resolver parted the names besides.
  if (personAlias(entityKey(mine.entity), entityKey(theirs.entity)))
    return {
      stage: "grouping",
      detail: `labels not united: ${q(labelKey(mine))} against ${q(labelKey(theirs))}; and the resolver named them apart: ${q(mine.entity)} as ${q(e1)}, ${q(theirs.entity)} as ${q(e2)}`,
    };
  return {
    stage: "unpaired",
    detail: `neither name nor label united: ${q(`${mine.entity}|${labelKey(mine)}`)} against ${q(`${theirs.entity}|${labelKey(theirs)}`)} — the extractor's decomposition, or a witness of another fact`,
  };
}

/** The pairing that says the plant went furthest before it was lost. */
function best(losses: readonly Loss[]): Loss {
  const order: Stage[] = [
    "extraction",
    "unpaired",
    "grouping",
    "candidate",
    "judgment",
    "found",
  ];
  return [...losses].sort(
    (a, b) => order.indexOf(b.stage) - order.indexOf(a.stage),
  )[0];
}

/** Whether two keys share one kept group. */
function united(
  groups: readonly (readonly string[])[],
): (a: string, b: string) => boolean {
  return (a, b) =>
    a === b || groups.some((group) => group.includes(a) && group.includes(b));
}

/** "amos" and "amos wren": one is a word of the other, as a reader sees it. */
function personAlias(a: string, b: string): boolean {
  const [short, full] = a.length <= b.length ? [a, b] : [b, a];
  return !short.includes(" ") && full.split(" ").includes(short);
}

function holds(text: string, word: string): boolean {
  return findTerms(text, [word], { wholeWord: true }).length > 0;
}

/** One sentence within the other, folded, as the scorer reads a witness. */
function overlaps(a: string, b: string): boolean {
  const x = fold(a).trim();
  const y = fold(b).trim();
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}
