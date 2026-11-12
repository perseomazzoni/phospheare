// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sameFacts, type ProjectFacts } from "../../../project/facts";
import { readProjectFacts, saveProjectFacts } from "../../../project/editFacts";
import { openProjectStorage } from "../../../project/projectStorage";
import { getProvider, type ProjectRef } from "../../../storage";
import { renameLibraryRow } from "../../../profile/profileSync";
import type { ProjectCard as Card } from "../useProjects";
import type { ActionFailure } from "./useActionError";
import {
  actionFailure,
  type LibraryCardsApi,
  type ShelfToasts,
  type ShelfUser,
} from "./shelfActions";

/**
 * The Properties window: the card it is for, and the book's facts
 * when the window opened, `null` while they are read and `null` with
 * `failed` when the read failed. `saving` while a save is written, `error`
 * when the last one failed; the window stays open through both, holding the
 * writer's answers.
 */
interface FactsEditing {
  card: Card;
  facts: ProjectFacts | null;
  failed: boolean;
  saving: boolean;
  error: string | null;
}

export interface ProjectFactsInput {
  user: ShelfUser;
  revalidate: LibraryCardsApi["revalidate"];
  toasts: ShelfToasts;
  failure: ActionFailure;
}

/**
 * The Properties window: reading a book's facts when it opens, saving the
 * writer's answers, and the Undo each save offers.
 */
export function useProjectFacts({
  user,
  revalidate,
  toasts,
  failure,
}: ProjectFactsInput) {
  const { t } = useTranslation();
  const { post, dismiss } = toasts;
  const { clear: clearFailure, fail } = failure;

  const [editing, setEditing] = useState<FactsEditing | null>(null);
  // Which opening of the Properties window a read answers: a read returning
  // after the window closed, or reopened on another card, must not paint its
  // facts into this one.
  const opening = useRef(0);
  // Which save each book's newest Undo belongs to. An Undo puts back what its
  // own save replaced; after a later write, an older toast would restore
  // facts from two writes ago at a ref that may not name the folder any
  // more, so it does nothing.
  const saves = useRef(new Map<string, number>());
  // The toast carrying that Undo. A newer save of the same book dismisses the
  // older toast, because an Undo that does nothing misleads; the counter
  // covers a press that races the dismissal.
  const undoToasts = useRef(new Map<string, number>());

  /**
   * Opens the Properties window on a card.
   *
   * The facts are read on opening through the working copy, as Move to
   * Local reads the book, and the storage is released once the read is
   * done: the window holds answers, not a subscription.
   */
  const open = useCallback(async (card: Card) => {
    const thisOpening = ++opening.current;
    const empty = { card, saving: false, error: null };
    setEditing({ ...empty, facts: null, failed: false });
    let facts: ProjectFacts | null = null;
    const opened = card.id
      ? await openProjectStorage(card.ref, card.id).catch(() => null)
      : null;
    try {
      if (opened) facts = await readProjectFacts(opened.storage, card.ref);
    } catch {
      // The window says it could not read the book; for every cause a writer
      // can act on, the reason is that the folder is not readable.
    } finally {
      opened?.dispose();
    }
    if (thisOpening !== opening.current) return;
    setEditing({ ...empty, facts, failed: facts === null });
  }, []);

  const close = useCallback(() => {
    opening.current++;
    setEditing(null);
  }, []);

  /**
   * Writes a book's facts at `ref` and shows them on the shelf: the folder's
   * new name on the library row when Remote Storage renamed it, and the card
   * re-read where the write landed. Resolves the ref that now describes the
   * book. `wasTitle` is the title the change is measured against.
   */
  const writeFacts = useCallback(
    async (
      card: Card,
      ref: ProjectRef,
      facts: ProjectFacts,
      wasTitle: string,
    ): Promise<ProjectRef> => {
      const backend = getProvider(ref.providerId);
      const opened = card.id ? await openProjectStorage(ref, card.id) : null;
      // No storage to write through. The writer can act on nothing beyond
      // "it could not be reached", which is `actionFailure`'s fallback.
      if (!opened || !backend) throw new Error("properties-storage-missing");
      try {
        const saved = await saveProjectFacts(
          opened.storage,
          backend,
          ref,
          facts,
          wasTitle,
        );
        // Remote Storage renamed the folder: the row's name follows before
        // the revalidate's content push, which carries the row's name.
        // A device folder is never renamed (`retitle.ts`), so only a real
        // folder rename touches the row.
        if (user && saved.name !== ref.name) {
          renameLibraryRow(user.id, saved.providerId, saved.key, saved.name);
        }
        await revalidate(saved, opened.storage);
        return saved;
      } finally {
        opened.dispose();
      }
    },
    [revalidate, user],
  );

  /**
   * Saves the Properties window and offers Undo.
   *
   * The window stays open, busy and modal until the write lands, so the card
   * cannot be reopened on its pre-save facts mid-write. It closes on success;
   * on failure it stays, with the reason inside and every answer in the
   * fields.
   *
   * Reversible, so it acts on Save and offers Undo rather than asking twice.
   * Undo is the same write with the facts the window opened on, at the ref
   * this save returned, because on Remote Storage the folder may have been
   * renamed. A save that changes nothing writes nothing.
   */
  const save = useCallback(
    async (card: Card, was: ProjectFacts, next: ProjectFacts) => {
      clearFailure();
      if (sameFacts(was, next)) {
        opening.current++;
        setEditing(null);
        return;
      }
      const forThisWindow = (change: (open: FactsEditing) => FactsEditing) =>
        setEditing((open) =>
          open && open.card === card ? change(open) : open,
        );
      forThisWindow((open) => ({ ...open, saving: true, error: null }));
      try {
        const saved = await writeFacts(card, card.ref, next, was.title);
        const book = card.id ?? card.ref.key;
        const thisSave = (saves.current.get(book) ?? 0) + 1;
        saves.current.set(book, thisSave);
        opening.current++;
        setEditing(null);
        const older = undoToasts.current.get(book);
        if (older !== undefined) dismiss(older);
        const toast = post(
          t("library.propertiesSaved", { title: next.title.trim() }),
          () => {
            if (saves.current.get(book) !== thisSave) return;
            saves.current.set(book, thisSave + 1);
            // A window reopened on this book holds the facts this Undo
            // replaces, and its next Save would write them back. The Undo
            // closes it, so the writer reopens on what is true.
            setEditing((open) => {
              if (!open || (open.card.id ?? open.card.ref.key) !== book)
                return open;
              opening.current++;
              return null;
            });
            void (async () => {
              try {
                await writeFacts(card, saved, was, next.title);
              } catch (err) {
                fail(actionFailure(err, t));
              }
            })();
          },
        );
        undoToasts.current.set(book, toast);
      } catch (err) {
        forThisWindow((open) => ({
          ...open,
          saving: false,
          error: actionFailure(err, t),
        }));
      }
    },
    [writeFacts, post, dismiss, t, clearFailure, fail],
  );

  return { editing, open, close, save };
}
