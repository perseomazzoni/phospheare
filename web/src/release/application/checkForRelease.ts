// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { newerRelease } from "../domain/version";

// The feed is asked at most once a day per device, as the privacy notice
// says. A failed ask counts as the day's ask too: a feed that refuses or
// cannot be reached is not asked again on every visit to the Library. Callers
// that ask while an ask is in flight share it, so a Library that mounts twice
// asks once.

/** A published release: its tag (`v1.2.0`) and the page that offers it. */
export interface Release {
  tag: string;
  url: string;
}

/** Where the newest published release is read. */
export interface ReleaseFeed {
  /**
   * The newest release, or `null` when none is published.
   *
   * @throws when the feed cannot be reached, does not answer in time, or
   *   answers something unreadable.
   */
  latest(): Promise<Release | null>;
}

/** What this device remembers between visits. */
export interface ReleaseMemory {
  /** The last time the feed was asked and what it answered, or `null`. */
  lastCheck(): { at: number; release: Release | null } | null;
  /** Records an ask at `at` (epoch milliseconds) and its answer. */
  rememberCheck(at: number, release: Release | null): void;
  /** The tag the writer closed the notice for, or `null`. */
  dismissed(): string | null;
  dismiss(tag: string): void;
}

export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export interface ReleaseCheckDependencies {
  feed: ReleaseFeed;
  memory: ReleaseMemory;
  /** The version this build runs. */
  current: string;
  now: () => number;
}

export interface ReleaseCheck {
  /** The release to offer, or `null` when there is none to offer. */
  newer(): Promise<Release | null>;
  /** Stops offering `release`; a later release is offered again. */
  dismiss(release: Release): void;
}

export function createReleaseCheck({
  feed,
  memory,
  current,
  now,
}: ReleaseCheckDependencies): ReleaseCheck {
  let asking: Promise<Release | null> | null = null;

  async function ask(at: number): Promise<Release | null> {
    let release: Release | null = null;
    try {
      release = await feed.latest();
    } finally {
      memory.rememberCheck(at, release);
    }
    return release;
  }

  function latest(): Promise<Release | null> {
    const last = memory.lastCheck();
    const at = now();
    if (last && at - last.at >= 0 && at - last.at < CHECK_EVERY_MS)
      return Promise.resolve(last.release);
    asking ??= ask(at)
      .catch(() => null)
      .finally(() => {
        asking = null;
      });
    return asking;
  }

  return {
    async newer() {
      const release = await latest();
      if (!release) return null;
      if (!newerRelease(release.tag, current).newer) return null;
      return memory.dismissed() === release.tag ? null : release;
    },
    dismiss(release) {
      memory.dismiss(release.tag);
    },
  };
}
