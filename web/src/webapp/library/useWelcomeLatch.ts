// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";

// Whether the welcome stays open in this tab. Once drawn, it stays until the
// writer leaves it, even after a place fills the shelf: choosing a folder
// with projects in it must not take away the chance to set the other place.
// Remote Storage's consent is a full-page redirect, so the latch lives in the
// tab's session rather than in memory. Storage can be refused (a private
// window, blocked site data); the latch then lasts as long as the page.

const keyFor = (userId: string) => `welcomeOpen:${userId}`;

function read(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return sessionStorage.getItem(keyFor(userId)) === "1";
  } catch {
    return false;
  }
}

function write(userId: string | undefined, open: boolean): void {
  if (!userId) return;
  try {
    if (open) sessionStorage.setItem(keyFor(userId), "1");
    else sessionStorage.removeItem(keyFor(userId));
  } catch {
    // The in-memory state still holds for this page.
  }
}

export interface WelcomeLatch {
  open: boolean;
  /** The welcome was drawn: keep it through whatever fills the shelf next. */
  keep: () => void;
  /** The writer left the welcome: the shelf decides again. */
  leave: () => void;
}

export function useWelcomeLatch(userId: string | undefined): WelcomeLatch {
  const [open, setOpen] = useState(() => read(userId));
  const keep = useCallback(() => {
    write(userId, true);
    setOpen(true);
  }, [userId]);
  const leave = useCallback(() => {
    write(userId, false);
    setOpen(false);
  }, [userId]);
  return { open, keep, leave };
}
