// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A ledger: the facts a Section states, as a model read them, kept under the
// Section's revision.
//
// A continuity slip is one fact stated two ways: Marta's eyes grey here and
// green there, the station two kilometres off and then three hundred metres.
// Hand-written patterns per attribute and per language miss every slip they
// lack a pattern for. So a model reads each Section
// once and writes down every fact it states, in a fixed shape; plain code
// then compares the facts (the candidates), and a small prompt judges each
// one it finds.
//
// The shape is what makes the comparison plain code. Every claim names who
// (`entity`), what about them (`attribute`, a few free English words the
// model chooses: "hair colour", "job", "mother"), and the value twice: as the
// book words it (`value`) and in one canonical spelling (`norm`) for its type
// (a number with its unit, an ISO date, a 24-hour time, one of eleven colour
// words, yes or no, or lower-case English words), so "trentaquattro anni" and
// "thirty-four" compare as "34 years" in any language the book is written in.
// A norm that is not in its type's spelling is not believed: the claim is
// dropped rather than compared wrong.
//
// No kind of fact is named here. What code needs to know is how to
// compare a value, its type, never what the value is about. Two labels for
// one kind of fact ("hair colour", "colour of her hair") are grouped by one
// question over the labels (`application/entities.ts`).
//
// Every claim carries the book's own words (`quote`), which must be found in
// the text it was read from, or the claim is dropped: a fact the model cannot
// point at is a fact it may have made up, and the judge that follows shows
// the writer both quotes side by side.

import { CATALOGUE_REVISION } from "./referenceCatalogue";
import type { Interpretation } from "./referenceRecords";
import { locate } from "./textMatch";

/**
 * How a value is spelt, and so how two are compared. `day` is the day a
 * passage takes place on, the story's own calendar; `date` is the date of
 * anything else (a birth, a letter). `name` is a name the entity itself
 * goes by. `words` is everything else.
 */
export const VALUE_TYPES = [
  "name",
  "number",
  "day",
  "date",
  "time",
  "colour",
  "yes-no",
  "words",
] as const;

export type ValueType = (typeof VALUE_TYPES)[number];

/**
 * What an entity is. A person or an animal is resolved by the names the book
 * gives it; a place or a thing, which has no such name, is grouped by one
 * question over the names alone (`application/entities.ts`), and only
 * a place or a thing ever is: names alone cannot tell two people apart.
 */
