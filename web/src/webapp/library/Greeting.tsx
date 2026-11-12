// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useState } from "react";
import { typeDuration, typeSchedule } from "./typeSchedule";
import { motionIsStill } from "../../ui";

// The greeting, typed: the shell's one flourish, and a writing tool's own
// vocabulary of text being set. It types, holds at the comma, finishes, and
// the caret beside it fades out.
//
// Every character is in the DOM from the first frame, hidden by opacity
// rather than by slicing the string. Slicing grows the box on every tick, and
// a greeting that re-wraps halfway through is worse than no animation; the box
// is its final size before the first letter shows.
//
// The caret is zero-width: a pseudo-element paints the bar, so advancing it
// never nudges a glyph.
//
// A screen reader takes the whole sentence at once from the `aria-label`.

interface Props {
  /** The resolved sentence, translated and with the name interpolated. */
  text: string;
  className?: string;
}

export default function Greeting({ text, className }: Props) {
  // Per code point, or an accented glyph is torn in half, as in
  // `typeSchedule`.
  const chars = useMemo(() => Array.from(text), [text]);
  const schedule = useMemo(() => typeSchedule(text), [text]);

  // How many characters have landed. The dependencies are the only guard
  // against restarting: the effect re-runs when the text changes, not when
  // the shelf re-renders the parent as cards load.
  //
  // Do not add a ref that skips the effect for text already written. Under
  // `<React.StrictMode>` the effect runs, tears down (clearing every timer)
  // and runs again; a skip on the second run leaves every character at
  // opacity 0.
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const quiet = motionIsStill();

    if (quiet || chars.length === 0) {
      setShown(chars.length);
      setDone(true);
      return;
    }

    setShown(0);
    setDone(false);

    // One timer per character rather than an interval: the schedule is not
    // evenly spaced, and an interval cannot hold at a comma.
    const timers = schedule.map((at, i) =>
      window.setTimeout(() => setShown(i + 1), at),
    );
    const ending = window.setTimeout(() => setDone(true), typeDuration(text));

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.clearTimeout(ending);
    };
  }, [text, chars.length, schedule]);

  return (
    <h1
      className={["greet", className ?? ""].filter(Boolean).join(" ")}
      // The whole sentence, however far the typing has got.
      aria-label={text}
    >
      {/* Split around the caret, so it sits after the last character typed.
          Every character renders on one side or the other and only `data-on`
          changes, so the caret advances through a layout that never moves.
          Keys are indices: one fixed string revealed in place, never
          reordered. */}
      <span aria-hidden>
        {chars.slice(0, shown).map((char, i) => (
          <span key={i} className="greet-char" data-on="1">
            {char}
          </span>
        ))}
        <i className="greet-caret" data-done={done ? "1" : "0"} />
        {chars.slice(shown).map((char, i) => (
          <span key={shown + i} className="greet-char" data-on="0">
            {char}
          </span>
        ))}
      </span>
    </h1>
  );
}
