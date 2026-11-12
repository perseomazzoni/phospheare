// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { memo, useId, useMemo, type CSSProperties } from "react";
import type { DocumentStats, DocumentStructure } from "../project/types";
import {
  SPINE_WIDTH,
  describeSpine,
  formatCount,
  layoutSpineGoal,
  scaleFor,
  spineParts,
  type GoalSpinePart,
} from "./spineLayout";

export { formatCount } from "./spineLayout";

// The spine glyph: a project's shape at a glance, at three sizes: 8px as a
// badge on a shelf card, 22px in a panel with its Parts numbered, 54px as the
// hero with word counts under it. The last session's work shows only where
// there is room to read it, never on the 8px badges.
//
// The bars are one SVG stretched to the width it is given. The labels are not
// in that SVG: a stretched viewBox squashes its text by the factor it
// stretches the bars. They are HTML, positioned by percentage.

export interface SpineGlyphProps {
  structure: DocumentStructure;
  stats: DocumentStats;
  /** Bar height in px. Everything else follows from it. */
  height?: number;
  /** Number the Parts above the bars. */
  labels?: boolean;
  /** Print each Part's word count below the bars. */
  counts?: boolean;
  /** Names the project, for the description a screen reader is given. */
  title?: string;
  /**
   * Fraction of the available width this spine takes, 0…1. Defaults to all
   * of it; a shelf passes `spineFill` from `spineLayout.ts` so its projects
   * are drawn to one scale rather than each filling its own card.
   */
  fill?: number;
  /**
   * The writer's word target; `null` is a goal-less project, measured against
   * its own total.
   */
  goal: number | null;
  /**
   * Draw the last session's work (the per-node deltas), on the hero and the
   * panel; the 8px badges have no room to read it.
   */
  deltas?: boolean;
  /**
   * The Part the writer is in, marked on its group (`data-current`) for a
   * theme that draws the open Part apart; nothing draws it by default.
   */
  currentPart?: string | null;
  /**
   * The gaps between Parts and between a Part's Sections, in the glyph's
   * thousandths of its width, in place of the ones its height gives.
   */
  gaps?: { part: number; section: number };
  className?: string;
}

/**
 * Memoised: every prop is a value or the project's structure and stats, which
 * keep their identity until the book changes. The editor draws two (the
 * panel's and the Desk's), one group per Part, and without this both redraw
 * on every update to the shell around them, which a 63-Part book's open pays
 * a dozen times over.
 */
export default memo(SpineGlyph);

