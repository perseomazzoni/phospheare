// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProviderKind } from "../../storage/types";
import type { CardState } from "./useProjects";

// What a card offers, as rules testable without a DOM, as `libraryFilter.ts`
// does for search.
//
// The rules read `storage`, the three-state model (Local, Remote,
// Local+Synced), not `providerId`. `synced` is not a fourth provider: a paired
// project's `ProjectRef` stays `local:<key>` (`storage/mirrored.ts`), so only
// the caller knows whether a local card is paired, and it hands that fact in.
//
// Every rule is a capability of the backend or the browser, not a preference:
//
// - Delete is remote only, and a synced project gets both Delete and Remove.
//   A remote moves a folder to a bin the writer can restore from. The File
//   System Access API has no bin: holding the root, it could remove a book's
//   folder, but permanently. A Local+Synced project offers both, one per
//   side: Delete trashes the remote copy and unpairs, leaving the local
//   folder; Remove from library forgets the local tracking and unpairs,
//   leaving the remote copy for a remote sweep or another device to find.
// - Move to the remote and Move to Local are asymmetric, like Delete. Moving
//   to the remote leaves the local folder in place, recoverable in a file
//   manager. Moving to Local deletes the remote folder once the copy
//   succeeds, so it is marked dangerous.
// - Nothing appears disabled. An option a writer cannot use is absent, as in
//   the editor's own menus: a greyed row invites a click and then explains
//   itself.

export type StorageState = "local" | "remote" | "synced";

export type CardActionId =
  | "reveal"
  | "locate"
  | "properties"
  | "duplicate"
  | "export"
  | "sync"
  | "syncNow"
  | "unpair"
  | "moveToRemote"
  | "moveToLocal"
  | "delete"
  | "forget";

export interface CardActionInput {
  storage: StorageState;
  state: CardState;
  /** False when there is nowhere to reach this card's remote right now. */
  remoteConnected: boolean;
  /**
   * The paired remote's own key, meaningful only when `storage` is `synced`.
   */
  remoteKey?: string;
  /**
   * Whether the provider answered `folderUrl`, so the remote can be opened in
   * a browser. False for a backend with no web address.
   */
  canRevealRemote: boolean;
  /**
   * Whether a local root is mapped. `locate` ("Reveal on this device") walks
   * the root handle, so it is offered only when there is a folder to reveal.
   */
  localRootReady: boolean;
}

/**
 * The storage state from the provider's kind and whether the local project is
 * paired. It takes `ProviderKind` rather than comparing ids, because the
 * question is device or network, and an id comparison answers that only while
 * two providers are registered.
 */
export function storageStateFor(
  kind: ProviderKind,
  paired: boolean,
): StorageState {
  if (kind === "remote") return "remote";
  return paired ? "synced" : "local";
}

/**
 * The card's actions in menu order, destructive last and in one run: `Menu`
 * rules off once before the first item marked `danger`, so a safe item after
 * a dangerous one would land on the wrong side of that line.
 */
export function cardActions(input: CardActionInput): CardActionId[] {
  const { storage, state, remoteConnected } = input;

  // Read this session, so both a read and a write will land. On a blocked
  // card either would fail on its first request.
  const readable = state === "ready";
  // A blocked remote card is excluded alongside `gone`: there is nowhere to
  // send a write. A blocked local card stays reachable, because its files are
  // on this disk and the shelf banner is the recovery.
  const reachable =
    state !== "loading" &&
    state !== "gone" &&
    !(state === "blocked" && storage === "remote");

  const items: CardActionId[] = [];

  // Hidden while the remote is disconnected, when the card shows the
  // provider's connect button, and for a backend with no web address.
  if (
    (storage === "remote" || (storage === "synced" && input.remoteKey)) &&
    remoteConnected &&
    input.canRevealRemote
  )
    items.push("reveal");
  // A local card's reveal: the web platform has no path to open a file
  // manager at, so the native picker opens positioned at the folder. It walks
  // the root handle, so it needs a mapped root. A `gone` card's folder is not
  // under this root, and a picker sitting at the root does not answer where
  // the project is.
  if (
    (storage === "local" || storage === "synced") &&
    input.localRootReady &&
    state !== "gone"
  )
    items.push("locate");
  // Properties read and write the book's own file and export reads
  // the whole book, so both need what duplicate needs: a card read this
  // session.
  if (readable) items.push("properties", "duplicate", "export");

  if (storage === "local" && readable && remoteConnected)
    items.push("sync", "moveToRemote");
  if (storage === "synced" && readable && remoteConnected)
    items.push("syncNow");
  // Unpairing keeps both copies, so it needs nothing from the remote and is
  // offered while disconnected, when a stuck "paused" pairing most needs it.
  if (storage === "synced") items.push("unpair");
  // Destructive, in one contiguous run.
  if (storage === "remote" && readable && remoteConnected)
    items.push("moveToLocal");
  // Forget sits directly above delete, so the two options that take a
  // project off the shelf are adjacent.
  items.push("forget");
  if (
    (storage === "remote" || storage === "synced") &&
    remoteConnected &&
    reachable
  )
    items.push("delete");

  return items;
}

/** Whether an action destroys something; `Menu` styles and rules these off. */
export function isDangerous(id: CardActionId): boolean {
  return id === "delete" || id === "moveToLocal" || id === "forget";
}
