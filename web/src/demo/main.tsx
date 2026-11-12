// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's entry. `build:demo` points `index.html` here in place of
// `src/main.tsx`, so the bundle holds what this root imports and nothing of
// the full program's root. It starts the same way: theme, strings, then the
// tree inside `RootFault`.
import "../styles/frame.css";

import React from "react";
import ReactDOM from "react-dom/client";
import DemoApp from "./App";
import { ThemeProvider, applyStoredTheme } from "../theme";
import { initI18n } from "../locales/i18n";
import {
  RootFault,
  installFaultListeners,
  reactRootOptions,
  showBootFailure,
} from "../fault";

installFaultListeners();

async function main() {
  // Awaited before the first render, so the page never paints in a theme it
  // is about to leave.
  const dressed = applyStoredTheme();
  await initI18n();
  await dressed.catch(() => null);

  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("missing #root mount node");

  ReactDOM.createRoot(rootEl, reactRootOptions).render(
    <React.StrictMode>
      <RootFault>
        <ThemeProvider>
          <DemoApp />
        </ThemeProvider>
      </RootFault>
    </React.StrictMode>,
  );
}

main().catch(showBootFailure);
