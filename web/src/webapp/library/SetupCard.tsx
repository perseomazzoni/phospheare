// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { appIcons } from "../../ui/appIcons";
import { VENDORS } from "../../legal/domain/facts";
import {
  Button,
  Checklist,
  Icon,
  type ChecklistStep,
  type IconName,
} from "../../ui";

// The welcome's setup area: where the projects live, Local Storage, Remote
// Storage or both. Each row ticks from the connection it leaves behind, and
// one ticked row is enough to start a project, so the first tick leaves only
// the ticked rows and the other place waits behind a quiet way in.
//
// A place this writer cannot use stays drawn, dimmed with its reason, rather
// than offering a button that can only refuse: Remote Storage without a
// Google account, and Local Storage where the browser cannot open a folder
// and nothing else is left.

/** Where each place is, once it is ready: the folder name, the account. */
export interface PlaceWhere {
  local: string | null;
  remote: string | null;
}

export default function SetupCard({
  localReady,
  remoteReady,
  where,
  localAvailable,
  onChooseLocalFolder,
  onConnectRemote,
  flash,
}: {
  localReady: boolean;
  remoteReady: boolean;
  where: PlaceWhere;
  /** The browser can read a folder (File System Access API). */
  localAvailable: boolean;
  onChooseLocalFolder: () => Promise<unknown>;
  /**
   * Resolves false when the writer cancelled. True means the page is leaving
   * for the provider's consent screen, so the button stays busy until it goes.
   * Absent when the writer has no Google account.
   */
  onConnectRemote?: () => Promise<boolean>;
  flash?: number;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<"local" | "remote" | null>(null);

  const chooseLocal = async () => {
    setPending("local");
    try {
      await onChooseLocalFolder();
    } finally {
      setPending(null);
    }
  };

  const remoteAvailable = onConnectRemote !== undefined;

  const connectRemote = async () => {
    if (!onConnectRemote) return;
    setPending("remote");
    const leaving = await onConnectRemote().catch(() => false);
    if (!leaving) setPending(null);
  };

  const settled = (icon: IconName, text: string | null) =>
    text && (
      <span className="setup-where">
        <Icon name={icon} size={13} />
        {text}
      </span>
    );

  const later = (place: "local" | "remote", icon: IconName, label: string) => (
    <Button
      variant="ghost"
      className="ui-btn-sm"
      loading={pending === place}
      disabled={pending !== null && pending !== place}
      onClick={() => void (place === "local" ? chooseLocal() : connectRemote())}
    >
      <Icon name={icon} size={14} />
      {label}
    </Button>
  );

  const localStep: ChecklistStep = localAvailable
    ? {
        id: "local",
        name: t("library.setup.localName"),
        note: t("library.setup.localNote"),
        done: localReady,
        doneNote: settled(appIcons.local, where.local),
        later: later("local", appIcons.local, t("library.setup.addLocal")),
        actions: (
          <Button
            variant="outline"
            className="ui-btn-sm"
            loading={pending === "local"}
            disabled={pending === "remote"}
            onClick={() => void chooseLocal()}
          >
            <Icon name={appIcons.local} size={14} />
            {/* The accessible name the e2e helpers look for. */}
            {t("library.chooseLocalFolder")}
          </Button>
        ),
      }
    : {
        id: "local",
        name: t("library.setup.localName"),
        note: t("library.setup.localNote"),
        done: false,
        unavailable: t("library.diskUnsupported"),
      };

  const remoteStep: ChecklistStep = remoteAvailable
    ? {
        id: "remote",
        name: t("library.setup.remoteName"),
        note: t("library.setup.remoteNote"),
        done: remoteReady,
        doneNote: settled(appIcons.drive, where.remote),
        later: later("remote", appIcons.drive, t("library.setup.addRemote")),
        actions: (
          <Button
            variant="outline"
            className="ui-btn-sm"
            loading={pending === "remote"}
            disabled={pending === "local"}
            onClick={() => void connectRemote()}
          >
            <Icon name={appIcons.drive} size={14} />
            {t("library.connectDrive")}
          </Button>
        ),
      }
    : {
        id: "remote",
        name: t("library.setup.remoteName"),
        note: t("library.setup.remoteNote"),
        done: false,
        unavailable: t("library.driveNeedsAccount", {
          identity: VENDORS.identity,
        }),
      };

  // Firefox and Safari have no File System Access API. Their local row is
  // left out while Remote Storage can be used, and drawn dimmed when it is
  // the last place, so the card says why nothing can start.
  const steps =
    localAvailable || !remoteAvailable ? [localStep, remoteStep] : [remoteStep];

  return (
    <Checklist
      className="setup-card"
      title={t("library.setup.title")}
      steps={steps}
      oneIsEnough
      doneLabel={t("confirm.done")}
      flash={flash}
    />
  );
}
