// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A project as the app's log names it. Its own module so that the demo
// build, which keeps no log, replaces it with a twin that reads nothing
// (`build/demoBuild.ts`, `DEMO_TWINS`).

import type { ProjectRef } from "../storage/types";
import { projectIdFor } from "./projectId";

/**
 * A project as the app's log may name it: the provider and the uuid, never
 * the address. A device project's key is a folder name the writer chose, and
 * its name is the title, so neither goes in a line.
 */
export function refForLog(
  ref: Pick<ProjectRef, "providerId" | "key">,
): Record<string, string> {
  let project: string | null = null;
  try {
    project = projectIdFor(ref);
  } catch {
    // A mirror that cannot be read leaves the line without the uuid.
  }
  return {
    provider: ref.providerId,
    ...(project ? { project } : {}),
  };
}
