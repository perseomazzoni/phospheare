// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useRef, useState } from "react";
import { useBackCloses } from "../../ui/overlay/useBackCloses";
import type { FindHandle } from "../components/FindPanel";

/**
 * How the command board was asked for: a plain letter cannot both filter and
 * address, so the gesture decides which end is live.
 */
export type PaletteMode = "field" | "board";

/**
 * The bar's panels and the two sheets it opens. Find and the character keys
 * grow below the bar, one at a time: they occupy the same space, and a writer
 * who opens one while the other is out has asked for the one they opened.
 * Every way in goes through these actions, so no caller has to know the rule.
 * The command board and the shortcut sheet each hold a history entry while
 * open, since their backdrop and Escape are not the platform's back gesture.
 */
export function useBarPanels() {
  // `FindPanel` owns its open state; the handle drives it and the two reports
  // mirror it here for the bar.
  const find = useRef<FindHandle>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findFocused, setFindFocused] = useState(false);
  const [charsOpen, setCharsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // One value rather than a second flag beside an open flag, which could
  // disagree.
  const [palette, setPalette] = useState<PaletteMode | null>(null);

  const closePalette = useCallback(() => setPalette(null), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useBackCloses(palette !== null, closePalette);
  useBackCloses(sheetOpen, closeSheet);

  /** Opens find, seeded with `query` when one is given. */
  const openFind = useCallback((query?: string) => {
    setCharsOpen(false);
    find.current?.open(query);
  }, []);

  const toggleFind = useCallback(() => {
    if (find.current?.isOpen()) find.current.close();
    else openFind();
  }, [openFind]);

  // Closing find is a side effect on `FindPanel`'s own state. A state updater
  // may run during render, and StrictMode replays it there, so the close is
  // decided here from the rendered value, before the state is set.
  const toggleCharacters = useCallback(() => {
    if (!charsOpen) find.current?.close();
    setCharsOpen(!charsOpen);
  }, [charsOpen]);

  const openCharacters = useCallback(() => {
    find.current?.close();
    setCharsOpen(true);
  }, []);

  // The bar's own field opens find from inside `FindPanel`, past the actions
  // above, so its report keeps the rule for that way in too.
  const reportFindOpen = useCallback((open: boolean) => {
    setFindOpen(open);
    if (open) setCharsOpen(false);
  }, []);

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const openPalette = useCallback((mode: PaletteMode) => setPalette(mode), []);

  return {
    find,
    findOpen,
    findFocused,
    charsOpen,
    sheetOpen,
    palette,
    openFind,
    toggleFind,
    openCharacters,
    toggleCharacters,
    openSheet,
    closeSheet,
    openPalette,
    closePalette,
    /** `FindPanel`'s `onOpenChange`. */
    reportFindOpen,
    /** `FindPanel`'s `onFocusChange`. */
    reportFindFocus: setFindFocused,
  };
}
