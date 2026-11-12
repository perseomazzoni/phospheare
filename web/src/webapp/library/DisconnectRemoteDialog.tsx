// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DisconnectOptions } from "../../storage";
import { VENDORS } from "../../legal/domain/facts";
import { Dialog, DialogText, Pick } from "../../ui";
import { CopiesNotDeleted } from "./disconnectRemote";

// Disconnecting Remote Storage is one question with three answers and one
// button:
//   - This browser only clears its own connection; the other devices stay
//     connected. It is chosen when the dialog opens.
//   - Every device revokes the app's access at the identity provider, which
//     disconnects every browser and phone using the same Cloud project, and
//     leaves the account's settings and Library in Remote Storage.
//   - Every device, deleting them, removes the settings and Library first.
//     They are reachable only before the revoke, so this is where the writer
//     decides, and a later account deletion has nothing left to ask. The
//     button turns to the danger styling only while it is chosen.
// A disconnect from this browser leaves the copies, for the reason
// `disconnectRemote` gives. Three flat answers rather than "every device"
// with a checkbox, so a deletion is never chosen while out of sight.
//
// A failure keeps the dialog open with what did and did not happen. Copies
// deleted before a disconnect that failed are gone until the dialog closes,
// so every answer that would record them as kept is withdrawn.

type Choice = "here" | "everywhere" | "delete";

const OPTIONS: Record<Choice, DisconnectOptions> = {
  here: { everywhere: false },
  everywhere: { everywhere: true, keptCopies: true },
  delete: { everywhere: true, keptCopies: false },
};

/** What the last attempt left behind, while the dialog shows it. */
type Failure = "copies" | "disconnect" | "deleted-not-disconnected";

const FAILURE_COPY: Record<Failure, string> = {
  copies: "library.disconnectRemoteFailed",
  disconnect: "library.disconnectRemoteDisconnectFailed",
  "deleted-not-disconnected": "library.disconnectRemoteDeletedNotDisconnected",
};

export default function DisconnectRemoteDialog({
  open,
  disconnect,
  onClose,
}: {
  open: boolean;
  /**
   * Rejects with `CopiesNotDeleted` when the settings and Library could not
   * be removed, and with any other error when the disconnect failed.
   */
  disconnect: (options: DisconnectOptions) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<Choice>("here");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [copiesGone, setCopiesGone] = useState(false);
  const choices = useRef<HTMLDivElement>(null);

  const close = () => {
    setChoice("here");
    setFailure(null);
    setCopiesGone(false);
    onClose();
  };

  const run = () => {
    if (busy) return;
    const options = OPTIONS[choice];
    setBusy(true);
    setFailure(null);
    disconnect(options)
      .then(close, (err: unknown) => {
        const copies = err instanceof CopiesNotDeleted;
        const deleted = !copies && choice === "delete";
        if (deleted) setCopiesGone(true);
        setFailure(
          copies
            ? "copies"
            : deleted
              ? "deleted-not-disconnected"
              : "disconnect",
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open={open}
      title={t("library.disconnectRemoteTitle")}
      dismissible={!busy}
      initialFocus={() =>
        choices.current?.querySelector<HTMLElement>("input:checked") ?? null
      }
      problem={failure ? t(FAILURE_COPY[failure]) : undefined}
      cancelDisabled={busy}
      onCancel={() => {
        if (!busy) close();
      }}
      confirmLabel={t(
        choice === "delete"
          ? "library.disconnectRemoteConfirmDelete"
          : "library.disconnectRemoteConfirm",
      )}
      confirmTone={choice === "delete" ? "danger" : "primary"}
      confirmBusy={busy}
      onConfirm={run}
    >
      <div
        ref={choices}
        className="picks"
        role="radiogroup"
        aria-label={t("library.disconnectRemoteTitle")}
      >
        <Pick
          group="disconnect-remote"
          on={choice === "here"}
          disabled={copiesGone}
          name={t("library.disconnectRemoteHere")}
          onChoose={() => setChoice("here")}
        >
          <DialogText lead={t("library.disconnectRemoteHereSub")} />
        </Pick>
        <Pick
          group="disconnect-remote"
          on={choice === "everywhere"}
          disabled={copiesGone}
          name={t("library.disconnectRemoteEverywhere")}
          onChoose={() => setChoice("everywhere")}
        >
          <DialogText
            lead={t("library.disconnectRemoteEverywhereSub", {
              identity: VENDORS.identity,
            })}
          />
        </Pick>
        <Pick
          group="disconnect-remote"
          on={choice === "delete"}
          name={t("library.disconnectRemoteEverywhereDelete")}
          onChoose={() => setChoice("delete")}
        >
          <DialogText
            lead={t("library.disconnectRemoteBody")}
            items={[t("accountData.settings"), t("accountData.library")]}
            after={[t("library.disconnectRemoteAfter")]}
          />
        </Pick>
      </div>
      <DialogText lead={t("accountData.projectsUntouched")} />
    </Dialog>
  );
}
