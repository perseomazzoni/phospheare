// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import { MAP_SHAPES } from "../../ai/domain/structureShapes";
import type { MapArc, MapPassages } from "../../ai/domain/types";
import {
  beatLabelKey,
  beatName,
  stageLabelKey,
  type MapMark,
} from "./mapAnswer";
import {
  FREYTAG_HEIGHT,
  HERO_BOX,
  HERO_RADIUS,
  figureOf,
  freytagLayout,
  heroLayout,
  kishotenketsuLayout,
  rulerLayout,
  threeActsLayout,
  type FigureMark,
  type MarkGroup,
} from "./mapLayout";

// The `/map` figure: the published convention as one quiet line, and
// the writer's nodes as the same degree-of-fit discs the rows carry. It sits
// above the Issues and moves nothing else in the answer.
//
// Not interactive, and hidden from assistive tech: the rows are the controls
// and say everything the drawing does, in words, in book order. A pointer-only
// second way to the same actions would be a second surface to keep correct.
// The caption, with its source and legend, stays readable.
//
// The lines are SVG stretched to the width (`preserveAspectRatio="none"`,
// strokes kept 1px by `vector-effect` in the stylesheet); every label, dot
// and disc is HTML placed by percentage, because stretched SVG text would
// squash in a 300px dock. Colours come from classes on the theme's tokens,
// never from attributes, and every class comes from a closed lookup, so no
// model output reaches an attribute. No text in the drawing is the writer's
// or the model's: beat names, numbers and discs are all the app's own.

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

/**
 * A label at `x`% that never leaves the figure: shifted left by the same
 * fraction of its own width, so it is left-aligned at 0, centred at 50 and
 * right-aligned at 100, with no measuring.
 */
function along(x: number): CSSProperties {
  return { left: `${x}%`, transform: `translateX(-${x}%)` };
}

/** A label centred on `x`%, for a point near no edge. */
function centred(x: number): CSSProperties {
  return { left: `${x}%`, transform: "translateX(-50%)" };
}

function Mark({ mark }: { mark: MapMark }) {
  return (
    <Icon name={MARK_ICON[mark]} size={12} className={`ai-mark is-${mark}`} />
  );
}

/** A disc's size and the gap between two, as `.ai-map-marks` draws them. */
const DISC = 12;
const DISC_GAP = 2;
/** Discs to a line before a group wraps: `.ai-map-marks`'s max-width. */
const DISCS_PER_LINE = 4;

/**
 * Several discs on one place, wrapping past four: centred on it wherever
 * they fit, and held in only where they would leave the figure (a group on
 * the pyramid's first or last corner). The discs are a fixed size, so the
 * group's width follows from its count, and the hold is a floor on its
 * centre's distance from the nearer edge, with no measuring. One flat
 * `max()` either side, rather than a `clamp()` of a `calc()`, gives the same
 * position in a form a test's DOM can read back. The labels' shift by x% of
 * their own width would pull a group off its station.
 */
function Marks({ group, top }: { group: MarkGroup; top?: number }) {
  const across = Math.min(group.marks.length, DISCS_PER_LINE);
  const half = (across * DISC + (across - 1) * DISC_GAP) / 2;
  const fromLeft = group.x <= 50;
  return (
    <span
      className="ai-map-marks"
      style={{
        ...(fromLeft
          ? { left: `max(${half}px, ${group.x}%)` }
          : { right: `max(${half}px, ${100 - group.x}%)` }),
        transform: `translate(${fromLeft ? "-50%" : "50%"}, -50%)`,
        ...(top === undefined ? {} : { top: `${top}px` }),
      }}
    >
      {group.marks.map((one: FigureMark) => (
        <Mark key={one.sourceId} mark={one.mark} />
      ))}
    </span>
  );
}

