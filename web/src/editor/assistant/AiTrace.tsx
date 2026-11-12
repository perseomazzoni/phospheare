// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Disclosure, Icon, type IconName } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import {
  requestedSourceId,
  searchedTerms,
  shownSourceId,
  traceFacts,
  traceOf,
  traceRows,
  type TraceFacts,
} from "../../ai/domain/trace";
import type {
  ChatTurn,
  ToolName,
  ToolReceipt,
  WebSearchRecord,
} from "../../ai/domain/types";
import { engineFacts, engineLabel } from "../../ai/domain/webEngine";
import { formatUsd } from "../../ai/formatUsd";
import {
  formatElapsed,
  toolPhrase,
  webPhrase,
  wholeSeconds,
} from "./runStatus";

// How the answer was reached: one fold above the answer, closed by default
// because the answer is what was asked for. It holds the run in the order it
// happened: each step's working, the prose it wrote on the way, and the reads
// it made.
//
// While the run lasts, its folded line is a plain name, "Steps so far": the
// run's one live voice (dots, words, clock) is at the foot of the turn,
// where the conversation ends and the eye waits. On completion the line
// becomes what was done: "Read 2 sources · Searched the project · 14s". No
// caret until there is something behind it, since an empty fold misdescribes
// the surface: a live run with nothing to show draws nothing here, and a
// finished one keeps a caret-less line.
//
// Always plain text: every thought is a text node, never `safeMarkdown` and
// never `dangerouslySetInnerHTML`. It is model output that may
// restate whatever was planted in the writer's sources, so a link in it must
// not be clickable and a heading must not look like one. A tool row's words
// come from the locale by the call's catalogued name, and its subject from
// the live catalogue: never a raw id, never the call's arguments, except a
// search's own terms, drawn as text. A web search's row is its record on the
// turn, never its receipt: the engine by its kind, the query as a
// child of `<q><bdi>`, and on a search that returned, the count and, for a
// billed engine, the cost as reported or that none was.
//
// It flows at full height when open, with no scroll of its own: a nested
// scroll traps the wheel and runs a second "follow the bottom" rule against
// the transcript's.

export interface AiTraceProps {
  turn: ChatTurn;
  /** Live catalogue titles by source id. */
  titles: ReadonlyMap<string, string>;
  /** This turn is the one being written; its live line is the turn's foot. */
  live?: boolean;
  onOpenSource: (sourceId: string) => void;
}

