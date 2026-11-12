// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Reads the book's facts into ledgers, once per revision: the extraction
// half of the fact check (`domain/ledger.ts` defines a ledger). Each Section
// is read by the model once, in chunks its answer fits, and the result is
// kept beside the chats (`Artifacts.writeLedger`) under the Section's
// revision. The next check reads only the Sections that changed.
//
// A reference sheet is read by the same extractor, so a sheet that disagrees
// with the prose is found by the same comparison as two chapters that
// disagree. The sheet is parsed into records (`domain/referenceRecords.ts`),
// and the reader is shown only the records a fact may be read from, each
// under a line naming its field and how to read it
// (`domain/referenceExtraction.ts`). A guidebook's open questions and
// a character's fears are never read for facts, a plan's claims are planned
// whatever the reader calls them, and what the catalogue cannot place is
// read as context only. Each answer line is mapped back to its place in the
// text as read, so a quote is the file's words, its evidence opens on the
// sheet, and it names the field it sits in.
//
// Names are passed in from the writer's sheets (`knownNames`), because a
// chunk alone cannot know who "she" is: the model is told to resolve a
// pronoun to a name or leave the fact out.

import {
  CLAIM_LIMITS,
  CLAIM_STATUSES,
  ENTITY_KINDS,
  VALUE_TYPES,
  claimOf,
  ledgerRecipe,
  sectionsFingerprint,
  type Claim,
  type SectionLedger,
} from "../domain/ledger";
import { STANDARD, samplingFields } from "../domain/mode";
import { fieldRef, pageOf } from "../domain/referenceCatalogue";
import {
  extractableRecords,
  extractionChunks,
  placeInFile,
  statusWithin,
  type ExtractionChunk,
} from "../domain/referenceExtraction";
import {
  parseReference,
  type ParsedReference,
  type ReferenceRecord,
} from "../domain/referenceRecords";
import { guidanceItems } from "../domain/referenceRender";
import { EDITING_BRIEF } from "../domain/skills";
import type {
  KnownName,
  ModelDescriptor,
  ModelRef,
  RunUsage,
  SourceDescriptor,
} from "../domain/types";
import type { Artifacts, ModelProvider, ProjectSources } from "../ports";
import { LEDGER_OUTPUT_TOKENS, inputCharactersFor, limitsFor } from "./budgets";
import type { Guidance } from "./judge";
import { mergeUsage, stoppedIf, throwIfCancelled } from "./runStep";
import {
  structuredAnswer,
  type StructuredAnswerShape,
} from "./structuredAnswer";

/**
 * The most characters one extraction reads, well under any window. What
 * bounds a chunk is the answer: a dense page states sixty facts at about
 * sixty tokens each, and a model asked for everything in a long text writes
 * down the first half of it.
 */
export const LEDGER_CHUNK_CHARACTERS = 6_000;

/**
 * The shortest piece an answer cut off by the output limit is split into
 * again. A chunk that states more facts than the answer has room for comes
 * back as cut JSON, and without the split the whole Section is lost.
 */
const LEDGER_CHUNK_FLOOR = 1_500;

/** How many times each text is read; the facts of every reading are kept. */
export const LEDGER_READS = 2;

