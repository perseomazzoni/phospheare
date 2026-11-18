// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's entry. `build:demo` points `index.html` here in place of
// `src/main.tsx`, so the bundle holds what this root imports and nothing of
// the full program's root. It starts the same way: theme, strings, then the
// tree inside `RootFault`. The site's pages hold HTML rendered at build time
// (`prerender.tsx`), which React takes over when it matches.
import "../styles/frame.css";

import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import { DemoRoot, demoRoutes } from "./App";
import { canHydrate } from "./pageState";
import { applyStoredTheme } from "../theme";
import { initI18n } from "../locales/i18n";
import {
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

  // The same tree `prerender.tsx` renders at build time, with the browser's
  // router in place of the static one.
  const tree = (
    <DemoRoot>
      <RouterProvider router={createBrowserRouter(demoRoutes)} />
    </DemoRoot>
  );
  if (canHydrate(rootEl)) {
    ReactDOM.hydrateRoot(rootEl, tree, reactRootOptions);
    return;
  }
  // The build's HTML is not this visitor's first render, or there is none:
  // it goes, and the page renders from nothing.
  rootEl.replaceChildren();
  ReactDOM.createRoot(rootEl, reactRootOptions).render(tree);
}

main().catch(showBootFailure);
