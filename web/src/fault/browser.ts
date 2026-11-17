// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  FaultReporter,
  Page,
  ReloadMemory,
} from "./application/handleFault";
import { appLog, describeError } from "../log";

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

/**
 * The page as the log names it: its route pattern, never its path, which can
 * hold text from a link. The app sets it once its router exists; before, the
 * line names no page.
 */
let routeForLog: () => string = () => "-";

/** Sets how the fault's log line names the page. */
export function setFaultRoute(route: () => string): void {
  routeForLog = route;
}

// Two sinks, both in this browser: the console, and the log the writer can
// download and send. No failure detail leaves the browser by itself, so the
// privacy notice's account of what is collected stays whole. The console gets
// the thrown value as itself, so it keeps its stack and its cause chain
// clickable; the log gets its message and stack as text, redacted.

export const consoleReporter: FaultReporter = {
  report(error, { site, kind, path, componentStack }) {
    const where = `Fault: ${kind}, met at ${site}, on ${path}`;
    if (componentStack) console.error(where, error, componentStack);
    else console.error(where, error);
    appLog.error("fault", `A failure: ${kind}.`, {
      site,
      route: routeForLog(),
      ...describeError(error),
      componentStack,
    });
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
