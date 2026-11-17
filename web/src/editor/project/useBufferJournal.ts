// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectRef, StorageProvider } from "../../storage";
import type { EditorEngine } from "../views/engine";
import { JournalKeeper } from "./application/journalKeeper";
import type { MetadataLanes } from "./application/metadataLanes";
import { providerJournal } from "./storageStores";
import { appLog } from "../../log";

/**
 * The undo timeline's journal: its read when a file opens, its flush, and
 * the one quiet notice when the read dropped it.
 *
 * The keeper holds the journals' lane and their guards. This adds the
 * order: a flush never lands before the `.md` write it belongs to.
 */
export function useBufferJournal({
  engine,
  lanes,
  provider,
  bufferFileRef,
}: {
  engine: EditorEngine;
  lanes: MetadataLanes<ProjectRef>;
  provider: StorageProvider;
  /** The file the engine's buffer was opened from; an open sets it. */
  bufferFileRef: React.RefObject<string | null>;
}) {
  const [journals] = useState(() => new JournalKeeper<ProjectRef>());
  const journalStore = useMemo(() => providerJournal(provider), [provider]);
  /** The one quiet toast: the journal was dropped as stale at the last open. */
  const [journalNotice, setJournalNotice] = useState(false);

  const flushJournal = useCallback(async () => {
    const target = lanes.owner;
    const file = bufferFileRef.current;
    if (!target || !file) return;
    const journal = engine.exportJournal();
    if (journal === null) return; // nothing to write
    await journals.flush(journalStore, target, file, journal);
  }, [lanes, journals, journalStore, engine, bufferFileRef]);

  const noticeTimerRef = useRef<number | null>(null);
  const showJournalNotice = useCallback(() => {
    setJournalNotice(true);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setJournalNotice(false);
    }, 8000);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  /**
   * Opens `content` with the file's timeline: reads its journal, hands it to
   * the engine, whose tail-reconcile drops it when it does not match the
   * file, and tells the writer once when it was dropped. The baseline
   * records what the disk held, so the first flush compares against what
   * this session saw. `target` and `providerFor` are parameters because the
   * open's restore reads from the provider it was given, which may not be
   * the one the route holds now.
   *
   * `wanted` is asked once the journal is read, before the engine is
   * touched: an open overtaken meanwhile leaves the buffer to the newer one.
   * Resolves to whether the file was opened.
   */
  const hydrateOpen = useCallback(
    async (
      target: ProjectRef,
      providerFor: StorageProvider,
      fileName: string,
      content: string,
      opts?: { caret?: "start" | "end" },
      wanted: () => boolean = () => true,
    ): Promise<boolean> => {
      const journal = await journals.read(
        providerJournal(providerFor),
        target,
        fileName,
      );
      if (!wanted()) return false;
      journals.opened(journal);
      engine.open(content, { ...opts, journal });
      bufferFileRef.current = fileName;
      if (engine.lastOpenDroppedJournal) {
        // The engine cannot log, and does not say why: the journal was
        // damaged, or no longer matches the file.
        appLog.warn("history", "A Section's history was dropped at open.", {
          chars: journal === undefined ? 0 : journal.length,
        });
        showJournalNotice();
      }
      return true;
    },
    [journals, engine, showJournalNotice, bufferFileRef],
  );

  return { journals, journalStore, journalNotice, flushJournal, hydrateOpen };
}
