// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { MouseEvent, ReactNode } from "react";
import { appIcons } from "./appIcons";
import Button from "./Button";
import { Icon } from "./icons";

// The kit's list faces, in two shapes, drawn by `editor.css`.
//
// A list, as the Snapshots and Notes faces draw it: the button that adds an
// entry, and the rows under it. Every row has the same four cells in the same
// order, the lead, the meta, the title and the verbs (`.snap-*`). A cell a
// row has nothing for is an empty placeholder, so the columns keep their
// places.
//
// Shelves, as the Reference face draws them: each shelf's head with its
// count and its fold, its rows, each a title and its verbs, and its add
// controls (`.ref-*`).

/** The add control over the list: an add glyph and its name, one button. */
export function ListAddButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  /** Classes for the control's strip besides its own. */
  className?: string;
}) {
  return (
    <div className={["snap-head", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="snap-add"
        aria-label={label}
        title={label}
        onClick={onClick}
      >
        <Icon name={appIcons.add} size={11} />
        <span>{label}</span>
      </button>
    </div>
  );
}

/**
 * One row of a list. `meta` and `verbs` left out draw an empty placeholder;
 * `null` draws the cell with nothing in it, for a row whose meta may be
 * missing but whose cell the look still places.
 */
export function ListRow({
  className,
  lead,
  meta,
  title,
  verbs,
}: {
  /** The row's states besides `snap-row`: `selected`, `adopted`. */
  className?: string;
  lead?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
  verbs?: ReactNode;
}) {
  return (
    <div
      className={["snap-row", className].filter(Boolean).join(" ")}
      role="listitem"
    >
      <span className="snap-col-adopt" aria-hidden={lead ? undefined : true}>
        {lead}
      </span>
      {meta === undefined ? (
        <span aria-hidden />
      ) : (
        <span className="snap-when-cell">{meta}</span>
      )}
      <div className="snap-title-cell">{title}</div>
      {verbs === undefined ? (
        <span aria-hidden />
      ) : (
        <span className="snap-actions">{verbs}</span>
      )}
    </div>
  );
}

/** A row's verb: a glyph that names itself to the hand and the reader. */
export function RowVerb({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: "rename" | "delete";
  onClick: () => void;
}) {
  return (
    <Button variant="icon" title={label} aria-label={label} onClick={onClick}>
      <Icon
        name={icon === "rename" ? appIcons.edit : appIcons.delete}
        size={10}
      />
    </Button>
  );
}

/** A shelf's head: its name, a leader, its count, and the fold's caret. */
export function ShelfHead({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="ref-card-head"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="ref-card-label">{label}</span>
      <span className="ref-card-lead" aria-hidden />
      <span className="ref-card-count">{count}</span>
      <Icon
        name={appIcons.expand}
        size={10}
        strokeWidth={2}
        className="ref-card-caret"
      />
    </button>
  );
}

/**
 * One row of a shelf: its title, which opens it, and its verbs. An arc row
 * stands one step further in, under its character.
 */
export function ShelfRow({
  label,
  hint,
  open,
  arc,
  onOpen,
  verbs,
}: {
  label: ReactNode;
  /** The title's tooltip: the document's file name. */
  hint: string;
  open: boolean;
  arc?: boolean;
  onOpen: () => void;
  verbs?: ReactNode;
}) {
  return (
    <div className={arc ? "ref-row ref-arc-row" : "ref-row"}>
      <button
        type="button"
        className={arc ? "ref-card-row ref-arc" : "ref-card-row"}
        aria-current={open ? "true" : undefined}
        title={hint}
        onClick={onOpen}
      >
        {label}
      </button>
      {verbs}
    </div>
  );
}

/** A shelf row's verb: a glyph that names itself to the hand and the reader. */
export function ShelfVerb({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: "rename" | "delete";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={icon === "rename" ? "ref-row-ren" : "ref-row-del"}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon
        name={icon === "rename" ? appIcons.edit : appIcons.delete}
        size={10}
      />
    </button>
  );
}

/**
 * A shelf's add control: an add glyph and its name, one button. `untitled`
 * leaves out the tooltip, which the arc's add control has none of.
 */
export function ShelfAddButton({
  label,
  onClick,
  arc,
  untitled,
}: {
  label: string;
  onClick: (event: MouseEvent) => void;
  arc?: boolean;
  untitled?: boolean;
}) {
  return (
    <button
      type="button"
      className={arc ? "ref-card-add ref-arc-add" : "ref-card-add"}
      aria-label={label}
      title={untitled ? undefined : label}
      onClick={onClick}
    >
      <Icon name={appIcons.add} size={11} />
      <span>{label}</span>
    </button>
  );
}
