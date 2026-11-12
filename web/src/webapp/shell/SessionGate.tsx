// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../../auth/AuthContext";
import { purgeOtherUsersLocalData } from "../../profile/forgetAccount";
import { syncProfile } from "../../profile/profileSync";
import { accountIds } from "../../writers/registry";
import LoginSplash from "../entry/LoginSplash";
import AppBoot from "./AppBoot";

/** What `Library` reads via `useOutletContext()`. */
export interface SessionGateContext {
  /**
   * Whether the loading overlay has begun revealing what is underneath.
   * `Library` starts any one-shot entrance animation (the welcome-back
   * greeting's typewriter) on this rather than on mount: `Library` mounts and
   * starts its gather well before the overlay lifts, so an ungated animation
   * would play unseen and the writer would see only its finished state.
   * Cards hydrate synchronously from cache on the first render, and a loading
   * shimmer looks the same whenever it started, so only the greeting needs
   * this.
   */
  revealed: boolean;
  /**
   * `Library` calls this once, when its own data verdict is in: the cache
   * was already non-empty, or it was empty and `useLibraryReveal`'s profile
   * check has landed or failed open. `AppBoot` and `LoginSplash` combine it
   * with their minimum-hold floor before firing `onReveal`. Optional: a
   * `Library` rendered outside this route (a direct test render) gets a
   * no-op, the same way `revealed` falls back to `true` there.
   */
  reportDataReady?: () => void;
}

/**
 * The gate on every /app route.
 *
 * Nothing renders without a signed-in account, and every read is scoped to
 * the confirmed id by construction (`getCurrentUserId()`), so `Library`
 * mounts at once while two things run in the background:
 *   1. `purgeOtherUsersLocalData` wipes the local data of every id with no
 *      account record; accounts that signed out leaving their things keep
 *      theirs. It never touches the confirmed id's data, so it cannot race
 *      anything `Library` reads.
 *   2. `syncProfile` merges the account's profile with its other
 *      installations' copies while Remote Storage is connected.
 *
 * The loading UI (`AppBoot` or `LoginSplash`) is an overlay on the mounting
 * `Library`, never a timer alone. An empty mirror on a confirmed id is
 * ambiguous (`useLibraryReveal`), and `reportDataReady` carries its answer
 * back. Each overlay combines it with its own minimum-hold floor, because a
 * settle that flashes on and off reads as a glitch.
 */
export default function SessionGate() {
  const { status, user, markWelcomed } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [revealed, setRevealed] = useState(false);
  // For the splash, revealing starts the fade, and the overlay keeps
  // rendering until its animation finishes.
  const [splashDone, setSplashDone] = useState(false);
  const [dataReady, setDataReady] = useState(false);

  // Captured once, on this instance's first render. `location.state` lives in
  // `history.state`, which survives a reload of the same tab, so a live read
  // would replay `LoginSplash` on a plain refresh. The effect below clears
  // that history state, and the capture keeps the clearing from switching a
  // showing splash to `AppBoot` mid-animation.
  const [justLoggedIn] = useState(() => location.state?.justLoggedIn === true);
  // The splash plays on an account's first entry in this browser; a later
  // sign-in boots like a refresh. Captured with `justLoggedIn`, so marking
  // the account welcomed does not cut the splash it starts.
  const [splash] = useState(() => justLoggedIn && user?.welcomed !== true);
  // Read once, the same way: a live `location.pathname` dependency would
  // refire the effect below on every route change within /app, such as
  // opening Settings.
  const initialPathnameRef = useRef(location.pathname);

  useEffect(() => {
    if (!justLoggedIn) return;
    void navigate(initialPathnameRef.current, { replace: true, state: {} });
  }, [justLoggedIn, navigate]);

  useEffect(() => {
    if (splash) markWelcomed();
  }, [splash, markWelcomed]);

  // Mirrored, not depended on: `AuthContext.refresh()` replaces the whole
  // `user` object on an unchanged id (after a Settings change, say), and
  // depending on the object would replay the sweep and reset the overlay on
  // an ordinary refresh. The effect below depends on the stable `user?.id`
  // and reads the current object through this ref.
  const userRef = useRef(user);
  userRef.current = user;

  // The account the overlay was last armed for: only a new account replays
  // it.
  const armedFor = useRef<string | null>(null);

  useEffect(() => {
    const current = userRef.current;
    if (status !== "authenticated" || !current) return;
    const userId = current.id;
    if (armedFor.current !== userId) {
      armedFor.current = userId;
      setRevealed(false);
      setSplashDone(false);
    }
    // No `setDataReady(false)` here. `Library`'s `useLibraryReveal`, a child
    // through `Outlet`, can call `reportDataReady` synchronously in its mount
    // effect (a non-empty cache needs no round trip), and React fires child
    // effects before parent effects in the same commit. On the first
    // authenticated render a reset here would run after the child's and turn
    // a correct `true` back to `false`, which is the common case.
    // `dataReady` already starts `false`. Sign-out and sign-in go through the
    // anonymous redirect first, which unmounts this component and resets all
    // its state.
    void purgeOtherUsersLocalData(
      userId,
      ...accountIds().filter((id) => id !== userId),
    ).catch(() => {
      // Best-effort, like every local-data-clearing call: a record that
      // fails to clear does not block the shelf.
    });
    void syncProfile(userId).catch(() => {
      // Best-effort: a failed profile sync does not block the shelf, and
      // `Library`'s reconciliation picks up the change whenever it lands.
    });
  }, [status, user?.id]);

  // The overlay must not wait for a verdict nobody will give. `dataReady`
  // comes from `Library` alone, and the editor route has no `Library` in the
  // tree, so without this a reload on a project would sit under the loading
  // overlay for ever. The editor holds at its own route and answers for
  // itself.
  //
  // Read live rather than captured: a writer who lands on the shelf and then
  // opens a project must not re-arm the overlay, and one who lands on a
  // project and returns to the shelf gets the shelf's gate on that mount.
  // Case-blind, as the router matches: `/App/Project/<id>` mounts the editor.
  const shelfIsMounting = !location.pathname
    .toLowerCase()
    .startsWith("/app/project/");

  const onReveal = useCallback(() => setRevealed(true), []);
  const onSplashFinished = useCallback(() => setSplashDone(true), []);
  const reportDataReady = useCallback(() => setDataReady(true), []);

  if (status === "anonymous") return <Navigate to="/" replace />;

  const showOverlay = splash ? !splashDone : !revealed;

  return (
    <>
      <Outlet
        context={{ revealed, reportDataReady } satisfies SessionGateContext}
      />
      {showOverlay &&
        (splash ? (
          <LoginSplash
            onReveal={onReveal}
            onFinished={onSplashFinished}
            dataReady={dataReady || !shelfIsMounting}
          />
        ) : (
          <AppBoot
            onReveal={onReveal}
            dataReady={dataReady || !shelfIsMounting}
          />
        ))}
    </>
  );
}
