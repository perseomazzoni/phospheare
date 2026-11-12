// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon, SpineGlyph } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import { findParent, isDescendant, nodeOfFile } from "../../project/structure";
import type {
  DocumentProperties,
  DocumentStructure,
  WritingSession,
} from "../../project/types";
import type { Paragraph, Run } from "../engine";
import { firstOpenable } from "../desk";
import type { OpenThread } from "../desk";
import { ledger } from "../deskLedger";
import { overrunPercent } from "../../ui/spineLayout";
import { spineRules } from "../decorations/domain/spineRules";
import SpineRules from "../decorations/presentation/SpineRules";

// The Desk: where the editor opens. Every band serves re-entry into a
// writing session. Opening the first Section would arm a file the writer did
// not choose; opening the last one straight into prose skips the moment
// context is cheapest to give; a screen of statistics asks the writer to
// manage the project instead of write it.
//
// Four bands, in the order re-entry happens: what was last written, the shape
// of the whole, what has changed, and what was left unfinished.
//
// AI may enrich the Desk but never makes it up. The open thread is found by a
// convention writers already use, so a writer with no assistant gets a
// complete Desk.

export interface DeskProps {
  structure: DocumentStructure;
  props: DocumentProperties;
  /**
   * The Section the writer last had open, and its last paragraph, parsed so
   * the band renders the writer's formatting instead of leaking raw markers
   * (`{align:center}#` is a heading, not text).
   */
  resume: { fileName: string; para: Paragraph } | null;
  thread: OpenThread | null;
  /** Where this sitting began, already settled by `sessionFor`. */
  session: WritingSession;
  /**
   * `resume` is set only by "Continue writing": every other way in opens on
   * the first row, and only that one lands at the end.
   */
  onOpen: (fileName: string, resume?: boolean) => void;
  /** Widen the panel and look around instead of resuming. */
  onBrowse?: () => void;
  /**
   * How the theme draws the shape: the spine's glyph, or rules and leaders
   * as a contents page sets them.
   */
  spineStyle?: "glyph" | "rules";
}

