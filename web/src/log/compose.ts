// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getCurrentUserId, onUserChange } from "../auth/currentUser";
import { findWriter } from "../writers/registry";
import { createLogger } from "./application/logger";
import {
  AS_EMAIL,
  AS_NAME,
  AS_SECRET,
  AS_USER,
  type Known,
} from "./domain/redact";
import { idbLogStore } from "./idbStore";
import { localLineStash } from "./localStash";

// The one place the browser side meets the log. The log stays in this
// browser: nothing sends it, and the writer downloads it to send it.

/**
 * The personal values of the open account, read as each line is made: the
 * Google name, each word of it, the email addresses, and the ids Google and
 * the identity service give it. The account without Google has none.
 */
export function accountValues(): Known[] {
  try {
    const id = getCurrentUserId();
    const writer = id ? findWriter(id) : null;
    if (!writer) return [];
    const { google, drive } = writer;
    const name = google?.name ?? "";
    return [
      { value: name, as: AS_NAME },
      // Each word as Google gives it and with a capital, as a name stands in
      // a sentence; never in lower case, which is the ordinary word.
      ...[
        ...new Set(
          name
            .split(/\s+/)
            .flatMap((word) => [
              word,
              word.charAt(0).toUpperCase() + word.slice(1),
            ]),
        ),
      ].map((word) => ({ value: word, as: AS_NAME, word: true })),
      { value: google?.email ?? "", as: AS_EMAIL },
      { value: drive?.email ?? "", as: AS_EMAIL },
      { value: google?.sub ?? "", as: AS_USER },
      { value: google?.picture ?? "", as: AS_USER },
      { value: drive?.connectionId ?? "", as: AS_SECRET },
    ].filter((known) => known.value !== "");
  } catch {
    // A browser that blocks its storage has no record to read.
    return [];
  }
}

export const appLog = createLogger({
  store: idbLogStore(),
  now: () => Date.now(),
  account: getCurrentUserId,
  known: accountValues,
  later: (run, ms) => {
    setTimeout(run, ms);
  },
  stash: localLineStash(),
});

/** How long after the start the old lines are dropped, out of the way. */
const PRUNE_AFTER_MS = 5000;

/**
 * How many frames a stack keeps. Chromium keeps 10 unless told otherwise,
 * which cuts a failure deep in React or in the editor before its cause;
 * Firefox and Safari ignore the setting.
 */
const STACK_FRAMES = 50;

/**
 * Starts the log: deeper stacks, a line for the start and one for each
 * change of account, the lines past their time dropped soon after, and what
 * waits written when the tab goes. Answers a function that removes what it
 * installed; the app keeps it for its whole life.
 */
export function installLog(): () => void {
  (Error as { stackTraceLimit?: number }).stackTraceLimit = STACK_FRAMES;
  // What the last page could not write comes first, in its own order.
  appLog.restore();
  appLog.info("app", "The app started.", {
    // The build define itself: the release entry would bring its notice,
    // and with it the interface, into every module that writes a line.
    version: __APP_VERSION__,
    online: navigator.onLine,
    // What a bug report asks for first: the browser and the window's size.
    browser: navigator.userAgent,
    window: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
  });
  const stopAccount = onUserChange((id) => {
    appLog.info("account", id ? "An account is open." : "No account is open.");
  });
  const online = () => appLog.info("app", "The browser is online.");
  const offline = () => appLog.info("app", "The browser is offline.");
  const left = (event: PageTransitionEvent) => {
    appLog.info("app", "The tab was left.", { kept: event.persisted });
    appLog.leave();
  };
  // A page kept in the back-forward cache comes back with its stash.
  const back = (event: PageTransitionEvent) => {
    if (event.persisted) appLog.restore();
  };
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  window.addEventListener("pagehide", left);
  window.addEventListener("pageshow", back);
  const prune = setTimeout(() => void appLog.prune(), PRUNE_AFTER_MS);
  return () => {
    stopAccount();
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
    window.removeEventListener("pagehide", left);
    window.removeEventListener("pageshow", back);
    clearTimeout(prune);
  };
}
