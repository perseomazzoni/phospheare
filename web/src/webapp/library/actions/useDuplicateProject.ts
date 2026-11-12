// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { folderNameFor } from "../../../project/naming";
import { openProjectStorage } from "../../../project/projectStorage";
import { duplicateProject } from "../../../project/duplicate";
import {
  createLocalProject,
  localProvider,
  type ProjectRef,
} from "../../../storage";
import type { ProjectCard as Card } from "../useProjects";
import type { ActionFailure } from "./useActionError";
import type { CopyJob } from "./useCopyJob";
import {
  actionFailure,
  type LibraryCardsApi,
  type ShelfToasts,
} from "./shelfActions";

export interface DuplicateProjectInput {
  adopt: LibraryCardsApi["adopt"];
  toasts: ShelfToasts;
  failure: ActionFailure;
  copyJob: CopyJob;
}

/**
 * Duplicate: the naming dialog a card's Duplicate opens, and the copy its
 * confirmation runs.
 */
export function useDuplicateProject({
  adopt,
  toasts,
  failure,
  copyJob,
}: DuplicateProjectInput) {
  const { t } = useTranslation();
  const { post } = toasts;
  const { clear: clearFailure, fail } = failure;
  const { start, progress, finish } = copyJob;

  /** The card the naming dialog is open on. */
  const [pending, setPending] = useState<Card | null>(null);
  const request = useCallback((card: Card) => setPending(card), []);
  const cancel = useCallback(() => setPending(null), []);

  /**
   * Copies a project beside itself, always onto Local. A duplicate never
   * inherits a Remote Storage pairing: `duplicateProject` strips a copied
   * `sync.remote` hint. A missing local root fails as in creation.
   *
   * It does not navigate: a writer duplicates to keep working in the
   * original. The source is read through its working copy; a cancelled
   * duplicate removes its partial copy and puts nothing on the shelf.
   */
  const confirm = useCallback(
    async (card: Card, title: string) => {
      setPending(null);
      clearFailure();
      const id = card.id;
      if (!id) {
        fail(t("library.openFailed"));
        return;
      }

      // The folder first, while the click's permission still holds.
      let target: ProjectRef;
      try {
        target = await createLocalProject(folderNameFor(title));
      } catch (err) {
        fail(actionFailure(err, t));
        return;
      }

      const signal = start(card.ref.name, "duplicate");

      let opened: Awaited<ReturnType<typeof openProjectStorage>> = null;
      try {
        opened = await openProjectStorage(card.ref, id);
        if (!opened) {
          fail(t("library.openFailed"));
          return;
        }
        const result = await duplicateProject(
          { provider: opened.storage, ref: card.ref },
          { provider: localProvider, ref: target },
          title,
          {
            signal,
            onProgress: progress,
          },
        );

        if (result.cancelled) {
          post(t("library.duplicateCancelled", { name: card.ref.name }));
          return;
        }
        await adopt(target);
        post(t("library.duplicated", { title }));
      } catch (err) {
        fail(actionFailure(err, t));
      } finally {
        opened?.dispose();
        finish();
      }
    },
    [adopt, post, t, clearFailure, fail, start, progress, finish],
  );

  return { pending, request, cancel, confirm };
}
