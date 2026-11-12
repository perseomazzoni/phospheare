// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The port between the shared application and the identity service it
// needs. Everything about Google authorization, credential custody and the
// writer session binding goes through `Platform`; the application never
// fetches `/identity/` itself. `docs/identity-contract.md` holds the wire
// contracts.

/**
 * How credentials kept for a writer are protected at rest. `sealed` is a
 * cookie the identity service seals and alone opens, for the writer's
 * session with its proof; `unavailable`, when that service does
 * not answer, keeps them in this tab's memory only.
 */
export type CredentialProtection = "sealed" | "unavailable";

/**
 * A Google identity as Google's token endpoint vouched for it. `sub` is the
 * stable account id and the only field identity is ever matched on; the
 * email and name are labels.
 */
export interface GoogleIdentity {
  iss: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

/** A Remote Storage grant held by the platform for one writer. */
export interface DriveGrant {
  connectionId: string;
  sub: string;
  email: string;
  scopes: string[];
}

export interface AccessToken {
  accessToken: string;
  /** Seconds, as Google reported them. */
  expiresIn: number;
}

/**
 * The refusal codes both platform implementations share. The application
 * maps each to its own copy; a platform's English message is never shown.
 */
export type PlatformErrorCode =
  | "no-session"
  | "writer-mismatch"
  | "account-mismatch"
  | "scope-missing"
  | "flow-session-mismatch"
  | "flow-expired"
  | "flow-failed"
  | "flow-cancelled"
  | "flow-busy"
  | "popup-blocked"
  | "no-connection"
  | "no-credential"
  | "grant-invalid"
  | "google-unreachable"
  | "google-refused"
  | "google-not-configured"
  | "unavailable";

export class PlatformError extends Error {
  constructor(
    readonly code: PlatformErrorCode,
    message: string = code,
    /** Seconds to wait before trying again, when the platform said. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export function isPlatformError(
  err: unknown,
  code?: PlatformErrorCode,
): err is PlatformError {
  return (
    err instanceof PlatformError && (code === undefined || err.code === code)
  );
}

/**
 * Secrets kept for the writer whose session is open. `set` reports whether
 * the value outlives this tab and session (`remembered`); with
 * `remember: false`, or when the platform cannot protect it, the value lives
 * in this tab's memory only.
 */
export interface CredentialVault {
  get(name: string): Promise<string | null>;
  set(
    name: string,
    value: string,
    options: { remember: boolean },
  ): Promise<{ remembered: boolean }>;
  delete(name: string): Promise<void>;
}

export interface Platform {
  /** How the vault keeps a remembered credential. */
  readonly credentialProtection: CredentialProtection;
  /**
   * Whether the identity service answers. Resolves `false`, and never
   * rejects, when it cannot be reached, is slow, or something else answers
   * in its place.
   */
  reachable(): Promise<boolean>;
  /**
   * Binds the platform's credential operations to `writerId`. Every token,
   * flow and vault call afterwards acts for that writer only.
   */
  openSession(writerId: string): Promise<void>;
  /**
   * Ends the binding; in-memory credentials of the writer are dropped. The
   * identity service's session ends too, unless `server` is false: the
   * browser holds one session cookie, which may already name another writer.
   */
  closeSession(options?: { server?: boolean }): Promise<void>;
  /**
   * Runs Google sign-in for the open writer and resolves the identity
   * Google's token endpoint returned. `loginHint` steers the account chooser
   * and checks nothing.
   */
  signInWithGoogle(request: {
    writerId: string;
    loginHint?: string;
  }): Promise<GoogleIdentity>;
  /**
   * Authorizes Remote Storage for the open writer. Refuses `account-mismatch`
   * when Google returns any account other than `expectedSub`, before anything
   * is kept.
   */
  connectDrive(request: {
    writerId: string;
    expectedSub: string;
    loginHint?: string;
  }): Promise<{ grant: DriveGrant; token: AccessToken }>;
  /** A fresh access token from the platform-held refresh credential. */
  driveAccessToken(request: { connectionId: string }): Promise<AccessToken>;
  /**
   * Drops the platform's refresh credential; `revoke` also asks Google to
   * end the grant.
   */
  disconnectDrive(request: {
    connectionId: string;
    revoke: boolean;
  }): Promise<{ revokedAtGoogle: boolean }>;
  readonly vault: CredentialVault;
}
