// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  FaultReporter,
  Page,
  ReloadMemory,
} from "./application/handleFault";

// The browser's side of the fault rules: the page, the console and the
// tab's own storage.

export const browserPage: Page = {
  reload: () => window.location.reload(),
  online: () => navigator.onLine !== false,
  // The path names a project id; the query may carry a sign-in code, so it
  // stays out of every report.
  path: () => window.location.pathname,
  now: () => Date.now(),
};

// The console is the only sink: no failure detail leaves the browser, so the
// privacy notice's account of what is collected stays whole. The thrown value
// is passed as itself, so the console keeps its stack and its cause chain
// clickable.

export const consoleReporter: FaultReporter = {
  report(error, { site, kind, path, componentStack }) {
    const where = `Fault: ${kind}, met at ${site}, on ${path}`;
    if (componentStack) console.error(where, error, componentStack);
    else console.error(where, error);
  },
};

// Per tab, and it survives the reload it records, which is what the reload
// limit needs. A private window, a blocked origin or a full quota throws on
// access, and then `mark` reports false so no reload happens unlimited.

const KEY = "fault:reloaded-at";

export const sessionReloadMemory: ReloadMemory = {
  last() {
    try {
      const raw = sessionStorage.getItem(KEY);
      const at = raw === null ? NaN : Number(raw);
      return Number.isFinite(at) ? at : null;
    } catch {
      return null;
    }
  },

  mark(at) {
    try {
      sessionStorage.setItem(KEY, String(at));
      return sessionStorage.getItem(KEY) === String(at);
    } catch {
      return false;
    }
  },
};
