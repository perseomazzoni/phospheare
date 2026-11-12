// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { dropSessionCredentials, identityVault } from "./identityVault";
import { openChannel } from "./channel";
import {
  IDENTITY_REQUEST_HEADER,
  IDENTITY_SESSION_HEADER,
  OAUTH_CHANNEL,
  GOOGLE_WINDOW,
} from "./identifiers";
import {
  forgetIdentityProof,
  keepIdentityProof,
  readIdentityProof,
} from "./identityProof";
import {
  PlatformError,
  isPlatformError,
  type AccessToken,
  type DriveGrant,
  type GoogleIdentity,
  type Platform,
  type PlatformErrorCode,
} from "./types";

// The platform: the identity service on this origin, whose `/identity/`
// routes hold the Google client secret and seal each Drive refresh token
// into an HttpOnly cookie on this browser. The SPA never sees a refresh
// token or the client secret; it receives access tokens, which it keeps in
// memory.
//
// Google's consent runs in a popup opened inside the writer's click, so the
// browser allows it. A blocked popup is refused as `popup-blocked`, never
// turned into a full-page redirect: this tab may be an editor holding
// unsaved prose, and the writer's next click opens the popup.
//
// Every call that uses the writer session carries the session proof the
// service answered when the session opened (`identityProof.ts`).

const BASE = "/identity";
const GOOGLE_HOST = "accounts.google.com";
/** Long enough to choose an account and read the consent screen. */
const FLOW_WAIT_MS = 10 * 60_000;
/** How often an open Google window is checked for having closed. */
const CLOSED_POLL_MS = 500;
/**
 * How long the reachability probe waits. On this computer the service answers
 * in milliseconds; a probe still open after this is a service that is down.
 */
const PROBE_MS = 3_000;

interface FlowFinish {
  identity?: GoogleIdentity;
  connection?: DriveGrant;
  accessToken?: string;
  expiresIn?: number;
}

interface FlowStart {
  flowId: string;
  authorizeUrl: string;
}

const CODES = new Set<PlatformErrorCode>([
  "no-session",
  "writer-mismatch",
  "account-mismatch",
  "scope-missing",
  "flow-session-mismatch",
  "flow-expired",
  "flow-failed",
  "flow-cancelled",
  "no-connection",
  "no-credential",
  "grant-invalid",
  "google-unreachable",
  "google-refused",
  "google-not-configured",
]);

/** The refusals after which a tab restates its binding and asks again. */
function rebinds(err: unknown): boolean {
  return (
    isPlatformError(err, "no-session") ||
    isPlatformError(err, "writer-mismatch")
  );
}

interface IdentityInit {
  method?: string;
  body?: unknown;
  /** The session proof, on a call that uses the writer session. */
  proof?: string | null;
  signal?: AbortSignal;
}

/** A refusal as the service wrote it, before it is read as a platform code. */
class Refusal {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly retryAfterSeconds: number | null,
  ) {}
}

/** Whether a 200 body is the session probe's: `{writerId}`, a string or null. */
function isSessionAnswer(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("writerId" in value))
    return false;
  const { writerId } = value as { writerId: unknown };
  return typeof writerId === "string" || writerId === null;
}

/**
 * The identity service's answer to one call, or the refusal it answered. A
 * service that cannot be reached, or that answers a page, rejects as
 * `unavailable`.
 */
async function identityAnswer<T>(
  path: string,
  init: IdentityInit,
): Promise<T | Refusal> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json, application/problem+json",
        [IDENTITY_REQUEST_HEADER]: "1",
        ...(init.proof ? { [IDENTITY_SESSION_HEADER]: init.proof } : {}),
        ...(init.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      redirect: "error",
      signal: init.signal,
    });
  } catch {
    throw new PlatformError(
      "unavailable",
      "The identity service could not be reached.",
    );
  }
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    // A static server answering its own page for this path is no identity
    // service.
    try {
      return (await response.json()) as T;
    } catch {
      throw new PlatformError(
        "unavailable",
        "The identity service did not answer.",
      );
    }
  }
  let body: { code?: unknown; retryAfterSeconds?: unknown } = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    // An unreadable refusal is still a refusal; the status decides.
  }
  return new Refusal(
    response.status,
    typeof body.code === "string" ? body.code : null,
    typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : null,
  );
}

