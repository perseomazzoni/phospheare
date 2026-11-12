// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
} from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { randomGreetingKey } from "./randomGreeting";
import { getPref } from "../../profile/profileSync";
import { useTheme } from "../../theme";
import { setLanguage } from "../../locales/i18n";
import {
  driveProvider,
  getProvider,
  isRemoteRef,
  localProvider,
  useConnections,
  type DisconnectOptions,
  type ProjectRef,
} from "../../storage";
import {
  Banner,
  Avatar,
  Button,
  firstName,
  Icon,
  Kbd,
  Menu,
  OverlayBackgroundProvider,
  ProgressDialog,
  ToastHost,
  useMenuAnchor,
  useToasts,
  type MenuItem,
} from "../../ui";
import { projectPath } from "../../editor/path";
import { loadExport, loadImport } from "../../editorChunk";
import { ConnectionsContext } from "./ConnectionsContext";
import { appIcons } from "../../ui/appIcons";
import { BrandMark } from "../../brand/BrandMark";
import { PRODUCT } from "../../product";
import ProjectCard from "./ProjectCard";
import Greeting from "./Greeting";
import ShelfBar from "./ShelfBar";
import SyncBanner, { RemoteGoneBanner } from "./SyncBanner";
import { ReleaseNotice } from "../../release";
import CreateProjectDialog from "../../projectSetup/CreateProjectDialog";
import DisconnectRemoteDialog from "./DisconnectRemoteDialog";
import { disconnectRemote } from "./disconnectRemote";
import StorageSearchDialog from "./StorageSearchDialog";
import { useStorageSearch } from "./useStorageSearch";
import ProjectNameDialog from "./ProjectNameDialog";
import ProjectPropertiesDialog from "./ProjectPropertiesDialog";
import CommandPalette, { type PaletteCommand } from "../../ui/CommandPalette";
import { takenFolders } from "./cardEvidence";
import {
  openableId,
  useProjects,
  type ProjectCard as Card,
} from "./useProjects";
import { useSignOutFlow } from "../shell/useSignOutFlow";
import type { SessionGateContext } from "../shell/SessionGate";
import SignOutConfirmDialog from "../shell/SignOutConfirmDialog";
import DeleteFolderDialog from "./DeleteFolderDialog";
import MoveToDriveDialog from "./MoveToDriveDialog";
import MoveToLocalDialog from "./MoveToLocalDialog";
import SyncConfirmDialog from "./SyncConfirmDialog";
import EmptyShelf from "./EmptyShelf";
import LegalNoticeDialog from "../../legal/LegalNoticeDialog";
import Welcome from "./Welcome";
import SetupCard from "./SetupCard";
import { ConnectionBanner } from "./connectionBanner";
import { emptyState } from "./emptyState";
import { shelfFace } from "./firstRun";
import { useWelcomeLatch } from "./useWelcomeLatch";
import { useActionError } from "./actions/useActionError";
import { useCopyJob } from "./actions/useCopyJob";
import { useCreateProject } from "./actions/useCreateProject";
import { useDeleteProject } from "./actions/useDeleteProject";
import { useDuplicateProject } from "./actions/useDuplicateProject";
import { useLocalFolder } from "./actions/useLocalFolder";
import { useMoveToLocal } from "./actions/useMoveToLocal";
import { useMoveToRemote } from "./actions/useMoveToRemote";
import { useProjectFacts } from "./actions/useProjectFacts";
import { useProjectSync } from "./actions/useProjectSync";
import { useResolveConflict } from "./actions/useResolveConflict";
import { useLibraryReveal } from "./useLibraryReveal";
import { useLibraryView } from "./useLibraryView";

// The Library gets a writer back into the right project quickly, and makes
// where it lives obvious without making it a filing decision. It is one list,
// not two sections: a project on disk and a project in Remote Storage are the
// same kind of object, and the card says which.
//
// The shelf's concerns live in hooks: what the cards are (`useProjects`),
// what each card action does (one hook per action, in `actions/`) and how the
// shelf is arranged (`useLibraryView`). This file is the composition root.

// The `reportDataReady` fallback outside `SessionGate`'s route: stable, so
// `useLibraryReveal`'s effect never sees a fresh closure.
const NOOP = () => {};

const BookExportWindow = lazy(() =>
  loadExport().then((module) => ({ default: module.BookExportWindow })),
);

const ImportWindow = lazy(() =>
  loadImport().then((module) => ({ default: module.ImportWindow })),
);