export default function AiMapFigure({
  mapped,
  stale,
}: {
  mapped: MapArc;
  /** The Structure has moved since: the drawing dims, the rows do not. */
  stale: boolean;
}) {
  const { t } = useTranslation();
  const kind = figureOf(mapped);
  if (!kind) return null;
  const beat = (id: string) => {
    const key = beatLabelKey(kind, id);
    return key ? t(key) : "";
  };
  const three = kind === "threeact" ? threeActsLayout(mapped) : null;
  return (
    <figure
      className={["ai-map-figure", `is-${kind}`, stale ? "is-stale" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="ai-map-drawing" aria-hidden="true">
        {three ? <ThreeActs layout={three} beat={beat} /> : null}
        {kind === "kishotenketsu" ? (
          <Kishotenketsu mapped={mapped} beat={beat} />
        ) : null}
        {kind === "freytagspyramid" ? (
          <Freytag mapped={mapped} beat={beat} />
        ) : null}
        {kind === "herosjourney" ? <Hero mapped={mapped} /> : null}
      </div>
      <figcaption className="dock-hint">
        <span>
          {t(`dock.map.caption.${kind}`)}
          {/* On a map of one Part the fields are its children, Sections or
              Parts. One caption serves every Part map, chosen by the scope,
              never by the mix of children. */}
          {three?.fields
            ? ` ${t(
                mapped.scope.kind === "node"
                  ? "dock.map.caption.threeactSharesUnits"
                  : "dock.map.caption.threeactShares",
              )}`
            : null}
        </span>
        {kind === "herosjourney" ? (
          <ol className="ai-map-legend">
            {(MAP_SHAPES.herosjourney.stages ?? []).map((stage) => {
              const key = stageLabelKey(stage.id);
              return <li key={stage.id}>{key ? t(key) : null}</li>;
            })}
          </ol>
        ) : null}
        <span className="ai-map-key">
          {(["full", "partly", "none"] as const).map((mark) => (
            <span key={mark}>
              <Mark mark={mark} /> {t(MARK_WORD[mark])}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}

/** A horizontal line across a stretched SVG, at `y` px. */
function Rule({ y }: { y: number }) {
  return <line x1={0} y1={y} x2={100} y2={y} className="ai-map-rule" />;
}

function ThreeActs({
  layout,
  beat,
}: {
  layout: ReturnType<typeof threeActsLayout>;
  beat: (id: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="ui-figure-labels">
        {layout.beats.map((one) => (
          <span key={one.id} style={along(one.labelAt)}>
            {beat(one.id)}
          </span>
        ))}
      </div>
      <svg
        className="ai-map-line"
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        focusable="false"
      >
        <Rule y={4} />
        {layout.ticks.map((x) => (
          <line
            key={x}
            x1={x}
            y1={0.5}
            x2={x}
            y2={7.5}
            className="ai-map-tick"
          />
        ))}
      </svg>
      <div className="ui-figure-labels">
        {layout.plotPoints.map((one) => (
          // Centred under its tick: the name of a point, not of a span.
          <span key={one.n} style={centred(one.x)}>
            {t(`dock.map.plotPoint${one.n}`)}
          </span>
        ))}
      </div>
      <div className="ui-figure-labels ai-map-parts">
        {layout.labels.map((one) => (
          <span
            key={one.sourceId}
            // On a bar, at the field's left edge, running past a narrow one
            // as the spine's numbers do, in a box from there to the figure's
            // edge that its content overflows leftward, so the last Part's
            // number stops at the edge rather than scrolling the answer.
            // On Field's line, centred.
            className={layout.fields ? "is-on-field" : undefined}
            style={
              layout.fields ? { left: `${one.x}%`, right: 0 } : centred(one.x)
            }
          >
            <span>
              {one.ordinal}
              {one.mark ? <Mark mark={one.mark} /> : null}
            </span>
          </span>
        ))}
      </div>
      {layout.fields ? (
        <svg
          className="ai-map-fields"
          viewBox="0 0 100 22"
          preserveAspectRatio="none"
          focusable="false"
        >
          {layout.fields.map((field) => (
            <rect
              key={field.sourceId}
              x={field.x}
              y={0.5}
              width={field.width}
              height={21}
              className={field.loose ? "ai-map-field is-loose" : "ai-map-field"}
            />
          ))}
        </svg>
      ) : null}
    </>
  );
}

function Kishotenketsu({
  mapped,
  beat,
}: {
  mapped: MapArc;
  beat: (id: string) => string;
}) {
  const layout = kishotenketsuLayout(mapped);
  return (
    <>
      <div className="ui-figure-labels">
        {layout.stations.map((one) => (
          <span key={one.id} style={along(one.x)}>
            {beat(one.id)}
          </span>
        ))}
      </div>
      <div className="ai-map-track">
        <svg
          className="ai-map-line"
          viewBox="0 0 100 16"
          preserveAspectRatio="none"
          focusable="false"
        >
          <Rule y={8} />
        </svg>
        {layout.stations.map((one) => (
          <span
            key={one.id}
            className="ai-map-station"
            style={{ left: `${one.x}%`, top: "8px" }}
          />
        ))}
        {layout.groups.map((group) => (
          <Marks key={group.x} group={group} top={8} />
        ))}
      </div>
    </>
  );
}

function Freytag({
  mapped,
  beat,
}: {
  mapped: MapArc;
  beat: (id: string) => string;
}) {
  const layout = freytagLayout(mapped);
  const station = (x: number) => layout.stations.find((one) => one.x === x);
  // The apex gets the stations' marks above the line, so the box starts one
  // mark's height above the triangle.
  const lift = 16;
  return (
    <>
      <div
        className="ai-map-pyramid"
        style={{ height: `${FREYTAG_HEIGHT + lift}px` }}
      >
        <svg
          className="ai-map-line"
          viewBox={`0 0 100 ${FREYTAG_HEIGHT}`}
          preserveAspectRatio="none"
          focusable="false"
          style={{ top: `${lift}px`, height: `${FREYTAG_HEIGHT}px` }}
        >
          <polyline
            points={`0,${FREYTAG_HEIGHT} 50,0 100,${FREYTAG_HEIGHT}`}
            className="ai-map-rule"
          />
          {layout.forces.map((force) => (
            <line
              key={force.kind}
              x1={force.x}
              y1={force.y - 3.5}
              x2={force.x}
              y2={force.y + 3.5}
              className={
                force.necessary ? "ai-map-force is-necessary" : "ai-map-force"
              }
            />
          ))}
        </svg>
        {layout.stations.map((one) => (
          <span
            key={one.id}
            className="ai-map-station"
            style={{ left: `${one.x}%`, top: `${one.y + lift}px` }}
          />
        ))}
        {layout.groups.map((group) => (
          <Marks
            key={group.x}
            group={group}
            top={(station(group.x)?.y ?? 0) + lift - 9}
          />
        ))}
      </div>
      {/* Two rows, so five names fit a 300px dock: the ends and the peak,
          then the rise and the fall between them. */}
      <div className="ui-figure-labels">
        {[0, 50, 100].map((x) => {
          const one = station(x);
          return one ? (
            <span key={one.id} style={along(x)}>
              {beat(one.id)}
            </span>
          ) : null;
        })}
      </div>
      <div className="ui-figure-labels">
        {[25, 75].map((x) => {
          const one = station(x);
          return one ? (
            // Centred: "Rising action" shifted toward its edge meets
            // "Falling action" at 300px.
            <span key={one.id} style={centred(x)}>
              {beat(one.id)}
            </span>
          ) : null;
        })}
      </div>
    </>
  );
}

function Hero({ mapped }: { mapped: MapArc }) {
  const layout = heroLayout(mapped);
  const centre = HERO_BOX / 2;
  const at = (point: { x: number; y: number }): CSSProperties => ({
    left: `${point.x}%`,
    top: `${point.y}%`,
  });
  return (
    <div className="ai-map-circle">
      <svg viewBox={`0 0 ${HERO_BOX} ${HERO_BOX}`} focusable="false">
        <circle
          cx={centre}
          cy={centre}
          r={HERO_RADIUS}
          className="ai-map-rule"
        />
        {/* The threshold: the known world above, the unknown below. */}
        <line
          x1={centre - HERO_RADIUS - 6}
          y1={centre}
          x2={centre + HERO_RADIUS + 6}
          y2={centre}
          className="ai-map-rule"
        />
        <path d={layout.arrow} className="ai-map-arrow" />
      </svg>
      {layout.numbers.map((one) => (
        <span key={one.n} className="ai-map-number" style={at(one)}>
          {one.n}
        </span>
      ))}
      {layout.marks.map((one) => (
        <span key={one.sourceId} className="ai-map-point" style={at(one)}>
          <Mark mark={one.mark} />
        </span>
      ))}
      {layout.more.map((one) => (
        <span
          key={`more-${one.x}-${one.y}`}
          className="ai-map-number"
          style={at(one)}
        >
          +{one.n}
        </span>
      ))}
    </div>
  );
}

/**
 * A Section's ruler: the Section from its first character to its
 * last, with a tick and a disc where each beat verifiably begins, numbered
 * as the caption's legend lists them. A beat with no start gets nothing; the
 * rows and the line under them say those in words. On Three Acts, Field's
 * 25/75 marks sit in the quieter line, a convention beside the book and
 * never a verdict on it. Hidden from assistive tech like every figure, since
 * the rows say all of it.
 */
export function AiMapRuler({
  mapped,
  stale,
}: {
  mapped: MapPassages;
  /** The Section has changed since: the drawing dims, the rows do not. */
  stale: boolean;
}) {
  const { t } = useTranslation();
  const layout = rulerLayout(mapped);
  if (layout.starts.length === 0) return null;
  const threeact = layout.field.length > 0;
  return (
    <figure
      className={["ai-map-figure", "is-ruler", stale ? "is-stale" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {/* A fixed height (34, or 52 where Field's marks sit), so the dock
          does not shift as the ruler's rows change. */}
      <div
        className="ai-map-drawing"
        aria-hidden="true"
        style={{ height: `${layout.height}px` }}
      >
        <div className="ui-figure-labels">
          {layout.labels.map((one) => (
            <span key={one.text} style={along(one.x)}>
              {one.text}
            </span>
          ))}
        </div>
        <div className="ai-map-ruler">
          <svg
            className="ai-map-line"
            viewBox="0 0 100 16"
            preserveAspectRatio="none"
            focusable="false"
          >
            <Rule y={8} />
            {layout.field.map((x) => (
              <line
                key={`field-${x}`}
                x1={x}
                y1={1}
                x2={x}
                y2={15}
                className="ai-map-tick is-field"
              />
            ))}
            {layout.starts.map((one) => (
              <line
                key={one.beat}
                x1={one.x}
                y1={4.5}
                x2={one.x}
                y2={11.5}
                className="ai-map-tick"
              />
            ))}
          </svg>
          {layout.starts.map((one) => (
            <span
              key={one.beat}
              className="ai-map-start"
              style={{ left: `${one.x}%` }}
            />
          ))}
        </div>
        {threeact ? (
          <div className="ui-figure-labels">
            {layout.field.map((x, index) => (
              <span key={x} style={centred(x)}>
                {t(`dock.map.plotPoint${index + 1}`)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <figcaption className="dock-hint">
        <span>
          {t("dock.map.caption.section")}
          {/* Field's two marks need their source said. */}
          {threeact ? ` ${t("dock.map.caption.threeact")}` : null}
        </span>
        <ol className="ai-map-legend">
          {layout.starts.map((one) => (
            <li key={one.beat}>{beatName(mapped.shape, one.beat, t)}</li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
