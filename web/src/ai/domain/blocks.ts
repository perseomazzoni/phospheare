// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Tagged blocks the app takes out of an answer. Two rooms ask the model for
// text the writer does not read as prose: the drafting room's `<for-later>`
// notes, held back from a writer mid-scene, and the editorial letter's
// `<plan>`, which becomes the checkable Must/Should/Could list. Each is a
// block at the end of an answer, taken out whole, and one reader serves both
// so the two cannot disagree about what a block is.
//
// Tags rather than a JSON tail, because both answers stream as prose: the
// model writes the block last, and a half-written tag can be hidden where
// half a JSON object cannot.

/**
 * `text` with every `<tag>…</tag>` taken out, and what each held. An unclosed
 * block runs to the end, because a model cut off mid-block still meant it for
 * the block. While the answer streams, the start of a tag still arriving is
 * hidden too, so `<for-la` never flashes at the foot of an answer.
 * Case-insensitive, because a model's casing is not a contract.
 */
export function takeBlocks(
  text: string,
  tag: string,
): { answer: string; inner: string[] } {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const inner: string[] = [];
  let answer = "";
  let rest = text;
  for (;;) {
    const at = rest.toLowerCase().indexOf(open);
    if (at === -1) break;
    answer += rest.slice(0, at);
    const body = rest.slice(at + open.length);
    const end = body.toLowerCase().indexOf(close);
    inner.push(end === -1 ? body : body.slice(0, end));
    rest = end === -1 ? "" : body.slice(end + close.length);
  }
  answer += rest;
  // A tag still arriving: the longest tail that is a prefix of the opening.
  for (
    let length = Math.min(open.length - 1, answer.length);
    length > 0;
    length--
  )
    if (open.startsWith(answer.slice(-length).toLowerCase())) {
      answer = answer.slice(0, -length);
      break;
    }
  return { answer: answer.trim(), inner };
}

/**
 * A block's lines: list markers dropped, whitespace folded, empties gone,
 * each capped at `max`.
 */
export function blockLines(block: string, max: number): string[] {
  return block
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max),
    )
    .filter(Boolean);
}
