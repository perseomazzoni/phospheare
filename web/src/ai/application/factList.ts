// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The fact check: ledgers, candidates and a judge. One pipeline for every
// run that holds facts against the book: a wide `/continuity` or `/canon`
// review, the same command typed at a Section, or either picked up
// mid-answer with `use_skill`.
//
//   ledgers    each Section and answered fact sheet read into typed, quoted
//              claims, once per revision (`ledger.ts`);
//   entities   one question over the places' and things' names alone:
//              which name one (`entities.ts`), kept while the names hold;
//   candidates plain code finds what the claims disagree about
//              (`domain/candidates.ts`);
//   judge      one small question per candidate (`judge.ts`).
//
// It reads any language the model does, not only patterns written for one,
// and every finding points at two places the text holds.
//
// `/continuity` holds the book against itself and against the sheets;
// `/canon` holds it against the sheets only. A named sheet narrows either to
// that sheet.

import {
  candidates,
  type Candidate,
  type LedgerInBook,
} from "../domain/candidates";
import type {
  Finding,
  ReviewTask,
  RunActivity,
  RunUsage,
  SourceDescriptor,
} from "../domain/types";
import type { ProjectSources } from "../ports";
import {
  judgeCandidates,
  type Guidance,
  type JudgeDependencies,
  type JudgedText,
} from "./judge";
import { pageOf } from "../domain/referenceCatalogue";
import { parseReference } from "../domain/referenceRecords";
import {
  checkKnowledge,
  checkRules,
  type RuleCheckDependencies,
  type RuleReport,
} from "./ruleCheck";
import {
  ensureLedgers,
  guidanceOf,
  isFactSheet,
  ledgerTexts,
  referenceDocuments,
  referenceLedgerText,
  type DeclaredDocument,
  type LedgerDependencies,
  type LedgerText,
} from "./ledger";
import {
  groupEntities,
  groupLabels,
  groupValues,
  type EntityDependencies,
} from "./entities";
import { mergeUsage } from "./runStep";

/** The start of every fact-check finding's id, before its candidate's key. */
export const FACT_FINDING = "fact:";

/** How many deferred facts the check's message names; the rest are a count. */
const NAMED_WAITING = 8;

export interface FactCheckRequest {
  task: ReviewTask;
  /**
   * What the check reads: Sections in reading order, the fact sheets, and
   * the references the command declared.
   */
  texts: readonly LedgerText[];
  /**
   * The book's Sections in order, whole, for a sheet that dates a change
   * by "chapter two". Absent, the check numbers by the Sections it reads,
   * which matches the book only when the scope is the book. The same order
   * places every claim when the candidates are found, so a change dated
   * before the scope holds inside it. Order and titles only: a Section
   * outside the scope is never read.
   */
  book?: readonly SourceDescriptor[];
  /** Only candidates touching one of these sources; absent for all. */
  focus?: ReadonlySet<string>;
  /** The sheets the writer named; a sheet candidate must be one of them. */
  sheets?: ReadonlySet<string>;
  /**
   * The declared documents whole, for the judge (`guidanceOf`): what a
   * guidebook page says about how to read the book, which extraction into
   * atomic facts loses. Narrowed with `sheets` when the writer named a
   * reference, so a name narrows what the judge is shown too.
   */
  guidance?: readonly Guidance[];
  /**
   * The reference documents the check reads, each as read once
   * (`referenceDocuments`): the rules the prose is held to come from these
   * (`ruleCheck.ts`), including a page no fact is read from, the world's
   * rules, which is in no ledger. Narrowed with `sheets` like the guidance.
   * Absent, no rule is checked.
   */
  documents?: readonly DeclaredDocument[];
}

export type FactCheckDependencies = LedgerDependencies &
  JudgeDependencies &
  EntityDependencies &
  RuleCheckDependencies;