/** The mechanics of the answer: what a claim is, field by field. */
export const LEDGER_INSTRUCTIONS = `You read one passage of a novel, or one of the writer's reference sheets, and write down every fact it states about its people, places and things: the facts a careful reader would notice if the book later said otherwise.

For each fact:
- entity: who or what it is about. A person or an animal by the fullest name the text gives them; when the text says he, she, they or a role ("the old man"), use the name it means, and if you cannot tell who, leave the fact out. A thing or a place by a short lower-case English name that stays the same however the text words it ("the school gate"), with its owner when it has one, and never with the value you are noting in its name ("the gate", never "the green gate"). An event is named by what happened, never by when: "the flood", never "the flood of 1906" or "the 1906 flood", whichever fact of it you note.
- kind: what the entity is: person, animal, place or thing.
- status: how the text holds the fact. stated when the text presents it as so. believed when it is what a character or the world's people believe, remember, guess, lie about or hear as rumour, and the text does not vouch for it. planned when a reference sheet records it as a plan or a change still to write ("maybe she becomes a teacher"). open when a sheet records it as a question the writer asks themselves, an alternative still being weighed, or a research note.
- attribute: what the fact is about, in a few lower-case English words, written the same way every time the book states that kind of fact ("hair colour", "job", "mother", "home", "birth"). Specific enough that two values of it cannot both be true at once. It names the kind of fact, never its answer: nothing of the value goes in it. "scar location" with the value "right hand", never "right hand scar" with the value "yes"; "eye colour" with "grey", never "grey eyes" with "yes". An event's own date is labelled "date", whether the text gives its day, its month or only its year: "date" with "1906", never "year".
- type: how the value is written: name (a name or nickname the entity ITSELF goes by — never another's name in relation to it: a father's, a friend's, an author's name is words, under the relation as the attribute), number, day (the day this passage takes place on), date (the date of anything else: a birth, a letter), time, colour, yes-no, or words (anything else).
- value: the value in the text's own words.
- norm: the value in one fixed spelling, in English, by its type. number: the number in digits and its unit, in metres for a length, seconds for a length of time, kilograms for a weight, years for an age or a number of years ("34 years", "2000 metres", "5400 seconds"), or the number alone for a count ("3"). day and date: YYYY-MM-DD, YYYY-MM or YYYY, or --MM-DD when no year is given, then a space and the weekday (mon, tue, wed, thu, fri, sat, sun) only when the text names it. A day given only relative to the story's last one as an offset: +Nd, +Nw, +Nm or +Ny for N days, weeks, months or years later ("the next day" +1d, "three days later" +3d, "that same evening" +0d, "a month later" +1m), -Nd and so on for earlier ("the day before" -1d), with the weekday when the text names one; or as next mon…next sun ("the following Monday"). time: HH:MM, 24-hour. colour: one of black, white, red, green, yellow, blue, brown, purple, pink, orange, grey. yes-no: yes or no. name and words: a few lower-case English words, translated into English when the book is written in another language, and the same words every time the book states the same value.
- since: for a number of years that counts from a date of the same entity (an age counts from a birth), that date's attribute; otherwise empty.
- when: the time the value holds at, when the text sets it in another time than the passage's own — a memory, a backstory, an age at an earlier year ("This is the avalanche of 1999. I was forty-one."), a future: the date in the date spelling above (YYYY, YYYY-MM or YYYY-MM-DD) when the text gives one, else past or future. Empty when the value is of the passage's own time, whatever tense the book narrates in ("She was sixty-one" in a story told in the past tense is the present), and empty for a fact that is no state at a time at all — a total, a birth, how long something lasted ("had kept the hut for twenty-seven years" is his tenure, not a past value of it). Past is for a state that held then and may differ now: an age, a colour, a home, a job. A passage headed by the story's present is of that time: a value the text gives for it, a season or a year of it named or not, takes no when.
- quote: the exact words of the text that state it, copied character for character, at most one sentence.
- change: true only when the text narrates the value changing at that moment (she dyes her hair, he turns forty, they move house), or a reference sheet declares a change ("dyes her hair red in chapter five"); otherwise false. On a sheet, write the fact's value before the change and after it as two facts, the second with change true.
- section: on a reference sheet only, for a change it declares, the number of the book's Section it happens in, from the list you are given; 0 when the sheet does not say or names none of them.

Include the colours, sizes, numbers and materials of things as well as facts about people: a reader notices a gate that turns from green to brown. Write only what the text holds, never what you infer or know from elsewhere, and give each fact the status the text gives it: a belief, a plan or an open question is written down AS that, never as stated. A fact stated twice is written twice. Leave out opinions, feelings, and actions that change nothing lasting. An empty list is a fine answer.

On a reference sheet, each answer sits under a line in square brackets that names the field it answers, how the writer's answers there are to be read, and whose page it is or what it is about. A page's answers are about its person unless an answer ties a fact to someone else it names: on Hollis's page, "daughter of Amos, who kept the hut for thirty-eight years" is Amos's tenure, never hers. Quote only the answers, never a bracketed line. ESTABLISHED: the writer's facts about the story; stated, unless the answer itself says "maybe", "they believe", "not decided" or the like. WHO KNOWS WHAT: what is true, what someone believes, and what the reader knows; a fact the answer says someone believes or hides is believed or stated as the answer holds it, and the entity is the one the fact is about. PLANNED: story the writer intends, perhaps not yet written; every fact there is planned, or open when the writer is still weighing it. OTHER NOTES: the writer's own additions; give them the status their words give them.`;

