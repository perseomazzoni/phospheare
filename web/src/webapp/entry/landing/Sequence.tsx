// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState, type CSSProperties } from "react";
import { useLandingMotion } from "./motion";
import Shot, { type ShotId } from "./Shot";
import { useInView } from "./useInView";

/** How long a step stays on screen, and how long it takes to fade in. */
export interface Pace {
  hold: number;
  fade: number;
}

const STEP: Pace = { hold: 1100, fade: 220 };
const LAST: Pace = { hold: 2200, fade: 220 };

/**
 * Real screenshots of one action, step by step, shown in turn and looped,
 * the way a short recording would show it. Every frame is the app itself,
 * captured by the shot rig, so nothing here is drawn to look like it.
 *
 * A step fades in over the one before, which stays whole until covered, so
 * the picture never dims between steps. A fade as long as the hold before
 * it makes consecutive steps one continuous dissolve, which is how a fade
 * captured in stages plays back as the fade itself.
 *
 * It plays only while on screen and holds its current step while the page's
 * motion is paused.
 */
export default function Sequence({
  frames,
  pace,
  alt,
}: {
  frames: readonly ShotId[];
  /** One per frame; by default each step holds briefly and the last longer. */
  pace?: readonly Pace[];
  alt: string;
}) {
  const paused = useLandingMotion();
  const [ref, seen] = useInView<HTMLDivElement>({ once: false });
  const [step, setStep] = useState(0);
  const paceOf = (index: number) =>
    pace?.[index] ?? (index === frames.length - 1 ? LAST : STEP);

  useEffect(() => {
    if (paused || !seen) return;
    const timer = setTimeout(
      () => setStep((at) => (at + 1) % frames.length),
      paceOf(step).hold,
    );
    return () => clearTimeout(timer);
  });

  return (
    <div
      ref={ref}
      className="landing-sequence"
      style={{ "--seq-fade": `${paceOf(step).fade}ms` } as CSSProperties}
    >
      {frames.map((id, index) => (
        <div
          key={id}
          className="landing-sequence-frame"
          data-on={index === step ? "" : undefined}
          aria-hidden={index === step ? undefined : true}
        >
          <Shot id={id} alt={index === step ? alt : ""} />
        </div>
      ))}
    </div>
  );
}
