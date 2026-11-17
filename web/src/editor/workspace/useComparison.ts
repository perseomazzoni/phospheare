// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { filePath } from "../../project/naming";
import type { ProjectRef, StorageProvider } from "../../storage";
import type { DockFace } from "../components/Dock";
import type { CompareInfo } from "../components/SnapshotPanel";
import type { EditorEngine } from "../views/engine";
import { appLog, describeError } from "../../log";

// The two review modes: the dock's snapshot comparison and the history rail.
// They are mutually exclusive, and the comparison's reads race the writer's
// clicks, so one hook holds both and the ticket that settles the race.

export interface ComparisonOptions {
  engine: EditorEngine;
  projectRef: ProjectRef | null;
  provider: StorageProvider | undefined;
  activeFile: string | null;
  dockOpen: boolean;
  face: DockFace;
  setDockOpen: (open: boolean) => void;
}

export function useComparison({
  engine,
  projectRef,
  provider,
  activeFile,
  dockOpen,
  face,
  setDockOpen,
}: ComparisonOptions) {
  // The revision rail's state lives here because its toggle, the bar's
  // history button, is a sibling of the rail and shares the pressed state.
  const [railOpen, setRailOpen] = useState(false);
  const closeRail = useCallback(() => setRailOpen(false), []);

  // The comparison the dock's snapshot face shows: two snapshot titles, or
  // null when the writer is back in the adopted text. The bar's save slot and
  // the caption chip read it; the engine's diff mode owns the rendering.
  const [compareInfo, setCompareInfo] = useState<{
    compared: string;
    adopted: string;
  } | null>(null);
  useEffect(() => {
    // A file switch ends the comparison, as it closes the rail.
    setCompareInfo(null);
  }, [activeFile]);

  // The comparison ticket: the shell reads the files and enters or leaves
  // the read-only diff; the panel only names the pair.
  const compareTicket = useRef(0);
  // Counts comparisons exited from outside (Esc, the face closing, the rail
  // opening), so the snapshot panel clears its selection when the diff
  // closes; a row left highlighted over a closed diff reads as pressed with
  // no comparison behind it.
  //
  // Bumped by `exitCompare` and by a failed read, never by
  // `handleCompare(null)`. That call is also the panel's own report that
  // nothing is compared, made as it mounts; bumping there would clear a row
  // pressed before the echo returned, and its comparison would never open.
  const [compareExits, setCompareExits] = useState(0);
  const handleCompare = useCallback(
    (info: CompareInfo | null) => {
      const ticket = ++compareTicket.current;
      setCompareInfo(
        info ? { compared: info.compared, adopted: info.adopted } : null,
      );
      if (!info || !projectRef || !provider) {
        engine.exitDiff();
        return;
      }
      const reader = provider;
      const target = projectRef;
      void (async () => {
        try {
          // Only the compared file is read. The adopted side is the engine's
          // live buffer, which the save-first gate makes agree with the file
          // at entry, so reading it would add a second source of truth for
          // the file the accepts edit.
          const compared = await reader.readFile(
            target,
            filePath(info.comparedFile),
          );
          // The last click wins: an older read resolving after a newer click
          // must not land a stale diff on screen.
          if (ticket !== compareTicket.current) return;
          // The two lenses reset per comparison; a lens is per pass, never
          // persisted. The engine stores them silently when no
          // comparison is up, and entering applies them to the fresh pair.
          // The grain defaults to word.
          engine.setDiffGranularity("word");
          engine.setDiffDirection("adoptedWithSelected");
          engine.enterDiff(compared);
        } catch (err) {
          appLog.warn("editor", "A snapshot could not be opened to compare.", {
            ...describeError(err),
          });
          // An unreadable file is no comparison, so the editor stays
          // editable. This path bumps the exit counter itself, or the row
          // would stay highlighted over a comparison that never opened.
          if (ticket !== compareTicket.current) return;
          setCompareExits((n) => n + 1);
          engine.exitDiff();
        }
      })();
    },
    [engine, projectRef, provider],
  );

  /** A comparison ended from outside the panel: leave it, unpress the row. */
  const exitCompare = useCallback(() => {
    handleCompare(null);
    setCompareExits((n) => n + 1);
  }, [handleCompare]);

  // The history button exits an open snapshot comparison rather than
  // refusing the press. Declared after `handleCompare`, which its dependency
  // array reads: a const read before its initializer runs is a TDZ error.
  const toggleRail = useCallback(() => {
    if (!railOpen) {
      // The walk owns the screen, so the dock folds whatever face it was on.
      // The dock's comparison is exited below, and a dirty reference draft
      // survives: the `refEdit` session lives in the shell and only cancel,
      // save or a file switch clears it. Closing the rail never disturbs a
      // dock the writer reopened behind it.
      setDockOpen(false);
    }
    if (engine.inSnapshotDiff) {
      exitCompare();
    } else {
      // A comparison read may still be in flight after the row click.
      // The rail press is later and wins: bumping the ticket
      // makes the landing read stale, so the comparison never opens behind
      // the rail and shuts it through the latch.
      compareTicket.current++;
    }
    setRailOpen(!railOpen);
  }, [engine, exitCompare, railOpen, setDockOpen]);

  // Closing the snapshot face ends the comparison, whatever shut it: the
  // dock's close button, the bar's toggle, or another face. One effect covers
  // every path, so a close path added later cannot leave the diff up. Opening
  // the face clears nothing: the condition is "not open on the snapshot
  // face". Declared after `handleCompare` for the same TDZ reason.
  useEffect(() => {
    if (!(dockOpen && face === "snapshot")) exitCompare();
  }, [dockOpen, face, exitCompare]);

  // Esc returns from the snapshot comparison. A dedicated listener, so the
  // main keydown knows nothing of the comparison, gated on `inSnapshotDiff`
  // so the rail's own Esc, which walks back to Now, is never shadowed: the
  // rail and a snapshot diff are never up together.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && engine.inSnapshotDiff) {
        e.preventDefault();
        exitCompare();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [engine, exitCompare]);

  return {
    railOpen,
    closeRail,
    toggleRail,
    compareInfo,
    compareExits,
    handleCompare,
  };
}
