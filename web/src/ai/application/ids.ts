// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The one source of new ids for chats, turns, runs, findings and plan
// segments. A leaf: it imports nothing, so every module can use it without a
// cycle.

export function newId(): string {
  return crypto.randomUUID();
}
