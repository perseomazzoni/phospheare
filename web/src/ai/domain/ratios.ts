// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The one request-size ratio: characters of prose per token. The budget
// module sizes what may be admitted with it, and the adapters estimate what a
// request will cost with it. One number serves both, so the guard that
// refuses what the runtime would silently truncate never measures looser than
// the budget that admitted the text.
//
// It lives in `domain/` because adapters must not import `application/`, and
// the domain has no dependencies. The value is conservative, not exact: too
// large a ratio refuses a request that might have fit, while too small a
// ratio ships a request the runtime truncates.
//
// The two siblings in `budgets.ts` answer other questions:
// `INPUT_CHARS_PER_TOKEN` (3) bounds how much text a workflow may assemble,
// and `OUTPUT_CHARS_PER_TOKEN` (4) caps a digest against reserved output
// tokens.

export const CHARACTERS_PER_TOKEN = 3.2;
