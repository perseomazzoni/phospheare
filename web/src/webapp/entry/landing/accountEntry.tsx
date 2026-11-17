// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The full program's ways in: Google sign-in, in a popup, and the account
// without Google. Google sign-in is offered only once the identity service
// has answered (`signInReachable`): until then, and when it does not answer,
// the header's primary button is the way in without an account, and the
// closing section's "Start writing" takes that way too.
//
// Without an account the projects live in a folder on the computer. A
// browser that cannot open one (Firefox, Safari) is told so on entry, with
// the ways that work, rather than let into a Library with nowhere to write.

import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../auth/AuthContext";
import { clearFarewell, peekFarewell } from "../../../auth/farewell";
import { signInProblemKey } from "../../../auth/signInProblem";
import { appLog, describeError } from "../../../log";
import { isPlatformError } from "../../../platform";
import { localFoldersSupported } from "../../../storage/localRoot";
import { VENDORS } from "../../../legal/domain/facts";
import { Button, Dialog, DialogText } from "../../../ui";
import { DEMO_PATH } from "./content";
import type { LandingEntry } from "./entry";

/** The browsers that open a local folder, by name in every language. */
const NO_FOLDERS_BROWSERS = ["Chrome", "Edge"] as const;

export function useAccountEntry(): LandingEntry {
  const { t } = useTranslation();
  const { status, signInReachable, logIn, enterWithoutAccount } = useAuth();
  const [problem, setProblem] = useState<string | null>(null);
  const [openedSignedOut] = useState(status === "anonymous");
  const [noFolders, setNoFolders] = useState(false);
  // Read on mount and dropped after, so a later landing does not repeat it.
  const [farewell, setFarewell] = useState(peekFarewell);
  useEffect(() => clearFarewell(), []);
  const navigate = useNavigate();

  // Called inside the click: the popup must open in it.
  const logInWithGoogle = () => {
    setProblem(null);
    logIn().catch((err: unknown) => {
      // A closed window is no failure, and an unreachable service is
      // logged where the request failed.
      if (
        !isPlatformError(err, "flow-cancelled") &&
        !isPlatformError(err, "unavailable")
      ) {
        appLog.warn("account", "Google sign-in failed.", {
          code: isPlatformError(err) ? err.code : null,
          ...describeError(err),
        });
      }
      setProblem(signInProblemKey(err));
    });
  };

  const withoutAccount = localFoldersSupported()
    ? enterWithoutAccount
    : () => setNoFolders(true);
  const withGoogle = signInReachable === true;

  return {
    // A page that opened signed out and is now signed in has just signed in,
    // and the app greets it with the splash (`SessionGate`).
    redirect:
      status === "authenticated" ? (
        <Navigate to="/app" replace state={{ justLoggedIn: openedSignedOut }} />
      ) : null,
    withGoogle,
    head: (
      <>
        {/* Both ways in stay at every width, in their short words where the
            header is narrow; each keeps its full name as its label. */}
        <Button
          variant={withGoogle ? "ghost" : "primary"}
          className="ui-btn-sm"
          aria-label={t("landing.withoutAccount")}
          onClick={withoutAccount}
        >
          <span className="landing-head-long">
            {t("landing.withoutAccount")}
          </span>
          <span className="landing-head-short">
            {t("landing.head.withoutAccount")}
          </span>
        </Button>
        {withGoogle && (
          <Button
            variant="primary"
            className="ui-btn-sm"
            aria-label={t("landing.head.logIn")}
            onClick={logInWithGoogle}
          >
            <span className="landing-head-last-long">
              {t("landing.head.logIn")}
            </span>
            <span className="landing-head-last-short">
              {t("landing.head.logInShort")}
            </span>
          </Button>
        )}
      </>
    ),
    onStart: withGoogle ? logInWithGoogle : withoutAccount,
    onWithoutAccount: withoutAccount,
    dialogs: (
      <>
        <Dialog
          open={problem !== null}
          title={t("auth.problemTitle")}
          lede={problem ? t(problem, { identity: VENDORS.identity }) : ""}
          confirmLabel={t("auth.tryAgain")}
          onConfirm={logInWithGoogle}
          onCancel={() => setProblem(null)}
        >
          {null}
        </Dialog>
        <Dialog
          open={farewell !== null}
          title={t("auth.farewellTitle")}
          lede={farewell ? t(farewell, { identity: VENDORS.identity }) : ""}
          confirmLabel={t("confirm.done")}
          cancelHidden
          onConfirm={() => setFarewell(null)}
          onCancel={() => setFarewell(null)}
        >
          {null}
        </Dialog>
        <Dialog
          open={noFolders}
          title={t("landing.noFolders.title")}
          confirmLabel={t(
            withGoogle ? "landing.head.logIn" : "landing.hero.try",
          )}
          onConfirm={() => {
            setNoFolders(false);
            if (withGoogle) logInWithGoogle();
            else void navigate(DEMO_PATH);
          }}
          onCancel={() => setNoFolders(false)}
        >
          <DialogText
            lead={t("landing.noFolders.lead")}
            items={NO_FOLDERS_BROWSERS}
            after={
              withGoogle
                ? [
                    t("landing.noFolders.signIn", {
                      identity: VENDORS.identity,
                    }),
                  ]
                : []
            }
          />
          {withGoogle ? (
            <Link to={DEMO_PATH} className="ui-text-link ui-text-link-ink">
              {t("landing.noFolders.demo")}
            </Link>
          ) : null}
        </Dialog>
      </>
    ),
  };
}
