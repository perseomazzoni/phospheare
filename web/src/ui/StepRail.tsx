// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useState } from "react";

// The wizard's journey rail: one continuous track with a station dot per step,
// and nothing else. The dialog's heading asks the step's question, so a stage
// name under the rail would say it twice.
//
// No numbers: the fill is the confirmation, and "2 / 4" reads as a form to get
// through rather than a question.
//
// When the wizard moves, the station leaves a flashing tail over the track it
// crossed, the login spark's, sparks once where it lands, then rests. The rail
// remembers the station it was on to know where the tail starts; one tail per
// move, keyed so a quick second move draws afresh instead of continuing the
// first. The rail says which way the last move went, so going on, the fill can
// follow the tail in.
//
// The count can change while the rail is on screen (the export's Pages step
// exists only for a format that has pages): the fill is the current station's
// share of whatever the track is now.

export interface StepRailProps {
  /** How many stations the track has. */
  count: number;
  /** The station the wizard is on, from 0. */
  current: number;
}

/** A move of the spark: from one station to another, and its number. */
interface Move {
  from: number;
  to: number;
  n: number;
}

export default function StepRail({ count, current }: StepRailProps) {
  // A one-step wizard has no track to fill; dividing by zero would draw NaN.
  const last = Math.max(count - 1, 1);
  // The station the rail last stood at, and the move that left it, kept in
  // render, the way React derives state from a prop that changed.
  const [stood, setStood] = useState(current);
  const [move, setMove] = useState<Move | null>(null);
  if (stood !== current) {
    setStood(current);
    setMove({ from: stood, to: current, n: (move?.n ?? 0) + 1 });
  }
  // The count can shrink under a move (the export's Pages step); the tail
  // never reaches past the track.
  const from = move ? Math.min(move.from, last) : 0;
  const to = move ? Math.min(move.to, last) : 0;
  const dir = from === to ? undefined : to > from ? "on" : "back";
  return (
    <div className="ui-steps" data-dir={dir}>
      <span className="ui-steps-track" />
      <span
        className="ui-steps-fill"
        style={{ width: `calc((100% - 4px) * ${current} / ${last})` }}
      />
      {move && dir && (
        <span
          key={move.n}
          className="ui-steps-comet"
          data-dir={dir}
          style={{
            left: `calc(2px + (100% - 4px) * ${Math.min(from, to)} / ${last})`,
            width: `calc((100% - 4px) * ${Math.abs(to - from)} / ${last})`,
          }}
        />
      )}
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="ui-step-dot"
          data-state={
            i < current ? "done" : i === current ? "current" : "upcoming"
          }
        />
      ))}
    </div>
  );
}
