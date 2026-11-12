// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Disclosure, Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import type {
  EvidenceAnchor,
  MapArc,
  MapNode,
  MapOutcome,
  MapPassages,
  MapShapeId,
} from "../../ai/domain/types";
import Widen, { blockedOf } from "../components/Widen";
import {
  TITLE_SLOT,
  consideredLine,
  fitNote,
  issuesLede,
  mapFollowUp,
  mapGroups,
  mapHeader,
  mapTransit,
  markOf,
  nodeTitle,
  nonePlaced,
  parentOf,
  passageHead,
  rowKey,
  sectionLines,
  shapeWords,
  type FitNote,
  type LiveStructure,
  type MapFollowUp,
  type MapMark,
} from "./mapAnswer";
import AiMapFigure, { AiMapRuler } from "./AiMapFigure";

// What `/map` found, as rows: the header, the Issues under a fixed
// lede, the nodes already working in a fold, the coverage line and one button.
// The figure draws above the Issues.
//
// Every string a writer or a model wrote (a title, a reason, a quote, the
// model's name) is a React text node inside a `<bdi>`: never markup, never
// a value interpolated into a translated string, so model output cannot
// inject markup, and isolated so a right-to-left title cannot reorder the
// app's words around it. The rows are the controls: a title opens its node
// while the node is in the Structure, a quote lands on its passage, and both
// are re-checked against the live catalogue at the click, so a stale answer
// cannot land on a node that is gone.

const MARK_ICON = {
  full: appIcons.fitFull,
  partly: appIcons.fitPartly,
  none: appIcons.fitNone,
} as const satisfies Record<MapMark, unknown>;

const MARK_WORD = {
  full: "dock.map.verdict.fits",
  partly: "dock.map.verdict.partly",
  none: "dock.map.verdict.no",
} as const satisfies Record<MapMark, string>;

