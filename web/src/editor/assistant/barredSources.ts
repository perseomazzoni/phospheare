// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The open project's barred sources, read and written through the project's
// own provider. One service per open project, with one lane: every read and
// every change runs in it, so a read never sees a half-applied toggle and two
// quick toggles cannot drop one another.
//
// The file is read afresh for every answer the assistant needs, never from
// memory: a sync can bring down a bar set on another device at any moment,
// and a cached list would let the assistant read the source until the next
// open. A file that cannot be reached, or one that is damaged, is not the
// same as no file. The read then throws, so the assistant fails closed, and
// a change refuses to write over bars it could not read. A damaged file stays
// for the writer to repair or remove.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { BARRED_SOURCES_FILE } from "../../project/naming";
import {
  NO_BARS,
  parseBarred,
  serializeBarred,
  withBarred,
} from "../../project/barredSources";
import type { DocumentStructure } from "../../project/types";
import type { ProjectRef, StorageProvider } from "../../storage/types";
import { useDeferredDispose } from "../useDeferredDispose";

export class BarredSources {
  private lane: Promise<unknown> = Promise.resolve();
  private view: readonly string[] = NO_BARS;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    private readonly provider: StorageProvider,
    private readonly ref: ProjectRef,
  ) {}

  /** For `useSyncExternalStore`: what the last read or write found. */
  readonly snapshot = (): readonly string[] => this.view;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** No more reads land and no more listeners hear, once the project closes. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  /**
   * The barred ids as the file holds them now. Throws when the file cannot
   * be reached: a caller that gates the assistant must then refuse.
   */
  current(): Promise<ReadonlySet<string>> {
    return this.queue(async () => new Set(await this.read()));
  }

  /** Reads the file again for the screen. A failure keeps what it showed. */
  refresh(): void {
    void this.current().catch(() => undefined);
  }

  /** Bars a source from the assistant, or lets it back in. */
  setBarred(sourceId: string, barred: boolean): Promise<void> {
    return this.queue(async () => {
      const latest = await this.read();
      const next = withBarred(latest, sourceId, barred);
      await this.provider.writeFile(
        this.ref,
        BARRED_SOURCES_FILE,
        serializeBarred(next),
      );
      this.show(next);
    });
  }

  private queue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.lane.then(job);
    // A failed job never breaks the chain: one refused read must not strand
    // every later change.
    this.lane = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<readonly string[]> {
    if (!(await this.provider.exists(this.ref, BARRED_SOURCES_FILE))) {
      this.show(NO_BARS);
      return NO_BARS;
    }
    const ids = parseBarred(
      await this.provider.readFile(this.ref, BARRED_SOURCES_FILE),
    );
    if (ids === null) throw new Error("barred-sources-damaged");
    this.show(ids);
    return ids;
  }

  private show(ids: readonly string[]): void {
    if (this.disposed) return;
    const same =
      ids.length === this.view.length &&
      ids.every((id, i) => id === this.view[i]);
    if (same) return;
    this.view = ids;
    for (const listener of this.listeners) listener();
  }
}

const noSubscription = () => () => undefined;
const nothing = () => NO_BARS;

/**
 * The service for this project, built on its provider and dropped with it.
 * The dock's list is read again whenever the structure changes, as the
 * comments are; the assistant never reads the list, only `current`.
 */
export function useBarredSources(
  provider: StorageProvider,
  ref: ProjectRef | null,
  structure: DocumentStructure | null,
): { service: BarredSources | null; ids: readonly string[] } {
  const service = useMemo(
    () => (ref ? new BarredSources(provider, ref) : null),
    [provider, ref],
  );
  // Deferred, so StrictMode's mount, cleanup and mount again in development
  // never kills the instance the second mount still renders.
  useDeferredDispose(service);
  useEffect(() => {
    if (service && structure) service.refresh();
  }, [service, structure]);
  const ids = useSyncExternalStore(
    service?.subscribe ?? noSubscription,
    service?.snapshot ?? nothing,
  );
  return { service, ids };
}
