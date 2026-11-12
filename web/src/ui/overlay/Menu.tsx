// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  Fragment,
  useCallback,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../icons";
import { useOverlay } from "./useOverlay";
import { useDismissOnPointerAway } from "./useDismissOnPointerAway";
import {
  anchoredStyle,
  useAnchoredPosition,
  type AnchoredPlacement,
} from "./useAnchoredPosition";

// The menu: a short list of actions belonging to one object, such as the
// project card's overflow or the account button in the bar. It is the second
// rung of the escalation ladder, below a dialog.
//
// A popover, not a modal: it does not dim the page, make the rest of the app
// inert or trap the tab order, since Tab is how a writer leaves it. It owns
// the arrow keys while open, and hands focus back to whatever opened it on the
// way out.
//
// It is on the layer stack so Escape closes it and leaves the sheet underneath
// standing, for the reason `layerStack` gives.

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /**
   * A heading above this item, drawn only where it differs from the item
   * before it. A marker on a flat array rather than sections, so the keyboard
   * handler's `querySelectorAll("button")` walk needs no change.
   *
   * `role="menu"` wants menuitems as its own children, so there is no
   * `role="group"` wrapper: the heading is `role="presentation"`, and every
   * item in a group repeats its group in its own accessible name, announced
   * and never drawn. Models are grouped by where a writer's words travel, and
   * a reader who cannot see the heading must still learn that.
   */
  group?: string;
  /** In the heading's icon column, so the group's kind reads at a glance. */
  groupIcon?: IconName;
  /**
   * One line under the label saying what the item does, as in the command
   * menu's notes. Always drawn rather than on hover: a touch screen
   * has no hover, and a line that appears as the pointer moves shifts every
   * row under it. Announced as the item's description, never folded into its
   * name, so a screen reader hears the command first and alone.
   *
   * A node rather than a string so a note can set the one word the writer
   * types in ink (`.ui-keyword`); it is still read as plain text.
   */
  description?: ReactNode;
  /** Ruled off and coloured. Destructive, not merely secondary. */
  danger?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  /** What the menu hangs from, and what focus returns to. */
  anchor: HTMLElement | null;
  /**
   * Where it opens. The default hangs it under the trigger, right-aligned, as
   * an overflow button wants. "above-start" is the command palette's: over
   * the field, left-aligned with it, and at least as wide. "above-end"
   * mirrors the default for a trigger near the bottom of the window: the same
   * right edge, the other side of the button.
   */
  placement?: AnchoredPlacement;
  /** Named for a screen reader, such as "Actions for Once Dark". */
  label: string;
  items: readonly MenuItem[];
}

export default function Menu({
  open,
  onClose,
  anchor,
  label,
  items,
  placement = "below-end",
}: MenuProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const describedBy = useId();
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

  // A menu is dismissed by looking away from it: from the panel, and from the
  // trigger, which would otherwise close and reopen on the same press.
  useDismissOnPointerAway(open, [panel.current, anchor], onClose);

  if (!open) return null;

  const buttons = () => [
    ...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ];

  const onKeyDown = (event: React.KeyboardEvent) => {
    const all = buttons();
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
        // Tab leaves: the menu closes rather than letting the writer tab
        // through a list floating over a page they cannot see.
        onClose();
        break;
      default:
    }
  };

  // Ruled off once, before the first destructive item, not between every pair.
  const firstDanger = items.findIndex((item) => item.danger);

  return createPortal(
    <div
      ref={setPanel}
      className="ui-menu"
      data-placement={placement}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={anchoredStyle(at)}
    >
      {items.map((item, i) => (
        // A fragment, not a wrapper: role="menu" wants menuitems as its own
        // children, and a div in between is a div a screen reader has to
        // account for.
        <Fragment key={item.id}>
          {item.group && item.group !== items[i - 1]?.group && (
            // Compared against the previous item rather than tracked in a
            // counter, so a list that interleaves groups draws a heading each
            // time it changes back, showing the caller's bug rather than
            // hiding it.
            <p className="ui-menu-group" role="presentation">
              {item.groupIcon && <Icon name={item.groupIcon} size={13} />}
              <span>{item.group}</span>
            </p>
          )}
          {i === firstDanger && i > 0 && <hr role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? "ui-menu-danger" : undefined}
            aria-describedby={
              item.description ? `${describedBy}-${i}` : undefined
            }
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon && <Icon name={item.icon} size={16} />}
            {item.description ? (
              <span className="ui-menu-text">
                <span>{item.label}</span>
                {/* Hidden from the name computation, which would otherwise
                    read label and note as one run; `aria-describedby`
                    still reads a hidden element. */}
                <span
                  className="ui-menu-desc"
                  id={`${describedBy}-${i}`}
                  aria-hidden="true"
                >
                  {item.description}
                </span>
              </span>
            ) : (
              <span>{item.label}</span>
            )}
            {/* The group, for a reader the heading above is silent to. Last,
                so the announcement reads "llama3:latest, On this device": the
                name is what is chosen and the group qualifies it.

                The comma is in the string rather than left to the name
                computation: two adjacent inline spans concatenate with no
                separator, so without it the name is "llama3:latestOn this
                device". */}
            {item.group && (
              <span className="ui-visually-hidden">{`, ${item.group}`}</span>
            )}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Open a menu against the button that owns it.
 *
 * The anchor is state rather than a ref because the menu positions itself from
 * the element's box, and a ref does not tell React when that element arrives.
 */
export function useMenuAnchor() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    anchor,
    open: anchor !== null,
    toggle: (el: HTMLElement) =>
      setAnchor((current) => (current === el ? null : el)),
    close: useCallback(() => setAnchor(null), []),
  };
}
