// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import StatusNotice from "./StatusNotice";
import Button from "./Button";
import { Icon } from "./icons";

// "Nothing here is saved": said each time the demo opens, since it mounts
// with the demo's route, until the visitor closes it. The demo site adds the
// program's download (`downloadUrl`); the full program's demo has none to
// give, as its writer already has the program.
//
// The pill shows one short line on a phone, where it lies over the chapter's
// title, and below 1080px on the desk, where it lies in the titlebar between
// its controls. The reset sentence and the download stand only on wider
// screens (`.demo-notice-more`), the download on a line of its own: the
// program runs on a computer, not on the phone. The spoken region always
// carries all of it.
//
// `attention`: nothing is wrong, and nothing is lost yet.
//
// The pill speaks through no region of its own (`StatusNotice`). Its words
// go into a permanent, empty region each root renders under this id, one
// render after the pill mounts, so a screen reader announces them like any
// other content arriving in a live region.

export const DEMO_NOTICE_REGION_ID = "demo-notice-region";

export default function DemoNotice({ downloadUrl }: { downloadUrl?: string }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(true);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  useEffect(
    () => setRegion(document.getElementById(DEMO_NOTICE_REGION_ID)),
    [],
  );
  if (!shown) return null;

  const spoken = [
    t("demoNotice.body"),
    t("demoNotice.reset"),
    ...(downloadUrl ? [t("demoNotice.download")] : []),
  ].join(" ");

  return (
    <>
      <StatusNotice
        tone="attention"
        className="demo-notice"
        action={
          <Button
            variant="icon"
            className="status-notice-dismiss"
            aria-label={t("demoNotice.close")}
            onClick={() => setShown(false)}
          >
            <Icon name="x" size={12} />
          </Button>
        }
      >
        <span>
          {t("demoNotice.body")}
          <span className="demo-notice-more">
            {" "}
            {t("demoNotice.reset")}
            {downloadUrl && (
              <>
                {" "}
                <a
                  className="ui-text-link"
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("demoNotice.download")}
                </a>
              </>
            )}
          </span>
        </span>
      </StatusNotice>
      {region && createPortal(spoken, region)}
    </>
  );
}
