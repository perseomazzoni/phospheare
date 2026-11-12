// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ModelFailure } from "../domain/types";

// What every call from this browser to a third party has in common: the three
// fetch controls, how the app names itself, how a vendor's refusal becomes the
// app's own failure, and how much of an answer is ever read. Shared, so no two
// adapters read the same answer two ways.
//
// A vendor's words never become a failure's message. An upstream error body
// is untrusted text of unbounded length that has been observed to echo the
// request, which carries a writer's prose and a bearer key. Only its
// status, and for a few statuses a fixed phrase or a field name, is read.

export const OPENROUTER_API = "https://openrouter.ai/api/v1";

/** Where the prose goes, as a bare host, for the destination and for copy. */
export const OPENROUTER_HOST = "openrouter.ai";

/**
 * The fetch options every third-party call carries, applied after the
 * caller's so no call site can override one; a test pins the order.
 *
 * - `credentials: "omit"`: no cookie of this origin's, nor any the vendor
 *   set, travels. The key is the one credential, in `Authorization`.
 * - `redirect: "error"`: a redirected call is not reaching the host it
 *   names, and following it would replay the body and the bearer elsewhere.
 * - `referrerPolicy: "no-referrer"`: a URL in this app names a project.
 */
export function directInit(
  init: Omit<RequestInit, "credentials" | "redirect" | "referrerPolicy">,
): RequestInit {
  return {
    ...init,
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  };
}

/** How the app names itself to the vendor: a title and, optionally, a page. */
export interface Attribution {
  title: string;
  /** The landing page, reduced to scheme, host, port and path before use. */
  referer?: string;
}

/**
 * A configured value made safe to put in a header: control characters out,
 * since one CRLF would split the request, and at most `max` characters.
 * Only Latin-1 survives, because `fetch` rejects a header value outside it
 * and every request would then fail before leaving. `null` when nothing is
 * left.
 */
export function headerText(value: string, max: number): string | null {
  const text = value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]+/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return text === "" ? null : text.slice(0, max).trimEnd();
}

/**
 * The landing page with only the parts that can carry nothing: scheme, host,
 * port and path. A query, a fragment or userinfo is discarded rather than
 * validated, because attribution has no use for them and an unused field is
 * room for a project's name to reach a vendor's dashboard. `null` for
 * anything that is not absolute http(s).
 */
export function refererUrl(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/** `X-Title`, and `HTTP-Referer` only when a page was given and survives. */
export function attributionHeaders(
  attribution: Attribution,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const title = headerText(attribution.title, 60);
  if (title !== null) headers["X-Title"] = title;
  const referer = refererUrl(attribution.referer);
  if (referer !== null) headers["HTTP-Referer"] = referer;
  return headers;
}

/**
 * `Retry-After` in seconds, only as a digit string of 1 to 3600. An hour is
 * past anything a writer waits through, and an absurd value is likelier a
 * misparse than an instruction. Carried as a fact; nothing sleeps on it.
 */
export function retryAfterSeconds(
  header: string | null | undefined,
): number | undefined {
  if (typeof header !== "string" || !/^\s*\d+\s*$/.test(header))
    return undefined;
  const seconds = Number(header.trim());
  return seconds > 0 && seconds <= 3600 ? seconds : undefined;
}

export const RETRYABLE = new Set<ModelFailure["code"]>([
  "connection",
  "resource-exhausted",
  "busy",
  // Both lift on their own. A used-up quota lasts until the next day, so it
  // is absent.
  "rate-limited",
  "model-busy",
  "timeout",
  "interrupted",
]);

/** The app's own sentence for each refusal, naming the remedy. */
const REFUSAL_MESSAGES: Partial<Record<ModelFailure["code"], string>> = {
  "not-configured": "No model provider is connected.",
  "key-expired": "The provider key has expired. Reconnect to mint a new one.",
  "credit-exhausted": "The provider account has no credit left.",
  "limit-reached":
    "The key has reached the spending limit set for it. Wait for it to reset, or get a new key.",
  "rate-limited":
    "Too many requests in a short time. Wait a moment, then try again.",
  "model-busy":
    "This model is busy right now. Try again shortly, or choose another model.",
  "quota-exhausted":
    "The provider's free requests for today are used up. Choose another model, or try again tomorrow.",
  connection: "The provider could not be reached.",
  timeout: "The provider stopped responding.",
  "no-private-host":
    "No host of this model promises not to keep or train on the text, so none received it. Choose another model.",
  "provider-rejected": "The provider turned the request down.",
  "context-too-large": "This conversation is too large to send.",
};

/** A refusal in the app's words, its retryability the code's. */
export function refusal(
  code: ModelFailure["code"],
  retryAfter?: number,
): ModelFailure {
  return {
    code,
    message: REFUSAL_MESSAGES[code] ?? "The provider turned the request down.",
    retryable: RETRYABLE.has(code),
    ...(retryAfter !== undefined ? { retryAfterMs: retryAfter * 1_000 } : {}),
  };
}

/**
 * At most `max` bytes of a body, decoded, and the rest left unread: the
 * reader is cancelled once the cap is reached, so a vendor that keeps
 * sending is cut off there. `over` says the body went past the cap. A read
 * the signal ends rejects, as the browser's own does.
 */
export async function readCapped(
  response: Response,
  max: number,
): Promise<{ text: string; over: boolean }> {
  if (!response.body) return { text: "", over: false };
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = [];
  let length = 0;
  let over = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length + value.length > max) {
        pieces.push(value.subarray(0, max - length));
        length = max;
        over = true;
        break;
      }
      pieces.push(value);
      length += value.length;
    }
  } finally {
    if (over) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const piece of pieces) {
    bytes.set(piece, offset);
    offset += piece.length;
  }
  return { text: new TextDecoder().decode(bytes), over };
}

