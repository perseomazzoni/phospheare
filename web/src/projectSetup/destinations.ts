// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { driveProvider, localProvider } from "../storage";
import type { IconName } from "../ui";

// Where a new project can live. The creation wizard and the import window both
// ask, and must agree on whether the disk is a real destination, so the facts
// live here as data: which places exist, which is the default, whether the
// chosen one is usable, and what to say when none is.
//
// Data, not a component, because the import window's presentation may not
// import the web application (`editor/import/boundaries.test.ts`).
//
// Remote Storage when connected, Local when the browser can write the disk and
// a root is mapped. Without a mapped root the local destination shows disabled
// with its reason: the folder is a setup choice made in Settings, never asked
// by creation.

export type Destination = "local" | "drive";

/** What the shell knows about the two places, at the moment of asking. */
export interface DestinationFacts {
  driveConnected: boolean;
  /** The Google account's address, named under the Remote Storage pick. */
  email: string;
  /**
   * Whether this browser can hold a local root at all (false on Firefox and
   * Safari).
   */
  localAvailable: boolean;
  /** Whether a local root has been chosen. */
  localRootReady: boolean;
  /**
   * Whether Remote Storage can be connected: false without a Google account.
   */
  remoteAvailable: boolean;
}

export interface DestinationOption {
  id: Destination;
  icon: IconName;
  name: string;
  sub: string;
  disabled: boolean;
}

/**
 * The picks to draw, in order. Remote Storage is absent, not disabled, while it
 * is not connected: connecting is a Settings errand, and a dead card here would
 * be a dead-end Connect button.
 */
export function destinationOptions(
  facts: DestinationFacts,
  t: TFunction,
): DestinationOption[] {
  const local: DestinationOption = {
    id: "local",
    icon: localProvider.icon,
    name: localProvider.label(),
    sub: facts.localAvailable
      ? t(facts.localRootReady ? "create.localSub" : "create.localSubNoRoot")
      : t("library.diskUnsupported"),
    disabled: !facts.localAvailable || !facts.localRootReady,
  };
  if (!facts.driveConnected) return [local];
  return [
    local,
    {
      id: "drive",
      icon: driveProvider.icon,
      name: driveProvider.label(),
      sub: t("create.driveSub", { email: facts.email }),
      disabled: false,
    },
  ];
}

/**
 * The writer's own mapped root leads whenever it is real; Remote Storage leads
 * only when the disk is impossible.
 */
export function defaultDestination(facts: DestinationFacts): Destination {
  return facts.localAvailable && facts.localRootReady ? "local" : "drive";
}

/** Whether a creation may go to `destination` now; the gate on Continue. */
export function destinationUsable(
  destination: Destination,
  facts: DestinationFacts,
): boolean {
  return destination === "drive"
    ? facts.driveConnected
    : facts.localAvailable && facts.localRootReady;
}

/**
 * The note under the picks while Remote Storage is not connected, pointing at
 * Settings, where both places are set up; `null` when Remote Storage is
 * connected, or when the local folder is ready and Remote Storage cannot be
 * connected.
 */
export function destinationHintKey(facts: DestinationFacts): string | null {
  if (facts.driveConnected) return null;
  if (!facts.remoteAvailable)
    return facts.localRootReady ? null : "create.noDestinationHintLocal";
  return facts.localRootReady
    ? "create.connectDriveHint"
    : "create.noDestinationHint";
}
