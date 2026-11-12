// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The HTML adapter for the `Renderer` port. The editor surface renders this
// string and patches the DOM against it.

import type { Doc, Paragraph, Run } from "../domain/model";
import type { Renderer } from "../ports/renderer";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderRun(run: Run): string {
  let html = escapeHtml(run.text);
  if (run.format.monospace) html = `<code>${html}</code>`;
  if (run.format.italic) html = `<em>${html}</em>`;
  if (run.format.bold) html = `<strong>${html}</strong>`;
  return html;
}

function renderParagraph(para: Paragraph): string {
  if (para.blockType === "pagebreak") return "<hr>";
  const inner = para.runs.map(renderRun).join("") || "<br>";
  const align =
    para.alignment !== "left"
      ? ` style="text-align:${escapeAttr(para.alignment)}"`
      : "";
  switch (para.blockType) {
    case "h1":
      return `<h1${align}>${inner}</h1>`;
    case "h2":
      return `<h2${align}>${inner}</h2>`;
    default:
      return `<p${align}>${inner}</p>`;
  }
}

// A paragraph is frozen and shared by reference from one doc to the next, so
// the same object always renders the same string. The map is weak, so a
// paragraph no doc holds takes its string with it.
const rendered = new WeakMap<Paragraph, string>();

function cachedParagraph(para: Paragraph): string {
  let html = rendered.get(para);
  if (html === undefined) {
    html = renderParagraph(para);
    rendered.set(para, html);
  }
  return html;
}

export const htmlRenderer: Renderer = {
  render(doc: Doc): string {
    return doc.map(cachedParagraph).join("");
  },
};
