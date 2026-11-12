// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The shared base (reset, theme contract, shared controls) loads before
// anything that builds on it. The editor and the web application each bring
// their own stylesheet; this one is the ground both stand on, so it is
// evaluated first.
import "./styles/frame.css";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider, applyStoredTheme } from "./theme";
import { initI18n } from "./locales/i18n";
import { flushProfile } from "./profile/profileSync";
import {
  RootFault,
  installFaultListeners,
  reactRootOptions,
  showBootFailure,
} from "./fault";

// Before anything can fail: from here on every failure is reported once, and
// none reaches the writer as a message or a stack.
installFaultListeners();

async function main() {
  // Started before the first await, so the theme's sheet is fetched while the
  // strings load, and awaited before anything renders, so the page already
  // uses the right theme instead of flashing the light one on its way to the
  // dark one.
  const dressed = applyStoredTheme();

  // The remote queue's drain does not resume here: the queue is per user,
  // and no user is known this early. `remoteQueue.ts` resumes it from its
  // `onUserChange` listener once `AuthContext` knows who is signed in.

  await initI18n();
  // A sheet that cannot be fetched leaves the app unpainted but working.
  await dressed.catch(() => null);

  // A change made moments ago, such as a theme change, waits for its merge
  // with Remote Storage; a tab closed or put away before it runs would keep
  // it from the account's other installations until the next session.
  // Leaving the page runs that merge now.
  window.addEventListener("pagehide", () => {
    void flushProfile();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushProfile();
  });

  // `index.html` carries the `#root` node. A missing mount point is a broken
  // deployment, and an error says so where a blank page would not.
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("missing #root mount node");

  // `RootFault` sits outside `ThemeProvider`, which throws when the first
  // choice names no theme, so that failure too ends on a page.
  ReactDOM.createRoot(rootEl, reactRootOptions).render(
    <React.StrictMode>
      <RootFault>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </RootFault>
    </React.StrictMode>,
  );
}

// A start-up that fails before React mounts, such as a rejected `initI18n`
// or a missing `#root`, ends on a page built without React.
main().catch(showBootFailure);
