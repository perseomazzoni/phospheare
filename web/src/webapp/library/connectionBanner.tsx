// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Banner, Button } from "../../ui";
import type { IconName } from "../../ui/icons";
import type { SourceFilter } from "./libraryFilter";

// The connection banner states one storage cause once, above the shelf, rather
// than on every affected card. The three causes are three facts with
// three verbs, so they stay three instances of this component, never one
// generic provider banner that loses the cause's name.
//
// The shared grammar: an attention banner speaks only when its own store is in
// view (All or this store's filter) and only when cards are affected. The
// stabilized-facts gates (`driveResolved`, `localRootResolved`) stay at the
// call sites: before a verdict lands, "unset" is not a fact, and stating it
// would flash the banner on every refresh.

/** The store-in-view and something-behind rule the three banners share. */
export function connectionBannerVisible(
  filter: SourceFilter,
  connectionId: string,
  behind: boolean,
): boolean {
  return (filter === "all" || filter === connectionId) && behind;
}

export function ConnectionBanner({
  connectionId,
  filter,
  behind,
  icon,
  copy,
  actionLabel,
  onAction,
}: {
  connectionId: string;
  filter: SourceFilter;
  /** Whether any card is affected by the cause. */
  behind: boolean;
  icon: IconName;
  copy: string;
  actionLabel: string;
  onAction: () => void;
}) {
  if (!connectionBannerVisible(filter, connectionId, behind)) return null;
  return (
    <Banner
      tone="attention"
      icon={icon}
      action={
        // The one remedy of an attention state, in the shared ember variant,
        // like the editor dock's button for a lapsed key. The sync banner
        // keeps its outline pair, because its two choices are equal.
        <Button variant="attention" className="ui-btn-sm" onClick={onAction}>
          {actionLabel}
        </Button>
      }
    >
      {copy}
    </Banner>
  );
}
