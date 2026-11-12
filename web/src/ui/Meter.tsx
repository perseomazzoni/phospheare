// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Meter ────────────────────────────────────────────────────────────────────
//
// How much of something is used: a ring that closes, or a bar that fills.
// Both climb the same scale, so a writer who learns the colours on one has
// learned the other.
//
// ── The scale ────────────────────────────────────────────────────────────────
//
// Five steps on the theme's own status colours and no others. Every theme
// restates them, so a meter never looks borrowed from another palette.
//
//   normal   slate      nothing to think about
//   ok       phos       well under way, still comfortable
//   warning  ember      worth a glance before the next long ask
//   danger   crimson    close to the edge
//   error    crimson    at it, and the track itself turns: the one step that
//                       is not just a darker version of the one before
//
// The colour is never the only carrier. The number beside the meter says the
// same thing in words, and the meter itself is `aria-hidden`: a screen reader
// hears the sentence, not a picture of it.

export type MeterStage = "normal" | "ok" | "warning" | "danger" | "error";

/**
 * The scale, lowest step first, each with the share it starts at. Every meter
 * shares it, so a colour means the same distance from the edge whatever is
 * measured.
 */
const SCALE: ReadonlyArray<{ stage: MeterStage; from: number }> = [
  { stage: "normal", from: 0 },
  { stage: "ok", from: 0.4 },
  { stage: "warning", from: 0.6 },
  { stage: "danger", from: 0.8 },
  { stage: "error", from: 0.95 },
];

/** Where a share of 0..1 sits on the scale. */
export function meterStage(share: number): MeterStage {
  return (
    [...SCALE].reverse().find((step) => share >= step.from)?.stage ?? "normal"
  );
}

/** A share, clamped, so a stray value never draws past the track. */
function clamp(share: number): number {
  return Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
}

export interface MeterProps {
  /** How much is used, 0..1. */
  share: number;
  shape: "ring" | "bar";
  /** The ring's drawn size in px. 13 sits beside text like a glyph. */
  size?: number;
  className?: string;
}

// The ring's geometry, on the icon set's 24 grid so it sits beside text the
// way a glyph does. The radius leaves room for the stroke inside the box.
const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function Meter({
  share,
  shape,
  size = 13,
  className,
}: MeterProps) {
  const used = clamp(share);
  const stage = meterStage(used);
  const classes = ["ui-meter", `ui-meter-${shape}`, `is-${stage}`, className]
    .filter(Boolean)
    .join(" ");
  if (shape === "bar")
    return (
      <span className={classes} aria-hidden="true">
        <span className="ui-meter-fill" style={{ width: `${used * 100}%` }} />
      </span>
    );
  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle className="ui-meter-track" cx="12" cy="12" r={RADIUS} />
      <circle
        className="ui-meter-fill"
        cx="12"
        cy="12"
        r={RADIUS}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - used)}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
