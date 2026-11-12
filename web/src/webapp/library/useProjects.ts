// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { SyncCheckResult } from "../../project/sync/check";
import { storageErrorMessage } from "../../storage/messages";
import {
  driveProvider,
  localProvider,
  type Connections,
  type ProjectRef,
  type StorageProvider,
} from "../../storage";
import type { ProjectCard } from "./shelf/domain/cards";
import { Shelf, type ShelfInputs, type SweepWatch } from "./shelf/shelf";
import { SyncMarks } from "./shelf/syncMarks";

// The Library's view of the shelf. The work lives in two plain classes:
// `Shelf` (`shelf/shelf.ts`) holds the cards and their reads, and
// `SyncMarks` (`shelf/syncMarks.ts`) holds which books are synced and which
// are in conflict. This hook makes them for one account, hands them the
// connection facts on every commit, starts and stops them, and reads them.

export {
  openableId,
  type CardState,
  type ProjectCard,
} from "./shelf/domain/cards";
export type { SweepProgress, SweepWatch } from "./shelf/shelf";

export interface ProjectsShelf {
  cards: ProjectCard[];
  /**
   * True until the candidate lists are settled, not until every card is read.
   */
  listing: boolean;
  /**
   * Gather accounting: how many gathers have started and settled this
   * session. Both are monotonic, so they signal "the gather my rescan started
   * has settled" where `listing` cannot: a rescan can net the boolean out
   * unchanged, and a consumer watching it would hold the login splash forever.
   *
   * Every start reaches one settle, through the `finally` around the gather
   * closure's body, even when a newer rescan supersedes it. Under
   * the shelf's single-flight slot a superseded gather settles before its
   * parked replacement. The one start without a settle is a closure
   * overwritten in the pending slot before it ran, bounded by
   * `useLibraryReveal`'s settle timeout.
   */
  gatherStarts: number;
  gatherSettles: number;
  /** Grants access from inside a click, then reads and re-renders in place. */
  reconnect: (ref: ProjectRef) => Promise<void>;
  /** Reads one project again after something changed it. Never prompts. */
  revalidate: (ref: ProjectRef, through?: StorageProvider) => Promise<void>;
  /** Puts a project just made on the shelf, and reads it. */
  adopt: (ref: ProjectRef) => Promise<void>;
  /** Takes a project off the shelf because its folder is gone. No undo. */
  drop: (ref: ProjectRef) => void;
  /** Takes a project off the shelf, returning the function that restores it. */
  forget: (ref: ProjectRef) => () => void;
  /**
   * Local+Synced cards, keyed by the project's own id. A synced
   * project's `ProjectRef` stays `local:<key>`, because sync is a decorator,
   * not a provider (`storage/mirrored.ts`), so only this set says from the
   * outside whether a project is paired.
   */
  synced: Set<string>;
  /** Marks a card synced right after `pair()` succeeds. */
  markSynced: (projectId: string) => void;
  /**
   * Local+Synced projects with a real conflict, keyed by the project's own id.
   */
  conflicts: Map<string, SyncCheckResult>;
  /** The manual Sync now: the check `gather()` runs in the background. */
  checkNow: (ref: ProjectRef) => Promise<SyncCheckResult | null>;
  /** Resolves a whole-project conflict by keeping one side. */
  resolve: (projectId: string, keep: "local" | "remote") => Promise<void>;
  /**
   * Disables Sync: both copies survive, and the card returns to plain Local.
   */
  unpair: (ref: ProjectRef) => Promise<void>;
  /**
   * Scans Remote Storage for new projects and adds them; resolves the count
   * added. Rejects when Remote Storage could not be listed.
   */
  scanDrive: (watch?: SweepWatch) => Promise<number>;
  /**
   * The local twin of `scanDrive`. Re-grants a lapsed permission inside the
   * caller's click; resolves the count added.
   */
  scanLocal: (watch?: SweepWatch) => Promise<number>;
  /**
   * Whether a local root is chosen on this device, from the local
   * connection's state. It decides wording and the create dialog's local
   * hint; it is informational, never a gate, because every action needing
   * the root acquires it inside the click.
   */
  localRootReady: boolean;
  /**
   * The connection's latch: the handle store has answered at least once.
   * The disconnect banner speaks only after it, because before it
   * "no root" is a missing answer, and stating it would flash the banner on
   * every refresh.
   */
  localRootResolved: boolean;
  /**
   * The same book at a new address, the end of a move between backends: one
   * row, relocated, never a tombstone and a new row.
   */
  relocate: (from: ProjectRef, to: ProjectRef) => Promise<boolean>;
  /** Re-runs the whole gather, the last step of choosing the local root. */
  rescan: () => void;
  /**
   * Re-applies the mirror's card content to the current cards without a
   * provider read, after a settled pull: content changes touch no membership
   * and no file this device would read differently. Idempotent.
   */
  refreshContent: () => void;
}

