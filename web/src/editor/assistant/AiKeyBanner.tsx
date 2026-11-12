// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Banner, Button } from "../../ui";
import { formatWhen } from "../components/datetime";
import type { KeyVerdict } from "./keyVerdict";

/**
 * A fact and a verb, not an alarm. The key works right up to the moment it does
 * not, so this says what is true and offers the one action, and never blocks
 * the composer or interrupts a run. Past the end it keeps the same shape with
 * another sentence: a lapsed key is a different fact, not a more urgent one.
 *
 * The Library's attention banner, because a lapsed key is the same kind of fact
 * as a lapsed Remote Storage connection (recoverable, blocking, one remedy),
 * and the app says that kind of fact one way everywhere.
 *
 * One line about the key at a time, from the server's verdict: expired or spent
 * first, since it cannot answer, then what is worth saying before it stops.
 */
export default function AiKeyBanner({
  provider,
  verdict,
  onRenew,
}: {
  provider: string;
  verdict: KeyVerdict;
  onRenew: (provider: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const limit =
    verdict.limitUsd !== null ? `$${verdict.limitUsd.toFixed(2)}` : "";
  const button = (label: string) => (
    <Button
      variant="attention"
      className="ui-btn-sm"
      onClick={() => onRenew(provider)}
    >
      {t(label)}
    </Button>
  );
  if (verdict.state === "expired")
    return (
      <Banner tone="attention" action={button("dock.retry.renew")}>
        {t("dock.renewal.expired")}
      </Banner>
    );
  if (verdict.state === "limit-reached")
    return (
      <Banner tone="attention" action={button("dock.retry.newKey")}>
        {verdict.waitUntil
          ? t("dock.spend.reachedOrWait", {
              limit,
              date: formatWhen(verdict.waitUntil, i18n.language),
            })
          : t("dock.spend.reached", { limit })}
      </Banner>
    );
  if (verdict.notice === "expiring-soon")
    return (
      <Banner tone="attention" action={button("dock.retry.renew")}>
        {t("dock.renewal.soon")}
      </Banner>
    );
  // Nearly spent states the fact and offers nothing: there
  // is nothing to do yet.
  if (verdict.notice === "limit-mostly-used")
    return <Banner tone="attention">{t("dock.spend.most", { limit })}</Banner>;
  return null;
}
