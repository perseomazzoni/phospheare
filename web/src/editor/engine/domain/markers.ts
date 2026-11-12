// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * Markers a writer leaves for themselves where they stopped: what people
 * already type when they stop mid-thought. Finding them needs no model.
 *
 * One list keeps the engine (over the parsed `Doc`) and the Desk (over raw
 * markdown) agreeing on what counts as a stop.
 */
export const MARKERS = [/\bTODO\b.*/i, /\?{2,}.*/, /\bTK\b.*/, /\bXXX\b.*/];
