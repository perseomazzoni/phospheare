// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's `logRef.ts`: `build:demo` resolves every import of it to
// this file (`build/demoBuild.ts`, `DEMO_TWINS`). The site keeps no log, so a
// project gets no fields, and the account and library code that the full
// `logRef.ts` reads stays out of the site's files.

import type { ProjectRef } from "../storage/types";

export const refForLog: (
  ref: Pick<ProjectRef, "providerId" | "key">,
) => Record<string, string> = () => ({});
