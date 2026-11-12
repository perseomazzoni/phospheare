// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { WriterRegistry } from "../domain/writer";

/**
 * Records that the account has had its login splash. The first time stands;
 * an account that is not stored is left alone.
 */
export function markWelcomed(
  registry: Pick<WriterRegistry, "findWriter" | "updateWriter">,
  id: string,
  now: Date,
): void {
  const writer = registry.findWriter(id);
  if (!writer || writer.welcomedAt) return;
  registry.updateWriter(id, (w) => ({ ...w, welcomedAt: now.toISOString() }));
}
