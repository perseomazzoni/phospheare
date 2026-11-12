// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { githubReleases } from "./githubReleases";
import { localReleaseMemory } from "./localReleaseMemory";
import {
  createReleaseCheck,
  type ReleaseCheck,
} from "./application/checkForRelease";

// The one place the feed and the device's memory meet the check. The build
// sets both values (`vite.config.ts`): a release build carries its tag's
// version and GitHub's feed, the dev and E2E servers a same-origin stand-in,
// and any other build no feed, so no check runs.

const REPOSITORY = "https://github.com/perseomazzoni/phospheare";

/** The version this build runs, as the release tag names it without its `v`. */
export const APP_VERSION: string = __APP_VERSION__;

export const releaseCheck: ReleaseCheck | null = __RELEASE_FEED__
  ? createReleaseCheck({
      feed: githubReleases(__RELEASE_FEED__, `${REPOSITORY}/releases`),
      memory: localReleaseMemory,
      current: APP_VERSION,
      now: () => Date.now(),
    })
  : null;
