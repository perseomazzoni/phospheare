// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { dockRoom, FRAME_GEOMETRY } from "../../theme/editor";
import { useKeyboardInset } from "../../ui/useKeyboardInset";
import { clampDockWidth, MAX_DOCK_W, MIN_DOCK_W } from "../components/Dock";
import { clampPanelWidth, useWindowWidth } from "../useNarrow";

// The workspace's frame: the keyboard inset, the dock's and the structure
// panel's widths, the panel's fold and peek, and how wide the dock may be
// drawn against the window.

export interface WorkspaceLayoutOptions {
  /** Below `NARROW_AT`: the dock lies over the prose. */
  narrow: boolean;
  /** The phone plane: the chrome leaves the top of the window. */
  phone: boolean;
  /** The project's stored dock width, or null before it is read. */
  dockWidth: number | null;
  /** The project's stored structure panel width, or null before it is read. */
  structureWidth: number | null;
  /** Persists a finished dock resize, once per drag. */
  onDockResize?: (width: number) => void;
  /** Persists a finished structure panel resize, once per drag. */
  onStructureResize?: (width: number) => void;
}

export function useWorkspaceLayout({
  narrow,
  phone,
  dockWidth,
  structureWidth,
  onDockResize,
  onStructureResize,
}: WorkspaceLayoutOptions) {
  // The keyboard inset, published on the root element rather than the shell.
  // The toast, one of three things that move out of its way, is rendered by
  // the provider as a sibling of the editor, out of reach of a shell token.
  // The theme's tokens live on the root for the same reason.
  //
  // Read here alone: the writing view gets it through its host, for the
  // typewriter station, since the editor core imports nothing outside itself.
  const keyboard = useKeyboardInset();
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--kb", `${keyboard}px`);
    return () => {
      root.style.removeProperty("--kb");
    };
  }, [keyboard]);

  // ── The dock's width ───────────────────────────────────────────────────────
  // The shell sets it as `--dock-w`, so the panel and the measure's
  // re-centre follow the same number. Seeded from the project's stored width,
  // adopted when the project finishes opening, and held live during a drag.
  const dockW = useResizableWidth(
    dockWidth,
    FRAME_GEOMETRY.dockW,
    clampDockWidth,
    onDockResize,
  );
  const panelW = useResizableWidth(
    structureWidth,
    FRAME_GEOMETRY.panelW,
    clampPanelWidth,
    onStructureResize,
  );

  // The panel folds to 52px when the writer folds it, and resolves here into
  // the one attribute the stylesheet reads, so the panel need not know its
  // layout. A window that starts narrow opens the panel folded, but the fold
  // is the writer's state from then on: the toggle is live at every width,
  // and neither the dock nor a resize takes it back.
  const [panelCollapsed, setPanelCollapsed] = useState(() => narrow);
  // The peek: a mouse over the folded rail opens the whole panel floating
  // over the prose, and leaving the panel folds it back. `panelCollapsed` is
  // the layout, what the surface, the bar and `--panel-w` reserve, which the
  // peek never moves. `rail` is the face the panel draws, which the
  // stylesheet's `data-rail` rules read.
  //
  // Derived through the gates rather than stored, so an unfold by any route,
  // or a resize onto the phone, ends it without each path remembering to.
  // The narrow plane peeks too: a panel that cannot stand beside the measure
  // most needs a way to be looked at without being pinned over the prose.
  const [peekWanted, setPeekWanted] = useState(false);
  const peek = panelCollapsed && peekWanted && !phone;
  const rail = panelCollapsed && !peek;

  // ── The dock against the window ────────────────────────────────────────────
  // `dockW.width` is the writer's choice and what the project stores; the
  // dock is drawn at no more than the window's `reach`, so it never covers
  // the structure panel on the wide plane, and a bigger window gives the
  // chosen width back untouched. `fit` is the drag's detent, the
  // widest dock beside which the whole measure stays visible, offered only
  // inside the travel. The narrow plane's sheet lies over the desk and keeps
  // its own `86%` cap in the stylesheet.
  const windowWidth = useWindowWidth();
  const room = dockRoom(
    FRAME_GEOMETRY,
    windowWidth,
    panelCollapsed ? FRAME_GEOMETRY.railPanelW : panelW.width,
    panelCollapsed,
  );
  const dockCap = narrow
    ? MAX_DOCK_W
    : Math.max(MIN_DOCK_W, Math.min(MAX_DOCK_W, room.reach));
  const dockDetent =
    !narrow && room.fit > MIN_DOCK_W && room.fit < dockCap ? room.fit : null;
  const drawnDockWidth = Math.min(dockW.width, dockCap);
  const toggleCollapse = useCallback(() => {
    setPeekWanted(false);
    setPanelCollapsed((v) => !v);
  }, []);
  // The phone bar's Structure slot, not `toggleCollapse`: on the phone the
  // panel is an overlay the writer summons, so the slot means "show me the
  // structure", and a second press must not leave a 52px rail they did not
  // ask for. Closing is the panel's own collapse control.
  const openStructure = useCallback(() => {
    setPeekWanted(false);
    setPanelCollapsed(false);
  }, []);
  // The sheet's own way out, not `toggleCollapse`: every route out of a modal
  // (Escape, the backdrop, the close, the back gesture) means closed, and a
  // toggle reached by any of them would re-open it from a stale state.
  const collapsePanel = useCallback(() => {
    setPeekWanted(false);
    setPanelCollapsed(true);
  }, []);

  return {
    keyboard,
    dockW,
    panelW,
    panelCollapsed,
    peek,
    rail,
    setPeekWanted,
    dockCap,
    dockDetent,
    dockWidth: drawnDockWidth,
    toggleCollapse,
    openStructure,
    collapsePanel,
  };
}

// ── A panel's width ──────────────────────────────────────────────────────────
//
// Both resizable panels share one answer: seed from the project's stored
// width, clamped because a hand-edited file is not a promise; hold the live
// width while a drag is in flight; publish every frame so the surface tracks
// the pointer; and persist once when it settles.
//
// `resizing` keeps a late-arriving persisted value from overwriting the
// width the writer's pointer is setting. `onResizeEnd` is not the only writer
// of the properties file, so any other write landing mid-drag would flow back
// down the prop and undo the drag under the writer's hand.
function useResizableWidth(
  persisted: number | null,
  fallback: number,
  clamp: (width: number) => number,
  onCommit?: (width: number) => void,
) {
  const [width, setWidth] = useState(() => clamp(persisted ?? fallback));
  const resizingRef = useRef(false);
  useEffect(() => {
    if (resizingRef.current) return;
    setWidth(clamp(persisted ?? fallback));
  }, [persisted, fallback, clamp]);

  const [resizing, setResizing] = useState(false);
  const onResize = useCallback((w: number) => {
    resizingRef.current = true;
    setResizing(true);
    setWidth(w);
  }, []);
  const onResizeEnd = useCallback(
    (w: number) => {
      resizingRef.current = false;
      setResizing(false);
      setWidth(w);
      onCommit?.(w);
    },
    [onCommit],
  );

  // The panel went away with the pointer still down. A drag that never ended
  // persists nothing, so the width returns to the stored one and the drag
  // state is cleared rather than latched. Otherwise the shell
  // keeps `data-resizing-panel="1"` for the life of the route: transitions
  // off, selection suppressed, and the adoption effect returning early.
  const onResizeCancel = useCallback(() => {
    resizingRef.current = false;
    setResizing(false);
    setWidth(clamp(persisted ?? fallback));
  }, [clamp, persisted, fallback]);

  return { width, resizing, onResize, onResizeEnd, onResizeCancel };
}
