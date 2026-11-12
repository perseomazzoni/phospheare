// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import { placeBubble, type Placement, type Rect } from "../selectionBubble";
import type { EditorEngine } from "../views/engine";

// The selection bubble: what to do to a run of text, offered where the text
// is. The bar holds every one of these commands too; the bubble comes to the
// writer just after reading a sentence and deciding it is wrong.
//
// Six commands (five where there is no Assistant). Bold, italic and case are
// the marks a draft collects; "every one" and "ask" are the two questions a
// selected phrase raises, and both need to know what is selected. Everything
// else stays in the bar.
//
// No "more" overflow: the bubble goes on the next keystroke, and a menu open
// over it would go with it.

export interface SelectionBubbleProps {
  engine: EditorEngine;
  /** The selection's box, in window coordinates. Null hides the bubble. */
  rect: Rect | null;
  /** What the placement is measured against: the editor's own shell. */
  host: HTMLElement | null;
  /** The selected text, for the commands that need to know it. */
  text: string;
  onFindEvery: (text: string) => void;
  /** Absent when there is no Assistant, and so is the button. */
  onAsk?: (text: string) => void;
  /**
   * Start a margin comment on the selection. Absent where there is nowhere
   * to keep one (a harness, a project not yet read), and so is the button.
   */
  onComment?: (text: string) => void;
  /**
   * Fired before any command runs. The shell uses it to close the prose
   * context menu, which shares the selection with this bubble and must not
   * outlive the choice being made.
   */
  onDismiss?: () => void;
}

export default function SelectionBubble({
  engine,
  rect,
  host,
  text,
  onFindEvery,
  onAsk,
  onComment,
  onDismiss,
}: SelectionBubbleProps) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<Placement | null>(null);

  // Measured after layout and before paint, because the placement depends on
  // the bubble's own width, which depends on the writer's language and cannot
  // be hard-coded per locale.
  useLayoutEffect(() => {
    const el = box.current;
    if (!rect || !host || !el) {
      setAt(null);
      return;
    }
    const bounds = host.getBoundingClientRect();
    const page = host.querySelector(".editor")?.getBoundingClientRect();
    setAt(
      placeBubble(
        rect,
        bounds,
        { width: el.offsetWidth, height: el.offsetHeight },
        page,
      ),
    );
  }, [rect, host, text]);

  // Unmounted rather than hidden, unlike every other morphing surface here.
  // Those close by transition; this one goes at once, on the next keystroke,
  // a scroll or Escape, with nothing to animate out of. Mounting fresh also
  // lets the entrance play every time rather than once.
  if (!rect) return null;

  // The first frame has no placement yet: the measure needs the element, and
  // the element needs to exist to be measured. `useLayoutEffect` runs before
  // paint, so this state is never seen, but if it were it must not be at the
  // top-left corner, where an unplaced absolute box would be.
  const style = {
    left: `${at?.left ?? 0}px`,
    top: `${at?.top ?? 0}px`,
    "--tail": `${at?.tail ?? 0}px`,
    visibility: at ? "visible" : "hidden",
  } as React.CSSProperties;

  return (
    <div
      ref={box}
      className="ui-bubble"
      role="toolbar"
      aria-label={t("bubble.label")}
      data-below={at?.below ? "1" : "0"}
      style={style}
      // The selection must survive the click. A pointerdown anywhere outside
      // the prose collapses it, and then the command has nothing to act on.
      onPointerDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        aria-label={t("toolbar.bold")}
        disabled={engine.isInDiff}
        onClick={() => {
          onDismiss?.();
          engine.toggleBold();
        }}
      >
        <Icon name={appIcons.bold} size={14} />
      </button>
      <button
        type="button"
        aria-label={t("toolbar.italic")}
        disabled={engine.isInDiff}
        onClick={() => {
          onDismiss?.();
          engine.toggleItalic();
        }}
      >
        <Icon name={appIcons.italic} size={14} />
      </button>
      <button
        type="button"
        aria-label={t("toolbar.toggleCase")}
        disabled={engine.isInDiff}
        onClick={() => {
          onDismiss?.();
          engine.toggleCase();
        }}
      >
        <Icon name={appIcons.changeCase} size={14} />
      </button>

      <hr />

      {/* The ones that need to know what is selected, which is why they are
      here and not only in the bar. Each carries its word: an icon alone
      would make "find every one of these" and "ask about this" the same
      magnifying glass. */}
      <button
        type="button"
        className="ui-bubble-said"
        onClick={() => {
          onDismiss?.();
          onFindEvery(text);
        }}
      >
        <Icon name={appIcons.search} size={14} />
        {t("bubble.everyOne")}
      </button>
      {onComment && (
        <button
          type="button"
          className="ui-bubble-said"
          onClick={() => {
            onDismiss?.();
            onComment(text);
          }}
        >
          <Icon name={appIcons.comment} size={14} />
          {t("bubble.comment")}
        </button>
      )}
      {onAsk && (
        <button
          type="button"
          className="ui-bubble-said"
          onClick={() => {
            onDismiss?.();
            onAsk(text);
          }}
        >
          <Icon name={appIcons.assistant} size={14} />
          {t("bubble.ask")}
        </button>
      )}
    </div>
  );
}
