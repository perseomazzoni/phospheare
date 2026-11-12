// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OPENROUTER_HOST } from "../../ai/adapters/directWire";
import { deliverCallback } from "../../ai/host/openrouterConnection";

// The approval window's own page, `/app/connect/:provider`.
//
// Opened by the tab that asked, it first says where the writer is going;
// that tab then sends it to the vendor's consent screen. The vendor sends it
// back here with `code` and `state`, which this page hands to the asking tab
// and forgets: the address is cleared before anything else, and the code is
// exchanged in the asking tab, the only place its verifier exists.
// This page holds no session, no key and no verifier.
//
// "Approved" is said only once the asking tab acknowledges the code, and the
// page closes itself only then. A return without a code is the writer
// declining at the vendor. Anything else stays on screen as lost, because a
// window that vanishes having done nothing reads as one that worked.

type Phase = "opening" | "handing" | "returned" | "declined" | "lost";

/** The vendor's answer in the address, read once. */
function readReturn(): { state: string; code: string | null } | null {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state");
  if (state === null) return null;
  return { state, code: params.get("code") };
}

export default function ConnectPopup() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("opening");

  // The answer is read and the address cleared in the same run, so a second
  // run of the effect (React's development remount) finds nothing to hand
  // on, and the code, which works once, is delivered once. The handover's
  // result is not tied to the run: a remount keeps this component's state.
  useEffect(() => {
    const answer = readReturn();
    if (!answer) return;
    window.history.replaceState(null, "", window.location.pathname);
    setPhase("handing");
    void deliverCallback(answer).then((acknowledged) =>
      setPhase(
        answer.code === null ? "declined" : acknowledged ? "returned" : "lost",
      ),
    );
  }, []);

  useEffect(() => {
    if (phase !== "returned") return;
    const timer = window.setTimeout(() => window.close(), 400);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "handing")
    return (
      <div className="page">
        <div className="page-inner narrow" aria-busy="true" />
      </div>
    );

  return (
    <div className="page">
      <div className="page-inner narrow">
        <h1 className="page-title">
          {phase === "opening"
            ? t("connect.workingTitle")
            : phase === "returned"
              ? t("connect.returnedTitle")
              : phase === "declined"
                ? t("connect.declinedTitle")
                : t("connect.failedTitle")}
        </h1>
        <p className="page-hint">
          {phase === "opening"
            ? t("connect.workingBody", { provider: OPENROUTER_HOST })
            : phase === "returned"
              ? t("connect.returnedBody")
              : phase === "declined"
                ? t("connect.declinedBody", { provider: OPENROUTER_HOST })
                : t("connect.lostBody")}
        </p>
        {phase !== "opening" && (
          <button
            type="button"
            className="ui-btn"
            onClick={() => window.close()}
          >
            {t("connect.close")}
          </button>
        )}
      </div>
    </div>
  );
}
