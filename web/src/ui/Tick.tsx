// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { appIcons } from "./appIcons";
import { Icon } from "./icons";

// A tick row: the kit's `.ui-tick` as a component, which draws every tick in
// the app.
//
// `role="checkbox"` because a row can have three states and `aria-pressed`
// has two: a heading over a partial pick is `aria-checked="mixed"`, the
// platform's word for it and what a screen reader says. What is drawn is a
// box that takes a tick, and a screen reader names what a sighted writer sees.
//
// Locked is not disabled. A disabled control leaves the tab order and takes
// its reason with it; a locked one stays reachable, says why in its note, and
// does nothing when pressed. Disabled is for a row with nothing behind it. A
// locked row may instead say why when pressed (`onLockedPress`): the writing
// preferences a phone does not honour answer a press with a toast, which a
// note in a two-word row has no room for.
//
// A bead is the same control drawn as a dot, for the import's list, where
// each row's tick sits on a line that joins rows into one Section, and a
// square box on that line reads as a second thing beside it.

export type TickChecked = boolean | "mixed";

/**
 * The drawn box. The tick glyph is always in the markup, so the row never
 * changes its children with its state; the mixed bar is drawn over it.
 */
export function TickBox({ bead = false }: { bead?: boolean }) {
  return (
    <span
      className={bead ? "ui-tick-box ui-tick-bead" : "ui-tick-box"}
      aria-hidden="true"
    >
      <Icon name={appIcons.confirm} size={10} />
    </span>
  );
}

export interface TickProps {
  checked: TickChecked;
  onToggle: () => void;
  /** Reachable and explained, but fixed. */
  locked?: boolean;
  /**
   * What a press on a locked row does instead of nothing: say why. The row
   * then carries `data-unavailable`, the editor's mark for a control that is
   * offered but not honoured here and still answers a press (the command
   * bar's, the persona dialog's), and the dim that goes with it.
   */
  onLockedPress?: () => void;
  /** Inert: there is nothing behind the row. */
  disabled?: boolean;
  bead?: boolean;
  /** A fact after the row's words, such as a count or a reason. */
  note?: React.ReactNode;
  /**
   * The row's name, where its words are not the whole of it: a bare box
   * whose words are the field beside it (`ui-tick-bare`), or a row whose
   * name says what ticking it does.
   */
  "aria-label"?: string;
  /** A longer word on what ticking it does, drawn outside the row. */
  "aria-describedby"?: string;
  className?: string;
  style?: React.CSSProperties;
  /** The row's words. A bare box has none, and no text span is drawn. */
  children?: React.ReactNode;
}

export default function Tick({
  checked,
  onToggle,
  locked = false,
  onLockedPress,
  disabled = false,
  bead = false,
  note,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  className,
  style,
  children,
}: TickProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === "mixed" ? "mixed" : checked}
      aria-disabled={locked || undefined}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      data-unavailable={locked && onLockedPress ? "1" : undefined}
      disabled={disabled}
      className={["ui-tick", className].filter(Boolean).join(" ")}
      style={style}
      onClick={locked ? onLockedPress : onToggle}
    >
      <TickBox bead={bead} />
      {children != null && <span className="ui-row-text">{children}</span>}
      {note && <small className="ui-row-note">{note}</small>}
    </button>
  );
}
