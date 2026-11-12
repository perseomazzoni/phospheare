// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What the ledgers disagree about, found by plain code.
//
// The ledgers (`ledger.ts`) hold every fact the book states, each keyed by
// who, what and a canonical value. A continuity slip is then a question
// equality answers: the same entity and label (`attribute`, of one value
// type) with two values. No kind of fact is named here: what the
// arithmetic needs, it reads from a value's type and unit. Nothing here reads
// a word of any language; every candidate is a pair of places the writer can
// be shown, and a judge (`application/judge.ts`) decides whether each is a
// slip, two different things, or a change the story tells.
//
// Seven kinds, and only these, because only these are decided by arithmetic
// or by equality over the ledgers' own fields:
// - `conflict`: two values of one fact in the prose, with no change narrated
//   between them (`Claim.change` starts a new stretch of story, and so does
//   a change a sheet dates to a Section, `Claim.from`);
// - `sheet`: a writer's sheet says one value and the prose another, in the
//   stretch the sheet's value holds for;
// - `sheets`: two of the writer's sheets say two values of one fact for the
//   same stretch of story, whether or not the prose states it at all,
//   reported for the writer to resolve, never decided between (`40-canon`);
// - `name`: a name spelt a hair's breadth from a name the book uses far more
//   often (edit distance over the prose's capitalised words, never a word
//   list);
// - `calendar`: a date whose stated weekday is not the day it falls on,
//   relative dates ("three days later", "a month on") counted from the last
//   one;
// - `years`: an age, or any number of years counted from a date
//   (`Claim.since`), that the date and the story's day say cannot be;
// - `travel`: a time no one covers that distance in, walking or driving: a
//   place's or a thing's length in metres against a time in seconds.
//
// Ranked so a capped judge spends itself where slips are: the calendar first
// (arithmetic is never unsure), then a name's spelling, then the values in a
// fixed spelling (numbers, dates, colours), and only then the free-text ones
// (a job, a place, a trait), whose two norms are as often one thing in two
// wordings as two things. Within each, the sheet first, then a value the book
// states once against one it states often, the shape a slip has, since the
// writer means the common one.

import { entityKey } from "./entities";
import { fieldByRef } from "./referenceCatalogue";
import type {
  Claim,
  ClaimStatus,
  DateOffset,
  SectionLedger,
  ValueType,
} from "./ledger";
import { amountOf, fixedSpelling, relativeDate, statedWeekday } from "./ledger";
import { editDistance, findTerms, fold } from "./textMatch";

/** One place a candidate points at. */
export interface CandidateSide {
  sourceId: string;
  origin: SectionLedger["origin"];
  at: number;
  quote: string;
  value: string;
  norm: string;
  /**
   * The last full date the prose states at or before this place, in reading
   * order (`YYYY-MM-DD`): story time as the book last told it, so the judge
   * can tell two places a day apart from two years apart. Absent on
   * a sheet, and before the book states any date.
   */
  dated?: string;
  /** The story narrates the value changing here (`Claim.change`). */
  change?: true;
  /** On a sheet, the Section its declared change holds from (`Claim.from`). */
  from?: string;
  /**
   * On a note shown to the judge: how the text holds it when it is not a
   * statement, such as a belief, a plan, an open question (`Claim.status`).
   * Absent on a side that is compared, which is always a stated one.
   */
  status?: Exclude<ClaimStatus, "stated">;
  /**
   * On a note, read from what the catalogue could not place
   * (`Claim.unclassified`): context the writer keeps, never an
   * established fact.
   */
  unclassified?: true;
  /** On a sheet, the field the quote sits in (`Claim.field`). */
  field?: string;
  /**
   * The time the value holds at when it is not the passage's own
   * (`Claim.when`): a date norm, or `past` / `future`. A side of
   * another time is compared only with sides of the same dated time, or by
   * arithmetic (a `years` candidate); otherwise it is a note.
   */
  when?: string;
}

export type CandidateKind =
  "calendar" | "years" | "sheet" | "sheets" | "conflict" | "travel" | "name";

export interface Candidate {
  /**
   * What the candidate is about, independent of where it was found or how
   * the book words it: `entity|attribute|norms`, the norms sorted. A
   * writer's dismissal is remembered by this key, so rewording a
   * sentence does not bring a dismissed candidate back and a new value does.
   */
  key: string;
  kind: CandidateKind;
  entity: string;
  /** What the fact is about, as the ledgers label it. */
  attribute: string;
  /**
   * How its values are spelt: `words` when any side is in free words ("dark"
   * beside "brown"), which is what ranks it after the fixed spellings.
   */
  type: ValueType;
  /** The rarer side first; one side for a calendar candidate. */
  sides: CandidateSide[];
  /** How many times the book states each side's value, side by side. */
  counts: number[];
  /**
   * What the arithmetic says instead: a calendar candidate's true weekday
   * (`mon`…`sun`), a years candidate's possible numbers ("3" or "2-3"), a
   * travel candidate's speed in km/h.
   */
  expected?: string;
  /** A calendar candidate's date as reckoned, `YYYY-MM-DD`. */
  date?: string;
  /**
   * What the writer's sheets say about the same fact, for the judge to read
   * beside a conflict in the prose: a change a sheet declares ("dyes her
   * hair in chapter five") is how the writer says a conflict is none.
   */
  notes?: CandidateSide[];
  /**
   * The fact through the book, for a conflict or a sheet candidate: each
   * value the prose gives it, where the prose first gives it, in reading
   * order: what was true at each point of the story, so the judge reads
   * the two places against the whole of it.
   */
  history?: CandidateSide[];
}

