// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useRef, useState } from "react";
import type { StorageProvider, ProjectRef } from "../storage";
import { prepareSource, type BodySource } from "../project/search";
import { pooled } from "../project/pool";
import { refIdentity } from "../project/refIdentity";

// The project's own words, held long enough to be searched: a map from a
// source key to a file's text, filled on demand and dropped with the project.
// The scan is a regex over a few hundred kilobytes, so an inverted index would
// be a second representation to keep correct for no measurable gain.
// `sourcesFor` and `prepareSource` in `search.ts` own the paths, the keys and
// the markdown stripping.
//
// The map lives in memory only, never in IndexedDB, OPFS or the working copy,
// so it needs no handling at sign-out. Nothing derived from body text enters
// `CardContent` or any synced profile. It is not built on open: reading every
// file of a book costs every writer for the few who search. A search sweeps
// the working copy, not Remote Storage.

/**
 * How many files to read at once: the Library's cap (`pool.ts`), because all
 * at once against a remote may be rate-limited.
 */
const READ_AT_ONCE = 6;

/**
 * A source's text, and the search it was read for.
 *
 * `text` is null for a file that was tried and could not be read. It is
 * recorded rather than skipped: the sweep finishes when every source has an
 * entry for this session, and a file without one would leave the panel
 * reading for as long as the project is open.
 */
interface Entry {
  session: number;
  /** The last write to the file's path seen when the read started. */
  writtenAt: number;
  text: string | null;
}

/** No writes seen, shared so the default allocates nothing per render. */
const NO_WRITES: ReadonlyMap<string, number> = new Map();

/** What the panel gets: the words, and whether more are still coming. */
export interface ProjectBodies {
  bodies: ReadonlyMap<string, string>;
  /**
   * This search's sweep has not finished.
   *
   * Derived from the entries and the session, never stored: a flag set at the
   * start of a sweep and cleared at its end can be left standing by two
   * overlapping sweeps.
   */
  reading: boolean;
}

/**
 * Every source's text, for whatever has been read so far. The map grows while
 * a sweep runs, so the panel never waits for the slowest file.
 *
 * `session` invalidates the whole book: 0 until the writer starts a search,
 * and a new number for each search after. Every file is read again on a new
 * number and no file twice within one. A cache key the save path must
 * remember to move goes stale and hides the writer's edits from search; a
 * counter the panel owns cannot.
 *
 * The map is not cleared when the session moves, so a second search shows
 * the previous answer while it re-reads.
 *
 * `written` is the latest write stamp, from the storage port's write notice,
 * on each source path. A write after an entry was read makes only that entry
 * owed again. While `held`, such an entry is not owed yet; the files written
 * meanwhile are read when the hold lifts (`useProjectFind` says why).
 */
export function useProjectBodies(
  ref: ProjectRef | null,
  provider: StorageProvider | null,
  sources: readonly BodySource[],
  session: number,
  written: ReadonlyMap<string, number> = NO_WRITES,
  held = false,
): ProjectBodies {
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(new Map());

  const owes = (source: BodySource, entry: Entry | undefined): boolean =>
    entry?.session !== session ||
    (!held && entry.writtenAt < (written.get(source.path) ?? 0));

  const identity = ref ? refIdentity(ref) : null;
  const identityRef = useRef(identity);
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    // Synchronous, during render: an effect would let one render pass the
    // previous project's prose to a panel already showing the new project's
    // tree. The worst case here is an empty result set for one frame.
    if (entries.size > 0) setEntries(new Map());
  }

  useEffect(() => {
    if (session === 0 || !ref || !provider || sources.length === 0) return;

    // Only what this search has not read yet, or what was written since it
    // was read. On a re-render inside one search, every keystroke after the
    // first, this is empty.
    const owed = sources.filter((source) =>
      owes(source, entries.get(source.key)),
    );
    if (owed.length === 0) return;

    const controller = new AbortController();
    void pooled(
      owed,
      READ_AT_ONCE,
      async (source) => {
        const writtenAt = written.get(source.path) ?? 0;
        try {
          return { writtenAt, text: await provider.readFile(ref, source.path) };
        } catch {
          // An unreadable file drops out of the results; the rest of the
          // project stays searchable.
          return { writtenAt, text: null };
        }
      },
      ({ writtenAt, text }, source) => {
        if (controller.signal.aborted) return;
        setEntries((current) => {
          const next = new Map(current);
          // Prepared once per read rather than per match: a file is read once
          // per search session and matched far more often.
          next.set(source.key, {
            session,
            writtenAt,
            text: text === null ? null : prepareSource(text),
          });
          return next;
        });
      },
      controller.signal,
    ).catch(() => {
      // `pooled` rejects on abort with the signal's reason. The results
      // already delivered stand, and the superseding sweep is running.
    });

    return () => controller.abort();
    // `entries` is read but not a dependency: it changes on every file that
    // lands, and depending on it would restart the sweep per file. A new
    // search (`session`), a write to a source (`written`), the hold lifting
    // (`held`), the project moving (`ref`, `provider`) or the list of files
    // changing retriggers it. A re-run's closure sees the latest `entries`,
    // so whatever had not landed is still owed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, written, held, ref, provider, sources]);

  return useMemo(
    () => ({
      bodies: new Map(
        [...entries]
          .filter(
            (pair): pair is [string, Entry & { text: string }] =>
              typeof pair[1].text === "string",
          )
          .map(([key, entry]) => [key, entry.text]),
      ),
      // The effect's own preconditions, repeated: without a project or a
      // provider nothing lands, and a sweep that cannot start must not be
      // drawn as one that has not finished.
      reading:
        session > 0 &&
        ref !== null &&
        provider !== null &&
        sources.length > 0 &&
        sources.some((source) => owes(source, entries.get(source.key))),
    }),
    // `owes` reads `written` and `held`, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, sources, session, written, held, ref, provider],
  );
}