export interface FactCheck {
  findings: Finding[];
  usage: RunUsage;
  /** How many sources were read into ledgers, this time or before. */
  read: number;
  /** How many candidates the ledgers held for this check. */
  candidates: number;
  /**
   * The candidates themselves, as raised, so a measurement can tell a
   * plant the ledgers never held from one raised and judged no slip
   * (`scripts/fact-eval.mjs`, by stage). The app reads the count.
   */
  raised: Candidate[];
  /** How many of them the judge answered in shape. */
  judged: number;
  /** The ones it was asked about and answered in no shape, by identity. */
  unresolved: Candidate[];
  /**
   * The ones it held and did not reach this time, past the judge's cap on
   * fresh questions, by identity; the next check continues from them.
   */
  deferred: Candidate[];
  /** The sources the model could not read into a ledger this time. */
  unread: SourceDescriptor[];
  /**
   * Each rule the check held the prose to, and how much of the scope its
   * verdict speaks for: a rule no passage matched is not checked.
   */
  rules: RuleReport[];
  /**
   * Each note on who knows what, and from when, the check held the prose to,
   * reported as the rules are.
   */
  knowing: RuleReport[];
}

export async function checkFacts(
  request: FactCheckRequest,
  deps: FactCheckDependencies,
  signal: AbortSignal,
  onActivity: (activity: RunActivity) => void = () => {},
): Promise<FactCheck> {
  // Reading order is what tells a slip from a change the story tells
  // (`candidates`): the Sections by their place in the book, the sheets,
  // which stand outside story time, after them.
  const texts = [...request.texts].sort(
    (a, b) =>
      Number(a.origin === "sheet") - Number(b.origin === "sheet") ||
      (a.source.order ?? 0) - (b.source.order ?? 0),
  );
  const names = deps.sources.knownNames
    ? await deps.sources
        .knownNames(texts.map((one) => one.source.id))
        .catch(() => [])
    : [];
  const read = await ensureLedgers(
    texts,
    names,
    deps,
    signal,
    (source) => onActivity({ kind: "reading", title: source.title }),
    request.book,
  );
  const byId = new Map(texts.map((one) => [one.source.id, one]));
  const book: LedgerInBook[] = read.ledgers.map((ledger) => ({
    ledger,
    text: byId.get(ledger.sourceId)?.text ?? "",
  }));
  const entities = await groupEntities(read.ledgers, deps, signal);
  // Which labels name one kind of fact, and which free-text values
  // say one thing in two wordings.
  const labels = await groupLabels(read.ledgers, deps, signal);
  const values = await groupValues(read.ledgers, labels.grouped, deps, signal);
  // Placed by the book's order (`request.book`), not by the ledgers in
  // hand. Ids only; no body travels.
  const found = candidates(
    book,
    new Set(),
    {
      entities: entities.grouped,
      labels: labels.grouped,
      values: values.grouped,
    },
    request.book?.map((one) => one.id),
  ).filter(
    (one) =>
      (request.task !== "consistency" ||
        one.kind === "sheet" ||
        one.kind === "sheets") &&
      (!request.sheets ||
        one.sides.every(
          (side) =>
            side.origin !== "sheet" ||
            (request.sheets as ReadonlySet<string>).has(side.sourceId),
        )) &&
      (!request.focus ||
        one.sides.some((side) =>
          (request.focus as ReadonlySet<string>).has(side.sourceId),
        )),
  );
  // Each Section's place in the book, for the judge; a sheet has none.
  const order = (
    request.book ??
    texts.filter((one) => one.origin !== "sheet").map((one) => one.source)
  ).map((one) => one.id);
  const judgedTexts = new Map<string, JudgedText>(
    texts.map((one) => {
      const at = order.indexOf(one.source.id);
      return [
        one.source.id,
        {
          title: one.source.title,
          text: one.text,
          revision: one.revision,
          ...(one.origin !== "sheet" && at >= 0
            ? { position: { at: at + 1, of: order.length } }
            : {}),
        },
      ];
    }),
  );
  const judged = await judgeCandidates(
    found,
    judgedTexts,
    deps,
    signal,
    () => onActivity({ kind: "verifying", step: "judging" }),
    (request.guidance ?? []).filter(
      (one) => request.sheets === undefined || request.sheets.has(one.sourceId),
    ),
  );
  // The writer's rules over the prose in scope: the Sections the
  // check reads, or the focused ones, and the references a name narrows to.
  const notes = (request.documents ?? [])
    .filter(
      (one) =>
        request.sheets === undefined || request.sheets.has(one.source.id),
    )
    .map((one) => ({
      sourceId: one.source.id,
      title: one.source.title,
      revision: one.revision,
      text: one.text,
      parsed: parseReference(one.text, pageOf(one.source), one.source.title),
    }));
  const prose = texts
    .filter(
      (one) =>
        one.origin === "prose" &&
        (!request.focus || request.focus.has(one.source.id)),
    )
    .map((one) => {
      const at = order.indexOf(one.source.id);
      return {
        sourceId: one.source.id,
        title: one.source.title,
        revision: one.revision,
        text: one.text,
        // The note on who knows what gives a place ("only in section 5"),
        // and only the passage's own place can be held to it.
        ...(at >= 0 ? { position: { at: at + 1, of: order.length } } : {}),
      };
    });
  const ruled = await checkRules(notes, prose, deps, signal);
  // Who knows what, and from when: the same question's machine over
  // the notes the catalogue flags `knowing`.
  const known = await checkKnowledge(notes, prose, deps, signal);
  return {
    findings: [...judged.findings, ...ruled.findings, ...known.findings],
    usage: [
      entities.usage,
      labels.usage,
      values.usage,
      judged.usage,
      ruled.usage,
      known.usage,
    ].reduce(mergeUsage, read.usage),
    read: read.ledgers.length,
    candidates: found.length,
    raised: found,
    judged: judged.judged,
    unresolved: judged.unresolved,
    deferred: judged.deferred,
    unread: read.unread,
    rules: ruled.rules,
    knowing: known.rules,
  };
}