function SpineGlyph({
  structure,
  stats,
  height = 8,
  labels = false,
  counts = false,
  title,
  fill = 1,
  goal,
  deltas = false,
  currentPart = null,
  gaps,
  className,
}: SpineGlyphProps) {
  const gapPart = gaps?.part;
  const gapSection = gaps?.section;
  const scale = useMemo(() => {
    const own = scaleFor(height);
    return {
      ...own,
      gapPart: gapPart ?? own.gapPart,
      gapSection: gapSection ?? own.gapSection,
    };
  }, [height, gapPart, gapSection]);
  const parts = useMemo(() => spineParts(structure, stats), [structure, stats]);
  // `null` is a goal-less project, handled inside `layoutSpineGoal` by
  // drawing against the project's own total.
  const goalLayout = useMemo(
    () => layoutSpineGoal(parts, scale, goal),
    [parts, scale, goal],
  );

  const pct = (x: number) => `${(x / SPINE_WIDTH) * 100}%`;
  const description = title
    ? `${title}: ${describeSpine(goalLayout)}`
    : describeSpine(goalLayout);
  const width = `${Math.max(0, Math.min(1, fill)) * 100}%`;

  // A project with Parts but no Sections yet has nothing to draw and is still
  // a project. It gets its slot as an empty track rather than vanishing: a
  // card silently shorter than its neighbours reads as broken, and the shelf's
  // rows go ragged around it.
  //
  // The track takes `fill` like any other spine. At full width, writing the
  // first Section would shrink the mark by ninety per cent, since a project
  // with one three-word Section draws at `MIN_FILL`, and the two emptiest
  // projects on a shelf would carry its longest bars. An empty project is the
  // shortest project there.
  if (goalLayout.bars.length === 0 && goalLayout.parts.length === 0) {
    return (
      <div
        className={["spine", className ?? ""].filter(Boolean).join(" ")}
        style={{ width }}
        role="img"
        aria-label={description}
      >
        <div className="spine-empty" style={{ height: `${height}px` }} />
      </div>
    );
  }

  return (
    <div
      className={["spine", className ?? ""].filter(Boolean).join(" ")}
      style={{ width }}
      role="img"
      aria-label={description}
    >
      {labels && (
        <div className="spine-labels" aria-hidden>
          {goalLayout.parts.map((part) => (
            <span key={part.nodeId || part.label} style={{ left: pct(part.x) }}>
              {part.label}
            </span>
          ))}
        </div>
      )}

      <svg
        className="spine-bars"
        viewBox={`0 0 ${SPINE_WIDTH} ${height}`}
        preserveAspectRatio="none"
        style={{ height: `${height}px` }}
        aria-hidden
        focusable="false"
      >
        {goalLayout.parts.map((part, index) => (
          <PartGroup
            key={part.nodeId || part.label}
            part={part}
            index={index}
            scale={scale}
            height={height}
            deltas={deltas}
            current={part.nodeId !== "" && part.nodeId === currentPart}
          />
        ))}
      </svg>

      {counts && (
        <div className="spine-counts" aria-hidden>
          {goalLayout.parts.map((part) => (
            <span key={part.nodeId || part.label} style={{ left: pct(part.x) }}>
              {formatCount(part.totalWords)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The goal layout's one Part: a field owed width against the goal, its own
 * prose a leading dim slice, its Sections the bright bars inside it, and the
 * capacity the Sections have not consumed visible as the hatched empty region
 * trailing them. The border speaks for the Part file alone, its own
 * last-session delta, never for the children's work, which the Section bars
 * carry.
 */
function PartGroup({
  part,
  index,
  scale,
  height,
  deltas,
  current,
}: {
  part: GoalSpinePart;
  index: number;
  scale: { radius: number };
  height: number;
  deltas: boolean;
  current: boolean;
}) {
  // One diagonal-hatch pattern per spine instance: ids are unique, so two
  // spines on one page (the panel and the Desk) never share a def.
  const hatchId = useId();
  // The Part's colour, read by everything drawn in it (`--spine-*` in
  // `theme/domain/tokens.ts`): the Parts alternate, and the current one may stand
  // apart.
  const odd = index % 2 === 0;
  // Each token named whole, so `theme/contract.test.ts` sees it read.
  const hue = current
    ? odd
      ? "var(--spine-current-odd)"
      : "var(--spine-current-even)"
    : odd
      ? "var(--spine-odd)"
      : "var(--spine-even)";
  return (
    <g
      data-current={current ? "1" : undefined}
      style={{ "--spine-hue": hue } as CSSProperties}
    >
      {part.emptyWidth > 0 && (
        <pattern
          id={hatchId}
          patternUnits="userSpaceOnUse"
          width={8}
          height={8}
        >
          <path
            d="M0 8 L8 0"
            style={{
              stroke: "var(--spine-hue)",
              strokeOpacity: "var(--spine-hatch-opacity)",
            }}
            strokeWidth={1.2}
          />
        </pattern>
      )}
      <rect
        className="spine-field"
        x={part.x}
        y={0}
        width={part.width}
        height={height}
        rx={scale.radius}
        style={{
          fill: part.empty
            ? "none"
            : "color-mix(in srgb, var(--spine-hue) var(--spine-ground-mix), var(--spine-plan))",
          fillOpacity: part.empty ? undefined : "var(--spine-ground-opacity)",
          stroke:
            deltas && part.delta !== null
              ? part.delta > 0
                ? "var(--leaf)"
                : "var(--attention)"
              : "var(--spine-edge)",
        }}
        strokeWidth={1}
        strokeDasharray={part.empty ? "3 3" : undefined}
      >
        {part.title && (
          <title>
            {`${part.title} — ${part.totalWords.toLocaleString()} words`}
            {deltas && part.delta !== null
              ? ` — ${
                  part.delta > 0 ? "+" : "−"
                }${Math.abs(part.delta).toLocaleString()} words last session`
              : ""}
          </title>
        )}
      </rect>
      {part.emptyWidth > 0 && (
        <rect
          className="spine-room"
          x={part.x + part.width - part.emptyWidth}
          y={0}
          width={part.emptyWidth}
          height={height}
          rx={scale.radius}
          style={{ fill: "var(--spine-room)" }}
        >
          <title>{`${part.unusedWords.toLocaleString()} words of unused capacity`}</title>
        </rect>
      )}
      {part.emptyWidth > 0 && (
        <rect
          className="spine-hatch"
          x={part.x + part.width - part.emptyWidth}
          y={0}
          width={part.emptyWidth}
          height={height}
          rx={scale.radius}
          fill={`url(#${hatchId})`}
          pointerEvents="none"
        />
      )}
      {part.bars.map((bar) => {
        const key = `${bar.nodeId}:${bar.kind}`;
        // An empty Section that collapsed (its Part is full) must not exist
        // at all: a zero-width rect with a dashed stroke still paints a
        // dotted hairline at its x, and the field does not hold it.
        if (bar.empty && bar.width <= 0) return null;
        if (bar.empty) {
          return (
            <rect
              key={key}
              className="spine-blank"
              x={bar.x}
              y={0}
              width={bar.width}
              height={height}
              rx={scale.radius}
              fill="none"
              style={{ stroke: "var(--spine-edge)" }}
              strokeWidth={1}
              strokeDasharray="3 3"
            >
              <title>{`${bar.title} — 0 words`}</title>
            </rect>
          );
        }
        // The last session's work: written words cap the Section's trailing
        // end (the frontier, where the bar now reaches), and cut words dent
        // its leading edge (a mark, not a shortened-bar state). Position
        // carries direction alongside the colour.
        const delta = bar.delta;
        const overlayWidth =
          deltas && delta !== null
            ? bar.width * Math.min(1, Math.abs(delta) / Math.max(1, bar.words))
            : 0;
        return (
          <g key={key}>
            <rect
              className="spine-bar"
              data-kind={bar.kind}
              x={bar.x}
              y={0}
              width={bar.width}
              height={height}
              rx={scale.radius}
              style={{
                fill: "var(--spine-hue)",
                fillOpacity:
                  bar.kind === "own"
                    ? "var(--spine-own-opacity)"
                    : "var(--spine-bar-opacity)",
              }}
            >
              <title>{`${bar.title} — ${bar.words.toLocaleString()} words`}</title>
            </rect>
            {delta !== null && overlayWidth > 0 && (
              <rect
                x={delta > 0 ? bar.x + bar.width - overlayWidth : bar.x}
                y={0}
                width={overlayWidth}
                height={height}
                rx={scale.radius}
                fill={delta > 0 ? "var(--leaf)" : "var(--attention)"}
                fillOpacity={1}
              >
                <title>{`${bar.title} — ${
                  delta > 0 ? "+" : "−"
                }${Math.abs(delta).toLocaleString()} words last session`}</title>
              </rect>
            )}
          </g>
        );
      })}
    </g>
  );
}