export default function AiTrace({
  turn,
  titles,
  live = false,
  onOpenSource,
}: AiTraceProps) {
  const { t } = useTranslation();
  const trace = traceOf(turn);
  // The one join the line's counts also read (`traceRows`), so the fold draws
  // exactly the rows the line counts. Live, a search still out is the foot's
  // to say, not a row here.
  const steps = traceRows(turn, { live });
  const thought = steps.some((step) => step.reasoning || step.text);
  const content = thought || steps.some((step) => step.rows.length > 0);

  if (live && !content) return null;
  // A fixed noun while live, never the live words, which would be the run's
  // second voice, and a visible one, so the fold has a name for
  // assistive tech too.
  const line = live
    ? t("dock.traceLive")
    : ladder(t, traceFacts(turn), turn.elapsedMs);
  if (!line) return null;
  if (!content) return <p className="ai-trace-line">{line}</p>;

  return (
    <Disclosure className="ai-trace" summary={line}>
      {/* No caveat over the working: the fold is closed by default, drawn
          quiet and above the answer, which already says it is not the
          answer. The one note is the fact the writer cannot see for
          themselves, that its start was cut. */}
      {thought && trace?.trimmed ? (
        <p className="ai-trace-note">{t("dock.reasoning.trimmed")}</p>
      ) : null}
      <div className="ai-trace-body">
        {steps.map((step, index) => (
          <div className="ai-trace-step" key={index}>
            {step.reasoning ? (
              <p className="ai-trace-thought">{step.reasoning}</p>
            ) : null}
            {step.text ? <p className="ai-trace-thought">{step.text}</p> : null}
            {step.rows.map((row, at) =>
              row.kind === "tool" ? (
                <ToolRow
                  key={row.receipt.callId}
                  receipt={row.receipt}
                  titles={titles}
                  onOpenSource={onOpenSource}
                />
              ) : (
                // A search's attempts share its call id; the position keeps
                // a retry's row apart from the refusal before it.
                <WebRow
                  key={`${row.record.callId}:${at}`}
                  record={row.record}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </Disclosure>
  );
}

function ToolRow({
  receipt,
  titles,
  onOpenSource,
}: {
  receipt: ToolReceipt;
  titles: ReadonlyMap<string, string>;
  onOpenSource: (sourceId: string) => void;
}) {
  const { t } = useTranslation();
  const title = receipt.sourceId ? titles.get(receipt.sourceId) : undefined;
  // A failed read may have no `sourceId` on its receipt, so it is named from
  // what the call asked for: the title when that id is a real source (a
  // chapter whose range was wrong), else the id itself, cleaned for display,
  // because "Couldn't read a source" names nothing. Only a failed one: a
  // read that succeeded is never named by its id, which there is plumbing,
  // while on a failure the string the model sent is the one fact that says
  // what went wrong.
  const asked =
    receipt.status === "error"
      ? requestedSourceId(receipt.arguments)
      : undefined;
  const subject =
    receipt.name === "read_source"
      ? (title ??
        (asked ? (titles.get(asked) ?? shownSourceId(asked)) : undefined))
      : receipt.name === "use_skill"
        ? skillWord(receipt.arguments)
        : searchedTerms(receipt.arguments);
  const words = toolPhrase(
    t,
    receipt.status === "ok" ? "did" : "failed",
    receipt.name,
    subject,
  );
  const glyph = (
    <Icon
      name={GLYPHS[receipt.name as ToolName]}
      size={11}
      aria-hidden="true"
    />
  );
  // A read of a source the catalogue still names is a link to it; every
  // other row is a fact. Same look either way, so the two are one family.
  if (
    receipt.name === "read_source" &&
    receipt.status === "ok" &&
    receipt.sourceId &&
    title !== undefined
  ) {
    const sourceId = receipt.sourceId;
    return (
      <button
        type="button"
        className="ai-evidence ai-trace-row"
        onClick={() => onOpenSource(sourceId)}
      >
        {glyph}
        <span>{words}</span>
      </button>
    );
  }
  return (
    <p className="ai-evidence ai-trace-row is-fact">
      {glyph}
      <span>{words}</span>
    </p>
  );
}

/**
 * One attempt at a web search. A search that returned says what came back
 * on a second line, because at 280px the engine and the query take the
 * first. A declined attempt names no query, because it never left.
 */
function WebRow({ record }: { record: WebSearchRecord }) {
  const { t, i18n } = useTranslation();
  const engine = engineLabel(record.engine);
  const words =
    record.status === "declined"
      ? webPhrase(t, "declined", engine)
      : webPhrase(
          t,
          record.status === "searched" ? "did" : "failed",
          engine,
          record.query,
        );
  const facts =
    record.status === "searched"
      ? [
          // What this search found: its own results and, on a `/verify` row,
          // the ones already on screen under an earlier row. "0 results" for
          // pages in front of the writer would be a false fact.
          t("dock.web.results", {
            count: record.results.length + (record.repeated ?? 0),
          }),
          // Never $0 for money that was spent, never a list price: the
          // figure as the engine reported it, or that it did not.
          ...(engineFacts(record.engine).billed
            ? [
                record.costUsd === undefined
                  ? t("dock.web.costNotReported")
                  : formatUsd(record.costUsd, i18n.language),
              ]
            : []),
        ].join(" · ")
      : null;
  return (
    <p className="ai-evidence ai-trace-row is-fact is-web">
      <Icon name={GLYPHS.web_search} size={11} aria-hidden="true" />
      <span title={record.status === "declined" ? undefined : record.query}>
        {words}
      </span>
      {facts ? <small>{facts}</small> : null}
    </p>
  );
}

const GLYPHS: Record<ToolName, IconName> = {
  list_sources: appIcons.list,
  grep: appIcons.search,
  read_source: appIcons.section,
  inspect_structure: appIcons.structure,
  submit_findings: appIcons.section,
  // A web search's rows are drawn from `turn.web` (`WebRow`), never from its
  // receipt, which carries nothing to draw.
  web_search: appIcons.search,
  use_skill: appIcons.palette,
  leave_comments: appIcons.comment,
};

/** The command a `use_skill` call named, as the writer would type it. */
function skillWord(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const skill = (args as Record<string, unknown>).skill;
  return typeof skill === "string" && /^[a-z]+(?:-[a-z]+)*$/.test(skill)
    ? `/${skill}`
    : undefined;
}

/**
 * The folded line of a finished run: what it did, strongest evidence first,
 * and how long it took, last. Reasoning gets its own rung only when it is the
 * only fact: "Thought for 14s" is false for a run that read and never
 * reasoned, and redundant beside "Read 2 sources" for one that did both.
 */
function ladder(
  t: TFunction,
  facts: TraceFacts,
  elapsedMs: number | undefined,
): string | null {
  const duration =
    elapsedMs === undefined
      ? undefined
      : formatElapsed(t, wholeSeconds(elapsedMs));
  const rungs: string[] = [];
  if (facts.read) rungs.push(t("dock.trail.read", { count: facts.read }));
  if (facts.searchedProject) rungs.push(t("dock.trail.searched"));
  // The engines whose searches returned, by name: never "the web" for a run
  // that only searched Wikipedia.
  if (facts.webEngines.size > 0)
    rungs.push(
      t(
        `dock.trail.web.${
          facts.webEngines.size > 1 ? "both" : [...facts.webEngines][0]
        }`,
      ),
    );
  if (facts.listed) rungs.push(t("dock.trail.listed"));
  if (facts.structure) rungs.push(t("dock.trail.structure"));
  if (facts.findings) rungs.push(t("dock.trail.findings"));
  if (facts.failed) rungs.push(t("dock.trail.failed", { count: facts.failed }));
  if (rungs.length === 0 && facts.thought)
    return duration
      ? t("dock.trail.thoughtFor", { duration })
      : t("dock.trail.thought");
  if (duration) rungs.push(duration);
  return rungs.length > 0 ? rungs.join(" · ") : null;
}
