// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { folderNameFor } from "../../../project/naming";
import { openProjectStorage } from "../../../project/projectStorage";
import { copyProject } from "../../../project/transfer";
import { retryNow, settled } from "../../../project/sync/remoteQueue";
import { LOST, opsFor } from "../../../project/sync/remoteQueueStore";
import { refIdentity } from "../../../project/refIdentity";
import {
  createLocalProject,
  localProvider,
  type ProjectRef,
} from "../../../storage";
import { libraryRefs } from "../../../profile/library";
import { libraryRows } from "../../../profile/profileSync";
import type { ProjectCard as Card } from "../useProjects";
import type { ActionFailure } from "./useActionError";
import type { CopyJob } from "./useCopyJob";
import {
  actionFailure,
  goToAdopted,
  trashOnRemote,
  type LibraryCardsApi,
  type ShelfToasts,
  type ShelfUser,
} from "./shelfActions";

/**
 * Whether the queue still owes the remote work for this book. A lost change
 * does not count: its bytes exist nowhere, so no drain can send it, and the
 * row is only the notice saying so.
 */
async function owesRemote(address: {
  providerId: string;
  key: string;
}): Promise<boolean> {
  const rows = await opsFor(address);
  return rows.some((row) => row.stopped?.code !== LOST);
}

export interface MoveToLocalInput {
  user: ShelfUser;
  navigate: (to: string) => void;
  relocate: LibraryCardsApi["relocate"];
  toasts: ShelfToasts;
  failure: ActionFailure;
  copyJob: CopyJob;
}

/**
 * Move to Local: the confirmation a Remote Storage card's Move opens, and the
 * copy its confirmation runs.
 */
export function useMoveToLocal({
  user,
  navigate,
  relocate,
  toasts,
  failure,
  copyJob,
}: MoveToLocalInput) {
  const { t } = useTranslation();
  const { post } = toasts;
  const { clear: clearFailure, fail } = failure;
  const { start, progress, finish } = copyJob;

  /** The card the confirmation is open on. */
  const [pending, setPending] = useState<Card | null>(null);
  const request = useCallback((card: Card) => setPending(card), []);
  const cancel = useCallback(() => setPending(null), []);

  /**
   * Move to Local deletes the Remote Storage folder once the copy succeeds, so
   * it is confirmed by `AlertDialog`. A missing local root fails as in
   * creation.
   *
   * The copy reads the book through its working copy (`openProjectStorage`),
   * where the writer's last saves are before the queue carries them. The
   * move also waits for the queue: the original goes to the bin only once
   * the remote holds everything, so the bin keeps the whole book. Work the
   * queue cannot deliver now refuses the move, and the book stays where it
   * is.
   */
  const confirm = useCallback(
    async (card: Card) => {
      setPending(null);
      clearFailure();
      if (!user) return;
      // The working copy and the queue are keyed by the book's id; a card
      // without one was never read, and there is nothing to move through.
      const id = card.id;
      if (!id) {
        fail(t("library.openFailed"));
        return;
      }

      // A shelf name is refused as the creation wizard refuses it. A folder
      // outside the library is the provider's to refuse.
      const folder = folderNameFor(card.content?.title ?? card.ref.name);
      const own = refIdentity(card.ref);
      const taken = libraryRefs(libraryRows(user.id)).some(
        (ref) => refIdentity(ref) !== own && folderNameFor(ref.name) === folder,
      );
      if (taken) {
        fail(t("name.folderTaken", { folder }));
        return;
      }

      // The folder first, while the click's permission still holds.
      let target: ProjectRef;
      try {
        target = await createLocalProject(folder);
      } catch (err) {
        fail(actionFailure(err, t));
        return;
      }

      const address = {
        id,
        providerId: card.ref.providerId,
        key: card.ref.key,
      };
      const owed = () =>
        fail(t("library.moveToLocalOwed", { name: card.ref.name }));

      // Up before the drain, which is a round trip per queued change.
      const signal = start(card.ref.name, "move");

      let opened: Awaited<ReturnType<typeof openProjectStorage>> = null;
      try {
        // This book's queue only: its stopped ops get one more attempt, and
        // no other book's capped or stopped work is touched.
        await retryNow(address);
        await settled(address);
        if (await owesRemote(address)) {
          owed();
          return;
        }

        opened = await openProjectStorage(card.ref, id);
        if (!opened) {
          fail(t("library.openFailed"));
          return;
        }
        const result = await copyProject(
          { provider: opened.storage, ref: card.ref },
          { provider: localProvider, ref: target },
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

        // A save that reached the queue while the copy ran, from another
        // tab, may be missing from the copy.
        if (await owesRemote(address)) {
          owed();
          return;
        }

        // The Remote Storage original is binned only once the local copy is
        // proven readable. `relocate` reads the copy before it moves anything
        // and answers false, touching neither card nor row, when it cannot, so
        // an unreadable copy stops here with the Remote Storage original
        // intact.
        if (!(await relocate(card.ref, target))) {
          fail(t("library.openFailed"));
          return;
        }
        await trashOnRemote(card.ref);
        post(t("library.movedToLocal", { name: card.ref.name }));
        goToAdopted(user.id, target, navigate);
      } catch (err) {
        fail(actionFailure(err, t));
      } finally {
        opened?.dispose();
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
