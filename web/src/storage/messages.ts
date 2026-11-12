// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { StorageError } from "./types";

/**
 * Resolves a `StorageError` to the writer's language.
 *
 * The error's own key wins; an error without one falls back by code, so no
 * English prose from the storage layer reaches the screen.
 *
 * `fallback` is the caller's own failure text (such as `library.openFailed`)
 * for an error that is not a `StorageError`; a storage failure never shows it.
 */
export function storageErrorMessage(
  err: unknown,
  t: TFunction,
  fallback: string,
): string {
  if (!(err instanceof StorageError)) return fallback;

  const key = err.key ?? DEFAULT_KEY_BY_CODE[err.code];
  return t(key, { ...err.params });
}

/** One generic writer-facing key per code, for a throw site with no key. */
const DEFAULT_KEY_BY_CODE: Record<StorageError["code"], string> = {
  permission: "storage.permission",
  "not-found": "storage.projectGone",
  "too-large": "storage.tooLargeFolder",
  unavailable: "storage.unreachable",
  io: "storage.io",
  "no-space": "storage.noSpace",
  "unusable-path": "storage.unusablePath",
};