export const ENTITY_KINDS = ["person", "animal", "place", "thing"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * How the text holds the fact. `stated`: the text presents it as so, and it
 * is what the candidates compare. `believed`: what a character or the
 * world's people believe, remember, guess, lie about or hear as rumour, such
 * as a myth's account or an unreliable narrator's. `planned`: a sheet's plan
 * or a change still to write.
 * `open`: a sheet's question, an alternative still being weighed, a
 * research note. The three that are not `stated` are never held against
 * anything; they are shown to the judge beside a candidate about the same
 * fact, so "the people believe the river is holy" cannot be flattened into
 * "the river is holy", and a planned arc is not held against the stage the
 * book is at.
 */
export const CLAIM_STATUSES = [
  "stated",
  "believed",
  "planned",
  "open",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** The eleven basic colour words every language names (Berlin and Kay). */
export const COLOURS = [
  "black",
  "white",
  "red",
  "green",
  "yellow",
  "blue",
  "brown",
  "purple",
  "pink",
  "orange",
  "grey",
] as const;

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** How long each written field may be, so a runaway answer stays small. */
export const CLAIM_LIMITS = {
  entity: 80,
  attribute: 40,
  value: 120,
  norm: 80,
  quote: 300,
  /** The most claims one extraction may add, per chunk of text. */
  perChunk: 80,
} as const;

export interface Claim {
  /** Who or what the fact is about, by the fullest name the book gives. */
  entity: string;
  kind: EntityKind;
  status: ClaimStatus;
  /** What the fact is about, in a few lower-case English words. */
  attribute: string;
  type: ValueType;
  /** The value as the book words it. */
  value: string;
  /** The value in its type's canonical spelling (`normOf`). */
  norm: string;
  /** The book's own words stating it, found at `at`. */
  quote: string;
  /** Where `quote` starts in the text the claim was read from. */
  at: number;
  /**
   * The story narrates the value changing here (she dyes her hair, he turns
   * forty, they move), so later claims may differ from earlier ones without
   * a slip. Story time is this flag and reading order, nothing more.
   */
  change: boolean;
  /**
   * For a number of years that counts from a date of the same entity (an
   * age counts from a birth), that date's `attribute`: the calendar then
   * says what the number must be (`candidates`).
   */
  since?: string;
  /**
   * On a sheet, the Section a declared change takes effect in ("dyes her
   * hair red in chapter five"), by its source id: the sheet's value holds
   * from there on, and the prose's values before it and after it are two
   * stretches of story, never a conflict. Absent everywhere else.
   */
  from?: string;
  /**
   * The time the value holds at, when the text sets it in another time
   * than the passage's own (a memory, a backstory, an age at an earlier
   * year, a future): a date norm (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) when the
   * text gives one, else `past` or `future`. Absent when the value is of
   * the passage's own time, whatever tense the book narrates in. A value
   * of another time is never held against the present as a conflict: an
   * age at a dated year is checked by arithmetic against the present age
   * and the story's day, and an undated one is shown to the judge beside
   * the fact. A past-tense age is otherwise the commonest false positive.
   */
  when?: string;
  /**
   * On a sheet the catalogue knows, the field the quote sits in, as
   * `fieldRef` spells it ("character/age"). The claim is placed by the
   * answer line it was read from, never by its words, so a finding that
   * cites it names the field the writer filled.
   */
  field?: string;
  /**
   * Read from what the catalogue could not place: a renamed field, prose
   * under no field, a notes file. Kept, and shown to the judge as
   * context; never a side of a candidate, whatever its status, because a
   * line the app cannot place is no established fact to hold the prose to.
   */
  unclassified?: true;
}

/** A source's facts, and what they were read from. */
export interface SectionLedger {
  sourceId: string;
  /** The source's revision when it was read (`SourceText.revision`). */
  contentHash: string;
  /** Which extraction wrote it (`LEDGER_RECIPE_REVISION`). */
  recipeRevision: string;
  /** The model that read it, `provider/model`, for the record. */
  model: string;
  /** Prose from the manuscript, or a reference sheet's answers. */
  origin: "prose" | "sheet";
  /**
   * On a sheet, the book's Section list the sheet was read against
   * (`sectionsFingerprint`): a change the sheet dates to "chapter two" is
   * bound to the second Section of this list, and the binding is only as
   * good as the list. A reordered, renamed or inserted Section makes the
   * stored `from` point at the wrong place with the sheet's own text
   * unchanged, so the fingerprint is part of what makes a sheet's ledger
   * fresh. Absent on the prose, which is its own time.
   */
  sections?: string;
  /**
   * On the prose, the story's present it was told, in the writer's words:
   * a value of that time takes no `when`, so a ledger read
   * against one present is read again when the timeline names another.
   * Absent when it was told none.
   */
  present?: string;
  /**
   * On a sheet, how much of it the catalogue could read: every
   * record placed, some, or none. Reported with the check, so a sheet read
   * as raw text is never taken for one read field by field.
   */
  interpretation?: Interpretation;
  claims: Claim[];
  /**
   * How many claims the model wrote that were not believed (a norm out of
   * its spelling, a quote not in the text). Kept for diagnosis: a Section
   * with few claims and many dropped is one the model misquoted, not one
   * that states little.
   */
  dropped: number;
}

/**
 * Bumped when the extraction's prompt or the claim shape changes. A ledger
 * written under another revision is read again, which is what makes a
 * stored ledger safe to reuse without asking what wrote it.
 *
 * The extraction's rules that keep a slip comparable: a label never holds
 * its value, since "right hand scar: yes" and "left hand scar: yes" can both
 * be true; an event is named by what happened, never by its date, or two
 * dates for one event become two events; an event's own date is labelled
 * "date" at any precision, since the label grouping will not join a "year"
 * with a "date"; and each passage is told the story's present (`present`).
 */
export const LEDGER_RECIPE_REVISION = "17";

/**
 * The recipe a ledger of `origin` is written under. A sheet's also names the
 * catalogue it was read by: changing a field's role changes which of
 * its answers the reader is shown, so every sheet is read again, and no
 * prose is, because the prose is read the same whatever the catalogue says.
 */
export function ledgerRecipe(origin: SectionLedger["origin"]): string {
  return origin === "sheet"
    ? `${LEDGER_RECIPE_REVISION}.${CATALOGUE_REVISION}`
    : LEDGER_RECIPE_REVISION;
}

const INTERPRETATIONS: readonly Interpretation[] = ["full", "partial", "raw"];

/**
 * The book's Section list as a sheet's ledger depends on it: each Section's
 * id and title, in order. The title is in it because the model resolves
 * "chapter two" against the titles it is shown, and a renamed Section can
 * change which one that is even with the order kept.
 */
export function sectionsFingerprint(
  sections: readonly { id: string; title: string }[],
): string {
  return sections.map((one) => `${one.id}\t${one.title}`).join("\n");
}

const DATE =
  /^(?:(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?|--(\d{2})-(\d{2}))(?: (mon|tue|wed|thu|fri|sat|sun))?$/u;

/**
 * A day the text gives relative to the last one it stated:
 * "+3d" three days later, "+0d" the same day, "-1d" the day before, "+2w"
 * two weeks, "+1m" a month, "+10y" ten years later; "next mon" the
 * following Monday; a weekday after the offset when the text names one.
 * The calendar (`candidates`) chains them from the last full date.
 */
const RELATIVE =
  /^(?:([+-]\d{1,4})([dwmy])(?: (mon|tue|wed|thu|fri|sat|sun))?|next (mon|tue|wed|thu|fri|sat|sun))$/u;

/** How far a relative date moves, in one unit. */
export interface DateOffset {
  amount: number;
  unit: "d" | "w" | "m" | "y";
}

/**
 * A relative date norm's offset and weekday, or null when it is none. The
 * offset is null for "next mon", which moves to a weekday instead.
 */
export function relativeDate(
  norm: string,
): { offset: DateOffset | null; weekday: number | null } | null {
  const parts = RELATIVE.exec(norm);
  if (!parts) return null;
  const day = parts[3] ?? parts[4];
  return {
    offset:
      parts[1] === undefined
        ? null
        : { amount: Number(parts[1]), unit: parts[2] as DateOffset["unit"] },
    weekday:
      day === undefined
        ? null
        : WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]) + 1,
  };
}

const NUMBER = /^(\d+(?:\.\d+)?)(?: ([a-z]+))?$/u;

/**
 * A claim's `when` as written, in its one spelling: `past`, `future`, or a
 * date norm less any weekday; undefined for the passage's own time ("",
 * "present", "now") and for anything else the model wrote, which is no
 * time the app can place: a value it cannot scope is compared as of the
 * passage.
 */
export function whenOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const said = value.trim().toLowerCase();
  if (said === "" || said === "present" || said === "now") return undefined;
  if (said === "past" || said === "future") return said;
  return normOf("date", said)?.replace(/ [a-z]{3}$/u, "");
}

