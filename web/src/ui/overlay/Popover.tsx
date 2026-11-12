// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "./useOverlay";
import { useDismissOnPointerAway } from "./useDismissOnPointerAway";
import {
  anchoredStyle,
  useAnchoredPosition,
  type AnchoredPlacement,
} from "./useAnchoredPosition";

// The popover: a small panel of facts that hangs from the button that opened
// it, `Menu`'s body without the list. The chat bar's readings open one,
// because a browser tooltip cannot hold a graph, appears on a delay the writer
// does not control, and never shows on a touch screen.
//
// Non-modal, like the menu: it does not dim the page, trap focus or make the
// rest of the app inert. It sits on the layer stack as a `menu` layer, the
// stack's name for non-trapping, so Escape closes it and leaves any sheet
// underneath standing, and a press anywhere else dismisses it. Focus stays on
// the trigger when it opens, because there is nothing inside to operate; the
// content is read, and the trigger's name says what it is.

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  placement?: AnchoredPlacement;
  /** Names the panel for a screen reader. */
  label: string;
  className?: string;
  children: ReactNode;
}

export default function Popover({
  open,
  onClose,
  anchor,
  placement = "below-end",
  label,
  className,
  children,
}: PopoverProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const { ref } = useOverlay(open, {
    role: "menu",
    onClose,
    moveFocusIn: false,
  });
  const setPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panel.current = node;
      ref(node);
    },
    [ref],
  );
  const at = useAnchoredPosition(open, anchor, panel, placement);
  useDismissOnPointerAway(open, [panel.current, anchor], onClose);

  if (!open) return null;
  return createPortal(
    <div
      ref={setPanel}
      className={["ui-popover", className].filter(Boolean).join(" ")}
      data-placement={placement}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      style={anchoredStyle(at)}
    >
      {children}
    </div>,
    document.body,
  );
}
