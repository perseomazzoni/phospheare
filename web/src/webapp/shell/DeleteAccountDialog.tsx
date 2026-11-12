// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { AlertDialog } from "../../ui";
import { VENDORS } from "../../legal/domain/facts";
import type { DeleteAccountFlow } from "./useDeleteAccount";

// The last question before an account is deleted. A failed attempt reopens
// on the same question with the reason, and the same buttons are the retry.

/** The reason for the step that stopped, saying what already happened. */
function failureCopy(flow: DeleteAccountFlow): string {
  switch (flow.failure) {
    case "remote":
      return "settings.deleteAccountRemoteFailed";
    case "revoke":
      return "settings.deleteAccountRevokeFailed";
    case "local":
      return flow.remoteCleared
        ? "settings.deleteAccountLocalFailed"
        : "settings.deleteAccountFailed";
    default:
      return "settings.deleteAccountFailed";
  }
}

export default function DeleteAccountDialog({
  flow,
  remoteConnected,
  remoteCopiesKept,
}: {
  flow: DeleteAccountFlow;
  remoteConnected: boolean;
  /** Settings and Library were left in Remote Storage when it was disconnected. */
  remoteCopiesKept: boolean;
}) {
  const { t } = useTranslation();
  const vars = { identity: VENDORS.identity };
  return (
    <AlertDialog
      open={flow.confirming}
      title={t("settings.deleteAccountTitle")}
      body={t(
        remoteConnected
          ? "settings.deleteAccountLeadConnected"
          : "settings.deleteAccountLead",
      )}
      items={[
        t("accountData.settings"),
        t("accountData.library"),
        t("accountData.unsynced"),
      ]}
      after={[
        ...(remoteConnected
          ? [t("settings.deleteAccountAfterConnected", vars)]
          : remoteCopiesKept
            ? [t("settings.deleteAccountAfterKept")]
            : []),
        t("accountData.projectsUntouched"),
      ]}
      problem={flow.failure ? t(failureCopy(flow), vars) : undefined}
      confirmLabel={t("settings.deleteAccountConfirm")}
      cancelLabel={t("settings.deleteAccountCancel")}
      onConfirm={() => {
        if (!flow.busy) flow.confirm();
      }}
      onCancel={flow.cancel}
    />
  );
}
