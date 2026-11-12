// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Overlays share one focus contract for everything modal:
//
//   focus moves in on open, to the first useful control
//   focus is trapped while open, and wraps both ways
//   the rest of the app goes `inert`: unreachable by pointer, keyboard and
//     screen reader alike, not merely covered by a dimmed layer
//   focus returns to whatever opened it, if that is still on the page
//   Escape closes the innermost layer only
//   a layer that refuses to be dismissed swallows Escape rather than passing it
//
// The decisions live in `layerStack.ts` and `focusOrder.ts`, which are pure
// and tested in Node; `useOverlay.ts` holds only what needs a browser.

export { default as Scrim, type ScrimProps } from "./Scrim";
export { default as AlertDialog, type AlertDialogProps } from "./AlertDialog";
export { default as Dialog, type DialogProps } from "./Dialog";
export { default as DialogText, type DialogTextProps } from "./DialogText";
export { default as Sheet, type SheetProps } from "./Sheet";
export { OverlayBackgroundProvider, useOverlayBackground } from "./background";
export {
  default as ProgressDialog,
  type ProgressDialogProps,
} from "./ProgressDialog";
export {
  default as Menu,
  useMenuAnchor,
  type MenuItem,
  type MenuProps,
} from "./Menu";
export { default as Popover, type PopoverProps } from "./Popover";
export { ToastHost, useToasts, type ToastMessage, type Toasts } from "./Toast";
export {
  useOverlay,
  __resetOverlays,
  type Overlay,
  type UseOverlayOptions,
} from "./useOverlay";
export { FOCUSABLE, nextFocusIndex } from "./focusOrder";
export {
  MARGIN,
  onScreen,
  onScreenPx,
  type Box,
  type Bounds,
} from "./onScreen";
export {
  push,
  remove,
  top,
  isTop,
  escapeTarget,
  backdropCloses,
  trapsFocus,
  type Layer,
  type LayerRole,
} from "./layerStack";