/**
 * The head of a refusal's body, for the few facts a status alone cannot
 * tell: never logged, stored or returned. An unreadable body is the empty
 * string, so the status decides.
 */
export async function refusalHead(
  response: Response,
  max = 16_384,
): Promise<string> {
  try {
    return (await readCapped(response, max)).text;
  } catch {
    return "";
  }
}

/**
 * Whether a 404 is the vendor finding no host for the model under the
 * request's `data_collection: "deny"`. The vendor gives this refusal no
 * code, so its fixed wording in the first 4 KB is the only sign; a reworded
 * message falls back to `provider-rejected`, never to a wrong reason.
 */
export function namesDataPolicy(head: string): boolean {
  return /data policy/i.test(head.slice(0, 4_096));
}

/**
 * The names of the rate-limit headers a refusal carried: those the browser
 * may read, and those the vendor repeats inside its error body's
 * `error.metadata.headers`. Cross-origin, the browser exposes only the
 * headers the vendor lists in `Access-Control-Expose-Headers`, which leaves
 * out `X-RateLimit-*` and `Retry-After`, so the body is the second place to
 * look. Names and the one `Retry-After` value only; no message is read.
 */
export function refusalHints(
  response: Response,
  head: string,
): { rateLimitHeaders: boolean; retryAfter?: number } {
  let rateLimitHeaders = false;
  response.headers.forEach((_value, name) => {
    if (name.toLowerCase().startsWith("x-ratelimit-")) rateLimitHeaders = true;
  });
  let retryAfter = retryAfterSeconds(response.headers.get("Retry-After"));

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(head);
  } catch {
    // A truncated or non-JSON head names nothing.
  }
  const error =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { error?: unknown }).error
      : undefined;
  const metadata =
    typeof error === "object" && error !== null
      ? (error as { metadata?: unknown }).metadata
      : undefined;
  const headers =
    typeof metadata === "object" && metadata !== null
      ? (metadata as { headers?: unknown }).headers
      : undefined;
  if (
    typeof headers === "object" &&
    headers !== null &&
    !Array.isArray(headers)
  )
    for (const [name, value] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("x-ratelimit-")) rateLimitHeaders = true;
      if (lower === "retry-after" && retryAfter === undefined)
        retryAfter = retryAfterSeconds(
          typeof value === "number" ? String(value) : (value as string),
        );
    }

  return {
    rateLimitHeaders,
    ...(retryAfter !== undefined ? { retryAfter } : {}),
  };
}

/**
 * The vendor's HTTP refusal status as the app's code, before the 429 is told
 * apart. A 401 and a 403 are the key: the vendor answers 403 also for a
 * request its moderation flagged, and either way the remedy offered is a new
 * key, never a sign-out of the app. A 408 is the vendor giving up on a slow
 * request, which a second attempt may get through.
 */
export function codeForStatus(
  status: number,
  head: string,
): ModelFailure["code"] {
  if (status === 404 && namesDataPolicy(head)) return "no-private-host";
  if (status === 401 || status === 403) return "key-expired";
  if (status === 402) return "credit-exhausted";
  if (status === 408) return "timeout";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "connection";
  return "provider-rejected";
}

/** The refusals after which the account should read the key again. */
export function refusesKey(code: ModelFailure["code"]): boolean {
  return (
    code === "key-expired" ||
    code === "limit-reached" ||
    code === "credit-exhausted"
  );
}

/** Calls a hook and keeps its throw from turning an answer into one. */
export function safely<A extends unknown[]>(
  hook: ((...args: A) => void) | undefined,
  ...args: A
): void {
  try {
    hook?.(...args);
  } catch {
    // Bookkeeping, not the answer: the outcome stands.
  }
}

/** A thunk's value, or `null` when it throws or yields nothing usable. */
export async function keyFrom(
  apiKey: () => string | null | Promise<string | null>,
): Promise<string | null> {
  try {
    const key = await apiKey();
    return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The host's custody check, run before anything is sent. A throw is a check
 * that could not be made, and refuses: a key nobody could judge is not one
 * to spend.
 */
export async function custody(
  beforeSend:
    ((signal: AbortSignal) => Promise<ModelFailure | null>) | undefined,
  signal: AbortSignal,
): Promise<ModelFailure | null> {
  if (!beforeSend) return null;
  try {
    return await beforeSend(signal);
  } catch {
    return refusal("connection");
  }
}
