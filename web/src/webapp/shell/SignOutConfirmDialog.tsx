// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogText, Pick } from "../../ui";
import type { SignOutFailure, SignOutFlow } from "./useSignOutFlow";

// The sign-out question, the same for both kinds of account, as two choices
// and one button:
//   - "Leave everything" signs out and keeps everything here for the next
//     entry. It is chosen when the dialog opens.
//   - "Clean everything" signs out and removes everything of the account
//     from this browser. The button turns to the danger styling only while
//     it is chosen.
// "Stay signed in" and Escape close the dialog and change nothing. Choosing
// is not acting: a radio never signs out, so a stray arrow key or Enter
// destroys nothing, and focus opens on the chosen, safe choice.
//
// Each choice carries its consequences under its name. The clean lists what
// it deletes and then where those things can still be found: Remote Storage
// when it holds a copy, nowhere when it does not.
//
// When the queue still holds work for this account, the count is in the
// title and in the clean's list, and the button names the loss, because a
// person deciding under time pressure reads a title and a button. It
// counts files: a file is what an op names and is exactly countable, while a
// project count would round a whole afternoon down to "1".
//
// While Remote Storage is connected, the profile is written there before a
// clean is carried out. When that upload fails, the question opens again
// saying the copy there lacks the latest changes. A failed attempt reopens
// on the choice that was made; only leaving the dialog resets it.

type Choice = "leave" | "clean";

const FAILURE_COPY: Record<SignOutFailure, string> = {
  disconnect: "library.signOutDisconnectFailed",
  "sign-out": "library.signOutFailed",
  "sign-out-disconnected": "library.signOutFailedDisconnected",
};

export default function SignOutConfirmDialog({
  confirming,
  driveConnected,
  remoteCopiesKept,
  heldFiles,
  failure,
  profileUnsaved,
  leave,
  clean,
  cancelSignOut,
}: SignOutFlow) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<Choice>("leave");
  const choices = useRef<HTMLDivElement>(null);
  const held = heldFiles > 0;
  // A sign-out that failed past the Remote Storage drop left Remote Storage
  // disconnected here, even while the connection state still reads connected.
  const connected = driveConnected && failure !== "sign-out-disconnected";
  // Held work exists only because Remote Storage was connected, and the
  // profile was written there before the clean, so a copy is there.
  const remote = profileUnsaved
    ? t("library.signOutProfileUnsaved")
    : connected || held
      ? t("library.signOutAfterConnected")
      : remoteCopiesKept
        ? t("library.signOutAfterKept")
        : t("library.signOutAfter");
  const deleted = [
    ...(held ? [t("library.signOutHeldItem", { count: heldFiles })] : []),
    t("accountData.settings"),
    t("accountData.library"),
    ...(connected ? [t("accountData.connection")] : []),
  ];
  // Held work with no connection to drain through waits for a reconnect, so
  // leaving does not promise a sync.
  const kept = held
    ? t(
        connected
          ? "library.signOutHeldLeave"
          : "library.signOutHeldLeaveDisconnected",
      )
    : t("library.signOutLeaveSub");
  const cancel = () => {
    setChoice("leave");
    cancelSignOut();
  };

  return (
    <Dialog
      open={confirming}
      title={
        held
          ? t("library.signOutHeldTitle", { count: heldFiles })
          : t("library.signOutTitle")
      }
      initialFocus={() =>
        choices.current?.querySelector<HTMLElement>("input:checked") ?? null
      }
      // The same question again, with the reason the last answer did not
      // take. Nothing on this device was cleared, so every choice still
      // holds; the reason says when Remote Storage was disconnected on the
      // way.
      problem={failure ? t(FAILURE_COPY[failure]) : undefined}
      cancelLabel={t("library.signOutDismiss")}
      onCancel={cancel}
      confirmLabel={
        choice === "leave"
          ? t("library.signOut")
          : t(held ? "library.signOutHeldConfirm" : "library.signOutClean")
      }
      confirmTone={choice === "clean" ? "danger" : "primary"}
      onConfirm={choice === "leave" ? leave : clean}
    >
      <div
        ref={choices}
        className="picks"
        role="radiogroup"
        aria-label={t("library.signOutTitle")}
      >
        <Pick
          group="sign-out"
          on={choice === "leave"}
          name={t("library.signOutChoiceLeave")}
          onChoose={() => setChoice("leave")}
        >
          <DialogText lead={kept} />
        </Pick>
        <Pick
          group="sign-out"
          on={choice === "clean"}
          name={t("library.signOutChoiceClean")}
          onChoose={() => setChoice("clean")}
        >
          <DialogText
            lead={t(
              connected
                ? "library.signOutLeadConnected"
                : "library.signOutLead",
            )}
            items={deleted}
            after={[
              held ? `${t("library.signOutHeldLost")} ${remote}` : remote,
            ]}
          />
        </Pick>
      </div>
      <DialogText lead={t("accountData.projectsUntouched")} />
    </Dialog>
  );
}