/** One source as the ledger reads it. */
export interface LedgerText {
  source: SourceDescriptor;
  /** The source as `read_source` gives it. */
  text: string;
  revision: string;
  origin: SectionLedger["origin"];
  /**
   * A sheet's records (`parseReference`), whose extractable ones are what
   * the reader is shown. Absent on the prose.
   */
  parsed?: ParsedReference;
}

export interface LedgerDependencies {
  sources: ProjectSources;
  artifacts: Pick<Artifacts, "readLedger" | "writeLedger">;
  model: ModelProvider;
  descriptor: ModelDescriptor;
  modelRef: ModelRef;
  /**
   * How many times each text is read (`LEDGER_READS` when absent). The
   * app never sets it; the evaluation runner does, to measure what the
   * second reading buys against what it costs.
   */
  reads?: number;
}

/**
 * The shelves whose documents state facts about the book's people and world
 * and are read into ledgers on every fact check: a character sheet, an arc,
 * a world or timeline document. Never a generated summary: derived text,
 * whose facts are the prose's own at best and a stale draft's at worst.
 *
 * The guidebook and the notes are not on it: a command that declares them
 * hands them to the check through `declaredLedgerText`.
 */
const FACT_SHELVES: ReadonlySet<string> = new Set([
  "characters",
  "arcs",
  "world",
]);

/** Whether a source is a reference the ledger reads beside the prose. */
export function isFactSheet(source: SourceDescriptor): boolean {
  return (
    source.kind === "reference" &&
    source.summarises === undefined &&
    source.group !== undefined &&
    FACT_SHELVES.has(source.group)
  );
}

/**
 * A source as the ledger reads it, or `null` when it holds no facts to read:
 * a Section as it is, a fact sheet only once the writer has answered
 * something a fact may be read from.
 */
export function ledgerTextOf(
  source: SourceDescriptor,
  capture: { text: string; revision: string },
): LedgerText | null {
  if (source.kind === "manuscript" && source.nodeKind === "section")
    return { source, ...capture, origin: "prose" };
  return isFactSheet(source) ? sheetText(source, capture) : null;
}

/**
 * A reference document as the ledger reads it: its records by the page the
 * catalogue says it is (none for a note, whose every line is then read as
 * context), or `null` when none of them may be read for facts: a template
 * the writer has not answered, or a page whose answers are all intent,
 * inner life or open questions.
 */
function sheetText(
  source: SourceDescriptor,
  capture: { text: string; revision: string },
): LedgerText | null {
  const parsed = parseReference(capture.text, pageOf(source), source.title);
  return extractableRecords(parsed).length > 0
    ? {
        source,
        text: capture.text,
        revision: capture.revision,
        origin: "sheet",
        parsed,
      }
    : null;
}

/**
 * Whether a source is a document a command may declare for the check: a
 * guidebook reference or a note. Both kinds count, because the project
 * adapter publishes a notes file as kind `note`, not `reference`
 * (`projectAdapter.ts`). A generated summary is never read; a fact sheet
 * has its own reader (`ledgerTextOf`).
 */
function isDeclaredDocument(source: SourceDescriptor): boolean {
  return (
    (source.kind === "reference" || source.kind === "note") &&
    source.summarises === undefined &&
    !isFactSheet(source)
  );
}

/**
 * A reference or note a command declared, as the ledger reads it beside
 * the fact sheets: as a sheet, once the writer has answered something a
 * fact may be read from (`sheetText`), or `null`. The text is the one the
 * run already read and cleaned, so the sheet's quotes are the file's words
 * as `read_source` gives them. The ledger reads only the facts; the
 * document's instructions and context reach the model whole, in the
 * reference block every step carries (`selectReferences`).
 */
