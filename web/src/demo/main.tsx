// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's entry. `build:demo` points `index.html` here in place of
// `src/main.tsx`, so the bundle holds what this root imports and nothing of
// the full program's root. It starts the same way: theme, strings, then the
// tree inside `RootFault`. The site's pages hold HTML rendered at build time
// (`prerender.tsx`), already in the theme a first visit gets, which this
// entry takes over.
import "../styles/frame.css";

import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import { DemoRoot, demoRoutes } from "./App";
import { PRERENDERED_ATTRIBUTE, canHydrate } from "./pageState";
import { languageOfPath } from "./languagePaths";
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
  // The landing's address in a language fixes it (`languagePaths.ts`);
  // everywhere else the visitor's own applies.
  await initI18n(languageOfPath(window.location.pathname));
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
  const hydrate = canHydrate(rootEl);
  if (!hydrate) {
    // The build's HTML is not this visitor's first render, or there is none:
    // it goes, and the page renders from nothing.
    rootEl.replaceChildren();
  }
  rootEl.removeAttribute(PRERENDERED_ATTRIBUTE);
  if (hydrate) ReactDOM.hydrateRoot(rootEl, tree, reactRootOptions);
  else ReactDOM.createRoot(rootEl, reactRootOptions).render(tree);
}

main().catch(showBootFailure);
