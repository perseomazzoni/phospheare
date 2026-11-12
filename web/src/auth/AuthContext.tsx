// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  PROFILE_UPLOAD_MS,
  purgeLocalData,
  settlesWithin,
} from "../profile/forgetAccount";
import { flushProfile } from "../profile/profileSync";
import { getCurrentUserId, setCurrentUserId } from "./currentUser";
import { writeOpenWork } from "./openWork";
import { announceSession, onSession } from "./sessionChannel";
import { onConnect } from "../ai/host/connectChannel";
import { currentPlatform, type Platform } from "../platform";
import { dropSessionCredentials } from "../platform/identityVault";
import {
  findWriter,
  removeWriter,
  setSignedIn,
  signedInWriter,
  subscribeWriters,
  writerRegistry,
} from "../writers/registry";
import type { WriterRecord } from "../writers/domain/writer";
import {
  enterWithoutGoogle,
  signInWithGoogle,
} from "../writers/application/signIn";
import { markWelcomed as recordWelcome } from "../writers/application/welcome";
import {
  forgetRemoteProviders,
  refreshRemoteProviders,
  openRouterStatus,
  subscribeRemoteProviders,
  type OpenRouterStatus,
} from "../ai/host/openrouterConnection";

// ── Who is signed in ─────────────────────────────────────────────────────────
//
// Each account that signed in to this browser has a record in
// `writers/registry.ts`, which marks the one signed in, so a reload knows the
// answer at once. Google sign-in runs in a popup through this
// computer's identity service (`platform/identityPlatform.ts`), which also
// holds the Drive credential; the account's model providers are kept in this
// browser.

/**
 * The least interval, in milliseconds, between re-reads of the providers on
 * returning to the tab. A writer back from waiting out a limit sees Try again
 * without reloading, and flicking between tabs is not a request each time.
 */
const TAB_REREAD_MS = 60_000;

/** How long a tab waits before trying again to write open work it must keep. */
const OPEN_WORK_RETRY_MS = 3_000;

/**
 * Writes the open work, then runs `next`. While the write fails it tries
 * again every few seconds, so the text is never dropped on the way out.
 */
function afterOpenWork(next: () => void): void {
  void writeOpenWork().then((preserved) => {
    if (preserved) next();
    else window.setTimeout(() => afterOpenWork(next), OPEN_WORK_RETRY_MS);
  });
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  /**
   * Whether the account is a Google account. The account without Google has
   * no name, email or picture, and Remote Storage is not offered to it.
   */
  withGoogle: boolean;
  driveConnected: boolean;
  /** The Remote Storage account files land in; `null` if none. */
  driveEmail: string | null;
  /** Whether the account has had its login splash in this browser. */
  welcomed: boolean;
  /** Remote Storage was disconnected leaving settings and Library in it. */
  remoteCopiesKept: boolean;
  /**
   * The OpenRouter connection, connected or not, judged in this tab from the
   * vendor's own report on the writer's key; surfaces render it and
   * never derive one.
   */
  openRouter?: OpenRouterStatus;
}

/**
 * Where auth stands, known from the first render: the signed-in mark is
 * local, so there is no loading and no unreachable state.
 */
export type AuthStatus = "authenticated" | "anonymous";

interface SignInOptions {
  loginHint?: string;
}

/**
 * What a sign-out leaves, the same for both kinds of account: `"leave"`
 * keeps everything here for the account's next entry, its record included;
 * `"clean"` removes everything of the account from this browser, its record
 * included, as before its first entry.
 */
export type SignOutChoice = "leave" | "clean";

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  /**
   * Whether Google sign-in can be offered: the identity service answered
   * (`true`) or did not (`false`), or `null` while it has not been asked or
   * has not answered yet. It is asked once, the first time the page is signed
   * out, and the answer stands for the life of the page.
   */
  signInReachable: boolean | null;
  /**
   * Signs in with Google in a popup, which must open inside the click that
   * calls this. A Google account new to this browser gets its record here.
   * `loginHint` names the account to preselect. Rejects with the platform's
   * refusal (`PlatformError`) when sign-in did not complete.
   */
  logIn: (options?: SignInOptions) => Promise<void>;
  /** Enters as this browser's account without Google, made the first time. */
  enterWithoutAccount: () => void;
  /** Re-reads the account and what the providers report for it. */
  refresh: () => Promise<void>;
  /** Records that the signed-in account has had its login splash. */
  markWelcomed: () => void;
  /** Signs out, leaving the account's things here or cleaning them away. */
  signOut: (choice: SignOutChoice) => Promise<void>;
}