export function declaredLedgerText(
  source: SourceDescriptor,
  capture: { text: string; revision: string },
): LedgerText | null {
  return isDeclaredDocument(source) ? sheetText(source, capture) : null;
}

/**
 * The declared references among `candidates` as the ledger reads them
 * (`declaredLedgerText`), each read through the port so the template's
 * hints and unanswered questions are already gone. One that will not read
 * is left out, like any source `ledgerTexts` leaves out.
 */
export async function declaredLedgerTexts(
  sources: ProjectSources,
  candidates: readonly SourceDescriptor[],
  signal: AbortSignal,
): Promise<LedgerText[]> {
  return (await declaredDocuments(sources, candidates, signal)).flatMap(
    (one) => declaredLedgerText(one.source, one) ?? [],
  );
}

/** A declared document as the run reads it through the port. */
export interface DeclaredDocument {
  source: SourceDescriptor;
  text: string;
  revision: string;
}

/**
 * The declared documents among `candidates`, read once through the port:
 * the one reading both the ledger (`declaredLedgerText`) and the judge's
 * guidance (`guidanceOf`) are drawn from. One that will not read is left
 * out; unreadable is not empty, and the next check tries again.
 */
export async function declaredDocuments(
  sources: ProjectSources,
  candidates: readonly SourceDescriptor[],
  signal: AbortSignal,
): Promise<DeclaredDocument[]> {
  const documents: DeclaredDocument[] = [];
  for (const source of candidates) {
    if (!isDeclaredDocument(source)) continue;
    throwIfCancelled(signal);
    try {
      documents.push({ source, ...(await sources.read(source.id)) });
    } catch {
      // Left out this time; the next check tries again.
    }
  }
  return documents;
}

/**
 * The reference documents a check reads, each read once through the port:
 * the fact sheets and the documents the command declared, among
 * `candidates`. The ledger (`referenceLedgerText`), the judge's guidance
 * (`guidanceOf`) and the rule check are all drawn from this one reading: a
 * page with nothing a fact may be read from (the world's rules, a
 * character's inner life) still has records the judge and the rule check
 * need. One that will not read is left out, and the next check tries again.
 */
export async function referenceDocuments(
  sources: ProjectSources,
  candidates: readonly SourceDescriptor[],
  signal: AbortSignal,
): Promise<DeclaredDocument[]> {
  const documents: DeclaredDocument[] = [];
  const seen = new Set<string>();
  for (const source of candidates) {
    if (!isFactSheet(source) && !isDeclaredDocument(source)) continue;
    // A sheet the command also declares is one document.
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    throwIfCancelled(signal);
    try {
      documents.push({ source, ...(await sources.read(source.id)) });
    } catch {
      // Left out this time; the next check tries again.
    }
  }
  return documents;
}

/** A reference document as the ledger reads it, whichever reader it has. */
export function referenceLedgerText(
  document: DeclaredDocument,
): LedgerText | null {
  return (
    ledgerTextOf(document.source, document) ??
    declaredLedgerText(document.source, document)
  );
}

/**
 * The documents as the judge is shown them (`Guidance`, `judge.ts`): the
 * records a verdict turns on, under their role's heading (`guidanceItems`).
 * These say how the writer means the book to be read, what is undecided,
 * what is already on their list, who knows what, and what is planned. The
 * ledger's atomic facts keep none of it, and a judge shown the facts alone
 * weighs a slip the writer has already explained away.
 *
 * Not the documents whole: a character's fears or a market's colours decide
 * no verdict and cost the room a rule needs. A character sheet's records and
 * a block's (a place, a system) are each about one entity, and are shown
 * only beside a question that mentions it. The Editing brief goes last: it
 * is about every review, and when room runs short the document about this
 * check is the one to keep. A template the writer has answered nothing in,
 * as the port strips it, is no guidance.
 */
