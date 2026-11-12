// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Suspense, lazy, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  DEMO_NOTICE_REGION_ID,
  DemoNotice,
  DeviceNotice,
  DriveNotice,
  NOTICE_STACK_ID,
  UpdateNotice,
} from "./ui";
import { RouterProvider, createBrowserRouter } from "react-router";
import {
  FaultHomeProvider,
  NotFoundPage,
  RouteFault,
  reloadPage,
  useUpdateReady,
  type FaultHome,
} from "./fault";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import {
  Landing,
  useAccountEntry,
  ConnectPopup,
  Library,
  SettingsSheet,
  SessionGate,
} from "./webapp";
import { memoryProvider } from "./storage";
import { useDriveGrantLapsed } from "./storage/driveGrant";
import { useDeviceWork, useLostChanges } from "./webapp/shell/useDeviceWork";
import { forgetLostChanges } from "./project/sync/remoteQueue";
import { EditorSkeleton, useOnline } from "./ui";
import { useScrollReveal } from "./ui/useScrollReveal";
import { loadEditor, loadProjectRoute } from "./editorChunk";
import { EditorServicesProvider } from "./editor/services/context";
import { demoEditorServices } from "./editor/services/demo";
import { holdOpenWork } from "./auth/openWork";
import { RELEASE_NOTICE_REGION_ID } from "./release";
import LegalPage from "./legal/LegalPage";
import { LEGAL_PATHS } from "./legal/domain/paths";
import { LEGAL_SET } from "./legal/compose";

// ── The two halves ───────────────────────────────────────────────────────────
//
// The app is a web application and an editor; this file is the only place
// that knows both exist and decides which one is showing.
//
// The web application loads up front. The editor is the much larger half, so
// it loads only when a route needs it, bringing its CSS with it.
//
// Outside this file, the web application imports from `./editor` only
// modules that carry nothing of the editor: `./editor/path` and
// `./editor/preferenceLabels`. Anything larger goes through `editorChunk.ts`;
// `webapp/boundaries.test.ts` enforces this.
//
// Both halves sit on a data router: the editor's leaving guard is
// `useBlocker`, which exists only on a data router.

const ProjectRoute = lazy(loadProjectRoute);
const EditorScreen = lazy(async () => ({
  default: (await loadEditor()).EditorScreen,
}));

// The demo route's services: the demo model answers, and a signed-in
// visitor keeps their face, the signed-in avatar, in the titlebar and their
// sign-out's hold on the buffer (`editor/services/demo.ts`).
const demoServices = demoEditorServices({
  useFace: () => useAuth().user,
  holdOpenWork,
});

// ── The route tree ───────────────────────────────────────────────────────────
//
// One browser router for every surface. The demo is a public sibling of
// `/app`, not a child of `SessionGate`, so an anonymous visitor can open it.
// It uses `memoryProvider` only: no library, no handles, no profile writes,
// and no real model, since its Assistant answers from the static demo model
// whoever is signed in. It sits inside `AuthProvider` like every
// route, so a signed-in visitor arrives with their session, and the demo's
// editor services (`demoServices`) let none of it act.
//
// Every route sits under one pathless route whose error boundary is
// `RouteFault`, so a screen that fails to render, or an editor chunk a deploy
// removed, ends on a page in the writer's language and never on the router's
// own page, which prints the stack.

