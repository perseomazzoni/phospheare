// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { folderNameFor } from "../../../project/naming";
import { copyProject } from "../../../project/transfer";
import { refForLog } from "../../../project/logRef";
import {
  createDriveProject,
  driveProvider,
  localProvider,
  projectsFolderId,
} from "../../../storage";
import type { ProjectCard as Card } from "../useProjects";
import type { ActionFailure } from "./useActionError";
import type { CopyJob } from "./useCopyJob";
import {
  actionFailure,
  goToAdopted,
  type LibraryAction,
  type LibraryCardsApi,
  type ShelfToasts,
  type ShelfUser,
} from "./shelfActions";
import { appLog } from "../../../log";

export interface MoveToRemoteInput {
  user: ShelfUser;
  navigate: (to: string) => void;
  relocate: LibraryCardsApi["relocate"];
  toasts: ShelfToasts;
  failure: ActionFailure;
  copyJob: CopyJob;
}

/**
 * Move to Remote Storage: the warning a local card's Move opens, and the copy
 * its confirmation runs.
 */
export function useMoveToRemote({
  user,
  navigate,
  relocate,
  toasts,
  failure,
  copyJob,
}: MoveToRemoteInput) {
  const { t } = useTranslation();
  const { post } = toasts;
  const { clear: clearFailure, fail } = failure;
  const { start, progress, finish } = copyJob;

  /** The card the warning is open on. */
  const [pending, setPending] = useState<Card | null>(null);
  const request = useCallback((card: Card) => setPending(card), []);
  const cancel = useCallback(() => setPending(null), []);

  /**
   * Move to Remote Storage leaves the local folder where it is and stops
   * tracking it. Nothing is destroyed, unlike Move to Local, so it is confirmed
   * by a warning `Dialog`, not `AlertDialog`.
   */
  const confirm = useCallback(
    async (card: Card) => {
      setPending(null);
      clearFailure();
      if (!user) return;

      const signal = start(card.ref.name, "move");
      const began = Date.now();

      try {
        const target = await createDriveProject(
          folderNameFor(card.ref.name),
          await projectsFolderId(),
        );
        const result = await copyProject(
          { provider: localProvider, ref: card.ref },
          { provider: driveProvider, ref: target },
          {
            signal,
            onProgress: progress,
          },
        );

        if (result.cancelled) {
          post(
            t("library.copyCancelled", {
              done: result.copied,
              total: result.total,
              name: card.ref.name,
            }),
          );
          return;
        }

        // One row, relocated, not a tombstone and a new row. The copy carries
        // the same `document-properties.json` and uuid, so it is the same book
        // at a new address and the shelf keeps what it remembers, `openedAt`
        // included. The local folder is never touched, so a failed
        // relocate loses nothing.
        if (!(await relocate(card.ref, target))) {
          fail(t("library.openFailed"));
          return;
        }
        appLog.info("library", "A Library action succeeded.", {
          action: "move-to-remote" satisfies LibraryAction,
          ...refForLog(target),
          ms: Date.now() - began,
        });
        post(t("library.movedToDrive", { name: card.ref.name }));
        goToAdopted(user.id, target, navigate);
      } catch (err) {
        fail(actionFailure(err, t, "move-to-remote"));
      } finally {
        finish();
      }
    },
    [
      user,
      navigate,
      relocate,
      post,
      t,
      clearFailure,
      fail,
      start,
      progress,
      finish,
    ],
  );

  return { pending, request, cancel, confirm };
}
