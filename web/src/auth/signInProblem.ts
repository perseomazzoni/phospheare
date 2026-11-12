// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { isPlatformError } from "../platform";

// What a failed Google flow tells the writer, the same for signing in and
// connecting Remote Storage. A closed Google window is no failure and
// says nothing. Callers translate the key with `identity`, the vendor's
// name.

/** The two answers a flow words in its own terms; the rest are shared. */
export interface ProblemWording {
  /** The identity service cannot be reached. */
  unavailable: string;
  /** Any failure without its own copy. */
  failed: string;
}

const SIGN_IN: ProblemWording = {
  unavailable: "auth.identityUnavailable",
  failed: "auth.googleFailed",
};

/** The string key for `err`, or `null` when the writer closed the window. */
export function signInProblemKey(
  err: unknown,
  wording: ProblemWording = SIGN_IN,
): string | null {
  if (isPlatformError(err, "flow-cancelled")) return null;
  if (isPlatformError(err, "popup-blocked")) return "auth.popupBlocked";
  if (isPlatformError(err, "google-not-configured"))
    return "auth.googleNotSetUp";
  if (isPlatformError(err, "unavailable")) return wording.unavailable;
  return wording.failed;
}
