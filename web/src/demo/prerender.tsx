// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Renders the demo site's pages to HTML in Node, at build time, so a search
// engine reads each page's text and links without running the bundle. The
// second step of `build:demo` builds this file for Node, and the
// `demo-prerender` plugin in `vite.config.ts` writes its output into the
// site's pages. `main.tsx` hydrates the HTML when the visitor's first render
// is the same markup (`pageState.ts`), and renders from nothing otherwise.

import { renderToString } from "react-dom/server";
import {
  StaticRouterProvider,
  createStaticHandler,
  createStaticRouter,
} from "react-router";
import i18n from "i18next";
import { DemoRoot, demoRoutes } from "./App";
import { pageState } from "./pageState";
import { LANDING_PATHS, languageOfPath } from "./languagePaths";
import { initI18n } from "../locales/i18n";
import { LEGAL_PATHS } from "../legal/domain/paths";
import { LEGAL_SET } from "../legal/compose.demo";
import { PRODUCT } from "../product";
import {
  firstChoice,
  resolveChoice,
  themeMarkup,
  type ThemeMarkup,
} from "../theme";

/** One page as the build writes it. */
export interface RenderedPage {
  /** The markup that goes inside `#root`. */
  body: string;
  /** The render inputs, for `#root`'s `data-prerendered`. */
  state: string;
  /** The page's `<title>`. */
  title: string;
  /** The language it is rendered in, for `<html lang>`. */
  language: string;
  /** What the landing says it is, for search results; `null` elsewhere. */
  description: string | null;
  /** What the link preview's picture shows, the editor. */
  imageAlt: string;
  /** The theme a first visit gets, to paint before any script runs. */
  theme: ThemeMarkup;
}

// `useInView` counts a missing `IntersectionObserver` as "in view", for a
// browser that has none. The browser that hydrates has one and starts every
// reveal "not yet in view", so the render here must start the same way. Only
// its presence is read while rendering; no effect runs in Node, so it
// observes nothing.
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;

const languageReady = initI18n("en");

/**
 * The theme a first visit gets, as `main.tsx` puts it on (`firstChoice`):
 * the site stores nothing, so it is every visitor's.
 */
async function firstTheme(): Promise<ThemeMarkup> {
  const theme = resolveChoice(firstChoice());
  if (!theme) throw new Error("no theme for a first visit");
  return themeMarkup(theme, (await theme.sheet()).trim());
}

/**
 * The page's title: the product's name after what the page is, the legal
 * text's own title or, on the landing, what the program is.
 */
function titleOf(path: string): string {
  const document = LEGAL_SET.find((one) => LEGAL_PATHS[one.id] === path);
  return document
    ? `${i18n.t(`legal.${document.text}.title`)} — ${PRODUCT.name}`
    : i18n.t("landing.meta.title");
}

/**
 * Renders the page at `path`, a route of `demoRoutes` with no loader, in the
 * language its address fixes, or in English.
 */
export async function renderPage(path: string): Promise<RenderedPage> {
  await languageReady;
  await i18n.changeLanguage(languageOfPath(path) ?? "en");
  const handler = createStaticHandler(demoRoutes);
  const context = await handler.query(
    new Request(new URL(path, "http://localhost")),
  );
  if (context instanceof Response)
    throw new Error(`${path} answered ${context.status}, not a page`);
  const router = createStaticRouter(handler.dataRoutes, context);
  // `hydrate={false}`: the router's state script is inline, which the site's
  // policy refuses, and the browser router finds the same match without it,
  // since no route has a loader.
  const body = renderToString(
    <DemoRoot>
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </DemoRoot>,
  );
  return {
    body,
    state: pageState(),
    title: titleOf(path),
    language: i18n.language,
    description: Object.values(LANDING_PATHS).includes(path)
      ? i18n.t("landing.meta.description")
      : null,
    imageAlt: i18n.t("landing.hero.shotAlt"),
    theme: await firstTheme(),
  };
}