/** A ledger with the text its offsets point into, in reading order. */
export interface LedgerInBook {
  ledger: SectionLedger;
  text: string;
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

interface Placed {
  claim: Claim;
  side: CandidateSide;
  /** Reading position: the ledger's place, then the claim's offset. */
  order: number;
  /**
   * The value as compared: the norm, less a date's weekday, which the
   * calendar checks on its own ("Saturday 14 March" and "14 March" are one
   * date), and a free-text norm as the one it was grouped under.
   */
  value: string;
  /**
   * On a sheet, where its value starts to hold: the reading position of
   * the Section its declared change is dated to. Absent on a sheet that
   * describes the story as it opens, and on the prose.
   */
  starts?: number;
}

/**
 * Whether a claim may be a side of a candidate: stated, and read from a
 * field the catalogue placed (or from the prose). Everything else is a note
 * beside one.
 */
function compared(claim: Claim): boolean {
  return (
    claim.status === "stated" &&
    claim.unclassified !== true &&
    !namesOnlyItsLabel(claim)
  );
}

/** Words that point at a fact's owner without being any of its value. */
const DETERMINERS = new Set([
  "a",
  "an",
  "the",
  "her",
  "his",
  "my",
  "our",
  "their",
  "your",
  "its",
]);

/**
 * Whether a value only names its own label: "her father" under `father`
 * says whom the fact is about, never who the father is, and against a
 * sheet's "Amos Wren" it would read as a second value the judge could only
 * call unsure. The ledger drops a norm that is its label;
 * a possessive or an article in front of it is the same empty
 * value. Norms are lower-case English by the ledger's contract, in any book
 * language, so these words are English.
 */
function namesOnlyItsLabel(claim: Claim): boolean {
  const words = claim.norm
    .split(/\s+/u)
    .filter((word) => word !== "" && !DETERMINERS.has(word));
  return words.join(" ") === claim.attribute;
}

/** The history a judge is shown at most, in values. */
const HISTORY_MAX = 12;

/**
 * How far apart, in characters of one Section, a distance and a time may
 * stand and still be one journey's: about a page.
 */
const TRAVEL_NEAR = 2_000;

/**
 * What one question over the ledgers grouped (`application/entities.ts`),
 * each key to what it stands for.
 */
export interface Groupings {
  /** A place's or a thing's name (`entityKey`) to its group's. */
  entities?: ReadonlyMap<string, string>;
  /** A label (`labelKey`) to its group's. */
  labels?: ReadonlyMap<string, string>;
  /** A free-text value (`valueKey`) to the norm it is compared as. */
  values?: ReadonlyMap<string, string>;
}

/**
 * Every candidate the ledgers hold, ranked, less the `suppressed` keys.
 *
 * `order` is the book's Sections in reading order, as far as the check may
 * know them: the chat's whole boundary, not the ledgers in hand. It places
 * every claim: a Section's prose by the Section's place in the book, a
 * sheet's dated change by the Section it is dated to. The two lists differ
 * on a scoped check: a Part review holds the Part's ledgers and none of the
 * Sections before it, and a change the sheet dates to one of those takes
 * effect inside the Part all the same. Placed by the ledger list alone, such
 * a change would be dropped as if the book had lost it, and a Part review
 * would miss a slip the whole-book review finds. Only the order travels
 * (titles and ids from the catalogue), never a body outside the scope.
 * Absent, the prose ledgers' own order stands in, which is the book only
 * when the check reads all of it; a Section in neither list is one the book
 * does not have, and a change dated to it holds from nowhere.
 */
export function candidates(
  book: readonly LedgerInBook[],
  suppressed: ReadonlySet<string> = new Set(),
  groupings: Groupings = {},
  order?: readonly string[],
): Candidate[] {
  const entityOf = entityResolver(book, groupings.entities ?? new Map());
  // A value stamped with the year the writer's timeline gives as the story's
  // present is of the present: the extractor stamps one in a
  // reading and not in the next, and a stamped value would never meet an
  // unstamped one without a story day to count from.
  const present = presentYear(book);
  const whenOf = (claim: Claim) =>
    claim.when !== undefined &&
    present !== null &&
    claim.when.slice(0, 4) === present
      ? undefined
      : claim.when;
  const labelOf = (claim: Pick<Claim, "attribute">) => {
    const key = labelKey(claim);
    return groupings.labels?.get(key) ?? key;
  };
  const groups = new Map<string, Placed[]>();
  // What the book holds about a fact without stating it: a belief, a plan,
  // an open question. Never compared, shown to the judge beside a
  // candidate on the same fact.
  const asides = new Map<string, CandidateSide[]>();
  const dates: Placed[] = [];
  // Each Section's place in the book; a ledger of no Section (a sheet, or
  // prose the book's list does not name) is placed after every Section, in
  // the order it arrived, where story time has no say over it.
  const positions = new Map<string, number>(
    (
      order ??
      book
        .filter((one) => one.ledger.origin === "prose")
        .map((one) => one.ledger.sourceId)
    ).map((id, at) => [id, at]),
  );
  const placeOf = (sourceId: string, arrived: number) =>
    positions.get(sourceId) ?? positions.size + arrived;
  const index = new Map(
    book.map(({ ledger }, at) => [
      ledger.sourceId,
      placeOf(ledger.sourceId, at),
    ]),
  );
  book.forEach(({ ledger }, arrived) => {
    const place = placeOf(ledger.sourceId, arrived);
    for (const claim of ledger.claims) {
      if (!compared(claim)) {
        if (claim.type === "name") continue;
        const key = [entityOf(claim.entity), labelOf(claim)].join("|");
        asides.set(key, [
          ...(asides.get(key) ?? []),
          {
            sourceId: ledger.sourceId,
            origin: ledger.origin,
            at: claim.at,
            quote: claim.quote,
            value: claim.value,
            norm: claim.norm,
            ...(claim.status === "stated" ? {} : { status: claim.status }),
            ...(claim.unclassified ? { unclassified: true as const } : {}),
            ...(claim.field === undefined ? {} : { field: claim.field }),
            ...(claim.from === undefined ? {} : { from: claim.from }),
            ...(whenOf(claim) === undefined ? {} : { when: whenOf(claim) }),
          },
        ]);
        continue;
      }
      // A change a sheet dates to a Section the book does not have holds
      // from nowhere the prose can be held against.
      const starts =
        claim.from === undefined ? undefined : sectionAt(claim.from);
      if (starts === null) continue;
      const placed: Placed = {
        claim,
        side: {
          sourceId: ledger.sourceId,
          origin: ledger.origin,
          at: claim.at,
          quote: claim.quote,
          value: claim.value,
          norm: claim.norm,
          ...(claim.change ? { change: true as const } : {}),
          ...(claim.field === undefined ? {} : { field: claim.field }),
          ...(claim.from === undefined ? {} : { from: claim.from }),
          ...(whenOf(claim) === undefined ? {} : { when: whenOf(claim) }),
        },
        order: place * 1e9 + claim.at,
        value: dated(claim.type)
          ? claim.norm.replace(/ [a-z]{3}$/u, "")
          : (groupings.values?.get(valueKey(labelOf(claim), claim.norm)) ??
            named(claim)),
        ...(starts === undefined ? {} : { starts }),
      };
      if (dated(claim.type)) dates.push(placed);
      // A name is how a person is called, and a person has several: the
      // name kind below compares spellings instead. A relative date is
      // reckoned by the calendar, never compared as a value.
      if (claim.type === "name" || relativeDate(claim.norm)) continue;
      const key = [entityOf(claim.entity), labelOf(claim)].join("|");
      groups.set(key, [...(groups.get(key) ?? []), placed]);
    }
  });
  // A free value that names someone is that someone, in whichever of their
  // names the passage used: "father: Amos" on the sheet and "father: Amos
  // Wren" in the prose are one value once the resolver knows the alias. Put
  // to the judge as two, a fact that is none draws a finding about another.
  // A value the resolver does not know stays its words.
  function named(claim: Claim): string {
    if (claim.type !== "words") return claim.norm;
    const who = entityOf(claim.norm);
    return who === entityKey(claim.norm) ? claim.norm : who;
  }
  // Where a Section stands in the book, by the book's order (`positions`),
  // whether or not its ledger is in hand; null for one the book does not
  // list.
  function sectionAt(sourceId: string): number | null {
    const at = positions.get(sourceId);
    return at === undefined ? null : at * 1e9;
  }
  const story = storyCalendar(dates);
  // The story's own day is the calendar's and no entity's fact: the prose
  // moves from Friday the 14th to Saturday the 15th because the story did,
  // and two passages' days are never a conflict. The extractor writes that
  // day as a `day` claim of some entity of its own making ("passage day") or
  // types it `date`, so the exclusion is by what the calendar took, not by
  // type or by name.
  for (const [key, placed] of groups) {
    const kept = placed.filter((one) => !story.taken.has(one));
    if (kept.length === 0) groups.delete(key);
    else if (kept.length !== placed.length) groups.set(key, kept);
  }
  const found = [
    ...story.found,
    ...ages(groups, story.days, labelOf),
    ...travel(groups),
    ...[...groups.entries()].flatMap(([group, placed]) =>
      valueCandidates(group, placed, asides.get(group) ?? [], story.days),
    ),
    ...nameDrift(book, entityOf),
  ];
  // Ranked before the duplicates go, so a pair of values the sheet and the
  // prose disagree on is asked once, as the sheet's.
  const seen = new Set<string>();
  dateSides(index, story.days, found);
  return found
    .sort((a, b) => rank(a) - rank(b))
    .filter((one) => {
      if (suppressed.has(one.key) || seen.has(one.key)) return false;
      seen.add(one.key);
      return true;
    });
}

function dated(type: ValueType): boolean {
  return type === "day" || type === "date";
}

/**
 * The story's present year, as the writer's timeline gives it: the year of
 * every dated claim read from a field the catalogue flags `present`, when
 * they agree on one. Null with none, or with a present that spans years:
 * then no year is the present's, and a stamped value keeps its time.
 */
export function presentYear(book: readonly LedgerInBook[]): string | null {
  const years = new Set<string>();
  for (const { ledger } of book)
    for (const claim of ledger.claims) {
      if (claim.field === undefined || !dated(claim.type)) continue;
      if (!/^\d{4}/u.test(claim.norm)) continue;
      if (fieldByRef(claim.field)?.flags.has("present"))
        years.add(claim.norm.slice(0, 4));
    }
  return years.size === 1 ? [...years][0] : null;
}

/**
 * What a label is grouped by (`application/entities.ts`): its words. Not its
 * type: "dark" hair in words and "brown" hair as a colour are one fact, and
 * must be compared.
 */
export function labelKey(claim: Pick<Claim, "attribute">): string {
  return claim.attribute;
}

/**
 * What a free-text value is grouped by: its label (`labelKey`, as grouped)
 * and its norm. Two values are only ever one under one label.
 */
export function valueKey(label: string, norm: string): string {
  return [label, norm].join("|");
}

/**
 * Lower first: the calendar and ages (arithmetic), a name, the
 * fixed-spelling values and travel, the free-text ones; the sheet before a
 * conflict; then how lopsided the counts are.
 */
function rank(candidate: Candidate): number {
  const [rare, common = rare] = candidate.counts;
  const lopsided = Math.min(1, rare / Math.max(1, common)) * 4.99;
  if (candidate.kind === "calendar") return 0;
  if (candidate.kind === "years") return 5;
  if (candidate.kind === "name") return 10 + lopsided;
  if (candidate.kind === "travel") return 25;
  const free = !fixedSpelling(candidate.type);
  // Two sheets that disagree rank with a sheet against the prose: both are
  // the writer's own word against itself, the shape a slip has.
  return (
    20 + (free ? 20 : 0) + (candidate.kind === "conflict" ? 10 : 0) + lopsided
  );
}

/** A name of something of someone's ("Hollis's father", "Amos's logbook"). */
const POSSESSIVE = /['\u2019]s(?:\s|$)/u;

/**
 * One entity's many spellings as one: a single word that is part of exactly
 * one fuller name ("Marta" in "Marta Neri"), and a name the ledgers record
 * a person going by. A word shared by two fuller names (two Neri) is left
 * alone: guessing would pin one person's age on the other.
 *
 * Two rules keep a person from losing their facts to a near name:
 *
 * - The fuller names a word is looked for in are people's (and animals'),
 *   and never something of someone's. Otherwise "Amos" is a word of both
 *   "Amos Wren" and "Amos Wren's logbook" and is never made Amos Wren. A
 *   thing named after its owner, and a role said of a person, name
 *   something of the person, not the person twice.
 * - A stated name claim makes its value the entity's own name only when
 *   the same reading did not also write facts about that name as an entity
 *   of its own. "- daughter of Amos, who kept the hut for thirty-eight
 *   years" is extracted as `Hollis Wren | father | name | Amos` beside
 *   `Amos | tenure | 38 years`: the extractor that wrote both held Amos to
 *   be his own person, and a relation's name is not a nickname. A name the
 *   book gives someone in one place and uses as the entity in another
 *   ("They called her Tata" in A, "Tata, 36" in B) still makes them one,
 *   which is what the claim is for. The extractor is also told that the
 *   `name` type is for the entity's own name and a relation's is words.
 */
export function entityResolver(
  book: readonly LedgerInBook[],
  grouped: ReadonlyMap<string, string>,
): (e: string) => string {
  const canonical = (entity: string) => {
    const key = entityKey(entity);
    return grouped.get(key) ?? key;
  };
  const names = new Set<string>();
  const people = new Set<string>();
  // The names some claim writes as a name is written: from a capital. A
  // relation said of someone ("father of Marta Neri", "la madre di Lucia")
  // is written from a lower-case word, and is no full name of anyone.
  // Counted as one, it makes "Marta" ambiguous between Marta Neri and her
  // father, and her facts are never compared. A rule of the
  // spelling, not a list of words, so it holds in every language.
  const capitalised = new Set<string>();
  // Per source, the names the reading gave facts of their own (not names).
  const own = new Map<string, Set<string>>();
  for (const { ledger } of book) {
    const here = new Set<string>();
    own.set(ledger.sourceId, here);
    for (const claim of ledger.claims) {
      const name = canonical(claim.entity);
      names.add(name);
      if (/^\p{Lu}/u.test(claim.entity.trim())) capitalised.add(name);
      if (claim.kind === "person" || claim.kind === "animal") people.add(name);
      if (claim.type !== "name" && compared(claim)) here.add(name);
    }
  }
  const alias = new Map<string, string>();
  const full = [...names].filter(
    (name) =>
      name.includes(" ") &&
      people.has(name) &&
      capitalised.has(name) &&
      !POSSESSIVE.test(name),
  );
  for (const name of names) {
    if (name.includes(" ")) continue;
    const within = full.filter((one) => one.split(" ").includes(name));
    if (within.length === 1) alias.set(name, within[0]);
  }
  for (const { ledger } of book)
    for (const claim of ledger.claims)
      // Only a person or an animal goes by another name: a place's "name"
      // claim is how the book words it, which the grouping answers. And
      // only a name the book states: "they wrongly believe Marta is Lucia"
      // is a belief the ledger records as one, and a belief taken here
      // would make two people one, so Marta's stated job would conflict
      // with Lucia's. Identity is decided under the same rule as every
      // comparison: on what is stated.
      if (
        claim.type === "name" &&
        compared(claim) &&
        (claim.kind === "person" || claim.kind === "animal")
      ) {
        const said = canonical(claim.norm);
        const owner = canonical(claim.entity);
        if (
          said !== owner &&
          !alias.has(said) &&
          !full.includes(said) &&
          !own.get(ledger.sourceId)?.has(said)
        )
          alias.set(said, alias.get(owner) ?? owner);
      }
  return (entity) => {
    const name = canonical(entity);
    return alias.get(name) ?? name;
  };
}

/**
 * Give each prose side of `found` the story's day at or before it
 * (`CandidateSide.dated`), and each note too.
 */
function dateSides(
  index: ReadonlyMap<string, number>,
  days: readonly Day[],
  found: readonly Candidate[],
): void {
  if (days.length === 0) return;
  for (const candidate of found)
    for (const side of [...candidate.sides, ...(candidate.history ?? [])]) {
      const at = index.get(side.sourceId);
      if (side.origin !== "prose" || at === undefined) continue;
      const day = dayAt(days, at * 1e9 + side.at);
      if (day) side.dated = day;
    }
}

/** The story's day at reading position `order`, or null before any. */
function dayAt(days: readonly Day[], order: number): string | null {
  let day: string | null = null;
  for (const one of days) {
    if (one.order > order) break;
    day = one.date;
  }
  return day;
}

/** A run of the prose with no change in it, and what began it. */
interface Stretch {
  /** The sheet change it begins at (`Placed.starts`), or null. */
  cut: number | null;
  /** Whether a change the prose narrates began it. */
  narrated: boolean;
  items: Placed[];
}

/**
 * The conflicts and sheet disagreements within one fact. The prose is taken
 * in reading order and cut into stretches at every narrated change and
 * every Section a sheet dates a change to: two values in one
 * stretch disagree, and a value before a change never disagrees with one
 * after it. A sheet describing the story as it opens is held against the
 * first stretch; a sheet's dated change, against the prose from its
 * Section, after the change when that Section narrates it.
 *
 * A value the text sets in another time than the passage's own
 * (`Claim.when`) is not of the present and never a present value's
 * conflict: "I was forty-one" beside the 1999 avalanche, against 61 at the
 * opening in 2019, put to the judge as a conflict, is sometimes called one.
 * Such values are held only against values of the same dated time, an age
 * at a dated year is held to the present age by arithmetic (`thenAges`),
 * and every one of them is shown to the judge as a note with its time.
 */
function valueCandidates(
  group: string,
  all: Placed[],
  asides: readonly CandidateSide[] = [],
  days: readonly Day[] = [],
): Candidate[] {
  const [entity, attribute] = group.split("|");
  const scoped = all.filter((one) => one.side.when !== undefined);
  const placed = all.filter((one) => one.side.when === undefined);
  const type = all.some((one) => !fixedSpelling(one.claim.type))
    ? "words"
    : all[0].claim.type;
  const isDate = all.every((one) => dated(one.claim.type));
  mergeWordings(placed);
  const prose = placed
    .filter((one) => one.side.origin === "prose")
    .sort((a, b) => a.order - b.order);
  const sheets = placed.filter((one) => one.side.origin === "sheet");
  const cuts = [
    ...new Set(
      sheets.flatMap((one) => (one.starts === undefined ? [] : [one.starts])),
    ),
  ].sort((a, b) => a - b);
  const stretches: Stretch[] = [{ cut: null, narrated: false, items: [] }];
  let next = 0;
  for (const one of prose) {
    let current = stretches[stretches.length - 1];
    while (next < cuts.length && cuts[next] <= one.order) {
      current = { cut: cuts[next], narrated: false, items: [] };
      stretches.push(current);
      next += 1;
    }
    if (one.claim.change && current.items.length > 0) {
      current = { cut: null, narrated: true, items: [] };
      stretches.push(current);
    }
    current.items.push(one);
  }
  const counted = (norm: string) =>
    placed.filter((one) => one.value === norm).length;
  const make = (
    kind: CandidateKind,
    rare: Placed,
    common: Placed,
  ): Candidate => ({
    key: [
      entity,
      attribute,
      ...[rare, common].map((one) => one.value).sort(),
    ].join("|"),
    kind,
    entity:
      common.claim.entity.length >= rare.claim.entity.length
        ? common.claim.entity
        : rare.claim.entity,
    attribute,
    type,
    sides: [rare.side, common.side],
    counts: [counted(rare.value), counted(common.value)],
  });
  const found: Candidate[] = [];
  const notes = [
    ...sheets.map((one) => one.side),
    ...scoped.map((one) => one.side),
    ...asides,
  ];
  const noted = (candidate: Candidate): Candidate =>
    notes.length > 0 ? { ...candidate, notes } : candidate;
  for (const { items } of stretches) {
    const norms = byCount(items);
    if (norms.length < 2) continue;
    const [usual, ...others] = norms;
    for (const norm of others) {
      if (isDate && sameDate(norm, usual)) continue;
      const rare = items.find((one) => one.value === norm) as Placed;
      found.push(noted(make("conflict", rare, nearest(rare, items, usual))));
    }
  }
  for (const sheet of sheets) {
    // A change the sheet declares but dates to no Section holds from a
    // point nobody knows: it is shown to the judge (`notes`), never held.
    if (sheet.claim.change && sheet.starts === undefined) continue;
    const cut = sheet.starts ?? null;
    const at = cut === null ? 0 : stretches.findIndex((one) => one.cut === cut);
    if (at < 0) continue;
    // A dated change the prose narrates in that same Section holds from
    // the narrated moment, not from the Section's first line.
    const after = stretches[at + 1] as Stretch | undefined;
    const held =
      cut !== null && after?.narrated && after.items[0].order < cut + 1e9
        ? after
        : stretches[at];
    for (const norm of byCount(held.items))
      if (norm !== sheet.value && !(isDate && sameDate(norm, sheet.value))) {
        const prose = held.items.find((one) => one.value === norm) as Placed;
        found.push(noted(make("sheet", prose, sheet)));
      }
  }
  // The sheets against each other: two sheets that give one fact two values
  // for the same stretch (both describing the story as it opens, or both
  // dating a change to the same Section) disagree whatever the prose says,
  // so a fact no Section states still raises the disagreement. A change one
  // sheet dates to no Section holds from nowhere and is left to the judge's
  // notes.
  //
  // "The same stretch" is the same start, and that is the whole model, not
  // a shortcut for an interval one: a sheet dates where a value begins and
  // never where it ends (the next dated change ends it), so two values
  // dated to different Sections are two consecutive stretches of one fact,
  // which is the story changing it, and a value dated to a Section against
  // the opening's is the same. Only two values starting at the same place
  // claim one stretch twice. The prose between two starts is held against
  // whichever sheet value holds there, by the `sheet` candidates above.
  const bySheetStretch = new Map<string, Placed[]>();
  for (const sheet of sheets) {
    if (sheet.claim.change && sheet.starts === undefined) continue;
    const key = sheet.starts === undefined ? "opening" : String(sheet.starts);
    bySheetStretch.set(key, [...(bySheetStretch.get(key) ?? []), sheet]);
  }
  for (const items of bySheetStretch.values()) {
    const [usual, ...others] = byCount(items);
    for (const norm of others) {
      if (isDate && sameDate(norm, usual)) continue;
      const rare = items.find((one) => one.value === norm) as Placed;
      found.push(noted(make("sheets", rare, nearest(rare, items, usual))));
    }
  }
  // Two values the text sets at one dated time disagree as two present
  // values do; an undated other time is no one time, and compares nothing.
  const byWhen = new Map<string, Placed[]>();
  for (const one of scoped)
    if (YEAR_FIRST.test(one.side.when as string))
      byWhen.set(one.side.when as string, [
        ...(byWhen.get(one.side.when as string) ?? []),
        one,
      ]);
  for (const items of byWhen.values()) {
    const [usual, ...others] = byCount(items);
    for (const norm of others) {
      if (isDate && sameDate(norm, usual)) continue;
      const rare = items.find((one) => one.value === norm) as Placed;
      found.push(noted(make("conflict", rare, nearest(rare, items, usual))));
    }
  }
  found.push(...thenAges(entity, scoped, placed, days).map(noted));
  const history = historyOf(prose);
  return history.length > 0 ? found.map((one) => ({ ...one, history })) : found;
}

/** A `when` that names a year: a dated other time, not `past` or `future`. */
const YEAR_FIRST = /^\d{4}/u;

/**
 * An age the text sets at a dated year, held to an age of the present by
 * arithmetic: 61 on 8 March 2019 puts a birth between 9 March 1957
 * and 8 March 1958, so in 1999 the person was 40, 41 or 42. "I was
 * forty-one" agrees and raises nothing; "thirty" cannot be, and is raised
 * as the years with the range it could be. The present age's moment is the
 * story's day at its place; a sheet's opening value is as of the story's
 * first day, a sheet's dated change as of its Section's. With no day to
 * count from, nothing is raised.
 */
function thenAges(
  entity: string,
  scoped: readonly Placed[],
  present: readonly Placed[],
  days: readonly Day[],
): Candidate[] {
  const found: Candidate[] = [];
  for (const then of scoped) {
    const when = then.side.when as string;
    const was = amountOf(then.value);
    if (!YEAR_FIRST.test(when) || was?.unit !== "years") continue;
    for (const now of present) {
      const is = amountOf(now.value);
      if (is?.unit !== "years") continue;
      const moment =
        now.side.origin === "prose"
          ? dayAt(days, now.order)
          : now.starts === undefined
            ? (days[0]?.date ?? null)
            : dayAt(days, now.starts);
      if (!moment) continue;
      const [min, max] = ageRange(is.amount, moment, when);
      if (was.amount >= min && was.amount <= max) continue;
      found.push({
        key: [entity, "then", when, then.value, now.value].join("|"),
        kind: "years",
        entity: then.claim.entity,
        attribute: then.claim.attribute,
        type: "number",
        sides: [then.side, now.side],
        counts: [1, 1],
        expected: min === max ? String(min) : `${min}-${max}`,
        date: when,
      });
    }
  }
  return found;
}

/**
 * The ages someone `age` years old on `moment` (`YYYY-MM-DD`) could have
 * been at `when` (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`): the birth lies in
 * the year before the moment's anniversary, and `when` spans its whole
 * month or year when it names no day.
 */
function ageRange(age: number, moment: string, when: string): [number, number] {
  const [ty, tm, td] = moment.split("-").map(Number);
  const bornLatest = utc(ty - age, tm - 1, td);
  const bornEarliest = utc(ty - age - 1, tm - 1, td) + DAY_MS;
  const [wy, wm, wd] = when.split("-").map(Number);
  const from = utc(wy, (wm ?? 1) - 1, wd ?? 1);
  const to =
    wm === undefined
      ? utc(wy, 11, 31)
      : wd === undefined
        ? utc(wy, wm, 0)
        : utc(wy, wm - 1, wd);
  return [yearsBetween(bornLatest, from), yearsBetween(bornEarliest, to)];
}

/** Whole years from one UTC instant to another, never below zero. */
function yearsBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  if (
    b.getUTCMonth() < a.getUTCMonth() ||
    (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())
  )
    years -= 1;
  return Math.max(0, years);
}

/**
 * Each value the prose gives a fact, where it first gives it after another
 * value, in reading order: the fact through the book, capped.
 */
function historyOf(prose: readonly Placed[]): CandidateSide[] {
  const history: CandidateSide[] = [];
  let last: string | null = null;
  for (const one of prose) {
    if (one.value === last) continue;
    last = one.value;
    history.push({ ...one.side });
  }
  return history.slice(0, HISTORY_MAX);
}

/**
 * Free-text values that are one value in two wordings, compared as one:
 * two claims the book words alike, whatever norm each was given ("gatto"
 * normed once "cat" and once "gatto"). Each group is compared as its most
 * stated norm. A norm in a fixed spelling is left as it is: "30" and "31"
 * are never one value. Rewrites `value` in place; the sides keep the norms
 * the model wrote.
 *
 * Only the book's own wording joins two norms. Joining by word containment
 * ("villa" within "villa on the hill") cannot tell a fuller wording from its
 * opposite: "doctor" is within "not doctor", "sister" within "half sister",
 * and the contradiction would be merged away before any judge saw it.
 * Whether two wordings are one value is the value grouping's question
 * (`application/entities.ts`), asked of a model that reads them, and
 * the judge's after it.
 */
function mergeWordings(placed: readonly Placed[]): void {
  const free = placed.filter((one) => !fixedSpelling(one.claim.type));
  const parent = new Map(free.map((one) => [one.value, one.value]));
  if (parent.size < 2) return;
  const root = (norm: string): string => {
    let at = norm;
    while (parent.get(at) !== at) at = parent.get(at) as string;
    return at;
  };
  const join = (a: string, b: string) => parent.set(root(a), root(b));
  const worded = new Map<string, string>();
  for (const one of free) {
    const said = fold(one.claim.value).trim();
    const before = worded.get(said);
    if (before === undefined) worded.set(said, one.value);
    else join(one.value, before);
  }
  const counts = new Map<string, number>();
  for (const one of free)
    counts.set(one.value, (counts.get(one.value) ?? 0) + 1);
  const most = new Map<string, string>();
  for (const [norm, count] of counts) {
    const group = root(norm);
    const best = most.get(group);
    if (best === undefined || count > (counts.get(best) ?? 0))
      most.set(group, norm);
  }
  for (const one of free) one.value = most.get(root(one.value)) as string;
}

/**
 * Whether two dates can be one: equal where both say something, so "1998"
 * and "1998-03-14", or "--03-14" and "1998-03-14", are no conflict.
 */
function sameDate(a: string, b: string): boolean {
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const day = (date: string) => date.slice(-6);
  return (
    (a.startsWith("--") || b.startsWith("--")) &&
    a.length >= 6 &&
    b.length >= 6 &&
    day(a) === day(b)
  );
}

/** The distinct norms of `placed`, the most stated first. */
function byCount(placed: readonly Placed[]): string[] {
  const counts = new Map<string, number>();
  for (const one of placed)
    counts.set(one.value, (counts.get(one.value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([norm]) => norm);
}

/** The claim of `norm` nearest `to` in reading order: the context to judge. */
function nearest(to: Placed, among: readonly Placed[], norm: string): Placed {
  return among
    .filter((one) => one.value === norm)
    .reduce((best, one) =>
      Math.abs(one.order - to.order) < Math.abs(best.order - to.order)
        ? one
        : best,
    );
}

/** One day of the story, and where the reading reached it. */
interface Day {
  order: number;
  /** `YYYY-MM-DD`. */
  date: string;
}

const DAY_MS = 86_400_000;

const isoOf = (day: Date) => day.toISOString().slice(0, 10);
const weekdayOf = (day: Date) => ((day.getUTCDay() + 6) % 7) + 1;

/**
 * `Date.UTC` that keeps a year below 100 as that year: `Date.UTC` itself
 * reads 50 as 1950.
 */
function utc(y: number, m0: number, d: number): number {
  const day = new Date(0);
  day.setUTCFullYear(y, m0, d);
  return day.getTime();
}

/** A calendar day, or null when the numbers roll over ("31 February"). */
function dayOf(y: number, m: number, d: number): Date | null {
  const day = new Date(utc(y, m - 1, d));
  return day.getUTCMonth() === m - 1 && day.getUTCDate() === d ? day : null;
}

/**
 * The Gregorian calendar's first day, and the first day Britain counted by
 * it. Before the first, a date is Julian; between the two, either calendar
 * may be the book's, so a weekday either gives is no slip.
 */
const GREGORIAN_FROM = utc(1582, 9, 15);
const GREGORIAN_EVERYWHERE = utc(1752, 8, 14);

/** The weekday (1 Monday) of `day`'s year, month and day read as Julian. */
function julianWeekday(day: Date): number {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth() + 1;
  const a = Math.floor((14 - m) / 12);
  const year = y + 4800 - a;
  const month = m + 12 * a - 3;
  const julianDay =
    day.getUTCDate() +
    Math.floor((153 * month + 2) / 5) +
    365 * year +
    Math.floor(year / 4) -
    32083;
  return (((julianDay % 7) + 7) % 7) + 1;
}

/**
 * The weekday `day` falls on as its time counted: the Julian one before
 * the Gregorian calendar began, the Gregorian one after.
 */
const weekdayAsCounted = (day: Date) =>
  day.getTime() < GREGORIAN_FROM ? julianWeekday(day) : weekdayOf(day);

/** Whether `weekday` is one a calendar of `day`'s time gives it. */
const weekdayFits = (day: Date, weekday: number) =>
  weekdayOf(day) === weekday ||
  (day.getTime() < GREGORIAN_EVERYWHERE && julianWeekday(day) === weekday);

/**
 * `today` moved by `offset`, or to the next `weekday` when there is none.
 * A month or a year later keeps the day of the month, or the month's last
 * when it has fewer ("a month after 31 January" is 28 or 29 February).
 */
function shifted(
  today: Date,
  offset: DateOffset | null,
  weekday: number | null,
): Date {
  if (!offset)
    return new Date(
      today.getTime() +
        DAY_MS * (((weekday as number) - weekdayAsCounted(today) + 7) % 7 || 7),
    );
  if (offset.unit === "d" || offset.unit === "w")
    return new Date(
      today.getTime() + DAY_MS * offset.amount * (offset.unit === "w" ? 7 : 1),
    );
  const month =
    today.getUTCMonth() + offset.amount * (offset.unit === "y" ? 12 : 1);
  const last = new Date(utc(today.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(
    utc(today.getUTCFullYear(), month, Math.min(today.getUTCDate(), last)),
  );
}

/**
 * The story's calendar, in reading order, and every weekday it gets wrong.
 * A full date sets the day; a date without a year takes the last day's
 * year; a relative one ("+3d", "-1d", "+2w", "+1m", "next mon") is
 * counted from the last day. A month or a year later names
 * no day, so after one the calendar checks no weekday until a date names
 * its day again. Only a `day` moves the story's day: a `date` (a birth, a
 * letter) is backstory, and a sheet, which stands outside story time, is
 * checked against the last day but never moves it.
 */
function storyCalendar(dates: readonly Placed[]): {
  days: Day[];
  found: Candidate[];
  /** The claims the story's day was read from: the calendar's, no fact. */
  taken: Set<Placed>;
} {
  const days: Day[] = [];
  const found: Candidate[] = [];
  const taken = new Set<Placed>();
  let today: Date | null = null;
  // Whether `today` is a day the book named, not one a month off reckoned.
  let exact = false;
  for (const one of [...dates].sort((a, b) => a.order - b.order)) {
    const norm = one.side.norm;
    const full = /^(\d{4})-(\d{2})-(\d{2})/u.exec(norm);
    const partial = /^--(\d{2})-(\d{2})/u.exec(norm);
    const relative = relativeDate(norm);
    let day: Date | null = null;
    // Whether this date names its day: a relative one only when counted
    // in days or weeks from a day that did.
    let named = true;
    if (full) day = dayOf(Number(full[1]), Number(full[2]), Number(full[3]));
    else if (partial && today)
      day = dayOf(
        today.getUTCFullYear(),
        Number(partial[1]),
        Number(partial[2]),
      );
    else if (relative && today) {
      day = shifted(today, relative.offset, relative.weekday);
      named =
        exact &&
        (relative.offset === null ||
          relative.offset.unit === "d" ||
          relative.offset.unit === "w");
    }
    if (!day) continue;
    // "next mon" is a Monday by construction: nothing to check.
    const stated = !named
      ? null
      : relative
        ? relative.offset === null
          ? null
          : relative.weekday
        : statedWeekday(norm);
    if (stated !== null && !weekdayFits(day, stated))
      found.push({
        key: ["calendar", isoOf(day), WEEKDAYS[stated - 1]].join("|"),
        kind: "calendar",
        entity: one.claim.entity,
        attribute: one.claim.attribute,
        type: one.claim.type,
        sides: [one.side],
        counts: [1],
        expected: WEEKDAYS[weekdayAsCounted(day) - 1],
        date: isoOf(day),
      });
    // Only a `day` moves the story's day, except that the calendar has to
    // start somewhere. A full date of the prose that names its weekday and
    // is of the passage's own time ("Friday 8 March 2019") is the passage's
    // day whatever the model typed it as; a birth or a letter names no
    // weekday. It seeds the calendar while no day has, so an opening typed
    // `date` still lets a later "Monday 11 March" take a year and have its
    // weekday checked.
    if (
      one.side.origin === "prose" &&
      (one.claim.type === "day" ||
        (today === null &&
          full !== null &&
          stated !== null &&
          one.side.when === undefined))
    ) {
      today = day;
      exact = named;
      days.push({ order: one.order, date: isoOf(day) });
      taken.add(one);
    }
  }
  return { days, found, taken };
}

/**
 * A number of years a date and the story's day say cannot be: born
 * in March 2020 and "four" in September 2023. Any number of years the
 * ledgers count from a date of the same entity (`Claim.since`) is held to
 * it, an age to a birth or a marriage's years to a wedding. A date
 * without a day allows either side of its anniversary. The date may be the
 * prose's or a sheet's.
 */
function ages(
  groups: ReadonlyMap<string, Placed[]>,
  days: readonly Day[],
  labelOf: (claim: Pick<Claim, "attribute">) => string,
): Candidate[] {
  const found: Candidate[] = [];
  for (const [group, placed] of groups) {
    const entity = group.split("|")[0];
    for (const age of placed) {
      const years = amountOf(age.value);
      const since = age.claim.since;
      if (!since || years?.unit !== "years" || age.side.origin !== "prose")
        continue;
      const from = groups.get(
        [entity, labelOf({ attribute: since })].join("|"),
      );
      const birth = from?.find((one) => /^\d{4}/u.test(one.value));
      const day = dayAt(days, age.order);
      if (!birth || !day) continue;
      const [y, m, d] = birth.value.split("-").map(Number);
      const [ty, tm, td] = day.split("-").map(Number);
      const whole = ty - y;
      const possible =
        m === undefined || (tm === m && d === undefined)
          ? [whole - 1, whole]
          : tm < m || (tm === m && td < (d as number))
            ? [whole - 1]
            : [whole];
      if (possible.includes(years.amount)) continue;
      found.push({
        key: [entity, "since", since, age.value, birth.value].join("|"),
        kind: "years",
        entity: age.claim.entity,
        attribute: age.claim.attribute,
        type: "number",
        sides: [age.side, birth.side],
        counts: [1, 1],
        expected: possible.filter((one) => one >= 0).join("-"),
      });
    }
  }
  return found;
}

/**
 * A length and a time for one place (a road, a pass, a crossing) that no
 * one covers at a walk or a drive: slower than 1.5 km/h or faster
 * than 150. Read from the units alone, never from a label: a place's metres
 * against its seconds, in one Section and within a page of each other,
 * since a tower's height in chapter one and its bell's ringing in chapter
 * nine make a journey no one took. A person is left out, whose
 * height and whose day are no journey, and so is a thing: a thing's metres
 * are its measure and its seconds its duration, however close they stand.
 * Nothing here can establish that a distance and a time describe one
 * movement, so the candidate is put to the judge as a hypothesis to accept
 * or refuse first (`judgeMessage`), never as a journey the book described.
 */
function travel(groups: ReadonlyMap<string, Placed[]>): Candidate[] {
  const numbers = new Map<string, Placed[]>();
  for (const [group, placed] of groups) {
    const entity = group.split("|")[0];
    for (const one of placed)
      if (one.claim.kind === "place")
        numbers.set(entity, [...(numbers.get(entity) ?? []), one]);
  }
  const found: Candidate[] = [];
  for (const [entity, placed] of numbers) {
    const inUnit = (unit: string) =>
      placed.flatMap((one) => {
        const number = amountOf(one.value);
        return one.claim.type === "number" && number?.unit === unit
          ? [{ one, amount: number.amount }]
          : [];
      });
    for (const distance of inUnit("metres"))
      for (const time of inUnit("seconds")) {
        if (
          distance.one.side.sourceId !== time.one.side.sourceId ||
          Math.abs(distance.one.side.at - time.one.side.at) > TRAVEL_NEAR
        )
          continue;
        const hours = time.amount / 3600;
        if (!(hours > 0)) continue;
        const speed = distance.amount / 1000 / hours;
        if (speed >= 1.5 && speed <= 150) continue;
        found.push({
          key: [entity, "travel", distance.one.value, time.one.value].join("|"),
          kind: "travel",
          entity: distance.one.claim.entity,
          attribute: distance.one.claim.attribute,
          type: "number",
          sides: [distance.one.side, time.one.side],
          counts: [1, 1],
          expected: String(Math.round(speed * 10) / 10),
        });
      }
  }
  return found;
}

const CAPITALISED = /\p{Lu}[\p{Ll}\p{M}]{2,}/gu;

/**
 * A capitalised word the prose writes once or twice, a letter or two from a
 * name it writes at least three times as often: "Martha" in a book of
 * "Marta". The names are the ledgers' own entities and the names they
 * record, so a word is only ever compared with someone the book is about.
 */
function nameDrift(
  book: readonly LedgerInBook[],
  entityOf: (entity: string) => string,
): Candidate[] {
  const prose = book.filter(({ ledger }) => ledger.origin === "prose");
  const names = new Map<string, string>();
  for (const { ledger } of book)
    for (const claim of ledger.claims) {
      const words = [
        claim.entity,
        ...(claim.type === "name" ? [claim.value] : []),
      ].flatMap((said) => said.match(CAPITALISED) ?? []);
      for (const word of words)
        if (!names.has(fold(word))) names.set(fold(word), claim.entity);
    }
  const words = new Map<
    string,
    { count: number; word: string; sourceId: string; at: number }
  >();
  for (const { ledger, text } of prose)
    for (const match of text.matchAll(CAPITALISED)) {
      const key = fold(match[0]);
      const known = words.get(key);
      if (known) known.count += 1;
      else
        words.set(key, {
          count: 1,
          word: match[0],
          sourceId: ledger.sourceId,
          at: match.index,
        });
    }
  // The common spelling is counted across the whole book, sheets included:
  // a character sheet is the writer's most considered spelling of a name,
  // and a book that writes a name three times in the prose has only two
  // left once one of them slips. The rare side stays a word of
  // the prose, since a sheet line is never a name's witness, and the places
  // the judge reads stay the prose's.
  const counts = new Map<string, number>();
  const countOf = (name: string) => {
    if (!counts.has(name))
      counts.set(
        name,
        book.reduce(
          (sum, { text }) =>
            sum + findTerms(text, [name], { wholeWord: true }).length,
          0,
        ),
      );
    return counts.get(name) ?? 0;
  };
  const found: Candidate[] = [];
  for (const [key, rare] of words) {
    // A rare word is compared whether or not the ledgers made an entity of
    // it: the extractor writes what the book says, so "Gaicomo" becomes a
    // person of his own, and a rule that skipped every ledger name would
    // never ask whether he is Giacomo.
    if (rare.count > 2 || key.length < 4) continue;
    for (const [name, entity] of names) {
      const allowed = name.length >= 7 ? 2 : 1;
      const distance = editDistance(key, name);
      if (distance === 0 || distance > allowed) continue;
      const common = countOf(name);
      if (common < 3 || common < rare.count * 3) continue;
      const first = firstPlace(prose, name);
      if (!first) continue;
      found.push({
        key: [entityOf(entity), "name", "", ...[key, name].sort()].join("|"),
        kind: "name",
        entity,
        attribute: "name",
        type: "name",
        sides: [
          {
            sourceId: rare.sourceId,
            origin: "prose",
            at: rare.at,
            quote: rare.word,
            value: rare.word,
            norm: key,
          },
          first,
        ],
        counts: [rare.count, common],
      });
    }
  }
  return found;
}

/** Where the prose first writes `name`, as a side. */
function firstPlace(
  prose: readonly LedgerInBook[],
  name: string,
): CandidateSide | null {
  for (const { ledger, text } of prose) {
    const [match] = findTerms(text, [name], { wholeWord: true });
    if (match) {
      const word = text.slice(match.start, match.end);
      return {
        sourceId: ledger.sourceId,
        origin: "prose",
        at: match.start,
        quote: word,
        value: word,
        norm: name,
      };
    }
  }
  return null;
}