export function guidanceOf(documents: readonly DeclaredDocument[]): Guidance[] {
  const isBrief = (source: SourceDescriptor) =>
    source.group === EDITING_BRIEF.group &&
    source.sectionId === EDITING_BRIEF.sectionId;
  return [
    ...documents.filter((one) => !isBrief(one.source)),
    ...documents.filter((one) => isBrief(one.source)),
  ].flatMap((one) =>
    guidanceItems(
      parseReference(one.text, pageOf(one.source), one.source.title),
      one.source.title,
    ).map((item) => ({
      sourceId: one.source.id,
      title: item.title,
      text: item.text,
      revision: one.revision,
      ...(item.entity === undefined ? {} : { entity: item.entity }),
      ...(item.aliases === undefined ? {} : { aliases: item.aliases }),
    })),
  );
}

/**
 * The texts the ledger reads among `candidates` (`ledgerTextOf`). A source
 * that will not read is left out.
 */
export async function ledgerTexts(
  sources: ProjectSources,
  candidates: readonly SourceDescriptor[],
  signal: AbortSignal,
): Promise<LedgerText[]> {
  const texts: LedgerText[] = [];
  for (const source of candidates) {
    const section =
      source.kind === "manuscript" && source.nodeKind === "section";
    if (!section && !isFactSheet(source)) continue;
    throwIfCancelled(signal);
    try {
      const one = ledgerTextOf(source, await sources.read(source.id));
      if (one) texts.push(one);
    } catch {
      // Unreadable is not empty, and not a failure of the whole check: the
      // source has no ledger this time, and the next check tries again.
    }
  }
  return texts;
}

/**
 * Which texts already have a ledger for their revision, and which must be
 * read. Asked before any model call, so a caller can say what a check will
 * cost before it spends anything.
 */
export async function staleLedgers(
  texts: readonly LedgerText[],
  artifacts: Pick<Artifacts, "readLedger">,
  /** The book's Sections in order, which a sheet's ledger depends on. */
  book: readonly SourceDescriptor[] = bookOf(texts),
  /** The story's present the prose would be told (`presentOf`). */
  present: string | null = presentOf(texts),
): Promise<{ fresh: SectionLedger[]; stale: LedgerText[] }> {
  const fresh: SectionLedger[] = [];
  const stale: LedgerText[] = [];
  const sections = sectionsFingerprint(book);
  for (const one of texts) {
    const stored = await artifacts.readLedger(one.source.id).catch(() => null);
    if (
      stored?.contentHash === one.revision &&
      stored.recipeRevision === ledgerRecipe(one.origin) &&
      stored.origin === one.origin &&
      // A sheet's changes are bound to the Section list it was read
      // against; the prose carries none.
      (one.origin !== "sheet" || stored.sections === sections) &&
      // The prose is bound to the present it was told, but only
      // when this check knows one: a check that reads no timeline takes the
      // ledger as it is, so two commands reading different sheets never
      // undo each other's reading.
      (one.origin !== "prose" || present === null || stored.present === present)
    )
      fresh.push(stored);
    else stale.push(one);
  }
  return { fresh, stale };
}

/**
 * The Section list a check numbers by, when the caller gives none: the
 * prose it reads, in order. A caller checking part of the book passes the
 * whole book instead (`FactCheckRequest.book`), so "chapter two" on a sheet
 * is the book's second Section and never the second of the Part in scope.
 */
function bookOf(texts: readonly LedgerText[]): SourceDescriptor[] {
  return texts.filter((one) => one.origin === "prose").map((one) => one.source);
}

/**
 * A ledger for every text: the stored ones that still match, and a new one
 * read and written for each of the rest, in the order given. `onReading`
 * names each source as its reading starts.
 */
