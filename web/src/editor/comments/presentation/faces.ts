// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Author } from "../domain/model";

// Who is speaking, as the margin draws them. The margin never reads the
// assistant: the editor hands it the personas' faces (name, colour and
// avatar), so the comments' presentation depends only on the kit and its own
// core, and a project with no assistant (the demo) still draws an imported
// editor's thread.

export interface PersonaFace {
  id: string;
  name: string;
  /** The avatar's background colour: the persona's colour everywhere. */
  color: string;
  /** The avatar image, when there is one. */
  avatar?: string;
}

/**
 * The signed-in writer, as the titlebar draws them: their picture, or their
 * initial on the colour their name gives. Absent with no account (the demo),
 * where the margin's own letter stands in.
 */
export interface WriterFace {
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthorFace {
  name: string;
  color: string | null;
  avatar?: string;
  persona: boolean;
}

/** An author as the margin shows them. `you` and `unknown` are translated. */
export function faceOf(
  author: Author,
  personas: readonly PersonaFace[],
  words: { you: string; unknown: string },
): AuthorFace {
  if (author.kind === "writer")
    return { name: words.you, color: null, persona: false };
  if (author.kind === "editor")
    return { name: author.name || words.unknown, color: null, persona: false };
  const persona = personas.find((p) => p.id === author.id);
  return persona
    ? {
        name: persona.name,
        color: persona.color,
        avatar: persona.avatar,
        persona: true,
      }
    : { name: words.unknown, color: null, persona: true };
}

/**
 * Black or white, whichever reads on a fill: the number in a persona's circle
 * must hold its contrast on every colour a persona file can declare.
 */
export function inkOn(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "#ffffff";
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  // The crossing point where black and white give the same contrast ratio.
  return luminance > 0.179 ? "#111614" : "#ffffff";
}
