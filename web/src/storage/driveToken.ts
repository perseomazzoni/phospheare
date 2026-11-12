// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getCurrentUserId, onUserChange } from "../auth/currentUser";
import { isPlatformError, currentPlatform } from "../platform";
import { findWriter } from "../writers/registry";
import { noteDriveAccepted, noteDriveRefused } from "./driveGrant";
import { StorageError } from "./types";
import { PRODUCT } from "../product";

// The Drive access token, minted by the platform from a refresh credential
// the page never sees: the identity service holds it sealed in an HttpOnly
// cookie. It lasts about an hour and is held in memory, never in
// localStorage, where it would outlive the tab and sit on the disk that
// choosing Remote Storage keeps clear.
//
// A token belongs to the account it was minted for, and only while that
// account is current. The cache names its account, and a mint that
// lands after the account was torn down is refused and never cached: a
// sign-out or a switch mid-flight would otherwise leave the previous
// account's credential serving whatever Drive work the tab still runs.

interface CachedToken {
  value: string;
  /** Epoch ms, shortened so a token is never handed out as it expires. */
  expiresAt: number;
  /** The account the token was minted for. */
  userId: string;
}

let cached: CachedToken | null = null;
let inFlight: Promise<string> | null = null;
/**
 * Advanced by every teardown (`forgetDriveToken`, which every account change
 * also runs). A mint that started under an earlier epoch is obsolete: its
 * answer is refused, and it neither caches nor clears anything.
 */
let epoch = 0;
/**
 * Advanced by a `force`. A mint that started under an earlier generation is
 * still the same account's and still fresh, so its caller is served, but the
 * cache belongs to the newer mint.
 */
let generation = 0;

/** Re-mint a minute early, so a token is never used in its final seconds. */
const EXPIRY_MARGIN_MS = 60_000;

export function forgetDriveToken(): void {
  cached = null;
  inFlight = null;
  epoch++;
}

// A cached token never outlives its account.
onUserChange(forgetDriveToken);

function disconnected(): StorageError {
  return new StorageError(
    `${PRODUCT.name} is not connected to your Google Drive.`,
    "permission",
    "storage.disconnected",
  );
}

function unreachable(): StorageError {
  return new StorageError(
    `${PRODUCT.name} could not reach Google Drive.`,
    "unavailable",
    "storage.unreachable",
  );
}

/**
 * A usable access token, minted if the cache is cold or stale. `force`
 * discards the cached one.
 *
 * Concurrent callers share one request: opening a project fires several reads
 * at once, and each would otherwise start its own token fetch.
 */
export async function driveAccessToken(
  options: { force?: boolean } = {},
): Promise<string> {
  // The writer this tab holds names the connection it asks for, and the
  // platform refuses it under any other writer's session. A tab
  // still holding A cannot mint B's token and push A's queue into B's Drive.
  // With no writer there is nobody to mint a token for, and nothing cached is
  // served either: the writer check comes before the cache.
  const userId = getCurrentUserId();
  if (userId === null) return Promise.reject(unreachable());

  if (options.force) {
    cached = null;
    inFlight = null;
    generation++;
  }

  if (cached && cached.userId === userId && cached.expiresAt > Date.now())
    return cached.value;
  if (inFlight) return inFlight;

  const myEpoch = epoch;
  const myGen = generation;
  const current = () => myEpoch === epoch && getCurrentUserId() === userId;

  const connectionId = findWriter(userId)?.drive?.connectionId;
  const platform = currentPlatform();
  if (!connectionId) return Promise.reject(disconnected());

  inFlight = platform
    .driveAccessToken({ connectionId })
    .then((response) => {
      // The account was torn down, or replaced, while this mint was in
      // flight. The token is the previous account's: refused, not cached.
      if (!current()) throw unreachable();

      // A `force` invalidated the cache while this mint was in flight. The
      // token is still fresh, so serve it instead of reading a cache that
      // just went null, but the cache is the newer mint's to fill.
      if (myGen !== generation) return response.accessToken;

      // A freshly minted token proves the grant before any request uses it,
      // so a writer who reconnects sees the notice clear as the token lands.
      noteDriveAccepted();
      cached = {
        value: response.accessToken,
        expiresAt:
          Date.now() +
          Math.max(0, response.expiresIn * 1000 - EXPIRY_MARGIN_MS),
        userId,
      };
      return cached.value;
    })
    .catch((err: unknown) => {
      // An obsolete mint's failure says nothing about the account now
      // current, whose token may already be cached.
      if (!current()) throw unreachable();
      if (myGen === generation) cached = null;
      // The grant is gone: revoked from the Google account page, expired,
      // this browser's sealed credential cleared, or refused by Google with
      // an error other than `invalid_grant`. The writer needs to reconnect,
      // which is not the same as Drive being unreachable, and the account
      // stays signed in.
      if (
        isPlatformError(err, "grant-invalid") ||
        isPlatformError(err, "no-connection") ||
        isPlatformError(err, "google-refused")
      ) {
        noteDriveRefused();
        throw disconnected();
      }
      throw unreachable();
    })
    .finally(() => {
      if (myEpoch === epoch && myGen === generation) inFlight = null;
    });

  return inFlight;
}
