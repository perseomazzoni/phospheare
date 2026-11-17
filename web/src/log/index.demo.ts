// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's `index.ts`: `build:demo` resolves every import of the log
// to this file (`build/demoBuild.ts`, `DEMO_TWINS`). The site keeps no log:
// each call does nothing, so no line is made, kept or shown, and the log's
// own code is absent from the site's files (`build/demoBoundary.ts`).

import type { FieldValue } from "./domain/line";
import type { Fields, Logger } from "./application/logger";

export type { Fields };

const nothing = (): void => {};
const done = (): Promise<void> => Promise.resolve();

export const appLog: Logger = {
  info: nothing,
  warn: nothing,
  error: nothing,
  flush: done,
  leave: nothing,
  restore: nothing,
  read: () => Promise.resolve([]),
  prune: done,
  clear: done,
};

export function installLog(): () => void {
  return nothing;
}

export const describeError: (
  error: unknown,
) => Record<string, FieldValue> = () => ({});