export default function Library() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const conns = useConnections();
  // The device capability, from the local connection: Firefox and Safari
  // have no File System Access API, and the surfaces that would offer the
  // folder say so instead of failing on click.
  const localAvailable = conns.local.state !== "unavailable";
  // Remote Storage needs a Google account. A writer without one sees the
  // place, dimmed with the reason, and no control that could only refuse.
  const remoteAvailable = user?.withGoogle === true;
  const connectRemote = remoteAvailable
    ? () => void conns.drive.connect()
    : undefined;
  const signOutFlow = useSignOutFlow(conns.drive);
  const toasts = useToasts();
  const account = useMenuAnchor();
  const { followStored } = useTheme();

  const name = firstName(user?.name);

  const [palette, setPalette] = useState(false);
  const [legalNotice, setLegalNotice] = useState(false);
  const background = useRef<HTMLDivElement>(null);

  // A project link that resolved to nothing: `EditorRoute` sends the writer
  // here, and the shelf says so. Read once, on the first render, and the
  // history entry is cleared at once, for the reason `SessionGate` gives
  // for `justLoggedIn`.
  const location = useLocation();
  const [unknownProject] = useState(
    () => location.state?.unknownProject === true,
  );
  const announcedUnknown = useRef(false);
  useEffect(() => {
    if (!unknownProject || announcedUnknown.current) return;
    announcedUnknown.current = true;
    toasts.post(t("library.unknownProject"));
    void navigate(".", { replace: true, state: {} });
  }, [unknownProject, toasts, t, navigate]);

  const {
    cards,
    listing,
    gatherStarts,
    gatherSettles,
    reconnect,
    revalidate,
    adopt,
    drop,
    forget,
    synced,
    markSynced,
    conflicts,
    relocate,
    checkNow,
    resolve,
    unpair,
    scanDrive,
    scanLocal,
    localRootReady,
    localRootResolved,
    rescan,
    refreshContent,
  } = useProjects(user?.id ?? "", conns);

  // A project needs somewhere to live: Remote Storage connected, or a local
  // root mapped. An unmapped root is not a destination, because creation never
  // opens the picker, and a browser with no File System Access API can never
  // map one.
  const canCreate = conns.drive.state === "connected" || localRootReady;
  // Where a new project may go: `destinations.ts` works the places out from
  // these, for a blank project and an imported one.
  const destinationFacts = {
    driveConnected: conns.drive.state === "connected",
    email: user?.driveEmail ?? user?.email ?? "",
    localAvailable,
    localRootReady,
    remoteAvailable,
  };

  // `SessionGate`'s loading overlay reveals `Library` once its own minimum
  // hold and this shelf's data verdict are both in, not on a timer.
  // `revealed` gates only the greeting's typing;
  // `reportDataReady` goes to `useLibraryReveal`. Outside `SessionGate`'s
  // route (the demo route, direct test renders) `revealed` defaults to
  // `true` and `reportDataReady` to a stable no-op.
  const gateContext = useOutletContext<SessionGateContext | undefined>();
  const revealed = gateContext?.revealed ?? true;
  const reportDataReady = gateContext?.reportDataReady ?? NOOP;

  // `cards` hydrates synchronously from the profile's library rows in
  // `useProjects`'s `useState` initialiser, so this reads what that
  // initialiser saw. Captured once and never recomputed: a later `scanLocal`
  // or `adopt` adding cards must not change what the reveal gate already
  // decided. An empty shelf is the one fact the gate acts on.
  const [mirrorEmpty] = useState(() => cards.length === 0);

  const view = useLibraryView(cards);

  // Which page stands below the head (`shelfFace`). The welcome, once
  // seen, stays until the writer leaves it. Seen means revealed: under the
  // overlay an empty shelf may still be waiting for the account's own list,
  // and an account with projects has set its places up already.
  const welcome = useWelcomeLatch(user?.id);
  const face = shelfFace({
    cards: cards.length,
    visible: view.visible.length,
    listing,
    welcomeOpen: welcome.open,
  });
  const { keep: keepWelcome } = welcome;
  useEffect(() => {
    if (face === "welcome" && revealed) keepWelcome();
  }, [face, revealed, keepWelcome]);

  // Drawn once, at the reveal: a writer with no projects is never greeted as
  // a return. `Greeting` restarts its typing on every change of text, so the
  // key never changes after it is drawn. An account without Google has no
  // name, and is greeted by each line's plain form.
  const [greetingKey, setGreetingKey] = useState<string | null>(null);
  if (revealed && greetingKey === null && face !== "nothing")
    setGreetingKey(
      randomGreetingKey(face === "welcome" ? "first" : "returning"),
    );

  // A press on a locked New project replays the setup's flash.
  const [flash, setFlash] = useState(0);

  // `view` is a fresh object every render, but `reconcile` is stable. Naming
  // the member keeps `reconcilePrefsUI`, and so the reveal hook's
  // `reconcileUI` option, stable across renders.
  const { reconcile: reconcileView } = view;

  // The scale every spine on the shelf is drawn against, from `cards` rather
  // than the filtered view: a project's drawn length must not change because
  // a search hid the longest one.
  const shelfMaxWords = useMemo(
    () =>
      cards.reduce((most, card) => Math.max(most, card.content?.words ?? 0), 0),
    [cards],
  );

  // Mirrored every render and read as a snapshot inside `reconcilePrefsUI`,
  // not listed as a dependency. `reconcilePrefsUI` calls
  // `setLanguage`, so listing `i18n.language` would recreate it on its own
  // change and re-run the reconciliation in `useLibraryReveal`'s settled
  // bridge. The theme compares the stored choice itself (`followStored`).
  const i18nLanguageRef = useRef(i18n.language);
  i18nLanguageRef.current = i18n.language;

  // Brings the library view state, theme and language in line with the
  // profile copy. First paint never waits on it: every value is read from
  // local storage synchronously, and `useLibraryReveal` calls this on every
  // settled chain.
  const reconcilePrefsUI = useCallback(() => {
    reconcileView();

    followStored();

    const language = getPref<string | null>("language", null);
    if (language && language !== i18nLanguageRef.current.split("-")[0])
      setLanguage(language);
  }, [reconcileView, followStored]);

  useLibraryReveal({
    userId: user?.id ?? "",
    mirrorEmpty,
    gatherStarts,
    gatherSettles,
    rescan,
    refreshContent,
    reconcileUI: reconcilePrefsUI,
    reportDataReady,
  });

  /**
   * Disconnects Remote Storage and rescans, so the shelf's Remote Storage cards
   * go blocked; the gather effect does not react to `driveConnected`. Connect
   * needs no wrapper: `useLibraryReveal` sees the connection change and
   * repaints the shelf and preferences from the profile sync. Every
   * disconnect goes through this wrapper, so none can forget the rescan.
   */
  const disconnectDrive = useCallback(
    async (
      options: DisconnectOptions = { everywhere: true, keptCopies: true },
    ) => {
      await disconnectRemote(conns.drive, options);
      rescan();
    },
    [conns.drive, rescan],
  );
  const [disconnecting, setDisconnecting] = useState(false);

  // The window over a storage search, for settings and Library coming back
  // when Remote Storage connects and for the two "Find projects" sweeps.
  const search = useStorageSearch({
    userId: user?.id ?? "",
    driveConnected: conns.drive.state === "connected",
    gatherStarts,
    gatherSettles,
    rescan,
    refreshContent,
    reconcileUI: reconcilePrefsUI,
    scanDrive,
    scanLocal,
  });
  const { findInDrive, findOnDevice } = search;

  // One hook per card action. The failure banner and the copy's progress
  // window are the two things they share, so each is owned once, here, and
  // handed to the actions that report to it.
  const actionError = useActionError();
  const copyJob = useCopyJob();
  const createProject = useCreateProject({
    user,
    navigate,
    adopt,
    failure: actionError,
  });
  const localFolder = useLocalFolder({
    user,
    connections: conns,
    scanLocal,
    rescan,
    toasts,
    failure: actionError,
  });
  const projectFacts = useProjectFacts({
    user,
    revalidate,
    toasts,
    failure: actionError,
  });
  const duplicateProject = useDuplicateProject({
    adopt,
    toasts,
    failure: actionError,
    copyJob,
  });
  const deleteProject = useDeleteProject({
    user,
    synced,
    drop,
    forget,
    revalidate,
    unpair,
    toasts,
    failure: actionError,
  });
  const moveToRemote = useMoveToRemote({
    user,
    navigate,
    relocate,
    toasts,
    failure: actionError,
    copyJob,
  });
  const moveToLocal = useMoveToLocal({
    user,
    navigate,
    relocate,
    toasts,
    failure: actionError,
    copyJob,
  });
  const projectSync = useProjectSync({
    checkNow,
    markSynced,
    revalidate,
    unpair,
    toasts,
    failure: actionError,
    copyJob,
  });
  const resolveConflict = useResolveConflict({
    resolve,
    toasts,
    failure: actionError,
  });
  // The card the export window is open on; the window does its own work.
  const [exporting, setExporting] = useState<Card | null>(null);

  // Destructured so the dependency arrays below name the stable members,
  // not the hooks' fresh return objects.
  const { request: requestCreate, requestImport } = createProject;
  const { choose: chooseLocalFolder, forget: forgetLocalFolder } = localFolder;

  // Outside the card `.map()`: neither closes over a card, so one stable
  // reference serves every card. The wrappers only discard the
  // Promises `syncNow` and `unpair` return, since `ProjectCard` expects
  // `() => void`.
  const { syncNow, unpair: stopSync } = projectSync;
  const onSyncNowVoid = useCallback(
    (ref: ProjectRef) => void syncNow(ref),
    [syncNow],
  );
  const onUnpairVoid = useCallback(
    (ref: ProjectRef) => void stopSync(ref),
    [stopSync],
  );

  // What the Settings sheet needs, through `ConnectionsContext`:
  // react-router passes no props to child routes, and the collector stays
  // single-instance. Drive's `disconnect` is `disconnectDrive`, so the
  // sheet's Disconnect rescans as the palette's does.
  const connectionsValue = useMemo(
    () => ({
      connections: {
        ...conns,
        drive: { ...conns.drive, disconnect: disconnectDrive },
      },
      chooseLocalFolder: () => void chooseLocalFolder(),
      forgetLocalFolder: () => void forgetLocalFolder(),
    }),
    [conns, chooseLocalFolder, forgetLocalFolder, disconnectDrive],
  );

  // Ctrl/⌘K from anywhere on the shelf. Capture phase, so it arrives before
  // a focused field treats it as typing; guarded on `repeat`, so holding the
  // chord does not reopen the palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.repeat) return;
      event.preventDefault();
      setPalette(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  /**
   * Every project, and everything that can be done to the shelf, as one list.
   *
   * Projects first, because getting back into one is the commonest reason to
   * open the palette, so an empty query already shows them. They come from
   * `cards`, not the filtered view, so the palette finds what the shelf's
   * filter hides.
   */
  const commands: PaletteCommand[] = useMemo(() => {
    const projects: PaletteCommand[] = cards
      // `openableId` excludes an error-state card, whose own affordance
      // (Remove, Choose folder, Connect) is the way back, and a card not yet
      // read, which has no address.
      .flatMap((card) => {
        const openAt = openableId(card);
        if (!openAt) return [];
        // The command id is the ref's, not the project's: it names a palette
        // row, distinct even for two copied folders sharing a book id.
        return [
          {
            id: `open:${card.ref.providerId}:${card.ref.key}`,
            label: card.content?.title ?? card.ref.name,
            group:
              getProvider(card.ref.providerId)?.label() ?? card.ref.providerId,
            icon: appIcons.section,
            run: () => navigate(projectPath(openAt)),
          },
        ];
      });

    const actions_: PaletteCommand[] = [
      {
        id: "new",
        label: t("create.title"),
        group: t("palette.groupCreate"),
        icon: appIcons.add,
        run: () => requestCreate(),
      },
      {
        id: "import-file",
        label: t("import.heading"),
        group: t("palette.groupCreate"),
        icon: appIcons.importFile,
        run: () => requestImport(),
      },
      ...(localAvailable
        ? [
            {
              id: "open-folder",
              label: t("library.chooseLocalFolder"),
              group: t("palette.groupCreate"),
              icon: localProvider.icon,
              run: () => void chooseLocalFolder(),
            },
          ]
        : []),
      ...(conns.drive.state === "connected"
        ? [
            {
              id: "find-drive",
              label: t("library.findDrive"),
              group: t("palette.groupCreate"),
              icon: driveProvider.icon,
              run: findInDrive,
            },
          ]
        : []),
      // The local twin of the Remote Storage sweep, shown only when a root is
      // mapped for it to look through.
      ...(localAvailable && localRootReady
        ? [
            {
              id: "find-local",
              label: t("library.findLocal"),
              group: t("palette.groupCreate"),
              icon: localProvider.icon,
              run: () => void findOnDevice(),
            },
          ]
        : []),
      {
        id: "settings",
        label: t("settings.title"),
        group: t("palette.groupGo"),
        icon: appIcons.settings,
        run: () => navigate("/app/settings", { state: { fromLibrary: true } }),
      },
      ...(remoteAvailable
        ? [
            {
              id: "drive",
              label:
                conns.drive.state === "connected"
                  ? t("library.disconnectDrive")
                  : t("library.connectDrive"),
              group: t("palette.groupAccount"),
              icon: driveProvider.icon,
              run: () =>
                void (conns.drive.state === "connected"
                  ? setDisconnecting(true)
                  : conns.drive.connect()),
            },
          ]
        : []),
      {
        id: "legal",
        label: t("legal.menu"),
        group: t("palette.groupGo"),
        icon: appIcons.info,
        run: () => setLegalNotice(true),
      },
      {
        id: "signout",
        label: t("library.signOut"),
        group: t("palette.groupAccount"),
        icon: appIcons.account,
        run: signOutFlow.requestSignOut,
      },
    ];

    return [...projects, ...actions_];
  }, [
    cards,
    navigate,
    t,
    requestCreate,
    requestImport,
    chooseLocalFolder,
    conns,
    signOutFlow,
    findInDrive,
    findOnDevice,
    localAvailable,
    localRootReady,
    remoteAvailable,
  ]);

  const accountItems: MenuItem[] = [
    {
      id: "settings",
      label: t("settings.title"),
      icon: appIcons.settings,
      onSelect: () =>
        navigate("/app/settings", { state: { fromLibrary: true } }),
    },
    {
      id: "legal",
      label: t("legal.menu"),
      icon: appIcons.info,
      onSelect: () => setLegalNotice(true),
    },
    {
      id: "signout",
      label: t("library.signOut"),
      icon: appIcons.back,
      onSelect: signOutFlow.requestSignOut,
    },
  ];

  if (!user) return null;

  return (
    <OverlayBackgroundProvider value={background}>
      <div className="app">
        {/* Everything a modal puts out of reach lives in here. The Outlet,
          the dialogs and the toast host are siblings, not children, so an
          Undo stays clickable while a sheet is open. */}
        <div className="app-content" ref={background}>
          <header className="app-top">
            <span className="app-logo">
              <BrandMark />
              <span className="app-wordmark">{PRODUCT.name}</span>
              <span className="app-beta">{t("landing.head.beta")}</span>
            </span>
            <span className="app-spacer" />
            {/* The palette's one affordance. Below 720 the label and the
              shortcut both go, because a soft keyboard cannot produce Ctrl K;
              the glyph carries the button and the name stays in
              `aria-label` for a screen reader. */}
            <Button
              variant="ghost"
              className="ui-btn-sm app-find"
              aria-label={t("library.findEverything")}
              onClick={() => setPalette(true)}
            >
              <Icon
                className="app-find-glyph"
                name={appIcons.search}
                size={15}
              />
              <span className="app-find-name">
                {t("library.findEverything")}
              </span>{" "}
              <Kbd>Ctrl K</Kbd>
            </Button>

            <button
              type="button"
              className="ui-btn ui-btn-ghost ui-btn-square"
              aria-haspopup="menu"
              aria-expanded={account.open}
              aria-label={
                user.withGoogle
                  ? t("library.accountFor", { email: user.email })
                  : t("library.accountWithoutGoogle")
              }
              onClick={(event) => account.toggle(event.currentTarget)}
            >
              <Avatar name={user?.name} avatarUrl={user?.avatarUrl} />
            </button>
            <Menu
              open={account.open}
              onClose={account.close}
              anchor={account.anchor}
              label={
                user.withGoogle
                  ? t("library.accountFor", { email: user.email })
                  : t("library.accountWithoutGoogle")
              }
              items={accountItems}
            />
          </header>

          <main className="lib">
            {/* The greeting alone. Every control, creating a project
            included, lives in the sticky bar or on the welcome, and the bar
            carries the inventory, so no count stands here. */}
            <div className="lib-head">
              {/* Empty until `revealed`. `Greeting` restarts
                  its typing whenever `text` changes, so the animation starts
                  at the overlay's reveal rather than running unseen behind
                  it. */}
              <Greeting
                className="lib-title"
                text={
                  revealed
                    ? greetingKey
                      ? t(greetingKey, name ? { name } : { context: "plain" })
                      : t("library.title")
                    : ""
                }
              />
            </div>

            {/* Every shelf control, in one sticky strip.

            Absent until there is a shelf to control: filtering, searching
            and counting nothing can only disappoint, and the welcome carries
            New project and the places instead. It keys on `cards.length`
            rather than on the cards face, because the cache paints
            synchronously, so a returning writer has the bar on the first
            frame. */}
            {cards.length > 0 && face !== "welcome" && (
              <ShelfBar
                query={view.query}
                onQuery={view.setQuery}
                filter={view.filter}
                onFilter={view.setFilter}
                counts={view.counts}
                density={view.density}
                onDensity={view.setDensity}
                // Always the true number. The bar decides when to show it,
                // because "once something is typed" is a fact about the find
                // field, not the shelf.
                shown={view.visible.length}
                onCreate={requestCreate}
                createDisabled={!canCreate || createProject.busy !== null}
                connections={conns}
                onConnect={connectRemote}
                onChooseLocalFolder={() => void chooseLocalFolder()}
                onFindInDrive={
                  conns.drive.state === "connected" ? findInDrive : undefined
                }
                onFindLocalProjects={localRootReady ? findOnDevice : undefined}
              />
            )}

            {/* Remote Storage first: a connection problem is current, while
            an action's error is a transient failure the next action clears. */}
            {(conns.drive.error ?? actionError.error) && (
              <Banner tone="problem" icon={appIcons.close}>
                {conns.drive.error ?? actionError.error}
              </Banner>
            )}
            {createProject.busy && (
              <Banner icon={appIcons.local}>{createProject.busy}</Banner>
            )}

            {/* One cause, said once: three instances of the banner grammar in
            `connectionBanner.tsx`. The copy and the verb name the cause; the
            stabilized-facts gates stay here.

            The Remote Storage banner keys on the cards' state, not the connection
            flag: a Drive read lands a card in blocked when the grant is gone
            (the identity service's 409) while the account flag is still
            stale, and the same banner covers both. */}
            <ConnectionBanner
              connectionId={driveProvider.id}
              filter={view.filter}
              behind={cards.some(
                (card) =>
                  card.ref.providerId === driveProvider.id &&
                  card.state === "blocked",
              )}
              icon={appIcons.driveOff}
              copy={t("library.driveDisconnectedBanner")}
              actionLabel={t("library.connect")}
              onAction={() => void conns.drive.connect()}
            />

            {/* The local twin: an unchosen root earns a banner only when
                local cards are on the shelf, and only once the handle store
                has answered (`localRootResolved`). Before that, "no root" is
                a missing answer, and stating it would flash. */}
            <ConnectionBanner
              connectionId={localProvider.id}
              filter={view.filter}
              behind={
                localRootResolved &&
                !localRootReady &&
                cards.some((card) => card.ref.providerId === localProvider.id)
              }
              icon={appIcons.localOff}
              copy={t("library.localDisconnectedBanner")}
              actionLabel={t("library.chooseLocalFolder")}
              onAction={() => void chooseLocalFolder()}
            />

            {/* The lapsed grant: a root is mapped but its permission has
                expired, so reads settle local cards to blocked. Keyed on the
                cards' settled state, never a live query; the action is the
                root-wide re-grant. Without it the shelf says
                nothing while every card shows blocked. */}
            <ConnectionBanner
              connectionId={localProvider.id}
              filter={view.filter}
              behind={
                localRootResolved &&
                localRootReady &&
                cards.some(
                  (card) =>
                    card.ref.providerId === localProvider.id &&
                    card.state === "blocked",
                )
              }
              icon={appIcons.localOff}
              copy={t("library.localPermissionBanner")}
              actionLabel={t("library.reconnect")}
              onAction={() => {
                const blocked = cards.find(
                  (card) =>
                    card.ref.providerId === localProvider.id &&
                    card.state === "blocked",
                );
                if (blocked) void reconnect(blocked.ref);
              }}
            />

            {[...conflicts.entries()].map(([projectId, conflict]) => {
              // Keyed by the book, so the card is found by identity, not by
              // folder name.
              const card = cards.find((c) => c.id === projectId);
              const name = card?.content?.title ?? card?.ref.name ?? projectId;
              if (conflict.verdict.remoteGone) {
                // Both choices act on the card's own address; with no card
                // on the shelf there is nothing to unpair or upload.
                if (!card) return null;
                return (
                  <RemoteGoneBanner
                    key={projectId}
                    name={name}
                    busy={
                      projectSync.uploadingAgain === projectId ||
                      copyJob.copy !== null
                    }
                    onUnpair={() => onUnpairVoid(card.ref)}
                    onUploadAgain={() =>
                      void projectSync.uploadAgain(projectId, card.ref)
                    }
                  />
                );
              }
              return (
                <SyncBanner
                  key={projectId}
                  name={name}
                  localStats={conflict.localStats}
                  driveStats={conflict.remoteStats}
                  busy={resolveConflict.resolving === projectId}
                  onKeepLocal={() =>
                    void resolveConflict.resolve(projectId, name, "local")
                  }
                  onKeepDrive={() =>
                    void resolveConflict.resolve(projectId, name, "remote")
                  }
                />
              );
            })}

            {face === "nothing" ? null : face === "welcome" ? (
              <Welcome
                setup={
                  <SetupCard
                    localReady={localRootReady}
                    remoteReady={conns.drive.state === "connected"}
                    where={{
                      local: conns.local.where,
                      remote: conns.drive.where,
                    }}
                    localAvailable={localAvailable}
                    onChooseLocalFolder={chooseLocalFolder}
                    onConnectRemote={
                      remoteAvailable ? conns.drive.connect : undefined
                    }
                    flash={flash}
                  />
                }
                // The shelf bar's rule: a project needs a place.
                createLocked={!canCreate}
                busy={createProject.busy !== null}
                onLockedPress={() => setFlash((n) => n + 1)}
                found={cards.length}
                onShow={welcome.leave}
                onNew={() => {
                  welcome.leave();
                  requestCreate();
                }}
                onImport={() => {
                  welcome.leave();
                  requestImport();
                }}
                exploreTo="/app/editor/demo"
              />
            ) : face === "emptyShelf" ? (
              <EmptyShelf
                // Decided in `emptyState.ts`: a selected store is a different
                // question from a search that found nothing, and confusing them
                // makes disconnected Remote Storage look like lost projects.
                state={emptyState(
                  view.query,
                  view.filter,
                  conns.drive.state === "connected",
                  localRootReady,
                )}
                query={view.query}
                total={cards.length}
                onClear={() => {
                  view.setQuery("");
                  view.setFilter("all");
                }}
                onChooseLocalFolder={
                  localAvailable ? () => void chooseLocalFolder() : undefined
                }
                onFindLocalProjects={localRootReady ? findOnDevice : undefined}
                onConnectDrive={connectRemote}
                onFindInDrive={findInDrive}
                onImport={canCreate ? requestImport : undefined}
              />
            ) : (
              // Keyed on the density, so a change remounts the cards and
              // re-runs their entrance rather than snapping to a new shape. An
              // open card menu closes on a density change.
              <div
                key={view.density}
                className={`projects projects-${view.density}`}
              >
                {view.visible.map((card, i) => (
                  <ProjectCard
                    key={`${card.ref.providerId}:${card.ref.key}`}
                    card={card}
                    index={i}
                    shelfMaxWords={shelfMaxWords}
                    onForget={deleteProject.remove}
                    onSyncToDrive={
                      conns.drive.state === "connected"
                        ? projectSync.request
                        : undefined
                    }
                    onSyncNow={
                      conns.drive.state === "connected"
                        ? onSyncNowVoid
                        : undefined
                    }
                    onUnpair={onUnpairVoid}
                    // The hooks' own actions, not per-card closures: each
                    // takes the whole `Card`, so every card shares one
                    // reference.
                    onMoveToDrive={
                      conns.drive.state === "connected"
                        ? moveToRemote.request
                        : undefined
                    }
                    onMoveToLocal={
                      conns.drive.state === "connected"
                        ? moveToLocal.request
                        : undefined
                    }
                    onProperties={projectFacts.open}
                    onDuplicate={duplicateProject.request}
                    onExport={setExporting}
                    onDelete={deleteProject.request}
                    synced={!!card.id && synced.has(card.id)}
                    localRootReady={localRootReady}
                  />
                ))}
              </div>
            )}
          </main>
        </div>

        {/* Mounted only while open, so a second New project starts blank
          and its default destination reflects Remote Storage as it is now. */}
        {createProject.creating && (
          <CreateProjectDialog
            open
            {...destinationFacts}
            // Only the folder names on the shelf. A clash outside the library
            // is caught by the provider, which alone can see it.
            taken={takenFolders(cards)}
            onCreate={(request) => void createProject.create(request)}
            onImport={requestImport}
            onCancel={createProject.cancel}
            // The job lives in the hook; the dialog shows its progress and
            // its failure. The modal stays open, so the failure answers where
            // the press happened, not on a banner behind the scrim.
            progress={createProject.progress}
            createError={createProject.error}
          />
        )}

        {/* Mounted only while open: the fields are filled from the book, and
          a stale mount would hold the previous project's answers. Keyed by
          the card, so a window reopened on another book starts from it. */}
        {projectFacts.editing && (
          <ProjectPropertiesDialog
            key={
              projectFacts.editing.card.id ?? projectFacts.editing.card.ref.key
            }
            facts={projectFacts.editing.facts}
            failed={projectFacts.editing.failed}
            saving={projectFacts.editing.saving}
            saveError={projectFacts.editing.error}
            // Only a provider that implements `renameFolder` may promise a
            // renamed folder. Asked of the port, not of Drive's id, because
            // the promise is about a capability.
            folderFollowsTitle={
              !!getProvider(projectFacts.editing.card.ref.providerId)
                ?.renameFolder
            }
            folder={projectFacts.editing.card.ref.name}
            taken={takenFolders(cards, projectFacts.editing.card.ref)}
            onSave={(next) => {
              // The window renders only while `editingFacts` is set, and Save
              // is live only once its facts were read; the closure re-reads
              // the state, so the guard re-narrows both.
              const editing = projectFacts.editing;
              if (!editing?.facts) return;
              void projectFacts.save(editing.card, editing.facts, next);
            }}
            onCancel={projectFacts.close}
          />
        )}

        {/* A duplicate is always a new local folder, so the folder line always
          shows. The warning covers any source with a Remote Storage presence,
          because the duplicate carries no Remote Storage connection over. */}
        {duplicateProject.pending && (
          <ProjectNameDialog
            open
            title={t("library.duplicateTitle")}
            lede={t(
              isRemoteRef(duplicateProject.pending.ref) ||
                (!!duplicateProject.pending.id &&
                  synced.has(duplicateProject.pending.id))
                ? "library.duplicateLedeDriveSource"
                : "library.duplicateLede",
            )}
            confirmLabel={t("library.duplicateConfirm")}
            initialValue={t("library.copyOf", {
              title:
                duplicateProject.pending.content?.title ??
                duplicateProject.pending.ref.name,
            })}
            taken={takenFolders(cards)}
            onConfirm={(title) => {
              const pending = duplicateProject.pending;
              if (pending === null) return;
              void duplicateProject.confirm(pending, title);
            }}
            onCancel={duplicateProject.cancel}
          />
        )}

        {/* Fetched the first time a writer asks to import. */}
        {createProject.importing && (
          <Suspense fallback={null}>
            <ImportWindow
              {...destinationFacts}
              taken={takenFolders(cards)}
              accountName={user.name ?? null}
              progress={createProject.progress}
              error={createProject.error}
              onImport={(seed) => void createProject.createFrom(seed)}
              onClose={createProject.cancelImport}
            />
          </Suspense>
        )}

        {/* Fetched the first time a writer asks to export, never with the
            shelf. A card is offered the action only once it has been
            read, so it always carries the book's id. */}
        {exporting?.id && (
          <Suspense fallback={null}>
            <BookExportWindow
              project={exporting.ref}
              projectId={exporting.id}
              accountName={user?.name ?? null}
              onMessage={(text) => toasts.post(text)}
              onClose={() => setExporting(null)}
            />
          </Suspense>
        )}

        <DeleteFolderDialog
          card={deleteProject.pending}
          isSynced={
            !!deleteProject.pending?.id && synced.has(deleteProject.pending.id)
          }
          onConfirm={(card) => void deleteProject.confirm(card)}
          onCancel={deleteProject.cancel}
        />

        <MoveToDriveDialog
          card={moveToRemote.pending}
          onConfirm={(card) => void moveToRemote.confirm(card)}
          onCancel={moveToRemote.cancel}
        />

        <SyncConfirmDialog
          card={projectSync.pending}
          onConfirm={(ref) => void projectSync.confirm(ref)}
          onCancel={projectSync.cancel}
        />

        <SignOutConfirmDialog {...signOutFlow} />

        <MoveToLocalDialog
          card={moveToLocal.pending}
          onConfirm={(card) => void moveToLocal.confirm(card)}
          onCancel={moveToLocal.cancel}
        />

        {palette && (
          <CommandPalette
            open
            commands={commands}
            onClose={() => setPalette(false)}
          />
        )}

        <LegalNoticeDialog
          open={legalNotice}
          onClose={() => setLegalNotice(false)}
        />

        <DisconnectRemoteDialog
          open={disconnecting}
          disconnect={disconnectDrive}
          onClose={() => setDisconnecting(false)}
        />
        <StorageSearchDialog view={search.view} onClose={search.close} />

        {copyJob.copy && (
          <ProgressDialog
            open
            title={t(
              copyJob.copy.kind === "sync"
                ? "library.syncingTitle"
                : copyJob.copy.kind === "move"
                  ? "library.movingTitle"
                  : "library.copyingTitle",
            )}
            lede={t(
              copyJob.copy.kind === "sync"
                ? "library.syncingLede"
                : copyJob.copy.kind === "move"
                  ? "library.movingLede"
                  : "library.copyingLede",
              { name: copyJob.copy.name },
            )}
            done={copyJob.copy.done}
            total={copyJob.copy.total}
            current={copyJob.copy.path}
            cancelLabel={t("confirm.cancel")}
            onCancel={copyJob.cancel}
          />
        )}

        {/* Last, and outside the content wrapper: the nested route renders
          an overlay over the shelf, not a section of it, and nothing on
          `/app`. The settings sheet renders here and needs the root's state
          and actions, which only the Library has, hence the provider. */}
        <ConnectionsContext.Provider value={connectionsValue}>
          <Outlet />
        </ConnectionsContext.Provider>

        <ToastHost toasts={toasts.toasts} dismiss={toasts.dismiss} />
        {/* Joins the status column through its portal; it renders nothing
          here. */}
        <ReleaseNotice />
      </div>
    </OverlayBackgroundProvider>
  );
}