/** A rule as the check's message names it: its label, and whom it is about. */
function ruleName(rule: RuleReport): string {
  return JSON.stringify(
    rule.entity ? `${rule.label} (${rule.entity})` : rule.label,
  );
}

/**
 * What the rule check could not vouch for, in its own terms: the
 * rules no passage matched, which were not checked and are never reported
 * as kept; the ones checked in part; the ones asked and answered in no
 * shape. Named, up to `NAMED_WAITING` each, so the model can look for itself.
 */
function rulesGaps(
  rules: readonly RuleReport[],
  // What the notes are called: the writer's rules, or their notes on who
  // knows what.
  noun = "rules",
): string[] {
  const names = (list: readonly RuleReport[]) =>
    list.length > NAMED_WAITING
      ? `${list.slice(0, NAMED_WAITING).map(ruleName).join(", ")} and ${list.length - NAMED_WAITING} more`
      : list.map(ruleName).join(", ");
  const unmatched = rules.filter((one) => one.coverage === "unmatched");
  const partial = rules.filter(
    (one) => one.coverage === "partial" && !one.unanswered,
  );
  const unanswered = rules.filter((one) => one.unanswered);
  return [
    ...(unmatched.length > 0
      ? [
          `${unmatched.length} of the writer's ${noun} matched no passage in what was checked, so they were not checked at all (not found kept): ${names(unmatched)}.`,
        ]
      : []),
    ...(partial.length > 0
      ? [
          `These ${noun} were checked only in part — in their likeliest passages, or not asked this time: ${names(partial)}.`,
        ]
      : []),
    ...(unanswered.length > 0
      ? [
          `These ${noun} could not be checked, the reader answering in no shape; hold the prose to them yourself: ${names(unanswered)}.`,
        ]
      : []),
  ];
}

