// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Paragraph-level DOM patching. Handing the engine's whole serialized
// document to `innerHTML` would rebuild every node per keystroke, so
// paragraphs that still match the model keep their DOM nodes and native
// selection, and only the changed ones are replaced.
//
// Highlights (`mark`), diff wrappers and the typing animation
// (`.char-fade-in`) exist only in the DOM, so they are unwrapped before
// comparison: a stale decoration must not read as a change.

import type { HtmlSink } from "./port";

const PARAGRAPH_TAGS = new Set(["P", "H1", "H2", "HR"]);

/** Wholesale changes are cheaper to rebuild than to reconcile. */
const MAX_MISMATCHES = 16;

function unwrapDecorations(para: HTMLElement): void {
  // The paint passes re-apply every decoration after the patch.
  para.querySelectorAll("mark, .char-fade-in, .df-hunk").forEach((deco) => {
    const parent = deco.parentNode;
    if (!parent) return;
    while (deco.firstChild) parent.insertBefore(deco.firstChild, deco);
    parent.removeChild(deco);
  });
}

function sameParagraph(oldPara: HTMLElement, newPara: HTMLElement): boolean {
  unwrapDecorations(oldPara);
  return oldPara.outerHTML === newPara.outerHTML;
}

/**
 * The fast path, for when the DOM is exactly what `prev` drew. Every edit
 * shares untouched paragraphs by reference, so what changed is found by
 * identity from both ends and only that span is rendered.
 *
 * Returns false, touching nothing, when it cannot vouch for the DOM; the
 * caller then falls back to `patchDocument`. Decorations in untouched
 * paragraphs stay: the paint passes after the patch repaint their own marks.
 */
export function patchChanged(
  el: HTMLElement,
  prev: readonly unknown[] | null,
  next: readonly unknown[],
  render: (span: readonly unknown[]) => string,
  setHtml: HtmlSink,
): boolean {
  if (prev === null || el.children.length !== prev.length) return false;
  let start = 0;
  const shortest = Math.min(prev.length, next.length);
  while (start < shortest && prev[start] === next[start]) start++;
  let end = 0;
  while (
    end < shortest - start &&
    prev[prev.length - 1 - end] === next[next.length - 1 - end]
  )
    end++;
  const removed = prev.length - start - end;
  const added = next.slice(start, next.length - end);
  if (removed === 0 && added.length === 0) return true;

  const old = Array.from(el.children).slice(start, start + removed);
  if (!old.every((p) => PARAGRAPH_TAGS.has(p.tagName))) return false;
  const template = document.createElement("div");
  setHtml(template, render(added));
  const fresh = Array.from(template.children);
  const paired = Math.min(old.length, fresh.length);
  for (let i = 0; i < paired; i++) el.replaceChild(fresh[i], old[i]);
  for (let i = paired; i < old.length; i++) old[i].remove();
  const before = el.children[start + paired] ?? null;
  for (let i = paired; i < fresh.length; i++) el.insertBefore(fresh[i], before);
  return true;
}

export function patchDocument(
  el: HTMLElement,
  html: string,
  setHtml: HtmlSink,
): void {
  const template = document.createElement("div");
  setHtml(template, html);
  const newParas = Array.from(template.children) as HTMLElement[];
  const oldParas = Array.from(el.children) as HTMLElement[];

  // The browser can reshape a contentEditable in ways the serializer never
  // would (drag-drop, autocorrect). An unrecognized DOM shape gets the full
  // rebuild rather than a guess.
  if (
    oldParas.length > 0 &&
    !oldParas.every((p) => PARAGRAPH_TAGS.has(p.tagName))
  ) {
    setHtml(el, html);
    return;
  }

  let oldIdx = 0;
  let mismatches = 0;
  for (const newPara of newParas) {
    if (oldIdx < oldParas.length && sameParagraph(oldParas[oldIdx], newPara)) {
      oldIdx++;
      continue;
    }

    // The engine never reorders paragraphs, but a lookahead keeps the patch
    // correct if it does.
    let match = -1;
    for (let j = oldIdx + 1; j < oldParas.length; j++) {
      if (sameParagraph(oldParas[j], newPara)) {
        match = j;
        break;
      }
    }

    if (match !== -1) {
      for (let k = oldIdx; k < match; k++) oldParas[k].remove();
      oldIdx = match + 1;
      continue;
    }

    if (++mismatches > MAX_MISMATCHES) {
      setHtml(el, html);
      return;
    }

    if (oldIdx < oldParas.length) {
      el.replaceChild(newPara, oldParas[oldIdx]);
      oldIdx++;
    } else {
      el.appendChild(newPara);
    }
  }

  for (let k = oldIdx; k < oldParas.length; k++) oldParas[k].remove();
}
