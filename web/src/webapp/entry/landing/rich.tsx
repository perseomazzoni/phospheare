// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import { PERSONAS } from "./content";

/** An editor's name, with the "@" that calls them in a comment. */
const EDITOR = new RegExp(
  `(@?(?:${PERSONAS.map((persona) => persona.name).join("|")})\\b)`,
);

/**
 * A line of copy with the app's own feature names marked `<f>…</f>`, each
 * set as a name (`.landing-feature`) so a visitor can find it in the app
 * by the same word. The editors' names are found unmarked and set apart
 * (`.landing-editor`), the "@" with them. Any other text, angle brackets
 * included, stays text.
 */
export function rich(text: string): ReactNode[] {
  return text.split(/<f>(.*?)<\/f>/).flatMap((part, index) =>
    index % 2 ? (
      <span key={index} className="landing-feature">
        {part}
      </span>
    ) : (
      part.split(EDITOR).map((piece, at) =>
        at % 2 ? (
          <span key={`${index}-${at}`} className="landing-editor">
            {piece}
          </span>
        ) : (
          piece
        ),
      )
    ),
  );
}
