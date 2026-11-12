// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { filePath } from "../../project/naming";
import type { ProjectRef } from "../../storage";
import type { SaveFace } from "../components/EditorBar";
import { formatSavedAt } from "../components/datetime";
import type { EditorServices } from "../services/port";
import type { EditorEngine } from "../views/engine";
import {
  afterEdit,
  afterSettle,
  faceState,
  type HeldSave,
} from "./domain/saveFace";

// Saving the open Section: the bar's save chip, autosave, the bar catching up
// with saves made elsewhere, the saves when the page goes away, and the
// restore of a Remote-only change the working copy lost.

/** How long the tick and the drained ember stay before the bar goes quiet. */
const SAVED_SETTLE_MS = 1600;

/** The outcome of the most recent `saveActiveFile()`, from anywhere. */
export interface LastSave {
  ok: boolean;
  at: number;
  error: string | null;
}

export interface WorkspaceSaveOptions {
  engine: EditorEngine;
  projectRef: ProjectRef | null;
  activeFile: string | null;
  saveActiveFile: () => Promise<boolean>;
  lastSave: LastSave | null;
  /** When the open file was last written, from the project's record. */
  openedSavedAt: string | null;
  autosave: boolean;
  /** Seconds. */
  autosaveDelay: number;
  /** The open Section still owes the remote a write. */
  queued: boolean;
  postToast: (text: string) => void;
  /**
   * Writes a dirty reference draft as the page goes away. Answers whether
   * one was at stake.
   */
  writeDraftForExit: () => boolean;
  services: Pick<EditorServices, "useLostPaths" | "readStale" | "forgetLostAt">;
}