/**
 * The check as a chat's model reads it, beside the prose: each judged slip
 * with both places, and each unsure one to look at. JSON-quoted, because
 * the titles and explanations are model text and the quotes are the
 * writer's, and both are data.
 *
 * It says what the pipeline did, in its own counts, and no more: no stage
 * can vouch that every fact was compared. Empty only when nothing was found
 * and everything was read and answered; anything short of that is named, so
 * the model checks it rather than taking silence for a clean bill.
 */
export function factCheckMessage(
  check: FactCheck,
  titles: ReadonlyMap<string, string>,
): string {
  const unread =
    check.unread.length > 0
      ? `The app could not read these into its fact check; check them yourself: ${check.unread.map((source) => `${JSON.stringify(source.title)} (${source.id})`).join(", ")}.`
      : "";
  const asked = check.judged + check.unresolved.length;
  // What waits is named, and said to wait rather than to be "not checked":
  // the kept verdicts make the next check continue from these.
  const waiting = check.deferred.map(
    (one) => `${one.entity}, ${one.attribute}`,
  );
  const named =
    waiting.length > NAMED_WAITING
      ? `${waiting.slice(0, NAMED_WAITING).join("; ")}; and ${waiting.length - NAMED_WAITING} more`
      : waiting.join("; ");
  const gaps = [
    ...(asked < check.candidates
      ? [
          waiting.length > 0
            ? `Only the ${asked} most likely of ${check.candidates} were asked about this time; ${waiting.length} wait for the next check, which continues from them: ${named}.`
            : `Only the ${asked} most likely of ${check.candidates} were asked about; the rest could not be shown to a judge.`,
        ]
      : []),
    // Named, not counted: "read those facts yourself" is an instruction the
    // model can follow only when it is told which.
    ...(check.unresolved.length > 0
      ? [
          `${check.unresolved.length} of them could not be judged and stay unresolved: read those facts yourself — ${check.unresolved
            .map(
              (one) =>
                `${one.entity}, ${one.attribute} (${[...new Set(one.sides.map((side) => side.sourceId))].map((id) => JSON.stringify(titles.get(id) ?? id)).join(", ")})`,
            )
            .join("; ")}.`,
        ]
      : []),
    ...(unread ? [unread] : []),
    ...rulesGaps(check.rules),
    ...rulesGaps(check.knowing, "notes on who knows what"),
  ].join(" ");
  const checked = check.rules.filter(
    (one) => one.coverage !== "unmatched" && one.examined > 0,
  ).length;
  const knew = check.knowing.filter(
    (one) => one.coverage !== "unmatched" && one.examined > 0,
  ).length;
  const did = `THE APP'S FACT CHECK read ${check.read} source${check.read === 1 ? "" : "s"} into its fact ledgers and found ${check.candidates} place${check.candidates === 1 ? "" : "s"} where two of them state one fact differently; ${check.judged} of them ${check.judged === 1 ? "was" : "were"} judged by a reader of both places.${check.rules.length > 0 ? ` It held the passages likeliest to bear on ${checked} of the writer's ${check.rules.length} rule${check.rules.length === 1 ? "" : "s"} to ${checked === 1 ? "it" : "them"}.` : ""}${check.knowing.length > 0 ? ` It held the passages likeliest to bear on ${knew} of the writer's ${check.knowing.length} note${check.knowing.length === 1 ? "" : "s"} on who knows what, and from when, to ${knew === 1 ? "it" : "them"}.` : ""}`;
  if (check.findings.length === 0)
    return gaps && `${did} None of those judged is a slip. ${gaps}`;
  const lines = check.findings.map((finding) => {
    const places = finding.evidence
      .map(
        (anchor) =>
          `${JSON.stringify(anchor.quote)} in ${JSON.stringify(titles.get(anchor.sourceId) ?? anchor.sourceId)} (${anchor.sourceId})`,
      )
      .join("; ");
    return `- ${finding.uncertainty === undefined ? "SLIP" : "UNSURE"}: ${JSON.stringify(finding.title)} — ${JSON.stringify(finding.explanation)}${finding.uncertainty ? ` Could not tell: ${JSON.stringify(finding.uncertainty)}` : ""} Places: ${places}`;
  });
  return [
    `${did} Report each SLIP as a finding quoting both places exactly as given. Read around each UNSURE one before you decide. This is what the app's reading found, not proof that every fact holds.${gaps ? ` ${gaps}` : ""}`,
    ...lines,
  ].join("\n");
}