const router = createBrowserRouter([
  {
    ErrorBoundary: RouteFault,
    children: [
      { path: "/", element: <Landing useEntry={useAccountEntry} /> },
      // Public: the sign-in provider's consent screen links the privacy notice
      // and the terms, and a visitor reads all three before any account exists.
      ...LEGAL_SET.map((document) => ({
        path: LEGAL_PATHS[document.id],
        element: <LegalPage document={document} />,
      })),
      // Outside `SessionGate`: the approval window holds no session, key or
      // verifier, and only hands the vendor's answer to the tab that opened
      // it. A gate would put the signed-in app, or a sign-in
      // screen, inside the popup.
      { path: "/app/connect/:provider", element: <ConnectPopup /> },
      // Public: an anonymous visitor must be able to open the demo.
      {
        path: "/app/editor/demo",
        element: (
          <>
            <DemoNotice />
            <Suspense fallback={<EditorSkeleton />}>
              <EditorServicesProvider value={demoServices}>
                <EditorScreen provider={memoryProvider} projectKey="demo" />
              </EditorServicesProvider>
            </Suspense>
          </>
        ),
      },
      {
        path: "/app",
        element: <SessionGate />,
        children: [
          {
            element: <Library />,
            children: [
              { index: true, element: null },
              { path: "settings", element: <SettingsSheet /> },
            ],
          },
          {
            // One segment: the book's own id, never the backend holding it, so a
            // move or rename does not break the link (`editor/path.ts`).
            path: "project/:projectId",
            element: (
              <Suspense fallback={<EditorSkeleton />}>
                <ProjectRoute />
              </Suspense>
            ),
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export default function App() {
  // The notice column sits outside the router: a standing status is a fact
  // about the browser or the file, not the route, and must survive
  // navigation. One column, not separate notices, so two `position: fixed`
  // pills never cover each other; anything in either half joins it by portal.
  //
  // `DeviceStatus` holds the top. Offline and only-on-this-device are two
  // states of one pill; a lapsed Remote Storage grant has its own, because it
  // is actionable.
  //
  // A scrollbar shows only while its area moves, on every screen.
  const page = useRef(document.body);
  useScrollReveal(page, true);
  return (
    <AuthProvider>
      <FaultHomeProvider value={useSessionHome}>
        <RouterProvider router={router} />
      </FaultHomeProvider>
      <div id={NOTICE_STACK_ID} className="status-notices">
        <DeviceStatus />
        <DriveGrantNotice />
        <UpdateReadyNotice />
      </div>
      <Announcer />
    </AuthProvider>
  );
}

/** The fault pages' way back: the Library for a signed-in writer. */
function useSessionHome(): FaultHome {
  return useAuth().status === "authenticated" ? "library" : "landing";
}

/**
 * The wiring for `DeviceNotice`. The three notices are wired here, and not
 * inside themselves, because `ui/` is presentational and imports no domain
 * module: the queue is storage's fact, a Remote Storage grant is storage's, a
 * failed chunk is the fault module's, and this file is the seam that knows
 * every half. Each wiring supplies facts and decides nothing: which state is
 * worth a notice is the component's rule, pinned without mounting the app.
 */
function DeviceStatus() {
  return (
    <DeviceNotice
      status={useDeviceWork()}
      lost={useLostChanges()}
      onDismissLost={() => void forgetLostChanges()}
    />
  );
}

/**
 * The column's spoken half: one permanent region per independent condition,
 * empty at rest, outliving every pill.
 *
 * Permanent, because a live region inserted together with its first content
 * is announced unreliably; `CommandBarFind` has the same shape.
 * The pills mount and unmount with their conditions, so no pill can own one.
 *
 * One region each. The device condition, a lapsed Remote Storage grant and a
 * newer build coexist, and a shared region would either never announce one
 * of them, possibly the actionable one, or re-announce the other when one
 * cleared.
 *
 * Numberless, so each condition is announced once. A polite region announces
 * content that arrives; unchanged text does not re-announce, and clearing
 * announces nothing, so a fixed sentence needs no latch, ref or effect. A
 * count in either string would be re-read at a writer mid-sentence on every
 * save.
 *
 * A sibling of the column, not a child: `.status-notices` is a flex row with
 * `gap: 8px`, and a member with no geometry is still a member. It stays
 * harmless only while `ui-visually-hidden` is absolutely positioned and the
 * wrapper has no rule of its own.
 */
function Announcer() {
  const { t } = useTranslation();
  const work = useDeviceWork();
  const lost = useLostChanges();
  const online = useOnline();
  const lapsed = useDriveGrantLapsed();
  const { user } = useAuth();
  const updateReady = useUpdateReady();

  return (
    <>
      <span className="ui-visually-hidden" aria-live="polite">
        {/* A loss outranks held work: it never resolves itself, and the
            region says one sentence. */}
        {lost > 0
          ? t("app.changesLostAnnounce")
          : work
            ? t("app.onlyOnDeviceAnnounce")
            : online
              ? ""
              : t("app.offline")}
      </span>
      <span className="ui-visually-hidden" aria-live="polite">
        {lapsed && user?.driveConnected ? t("app.driveLapsed") : ""}
      </span>
      <span className="ui-visually-hidden" aria-live="polite">
        {updateReady ? t("fault.updateNotice") : ""}
      </span>
      {/* Written by `DemoNotice` while the demo route shows it. */}
      <span
        id={DEMO_NOTICE_REGION_ID}
        className="ui-visually-hidden"
        aria-live="polite"
      />
      {/* Written by `ReleaseNotice` while the Library shows it. */}
      <span
        id={RELEASE_NOTICE_REGION_ID}
        className="ui-visually-hidden"
        aria-live="polite"
      />
    </>
  );
}

/** The wiring for `UpdateNotice`, as `DeviceStatus` states. */
function UpdateReadyNotice() {
  return <UpdateNotice shown={useUpdateReady()} onReload={reloadPage} />;
}

/**
 * The wiring for `DriveNotice`, as `DeviceStatus` states: what Drive
 * answered, and what the app claims elsewhere.
 *
 * `useAuth`, not `useDriveConnection`: a second instance in the tree would
 * hold a second connection state. Its `state` derives from this same field.
 */
function DriveGrantNotice() {
  const { user } = useAuth();
  const lapsed = useDriveGrantLapsed();
  return <DriveNotice lapsed={lapsed} claimed={!!user?.driveConnected} />;
}
