// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { libraryRefForId } from "../../../profile/library";
import type { LibraryRow } from "../../../profile/profileStore";
import { libraryRows } from "../../../profile/profileSync";
import { PROPERTIES_FILE } from "../../../project/naming";
import {
  parseProperties,
  serializeProperties,
} from "../../../project/properties";
import { pooled } from "../../../project/pool";
import { projectIdFor } from "../../../project/projectId";
import { resolveConflict } from "../../../project/sync/apply";
import {
  checkSync,
  type Side,
  type SyncCheckResult,
} from "../../../project/sync/check";
import type { RemoteTarget } from "../../../project/sync/manifest";
import { putManifest } from "../../../project/sync/manifestStore";
import {
  allPairings,
  pairingFor,
  unpair as unpairProject,
} from "../../../project/sync/pairing";
import { forgetProject, resolving } from "../../../project/sync/remoteQueue";
import { getProvider, localProvider, type ProjectRef } from "../../../storage";
import { withConflict, withSynced, withoutSynced } from "./domain/syncMarks";

/** How many conflict checks run at once, the same budget as the card reads. */
const CONCURRENCY = 4;

export interface SyncMarksState {
  /**
   * Local+Synced cards, keyed by the project's own id. A synced project's
   * `ProjectRef` stays `local:<key>`, because sync is a decorator, not a
   * provider (`storage/mirrored.ts`), so only this set says from the outside
   * whether a project is paired.
   */
  synced: Set<string>;
  /** Local+Synced projects with a real conflict, keyed by the project's own id. */
  conflicts: Map<string, SyncCheckResult>;
}

/**
 * The `Side` a pairing points at, resolved through the registry, since the
 * pairing records which provider it addresses. `checkSync` and
 * `resolveConflict` read only the provider and key, so `name` and
 * `openedAt` are placeholders. `null` when the pairing names a provider this
 * build lacks, which every caller reads as not paired: there is nothing to
 * compare against or push to.
 */
function remoteSideFor(remote: RemoteTarget): Side | null {
  const provider = getProvider(remote.providerId);
  if (!provider || provider.kind !== "remote") return null;
  return {
    provider,
    ref: { providerId: provider.id, key: remote.key, name: "", openedAt: "" },
  };
}

/**
 * The local `Side` of a pairing, addressed through the mirror row that holds
 * the book. `null` when the book is not on this shelf, which reads as not
 * paired.
 */
function localSideFor(
  rows: readonly LibraryRow[],
  projectId: string,
): Side | null {
  const ref = libraryRefForId(rows, projectId);
  if (!ref || ref.providerId !== localProvider.id) return null;
  return { provider: localProvider, ref };
}

/**
 * The shelf's sync marks for one account: which books are Local+Synced and
 * which of them hold a real conflict. React reads them through `subscribe`
 * and `snapshot`; they change only through the methods here.
 */
export class SyncMarks {
  private state: SyncMarksState = { synced: new Set(), conflicts: new Map() };
  private readonly listeners = new Set<() => void>();

  /**
   * @param revalidate re-reads a card after a resolution rewrote its local
   *   copy; the shelf's own `revalidate`.
   */
  constructor(
    private readonly userId: string,
    private readonly revalidate: (ref: ProjectRef) => Promise<void>,
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): SyncMarksState => this.state;