function toUser(writer: WriterRecord): AuthUser {
  return {
    id: writer.id,
    name: writer.google?.name ?? "",
    email: writer.google?.email ?? "",
    avatarUrl: writer.google?.picture ?? null,
    withGoogle: writer.google !== null,
    driveConnected: writer.drive !== null,
    driveEmail: writer.drive?.email ?? null,
    welcomed: writer.welcomedAt !== null,
    remoteCopiesKept: writer.remoteCopiesKept,
    openRouter: openRouterStatus(writer.id),
  };
}

/**
 * The account a tab boots with, set on `currentUser.ts` before the first
 * render so nothing below the account boundary renders without it.
 */
function bootAccount(): string | null {
  const id = signedInWriter()?.id ?? null;
  setCurrentUserId(id);
  return id;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [platform] = useState<Platform>(currentPlatform);

  // The account is two stores of one fact: `userId`, which the screen
  // renders, and the id in `currentUser.ts`, which everything below the
  // account boundary is bound to (the prefs drain, the library, the theme's
  // repaint). They are written together, only here. Moving one alone lets a
  // tab show account B while it files work under A.
  // `setCurrentUserId` ignores an id it already holds, so re-reading the same
  // account wakes no per-user store below.
  const [userId, setUserId] = useState<string | null>(bootAccount);
  const adopt = useCallback((next: string | null) => {
    setUserId(next);
    setCurrentUserId(next);
  }, []);
  const status: AuthStatus = userId ? "authenticated" : "anonymous";

  const readRecord = useCallback(
    () => (userId ? findWriter(userId) : null),
    [userId],
  );
  const record = useSyncExternalStore(subscribeWriters, readRecord, readRecord);
  const [providersTick, setProvidersTick] = useState(0);
  useEffect(
    () => subscribeRemoteProviders(() => setProvidersTick((n) => n + 1)),
    [],
  );
  const user = useMemo(
    () => (record ? toUser(record) : null),
    // `providersTick` stands for the store `toUser` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, providersTick],
  );

  // Set while this tab is ending the session itself, from before the
  // announcement until the account is cleared. It stops this tab acting on
  // its own broadcast: a second channel object in the same tab hears what the
  // first posts, and a second purge would run under an account the first is
  // about to clear.
  const ending = useRef(false);

  // Asked once and kept, so a Google button that appeared never goes away
  // while the page is open. A signed-in page has no use for the answer.
  const [signInReachable, setSignInReachable] = useState<boolean | null>(null);
  const probed = useRef(false);
  useEffect(() => {
    if (status !== "anonymous" || probed.current) return;
    probed.current = true;
    void platform.reachable().then(setSignInReachable);
  }, [platform, status]);

  const statusRef = useRef(status);
  useLayoutEffect(() => {
    statusRef.current = status;
  }, [status]);

  // The identity service's session follows the account, so every token and
  // vault call acts for it only.
  useEffect(() => {
    if (!userId) return;
    void platform.openSession(userId).catch(() => {
      // A service that cannot be reached fails its token calls on their own;
      // writing does not need it.
    });
    void refreshRemoteProviders(userId, platform);
  }, [platform, userId]);

  // What a sign-out clears, in order, once its caller has written the work
  // open in an editor: the profile copy's pending changes, then the purge
  // (while `userId` is still current, as `purgeLocalData` requires), then
  // the credentials, then the account. None of these throws. The pending
  // changes get a bounded wait, so a sync that hangs cannot keep the account
  // signed in. `"leave"` skips the purge and drops only the credentials held
  // for the session, so the remembered key is there at the next entry.
  //
  // The record goes with a clean: a record is what tells the sweep at the
  // next entry that an account left its things here, and a cleaned account
  // left nothing. A Google account is found again by its Google id at its
  // next sign-in.
  const clearAccount = useCallback(
    async (id: string, choice: SignOutChoice) => {
      const clean = choice === "clean";
      await settlesWithin(flushProfile(), PROFILE_UPLOAD_MS);
      if (clean) await purgeLocalData(id);
      forgetRemoteProviders(id);
      if (clean) await platform.vault.delete("openrouter.key").catch(() => {});
      dropSessionCredentials(id);
      // A tab that clears late, after another tab already signed in as
      // someone else, leaves the identity service's session to that account.
      await platform
        .closeSession({ server: signedInWriter() === null })
        .catch(() => {});
      if (clean) removeWriter(id);
      adopt(null);
    },
    [adopt, platform],
  );

  const enter = useCallback(
    (writer: WriterRecord) => {
      setSignedIn(writer.id);
      adopt(writer.id);
      // A tab holding another account reloads.
      announceSession({ kind: "signed-in", userId: writer.id });
    },
    [adopt],
  );

  const logIn = useCallback(
    async ({ loginHint }: SignInOptions = {}) => {
      enter(
        await signInWithGoogle(
          platform,
          writerRegistry,
          loginHint ? { loginHint } : {},
        ),
      );
    },
    [enter, platform],
  );

  const enterWithoutAccount = useCallback(() => {
    enter(enterWithoutGoogle(writerRegistry));
  }, [enter]);

  const markWelcomed = useCallback(() => {
    if (userId) recordWelcome(writerRegistry, userId, new Date());
  }, [userId]);

  const lastRead = useRef(0);
  const refresh = useCallback(async () => {
    const id = getCurrentUserId();
    if (!id) return;
    lastRead.current = Date.now();
    await refreshRemoteProviders(id, platform);
  }, [platform]);

  // ── The key verdict ────────────────────────────────────────────────────────
  //
  // The provider's verdict on a key changes without this tab acting in two
  // ways, each of which re-reads it:
  //
  // - a connection finished in another tab (its ping);
  // - time passed while the writer was away: a limit reset, a key lapsed.
  //   Returning to the tab re-reads at most once a minute, so a writer who
  //   waited for a reset comes back to Try again without reloading.
  useEffect(() => {
    if (status !== "authenticated") return undefined;
    lastRead.current = Date.now();
    const unsubscribe = onConnect((signal) => {
      // Re-read on success only; a failure has nothing new to read.
      if (signal.ok) void refresh();
    });
    const returned = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRead.current < TAB_REREAD_MS) return;
      void refresh();
    };
    document.addEventListener("visibilitychange", returned);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", returned);
    };
  }, [status, refresh]);

  // ── Another tab signed out or in ───────────────────────────────────────────
  //
  // The signed-in mark is shared, so when one tab signs out every tab is
  // signed out. Each clears itself as the sender did, leaving or cleaning,
  // instead of trusting the sender's purge to cover it: the latch that
  // refuses cache writes after a purge is per tab, so this tab could
  // otherwise write back a working-copy file the sender just deleted.
  //
  // A sign-out counts only for the account this tab holds, and not while
  // this tab is ending the session itself. A sign-in for another account
  // reloads the tab, never switching under a mounted editor: the old
  // account's work is written on the way out. Either way, open work that
  // cannot be written yet is tried again until it is.
  //
  // A page restored from the back-forward cache missed every message while
  // it was frozen, so on its return the signed-in mark says whether it still
  // holds this account.
  //
  // The clear waits for the open work, which can take retries. If the same
  // account is signed in again meanwhile, the signed-in mark says so just
  // before the clear, and the tab keeps it instead of purging a live session.
  //
  // A signed-out tab reloads into an account that signs in elsewhere, so it
  // does not sit on the landing while the others hold the account. The tab
  // that signed in hears its own announcement through a second channel
  // object, and already holds that account.
  useEffect(() => {
    const reload = () => afterOpenWork(() => window.location.assign("/app"));
    if (!userId)
      return onSession((signal) => {
        if (signal.kind !== "signed-in") return;
        if (getCurrentUserId() !== signal.userId) reload();
      });
    const close = (choice: SignOutChoice): void => {
      ending.current = true;
      afterOpenWork(() => {
        if (signedInWriter()?.id === userId) {
          ending.current = false;
          return;
        }
        void clearAccount(userId, choice).finally(() => {
          ending.current = false;
          // A sign-in elsewhere while this tab was clearing was not heard:
          // the tab follows it rather than sit signed out.
          const now = signedInWriter()?.id;
          if (now && now !== userId) reload();
        });
      });
    };
    const unsubscribe = onSession((signal) => {
      if (statusRef.current !== "authenticated" || ending.current) return;
      if (signal.kind === "signed-in") {
        if (signal.userId !== userId) reload();
        return;
      }
      if (signal.userId !== userId || getCurrentUserId() !== userId) return;
      close(signal.kind === "left" ? "leave" : "clean");
    });
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted || ending.current) return;
      const now = signedInWriter()?.id ?? null;
      if (now === userId) return;
      if (now) reload();
      // A record still here was left; a cleaned one is gone.
      else close(findWriter(userId) ? "leave" : "clean");
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      unsubscribe();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [userId, clearAccount]);

  const signOut = useCallback(
    async (choice: SignOutChoice) => {
      if (!userId) return;
      // Nothing changes until the open work is written: a sign-out that
      // cannot keep it stops here, still signed in.
      if (!(await writeOpenWork()))
        throw new Error("Open work could not be preserved.");
      ending.current = true;
      try {
        setSignedIn(null);
        // Before this tab's own purge, so the others clear alongside it.
        announceSession({
          kind: choice === "leave" ? "left" : "signed-out",
          userId,
        });
        await clearAccount(userId, choice);
      } finally {
        ending.current = false;
      }
    },
    [userId, clearAccount],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      signInReachable,
      logIn,
      enterWithoutAccount,
      refresh,
      markWelcomed,
      signOut,
    }),
    [
      user,
      status,
      signInReachable,
      logIn,
      enterWithoutAccount,
      refresh,
      markWelcomed,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
}
