// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * How long the first check after a navigation may wait for the app to start.
 * The start is CPU work (the bundle, the lazy editor chunk, the first render)
 * that stretches with the machine's load, and on a loaded runner it passes
 * the 5 s that a reaction to a press is allowed. Only that first check takes
 * it; every later check keeps the default.
 */
export const START_MS = 15_000;
