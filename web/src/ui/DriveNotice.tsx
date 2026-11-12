// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import StatusNotice from "./StatusNotice";

// "Remote Storage needs reconnecting": a Drive grant revoked from the Google
// account page mid-session. The other error states announce themselves: the
// connection is gone, the write did not land. A lapsed grant produces a
// contradiction instead: the card goes `blocked`, the editor says the save
// failed because Remote Storage is not connected, and Settings shows it as
// connected, because `user.driveConnected` is the writer record's note and
// Google never tells the app about a revocation.
//
// This notice says the connection the app believes in is not being honoured,
// and that restoring it takes a gesture: `alert`, because nothing improves
// until the writer reconnects.
//
// It says nothing about the writer's work, because what happens to it depends
// on the project: a Local+Synced project still lands on disk with only its
// Remote Storage mirror stalled, while a Remote Storage-only project cannot be
// written at all. Which one the writer has is not this notice's to know; the
// save-failed notice in the same column answers it.

export default function DriveNotice({
  lapsed,
  claimed,
}: {
  /** Drive has refused this session's grant and not since accepted one. */
  lapsed: boolean;
  /** The app tells the writer elsewhere that Remote Storage is connected. */
  claimed: boolean;
}) {
  const { t } = useTranslation();

  // The condition is the contradiction, not the refusal alone. A writer who
  // never connected Remote Storage is not misinformed and has nothing to
  // reconnect; a refusal that arrives after sign-out belongs to an account that
  // has left the screen. Either would tell someone to fix a connection they do
  // not have.
  if (!lapsed || !claimed) return null;

  return (
    <StatusNotice tone="alert" className="drive-notice">
      {t("app.driveLapsed")}
    </StatusNotice>
  );
}