/**
 * A number norm's amount and unit ("" for a plain count), or null when the
 * norm is no number.
 */
export function amountOf(
  norm: string,
): { amount: number; unit: string } | null {
  const parts = NUMBER.exec(norm);
  return parts ? { amount: Number(parts[1]), unit: parts[2] ?? "" } : null;
}

/**
 * A decimal's one spelling, from its digits: no leading zero but the units',
 * no trailing zero after the point, and never an exponent, which `String`
 * of a number writes below 1e-6 and from 1e21 up and `NUMBER` cannot read.
 */
function plainDecimal(digits: string): string {
  const [whole, fraction = ""] = digits.split(".");
  const units = whole.replace(/^0+(?=\d)/u, "");
  const decimals = fraction.replace(/0+$/u, "");
  return decimals ? `${units}.${decimals}` : units;
}

/**
 * `raw` in `type`'s canonical spelling, or null when it is not one.
 * Lenient about spacing and case, strict about the form, because this is the
 * one test of whether two claims can be compared by equality at all.
 */
export function normOf(type: ValueType, raw: string): string | null {
  const said = raw.trim().replace(/\s+/gu, " ").toLowerCase();
  if (said === "" || said.length > CLAIM_LIMITS.norm) return null;
  switch (type) {
    case "number": {
      const parts = NUMBER.exec(said);
      if (!parts) return null;
      return [plainDecimal(parts[1]), parts[2]].filter(Boolean).join(" ");
    }
    case "day":
    case "date": {
      // Only the story's own day is ever given relative to the last one.
      if (type === "day" && RELATIVE.test(said)) return said;
      const parts = DATE.exec(said);
      if (!parts) return null;
      const month = parts[2] ?? parts[4];
      const day = parts[3] ?? parts[5];
      if (month !== undefined && (Number(month) < 1 || Number(month) > 12))
        return null;
      if (day !== undefined && (Number(day) < 1 || Number(day) > 31))
        return null;
      return said;
    }
    case "time": {
      const parts = /^(\d{2}):(\d{2})$/u.exec(said);
      return parts && Number(parts[1]) < 24 && Number(parts[2]) < 60
        ? said
        : null;
    }
    case "colour":
      return (COLOURS as readonly string[]).includes(said) ? said : null;
    case "yes-no":
      return said === "yes" || said === "no" ? said : null;
    default:
      return said;
  }
}