export async function ensureLedgers(
  texts: readonly LedgerText[],
  names: readonly KnownName[],
  deps: LedgerDependencies,
  signal: AbortSignal,
  onReading: (
    source: SourceDescriptor,
    done: number,
    of: number,
  ) => void = () => {},
  /**
   * The book's Sections in order, for a sheet that dates a change by one:
   * the whole book, even when the check reads part of it.
   */
  book: readonly SourceDescriptor[] = bookOf(texts),
): Promise<{
  ledgers: SectionLedger[];
  /** The sources the model could not read into a ledger this time. */
  unread: SourceDescriptor[];
  usage: RunUsage;
}> {
  const present = presentOf(texts);
  const { fresh, stale } = await staleLedgers(
    texts,
    deps.artifacts,
    book,
    present,
  );
  const sections = book;
  const read = new Map(fresh.map((ledger) => [ledger.sourceId, ledger]));
  const unread: SourceDescriptor[] = [];
  let usage: RunUsage = { steps: 0 };
  for (const [done, one] of stale.entries()) {
    throwIfCancelled(signal);
    onReading(one.source, done, stale.length);
    const extracted = await extractLedger(
      one,
      names,
      deps,
      signal,
      sections,
      present,
    );
    usage = mergeUsage(usage, extracted.usage);
    if (!extracted.ledger) {
      unread.push(one.source);
      continue;
    }
    // Kept only to spare the next check a reading: this check has the
    // ledger in hand, so a store that refuses it costs nothing more.
    await deps.artifacts.writeLedger(extracted.ledger).catch(() => undefined);
    read.set(one.source.id, extracted.ledger);
  }
  return {
    ledgers: texts.flatMap((one) => {
      const ledger = read.get(one.source.id);
      return ledger ? [ledger] : [];
    }),
    unread,
    usage,
  };
}

/**
 * One text's ledger, read by the model a chunk at a time, or `null` when a
 * chunk came back in no shape: a ledger missing a chunk would be stored as
 * complete, and every fact in that chunk would stay unread until the writer
 * next changed the Section. It returns `null` rather than throwing, because
 * one Section a model could not answer for is no reason to lose the rest of
 * the check; the caller names it as unread. Stop and a failed request throw.
 */
export async function extractLedger(
  one: LedgerText,
  names: readonly KnownName[],
  deps: LedgerDependencies,
  signal: AbortSignal,
  sections: readonly SourceDescriptor[] = [],
  /** The story's present to tell the prose (`presentOf`), or `null`. */
  present: string | null = null,
): Promise<{ ledger: SectionLedger | null; usage: RunUsage }> {
  // Only a sheet dates a change by a Section; the prose is its own time.
  const book = one.origin === "sheet" ? sections : [];
  const sampling = samplingFields(STANDARD, deps.descriptor);
  const limits = limitsFor(
    deps.descriptor,
    LEDGER_OUTPUT_TOKENS,
    sampling.effort,
  );
  const told = one.origin === "prose" ? present : null;
  const header = headerOf(one, names, book, told);
  const room = Math.max(
    1_000,
    Math.min(
      LEDGER_CHUNK_CHARACTERS,
      inputCharactersFor(limits) - LEDGER_INSTRUCTIONS.length - header.length,
    ),
  );
  const claims: Claim[] = [];
  let usage: RunUsage = { steps: 0 };
  let dropped = 0;
  // One piece's facts; an answer cut off by the output limit is read again
  // as two halves, down to `LEDGER_CHUNK_FLOOR`. `false` when a piece could
  // not be read at all.
  const read = async (piece: Piece): Promise<boolean> => {
    throwIfCancelled(signal);
    const answered = await structuredAnswer(
      deps.model,
      deps.descriptor,
      {
        model: deps.modelRef,
        instructions: LEDGER_INSTRUCTIONS,
        messages: [{ role: "user", content: `${header}\n${piece.text}` }],
        limits,
        ...sampling,
      },
      claimsShape(
        piece.text,
        book.map((source) => source.id),
      ),
      signal,
    );
    usage = mergeUsage(usage, answered.usage);
    stoppedIf(answered.reason, "Reading stopped");
    if (answered.value) {
      const placed = answered.value.claims.flatMap(
        (claim) => placedClaim(piece, claim) ?? [],
      );
      claims.push(...placed);
      dropped += answered.value.written - placed.length;
      return true;
    }
    if (answered.reason !== "limit" || piece.text.length < LEDGER_CHUNK_FLOOR)
      return false;
    const halves = piece.halves();
    if (halves.length < 2) return false;
    for (const half of halves) if (!(await read(half))) return false;
    return true;
  };
  const pieces = piecesOf(one, room);
  for (const piece of pieces)
    if (!(await read(piece))) return { ledger: null, usage };
  // One model answer is one sample, and the same Section read twice yields
  // facts the first reading passed over. What both readings noted at one
  // place is kept once, whatever each called its entity. A second reading
  // that fails loses only what it would have added.
  const first = claims.splice(0);
  const noted = new Set(first.map(placeOf));
  for (let pass = 1; pass < (deps.reads ?? LEDGER_READS); pass += 1)
    for (const piece of pieces) if (!(await read(piece))) break;
  claims.unshift(...first);
  const added = claims
    .splice(first.length)
    .filter((claim) => !noted.has(placeOf(claim)));
  claims.push(...added);
  return {
    ledger: {
      sourceId: one.source.id,
      contentHash: one.revision,
      recipeRevision: ledgerRecipe(one.origin),
      model: `${deps.modelRef.providerId}/${deps.modelRef.modelId}`,
      origin: one.origin,
      // What the sheet's Section numbers were resolved against, and how much
      // of the sheet the catalogue could read.
      ...(one.origin === "sheet"
        ? { sections: sectionsFingerprint(sections) }
        : {}),
      // The present the prose was told, which makes it fresh.
      ...(told === null ? {} : { present: told }),
      ...(one.parsed ? { interpretation: one.parsed.interpretation } : {}),
      claims: unique(claims),
      dropped,
    },
    usage,
  };
}