/**
 * The chat's check over the whole book it may read (`allowed`), with the
 * findings kept to what touches `focus` when one is given.
 */
export async function bookFactCheck(
  sources: ProjectSources,
  catalog: readonly SourceDescriptor[],
  allowed: ReadonlySet<string>,
  request: Omit<FactCheckRequest, "texts" | "book" | "guidance" | "documents">,
  deps: FactCheckDependencies,
  signal: AbortSignal,
  onActivity?: (activity: RunActivity) => void,
  /**
   * The references the command declared beyond the fact sheets, such as
   * the continuity guide and the notes. They are read beside the sheets, so
   * the check sees what the direct route would have shown the model.
   */
  declared: readonly SourceDescriptor[] = [],
): Promise<{ message: string; usage: RunUsage }> {
  const check = await checkFacts(
    {
      ...request,
      ...(await factCheckInputs(
        sources,
        catalog,
        allowed,
        declared,
        request.sheets,
        signal,
      )),
      book: bookSections(catalog, allowed),
    },
    deps,
    signal,
    onActivity,
  );
  return {
    message: factCheckMessage(
      check,
      new Map(catalog.map((source) => [source.id, source.title])),
    ),
    usage: check.usage,
  };
}

/**
 * What a check over the book reads, each source once: the Sections the chat
 * may read, into ledgers; the fact sheets and the `declared` references,
 * into ledgers where a fact may be read from them, to the judge by record
 * (`guidanceOf`), and to the rule check. A named sheet narrows what is read,
 * not only what is reported: the other sheets are never opened. The
 * evaluation runners call this too, so a measurement assembles the check the
 * app does.
 */
export async function factCheckInputs(
  sources: ProjectSources,
  catalog: readonly SourceDescriptor[],
  allowed: ReadonlySet<string>,
  declared: readonly SourceDescriptor[],
  sheets: ReadonlySet<string> | undefined,
  signal: AbortSignal,
): Promise<
  Required<Pick<FactCheckRequest, "texts" | "guidance" | "documents">>
> {
  const narrowed = (source: SourceDescriptor) =>
    sheets === undefined || sheets.has(source.id);
  const prose = await ledgerTexts(
    sources,
    catalog.filter(
      (source) => allowed.has(source.id) && source.kind === "manuscript",
    ),
    signal,
  );
  const documents = await referenceDocuments(
    sources,
    [
      ...catalog.filter(
        (source) =>
          allowed.has(source.id) && isFactSheet(source) && narrowed(source),
      ),
      ...declared.filter(narrowed),
    ],
    signal,
  );
  return {
    texts: [
      ...prose,
      ...documents.flatMap((one) => referenceLedgerText(one) ?? []),
    ],
    guidance: guidanceOf(documents),
    documents,
  };
}

/**
 * The book's Sections in reading order, as far as the chat may read: what
 * a sheet's "chapter two" is numbered against.
 */
export function bookSections(
  catalog: readonly SourceDescriptor[],
  allowed: ReadonlySet<string>,
): SourceDescriptor[] {
  return catalog
    .filter(
      (source) =>
        source.kind === "manuscript" &&
        source.nodeKind === "section" &&
        allowed.has(source.id),
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