/** Whether `refusal` carries one of the identity service's own codes. */
function knownCode(refusal: Refusal): PlatformErrorCode | null {
  return refusal.code !== null && CODES.has(refusal.code as PlatformErrorCode)
    ? (refusal.code as PlatformErrorCode)
    : null;
}

function refused(refusal: Refusal): PlatformError {
  // A refusal without a known code, a proxy's own error page included, is
  // the identity service being unavailable.
  return new PlatformError(
    knownCode(refusal) ?? "unavailable",
    `The identity service refused (${refusal.status}).`,
    refusal.retryAfterSeconds,
  );
}

async function identityFetch<T>(
  path: string,
  init: IdentityInit = {},
): Promise<T> {
  const answer = await identityAnswer<T>(path, init);
  if (answer instanceof Refusal) throw refused(answer);
  return answer;
}

/** `url` when it is Google's own consent page, the only place a flow goes. */
function googleAuthorizeUrl(url: string): string {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.host !== GOOGLE_HOST)
    throw new PlatformError(
      "flow-failed",
      "The consent address is not Google's.",
    );
  return target.href;
}

/**
 * Calls `onClosed` once the writer has closed `popup`, and answers the
 * function that stops watching.
 *
 * `closed` alone is not that answer. Google's pages send their own
 * Cross-Origin-Opener-Policy, which cuts this tab's handle, and `closed` then
 * reads true while the writer is still at Google. So the window counts as
 * closed only once this tab has the writer back as well: it has focus, and
 * the window reads closed. Focus is checked on its event and on every poll,
 * because `closed` can turn true a moment after focus returns.
 */
function watchClosed(popup: Window, onClosed: () => void): () => void {
  const check = () => {
    if (!document.hasFocus() || !popup.closed) return;
    stop();
    onClosed();
  };
  const timer = window.setInterval(check, CLOSED_POLL_MS);
  window.addEventListener("focus", check);
  function stop() {
    window.clearInterval(timer);
    window.removeEventListener("focus", check);
  }
  return stop;
}

/**
 * Resolves when the callback page reports `flowId`, through either channel it
 * posts on. Rejects `flow-cancelled` when `signal` aborts, and `flow-expired`
 * after `FLOW_WAIT_MS`.
 */
function awaitCallback(flowId: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let channel: BroadcastChannel | null = null;
    const done = (status: string | null, error?: PlatformError) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
      channel?.close();
      if (error) reject(error);
      else resolve(status ?? "failed");
    };
    const read = (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const message = data as {
        type?: unknown;
        flowId?: unknown;
        status?: unknown;
      };
      if (message.type !== OAUTH_CHANNEL || message.flowId !== flowId) return;
      done(typeof message.status === "string" ? message.status : "failed");
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      read(event.data);
    };
    const onAbort = () =>
      done(
        null,
        new PlatformError("flow-cancelled", "The flow was cancelled."),
      );
    const timer = window.setTimeout(
      () =>
        done(null, new PlatformError("flow-expired", "Google did not answer.")),
      FLOW_WAIT_MS,
    );
    if (signal.aborted) {
      onAbort();
      return;
    }
    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort);
    // Without a channel the opener message still arrives.
    channel = openChannel(OAUTH_CHANNEL);
    if (channel) channel.onmessage = (event: MessageEvent) => read(event.data);
  });
}

/**
 * Waits for the flow `popup` runs and answers what `finish` recorded.
 * Whatever status the callback reports, `finish` answers the outcome the
 * identity service sealed, refusal code included. A window the writer closed
 * is asked about too, since its callback may have run just before it
 * closed; a flow still pending then was abandoned at Google, and is
 * `flow-cancelled`.
 */