/**
 * Whether a type's norms are one fixed spelling (a number, a date, a
 * colour word), so two different norms are two different values. A
 * free-text norm ("the old villa", "baker") is a model's wording, and two
 * of them may say one thing in other words (`candidates` merges those, and
 * ranks what is left after every fixed one).
 */
export function fixedSpelling(type: ValueType): boolean {
  return type !== "words" && type !== "name";
}

/** The ISO weekday a date norm states, 1 (Monday) to 7, or null. */
export function statedWeekday(norm: string): number | null {
  const day = DATE.exec(norm)?.[6];
  return day ? WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]) + 1 : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/gu, " ").trim().slice(0, max)
    : "";
}

/**
 * A label as written: lower-case, and never holding "|", which joins a
 * label to its type and value in every key built on it (`candidates`).
 */
function label(value: unknown): string {
  return text(value, CLAIM_LIMITS.attribute)
    .toLowerCase()
    .replace(/\|/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * A claim as the model wrote it, checked against the text it was read from:
 * its type one of the list, its norm in the type's spelling, its quote
 * found in `source`. `offset` is where `source` starts in the whole text.
 * Null when any of it fails. `sections` are the book's Section ids in
 * order, given only when a sheet is read: a declared change's `section`
 * number (1 for the first) becomes its `from`.
 */
export function claimOf(
  value: unknown,
  source: string,
  offset = 0,
  sections: readonly string[] = [],
): Claim | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const type = raw.type as ValueType;
  if (!VALUE_TYPES.includes(type)) return null;
  const entity = text(raw.entity, CLAIM_LIMITS.entity);
  const kind = raw.kind as EntityKind;
  if (!ENTITY_KINDS.includes(kind)) return null;
  const status = raw.status as ClaimStatus;
  if (!CLAIM_STATUSES.includes(status)) return null;
  const attribute = label(raw.attribute);
  const said = text(raw.value, CLAIM_LIMITS.value);
  const norm = typeof raw.norm === "string" ? normOf(type, raw.norm) : null;
  // The quote is matched as written, not trimmed to a cap: a quote cut short
  // is still found, and would then point at less than the model meant.
  const quote = typeof raw.quote === "string" ? raw.quote.trim() : "";
  if (!entity || !attribute || !said || norm === null) return null;
  // A value that only repeats its label ("mother / mother") says nothing,
  // and would read as a conflict with the one that does.
  if (norm === attribute) return null;
  if (quote.length < 3 || quote.length > CLAIM_LIMITS.quote) return null;
  const found = locate(source, quote);
  if (!found) return null;
  const from =
    raw.change === true && typeof raw.section === "number"
      ? sections[raw.section - 1]
      : undefined;
  const since = type === "number" ? label(raw.since) : "";
  const stamped = whenOf(raw.when);
  // A date stamped with its own year is the date said twice, not a value of
  // another time. Scoped away, a timeline's "1904, when 1904" would never be
  // held to the prose's 1906.
  const when =
    stamped !== undefined &&
    (type === "date" || type === "day") &&
    norm.slice(0, 4) === stamped.slice(0, 4)
      ? undefined
      : stamped;
  return {
    entity,
    kind,
    status,
    attribute,
    type,
    value: said,
    norm,
    // The book's own words, as they stand there, not as the model copied
    // them: what the writer is shown is what they wrote.
    quote: source.slice(found.start, found.end),
    at: offset + found.start,
    change: raw.change === true,
    ...(since ? { since } : {}),
    ...(from === undefined ? {} : { from }),
    ...(when === undefined ? {} : { when }),
  };
}

/**
 * A stored ledger, or null when it is not one. Every claim is checked for
 * shape again (its type, its norm's spelling), never against the text,
 * which the ledger's hash already vouches for.
 */
export function ledgerOf(value: unknown): SectionLedger | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.sourceId !== "string" ||
    typeof raw.contentHash !== "string" ||
    typeof raw.recipeRevision !== "string" ||
    typeof raw.model !== "string" ||
    (raw.origin !== "prose" && raw.origin !== "sheet") ||
    (raw.sections !== undefined && typeof raw.sections !== "string") ||
    (raw.present !== undefined && typeof raw.present !== "string") ||
    (raw.interpretation !== undefined &&
      !INTERPRETATIONS.includes(raw.interpretation as Interpretation)) ||
    !Array.isArray(raw.claims) ||
    typeof raw.dropped !== "number"
  )
    return null;
  const claims: Claim[] = [];
  for (const one of raw.claims as unknown[]) {
    if (!one || typeof one !== "object") return null;
    const claim = one as Record<string, unknown>;
    const type = claim.type as ValueType;
    if (
      !VALUE_TYPES.includes(type) ||
      typeof claim.entity !== "string" ||
      !ENTITY_KINDS.includes(claim.kind as EntityKind) ||
      !CLAIM_STATUSES.includes(claim.status as ClaimStatus) ||
      typeof claim.attribute !== "string" ||
      typeof claim.value !== "string" ||
      typeof claim.norm !== "string" ||
      normOf(type, claim.norm) !== claim.norm ||
      typeof claim.quote !== "string" ||
      typeof claim.at !== "number" ||
      typeof claim.change !== "boolean" ||
      (claim.since !== undefined && typeof claim.since !== "string") ||
      (claim.from !== undefined && typeof claim.from !== "string") ||
      (claim.when !== undefined && whenOf(claim.when) !== claim.when) ||
      (claim.field !== undefined && typeof claim.field !== "string") ||
      (claim.unclassified !== undefined && claim.unclassified !== true)
    )
      return null;
    claims.push({
      entity: claim.entity,
      kind: claim.kind as EntityKind,
      status: claim.status as ClaimStatus,
      attribute: claim.attribute,
      type,
      value: claim.value,
      norm: claim.norm,
      quote: claim.quote,
      at: claim.at,
      change: claim.change,
      ...(claim.since === undefined ? {} : { since: claim.since as string }),
      ...(claim.from === undefined ? {} : { from: claim.from as string }),
      ...(claim.when === undefined ? {} : { when: claim.when as string }),
      ...(claim.field === undefined ? {} : { field: claim.field as string }),
      ...(claim.unclassified ? { unclassified: true as const } : {}),
    });
  }
  return {
    sourceId: raw.sourceId,
    contentHash: raw.contentHash,
    recipeRevision: raw.recipeRevision,
    model: raw.model,
    origin: raw.origin,
    ...(raw.sections === undefined ? {} : { sections: raw.sections }),
    ...(raw.present === undefined ? {} : { present: raw.present }),
    ...(raw.interpretation === undefined
      ? {}
      : { interpretation: raw.interpretation as Interpretation }),
    claims,
    dropped: raw.dropped,
  };
}
