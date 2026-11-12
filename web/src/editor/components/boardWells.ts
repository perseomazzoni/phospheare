// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Command } from "../../ui/commandFilter";

// The board's arrangement: the grouping into wells, and only that. Cells
// carry no mnemonic letters.

/**
 * The commands, grouped into wells in the order their groups first appear:
 * the arrangement is what the writer learns, so it is the one the caller
 * wrote down. No recency, frequency or score reordering; filtering removes
 * cells and reflows wells, and survivors keep their order and their well.
 */
export function wellsOf<T extends Command>(
  commands: readonly T[],
): { name: string; commands: T[] }[] {
  const wells: { name: string; commands: T[] }[] = [];
  for (const command of commands) {
    const well = wells.find((w) => w.name === command.group);
    if (well) well.commands.push(command);
    else wells.push({ name: command.group, commands: [command] });
  }
  return wells;
}
