// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlay, type UseOverlayOptions } from "./useOverlay";
import { useOverlayBackground } from "./background";

// The scrim: the dimmed layer every modal sits on, and the one place the focus
// contract is wired up. `Sheet`, `Dialog` and the palette differ only in what
// they put inside it and where that sits, so they are thin wrappers around it.
//
// Portalled to `<body>` so an overlay is never clipped by an ancestor's
// overflow or trapped under a stacking context it did not choose.

export interface ScrimProps extends UseOverlayOptions {
  open: boolean;
  /** Where the panel sits in the scrim: centred, from a side, or at the top. */
  place?: "center" | "start" | "end" | "top";
  labelledBy?: string;
  describedBy?: string;
  label?: string;
  className?: string;
  children: ReactNode;
}

export default function Scrim({
  open,
  place = "center",
  labelledBy,
  describedBy,
  label,
  className,
  children,
  ...overlay
}: ScrimProps) {
  // The background the shell registered once, as `background.tsx` says.
  const background = useOverlayBackground();
  const { ref, onBackdropClick } = useOverlay(open, {
    ...overlay,
    inertTargets: overlay.inertTargets ?? background,
  });
  if (!open) return null;

  return createPortal(
    <div className={`ui-scrim ui-scrim-${place}`} onMouseDown={onBackdropClick}>
      <div
        ref={ref}
        className={className}
        role={overlay.role ?? "dialog"}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={labelledBy ? undefined : label}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
