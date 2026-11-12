// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { CardContent } from "../../../../profile/profileStore";
import { StorageError, type Access } from "../../../../storage/types";
import type { ReadResult } from "./cards";

/**
 * The card an access probe settles before any file is read, or `null` when
 * the folder is reachable and the read goes on.
 */
export function outcomeForAccess(
  access: Access,
  remembered: CardContent | null,
): ReadResult | null {
  if (access === "gone")
    return { content: remembered, state: "gone", problem: null };
  if (access === "needs-gesture")
    return { content: remembered, state: "blocked", problem: null };
  return null;
}

/**
 * The card a failed read settles. The probe is an optimisation, not a
 * guarantee: permission can lapse between it and the read.
 *
 * - `permission`: a local grant, or Remote Storage's connection gone (401 or
 *   403 from Google, or the identity service's 409), so `blocked`.
 * - `not-found`, or a raw `NotFoundError` from a provider that leaks one: the
 *   folder is gone, never unreadable.
 * - Anything else is a real failure; the card stays, with the reason on it.
 */
export function outcomeForError(
  err: unknown,
  remembered: CardContent | null,
  describe: (err: StorageError) => string,
): ReadResult {
  if (err instanceof StorageError && err.code === "permission") {
    return { content: remembered, state: "blocked", problem: null };
  }
  if (
    (err instanceof StorageError && err.code === "not-found") ||
    (err instanceof DOMException && err.name === "NotFoundError")
  ) {
    return { content: remembered, state: "gone", problem: null };
  }
  return {
    content: remembered,
    state: "unreadable",
    problem: err instanceof StorageError ? describe(err) : null,
  };
}
