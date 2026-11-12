// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TokenValues } from "../../domain/family";

// Radiant's roles: the tokens its sheet reads that it draws from its other
// tokens, or leaves clear, rather than choosing outright. Its palette and its
// shared values state the rest, and win over these.
export const roles: TokenValues = {
  "--bar-edge": "var(--hair)",
  "--press-ground": "var(--accent-tint)",
  "--press-ink": "var(--accent)",
  "--press-edge": "var(--accent)",
  "--press-foot": "var(--accent)",
  "--press-ring": "inset 0 0 0 1px var(--accent)",
  "--seat-trough": "var(--wash-subtle)",
  "--seat-ground": "var(--radiant-chip)",
  "--seat-shadow": "var(--radiant-chip-lift)",
  "--seat-radius": "var(--r-round)",
  "--seat-ink": "var(--ink)",
  "--slip-edge": "var(--hair)",
  "--tip": "var(--inverse)",
  "--tip-solid": "var(--inverse-solid)",
  "--tip-ink": "var(--inverse-ink)",
  "--tip-ink-strong": "var(--inverse-ink-strong)",
  "--tip-raised": "var(--inverse-raised)",
  "--tip-raised-hover": "var(--inverse-raised-hover)",
  "--tip-edge": "transparent",
  "--field-edge": "var(--hair)",
  "--field-foot": "var(--hair)",
  "--field-radius": "var(--r-lg)",
  "--field-focus-edge": "var(--accent)",
  "--field-focus-foot": "var(--accent)",
  "--field-focus-ring": "0 0 0 3px var(--accent-tint)",
  "--f-display": "var(--f-prose)",
  "--f-chrome": "var(--f-ui)",
  "--label-caps": "normal",
  "--figures-text": "normal",
  "--head-caps": "normal",
  "--head-tracking": "normal",
  "--control-caps": "normal",
  "--control-tracking": "normal",
  "--hover-row": "var(--wash-subtle)",
  "--hover-tool": "var(--wash-subtle)",
  "--hover-quiet": "var(--wash)",
  "--hover-accent": "var(--accent-tint)",
  "--hover-sunk": "var(--paper-sunk)",
  "--leader-ink": "transparent",
  "--page-edge": "var(--hair)",
  "--page-corners": "none",
};
