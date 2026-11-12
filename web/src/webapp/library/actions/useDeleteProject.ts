// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { pairingFor } from "../../../project/sync/pairing";
import type { ProjectRef } from "../../../storage";
import { libraryIdForRef } from "../../../profile/library";
import { libraryRows } from "../../../profile/profileSync";
import type { ProjectCard as Card } from "../useProjects";
import type { ActionFailure } from "./useActionError";
import {
  actionFailure,
  trashOnRemote,
  type LibraryCardsApi,
  type ShelfToasts,
  type ShelfUser,
} from "./shelfActions";

export interface DeleteProjectInput extends Pick<
  LibraryCardsApi,
  "drop" | "forget" | "revalidate" | "unpair"
> {
  user: ShelfUser;
  /**
   * Local+Synced cards, by the project's own id; the per-side choices key on
   * it.
   */
  synced: Set<string>;
  toasts: ShelfToasts;
  failure: ActionFailure;
}

/**
 * Taking a project off the shelf: Delete, which bins its Remote Storage
 * folder behind a confirmation, and Remove, which forgets the card and
 * offers Undo. On a Local+Synced card the two are the halves of one per-side
 * choice.
 */
export function useDeleteProject({
  user,
  synced,
  drop,
  forget,
  revalidate,
  unpair,
  toasts,
  failure,
}: DeleteProjectInput) {
  const { t } = useTranslation();
  const { post } = toasts;
  const { clear: clearFailure, fail } = failure;

  /** The card the Delete confirmation is open on. */
  const [pending, setPending] = useState<Card | null>(null);
  const request = useCallback((card: Card) => setPending(card), []);
  const cancel = useCallback(() => setPending(null), []);

  /**
   * Moves a project's Remote Storage folder to the bin.
   *
   * The irreversible branch: the AlertDialog is the protection and no Undo
   * toast follows, since an Undo could not be honoured once the writer empties
   * Remote Storage's bin.
   *
   * On a Local+Synced card this is the Delete half of the per-side choice: the
   * Remote Storage copy goes to the bin and the pairing ends, the local folder
   * is untouched, and the card stays as plain Local.
   */
  const confirm = useCallback(
    async (card: Card) => {
      setPending(null);
      clearFailure();
      const title = card.content?.title ?? card.ref.name;
      try {
        if (card.id && synced.has(card.id)) {
          const remote = await pairingFor(card.id);
          if (remote) {
            await trashOnRemote({
              providerId: remote.providerId,
              key: remote.key,
              name: card.ref.name,
              openedAt: "",
            });
          }
          await unpair(card.ref);
          await revalidate(card.ref);
        } else {
          await trashOnRemote(card.ref);
          drop(card.ref);
        }
        post(t("library.deleted", { title }));
      } catch (err) {
        fail(actionFailure(err, t));
      }
    },
    [drop, revalidate, synced, unpair, post, t, clearFailure, fail],
  );

  const remove = useCallback(
    (ref: ProjectRef) => {
      // On a Local+Synced card this is the Remove half of the per-side choice:
      // the Remote Storage copy stays as it was, re-importable, and only the
      // pairing ends. Undo brings the local project back as plain Local, not
      // re-paired.
      //
      // The synced set is keyed by the book's own id, never the address,
      // so the mirror turns this ref into that id, read before
      // `forget` removes the row.
      const id = user ? libraryIdForRef(libraryRows(user.id), ref) : null;
      if (id && synced.has(id)) void unpair(ref);

      // Reversible, so it happens now and offers Undo. A confirmation here
      // would teach writers to click through.
      const restore = forget(ref);
      post(t("library.removed", { title: ref.name }), restore);
    },
    [user, forget, synced, unpair, post, t],
  );

  return { pending, request, cancel, confirm, remove };
}