async function settleFlow(
  popup: Window,
  flowId: string,
  proof: () => string | null,
): Promise<FlowFinish> {
  const closed = new AbortController();
  const stopWatching = watchClosed(popup, () => closed.abort());
  try {
    await awaitCallback(flowId, closed.signal);
  } catch (err) {
    if (!closed.signal.aborted) throw err;
  } finally {
    stopWatching();
  }
  const answer = await identityAnswer<FlowFinish>(
    `/google/flows/${encodeURIComponent(flowId)}/finish`,
    { method: "POST", proof: proof() },
  );
  if (!(answer instanceof Refusal)) return answer;
  if (closed.signal.aborted && answer.code === "flow-pending")
    throw new PlatformError("flow-cancelled", "The Google window was closed.");
  throw refused(answer);
}

/**
 * Closes `popup` when `work` fails, so a session the service cannot open
 * leaves no blank window behind. A popup the callback already closed stays
 * closed.
 */
async function closingOnFailure<T>(
  popup: Window | null,
  work: Promise<T>,
): Promise<T> {
  try {
    return await work;
  } catch (err) {
    popup?.close();
    throw err;
  }
}

/** Opens the consent popup synchronously, inside the writer's gesture. */
function openPopup(): Window | null {
  try {
    return window.open("", GOOGLE_WINDOW, "popup,width=520,height=700");
  } catch {
    return null;
  }
}

export function identityFrom(finish: FlowFinish): GoogleIdentity {
  if (!finish.identity) throw new PlatformError("flow-failed");
  return finish.identity;
}

export function driveFrom(finish: FlowFinish): {
  grant: DriveGrant;
  token: AccessToken;
} {
  if (!finish.connection || typeof finish.accessToken !== "string")
    throw new PlatformError("flow-failed");
  return {
    grant: finish.connection,
    token: {
      accessToken: finish.accessToken,
      expiresIn: finish.expiresIn ?? 3600,
    },
  };
}

