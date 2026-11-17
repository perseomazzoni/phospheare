// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { isWinnerUnsettled } from "../../../project/sync/apply";
import type { ActionFailure } from "./useActionError";
import type { LibraryCardsApi, ShelfToasts } from "./shelfActions";
import { appLog, describeError } from "../../../log";

export interface ResolveConflictInput {
  resolve: LibraryCardsApi["resolve"];
  toasts: ShelfToasts;
  failure: ActionFailure;
}

/**
 * A sync conflict's banner: keeping one side, and which book's choice is
 * being written.
 */
export function useResolveConflict({
  resolve: resolveCard,
  toasts,
  failure,
}: ResolveConflictInput) {
  const { t } = useTranslation();
  const { post } = toasts;
  const { clear: clearFailure, fail } = failure;

  /** The book whose conflict is being resolved, by its own id. */
  const [resolving, setResolving] = useState<string | null>(null);

  const resolve = useCallback(
    async (projectId: string, name: string, keep: "local" | "remote") => {
      setResolving(projectId);
      clearFailure();
      try {
        await resolveCard(projectId, keep);
        post(
          t("sync.resolved", {
            side:
              keep === "local"
                ? t("sync.resolvedLocal")
                : t("sync.resolvedDrive"),
            name,
          }),
        );
      } catch (err) {
        appLog.error("sync", "A conflict could not be resolved.", {
          project: projectId,
          keep,
          ...describeError(err),
        });
        fail(
          isWinnerUnsettled(err)
            ? t(
                keep === "remote"
                  ? "sync.remoteUnsettled"
                  : "sync.localUnsettled",
                { name },
              )
            : t("sync.resolveFailed"),
        );
      } finally {
        setResolving(null);
      }
    },
    [resolveCard, post, t, clearFailure, fail],
  );

  return { resolving, resolve };
}
