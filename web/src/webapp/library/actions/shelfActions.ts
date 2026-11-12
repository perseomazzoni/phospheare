// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import {
  getProvider,
  type ProjectRef,
  type StorageProvider,
} from "../../../storage";
import { storageErrorMessage } from "../../../storage/messages";
import type { SyncCheckResult } from "../../../project/sync/check";
import { libraryCard } from "../../../profile/library";
import { libraryRows } from "../../../profile/profileSync";
import { projectPath } from "../../../editor/path";
import type { Toasts } from "../../../ui";

// What the shelf's action hooks share. Every change a shelf action makes to a
// project on disk happens in the hooks beside this file, where the flows can
// be exercised without a browser; `Library` renders.

/** What the shelf contributes to an action: the cards and their operations. */
export interface LibraryCardsApi {
  adopt: (ref: ProjectRef) => Promise<void>;
  drop: (ref: ProjectRef) => void;
  forget: (ref: ProjectRef) => () => void;
  /**
   * Reads one card again. Pass `through`, the storage the write went through,
   * whenever it was not the bare provider: a book with a remote is written to
   * its working copy, and a read from the remote would show the card from
   * before the write until the queue drains.
   */
  revalidate: (ref: ProjectRef, through?: StorageProvider) => Promise<void>;
  resolve: (projectId: string, keep: "local" | "remote") => Promise<void>;
  unpair: (ref: ProjectRef) => Promise<void>;
  relocate: (from: ProjectRef, to: ProjectRef) => Promise<boolean>;
  checkNow: (ref: ProjectRef) => Promise<SyncCheckResult | null>;
  markSynced: (projectId: string) => void;
  rescan: () => void;
  /**
   * The explicit local sweep that follows a mapped root: the chosen folder's
   * books are imported on the spot, a step a reload never repeats.
   */
  scanLocal: () => Promise<number>;
}

/**
 * The toasts an action posts. Every hook depends on the members, not the
 * wrapper: `useToasts()` returns a fresh object every render, while the
 * functions it carries are stable. A callback depending on the whole object
 * would rebuild on every Library render, and each is a card prop.
 */
export type ShelfToasts = Pick<Toasts, "post" | "dismiss">;

/** The signed-in account an action works for. */
export type ShelfUser = { id: string } | null;

/**
 * An action's failure in the writer's language: a storage failure says its
 * own reason, anything else reads "could not be opened".
 */
export function actionFailure(err: unknown, t: TFunction): string {
  return storageErrorMessage(err, t, t("library.openFailed"));
}

/**
 * Goes to a project a flow has just adopted, by the id `adopt` wrote into the
 * mirror; the mirror is localStorage, so the row is there synchronously. No
 * id means the adopt could not read the project, and the card stays on the
 * shelf stating the problem.
 */
export function goToAdopted(
  userId: string,
  ref: ProjectRef,
  navigate: (to: string) => void,
): void {
  const id = libraryCard(libraryRows(userId), ref)?.id;
  if (id) navigate(projectPath(id));
}

/**
 * Bins a project on whatever backend its ref names, through the port's
 * optional `trashProject`: only the adapter knows how, or whether it
 * can. A device provider has no bin, since a File System Access API deletion
 * is permanent, so this is a no-op there; `cardActions` withholds Delete on
 * those cards.
 */
export async function trashOnRemote(ref: ProjectRef): Promise<void> {
  await getProvider(ref.providerId)?.trashProject?.(ref);
}