export default function AiMapAnswer({
  mapped,
  titles,
  live,
  model,
  onOpenSource,
  onShowEvidence,
  onComplete,
  onMapWith,
  transitProvider,
  stillMissing,
  lifted = false,
}: {
  mapped: MapOutcome;
  titles: ReadonlyMap<string, string>;
  /** The live Structure, once read; undefined says nothing about staleness. */
  live?: LiveStructure;
  /** Who answered, for "… placed none of the n Parts". */
  model: string;
  onOpenSource: (sourceId: string) => void;
  onShowEvidence: (anchor: EvidenceAnchor) => void;
  /** Summarise and map again, or map again. Absent while anything runs. */
  onComplete?: () => void;
  /**
   * Map the same scope on the shape the fit note names, as a new turn with
   * the literal command; this answer is never replaced. Absent while
   * anything runs.
   */
  onMapWith?: (shape: MapShapeId) => void;
  transitProvider?: string;
  stillMissing?: (sourceIds: readonly string[]) => readonly string[];
  /** The chat asks another model than the one that answered. */
  lifted?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const header = mapHeader(mapped, titles, live, t);
  const fit = fitNote(mapped, t);
  // One answer to "which button", read by the button and by the figure, which
  // dims once the book has moved past it. The rows stay at full contrast,
  // since they are still what the answer said.
  const followUp = mapFollowUp(mapped, live, stillMissing, lifted);
  const stale = typeof followUp === "object" && followUp?.kind === "changed";
  // The Sections this model could not summarise: said while the
  // answer is current and the chat keeps the model, never on a moved map.
  const count =
    mapped.kind === "arc" && followUp !== "pending" && !stale
      ? blockedOf(mapped.coverage.skipped, lifted)
      : 0;
  const blocked =
    count > 0 ? t("dock.map.unsummarisable", { count }) : undefined;
  const language = i18n.language?.startsWith("it") ? "it" : "en";
  return (
    <div className="ai-map">
      <p className="ai-lede">
        <Slotted
          text={header.text}
          value={
            header.part ? (
              <>
                {header.part.title}
                {header.part.gone ? ` (${t("dock.map.gone")})` : null}
              </>
            ) : null
          }
        />
      </p>
      {mapped.kind === "arc" ? (
        <ArcBody
          mapped={mapped}
          titles={titles}
          live={live}
          model={model}
          stale={stale}
          fit={fit}
          language={language}
          onOpenSource={onOpenSource}
          onShowEvidence={onShowEvidence}
        />
      ) : null}
      {mapped.kind === "passages" ? (
        <PassagesBody
          mapped={mapped}
          model={model}
          stale={stale}
          // A quote is a link only while the map stands: read, and the
          // Section unchanged, so a stale quote cannot land on moved prose.
          // The click checks again.
          noFollowUp={followUp === null}
          onShowEvidence={onShowEvidence}
        />
      ) : null}
      <MapFollowUpBlock
        followUp={followUp}
        blocked={blocked}
        fit={fit}
        model={model}
        section={mapped.kind !== "arc"}
        onComplete={onComplete}
        onMapWith={onMapWith}
        transitProvider={transitProvider}
      />
      {/* A Section read for its fit alone, with no structure to try: the
          words that would mark its beats. */}
      {mapped.kind === "fit" && !fit?.mapWith ? (
        <p className="dock-hint">
          {t("dock.map.noStructureSection", shapeWords(language))}
        </p>
      ) : null}
    </div>
  );
}

/** An arc's body: its figure, the Issues, what works, the coverage. */
function ArcBody({
  mapped,
  titles,
  live,
  model,
  stale,
  fit,
  language,
  onOpenSource,
  onShowEvidence,
}: {
  mapped: MapArc;
  titles: ReadonlyMap<string, string>;
  live?: LiveStructure;
  model: string;
  stale: boolean;
  fit: FitNote | null;
  language: "en" | "it";
  onOpenSource: (sourceId: string) => void;
  onShowEvidence: (anchor: EvidenceAnchor) => void;
}) {
  const { t } = useTranslation();
  const groups = mapGroups(mapped);
  const placedAny =
    groups.issues.length + groups.working.length + groups.readings.length > 0;
  const considered = consideredLine(mapped, t);
  const row = (node: MapNode) => (
    <MapRow
      key={node.sourceId}
      node={node}
      mapped={mapped}
      titles={titles}
      live={live}
      onOpenSource={onOpenSource}
      onShowEvidence={onShowEvidence}
    />
  );
  return (
    <>
      <AiMapFigure mapped={mapped} stale={stale} />
      {placedAny ? null : (
        <p className="ai-lede">
          <Slotted text={nonePlaced(groups, TITLE_SLOT, t)} value={model} />
        </p>
      )}
      {groups.readings.length > 0 ? (
        <ol className="ai-findings">{groups.readings.map(row)}</ol>
      ) : null}
      {groups.issues.length > 0 ? (
        <>
          <p className="ai-lede">{issuesLede(groups, t)}</p>
          <ol className="ai-findings">{groups.issues.map(row)}</ol>
        </>
      ) : null}
      {groups.working.length > 0 ? (
        // Starts closed under a list of issues and open when there is
        // nothing else to read; after that, the writer decides.
        <Disclosure
          className="ai-map-working"
          summary={t("dock.map.alreadyWorking", {
            count: groups.working.length,
          })}
          defaultOpen={groups.issues.length === 0}
        >
          <ol className="ai-findings">{groups.working.map(row)}</ol>
        </Disclosure>
      ) : null}
      {considered ? <p className="dock-hint">{considered}</p> : null}
      {/* A reading with no fit note teaches the words that turn it into a
          comparison; with one, the note is that next step. The words come
          from the parser's own table. */}
      {groups.readings.length > 0 && !fit ? (
        <p className="dock-hint">
          {t("dock.map.noStructure", shapeWords(language))}
        </p>
      ) : null}
    </>
  );
}

/**
 * A Section's body: its ruler, then the beats found, in the shape's order,
 * with no Issues split, since a found beat is a claim about where it begins,
 * not a verdict. Then the beats not in the Section and, on the coverage
 * line, the ones never placed. With nothing found but something missing,
 * the missing line takes the lede under the ruler.
 */
function PassagesBody({
  mapped,
  model,
  stale,
  noFollowUp,
  onShowEvidence,
}: {
  mapped: MapPassages;
  model: string;
  stale: boolean;
  noFollowUp: boolean;
  onShowEvidence: (anchor: EvidenceAnchor) => void;
}) {
  const { t } = useTranslation();
  const lines = sectionLines(mapped, TITLE_SLOT, t);
  const found = mapped.passages.flatMap((one) =>
    one.state === "found" ? [one] : [],
  );
  return (
    <>
      <AiMapRuler mapped={mapped} stale={stale} />
      {lines.none ? (
        <p className="ai-lede">
          <Slotted text={lines.none} value={model} />
        </p>
      ) : null}
      {found.length === 0 && lines.missing ? (
        <p className="ai-lede">{lines.missing}</p>
      ) : null}
      {found.length > 0 ? (
        <ol className="ai-findings">
          {found.map((one) => (
            <li key={one.beat} className="ai-finding ai-map-row">
              <span className="ai-finding-head">
                <span>{passageHead(mapped.shape, one, t)}</span>
              </span>
              <p className="ai-finding-body">
                <bdi>{one.reason}</bdi>
              </p>
              {/* The small says where, not whose: the header already names
                  the Section. */}
              <Quote
                anchor={one.anchor}
                source={{ title: t("dock.map.startsHere"), gone: false }}
                live={noFollowUp}
                onShow={onShowEvidence}
              />
            </li>
          ))}
        </ol>
      ) : null}
      {found.length > 0 && lines.missing ? (
        <p className="dock-hint">{lines.missing}</p>
      ) : null}
      {lines.unanswered ? (
        <p className="dock-hint">
          <Slotted text={lines.unanswered} value={model} />
        </p>
      ) : null}
    </>
  );
}

/** The fit note's line: the app's frame with the model's name, then its why. */
function FitLine({ fit, model }: { fit: FitNote; model: string }) {
  return (
    <>
      <Slotted text={fit.text} value={model} />
      <br />
      <bdi>{fit.reason}</bdi>
    </>
  );
}

/**
 * The one button, in `mapFollowUp`'s precedence (changed, summarise, out of
 * date, fit), drawn by the shared `Widen`. Lowest is "Map with this structure"
 * under the fit note that names the structure. The note is said whichever
 * button wins; it only loses its button. Nothing but the note while the
 * Structure is still being read.
 */
function MapFollowUpBlock({
  followUp,
  blocked,
  fit,
  model,
  section,
  onComplete,
  onMapWith,
  transitProvider,
}: {
  followUp: MapFollowUp | null;
  /** What no click can widen, first in the block (`Widen`'s slot). */
  blocked?: string;
  fit: FitNote | null;
  model: string;
  /** A Section map: its own transit line and its own "changed" words. */
  section: boolean;
  onComplete?: () => void;
  onMapWith?: (shape: MapShapeId) => void;
  transitProvider?: string;
}) {
  const { t } = useTranslation();
  const transit = (kind: "summarise" | "again") =>
    transitProvider ? mapTransit(kind, transitProvider, t, section) : undefined;
  const note = fit ? (
    <p className="dock-hint">
      <FitLine fit={fit} model={model} />
    </p>
  ) : null;
  if (followUp === null || followUp === "pending") {
    const shape = followUp === null ? fit?.mapWith : null;
    return shape ? (
      <Widen
        blocked={blocked}
        note={<FitLine fit={fit as FitNote} model={model} />}
        transit={transit("again")}
        action={t("dock.map.fit.mapWith")}
        onOpen={onMapWith ? () => onMapWith(shape) : undefined}
      />
    ) : blocked ? (
      <Widen
        blocked={blocked}
        note={fit ? <FitLine fit={fit} model={model} /> : undefined}
      />
    ) : (
      note
    );
  }
  return (
    <>
      {note}
      <HigherFollowUp
        followUp={followUp}
        blocked={blocked}
        section={section}
        onComplete={onComplete}
        transit={transit}
      />
    </>
  );
}

/** The three buttons that outrank the fit note's. */
function HigherFollowUp({
  followUp,
  blocked,
  section,
  onComplete,
  transit,
}: {
  followUp: Exclude<MapFollowUp, "pending">;
  blocked?: string;
  section: boolean;
  onComplete?: () => void;
  transit: (kind: "summarise" | "again") => string | undefined;
}) {
  const { t } = useTranslation();
  if (followUp.kind === "summarise")
    return (
      <Widen
        blocked={blocked}
        note={t("dock.map.noSummary", { count: followUp.unmapped })}
        transit={transit("summarise")}
        action={t("dock.map.summariseMissing", { count: followUp.missing })}
        onOpen={onComplete}
      />
    );
  if (followUp.kind === "outOfDate")
    return (
      <Widen
        blocked={blocked}
        note={t("dock.map.answerOutOfDate")}
        transit={transit("again")}
        action={t("dock.map.mapAgain")}
        onOpen={onComplete}
      />
    );
  // The Part or Section a map of one node covers is gone: the note says so,
  // with no button, since there is nothing left to map. A Section map changes
  // with its own prose, never with the Structure.
  return followUp.canMapAgain ? (
    <Widen
      note={t(
        section ? "dock.map.sectionChanged" : "dock.map.structureChanged",
      )}
      transit={transit("again")}
      action={t("dock.map.mapAgain")}
      onOpen={onComplete}
    />
  ) : (
    <Widen
      note={t(section ? "dock.map.sectionGone" : "dock.map.partGone")}
      action={t("dock.map.mapAgain")}
    />
  );
}

/**
 * One node, in the finding row's grammar: the head (mark, the figure's key,
 * "out of sequence"), the title, the model's line, the verified quote. No
 * Resolve or Dismiss: a placement is a reading, not a task.
 */
function MapRow({
  node,
  mapped,
  titles,
  live,
  onOpenSource,
  onShowEvidence,
}: {
  node: MapNode;
  mapped: MapArc;
  titles: ReadonlyMap<string, string>;
  live?: LiveStructure;
  onOpenSource: (sourceId: string) => void;
  onShowEvidence: (anchor: EvidenceAnchor) => void;
}) {
  const { t } = useTranslation();
  const mark = markOf(node, mapped.shape);
  const key = rowKey(node, mapped, t);
  const { title, gone } = nodeTitle(node, titles, live);
  // A Hero's Journey Section reads with its Part in small, on a map of the
  // whole Structure; a map of one Part names the Part in its header.
  const parent =
    mapped.shape === "herosjourney" && mapped.scope.kind === "structure"
      ? parentOf(node, mapped)
      : undefined;
  const parentTitle = parent ? nodeTitle(parent, titles, live) : undefined;
  const head = [key, node.outOfOrder ? t("dock.map.outOfOrder") : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="ai-finding ai-map-row">
      {mark || head ? (
        <span className="ai-finding-head">
          {mark ? (
            <>
              <Icon
                name={MARK_ICON[mark]}
                size={12}
                className={`ai-mark is-${mark}`}
                aria-hidden="true"
              />
              {/* Glyph and colour, and the word for a screen reader: a mark
                  is never colour alone. */}
              <span className="ui-visually-hidden">{t(MARK_WORD[mark])}</span>
            </>
          ) : null}
          {head ? <span>{head}</span> : null}
        </span>
      ) : null}
      <p className="ai-finding-title">
        {/* A button only while the node is in the Structure: a gone node
            is text, because a click could land nowhere. */}
        {live && !gone ? (
          <button
            type="button"
            className="ai-cite"
            onClick={() => onOpenSource(node.sourceId)}
          >
            <bdi>{title}</bdi>
          </button>
        ) : (
          <bdi>{title}</bdi>
        )}
        {gone ? (
          <small className="ai-map-part"> · {t("dock.map.gone")}</small>
        ) : null}
        {parentTitle ? (
          // Marked when gone, as Copy marks it: one resolver, one fact.
          <small className="ai-map-part">
            {" "}
            <bdi>{parentTitle.title}</bdi>
            {parentTitle.gone ? ` · ${t("dock.map.gone")}` : null}
          </small>
        ) : null}
      </p>
      {node.reason ? (
        <p className="ai-finding-body">
          <bdi>{node.reason}</bdi>
        </p>
      ) : null}
      {node.anchor ? (
        <Quote
          anchor={node.anchor}
          // The quote names the Section it is from: for a Part's issue, one
          // of its Sections, as the answer drew it.
          source={nodeTitle(
            mapped.nodes.find((n) => n.sourceId === node.anchor?.sourceId) ??
              node,
            titles,
            live,
          )}
          // A click target only once the Structure is read and while both
          // the row's node and the quoted Section are in it, as the title.
          // The click is re-checked as well.
          live={!!live && !gone && live.nodeIds.has(node.anchor.sourceId)}
          onShow={onShowEvidence}
        />
      ) : null}
    </li>
  );
}

/** A verified quote: the link to its passage, or its words once it has none. */
function Quote({
  anchor,
  source,
  live,
  onShow,
}: {
  anchor: EvidenceAnchor;
  source: { title: string; gone: boolean };
  live: boolean;
  onShow: (anchor: EvidenceAnchor) => void;
}) {
  const { t } = useTranslation();
  // No glyph on a live row. A Section that is gone says so in words,
  // as the node rows do, rather than by a missing arrow.
  const body = (
    <>
      <span>
        <bdi>{anchor.quote}</bdi>
      </span>
      <small>
        <bdi>{source.title}</bdi>
        {source.gone ? ` · ${t("dock.map.gone")}` : null}
      </small>
    </>
  );
  return live ? (
    <button
      type="button"
      className="ai-evidence"
      onClick={() => onShow(anchor)}
    >
      {body}
    </button>
  ) : (
    <p className="ai-evidence is-still">{body}</p>
  );
}

/**
 * A translated line with one writer- or model-written value in it, placed as
 * its own `<bdi>` where the template holds `TITLE_SLOT`, so the value is a
 * text node and never part of a string interpolated into markup.
 */
function Slotted({ text, value }: { text: string; value: ReactNode }) {
  const at = text.indexOf(TITLE_SLOT);
  if (at < 0 || value === null) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <bdi>{value}</bdi>
      {text.slice(at + TITLE_SLOT.length)}
    </>
  );
}
