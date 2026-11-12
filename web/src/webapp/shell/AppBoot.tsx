// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dots from "../../ui/Dots";

// The minimum time this stays up before revealing what mounts underneath,
// long enough that a fast settle (a warm reload with a cached shelf) reads
// as feedback rather than a flicker.
const MIN_HOLD_MS = 220;

interface Props {
  /** Called once, after both the minimum hold and `dataReady`, to reveal. */
  onReveal: () => void;
  /** Whether `Library`'s data verdict (`SessionGateContext`) is in. */
  dataReady: boolean;
}

/**
 * The quiet one of the two loading states: a reload, a new tab, anything
 * that is not the fresh-login navigation. Reveal and removal are the same
 * instant, unlike `LoginSplash`.
 *
 * Fires `onReveal` once `MIN_HOLD_MS` has elapsed and `dataReady` is true,
 * whichever settles last. With a non-empty cache `dataReady` is true almost
 * at once, so the floor is what a returning writer feels on a reload. With
 * an empty cache `Library`'s `useLibraryReveal` is still waiting on the sync,
 * and this waits for that verdict rather than revealing a shelf about to
 * change.
 */
export default function AppBoot({ onReveal, dataReady }: Props) {
  const { t } = useTranslation();
  const [floorElapsed, setFloorElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setFloorElapsed(true), MIN_HOLD_MS);
    return () => clearTimeout(timer);
  }, []);

  // Mirrored, so a fresh `onReveal` closure from a parent re-render retriggers
  // nothing; the reveal fires once, calling the latest closure.
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  // `floorElapsed` and `dataReady` flip independently, in either order, and
  // `onReveal` must still fire once.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || !floorElapsed || !dataReady) return;
    firedRef.current = true;
    onRevealRef.current();
  }, [floorElapsed, dataReady]);

  return (
    <div className="app-boot">
      <Dots label={t("app.loading")} />
    </div>
  );
}
