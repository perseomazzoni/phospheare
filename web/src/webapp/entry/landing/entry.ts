// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactElement, ReactNode } from "react";

/**
 * The landing's ways in, which the app root supplies: the full program signs
 * a writer in (`accountEntry.tsx`), the demo site sends a visitor to the
 * download (`downloadEntry.tsx`). The rest of the page is the same for
 * every root.
 */
export interface LandingEntry {
  /** Where a visitor already in is sent instead of the page; `null` shows it. */
  redirect: ReactElement | null;
  /** Whether Google sign-in is offered, which keeps the hero note's last term. */
  withGoogle: boolean;
  /** The header's ways in. */
  head: ReactNode;
  /** The closing section's primary way in, when there is one. */
  onStart?: () => void;
  /** The closing section's way in without an account, when there is one. */
  onWithoutAccount?: () => void;
  /** The closing section's link to the program's download, when there is one. */
  downloadUrl?: string;
  /** The dialogs the ways in open. */
  dialogs: ReactNode;
}

/** A hook the landing calls once per render for its ways in. */
export type UseLandingEntry = () => LandingEntry;
