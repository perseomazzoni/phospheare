// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TokenValues } from "../../domain/family";

// Vision's roles: the tokens its sheet reads that it draws from its other
// tokens, or leaves clear, rather than choosing outright. Its palette and its
// shared values state the rest, and win over these.
export const roles: TokenValues = {
  "--sheet": "transparent",
  "--sheet-edge": "transparent",
  "--sheet-shadow": "none",
  // A chosen row is tinted in gold, as chosen text is.
  "--row-selected": "var(--mark-selection)",
  "--chip": "var(--wash)",
  "--card-active": "var(--accent)",
  "--spine-plan": "var(--accent-tint)",
  "--pane-ground": "var(--glass)",
  "--pane-radius": "var(--r-lg)",
  "--bar-radius": "var(--r-lg)",
  "--seat-ink": "var(--ink)",
  "--f-display": "var(--f-prose)",
  "--face": "var(--ink)",
  "--face-ink": "var(--on-fill)",
  "--mark-comment-active": "var(--mark-search-current)",
  "--spine-room": "transparent",
  "--spine-edge": "var(--hair)",
};