export function useWorkspaceSave({
  engine,
  projectRef,
  activeFile,
  saveActiveFile,
  lastSave,
  openedSavedAt,
  autosave,
  autosaveDelay,
  queued,
  postToast,
  writeDraftForExit,
  services,
}: WorkspaceSaveOptions) {
  const { t, i18n } = useTranslation();
  const [saveState, setSaveState] = useState<HeldSave>("clean");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirmSaved = useCallback((at: number) => {
    setSaveError(null);
    setSavedAt(at);
    setSaveState("saved");
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      settleRef.current = null;
      setSaveState(afterSettle);
    }, SAVED_SETTLE_MS);
  }, []);

  // Opening a section seeds the bar from the project's record of when that
  // file was last written, so "Saved · …" is there on arrival, autosave on or
  // off. Keyed on the file changing (through the ref), not on
  // `openedSavedAt`'s identity: a save of the open file updates the stats
  // too, and re-seeding then would replace the tick `confirmSaved` just set
  // with "clean".
  const seededFileRef = useRef<string | null>(null);
  useEffect(() => {
    if (seededFileRef.current === activeFile) return;
    seededFileRef.current = activeFile;
    setSaveError(null);
    setSavedAt(openedSavedAt ? new Date(openedSavedAt).getTime() : null);
    setSaveState("clean");
  }, [activeFile, openedSavedAt]);

  const runSave = useCallback(
    async (opts?: { duringDiff?: boolean }): Promise<boolean> => {
      // Saves are suspended while a comparison is up: an autosave landing
      // mid-comparison would rewrite the adopted file and shift the diff's base
      // under the writer. The mode leaves the buffer untouched, so this gate
      // defers a write and never loses one. `duringDiff` is the page going
      // away, which may never come back to the comparison: it writes anyway.
      if (engine.isInDiff && !opts?.duringDiff) return false;
      if (settleRef.current) {
        clearTimeout(settleRef.current);
        settleRef.current = null;
      }
      // A write in flight makes the pending debounce redundant. Otherwise
      // Ctrl+S mid-burst writes the file twice, now and when the debounce
      // fires, and the second write lands over a confirmation still on screen.
      if (autosaveRef.current) {
        clearTimeout(autosaveRef.current);
        autosaveRef.current = null;
      }
      setSaveState("saving");
      const ok = await saveActiveFile();
      if (!ok) {
        // No toast here: `saveActiveFile` updates the shared `lastSave` on
        // every call, so the `lastSave` effect already announces this failure,
        // once.
        setSaveState("failed");
        setSaveError(t("toolbar.notSaved"));
        return false;
      }
      confirmSaved(Date.now());
      return true;
    },
    [engine, saveActiveFile, t, confirmSaved],
  );

  // A write can also land from a leave dialog, the snapshot gate or a
  // sign-out, which call `saveActiveFile()` on the provider rather than
  // `runSave`; this makes the bar catch up when one of those saved.
  useEffect(() => {
    if (!lastSave) return;
    if (lastSave.ok) confirmSaved(lastSave.at);
    else {
      setSaveState("failed");
      // `lastSave.error` comes from `storageErrorMessage`: a translated
      // sentence naming the cause (a lapsed permission, a moved folder, a file
      // too large), which the toast exists to carry and the persistent notice
      // cannot say without growing to fit the longest.
      const reason = lastSave.error ?? t("toolbar.notSaved");
      setSaveError(reason);
      postToast(reason);
    }
    // `lastSave` is a fresh object on every real save, so this fires once per
    // save and never on a plain re-render.
  }, [lastSave, t, confirmSaved, postToast]);

  useEffect(
    () => () => {
      if (settleRef.current) clearTimeout(settleRef.current);
      // A pending autosave debounce has no other cleanup path. It fires
      // `runSave()`, and so `saveActiveFile`, against refs whose route may be
      // torn down, since the engine is one instance for the whole route and
      // `projectKey` can change without a remount. It never
      // fires after this component is gone.
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
    },
    [],
  );

  // ── Autosave ───────────────────────────────────────────────────────────────
  // Ctrl+S is the explicit save; autosave closes the gap between a keystroke
  // and a navigation that would discard it. Debounced so a writing burst
  // lands as one write, and guarded on the way out for tab close. The switch
  // and the delay are per-project writing preferences, and a project with
  // autosave off never schedules, leaving the dirty flag and the explicit
  // save alone.
  const scheduleAutosave = useCallback(() => {
    if (!autosave) return;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => {
      autosaveRef.current = null;
      void runSave();
    }, autosaveDelay * 1000);
  }, [runSave, autosave, autosaveDelay]);

  // Switching autosave off cancels a debounce in flight: a save the writer
  // switched it off to avoid must not fire anyway.
  useEffect(() => {
    if (autosave) return;
    if (autosaveRef.current) {
      clearTimeout(autosaveRef.current);
      autosaveRef.current = null;
    }
  }, [autosave]);

  // Switching it on with unsaved work saves at once: the writer means "make
  // this safe now", not "start a countdown". Only the on edge fires, and
  // only with something dirty.
  const wasAutosaveRef = useRef(autosave);
  useEffect(() => {
    if (autosave && !wasAutosaveRef.current && engine.hasChanges) {
      void runSave();
    }
    wasAutosaveRef.current = autosave;
  }, [autosave, engine, runSave]);

  // The subscription lives as long as the workspace. `scheduleAutosave` can
  // change identity every render (the test mock hands out a fresh `t`), and a
  // notify landing between cleanup and re-subscribe is lost: the rail's open
  // and close notify from a post-commit effect, so the walk's enter and exit
  // would be swallowed and the bar would stay down. The callback reads the
  // ref, and the effect depends only on the engine.
  const scheduleAutosaveRef = useRef(scheduleAutosave);
  scheduleAutosaveRef.current = scheduleAutosave;
  useEffect(
    () =>
      engine.subscribe((reason) => {
        // Any edit, format, undo, redo or paste moves the chip; a selection
        // does not.
        if (reason === "selection") return;
        setSaveState((now) => afterEdit(now, engine.hasChanges));
        if (engine.hasChanges) scheduleAutosaveRef.current();
      }),
    [engine],
  );

  // A debounce belongs to the file it was scheduled for. When the open file
  // changes, a pending one is cancelled, or it would fire into whatever the
  // buffer holds next. A buffer still dirty across the change is the same
  // text under a new name (a rename), and is scheduled again.
  useEffect(() => {
    if (!autosaveRef.current) return;
    clearTimeout(autosaveRef.current);
    autosaveRef.current = null;
    if (engine.hasChanges) scheduleAutosaveRef.current();
  }, [activeFile, engine]);

  // ── The tab going away ─────────────────────────────────────────────────────
  //
  // `pagehide`, and `visibilitychange` to hidden. Not `beforeunload`, the
  // effect below, which is a desktop event: iOS Safari never fires it, and a
  // phone's OS discards a backgrounded tab whenever it wants the memory,
  // with no event and no warning.
  //
  // Unconditional. Autosave is a preference and defaults off; this is not,
  // so a writer who never found the setting still keeps their sentence when
  // the phone discards the tab.
  //
  // The hide and `beforeunload` make the same saves: the open Section and a
  // dirty reference draft, the two buffers the writer expects to land. The
  // Section saves through `runSave`, not `saveActiveFile`, so the bar's
  // state follows: a failure leaves `failed` standing when the writer comes
  // back to the tab, and a hide-save that failed silently would be worse
  // than none. A comparison does not defer it. Answers whether anything was
  // at stake.
  const saveForExit = useCallback((): boolean => {
    const section = engine.hasChanges;
    if (section) void runSave({ duringDiff: true });
    const drafted = writeDraftForExit();
    return section || drafted;
  }, [engine, runSave, writeDraftForExit]);
  const saveForExitRef = useRef(saveForExit);
  saveForExitRef.current = saveForExit;

  useEffect(() => {
    const onHide = () => {
      saveForExitRef.current();
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
    // The ref keeps the saves out of the deps, as the subscription's does: a
    // listener re-added each render can be missing at the moment the page is
    // hidden.
  }, []);

  // Closing or reloading the tab cannot show a dialog. The saves fire as best
  // effort and, while either buffer is dirty, the browser's own "leave site?"
  // prompt is the final guard rather than a silent discard.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!saveForExitRef.current()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // A Remote-only change can be lost, its only copy in the working copy gone,
  // while the open Section's buffer still holds it: the writer
  // saved, stayed on the page, and an idle in-memory partition dropped the
  // entry. Saving the buffer again gives the queue a real source, and the
  // loss is forgotten for this path before the writer reads about it.
  //
  // Only for a buffer that holds the change. A file read from the remote
  // while its put was owed (`readStale`) opened on the remote's older text,
  // and re-saving it would clear the notice over a real loss, so the notice
  // stands until the writer dismisses it. Deferred while a comparison is up,
  // like every save; the flag re-runs it when the comparison closes.
  const lostPaths = services.useLostPaths(projectRef);
  const activePath = activeFile ? filePath(activeFile) : null;
  const activeLost = activePath !== null && lostPaths.has(activePath);
  const inDiff = engine.isInDiff;
  const restoring = useRef(false);
  useEffect(() => {
    if (!activeLost || !activePath || !projectRef || inDiff) return;
    if (restoring.current || services.readStale(projectRef, activePath)) return;
    restoring.current = true;
    void runSave()
      .then((ok) =>
        ok ? services.forgetLostAt(projectRef, activePath) : undefined,
      )
      .finally(() => {
        restoring.current = false;
      });
  }, [activeLost, activePath, projectRef, inDiff, runSave, services]);

  const save: SaveFace = {
    state: faceState({
      open: !!activeFile,
      inDiff,
      held: saveState,
      queued,
    }),
    detail:
      saveState === "failed"
        ? saveError
        : savedAt !== null
          ? formatSavedAt(savedAt, i18n.language, t("toolbar.today"))
          : null,
    onSave: () => {
      void runSave();
    },
  };

  return { save, saveState, runSave };
}
