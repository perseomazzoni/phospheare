// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../../ui/overlay/useOverlay";
import { useDismissOnPointerAway } from "../../ui/overlay/useDismissOnPointerAway";

// The prose context menu: the clipboard verbs, where the pointer is. The
// shell's `contextmenu` handler suppresses the browser's own menu, and this
// stands in its place. It rides the `.ui-menu` surface but positions against
// a point rather than a trigger element, because a right-click has no
// trigger.
//
// It is not the selection bubble, which owns marks and questions. Both can
// show over a selection, and the shell dismisses them together.

export interface ContextMenuItem {
  id: string;
  label: string;
  /** Printed right-aligned in the key voice: `Ctrl+V`, `Ctrl+Shift+V`. */
  shortcut?: string;
  /** Rule off the row above this one (used once, before Select all). */
  separator?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  open: boolean;
  /** The pointer position, in window coordinates; `null` while closed. */
  point: { x: number; y: number } | null;
  label: string;
  items: readonly ContextMenuItem[];
  onClose: () => void;
}

const EDGE = 8;
const GAP = 4;

export default function ContextMenu({
  open,
  point,
  label,
  items,
  onClose,
}: ContextMenuProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  // A popover, not a modal: on the layer stack for Escape, but Tab walks out
  // (the menu closes on the way out, matching every other menu here).
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

  // Before paint, or the menu flashes at 0,0. Clamped so a right-click near an
  // edge never opens the menu offscreen.
  useLayoutEffect(() => {
    if (!open || !point || !panel.current) return;
    const p = panel.current.getBoundingClientRect();
    setAt({
      top: Math.min(point.y + GAP, window.innerHeight - p.height - EDGE),
      left: Math.min(point.x + GAP, window.innerWidth - p.width - EDGE),
    });
  }, [open, point]);

  useDismissOnPointerAway(open, [panel.current], onClose);

  if (!open || !point) return null;

  const buttons = () => [
    ...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ];

  const onKeyDown = (event: React.KeyboardEvent) => {
    const all = buttons().filter((b) => !b.disabled);
    if (all.length === 0) return;
    const here = all.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        all[(here + 1) % all.length].focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        all[(here - 1 + all.length) % all.length].focus();
        break;
      case "Home":
        event.preventDefault();
        all[0].focus();
        break;
      case "End":
        event.preventDefault();
        all[all.length - 1].focus();
        break;
      case "Tab":
        onClose();
        break;
      default:
    }
  };

  return createPortal(
    <div
      ref={setPanel}
      className="ui-menu ui-menu-inverse"
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{
        top: at?.top ?? 0,
        left: at?.left ?? 0,
        visibility: at ? "visible" : "hidden",
      }}
    >
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separator && <hr role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd className="ui-kbd">{item.shortcut}</kbd>}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