export default function Desk({
  structure,
  props,
  resume,
  thread,
  session,
  onOpen,
  onBrowse,
  spineStyle = "glyph",
}: DeskProps) {
  const { t, i18n } = useTranslation();
  const stats = props.stats;

  // Absolute, the way the ledger reads: "since Tuesday", "last Tue 21:14".
  // Two Intl calls joined by a space rather than one: the single form inserts
  // a comma in some locales ("Tue, 21:14"), and this line is evidence, not a
  // sentence.
  const fmt = useMemo(
    () => ({
      weekdayLong: new Intl.DateTimeFormat(i18n.language, { weekday: "long" }),
      weekdayShort: new Intl.DateTimeFormat(i18n.language, {
        weekday: "short",
      }),
      time: new Intl.DateTimeFormat(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    }),
    [i18n.language],
  );
  /** "Tuesday": the day this sitting began. */
  const sinceOn = (stamp: string | null) =>
    stamp && !Number.isNaN(Date.parse(stamp))
      ? fmt.weekdayLong.format(new Date(stamp))
      : null;
  /** "Tue 21:14": the last time anything was saved. */
  const lastAt = (stamp: string | null) => {
    if (!stamp || Number.isNaN(Date.parse(stamp))) return null;
    const at = new Date(stamp);
    return `${fmt.weekdayShort.format(at)} ${fmt.time.format(at)}`;
  };
  const project = useMemo(() => ledger(stats, session), [stats, session]);
  // How far past the goal the project has run, as a whole percent, from the
  // overrun formula the spine's fill shares (`overrunPercent` in
  // `spineLayout.ts`), so the badge and the drawing agree. Null at or under
  // goal, or with no goal.
  const overGoalPct = overrunPercent(stats.words, props.document.goal);
  // Where the writer was, named as the tree names it: the Section is the
  // destination, and the Part above it orients a writer coming back. A
  // Section at the project's root has no Part, and its name alone is complete.
  const resumeWhere = useMemo(
    () => (resume ? parentLabel(structure, resume.fileName) : null),
    [structure, resume],
  );

  // The Part the writer left off in, which the glyph marks for a theme that
  // draws the open Part apart.
  const resumePart = useMemo(() => {
    const node = resume ? nodeOfFile(structure, resume.fileName) : null;
    if (!node) return null;
    const part = structure.children.find(
      (child) =>
        child.kind === "part" &&
        (child.id === node.id || isDescendant(structure, child.id, node.id)),
    );
    return part?.id ?? null;
  }, [structure, resume]);

  // The thread names the Section it is in ("a marker in The Crossing"). Its
  // own file stamp wins; the resume's file stands in when a caller did not
  // stamp one, since both are read from the same file.
  const threadFile = thread?.fileName ?? resume?.fileName ?? null;
  const threadTitle = threadFile ? titleOf(structure, threadFile) : null;

  // Where the writer can start: the first Section in reading order, or the
  // first Part when there are no Sections yet (a fresh project's shapes are
  // empty Parts). Null only for a project with no nodes at all.
  const first = firstOpenable(structure);

  const rules = useMemo(
    () =>
      spineStyle === "rules"
        ? spineRules(
            structure,
            stats,
            props.document.goal,
            resume?.fileName ?? null,
          )
        : null,
    [spineStyle, structure, stats, props.document.goal, resume?.fileName],
  );

  // A project with no words yet gets its own screen: the resume band and the
  // ledger have nothing to draw on, so the copy invites the first words
  // instead of listing the absence.
  if (stats.words === 0) {
    return (
      <div className="desk">
        <div className="desk-empty">
          <h2>{t("desk.emptyTitle")}</h2>
          <p>{emptyBody(t, stats.parts, stats.sections)}</p>
          {first ? (
            <button
              type="button"
              className="desk-primary"
              onClick={() => onOpen(first.adopted)}
            >
              <Icon name={appIcons.edit} size={15} />
              {t("desk.start", { title: first.title })}
            </button>
          ) : (
            // A project with no nodes has no page to start on. The structure
            // is where one is made, and on a folded panel or a phone the
            // writer cannot see it, so this button leads there; it exists
            // when the add labels are hidden (`onBrowse`).
            onBrowse && (
              <button type="button" className="desk-primary" onClick={onBrowse}>
                <Icon name={appIcons.structure} size={15} />
                {t("desk.buildStructure")}
              </button>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="desk">
      {/* ── What you last wrote ─────────────────────────────────────────────
          The actual last sentence, not a summary: reading their own last
          line is how writers resume. It keeps the writer's formatting as the
          editor renders it, and the markers never reach the eye. */}
      {resume && (
        <section>
          <p className="desk-eyebrow">
            {`${t("desk.whereYouLeftOff")} · `}
            <span className="desk-where">{resumeWhere}</span>
          </p>
          <blockquote className="desk-last">
            <ResumeLine para={resume.para} />
          </blockquote>
          <div className="desk-actions">
            <button
              type="button"
              className="desk-primary"
              onClick={() => onOpen(resume.fileName, true)}
            >
              <Icon name={appIcons.edit} size={15} />
              {t("desk.continue")}
            </button>
            {/* Quiet, because resuming is the common case, but present,
                because going somewhere else is why the Desk opens instead of
                the last Section. */}
            {onBrowse && (
              <button type="button" className="desk-quiet" onClick={onBrowse}>
                {t("desk.browse")}
              </button>
            )}
          </div>
        </section>
      )}

      {/* No line to return to, but a project with structure still has a
          page to start on, and the writer never faces this screen without a
          way in. The quiet lead names the absence; the button opens the
          first openable node. */}
      {!resume && first && (
        <section>
          <p className="desk-eyebrow">{t("desk.noPlaceToReturn")}</p>
          <div className="desk-actions">
            <button
              type="button"
              className="desk-primary"
              onClick={() => onOpen(first.adopted)}
            >
              <Icon name={appIcons.edit} size={15} />
              {t("desk.start", { title: first.title })}
            </button>
          </div>
        </section>
      )}

      {/* ── The shape of it ─────────────────────────────────────────────────
          The project as a shape, not a chart. The bar is the goal: every Part
          an equal share of it, its Sections at their true size inside it,
          the unused capacity hatched behind them. The last session's work is
          a written or cut mark on each Section it touched. */}
      <section>
        <p className="desk-eyebrow">{t("desk.shape")}</p>
        {rules ? (
          <SpineRules rules={rules} title={props.document.title} />
        ) : (
          <SpineGlyph
            structure={structure}
            stats={stats}
            height={54}
            labels
            counts
            title={props.document.title}
            goal={props.document.goal}
            deltas
            currentPart={resumePart}
          />
        )}
      </section>

      {/* ── The ledger ──────────────────────────────────────────────────────
          Numbers sit here, subordinate, in the evidence voice the app uses
          for every count, with the delta first: a total reads the same every
          morning, and what has changed is news. `deskLedger.ts` decides where
          a session starts and stops. */}
      <p className="desk-ledger">
        {/* The "since" line always stands: it answers "when was I here". The
            delta beside it prints only when the sitting has something in it,
            so a fresh sitting does not report a zero. */}
        {project.since && (
          <span>{t("desk.since", { when: sinceOn(project.since) })}</span>
        )}
        {/* Each run of words is one text, its space with it: a line split
            into pieces is shaped piece by piece, and its glyphs land a
            fraction away from where the whole would set them. */}
        {project.gained !== 0 && (
          <span>
            <b>
              {`${project.gained > 0 ? "+" : "−"}${Math.abs(project.gained).toLocaleString()}`}
            </b>
            {` ${t("desk.words")}`}
          </span>
        )}
        <span>
          <b>{project.sections}</b>
          {` ${t("desk.sections")}`}
        </span>
        {project.lastWrite && (
          <span>
            {`${t("desk.lastWrite")} `}
            <b>{lastAt(project.lastWrite)}</b>
          </span>
        )}
        <span>
          {t("desk.total", { total: project.words.toLocaleString() })}
        </span>
        {/* The spine fills at the goal; the overrun is said here rather than
            by rescaling every bar smaller. */}
        {overGoalPct !== null && (
          <span>{t("desk.overGoal", { pct: overGoalPct })}</span>
        )}
      </p>

      {/* ── One open thread ─────────────────────────────────────────────────
          Found in the file by a convention the writer already uses, not by a
          model. Absent when there is no marker, so the screen never guesses
          at one. */}
      {thread && (
        <p className="desk-thread">
          <Icon name={appIcons.info} size={16} />
          <span>
            {/* "You left a marker in The Crossing — ??? whose boat — three
                paragraphs from the end." The Section's name is the location;
                the marker, between em dashes, is the thing to look at. */}
            {threadTitle ? (
              <>
                {t("desk.threadLead")} <em>{threadTitle}</em>
              </>
            ) : (
              t("desk.threadLeadPlain")
            )}
            {" — "}
            <code>{thread.text}</code>
            {" — "}
            {thread.fromEnd === 0
              ? t("desk.threadAtEnd")
              : t("desk.threadPos", { count: thread.fromEnd })}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * The empty screen's line: the shape waiting for words, then the invite. A
 * zero count is omitted, never pluralized, and the per-noun keys carry the
 * verb so a single noun agrees in both languages.
 */
function emptyBody(
  t: (key: string, vars?: Record<string, unknown>) => string,
  parts: number,
  sections: number,
): string {
  // With no nodes there is nowhere to write and no start button (`first` is
  // null), so the invite names the structure panel instead of offering a
  // first line no page can hold.
  const invite =
    parts === 0 && sections === 0
      ? t("desk.emptyInviteNoNodes")
      : t("desk.emptyInvite");
  if (parts > 0 && sections > 0) {
    return `${t("desk.emptyBody", {
      parts: t("desk.countParts", { count: parts }),
      sections: t("desk.countSections", { count: sections }),
    })} ${invite}`;
  }
  if (parts > 0)
    return `${t("desk.emptyBodyParts", { count: parts })} ${invite}`;
  if (sections > 0)
    return `${t("desk.emptyBodySections", { count: sections })} ${invite}`;
  return invite;
}

/** A file's node's display name, or the file itself when no node claims it. */
function titleOf(structure: DocumentStructure, fileName: string): string {
  return nodeOfFile(structure, fileName)?.title ?? fileName;
}

/** "Part / Section", or just the Section when it has no Part above it. */
function parentLabel(structure: DocumentStructure, fileName: string): string {
  const node = nodeOfFile(structure, fileName);
  if (!node) return fileName;
  const part = findParent(structure, node.id);
  return part ? `${part.title} / ${node.title}` : node.title;
}

/**
 * The band's quotation of the writer's last paragraph.
 *
 * One `p`, never a real `h1` or `h2`, carrying the parsed block kind as
 * `data-kind`: a heading element would put a manuscript title into the
 * page's outline. The fake caret sits inline at the end of the text.
 */
function ResumeLine({ para }: { para: Paragraph }) {
  return (
    <p
      className="desk-last-line"
      data-kind={para.blockType}
      style={
        para.alignment === "left" ? undefined : { textAlign: para.alignment }
      }
    >
      {para.runs.map((run, i) => (
        <Run key={i} run={run} />
      ))}
      <span className="desk-caret" aria-hidden="true" />
    </p>
  );
}

/** One run of the writer's paragraph, wrapped in its own formatting. */
function Run({ run }: { run: Run }) {
  let node: ReactNode = run.text;
  // The renderer's nesting order: monospace innermost, then italic, then
  // bold. The three flags are independent, and a combination must render as
  // the editor renders it.
  if (run.format.monospace) node = <code>{node}</code>;
  if (run.format.italic) node = <em>{node}</em>;
  if (run.format.bold) node = <strong>{node}</strong>;
  return <>{node}</>;
}