  private set(next: SyncMarksState): void {
    if (
      next.synced === this.state.synced &&
      next.conflicts === this.state.conflicts
    )
      return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private setConflict(projectId: string, result: SyncCheckResult | null) {
    this.set({
      ...this.state,
      conflicts: withConflict(this.state.conflicts, projectId, result),
    });
  }

  /**
   * Reads every pairing and marks those books synced. Unreadable pairings say
   * nothing about which books are synced, so the marks keep their last answer
   * and the shelf still loads; `null` then, and the checks wait for the next
   * pass.
   */
  async readPairings(
    alive: () => boolean,
  ): Promise<Map<string, RemoteTarget> | null> {
    const pairings = await allPairings().catch(() => null);
    if (alive() && pairings)
      this.set({ ...this.state, synced: new Set(pairings.keys()) });
    return pairings;
  }

  /**
   * The check on open: one compare per paired project, pooled, after the card
   * reads settle so the checks do not compete with them for the browser's
   * per-host connection budget. Rejects only through `signal`.
   */
  async checkAll(
    rows: readonly LibraryRow[],
    pairings: Map<string, RemoteTarget>,
    alive: () => boolean,
    signal: AbortSignal,
  ): Promise<void> {
    await pooled(
      [...pairings],
      CONCURRENCY,
      async ([projectId, remote]): Promise<
        SyncCheckResult | null | "failed"
      > => {
        try {
          const side = remoteSideFor(remote);
          const local = localSideFor(rows, projectId);
          if (!side || !local) return null;
          return await checkSync(local, side, projectId);
        } catch {
          // A failed check is not surfaced: Sync now covers the writer
          // asking, and the next background pass retries. A distinct
          // "failed" sentinel, not `null`: `checkSync` returns `null` for not
          // paired, and reading a transient failure that way would clear a
          // standing conflict.
          return "failed";
        }
      },
      (result, [projectId]) => {
        if (!alive() || result === "failed") return;
        this.setConflict(projectId, result);
      },
      signal,
    );
  }

  /**
   * Marks a card Local+Synced as soon as `pair()` succeeds, so the badge does
   * not wait for the next listing.
   */
  readonly markSynced = (projectId: string): void => {
    this.set({
      ...this.state,
      synced: withSynced(this.state.synced, projectId),
    });
  };

  /** The manual Sync now: the check the gather runs in the background. */
  readonly checkNow = async (
    ref: ProjectRef,
  ): Promise<SyncCheckResult | null> => {
    const projectId = projectIdFor(ref);
    if (!projectId) return null;
    const remote = await pairingFor(projectId);
    const side = remote ? remoteSideFor(remote) : null;
    if (!side) return null;
    const result = await checkSync(
      { provider: localProvider, ref },
      side,
      projectId,
    );
    this.setConflict(projectId, result);
    return result;
  };

  /**
   * Resolves a whole-project conflict by keeping local or the remote. Clears
   * the conflict on success; `revalidate` picks up the content local now
   * holds, since keeping the remote rewrites it.
   */
  readonly resolve = async (
    projectId: string,
    keep: "local" | "remote",
  ): Promise<void> => {
    const conflict = this.state.conflicts.get(projectId);
    if (!conflict) return;
    const ref = libraryRefForId(libraryRows(this.userId), projectId);
    if (!ref) return;
    const side = remoteSideFor(conflict.remoteTarget);
    if (!side) return;
    // Ops queued before the resolution describe the old state: a queued `rm`
    // would delete from the remote a file keeping the remote just restored
    // locally. The copy made both sides match, so `resolving` drops them all,
    // and holds the drain and every tab's checks off the manifest until the
    // rebuilt one is written.
    await resolving(ref, projectId, async () => {
      const { manifest } = await resolveConflict(
        keep,
        { provider: localProvider, ref },
        side,
        conflict.verdict,
        conflict.remoteTarget,
      );
      await putManifest(projectId, manifest);
    });
    this.setConflict(projectId, null);
    await this.revalidate(ref);
  };

  /**
   * Disables Sync, a toggle, not a deletion: both copies survive. Drops what
   * the queue still owed the remote, which has nowhere to go, and clears the
   * `sync` hint in the local project's properties, best-effort because losing
   * it costs a re-pair, never data. The card becomes plain Local.
   */
  readonly unpair = async (ref: ProjectRef): Promise<void> => {
    const projectId = projectIdFor(ref);
    if (!projectId) return;
    await unpairProject(projectId);
    await forgetProject(ref);
    try {
      const raw = await localProvider.readFile(ref, PROPERTIES_FILE);
      const props = parseProperties(raw, ref.name);
      props.sync = null;
      await localProvider.writeFile(
        ref,
        PROPERTIES_FILE,
        serializeProperties(props),
      );
    } catch {
      // Best-effort: the pairing is already gone either way.
    }
    this.set({
      synced: withoutSynced(this.state.synced, projectId),
      conflicts: withConflict(this.state.conflicts, projectId, null),
    });
  };
}