/**
 * A piece of a text the reader is shown in one request: its text, where a
 * span of it stands in the file (and in which record, on a sheet), and how
 * it splits in two when an answer about it is cut off.
 */
interface Piece {
  text: string;
  place(
    start: number,
    end: number,
  ): { at: number; record: ReferenceRecord | null } | null;
  halves(): Piece[];
}

function prosePiece(start: number, text: string): Piece {
  return {
    text,
    place: (at) => ({ at: start + at, record: null }),
    halves: () =>
      chunksOf(text, Math.ceil(text.length / 2)).map((half) =>
        prosePiece(start + half.start, half.text),
      ),
  };
}

function sheetPiece(chunk: ExtractionChunk, parsed: ParsedReference): Piece {
  return {
    text: chunk.text,
    place: (start, end) => placeInFile(chunk, start, end),
    // The chunk's own records, packed again at half its size: a record's
    // line goes with every half of it.
    halves: () =>
      extractionChunks(
        {
          ...parsed,
          records: [...new Set(chunk.segments.map((one) => one.record))],
        },
        Math.ceil(chunk.text.length / 2),
      ).map((half) => sheetPiece(half, parsed)),
  };
}

/** The pieces a text is read in: the prose by length, a sheet by records. */
function piecesOf(one: LedgerText, room: number): Piece[] {
  const parsed = one.parsed;
  return parsed
    ? extractionChunks(parsed, room).map((chunk) => sheetPiece(chunk, parsed))
    : chunksOf(one.text, room).map((chunk) =>
        prosePiece(chunk.start, chunk.text),
      );
}

/**
 * A claim read from a piece, placed in the file: its offset the file's, and
 * on a sheet the field it sits in, its status within the field's ceiling,
 * and a line the catalogue could not place marked as context.
 * `null` when its quote is not inside one answer line: a bracketed line is
 * the app's words, and a run across two answers belongs to neither.
 */
function placedClaim(piece: Piece, claim: Claim): Claim | null {
  const where = piece.place(claim.at, claim.at + claim.quote.length);
  if (!where) return null;
  const record = where.record;
  if (!record) return { ...claim, at: where.at };
  return {
    ...claim,
    at: where.at,
    status: statusWithin(record, claim.status),
    ...(record.field
      ? { field: fieldRef(record.field) }
      : { unclassified: true as const }),
  };
}

/**
 * The story's present in the writer's own words: the answer to the field the
 * catalogue flags `present` (the timeline's "The story's present") on any
 * sheet the check reads, or `null` with none. The writer's text,
 * not a model's reading of it, so every Section is told the same words.
 */
export function presentOf(texts: readonly LedgerText[]): string | null {
  const answers: string[] = [];
  for (const one of texts)
    for (const record of one.parsed?.records ?? [])
      if (record.field?.flags.has("present"))
        for (const line of record.lines) {
          const answer = line.text.replace(/^\s*[-*+]\s+/u, "").trim();
          if (answer) answers.push(answer);
        }
  return answers.length > 0 ? answers.join(" ") : null;
}