export function identityPlatform(): Platform {
  // The writer this tab binds, set the moment the binding is asked for, so
  // the vault answers for that writer while the identity service is still
  // confirming.
  let bound: string | null = null;
  // The identity service's confirmation of `bound`; every call awaits it,
  // so none races ahead of the session cookie it needs.
  let opened: Promise<void> | null = null;
  // Whether the identity service answered the last time it was asked; a
  // service that does not answer cannot keep a credential sealed.
  let answers = true;

  // Read at each call, never held: another tab of the origin that opened the
  // session again keeps the newer proof where this tab reads it.
  const proof = (): string | null =>
    bound === null ? null : readIdentityProof(bound);

  const bind = (writerId: string): Promise<void> => {
    const previous = bound;
    bound = writerId;
    const attempt = identityFetch<{ proof?: unknown } | undefined>("/session", {
      method: "POST",
      body: { writerId },
      proof: readIdentityProof(writerId),
    }).then((answer) => {
      if (typeof answer?.proof !== "string" || answer.proof === "")
        throw new PlatformError(
          "unavailable",
          "The identity service answered no session proof.",
        );
      answers = true;
      keepIdentityProof(writerId, answer.proof);
      // The browser holds one session cookie, and it now names `writerId`.
      if (previous !== null && previous !== writerId)
        forgetIdentityProof(previous);
    });
    opened = attempt;
    attempt.catch((err: unknown) => {
      if (isPlatformError(err, "unavailable")) answers = false;
      if (opened === attempt) opened = null;
    });
    return attempt;
  };

  const ensureSession = async (writerId: string) => {
    if (bound !== writerId || !opened) await bind(writerId);
    else await opened;
  };

  // An identity service restarted with a rotated key, cookies cleared, a
  // session past its thirty days, or another tab that bound the cookie to
  // another writer answers `no-session` or `writer-mismatch` for a session
  // this tab believes open: the binding is the tab's to restate, so it is
  // opened again once and the call retried.
  const withSession = async <T>(work: () => Promise<T>): Promise<T> => {
    if (bound !== null) await ensureSession(bound);
    try {
      return await work();
    } catch (err) {
      if (rebinds(err) && bound !== null) {
        await bind(bound);
        return work();
      }
      throw err;
    }
  };

  const beginFlow = (body: Record<string, unknown>) =>
    identityFetch<FlowStart>("/google/flows", {
      method: "POST",
      body,
      proof: proof(),
    });

  // A flow runs once, in the popup the writer's click opened. Only its start
  // is asked again after the binding is restated, while the popup is still
  // open and blank; a flow whose window has gone is never run again.
  const runFlow = (
    popup: Window | null,
    writerId: string,
    body: Record<string, unknown>,
  ): Promise<FlowFinish> =>
    closingOnFailure(
      popup,
      (async () => {
        if (!popup)
          throw new PlatformError(
            "popup-blocked",
            "The browser blocked the window.",
          );
        await ensureSession(writerId);
        let started: FlowStart;
        try {
          started = await beginFlow(body);
        } catch (err) {
          if (!rebinds(err)) throw err;
          await bind(writerId);
          started = await beginFlow(body);
        }
        popup.location.href = googleAuthorizeUrl(started.authorizeUrl);
        return settleFlow(popup, started.flowId, proof);
      })(),
    );

  const credentialPath = (name: string) =>
    `/credentials/${encodeURIComponent(name)}`;

  const vault = identityVault(() => bound, {
    keep: (name, value) =>
      withSession(() =>
        identityFetch(credentialPath(name), {
          method: "PUT",
          body: { value },
          proof: proof(),
        }),
      ),
    open: (name) =>
      withSession(() =>
        identityFetch<{ value?: unknown } | undefined>(
          `${credentialPath(name)}/open`,
          {
            method: "POST",
            proof: proof(),
          },
        ),
      ).then(
        (answer) => (typeof answer?.value === "string" ? answer.value : null),
        (err: unknown) => {
          if (isPlatformError(err, "no-credential")) return null;
          throw err;
        },
      ),
    forget: (writerId, name) =>
      identityFetch(credentialPath(name), {
        method: "DELETE",
        body: { writerId },
      }),
  });

  return {
    get credentialProtection() {
      return answers ? "sealed" : "unavailable";
    },
    // Asked without the session proof, the service answers `{writerId}`,
    // with `null` for no session: either says it is there, and so does any
    // refusal it writes with a code, `rate-limited` included. A page, other
    // JSON or an error from the proxy in front of it reads as unreachable,
    // as does a network error or a probe past `PROBE_MS`.
    async reachable() {
      try {
        const answer = await identityAnswer<unknown>("/session", {
          signal: AbortSignal.timeout(PROBE_MS),
        });
        answers =
          answer instanceof Refusal
            ? answer.code !== null
            : isSessionAnswer(answer);
      } catch {
        answers = false;
      }
      return answers;
    },
    async openSession(writerId) {
      if (bound === writerId && opened) await opened;
      else await bind(writerId);
    },
    async closeSession({ server = true } = {}) {
      const writerId = bound;
      bound = null;
      opened = null;
      if (writerId) {
        dropSessionCredentials(writerId);
        forgetIdentityProof(writerId);
      }
      if (!server) return;
      await identityFetch("/session", { method: "DELETE" }).catch(() => {
        // The cookie is bound to the writer session the SPA just ended; a
        // service that cannot be reached cannot refresh with it either.
      });
    },
    async signInWithGoogle({ writerId, loginHint }) {
      const popup = openPopup();
      return identityFrom(
        await runFlow(popup, writerId, {
          purpose: "identity",
          writerId,
          loginHint,
        }),
      );
    },
    async connectDrive({ writerId, expectedSub, loginHint }) {
      const popup = openPopup();
      return driveFrom(
        await runFlow(popup, writerId, {
          purpose: "drive",
          writerId,
          expectedSub,
          loginHint: loginHint ?? expectedSub,
        }),
      );
    },
    driveAccessToken({ connectionId }) {
      return withSession(async () => {
        const answer = await identityFetch<{
          accessToken: string;
          expiresIn: number;
        }>("/google/token", {
          method: "POST",
          body: { connectionId },
          proof: proof(),
        });
        return { accessToken: answer.accessToken, expiresIn: answer.expiresIn };
      });
    },
    async disconnectDrive({ connectionId, revoke }) {
      const answer = await withSession(() =>
        identityFetch<{ revokedAtGoogle?: boolean } | undefined>(
          `/google/connections/${encodeURIComponent(connectionId)}`,
          { method: "DELETE", body: { revoke }, proof: proof() },
        ),
      );
      return { revokedAtGoogle: answer?.revokedAtGoogle === true };
    },
    vault,
  };
}
