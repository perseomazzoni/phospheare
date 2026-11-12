// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The build's version and the notice of a newer release. Code outside the
// module imports this file and nothing inside it, as `boundaries.test.ts`
// pins.

export { APP_VERSION } from "./compose";
export {
  default as ReleaseNotice,
  RELEASE_NOTICE_REGION_ID,
} from "./ReleaseNotice";