/** What the model is told the text is, and whose names it may use. */
function headerOf(
  one: LedgerText,
  names: readonly KnownName[],
  sections: readonly SourceDescriptor[],
  present: string | null = null,
): string {
  const known = names
    .filter((known) => known.kind === "character" && known.names.length > 0)
    .map((known) => `- ${known.names.join(", ")}`);
  return [
    known.length > 0
      ? `PEOPLE THE WRITER KEEPS A SHEET FOR (each line one person, by every name they go by):\n${known.join("\n")}\n`
      : "",
    sections.length > 0
      ? `THE BOOK'S SECTIONS, IN ORDER:\n${sections.map((source, at) => `${at + 1}. ${JSON.stringify(source.title)}`).join("\n")}\n`
      : "",
    present === null
      ? ""
      : `THE STORY'S PRESENT, AS THE WRITER'S TIMELINE GIVES IT: ${JSON.stringify(present)}\n`,
    one.origin === "sheet"
      ? `THE WRITER'S REFERENCE SHEET "${one.source.title}" (${one.parsed?.page ? `their page "${one.parsed.page.name}"` : "their own notes, outside any page"}; each answer under the field it answers):`
      : `A PASSAGE FROM "${one.source.title}":`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The text in pieces of at most `size` characters, each ending at a line
 * break where one falls in its second half, so a sentence, and a quote, is
 * seldom cut in two.
 */
export function chunksOf(
  text: string,
  size: number,
): { start: number; text: string }[] {
  const chunks: { start: number; text: string }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const breakAt = text.lastIndexOf("\n", end);
      if (breakAt > start + size / 2) end = breakAt + 1;
    }
    chunks.push({ start, text: text.slice(start, end) });
    start = end;
  }
  return chunks;
}

/** One fact at one place, whoever the reading said it was about. */
function placeOf(claim: Claim): string {
  return [claim.attribute, claim.type, claim.norm, claim.at].join("|");
}

/** A claim stated twice at the same place is one claim. */
function unique(claims: readonly Claim[]): Claim[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = [
      claim.entity.toLowerCase(),
      claim.attribute,
      claim.type,
      claim.norm,
      claim.at,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function claimsShape(
  text: string,
  sections: readonly string[],
): StructuredAnswerShape<{ claims: Claim[]; written: number }> {
  // The Section number is asked only of a sheet, so the prose's answers
  // carry no field they never use.
  const section = sections.length > 0 ? ["section"] : [];
  return {
    name: "write_facts",
    description: "Write down every fact the text states.",
    inputSchema: {
      type: "object",
      properties: {
        facts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              entity: { type: "string" },
              kind: { type: "string", enum: [...ENTITY_KINDS] },
              status: { type: "string", enum: [...CLAIM_STATUSES] },
              attribute: { type: "string" },
              type: { type: "string", enum: [...VALUE_TYPES] },
              value: { type: "string" },
              norm: { type: "string" },
              since: { type: "string" },
              when: { type: "string" },
              quote: { type: "string" },
              change: { type: "boolean" },
              ...(section.length > 0
                ? {
                    section: {
                      type: "integer",
                      minimum: 0,
                      maximum: sections.length,
                    },
                  }
                : {}),
            },
            required: [
              "entity",
              "kind",
              "status",
              "attribute",
              "type",
              "value",
              "norm",
              "since",
              "when",
              "quote",
              "change",
              ...section,
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["facts"],
      additionalProperties: false,
    },
    // A list is the answer even when some of its facts are not believed:
    // each is checked alone (`claimOf`), and the ones that fail are dropped.
    validate: (value) => {
      const facts = (value as { facts?: unknown } | null)?.facts;
      if (!Array.isArray(facts)) return null;
      const written = facts.slice(0, CLAIM_LIMITS.perChunk);
      return {
        claims: written.flatMap((one) => claimOf(one, text, 0, sections) ?? []),
        written: written.length,
      };
    },
  };
}
