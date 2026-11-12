// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { SchemeChoice } from "./types";

// A writer's choice of theme. One key holds both halves,
// `<theme>-<light|dark|system>`, so a device never pairs one device's theme
// with another's variant; `system` follows the system's scheme.

export interface Choice {
  family: string;
  mode: SchemeChoice;
}

/** A stored choice read as its theme and its mode, or `null` when it names none. */
export function parseChoice(choice: string): Choice | null {
  const at = choice.lastIndexOf("-");
  const mode = choice.slice(at + 1);
  if (at < 1 || (mode !== "light" && mode !== "dark" && mode !== "system"))
    return null;
  return { family: choice.slice(0, at), mode };
}

export function choiceKey({ family, mode }: Choice): string {
  return `${family}-${mode}`;
}
