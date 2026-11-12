// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef } from "react";
import { syncProfile } from "../../profile/profileSync";

// How long the reveal waits on the reconciliation before revealing anyway, in
// milliseconds: a verdict that never arrives must not hang the overlay.
// `syncProfile` is best-effort elsewhere; here it gates a visible reveal,
// so it gets its own ceiling.
const VERDICT_TIMEOUT_MS = 5000;

// The settle wait's own fail-open ceiling, in milliseconds: a gather queued
// and then superseded before it ever runs has no settle. Shorter than
// `VERDICT_TIMEOUT_MS`, because the wait is local work.
const SETTLE_TIMEOUT_MS = 2000;

interface Repaint {
  reconcileUI: () => void;
  rescan: () => void;
  refreshContent: () => void;
}

/**
 * Runs the reconciliation without gating anything, and repaints what it
 * delivers: the prefs always, then a rescan for a membership change or the
 * in-place content refresh otherwise. `repaint` is read when the pull
 * settles, so the latest callbacks run.
 */
function bridge(userId: string, repaint: { readonly current: Repaint }): void {
  void syncProfile(userId)
    .then(({ librarySettled, membershipChanged }) => {
      if (!librarySettled) return;
      repaint.current.reconcileUI();
      if (membershipChanged) repaint.current.rescan();
      else repaint.current.refreshContent();
    })
    .catch(() => {
      // Best-effort, as on the empty-mirror path; the next trigger tries
      // again.
    });
}

interface Options {
  userId: string;
  /**
   * Whether the membership mirror was empty at `Library`'s first render; the
   * one fact this hook acts on.
   */
  mirrorEmpty: boolean;
  /**
   * `useProjects`'s gather accounting, which its `ProjectsShelf` docblock
   * explains: settles land in start order, so waiting for settle number
   * starts + 1 fires on the rescan's own gather.
   */
  gatherStarts: number;
  gatherSettles: number;
  /**
   * Re-runs the gather after the pull changed membership, so the shelf repaints
   * under the overlay.
   */
  rescan: () => void;
  /**
   * Re-applies the mirror's card content onto the painted cards, for a
   * settled pull whose membership did not change. Idempotent, repainting
   * nothing that draws the same, so the bridge runs it unconditionally.
   */
  refreshContent: () => void;
  /**
   * Re-reads the profile's prefs (theme, language, view state) into the
   * visible React state once the pull has settled, on the chain the shelf
   * already runs. Idempotent; never blocks the reveal.
   */
  reconcileUI: () => void;
  /** `SessionGateContext`'s callback, called exactly once. */
  reportDataReady: () => void;
}

/**
 * The verdict `SessionGate`'s overlay waits on, from the profile's answer.
 * A non-empty mirror already answers whether the account has
 * anything, so the reveal fires at once. The reconciliation still runs
 * (`SessionGate` also starts `syncProfile`, and the single-flight makes
 * both calls one chain), and a membership change it delivers is bridged to a
 * re-gather, but the reveal does not wait on it.
 *
 * An empty mirror is ambiguous: a new account, or an existing one this
 * device has not adopted anything onto yet (after `purgeOtherUsersLocalData`
 * swept a previous user, or a first sign-in on a fresh browser). Only the
 * profile copy can tell them apart, so the hook waits for `syncProfile`'s
 * library half:
 *
 * - Settled with no membership change: `reconcileUI` and `refreshContent`
 *   run and the reveal reports at once.
 * - Settled with a membership change: `rescan()` repaints the shelf from the
 *   fresh mirror, and the report waits for the rescan's gather to settle
 *   (settle number starts + 1, a new value every settle, so batching cannot
 *   skip it). The reveal never lands on a shelf about to gain its cards.
 * - Never settled (the pull failed): the timeout reports anyway,
 *   failing open.
 *
 * The hook never touches card state. The gather is the one painter and this
 * gate only asks it to run again; nothing here adopts, so nothing races the
 * gather's candidate reset.
 */
export function useLibraryReveal({
  userId,
  mirrorEmpty,
  gatherStarts,
  gatherSettles,
  rescan,
  refreshContent,
  reconcileUI,
  reportDataReady,
}: Options): void {
  const repaintRef = useRef<Repaint>({ reconcileUI, rescan, refreshContent });
  repaintRef.current = { reconcileUI, rescan, refreshContent };
  const reportRef = useRef(reportDataReady);
  reportRef.current = reportDataReady;
  // True from the pull reporting a membership change until the rescan's own
  // gather settles: the bridge between the reconciliation and the painter.
  // A ref, because the settle effect reads the flag and nothing re-renders.
  const awaitingSettle = useRef(false);
  // The settle number the gate waits for, captured at rescan time as
  // starts + 1. The one start without a settle is a closure overwritten in
  // the pending slot before it ran, which the fail-open bound covers.
  const awaitingFrom = useRef(0);
  // The settle wait's fail-open timer: armed with
  // `awaitingSettle`, cleared when it resolves or on unmount. `null` while
  // no wait is in flight.
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrored every render: the settled handler runs in an effect whose
  // closure captured mount-time props, and the rescan needs the latest
  // count.
  const startsRef = useRef(gatherStarts);
  startsRef.current = gatherStarts;

  useEffect(() => {
    if (!userId) return;
    if (!mirrorEmpty) {
      // The mirror is the answer, so the reveal fires now; what the
      // reconciliation delivers is bridged without gating it.
      reportRef.current();
      bridge(userId, repaintRef);
      return;
    }

    let alive = true;
    const timeout = setTimeout(() => {
      if (!alive) return;
      alive = false;
      reportRef.current();
    }, VERDICT_TIMEOUT_MS);

    syncProfile(userId)
      .then(({ librarySettled, membershipChanged }) => {
        if (!alive) return;
        alive = false;
        clearTimeout(timeout);
        if (librarySettled) {
          repaintRef.current.reconcileUI();
          if (membershipChanged) {
            // The shelf is about to gain or lose cards: repaint first, and
            // reveal after the rescan's own gather settles.
            awaitingSettle.current = true;
            awaitingFrom.current = startsRef.current + 1;
            settleTimeoutRef.current = setTimeout(() => {
              if (!awaitingSettle.current) return;
              awaitingSettle.current = false;
              settleTimeoutRef.current = null;
              reportRef.current();
            }, SETTLE_TIMEOUT_MS);
            repaintRef.current.rescan();
            return;
          }
        }
        // Settled and unchanged, or the library half never settled, which
        // the timeout also covers: the shelf is already what it will be.
        reportRef.current();
      })
      .catch(() => {
        // The merge does not reject in practice, because it reports a Remote
        // Storage failure in the sync state; a rejection still reveals.
        if (!alive) return;
        alive = false;
        clearTimeout(timeout);
        reportRef.current();
      });

    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [userId, mirrorEmpty]);

  // The bridge's second half: the reveal waits for the rescan's own gather
  // to settle. The counter changes on every settle, so this fires once per
  // `awaitingSettle` window, and a settle below `awaitingFrom` belongs to a
  // gather started before the rescan.
  useEffect(() => {
    if (!awaitingSettle.current) return;
    if (gatherSettles < awaitingFrom.current) return;
    awaitingSettle.current = false;
    if (settleTimeoutRef.current !== null) {
      clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = null;
    }
    reportRef.current();
  }, [gatherSettles]);

  // Unmount only: a settle wait in flight when the shelf unmounts must not
  // fire `reportDataReady` later for a gone component.
  useEffect(
    () => () => {
      if (settleTimeoutRef.current !== null) {
        clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = null;
      }
    },
    [],
  );
}
