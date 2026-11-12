// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { EditorEngine } from "../views/engine";
import type { FindHandle } from "../components/FindPanel";
import { shellFacts } from "../shellFacts";

export interface ShellRedrawOptions {
  engine: EditorEngine;
  find: RefObject<FindHandle | null>;
  /** Hides the repetitions; the main selection stays. */
  clearHighlights: () => void;
  postToast: (text: string) => void;
}

/**
 * What the shell draws from the engine, and what an engine change clears.
 * The shell redraws only when `shellFacts` changes, not on every keystroke
 * and caret move.
 */
export function useShellRedraw({
  engine,
  find,
  clearHighlights,
  postToast,
}: ShellRedrawOptions): void {
  const { t } = useTranslation();
  const [, forceUpdate] = useState(0);

  // A paste the engine refused for its size changed nothing, so nothing
  // redraws; the toast is how the writer learns why it did not land.
  useEffect(
    () =>
      engine.onRefused((why) => {
        if (why === "pasteTooLong") postToast(t("toast.pasteTooLong"));
      }),
    [engine, t, postToast],
  );

  // What the shell last drew from the engine.
  const drawnFacts = useRef<string | null>(null);
  useEffect(
    () =>
      engine.subscribe((reason) => {
        const facts = shellFacts(engine);
        if (facts !== drawnFacts.current) {
          drawnFacts.current = facts;
          forceUpdate((n) => n + 1);
        }
        // Any edit, format, undo, redo or paste hides the repetitions; the
        // main selection stays.
        if (reason !== "selection") {
          clearHighlights();
          if (engine.isInDiff) {
            // A comparison is up: the find panel's marks would fight the
            // diff's register, and searching the hidden buffer would
            // misreport what is on screen. It closes and reopens on demand.
            if (find.current?.isOpen()) find.current?.close();
          }
        }
      }),
    [engine, clearHighlights, find],
  );
}