export function useProjects(
  userId: string,
  connections: Connections,
): ProjectsShelf {
  const { t } = useTranslation();

  // The connection facts, one state axis per provider. Remote Storage's
  // `connected` gates the listing and the sync pass. `driveResolved` is the
  // auth latch: an unresolved verdict is not a lapsed one, and painting it as
  // lapsed would bar every cached card for the first frames of a refresh.
  // Local's "chosen" is the connection state minus the never-chosen and
  // unsupported cases, which the banner grammar keys on.
  const driveConnected = connections.drive.state === "connected";
  const driveResolved = connections.drive.resolved;
  const localRootReady =
    connections.local.state === "connected" ||
    connections.local.state === "needs-gesture";
  const localRootResolved = connections.local.resolved;

  const inputs: ShelfInputs = {
    reach: {
      remoteConnected: driveConnected,
      remoteResolved: driveResolved,
      rootReady: localRootReady,
      rootResolved: localRootResolved,
    },
    connections,
    describe: (err) => storageErrorMessage(err, t, ""),
  };

  // One shelf and one set of sync marks per account. The marks' `resolve`
  // re-reads the card it rewrote through the shelf.
  const { shelf, marks } = useMemo(() => {
    let shelfRef: Shelf | null = null;
    const syncMarks = new SyncMarks(userId, (ref) =>
      shelfRef ? shelfRef.revalidate(ref) : Promise.resolve(),
    );
    shelfRef = new Shelf(userId, syncMarks, inputs);
    return { shelf: shelfRef, marks: syncMarks };
    // `inputs` is the first set only; later ones arrive through the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Every commit hands the shelf the newest facts. Defined before the start,
  // so the first gather reads this commit's.
  useEffect(() => {
    shelf.setInputs(inputs);
  });

  useEffect(() => {
    shelf.start();
    return () => shelf.stop();
  }, [shelf]);

  const state = useSyncExternalStore(shelf.subscribe, shelf.snapshot);
  const { synced, conflicts } = useSyncExternalStore(
    marks.subscribe,
    marks.snapshot,
  );

  return {
    cards: state.cards,
    listing: state.listing,
    gatherStarts: state.gatherStarts,
    gatherSettles: state.gatherSettles,
    reconnect: shelf.reconnect,
    revalidate: shelf.revalidate,
    adopt: shelf.adopt,
    drop: shelf.drop,
    forget: shelf.forget,
    synced,
    markSynced: marks.markSynced,
    conflicts,
    relocate: shelf.relocate,
    checkNow: marks.checkNow,
    resolve: marks.resolve,
    unpair: marks.unpair,
    scanDrive: shelf.scanDrive,
    scanLocal: shelf.scanLocal,
    localRootReady,
    localRootResolved,
    rescan: shelf.rescan,
    refreshContent: shelf.refreshContent,
  };
}

/** Which sources the strip offers, and how many projects each holds. */
export function sourceCounts(
  cards: readonly ProjectCard[],
): Record<string, number> {
  const counts: Record<string, number> = {
    [localProvider.id]: 0,
    [driveProvider.id]: 0,
  };
  for (const card of cards)
    counts[card.ref.providerId] = (counts[card.ref.providerId] ?? 0) + 1;
  return counts;
}
