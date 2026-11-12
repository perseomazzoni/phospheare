// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useState, useContext } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { driveProvider, localProvider } from "../../storage";
import { prefetchSheets, useTheme, type SchemeChoice } from "../../theme";
import { setLanguage } from "../../locales/i18n";
import {
  AccessCard,
  Button,
  Icon,
  SegmentedControl,
  Select,
  SettingPair,
  SettingPairs,
  SettingSection,
  Sheet,
  type IconName,
} from "../../ui";
import { appIcons } from "../../ui/appIcons";
import ThemeTile from "../shared/ThemeTile";
import { PRODUCT } from "../../product";
import { APP_VERSION } from "../../release";
import { APP_LANGUAGES } from "../../locales/languages";
import { getPref, setPref } from "../../profile/profileSync";
import {
  AUTOSAVE_DELAY_PRESETS,
  DEFAULT_AUTOSAVE_DELAY_S,
  DEFAULT_HENOSIS_AFTER_S,
  DEFAULT_HENOSIS_FADE_S,
  DEFAULT_HENOSIS_PAUSE_S,
  HENOSIS_AFTER_PRESETS,
  HENOSIS_FADE_PRESETS,
  HENOSIS_PAUSE_PRESETS,
  DEFAULT_PROSE_SIZE,
  PROSE_SIZES,
  type FocusMode,
  type ProseSize,
} from "../../project/types";
import {
  FOCUS_LABEL,
  delayLabel,
  proseSizeLabel,
} from "../../editor/preferenceLabels";
import { ConnectionsContext } from "../library/ConnectionsContext";
import { closeTarget } from "./closeTarget";
import { useSignOutFlow } from "./useSignOutFlow";
import SignOutConfirmDialog from "./SignOutConfirmDialog";
import DisconnectRemoteDialog from "../library/DisconnectRemoteDialog";
import DeleteAccountDialog from "./DeleteAccountDialog";
import { useDeleteAccount } from "./useDeleteAccount";
import { VENDORS } from "../../legal/domain/facts";
import LegalLinks from "../../legal/LegalLinks";
import LegalNoticeDialog from "../../legal/LegalNoticeDialog";
import AiSettingsPane from "../../ai/AiSettingsPane";
import { DeviceConnectionPreferences } from "../../ai/host/deviceConnectionAdapter";
import { SyncedRemoteModelPreferences } from "../../ai/host/remoteModels";
import type { RemoteProviderStatus } from "../../ai/ports";
import { useConnectProvider } from "../ai/useConnectProvider";
import {
  OPENROUTER_ID,
  disconnectOpenRouter,
  openRouterProvider,
  setRemember,
} from "../../ai/host/openrouterConnection";
import { currentPlatform } from "../../platform";

// Settings, as a sheet over the Library.
//
// The AI pane's adapter is composed here, above both the AI core and the
// account layer: the pane knows only the port.
const aiConnection = new DeviceConnectionPreferences();
const aiRemoteModels = new SyncedRemoteModelPreferences();
//
// The sheet sits at /app/settings, a real URL, over a Library that never
// unmounts, so a writer who changes a theme keeps their place on the shelf.
//
// Panes are grouped by what a writer owns rather than by which subsystem
// implements it: how it looks, where your words live, who you are.

type Pane = "look" | "words" | "editor" | "ai" | "you" | "about";

