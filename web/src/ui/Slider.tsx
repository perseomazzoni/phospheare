// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

// The slider: a native range input, restyled. Native because the arrows,
// PageUp/PageDown and Home/End, the `slider` role and its value announcements
// come with the element, and a hand-rolled track would have to earn each one
// back.
//
// Two callbacks, because a drag is two events. `onChange` fires on every step
// the thumb passes, so whatever reads the value moves with the drag;
// `onCommit` fires once, when the writer lets go (the element's own `change`
// event, which React does not expose separately from `input`). A consumer
// that persists the value saves on commit: twenty writes for one gesture is
// twenty writes to a file the writer owns.
//
// A tinted fill: the track left of the thumb is a gradient from the start
// colour to the colour at the thumb, and the thumb takes that colour. The two
// colours are the consumer's (`--ui-slider-from` and `--ui-slider-to` on its
// own class), and the position reaches the stylesheet as `--ui-slider-at`,
// 0..1, because a native thumb is a pseudo-element no inline style can reach.
//
// Or a whole tint (`fill="whole"`), for a slider whose two ends are two kinds
// of thing rather than less and more, such as the Mode bar: an emptying bar
// reads as "less".
//
// The rail and the fill are drawn behind a transparent native track: a native
// track has no inside to fill, and anything drawn over it would sit over the
// thumb too.

/** The thumb's drawn width, in px; must match `.ui-slider` in `base.css`. */
const THUMB = 10;

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Every step of a drag or a key press. */
  onChange: (value: number) => void;
  /** Once, when the gesture ends. */
  onCommit?: (value: number) => void;
  /** A double-click returns the thumb here and commits it. */
  resetTo?: number;
  /** The accessible name. The slider draws no label of its own. */
  label: string;
  /** What a screen reader hears for the value, in words. */
  valueText?: string;
  /**
   * Drawn above the thumb while it is dragged or keyboard-focused, and never
   * at rest: a number on show all the time turns a feel control back into a
   * settings panel.
   */
  readout?: ReactNode;
  disabled?: boolean;
  /**
   * `leading` (the default) fills from the start to the thumb, for a
   * quantity. `whole` keeps the rail full and shifts its gradient toward the
   * thumb's end, for a scale between two kinds rather than between less and
   * more.
   */
  fill?: "leading" | "whole";
  className?: string;
}

export default function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  onCommit,
  resetTo,
  label,
  valueText,
  readout,
  disabled,
  fill = "leading",
  className,
}: SliderProps) {
  const input = useRef<HTMLInputElement>(null);
  // The latest callback, so the listener below is attached once and still
  // calls the current one.
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const onNativeChange = () => commit.current?.(Number(element.value));
    element.addEventListener("change", onNativeChange);
    return () => element.removeEventListener("change", onNativeChange);
  }, []);

  const span = max - min;
  const fraction =
    span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;

  return (
    <span
      className={["ui-slider", fill === "whole" ? "is-whole" : null, className]
        .filter(Boolean)
        .join(" ")}
      style={{ "--ui-slider-at": fraction } as CSSProperties}
      onDoubleClick={
        resetTo === undefined || disabled
          ? undefined
          : () => {
              onChange(resetTo);
              onCommit?.(resetTo);
            }
      }
    >
      <span className="ui-slider-rail" aria-hidden="true">
        <span
          className="ui-slider-fill"
          // To the thumb's centre, which travels half a thumb in from each
          // end rather than the full width.
          style={
            fill === "whole"
              ? undefined
              : {
                  width: `calc(${fraction * 100}% + ${THUMB / 2 - fraction * THUMB}px)`,
                }
          }
        />
      </span>
      <input
        ref={input}
        type="range"
        className="ui-slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      {readout !== undefined ? (
        <span
          className="ui-slider-readout"
          aria-hidden="true"
          // Centred over the thumb, on the same travel as the fill.
          style={{
            left: `calc(${fraction * 100}% + ${THUMB / 2 - fraction * THUMB}px)`,
          }}
        >
          {readout}
        </span>
      ) : null}
    </span>
  );
}
