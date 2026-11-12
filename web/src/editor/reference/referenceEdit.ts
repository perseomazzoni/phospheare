// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Markdown editing helpers for reference documents. The reference editor
// works on the raw text rather than through the engine, whose `Doc` model has
// no list block and would lose whatever it cannot express, so the toolbar's
// six verbs are pure selection operations on a string.
//
// Every operation has the shape `(text, start, end) → { text, start, end }`,
// and all six are toggles: Bold on "cat" yields `**cat**`, and again `cat`.

export interface EditResult {
  text: string;
  /** Where the selection should land in the new text. */
  start: number;
  end: number;
}

/**
 * The whole lines the selection touches. A collapsed cursor counts as its own
 * line, so a heading verb on an empty selection still marks the paragraph the
 * writer is standing in. `le` is the end of the last line without its
 * newline, so the parts re-join cleanly around the transformed block.
 */
function lineSpan(
  text: string,
  start: number,
  end: number,
): { ls: number; le: number } {
  const ls = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const le = text.indexOf("\n", end);
  return { ls, le: le === -1 ? text.length : le };
}

/** Strip the markdown line prefixes, so a verb always starts clean. */
function stripLinePrefix(line: string): string {
  return line.replace(/^#{1,6} /, "").replace(/^- /, "");
}

const HEADING = (level: 1 | 2): string => (level === 1 ? "# " : "## ");

/**
 * Mark the selection's lines as a heading (level 1 or 2) or as body (level
 * `null`). Pressing the level a line already is returns it to a paragraph.
 */
export function setHeading(
  text: string,
  start: number,
  end: number,
  level: 1 | 2 | null,
): EditResult {
  const { ls, le } = lineSpan(text, start, end);
  const lines = text.slice(ls, le).split("\n");
  const want = level === null ? null : HEADING(level);
  const allMatch =
    want !== null && lines.every((line) => line.startsWith(want));
  const next = lines.map((line) => {
    if (want === null) return stripLinePrefix(line);
    // Every line already at this level means the press toggles off; anything
    // else means the writer is choosing a level, so replace any prefix.
    if (allMatch) return line.replace(/^#{1,6} /, "");
    return want + stripLinePrefix(line);
  });
  const joined = next.join("\n");
  return {
    text: text.slice(0, ls) + joined + text.slice(le),
    start: ls,
    end: ls + joined.length,
  };
}

/**
 * Toggle the list marker on each of the selection's lines. One list kind
 * only, the bullet. The marker sits at the line's start whatever else the
 * line is, so `- # A heading` stays legal markdown rather than being guessed.
 */
export function toggleList(
  text: string,
  start: number,
  end: number,
): EditResult {
  const { ls, le } = lineSpan(text, start, end);
  const lines = text.slice(ls, le).split("\n");
  const allListed = lines.every((line) => line.startsWith("- "));
  const next = lines.map((line) =>
    allListed ? line.replace(/^- /, "") : `- ${line}`,
  );
  const joined = next.join("\n");
  return {
    text: text.slice(0, ls) + joined + text.slice(le),
    start: ls,
    end: ls + joined.length,
  };
}

/** Wrap the selection in bold, or unwrap it when it already is. */
export function toggleBold(
  text: string,
  start: number,
  end: number,
): EditResult {
  const wrapped =
    start >= 2 &&
    end <= text.length &&
    text.startsWith("**", start - 2) &&
    text.startsWith("**", end);
  if (wrapped) {
    return {
      text:
        text.slice(0, start - 2) + text.slice(start, end) + text.slice(end + 2),
      start: start - 2,
      end: end - 2,
    };
  }
  if (start === end) {
    // No selection: plant the marker pair and leave the caret between them,
    // ready for the word to emphasise.
    return {
      text: text.slice(0, start) + "****" + text.slice(start),
      start: start + 2,
      end: start + 2,
    };
  }
  return {
    text:
      text.slice(0, start) +
      "**" +
      text.slice(start, end) +
      "**" +
      text.slice(end),
    start: start + 2,
    end: end + 2,
  };
}

/**
 * Wrap the selection in italic, or unwrap it when it already is. The unwrap
 * refuses a double asterisk on either side, so italic on a bold word produces
 * `***word***` (bold + italic) instead of tearing the bold pair apart.
 */
export function toggleItalic(
  text: string,
  start: number,
  end: number,
): EditResult {
  const italic =
    start >= 1 &&
    end < text.length &&
    text[start - 1] === "*" &&
    text[start - 2] !== "*" &&
    text[end] === "*" &&
    text[end + 1] !== "*";
  if (italic) {
    return {
      text:
        text.slice(0, start - 1) + text.slice(start, end) + text.slice(end + 1),
      start: start - 1,
      end: end - 1,
    };
  }
  if (start === end) {
    return {
      text: text.slice(0, start) + "**" + text.slice(start),
      start: start + 1,
      end: start + 1,
    };
  }
  return {
    text:
      text.slice(0, start) +
      "*" +
      text.slice(start, end) +
      "*" +
      text.slice(end),
    start: start + 1,
    end: end + 1,
  };
}
