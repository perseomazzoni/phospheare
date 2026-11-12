// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectRef, StorageProvider } from "../../storage";
import type { EditorEngine } from "../views/engine";
import type { ProjectState } from "../ProjectContext";
import { filePath } from "../../project/naming";
import { nodeOfFile } from "../../project/structure";
import type { MetadataLanes } from "./application/metadataLanes";
import type { StatsKeeper } from "./application/statsKeeper";
import type { MetadataStore } from "./application/stores";
import { useBufferJournal } from "./useBufferJournal";

/**
 * The engine's buffer and the file it came from: every read and write of
 * the buffer, the lane that orders a save against a rename's file moves,
 * the journal that keeps its timeline, and the leave dialog's three answers.
 * The buffer is the only writer of `activeFile`.
 */
export function useBuffer({
  engine,
  lanes,
  provider,
  metadata,
  stats,
  message,
  setError,
  holdOpenWork,
  settleSessionExit,
  clearOutOfBand,
  forgetRestore,
}: {
  engine: EditorEngine;
  lanes: MetadataLanes<ProjectRef>;
  provider: StorageProvider;
  metadata: MetadataStore<ProjectRef>;
  stats: StatsKeeper<ProjectRef>;
  /** The writer's words for a storage failure. */
  message: (err: unknown) => string;
  setError: (error: string | null) => void;
  /** Registers the work a sign-out writes before it unmounts the editor. */
  holdOpenWork: (write: () => Promise<unknown>) => () => void;
  /** Consumes this sitting's baseline; the tab's last chance calls it. */
  settleSessionExit: () => void;
  /** A save records a fresh hash, which clears the node's out-of-band mark. */
  clearOutOfBand: (nodeId: string) => void;
  /** Forgets the file a refused reload would bring back. */
  forgetRestore: () => void;
}) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [lastSave, setLastSave] = useState<ProjectState["lastSave"]>(null);
  /** A file asked for over unsaved changes, awaiting confirmation. */
  const [discardPending, setDiscardPending] = useState<{
    fileName: string;
    caret?: "start" | "end";
  } | null>(null);

  // The file the engine's buffer was opened from, set in the same step as
  // every `engine.open`. The callbacks read the open file here, never from
  // `activeFile`: that follows the render, so between an open and its render
  // it still names the previous file, and a save reading it there would write
  // one file's text, or an emptied buffer, into another.
  const bufferFileRef = useRef<string | null>(null);
  // The buffer's save and a rename's file moves run one at a time. A save in
  // flight while its file moves lands under the old name after the move, a
  // file the structure does not name, and the next open refuses the folder
  // as drift. A save asked for during the moves writes once they land, to the
  // name the buffer has followed.
  const bufferLaneRef = useRef<Promise<unknown>>(Promise.resolve());
  const inBufferLane = useCallback(<T>(job: () => Promise<T>): Promise<T> => {
    const run = bufferLaneRef.current.then(job, job);
    bufferLaneRef.current = run.catch(() => {});
    return run;
  }, []);

  const { journals, journalStore, journalNotice, flushJournal, hydrateOpen } =
    useBufferJournal({ engine, lanes, provider, bufferFileRef });

  // Each request for the buffer, an open, a close or a let-go, takes the next
  // number, and an open lands only while its number is the latest. Two opens
  // read in parallel, and a slow read must not replace the file asked for
  // after it, or bring a file back after the writer left it.
  const requestRef = useRef(0);

  /**
   * Opens `content` as the buffer's file, with its timeline, and names it
   * the open file once it is opened. `wanted` is `hydrateOpen`'s: an open
   * overtaken meanwhile changes nothing. Resolves to whether it opened.
   */
  const openInto = useCallback(
    async (
      target: ProjectRef,
      providerFor: StorageProvider,
      fileName: string,
      content: string,
      opts?: { caret?: "start" | "end" },
      wanted?: () => boolean,
    ): Promise<boolean> => {
      const opened = await hydrateOpen(
        target,
        providerFor,
        fileName,
        content,
        opts,
        wanted,
      );
      if (opened) setActiveFile(fileName);
      return opened;
    },
    [hydrateOpen],
  );

  /**
   * Opens a file, discarding what the engine holds, as the writer chose.
   * `discarded` is the leave dialog's "Don't save": the outgoing timeline
   * then holds steps for text the file never got, and is not flushed.
   */
  const proceedTo = useCallback(
    async (
      fileName: string,
      opts?: { caret?: "start" | "end"; discarded?: boolean },
    ) => {
      const target = lanes.owner;
      if (!target) return;
      const request = ++requestRef.current;
      const latest = () => requestRef.current === request;
      try {
        // The outgoing file's timeline lands before the new open wipes the
        // buffer: a walk back to the saved state is clean, so no save fires,
        // but it is not yet flushed. A discarded buffer's timeline stays out:
        // the next open drops a journal that does not match its file, and
        // the steps saved before it go too.
        if (!opts?.discarded) await flushJournal();
        const content = await provider.readFile(target, filePath(fileName));
        if (!latest()) return;
        const opened = await openInto(
          target,
          provider,
          fileName,
          content,
          opts?.caret ? { caret: opts.caret } : undefined,
          latest,
        );
        if (opened) setError(null);
      } catch (err) {
        if (latest()) setError(message(err));
      }
    },
    [lanes, provider, message, flushJournal, openInto, setError],
  );

  const openFile = useCallback(
    async (fileName: string, opts?: { caret?: "start" | "end" }) => {
      const target = lanes.owner;
      if (!target) return;
      if (fileName === bufferFileRef.current) return;
      if (engine.hasChanges) {
        setDiscardPending({ fileName, caret: opts?.caret });
        return;
      }
      await proceedTo(fileName, opts);
    },
    [lanes, engine, proceedTo],
  );

  const writeBuffer = useCallback(async () => {
    const target = lanes.owner;
    // The path and the text are read together, from `bufferFileRef`.
    const file = bufferFileRef.current;
    if (!target || !file) return false;
    try {
      const text = engine.save();
      await provider.writeFile(target, filePath(file), text);
      // Only now is the buffer written: a failed write leaves the dirty flag
      // set, or a later navigation would discard the unsaved text as safe.
      engine.markSaved(text);
      // The count belongs to the node that owns the file, keyed by its id; a
      // file no node claims (a hand-orphaned `.md`) contributes nothing.
      const owner = lanes.structure ? nodeOfFile(lanes.structure, file) : null;
      // The count and the edit-time stamp are one write: `perNode.updatedAt`
      // is the adopted file's save time. The save path touches two files,
      // the `.md` and `document-properties.json`, and never the yaml.
      if (owner) {
        void stats.recordSave(metadata, target, owner.id, file, text);
        clearOutOfBand(owner.id);
      }
      // The timeline flush rides the save path after the `.md` write
      // resolves: the journal must never record steps for text not yet
      // written.
      void flushJournal();
      setLastSave({ ok: true, at: Date.now(), error: null });
      return true;
    } catch (err) {
      const reason = message(err);
      setError(reason);
      setLastSave({ ok: false, at: Date.now(), error: reason });
      return false;
    }
  }, [
    lanes,
    provider,
    engine,
    stats,
    metadata,
    message,
    flushJournal,
    clearOutOfBand,
    setError,
  ]);

  const saveActiveFile = useCallback(
    () => inBufferLane(writeBuffer),
    [inBufferLane, writeBuffer],
  );

  // The buffer lets go of its file: the engine empties and nothing is open.
  const letGoOfBuffer = useCallback(() => {
    requestRef.current += 1;
    engine.open("");
    bufferFileRef.current = null;
    setActiveFile(null);
  }, [engine]);

  // The id holds the app's references, but when the open file itself is
  // renamed the buffer's file name follows it, or the next save would
  // write to a name nothing reads.
  const retarget = useCallback((from: string, to: string) => {
    if (bufferFileRef.current !== from) return;
    bufferFileRef.current = to;
    setActiveFile(to);
  }, []);

  /**
   * Back to the Desk.
   *
   * Unlike `openFile` it never offers to discard: no second file is being
   * opened, so there is nothing to weigh the writer's text against. It writes
   * and lets go of the buffer only once the write lands. A failed write
   * leaves the Section open with its text and the error on screen, the one
   * state from which the writer can still act.
   */
  const closeFile = useCallback(async () => {
    if (!bufferFileRef.current) {
      requestRef.current += 1;
      // A refused reload leaves no buffer, only the file a retry would bring
      // back: closing lets go of that too.
      forgetRestore();
      setActiveFile(null);
      return;
    }
    if (engine.hasChanges && !(await saveActiveFile())) return;
    await flushJournal();
    letGoOfBuffer();
  }, [engine, saveActiveFile, flushJournal, letGoOfBuffer, forgetRestore]);

  const hasUnsavedChanges = useCallback(() => engine.hasChanges, [engine]);

  // A sign-out, here or in another tab, unmounts the editor, which has no
  // save on unmount. The account layer writes the open buffer first.
  useEffect(
    () =>
      holdOpenWork(async () => !engine.hasChanges || (await saveActiveFile())),
    [engine, saveActiveFile, holdOpenWork],
  );

  // The journal rides the save rhythm and the file switches; these two
  // events, the tab closing or hidden on a phone, are the last chance for a
  // timeline that was never saved. Fire-and-forget: a flush must never block
  // unload, and its failure is invisible to the writer. The session settles
  // on the same two events and the route's unmount; whichever fires first
  // consumes the baseline.
  useEffect(() => {
    const onHide = () => {
      void flushJournal();
      settleSessionExit();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushJournal, settleSessionExit]);

  // The leave dialog's three answers to a file asked for over unsaved text.
  const leaveSave = useCallback(async () => {
    const pending = discardPending;
    // A failed write leaves the writer where they are, with the buffer
    // dirty and the error on screen, as `closeFile` does.
    if (!(await saveActiveFile())) {
      setDiscardPending(null);
      return;
    }
    setDiscardPending(null);
    if (pending) void proceedTo(pending.fileName, { caret: pending.caret });
  }, [discardPending, saveActiveFile, proceedTo]);
  const leaveStay = useCallback(() => setDiscardPending(null), []);
  const leaveSkip = useCallback(() => {
    const pending = discardPending;
    setDiscardPending(null);
    if (pending)
      void proceedTo(pending.fileName, {
        caret: pending.caret,
        discarded: true,
      });
  }, [discardPending, proceedTo]);

  return {
    activeFile,
    lastSave,
    discardPending,
    bufferFileRef,
    inBufferLane,
    journals,
    journalStore,
    journalNotice,
    flushJournal,
    openInto,
    proceedTo,
    openFile,
    saveActiveFile,
    letGoOfBuffer,
    retarget,
    closeFile,
    hasUnsavedChanges,
    leave: { save: leaveSave, stay: leaveStay, skip: leaveSkip },
  };
}
