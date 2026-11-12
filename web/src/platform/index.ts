// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { identityPlatform } from "./identityPlatform";
import type { Platform } from "./types";

// The composition root of the platform layer. The application needs the
// identity service on its own origin; when it cannot be reached, each call
// that needs it is refused as `unavailable` and says so where it was asked.
// The public demo calls none of them.

export * from "./types";
export { forgetIdentityProof, IDENTITY_PROOF_PREFIX } from "./identityProof";

let current: Platform | null = null;

/** The platform, made on first use. */
export function currentPlatform(): Platform {
  current ??= identityPlatform();
  return current;
}

/** Replaces the platform; `null` makes a fresh one on next use. Tests only. */
export function setPlatformForTests(next: Platform | null): void {
  current = next;
}
