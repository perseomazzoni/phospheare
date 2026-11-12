// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button } from "../../ui";
import type { DocumentStats } from "../../project/types";
import { driveProvider } from "../../storage";
import { elapsed } from "../../ui/relativeTime";

// The whole-project conflict banner. No per-file merge is offered, because
// none is attempted: the choice is which side to keep, informed by the data
// the Library reads for every card, word count and last-edited time, for both
// sides.
//
// A banner, not a dialog: it waits rather than blocking the shelf. Ignoring it
// leaves the project diverged as it was, checked again next time.

interface Props {
  name: string;
  localStats: DocumentStats | null;
  driveStats: DocumentStats | null;
  busy: boolean;
  onKeepLocal: () => void;
  onKeepDrive: () => void;
}

export default function SyncBanner({
  name,
  localStats,
  driveStats,
  busy,
  onKeepLocal,
  onKeepDrive,
}: Props) {
  const { t, i18n } = useTranslation();
  const number = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  );
  const ago = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }),
    [i18n.language],
  );

  const describe = (stats: DocumentStats | null): string => {
    if (!stats) return t("sync.unknownSide");
    const parts = elapsed(stats.countedAt, Date.now());
    const when = parts ? ago.format(parts.value, parts.unit) : null;
    return when
      ? t("sync.sideStats", { words: number.format(stats.words), when })
      : t("sync.sideWordsOnly", { words: number.format(stats.words) });
  };

  return (
    <Banner
      tone="attention"
      icon={driveProvider.icon}
      action={
        <div className="sync-banner-actions">
          <Button
            variant="outline"
            className="ui-btn-sm"
            disabled={busy}
            onClick={onKeepLocal}
          >
            {t("sync.keepLocal")}
          </Button>
          <Button
            variant="outline"
            className="ui-btn-sm"
            disabled={busy}
            onClick={onKeepDrive}
          >
            {t("sync.keepDrive")}
          </Button>
        </div>
      }
    >
      <div className="sync-banner-body">
        <strong>{t("sync.conflictTitle", { name })}</strong>
        <span className="sync-banner-side">
          {t("sync.thisComputer")}: {describe(localStats)}
        </span>
        <span className="sync-banner-side">
          {t("sync.googleDrive")}: {describe(driveStats)}
        </span>
      </div>
    </Banner>
  );
}

interface GoneProps {
  name: string;
  busy: boolean;
  onUnpair: () => void;
  onUploadAgain: () => void;
}

/**
 * The banner for a paired project whose Remote Storage copy is gone, deleted
 * or trashed. The device's copy is the one left, so neither choice touches it:
 * disabling sync keeps it as a plain local project, and uploading it again
 * makes a new remote copy and pairs with that.
 */
export function RemoteGoneBanner({
  name,
  busy,
  onUnpair,
  onUploadAgain,
}: GoneProps) {
  const { t } = useTranslation();
  return (
    <Banner
      tone="attention"
      icon={driveProvider.icon}
      action={
        <div className="sync-banner-actions">
          <Button
            variant="outline"
            className="ui-btn-sm"
            disabled={busy}
            onClick={onUnpair}
          >
            {t("library.unpair")}
          </Button>
          <Button
            variant="outline"
            className="ui-btn-sm"
            disabled={busy}
            onClick={onUploadAgain}
          >
            {t("sync.uploadAgain")}
          </Button>
        </div>
      }
    >
      <div className="sync-banner-body">
        <strong>{t("sync.goneTitle", { name })}</strong>
        <span className="sync-banner-side">{t("sync.goneBody")}</span>
      </div>
    </Banner>
  );
}
