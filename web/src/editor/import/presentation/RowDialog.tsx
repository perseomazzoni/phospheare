// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Fragment, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Scrim } from "../../../ui/overlay";
import type { PreparedBook } from "../application/prepare";

// A row, opened: a modal over the import window, opened from a row's
// scissors. It shows the whole of what that row stands for, set in the prose
// face, so the writer can see where it really begins and ends, and split it.
// The pointer over the gap between two paragraphs shows the line a cut would
// draw, the list's own dashes laid flat. A split already made is drawn solid
// with the new row's name; pressed, it joins back. A line at the top says so,
// since a gap shows nothing until the pointer finds it.
//
// Whether the row is a Part or a Section is decided in the list, where every
// writer finds it, not only those who come to split.
//
// The text is its own layer over the list rather than inside it, so there is
// one scrollbar on screen at a time.

/** The row, or one of the rows cut from it, as one stretch of the text. */
export interface Piece {
  key: string;
  title: string;
  start: number;
  end: number;
  /** Starts a row of its own: a cut the writer made, drawn solid. */
  cut: boolean;
}

export interface RowDialogProps {
  title: string;
  book: PreparedBook;
  /** The row first, then the rows cut from it, in order. */
  pieces: readonly Piece[];
  /** Cuts `key`'s piece before paragraph `at`. */
  onCut: (key: string, at: number) => void;
  /** Joins `key`'s piece back to the one above (a cut undone). */
  onJoin: (key: string) => void;
  onClose: () => void;
}

/**
 * The writer's blank lines above a paragraph, as the project will hold them:
 * a line's height each, on top of the margins the element there already
 * keeps. The first paragraph shown takes them above itself; anywhere else
 * they go half above and half below the gap or the cut before the
 * paragraph, so the line a cut draws runs through the middle of the empty
 * space, touching neither the paragraph it ends nor the one it starts.
 */
const blankAround = (
  blank: number | undefined,
  base: string,
  side: "top" | "both",
) => {
  if (!blank) return undefined;
  const lines = side === "both" ? blank / 2 : blank;
  const margin = `calc(${lines * 1.55}em + ${base})`;
  return side === "both"
    ? { marginTop: margin, marginBottom: margin }
    : { marginTop: margin };
};

/** The first words of a paragraph, for a gap's name. */
const opening = (text: string) =>
  text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;

export default function RowDialog({
  title,
  book,
  pieces,
  onCut,
  onJoin,
  onClose,
}: RowDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const doneRef = useRef<HTMLButtonElement>(null);

  return (
    <Scrim
      open
      onClose={onClose}
      initialFocus={() => doneRef.current}
      labelledBy={titleId}
      className="ui-dialog import-row-dialog"
    >
      <header className="ui-dialog-head">
        <h2 id={titleId} className="ui-dialog-title">
          {title}
        </h2>
      </header>
      <div className="ui-dialog-body">
        <p className="import-peek-lead">{t("import.splitLead")}</p>
        <div className="import-peek">
          {pieces.map((piece, p) => (
            <Fragment key={piece.key}>
              {p > 0 &&
                (piece.cut ? (
                  <button
                    type="button"
                    className="import-cut"
                    data-cut="1"
                    style={blankAround(
                      book.blocks[piece.start].blankBefore,
                      "10px",
                      "both",
                    )}
                    aria-label={t("import.uncutLabel", { title: piece.title })}
                    onClick={() => onJoin(piece.key)}
                  >
                    <span className="import-cut-bead" aria-hidden="true" />
                    <span className="import-cut-name">{piece.title}</span>
                  </button>
                ) : (
                  <Gap
                    label={t("import.splitHereLabel", {
                      text: opening(book.blocks[piece.start].text),
                    })}
                    text={t("import.splitHere")}
                    blank={book.blocks[piece.start].blankBefore}
                    onClick={() => onJoin(piece.key)}
                  />
                ))}
              {book.blocks.slice(piece.start, piece.end).map((para, i) => {
                const n = piece.start + i;
                return (
                  <Fragment key={n}>
                    {i > 0 && (
                      <Gap
                        label={t("import.splitHereLabel", {
                          text: opening(para.text),
                        })}
                        text={t("import.splitHere")}
                        blank={para.blankBefore}
                        onClick={() => onCut(piece.key, n)}
                      />
                    )}
                    {/* Only the row's own opening is set flush: a paragraph a
                        split starts keeps its indent, as it stands in the
                        manuscript. */}
                    <p
                      data-align={para.scene ? "center" : para.align}
                      data-first={p === 0 && i === 0 ? "" : undefined}
                      style={
                        p === 0 && i === 0
                          ? blankAround(para.blankBefore, "0px", "top")
                          : undefined
                      }
                    >
                      {para.text}
                    </p>
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <footer className="ui-dialog-foot">
        <button
          ref={doneRef}
          type="button"
          className="ui-btn ui-btn-primary"
          onClick={onClose}
        >
          {t("confirm.done")}
        </button>
      </footer>
    </Scrim>
  );
}

/**
 * The gap between two paragraphs: nothing at rest, so the prose reads as
 * prose; under the pointer or the keyboard, the dashed line a cut would
 * draw, with a bead and what it starts.
 */
function Gap({
  label,
  text,
  blank,
  onClick,
}: {
  label: string;
  text: string;
  /** The blank lines above the paragraph it stands before. */
  blank: number | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="import-cut"
      style={blankAround(blank, "-7px", "both")}
      aria-label={label}
      onClick={onClick}
    >
      <span className="import-cut-bead" aria-hidden="true" />
      <span className="import-cut-name" aria-hidden="true">
        {text}
      </span>
    </button>
  );
}
