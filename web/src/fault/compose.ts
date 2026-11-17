// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { browserPage, consoleReporter, sessionReloadMemory } from "./browser";
import { createFaultHandling } from "./application/handleFault";
import { createUpdateReady } from "./application/updateReady";
import { appLog } from "../log";

// The one place the browser side meets the fault rules. Presentation
// reaches the browser side only through these instances.

export const faults = createFaultHandling({
  reporter: consoleReporter,
  memory: sessionReloadMemory,
  page: browserPage,
});

export const updateReady = createUpdateReady();

// The browser raises these notices as window errors when a resize observer's
// callback changes layout again in the same frame. They carry no error
// object, and the browser delivers the remaining observations on the next
// frame, so neither is a fault.
const RESIZE_OBSERVER_NOTICES = [
  "ResizeObserver loop completed with undelivered notifications",
  "ResizeObserver loop limit exceeded",
];

function isResizeObserverNotice(event: ErrorEvent): boolean {
  return RESIZE_OBSERVER_NOTICES.some((notice) =>
    event.message.startsWith(notice),
  );
}

/** Whether this tab's log already says a newer version is ready. */
let updateNoted = false;

/**
 * Routes every failure React did not render a page for to the reporter, and
 * turns a chunk that failed to load into "A newer version is ready".
 *
 * Each listener cancels the browser's default, which logs the same error
 * again in its own words, so each failure is one console entry.
 *
 * `vite:preloadError` is not cancelled: the import keeps rejecting, so the
 * caller that asked for the chunk still meets its failure. Offline, a missing
 * chunk is the connection, as `classify` reads it, and raises no notice: a
 * Reload there lands on the browser's own offline page.
 *
 * The ResizeObserver loop notices are not failures: they are not reported,
 * and the browser keeps its own log of them.
 */
export function installFaultListeners(): void {
  window.addEventListener("error", (event) => {
    if (isResizeObserverNotice(event)) return;
    event.preventDefault();
    faults.report(event.error ?? event.message, "window");
  });
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    faults.report(event.reason, "window");
  });
  window.addEventListener("vite:preloadError", () => {
    if (!browserPage.online()) return;
    // Once a tab: every chunk of the old build fails the same way.
    if (!updateNoted)
      appLog.info("fault", "A newer version of the app was found.");
    updateNoted = true;
    updateReady.mark();
  });
}

/**
 * The React root's error hooks. React hands each caught and uncaught render
 * error here instead of logging it itself, so every render failure is
 * reported once, whichever boundary drew its page.
 */
export const reactRootOptions = {
  onCaughtError: (error: unknown, info: { componentStack?: string }) =>
    faults.report(error, "react", info.componentStack),
  onUncaughtError: (error: unknown, info: { componentStack?: string }) =>
    faults.report(error, "react", info.componentStack),
  onRecoverableError: (error: unknown, info: { componentStack?: string }) =>
    faults.report(error, "react", info.componentStack),
};