export default function SettingsSheet() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { theme, mode, families, setFamily, setScheme } = useTheme();
  // Each theme's sheet is fetched only when it is in use; here a writer may
  // choose one, so they are fetched now and a choice goes on at once.
  useEffect(prefetchSheets, []);
  // The variants of the theme in use, named by the variants themselves
  // ("once dark", "still dark", the same pair in every theme), then the
  // choice that follows the system's. A theme missing one offers only the
  // one it has.
  const variants = useMemo(() => {
    const family = families.find((one) => one.id === theme.family);
    const fixed = (["light", "dark"] as const).flatMap((scheme) => {
      const variant = family?.[scheme];
      return variant ? [{ value: scheme, label: variant.label }] : [];
    });
    return [
      ...fixed,
      { value: "system" as const, label: t("settings.themeSystem") },
    ];
  }, [families, theme.family, t]);
  // The Library root owns the one collector instance, as `ConnectionsContext`
  // says; this nested route reads it through context.
  const { connections, chooseLocalFolder, forgetLocalFolder } =
    useContext(ConnectionsContext);
  // The OpenRouter status, connected or not, read as the AI port's
  // `RemoteProviderStatus`, which keeps `ai/AiSettingsPane.tsx` clear of
  // `auth/` (`boundaries.test.ts`). "Absence is the answer" is right for a
  // capability and wrong here: both states have a surface, and a
  // disconnected provider's row is the only place a writer can connect it.
  const openRouter = user?.openRouter;
  const remoteProviders = useMemo<RemoteProviderStatus[]>(
    () => (openRouter ? [openRouter] : []),
    [openRouter],
  );
  const { connect, blocked: connectBlocked, pending } = useConnectProvider();
  const writerId = user?.id ?? null;
  // One catalogue reader per account, on the account's own key.
  const catalogueProvider = useMemo(
    () => (writerId ? openRouterProvider(writerId) : null),
    [writerId],
  );
  const readCatalogue = useMemo(
    () =>
      catalogueProvider
        ? (_providerId: string, signal: AbortSignal) =>
            catalogueProvider.listModels(signal)
        : undefined,
    [catalogueProvider],
  );
  const disconnectProvider = (providerId: string) => {
    const platform = currentPlatform();
    if (providerId !== OPENROUTER_ID || !writerId) return;
    void disconnectOpenRouter(writerId, platform);
  };
  const rememberKey = (providerId: string, remember: boolean) => {
    const platform = currentPlatform();
    if (providerId !== OPENROUTER_ID || !writerId) return;
    void setRemember(writerId, platform, remember);
  };
  const drive = connections.drive;
  const root = {
    ready:
      connections.local.state === "connected" ||
      connections.local.state === "needs-gesture",
    choose: chooseLocalFolder,
    forget: forgetLocalFolder,
  };
  const signOutFlow = useSignOutFlow(drive);
  const deleteFlow = useDeleteAccount(drive);
  const [disconnecting, setDisconnecting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const [pane, setPane] = useState<Pane>("look");
  // i18n.language can carry a region ("en-GB"); the control only knows the
  // base.
  const [language, setLanguageState] = useState(
    () => i18n.language.split("-")[0],
  );

  // The global Editor Settings, mirrored into local state like the language
  // control: `setPref` writes the account's profile, and the control needs
  // its own copy to re-render. Read through the prefs facade (the local profile
  // serves this synchronously).
  const [proseSize, setProseSizeState] = useState(() =>
    String(getPref<ProseSize | null>("proseSize", null) ?? DEFAULT_PROSE_SIZE),
  );
  const [typewriter, setTypewriterState] = useState(() =>
    (getPref<boolean | null>("typewriter", null) ?? false) ? "on" : "off",
  );
  const [focus, setFocusState] = useState<FocusMode>(
    () => getPref<FocusMode | null>("focus", null) ?? "off",
  );
  const [smoothCaret, setSmoothCaretState] = useState(() =>
    (getPref<boolean | null>("smoothCaret", null) ?? false) ? "on" : "off",
  );
  const [autosave, setAutosaveState] = useState(() =>
    (getPref<boolean | null>("autosave", null) ?? false) ? "on" : "off",
  );
  const [autosaveDelay, setAutosaveDelayState] = useState(() =>
    String(
      getPref<number | null>("autosaveDelay", null) ?? DEFAULT_AUTOSAVE_DELAY_S,
    ),
  );

  const [henosis, setHenosisState] = useState(() =>
    (getPref<boolean | null>("henosis", null) ?? false) ? "on" : "off",
  );
  const [henosisAfter, setHenosisAfterState] = useState(() =>
    String(
      getPref<number | null>("henosisAfter", null) ?? DEFAULT_HENOSIS_AFTER_S,
    ),
  );
  const [henosisFade, setHenosisFadeState] = useState(() =>
    String(
      getPref<number | null>("henosisFade", null) ?? DEFAULT_HENOSIS_FADE_S,
    ),
  );

  const [henosisPause, setHenosisPauseState] = useState(() =>
    String(
      getPref<number | null>("henosisPause", null) ?? DEFAULT_HENOSIS_PAUSE_S,
    ),
  );

  const editorPref = (key: string, value: unknown) => {
    setPref(key, value);
  };

  const ON_OFF: { value: "on" | "off"; label: string }[] = [
    { value: "on", label: t("settings.turnedOn") },
    { value: "off", label: t("settings.turnedOff") },
  ];
  const FOCUS_OPTIONS: { value: FocusMode; label: string }[] = Object.entries(
    FOCUS_LABEL,
  ).map(([value, label]) => ({ value: value as FocusMode, label: t(label) }));

  const [legalNotice, setLegalNotice] = useState(false);

  const target = closeTarget(location.state);
  // A deep link has nothing behind it, which is also what makes the entrance
  // wrong: there was no shelf to slide over.
  const coldLink = !("back" in target);

  const close = () => {
    if ("back" in target) void navigate(-1);
    else void navigate(target.to);
  };

  const panes: { id: Pane; label: string; icon: IconName }[] = [
    { id: "look", label: t("settings.paneLook"), icon: appIcons.look },
    { id: "words", label: t("settings.paneWords"), icon: appIcons.words },
    { id: "editor", label: t("settings.paneEditor"), icon: appIcons.edit },
    { id: "ai", label: t("settings.paneAi"), icon: appIcons.assistant },
    { id: "you", label: t("settings.paneYou"), icon: appIcons.account },
    { id: "about", label: t("settings.paneAbout"), icon: appIcons.about },
  ];

  if (!user) return null;

  return (
    <Sheet open instant={coldLink} title={t("settings.title")} onClose={close}>
      <div className="sheet-cols">
        <nav className="sheet-nav" aria-label={t("settings.title")}>
          {panes.map((one) => (
            <button
              key={one.id}
              type="button"
              aria-current={pane === one.id}
              onClick={() => setPane(one.id)}
            >
              <Icon name={one.icon} size={15} />
              {/* The label needs an element of its own: `text-overflow` acts on
                  a box, and a bare text node beside the icon has none. */}
              <span className="sheet-nav-label">{one.label}</span>
            </button>
          ))}
        </nav>

        <div className="sheet-pane">
          {pane === "look" && (
            <>
              <SettingSection title={t("settings.theme")}>
                <p className="setting-note">{t("settings.themeHint")}</p>
                {/* Each tile is drawn in the variant the writer is on, so the
                    two compare like with like and choosing one keeps once
                    dark or still dark as it was. */}
                <div className="themes">
                  {families.map((family) => {
                    const shown =
                      family[theme.scheme] ?? family.light ?? family.dark;
                    return shown ? (
                      <ThemeTile
                        key={family.id}
                        theme={shown}
                        name={family.label}
                        on={family.id === theme.family}
                        onChoose={() => setFamily(family.id)}
                      />
                    ) : null;
                  })}
                </div>
                <SegmentedControl<SchemeChoice>
                  label={t("settings.themeVariant")}
                  options={variants}
                  value={mode}
                  onChange={setScheme}
                  className="themes-variant"
                />
              </SettingSection>

              <SettingSection title={t("settings.language")}>
                <p className="setting-note">{t("settings.languageHint")}</p>
                <SegmentedControl
                  label={t("settings.language")}
                  options={APP_LANGUAGES}
                  value={language}
                  onChange={(next) => {
                    setLanguage(next);
                    setLanguageState(next);
                  }}
                />
              </SettingSection>
            </>
          )}

          {pane === "words" && (
            <SettingSection title={t("settings.storage")}>
              {drive.error && <p className="setting-problem">{drive.error}</p>}

              {drive.state !== "connected" && user.withGoogle && (
                <p className="setting-note">{t("settings.driveExplainer")}</p>
              )}

              {/* Without a Google account it is drawn dimmed, with the reason
                  and no control. */}
              <AccessCard
                icon={driveProvider.icon}
                name={driveProvider.label()}
                live={drive.state === "connected"}
                state={
                  drive.state === "connected"
                    ? t("settings.driveOn", {
                        email: user.driveEmail ?? user.email,
                      })
                    : user.withGoogle
                      ? t("settings.driveOffHint")
                      : t("library.driveNeedsAccount", {
                          identity: VENDORS.identity,
                        })
                }
                unavailable={!user.withGoogle}
                can={[t("settings.driveCan")]}
                cannot={[
                  t("settings.driveCannotSee"),
                  t("settings.driveCannotCopy"),
                ]}
                action={
                  drive.state === "connected" ? (
                    <Button
                      variant="ghost"
                      className="ui-btn-sm"
                      onClick={() => setDisconnecting(true)}
                    >
                      {t("library.disconnect")}
                    </Button>
                  ) : user.withGoogle ? (
                    <Button
                      variant="outline"
                      className="ui-btn-sm"
                      onClick={() => void drive.connect()}
                    >
                      {t("library.connect")}
                    </Button>
                  ) : undefined
                }
              />

              <AccessCard
                icon={root.ready ? localProvider.icon : appIcons.localOff}
                name={localProvider.label()}
                live={root.ready}
                state={
                  connections.local.state !== "unavailable"
                    ? root.ready
                      ? t("settings.diskOn")
                      : t("settings.diskOffHint")
                    : t("library.diskUnsupported")
                }
                unavailable={connections.local.state === "unavailable"}
                can={[t("settings.diskCan")]}
                cannot={[t("settings.diskCannot")]}
                // Remote Storage's own Connect/Disconnect pattern, applied to
                // the root: choose it, or forget it (a remap is Forget then
                // Choose; the books stay on disk either way).
                action={
                  connections.local.state !== "unavailable" ? (
                    root.ready ? (
                      <Button
                        variant="ghost"
                        className="ui-btn-sm"
                        onClick={root.forget}
                      >
                        {t("library.forgetLocalFolder")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="ui-btn-sm"
                        onClick={root.choose}
                      >
                        {t("library.chooseLocalFolder")}
                      </Button>
                    )
                  ) : undefined
                }
              />
            </SettingSection>
          )}

          {pane === "editor" && (
            <SettingSection title={t("settings.editor")}>
              {/* The defaults every project inherits; a project can override
                  any of these for itself. */}
              <p className="setting-note">{t("settings.editorHint")}</p>

              <SettingPairs>
                <SettingPair label={t("tree.proseSize")}>
                  <SegmentedControl
                    label={t("tree.proseSize")}
                    value={proseSize}
                    onChange={(next) => {
                      editorPref("proseSize", Number(next));
                      setProseSizeState(next);
                    }}
                    options={PROSE_SIZES.map((size) => ({
                      value: String(size),
                      label: t(proseSizeLabel(size)),
                    }))}
                  />
                </SettingPair>

                <SettingPair label={t("tree.typewriter")}>
                  <SegmentedControl
                    label={t("tree.typewriter")}
                    value={typewriter}
                    onChange={(next) => {
                      editorPref("typewriter", next === "on");
                      setTypewriterState(next);
                    }}
                    options={ON_OFF}
                  />
                </SettingPair>

                <SettingPair label={t("tree.focus")}>
                  <SegmentedControl
                    label={t("tree.focus")}
                    value={focus}
                    onChange={(next) => {
                      editorPref("focus", next);
                      setFocusState(next);
                    }}
                    options={FOCUS_OPTIONS}
                  />
                </SettingPair>

                <SettingPair label={t("tree.smoothCaret")}>
                  <SegmentedControl
                    label={t("tree.smoothCaret")}
                    value={smoothCaret}
                    onChange={(next) => {
                      editorPref("smoothCaret", next === "on");
                      setSmoothCaretState(next);
                    }}
                    options={ON_OFF}
                  />
                </SettingPair>

                <SettingPair label={t("tree.autosave")}>
                  <SegmentedControl
                    label={t("tree.autosave")}
                    value={autosave}
                    onChange={(next) => {
                      editorPref("autosave", next === "on");
                      setAutosaveState(next);
                    }}
                    options={ON_OFF}
                  />
                </SettingPair>

                {autosave === "on" && (
                  <SettingPair sub label={t("tree.autosaveEvery")}>
                    <Select
                      // The row draws this name already, one column to the
                      // left. The control's own caption would be the same
                      // words twice, and the second copy sits in the column
                      // the controls line up in.
                      labelHidden
                      label={t("tree.autosaveEvery")}
                      value={autosaveDelay}
                      onChange={(next) => {
                        editorPref("autosaveDelay", Number(next));
                        setAutosaveDelayState(next);
                      }}
                      options={AUTOSAVE_DELAY_PRESETS.map((delay) => ({
                        value: String(delay),
                        label: delayLabel(delay, t),
                      }))}
                    />
                  </SettingPair>
                )}

                <SettingPair label={t("tree.henosis")}>
                  <SegmentedControl
                    label={t("tree.henosis")}
                    value={henosis}
                    onChange={(next) => {
                      editorPref("henosis", next === "on");
                      setHenosisState(next);
                    }}
                    options={ON_OFF}
                  />
                </SettingPair>

                {henosis === "on" && (
                  <>
                    <SettingPair
                      sub
                      label={t("tree.henosisAfter")}
                      note={t("tree.henosisAfterNote")}
                    >
                      <Select
                        labelHidden
                        label={t("tree.henosisAfter")}
                        value={henosisAfter}
                        onChange={(next) => {
                          editorPref("henosisAfter", Number(next));
                          setHenosisAfterState(next);
                        }}
                        options={HENOSIS_AFTER_PRESETS.map((after) => ({
                          value: String(after),
                          label: delayLabel(after, t),
                        }))}
                      />
                    </SettingPair>
                    <SettingPair
                      sub
                      label={t("tree.henosisFade")}
                      note={t("tree.henosisFadeNote")}
                    >
                      <Select
                        labelHidden
                        label={t("tree.henosisFade")}
                        value={henosisFade}
                        onChange={(next) => {
                          editorPref("henosisFade", Number(next));
                          setHenosisFadeState(next);
                        }}
                        options={HENOSIS_FADE_PRESETS.map((fade) => ({
                          value: String(fade),
                          label: delayLabel(fade, t),
                        }))}
                      />
                    </SettingPair>
                    <SettingPair
                      sub
                      label={t("tree.henosisPause")}
                      note={t("tree.henosisPauseNote")}
                    >
                      <Select
                        labelHidden
                        label={t("tree.henosisPause")}
                        value={henosisPause}
                        onChange={(next) => {
                          editorPref("henosisPause", Number(next));
                          setHenosisPauseState(next);
                        }}
                        options={HENOSIS_PAUSE_PRESETS.map((pause) => ({
                          value: String(pause),
                          label: delayLabel(pause, t),
                        }))}
                      />
                    </SettingPair>
                  </>
                )}
              </SettingPairs>
            </SettingSection>
          )}

          {pane === "you" && (
            <>
              <SettingSection title={t("settings.account")}>
                {/* An account without Google has no name to show; the note
                  says what it is. */}
                {user.withGoogle && <p className="setting-key">{user.email}</p>}
                <p className="setting-note">
                  {t(
                    user.withGoogle
                      ? "settings.accountNote"
                      : "settings.accountNoteWithoutGoogle",
                  )}
                </p>
                <div className="setting-row">
                  <Button
                    variant="outline"
                    className="ui-btn-sm"
                    onClick={signOutFlow.requestSignOut}
                  >
                    {t("library.signOut")}
                  </Button>
                </div>
              </SettingSection>

              {/* Last and apart: everything above is reversible, this is not.
                An account without Google has nothing beyond this device, and
                its clearing sign-out already removes it. */}
              {user.withGoogle && (
                <SettingSection title={t("settings.deleteAccount")}>
                  <p className="setting-note">
                    {t("settings.deleteAccountNote")}
                  </p>
                  <div className="setting-row">
                    <Button
                      variant="danger"
                      className="ui-btn-sm"
                      disabled={deleteFlow.busy}
                      onClick={deleteFlow.request}
                    >
                      {t("settings.deleteAccount")}
                    </Button>
                  </div>
                </SettingSection>
              )}
            </>
          )}
          {/* About: the one promise the product makes is the landing page's
              lede, so the two never disagree. */}
          {pane === "about" && (
            <section className="about">
              <img
                className="about-emblem"
                src="/brand/emblem.webp"
                alt=""
                width={240}
                height={240}
              />
              <p className="about-name">{PRODUCT.name}</p>
              <p className="about-tagline">{t("settings.aboutTagline")}</p>
              {/* The pitch, and only the pitch: the folder is not the focus
                  of the application, so no line about it follows. */}
              <p className="setting-note">{t("settings.aboutNote")}</p>
              {/* The license and the source are the pane's footer. The
                  repository's address is the one string on screen that spells
                  the working name; `product.test.ts` allows that address and
                  nothing else. `rel` keeps the opened page from reaching back
                  into this one. */}
              <footer className="about-foot">
                <span>
                  {t("settings.aboutVersion", { version: APP_VERSION })}
                </span>
                <span aria-hidden="true"> · </span>
                {t("settings.aboutLicense")}{" "}
                <a
                  href="https://www.gnu.org/licenses/agpl-3.0.html"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("settings.aboutLicenseLink")}
                </a>
                <span aria-hidden="true"> · </span>
                <a
                  href="https://github.com/perseomazzoni/phospheare"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("settings.aboutSourceLink")}
                </a>
                <span aria-hidden="true"> · </span>
                <LegalLinks separated onNotice={() => setLegalNotice(true)} />
              </footer>
            </section>
          )}
          {pane === "ai" && (
            <AiSettingsPane
              connection={aiConnection}
              remoteModels={aiRemoteModels}
              remoteProviders={remoteProviders}
              onConnect={connect}
              connectBlocked={connectBlocked}
              connecting={pending}
              readCatalogue={readCatalogue}
              onDisconnect={disconnectProvider}
              onRemember={rememberKey}
              credentialProtection={currentPlatform().credentialProtection}
            />
          )}
        </div>
      </div>

      <SignOutConfirmDialog {...signOutFlow} />
      <DisconnectRemoteDialog
        open={disconnecting}
        disconnect={drive.disconnect}
        onClose={() => setDisconnecting(false)}
      />
      <DeleteAccountDialog
        flow={deleteFlow}
        remoteConnected={drive.state === "connected"}
        remoteCopiesKept={user.remoteCopiesKept}
      />

      <LegalNoticeDialog
        open={legalNotice}
        onClose={() => setLegalNotice(false)}
      />
    </Sheet>
  );
}
