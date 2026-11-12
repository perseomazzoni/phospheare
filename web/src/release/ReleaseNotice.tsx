// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useTranslation } from "react-i18next";
import { Button, Icon } from "../ui";
import { releaseCheck } from "./compose";
import { versionLabel } from "./domain/version";
import type { Release, ReleaseCheck } from "./application/checkForRelease";

// "A new version is out. 1.3.0", and how to get it: said in the Library, in a card in the
// bottom corner, until the writer closes it for that release. The version is
// the link to the release's page.
//
// It uses a status notice's paint but not `StatusNotice` itself, which joins
// the column at the top: a release is news, not a status of the work, and it
// stands apart from the column.
//
// `attention`: nothing is wrong, and nothing needs doing now.
//
// Its words go into a permanent region `App` renders under this id, as
// `DemoNotice`'s do, because a region inserted with its first content is
// announced unreliably.

export const RELEASE_NOTICE_REGION_ID = "release-notice-region";

function useNewerRelease(check: ReleaseCheck | null): Release | null {
  const [release, setRelease] = useState<Release | null>(null);
  useEffect(() => {
    if (!check) return;
    // The ask is shared and outlives this mount; only its answer is dropped
    // once the Library is gone.
    let shown = true;
    check
      .newer()
      .then((found) => {
        if (shown) setRelease(found);
      })
      .catch(() => {});
    return () => {
      shown = false;
    };
  }, [check]);
  return release;
}

export default function ReleaseNotice({
  check = releaseCheck,
}: {
  check?: ReleaseCheck | null;
}) {
  const { t } = useTranslation();
  const found = useNewerRelease(check);
  const [closed, setClosed] = useState<string | null>(null);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  useEffect(
    () => setRegion(document.getElementById(RELEASE_NOTICE_REGION_ID)),
    [],
  );
  if (!check || !found || closed === found.tag) return null;

  const version = versionLabel(found.tag);
  return (
    <>
      <div className="status-notice release-notice" data-tone="attention">
        <span className="status-notice-dot" aria-hidden="true" />
        <span>
          <Trans
            i18nKey="release.notice"
            values={{ version }}
            components={{
              release: (
                <a
                  className="ui-text-link"
                  href={found.url}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              ),
            }}
          />
        </span>
        <Button
          variant="icon"
          className="status-notice-dismiss"
          aria-label={t("release.close")}
          onClick={() => {
            check.dismiss(found);
            setClosed(found.tag);
          }}
        >
          <Icon name="x" size={12} />
        </Button>
      </div>
      {region && createPortal(t("release.announce", { version }), region)}
    </>
  );
}
