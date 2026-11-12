// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's routes: the landing, the legal pages it needs, the demo
// editor and "not found". Every other path of the full program, `/app` and
// its children among them, falls to "not found". Each module imported here
// is a module the demo bundle carries, so imports name files, not barrels.

import { Suspense, lazy, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  RouterProvider,
  createBrowserRouter,
  type RouteObject,
} from "react-router";
// The landing's, legal pages' and fault pages' styles, which the full root
// gets from the `webapp` barrel.
import "../webapp/frame.css";
import Landing from "../webapp/entry/landing/Landing";
import { useDownloadEntry } from "../webapp/entry/landing/downloadEntry";
import { NotFoundPage, RouteFault, reloadPage, useUpdateReady } from "../fault";
import {
  DEMO_NOTICE_REGION_ID,
  DemoNotice,
  EditorSkeleton,
  NOTICE_STACK_ID,
  UpdateNotice,
} from "../ui";
import { useScrollReveal } from "../ui/useScrollReveal";
import { memoryProvider } from "../storage/memoryProvider";
import { EditorServicesProvider } from "../editor/services/context";
import { demoEditorServices } from "../editor/services/demo";
import LegalPage from "../legal/LegalPage";
import { LEGAL_PATHS } from "../legal/domain/paths";
// The site's own texts by name; shared code reaches them through the twin.
import { LEGAL_SET } from "../legal/compose.demo";
import { DEMO_PATH, QUICKSTART_URL } from "../webapp/entry/landing/content";

// The editor's own lazy chunk, fetched by the demo route. Not through
// `editorChunk.ts`, whose other loaders lead to the full program's routes.
const EditorScreen = lazy(async () => ({
  default: (await import("../editor")).EditorScreen,
}));

// No account and no sign-out on this site: no face, nothing to hold.
const demoServices = demoEditorServices();

export const demoRoutes: RouteObject[] = [
  {
    ErrorBoundary: RouteFault,
    children: [
      { path: "/", element: <Landing useEntry={useDownloadEntry} /> },
      ...LEGAL_SET.map((document) => ({
        path: LEGAL_PATHS[document.id],
        element: <LegalPage document={document} />,
      })),
      {
        path: DEMO_PATH,
        element: (
          <>
            <DemoNotice downloadUrl={QUICKSTART_URL} />
            <Suspense fallback={<EditorSkeleton />}>
              <EditorServicesProvider value={demoServices}>
                <EditorScreen provider={memoryProvider} projectKey="demo" />
              </EditorServicesProvider>
            </Suspense>
          </>
        ),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

const router = createBrowserRouter(demoRoutes);

export default function DemoApp() {
  const page = useRef(document.body);
  useScrollReveal(page, true);
  const { t } = useTranslation();
  const updateReady = useUpdateReady();
  return (
    <>
      <RouterProvider router={router} />
      <div id={NOTICE_STACK_ID} className="status-notices">
        <UpdateNotice shown={updateReady} onReload={reloadPage} />
      </div>
      {/* Permanent and empty at rest: a live region inserted together with
          its first content is announced unreliably. */}
      <span className="ui-visually-hidden" aria-live="polite">
        {updateReady ? t("fault.updateNotice") : ""}
      </span>
      {/* Written by `DemoNotice` while the demo route shows it. */}
      <span
        id={DEMO_NOTICE_REGION_ID}
        className="ui-visually-hidden"
        aria-live="polite"
      />
    </>
  );
}
