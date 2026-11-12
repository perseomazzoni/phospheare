// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { readKeyInfo } from "../domain/openrouterKey";
import type { OpenRouterKeyInfo } from "../domain/openrouterKey";
import { OPENROUTER_API, directInit } from "./directWire";
import { StreamDeadlines } from "./streamDeadlines";

// Getting a key and reading what it is, from the browser: OpenRouter's PKCE
// flow (RFC 7636, `S256` only) and its key-info route. The verifier never
// leaves this tab except in the one exchange that proves it, and the key is
// handed back to the caller and kept by nothing here.
//
// Every failure is a fixed word, never the vendor's text or an exception's:
// the exchange's body and its error both carry the code, and the key-info
// call carries the key.

const AUTHORIZE_URL = "https://openrouter.ai/auth";
const EXCHANGE_URL = `${OPENROUTER_API}/auth/keys`;
const KEY_URL = `${OPENROUTER_API}/key`;

/** RFC 7636's unreserved set, the alphabet a verifier is drawn from. */
const UNRESERVED =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

const VERIFIER_LENGTH = 64;

/** 32 random bytes, which base64url writes as 43 characters. */
const STATE_BYTES = 32;

export interface Pkce {
  /** 64 characters from the unreserved set; kept by the tab until exchange. */
  verifier: string;
  /** `BASE64URL(SHA-256(verifier))`. */
  challenge: string;
  /** Echoed back on the callback, compared there to bind it to this tab. */
  state: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * `length` characters drawn uniformly from `alphabet`. Rejection sampling:
 * a byte past the largest multiple of the alphabet's size is redrawn, so no
 * character is likelier than another.
 */
function randomFrom(alphabet: string, length: number, source: Crypto): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const bytes = source.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** A fresh verifier, its `S256` challenge and a state, from WebCrypto. */
export async function createPkce(source: Crypto = crypto): Promise<Pkce> {
  const verifier = randomFrom(UNRESERVED, VERIFIER_LENGTH, source);
  const digest = await source.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return {
    verifier,
    challenge: base64url(new Uint8Array(digest)),
    state: base64url(source.getRandomValues(new Uint8Array(STATE_BYTES))),
  };
}

/**
 * The vendor's consent page for this flow.
 *
 * @throws TypeError when `callbackUrl` is not an absolute http(s) URL: the
 *   vendor would send the code wherever it points.
 */
export function authorizeUrl(options: {
  callbackUrl: string;
  challenge: string;
  state: string;
  keyLabel: string;
}): string {
  const callback = new URL(options.callbackUrl);
  if (callback.protocol !== "https:" && callback.protocol !== "http:")
    throw new TypeError("The callback is not an http(s) URL.");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("callback_url", callback.href);
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", options.state);
  const label = options.keyLabel.replace(/\p{Cc}+/gu, " ").trim();
  if (label !== "") url.searchParams.set("key_label", label);
  return url.href;
}

/** Long enough for a slow vendor, short enough that a click gets an answer. */
const EXCHANGE_TIMEOUT_MS = 10_000;
const KEY_TIMEOUT_MS = 10_000;

/**
 * - `expired`: the vendor refused the code or the verifier (403), most often
 *   a code already used or past its ten minutes. A new flow fixes it.
 * - `refused`: any other refusal, or an answer with no key in it.
 * - `unreachable`: no answer, a deadline, or the vendor failing (5xx, 429).
 * - `cancelled`: the caller's own signal.
 */
export type ExchangeFailure =
  "expired" | "refused" | "unreachable" | "cancelled";

export type ExchangeOutcome =
  { ok: true; key: string } | { ok: false; failure: ExchangeFailure };

/** Trades the callback's code and this tab's verifier for a key. */
export async function exchangeCode(
  fetcher: typeof fetch,
  proof: { code: string; verifier: string },
  signal: AbortSignal = new AbortController().signal,
): Promise<ExchangeOutcome> {
  const deadlines = StreamDeadlines.once(
    signal,
    EXCHANGE_TIMEOUT_MS,
    "exchange-timeout",
  );
  const stopped = (): ExchangeOutcome => ({
    ok: false,
    failure: signal.aborted ? "cancelled" : "unreachable",
  });
  try {
    let response: Response;
    try {
      response = await fetcher(
        EXCHANGE_URL,
        directInit({
          method: "POST",
          signal: deadlines.signal,
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: proof.code,
            code_verifier: proof.verifier,
            code_challenge_method: "S256",
          }),
        }),
      );
    } catch {
      return stopped();
    }

    if (response.status === 403) return { ok: false, failure: "expired" };
    if (response.status >= 500 || response.status === 429)
      return { ok: false, failure: "unreachable" };
    if (!response.ok) return { ok: false, failure: "refused" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return signal.aborted || deadlines.timedOut
        ? stopped()
        : { ok: false, failure: "refused" };
    }
    const key =
      typeof body === "object" && body !== null
        ? (body as { key?: unknown }).key
        : undefined;
    return typeof key === "string" && key.trim() !== ""
      ? { ok: true, key: key.trim() }
      : { ok: false, failure: "refused" };
  } finally {
    deadlines.dispose();
  }
}

/**
 * - `unauthorized`: 401 or 403, the vendor does not honour the key:
 *   revoked, deleted or expired. A new key fixes it.
 * - `unreachable`: no answer, a deadline, or any other refusal.
 * - `unreadable`: a 2xx whose body is not a key's description.
 * - `cancelled`: the caller's own signal.
 */
export type InspectFailure =
  "unauthorized" | "unreachable" | "unreadable" | "cancelled";

export type InspectOutcome =
  | { ok: true; info: OpenRouterKeyInfo }
  | { ok: false; failure: InspectFailure };

/**
 * What the vendor says the key is now. Not cached by the browser: the answer
 * is the spend the verdict judges by, and a stale one is the failure it
 * exists to avoid.
 */
export async function inspectKey(
  fetcher: typeof fetch,
  key: string,
  signal: AbortSignal,
  timeoutMs: number = KEY_TIMEOUT_MS,
): Promise<InspectOutcome> {
  const deadlines = StreamDeadlines.once(signal, timeoutMs, "key-timeout");
  const stopped = (): InspectOutcome => ({
    ok: false,
    failure: signal.aborted ? "cancelled" : "unreachable",
  });
  try {
    let response: Response;
    try {
      response = await fetcher(
        KEY_URL,
        directInit({
          method: "GET",
          signal: deadlines.signal,
          cache: "no-store",
          headers: { Authorization: `Bearer ${key}` },
        }),
      );
    } catch {
      return stopped();
    }

    if (response.status === 401 || response.status === 403)
      return { ok: false, failure: "unauthorized" };
    if (!response.ok) return { ok: false, failure: "unreachable" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return signal.aborted || deadlines.timedOut
        ? stopped()
        : { ok: false, failure: "unreadable" };
    }
    const info = readKeyInfo(body);
    return info ? { ok: true, info } : { ok: false, failure: "unreadable" };
  } finally {
    deadlines.dispose();
  }
}
